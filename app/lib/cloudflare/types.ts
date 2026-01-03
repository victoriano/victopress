/**
 * Cloudflare API Types
 * Types for interacting with the Cloudflare API
 */

// Base API Response
export interface CloudflareAPIResponse<T = unknown> {
  success: boolean;
  errors: CloudflareAPIError[];
  messages: string[];
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

export interface CloudflareAPIError {
  code: number;
  message: string;
}

// Account Types
export interface CloudflareAccount {
  id: string;
  name: string;
  type: string;
  settings?: {
    enforce_twofactor: boolean;
  };
  created_on?: string;
}

// Token Verification
export interface TokenVerifyResult {
  id: string;
  status: string;
  not_before?: string;
  expires_on?: string;
}

export interface VerificationResult {
  valid: boolean;
  accounts: CloudflareAccount[];
  permissions: {
    r2: boolean;
    pages: boolean;
    accountRead: boolean;
  };
  error?: string;
}

// R2 Types
export interface R2BucketInfo {
  name: string;
  creation_date: string;
  location?: string;
}

export interface R2CreateBucketRequest {
  name: string;
  locationHint?: "wnam" | "enam" | "weur" | "eeur" | "apac";
}

// Pages Types
export interface PagesProject {
  id: string;
  name: string;
  subdomain: string;
  domains: string[];
  source?: {
    type: string;
    config?: {
      owner: string;
      repo_name: string;
      production_branch: string;
    };
  };
  build_config?: {
    build_command: string;
    destination_dir: string;
  };
  deployment_configs?: {
    preview?: PagesDeploymentConfig;
    production?: PagesDeploymentConfig;
  };
  latest_deployment?: PagesDeployment;
  canonical_deployment?: PagesDeployment;
  created_on: string;
  production_branch?: string;
}

export interface PagesDeploymentConfig {
  env_vars?: Record<string, { value: string } | { type: "secret_text" }>;
  kv_namespaces?: Record<string, { namespace_id: string }>;
  durable_object_namespaces?: Record<string, { namespace_id: string }>;
  r2_buckets?: Record<string, { name: string }>;
  d1_databases?: Record<string, { id: string }>;
  services?: Record<string, { service: string; environment: string }>;
  compatibility_date?: string;
  compatibility_flags?: string[];
}

export interface PagesDeployment {
  id: string;
  url: string;
  environment: string;
  created_on: string;
  modified_on: string;
  aliases?: string[];
  production_branch?: string;
  deployment_trigger?: {
    type: string;
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  stages?: Array<{
    name: string;
    started_on: string;
    ended_on: string;
    status: string;
  }>;
  build_config?: {
    build_command: string;
    destination_dir: string;
  };
  source?: {
    type: string;
    config?: {
      owner: string;
      repo_name: string;
    };
  };
}

// Setup Flow Types
export interface SetupState {
  step:
    | "welcome"
    | "token"
    | "account"
    | "bucket"
    | "bind"
    | "seed"
    | "credentials"
    | "complete";
  token?: string;
  accountId?: string;
  accounts?: CloudflareAccount[];
  bucketName?: string;
  bucketCreated?: boolean;
  bindingCreated?: boolean;
  contentSeeded?: boolean;
  projectName?: string;
  error?: string;
}

export interface TokenStorageData {
  token: string;
  accountId: string;
  projectName: string;
  bucketName: string;
  createdAt: string;
  expiresAt?: string;
}
