/**
 * Cloudflare API Client
 * Handles authentication, account detection, and API interactions
 */

import type {
  CloudflareAPIResponse,
  CloudflareAccount,
  TokenVerifyResult,
  VerificationResult,
  R2BucketInfo,
  R2CreateBucketRequest,
  PagesProject,
  PagesDeploymentConfig,
} from "./types";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * Make an authenticated request to the Cloudflare API
   */
  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<CloudflareAPIResponse<T>> {
    const url = `${CLOUDFLARE_API_BASE}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = (await response.json()) as CloudflareAPIResponse<T>;

    if (!data.success) {
      const errorMessage = data.errors
        .map((e) => `${e.code}: ${e.message}`)
        .join(", ");
      throw new CloudflareAPIError(errorMessage, data.errors);
    }

    return data;
  }

  /**
   * Verify the API token is valid
   */
  async verifyToken(): Promise<TokenVerifyResult> {
    const response = await this.fetch<TokenVerifyResult>("/user/tokens/verify");
    return response.result;
  }

  /**
   * Get all accounts accessible with this token
   */
  async getAccounts(): Promise<CloudflareAccount[]> {
    const response = await this.fetch<CloudflareAccount[]>("/accounts");
    return response.result;
  }

  /**
   * Full token verification with permission checks
   * Returns accounts and detected permissions
   */
  async verifyTokenWithPermissions(): Promise<VerificationResult> {
    try {
      // First verify the token itself
      const tokenInfo = await this.verifyToken();

      if (tokenInfo.status !== "active") {
        return {
          valid: false,
          accounts: [],
          permissions: { r2: false, pages: false, accountRead: false },
          error: `Token status: ${tokenInfo.status}`,
        };
      }

      // Get accounts to verify account read permission
      const accounts = await this.getAccounts();

      if (accounts.length === 0) {
        return {
          valid: false,
          accounts: [],
          permissions: { r2: false, pages: false, accountRead: false },
          error: "No accounts found. Token may not have account read permission.",
        };
      }

      // Check R2 and Pages permissions by attempting to list resources
      const accountId = accounts[0].id;
      const permissions = {
        r2: false,
        pages: false,
        accountRead: true,
      };

      // Check R2 permission
      try {
        await this.listR2Buckets(accountId);
        permissions.r2 = true;
      } catch {
        // R2 permission not granted
      }

      // Check Pages permission
      try {
        await this.listPagesProjects(accountId);
        permissions.pages = true;
      } catch {
        // Pages permission not granted
      }

      return {
        valid: true,
        accounts,
        permissions,
      };
    } catch (error) {
      return {
        valid: false,
        accounts: [],
        permissions: { r2: false, pages: false, accountRead: false },
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ==================== R2 Operations ====================

  /**
   * List all R2 buckets in an account
   */
  async listR2Buckets(accountId: string): Promise<R2BucketInfo[]> {
    const response = await this.fetch<{ buckets: R2BucketInfo[] }>(
      `/accounts/${accountId}/r2/buckets`
    );
    return response.result.buckets || [];
  }

  /**
   * Create a new R2 bucket
   */
  async createR2Bucket(
    accountId: string,
    request: R2CreateBucketRequest
  ): Promise<R2BucketInfo> {
    const response = await this.fetch<R2BucketInfo>(
      `/accounts/${accountId}/r2/buckets`,
      {
        method: "POST",
        body: JSON.stringify(request),
      }
    );
    return response.result;
  }

  /**
   * Check if an R2 bucket exists
   */
  async r2BucketExists(accountId: string, bucketName: string): Promise<boolean> {
    try {
      const buckets = await this.listR2Buckets(accountId);
      return buckets.some((b) => b.name === bucketName);
    } catch {
      return false;
    }
  }

  /**
   * Generate a unique bucket name
   */
  generateBucketName(prefix: string = "victopress"): string {
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${random}`;
  }

  // ==================== Pages Operations ====================

  /**
   * List all Pages projects in an account
   */
  async listPagesProjects(accountId: string): Promise<PagesProject[]> {
    const response = await this.fetch<PagesProject[]>(
      `/accounts/${accountId}/pages/projects`
    );
    return response.result;
  }

  /**
   * Get a specific Pages project
   */
  async getPagesProject(
    accountId: string,
    projectName: string
  ): Promise<PagesProject> {
    const response = await this.fetch<PagesProject>(
      `/accounts/${accountId}/pages/projects/${projectName}`
    );
    return response.result;
  }

  /**
   * Update Pages project settings (for R2 binding)
   */
  async updatePagesProject(
    accountId: string,
    projectName: string,
    deploymentConfig: {
      preview?: Partial<PagesDeploymentConfig>;
      production?: Partial<PagesDeploymentConfig>;
    }
  ): Promise<PagesProject> {
    const response = await this.fetch<PagesProject>(
      `/accounts/${accountId}/pages/projects/${projectName}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          deployment_configs: deploymentConfig,
        }),
      }
    );
    return response.result;
  }

  /**
   * Bind an R2 bucket to a Pages project
   */
  async bindR2ToPages(
    accountId: string,
    projectName: string,
    bindingName: string,
    bucketName: string
  ): Promise<PagesProject> {
    return this.updatePagesProject(accountId, projectName, {
      production: {
        r2_buckets: {
          [bindingName]: { name: bucketName },
        },
      },
      preview: {
        r2_buckets: {
          [bindingName]: { name: bucketName },
        },
      },
    });
  }

  /**
   * Trigger a new deployment
   */
  async triggerDeployment(
    accountId: string,
    projectName: string
  ): Promise<{ id: string; url: string }> {
    const response = await this.fetch<{ id: string; url: string }>(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: "POST",
      }
    );
    return response.result;
  }

  /**
   * Set environment variables for a Pages project
   * This sets both production and preview environment variables
   */
  async setEnvironmentVariables(
    accountId: string,
    projectName: string,
    variables: Record<string, string>
  ): Promise<PagesProject> {
    // Convert simple key-value pairs to Cloudflare's env_vars format
    const envVars: Record<string, { type: string; value: string }> = {};
    for (const [key, value] of Object.entries(variables)) {
      envVars[key] = { type: "secret_text", value };
    }

    return this.updatePagesProject(accountId, projectName, {
      production: {
        env_vars: envVars,
      },
      preview: {
        env_vars: envVars,
      },
    });
  }

  /**
   * Set admin credentials as environment variables
   */
  async setAdminCredentials(
    accountId: string,
    projectName: string,
    username: string,
    password: string
  ): Promise<PagesProject> {
    return this.setEnvironmentVariables(accountId, projectName, {
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
    });
  }

  /**
   * Find a Pages project by domain or subdomain
   */
  async findProjectByDomain(
    accountId: string,
    domain: string
  ): Promise<PagesProject | null> {
    const projects = await this.listPagesProjects(accountId);

    // Check subdomain match (e.g., project-name.pages.dev)
    const subdomainMatch = domain.match(/^([^.]+)\.pages\.dev$/);
    if (subdomainMatch) {
      const subdomain = subdomainMatch[1];
      const project = projects.find(
        (p) => p.subdomain === subdomain || p.name === subdomain
      );
      if (project) return project;
    }

    // Check custom domain match
    for (const project of projects) {
      if (project.domains?.includes(domain)) {
        return project;
      }
    }

    return null;
  }
}

/**
 * Custom error class for Cloudflare API errors
 */
export class CloudflareAPIError extends Error {
  public errors: Array<{ code: number; message: string }>;

  constructor(
    message: string,
    errors: Array<{ code: number; message: string }>
  ) {
    super(message);
    this.name = "CloudflareAPIError";
    this.errors = errors;
  }
}

/**
 * Create a new CloudflareAPI instance
 */
export function createCloudflareAPI(token: string): CloudflareAPI {
  return new CloudflareAPI(token);
}
