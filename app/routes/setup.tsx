/**
 * Admin Setup Wizard
 * 
 * First-time setup flow for VictoPress.
 * Guides users through Cloudflare API Token configuration and R2 setup.
 */

import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { json, redirect } from "@remix-run/cloudflare";
import { isR2Configured, getStorageMode } from "~/lib/content-engine/storage";
import { createCloudflareAPI, CloudflareAPIError } from "~/lib/cloudflare";
import type { CloudflareAccount, VerificationResult } from "~/lib/cloudflare";

type SetupStep = "welcome" | "token" | "bucket" | "seed" | "credentials" | "complete";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare?.env as Env | undefined;
  const storageConfigured = isR2Configured(context);
  const storageMode = getStorageMode(context);
  
  // Allow force access via ?force=true for testing
  const url = new URL(request.url);
  const forceAccess = url.searchParams.get("force") === "true";
  
  // In development, always show the wizard for testing
  const isDev = process.env.NODE_ENV === "development";
  
  // Get current hostname for project detection
  const hostname = url.hostname;
  
  const isFullyConfigured = storageConfigured && !!(env?.ADMIN_USERNAME && env?.ADMIN_PASSWORD);
  
  console.log("[Setup Wizard]", {
    isDev,
    forceAccess,
    storageConfigured,
    storageMode,
    hostname,
    isFullyConfigured,
  });
  
  // If already fully configured, redirect to home (unless dev or force)
  if (!isDev && !forceAccess && isFullyConfigured) {
    console.log("[Setup Wizard] Redirecting to / - already configured");
    return redirect("/");
  }
  
  return json({
    storageConfigured,
    storageMode,
    isDev,
    hostname,
    hasCredentials: !!(env?.ADMIN_USERNAME && env?.ADMIN_PASSWORD),
    defaultBucketName: "victopress-content",
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const isDev = process.env.NODE_ENV === "development";
  
  // ==================== Verify API Token ====================
  if (action === "verify-token") {
    const token = formData.get("token") as string;
    
    if (!token || token.length < 20) {
      return json({ 
        success: false, 
        error: "Please provide a valid API token" 
      });
    }
    
    try {
      const api = createCloudflareAPI(token);
      const result = await api.verifyTokenWithPermissions();
      
      if (!result.valid) {
        return json({ 
          success: false, 
          error: result.error || "Invalid token"
        });
      }
      
      // R2 permission is required, Pages permission is optional (for auto-binding)
      if (!result.permissions.r2) {
        return json({
          success: false,
          error: "Missing required permission: Workers R2 Storage (Edit)",
          accounts: result.accounts,
          permissions: result.permissions,
        });
      }
      
      return json({
        success: true,
        accounts: result.accounts,
        permissions: result.permissions,
        hasPagesPermission: result.permissions.pages,
      });
    } catch (error) {
      const message = error instanceof CloudflareAPIError 
        ? error.message 
        : error instanceof Error 
          ? error.message 
          : "Unknown error";
      return json({ success: false, error: message });
    }
  }
  
  // ==================== Create R2 Bucket ====================
  if (action === "create-bucket") {
    const token = formData.get("token") as string;
    const accountId = formData.get("accountId") as string;
    const bucketName = formData.get("bucketName") as string;
    
    if (!token || !accountId || !bucketName) {
      return json({ success: false, error: "Missing required parameters" });
    }
    
    try {
      const api = createCloudflareAPI(token);
      
      // Check if bucket already exists
      const exists = await api.r2BucketExists(accountId, bucketName);
      if (exists) {
        return json({ 
          success: true, 
          message: `Bucket "${bucketName}" already exists`,
          bucketName,
          alreadyExists: true,
        });
      }
      
      // Create the bucket
      const bucket = await api.createR2Bucket(accountId, { name: bucketName });
      
      return json({ 
        success: true, 
        message: `Bucket "${bucket.name}" created successfully!`,
        bucketName: bucket.name,
      });
    } catch (error) {
      const message = error instanceof CloudflareAPIError 
        ? error.message 
        : error instanceof Error 
          ? error.message 
          : "Unknown error";
      return json({ success: false, error: message });
    }
  }
  
  // ==================== Bind R2 to Pages ====================
  if (action === "bind-r2") {
    const token = formData.get("token") as string;
    const accountId = formData.get("accountId") as string;
    const bucketName = formData.get("bucketName") as string;
    const projectName = formData.get("projectName") as string;
    
    if (!token || !accountId || !bucketName || !projectName) {
      return json({ success: false, error: "Missing required parameters" });
    }
    
    try {
      const api = createCloudflareAPI(token);
      
      // Bind R2 to Pages project
      await api.bindR2ToPages(accountId, projectName, "CONTENT_BUCKET", bucketName);
      
      return json({ 
        success: true, 
        message: `R2 bucket bound to Pages project "${projectName}"!`,
      });
    } catch (error) {
      const message = error instanceof CloudflareAPIError 
        ? error.message 
        : error instanceof Error 
          ? error.message 
          : "Unknown error";
      return json({ success: false, error: message });
    }
  }
  
  // ==================== Trigger Deployment ====================
  if (action === "trigger-deployment") {
    const token = formData.get("token") as string;
    const accountId = formData.get("accountId") as string;
    const projectName = formData.get("projectName") as string;
    
    if (!token || !accountId || !projectName) {
      return json({ success: false, error: "Missing required parameters" });
    }
    
    try {
      const api = createCloudflareAPI(token);
      const deployment = await api.triggerDeployment(accountId, projectName);
      
      return json({ 
        success: true, 
        message: `Deployment triggered! Your site will be updated shortly.`,
        deploymentUrl: deployment.url,
        deploymentId: deployment.id,
      });
    } catch (error) {
      const message = error instanceof CloudflareAPIError 
        ? error.message 
        : error instanceof Error 
          ? error.message 
          : "Unknown error";
      return json({ success: false, error: message });
    }
  }
  
  // ==================== Seed Content ====================
  if (action === "seed-content") {
    const env = context.cloudflare?.env as Env | undefined;
    const bucket = env?.CONTENT_BUCKET;
    const simulateSuccess = formData.get("simulate") === "true";
    
    // In development, allow simulating successful seeding
    if (isDev && simulateSuccess) {
      return json({ 
        success: true, 
        message: "✅ Simulated seeding complete! 5 sample galleries would be created. (Development mode)",
        simulated: true,
      });
    }
    
    if (!bucket) {
      return json({ 
        success: false, 
        error: "R2 bucket not configured. The binding will be active after redeployment.",
        hint: isDev ? "💡 In development, use 'Simulate Success' to test the UI flow." : undefined,
      });
    }
    
    try {
      // Import bundled content and seed to R2
      const { BundledStorageAdapter } = await import("~/lib/content-engine/storage/bundled-adapter");
      const bundled = new BundledStorageAdapter();
      const files = bundled.getAllContent();
      
      let seeded = 0;
      for (const file of files) {
        if (!file.isDirectory && file.content) {
          const ext = file.path.split(".").pop()?.toLowerCase();
          const contentTypes: Record<string, string> = {
            yaml: "text/yaml",
            yml: "text/yaml",
            md: "text/markdown",
            json: "application/json",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
          };
          
          let data: ArrayBuffer | string;
          if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext || "")) {
            const binary = atob(file.content);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            data = bytes.buffer;
          } else {
            data = file.content;
          }
          
          await bucket.put(file.path, data, {
            httpMetadata: contentTypes[ext || ""] ? { contentType: contentTypes[ext || ""] } : undefined,
          });
          seeded++;
        }
      }
      
      return json({ success: true, message: `Seeded ${seeded} files to R2` });
    } catch (error) {
      return json({ 
        success: false, 
        error: `Seeding failed: ${error instanceof Error ? error.message : "Unknown error"}` 
      });
    }
  }
  
  // ==================== Generate & Set Credentials ====================
  if (action === "generate-credentials") {
    const token = formData.get("token") as string;
    const accountId = formData.get("accountId") as string;
    const projectName = formData.get("projectName") as string;
    const password = generateSecurePassword();
    const username = "admin";
    
    console.log(`[SETUP] Generated admin credentials`);
    
    // If we have token and project info, set credentials automatically
    if (token && accountId && projectName) {
      try {
        const api = createCloudflareAPI(token);
        await api.setAdminCredentials(accountId, projectName, username, password);
        
        console.log(`[SETUP] ✅ Credentials set automatically for project: ${projectName}`);
        
        return json({ 
          success: true, 
          message: "Credentials set automatically! Save your password - you'll need it to log in.",
          generatedPassword: password,
          generatedUsername: username,
          credentialsSetAutomatically: true,
        });
      } catch (error) {
        console.error(`[SETUP] Failed to set credentials automatically:`, error);
        // Fall through to manual mode
      }
    }
    
    // Manual fallback if auto-setting failed or missing info
    console.log(`[SETUP] Manual mode - user needs to set credentials in Cloudflare dashboard`);
    
    return json({ 
      success: true, 
      message: "Credentials generated! Copy the password and save it securely.",
      generatedPassword: password,
      generatedUsername: username,
      credentialsSetAutomatically: false,
    });
  }
  
  // ==================== List Pages Projects ====================
  if (action === "list-projects") {
    const token = formData.get("token") as string;
    const accountId = formData.get("accountId") as string;
    
    if (!token || !accountId) {
      return json({ success: false, error: "Missing required parameters" });
    }
    
    try {
      const api = createCloudflareAPI(token);
      const projects = await api.listPagesProjects(accountId);
      
      return json({
        success: true,
        projects: projects.map(p => ({
          name: p.name,
          subdomain: p.subdomain,
          domains: p.domains,
        })),
      });
    } catch (error) {
      const message = error instanceof CloudflareAPIError 
        ? error.message 
        : error instanceof Error 
          ? error.message 
          : "Unknown error";
      return json({ success: false, error: message });
    }
  }
  
  return json({ success: false, error: "Unknown action" });
}

function generateSecurePassword(length = 16): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => charset[byte % charset.length]).join("");
}

export default function AdminSetup() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    success: boolean;
    message?: string;
    error?: string;
    devPassword?: string;
    accounts?: CloudflareAccount[];
    permissions?: VerificationResult["permissions"];
    hasPagesPermission?: boolean;
    projects?: Array<{ name: string; subdomain: string; domains: string[] }>;
    bucketName?: string;
    simulated?: boolean;
    hint?: string;
    alreadyExists?: boolean;
  }>();
  const navigate = useNavigate();
  
  const [step, setStep] = useState<SetupStep>("welcome");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [bucketName, setBucketName] = useState(data.defaultBucketName);
  const [selectedProject, setSelectedProject] = useState("");
  const [projects, setProjects] = useState<Array<{ name: string; subdomain: string; domains: string[] }>>([]);
  const [seedContent, setSeedContent] = useState(true);
  const [bucketCreated, setBucketCreated] = useState(false);
  const [bindingCreated, setBindingCreated] = useState(false);
  const [hasPagesPermission, setHasPagesPermission] = useState(true);
  const [deploymentTriggered, setDeploymentTriggered] = useState(false);
  
  const isLoading = fetcher.state !== "idle";
  const result = fetcher.data;
  
  // Handle API responses
  useEffect(() => {
    if (result?.success) {
      if (result.accounts) {
        setAccounts(result.accounts);
        if (result.accounts.length === 1) {
          setSelectedAccountId(result.accounts[0].id);
        }
      }
      // Track Pages permission status
      if (result.hasPagesPermission !== undefined) {
        setHasPagesPermission(result.hasPagesPermission);
      }
      if (result.projects) {
        setProjects(result.projects);
        // Try to auto-detect project from hostname
        const hostname = data.hostname;
        const match = result.projects.find(p => 
          p.subdomain === hostname.split(".")[0] ||
          p.domains?.includes(hostname)
        );
        if (match) {
          setSelectedProject(match.name);
        } else if (result.projects.length === 1) {
          setSelectedProject(result.projects[0].name);
        }
      }
      if (result.bucketName) {
        setBucketName(result.bucketName);
        setBucketCreated(true);
      }
      if (result.deploymentId) {
        setDeploymentTriggered(true);
      }
    }
  }, [result, data.hostname]);
  
  const verifyToken = () => {
    fetcher.submit({ action: "verify-token", token }, { method: "POST" });
  };
  
  const listProjects = () => {
    fetcher.submit({ action: "list-projects", token, accountId: selectedAccountId }, { method: "POST" });
  };
  
  const createBucket = () => {
    fetcher.submit({ 
      action: "create-bucket", 
      token, 
      accountId: selectedAccountId, 
      bucketName 
    }, { method: "POST" });
  };
  
  const bindR2 = () => {
    fetcher.submit({
      action: "bind-r2",
      token,
      accountId: selectedAccountId,
      bucketName,
      projectName: selectedProject,
    }, { method: "POST" });
  };
  
  const triggerDeployment = () => {
    fetcher.submit({
      action: "trigger-deployment",
      token,
      accountId: selectedAccountId,
      projectName: selectedProject,
    }, { method: "POST" });
  };
  
  const seedToR2 = (simulate = false) => {
    fetcher.submit({ action: "seed-content", simulate: simulate ? "true" : "false" }, { method: "POST" });
  };
  
  const generateCredentials = () => {
    fetcher.submit({ 
      action: "generate-credentials",
      token,
      accountId: selectedAccountId,
      projectName: selectedProject,
    }, { method: "POST" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">VictoPress</h1>
          <p className="text-gray-400">Files-first photo gallery CMS</p>
        </div>

        {/* Setup Card */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-8">
          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {(["welcome", "token", "bucket", "seed", "credentials", "complete"] as SetupStep[]).map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === s 
                    ? "bg-blue-600 text-white" 
                    : ["welcome", "token", "bucket", "seed", "credentials", "complete"].indexOf(step) > i
                      ? "bg-green-600 text-white"
                      : "bg-gray-700 text-gray-400"
                }`}>
                  {["welcome", "token", "bucket", "seed", "credentials", "complete"].indexOf(step) > i ? "✓" : i + 1}
                </div>
                {i < 5 && <div className="w-6 h-0.5 bg-gray-700" />}
              </div>
            ))}
          </div>

          {/* Step Content */}
          {step === "welcome" && (
            <WelcomeStep 
              storageMode={data.storageMode}
              onNext={() => setStep("token")} 
            />
          )}
          
          {step === "token" && (
            <TokenStep
              token={token}
              setToken={setToken}
              showToken={showToken}
              setShowToken={setShowToken}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              setSelectedAccountId={setSelectedAccountId}
              isLoading={isLoading}
              result={result}
              onVerify={verifyToken}
              onNext={() => {
                listProjects();
                setStep("bucket");
              }}
              onBack={() => setStep("welcome")}
            />
          )}
          
          {step === "bucket" && (
            <BucketStep
              bucketName={bucketName}
              setBucketName={setBucketName}
              projects={projects}
              selectedProject={selectedProject}
              setSelectedProject={setSelectedProject}
              bucketCreated={bucketCreated}
              bindingCreated={bindingCreated}
              setBindingCreated={setBindingCreated}
              hasPagesPermission={hasPagesPermission}
              deploymentTriggered={deploymentTriggered}
              isLoading={isLoading}
              result={result}
              onCreateBucket={createBucket}
              onBindR2={bindR2}
              onTriggerDeployment={triggerDeployment}
              onListProjects={listProjects}
              onNext={() => setStep("seed")}
              onBack={() => setStep("token")}
            />
          )}
          
          {step === "seed" && (
            <SeedStep
              seedContent={seedContent}
              setSeedContent={setSeedContent}
              isDev={data.isDev}
              isLoading={isLoading}
              result={result}
              onSeed={() => seedToR2(false)}
              onSimulate={() => seedToR2(true)}
              onNext={() => setStep("credentials")}
              onBack={() => setStep("bucket")}
              isR2Configured={data.storageConfigured || bindingCreated}
              needsRedeploy={bindingCreated && !data.storageConfigured}
            />
          )}
          
          {step === "credentials" && (
            <CredentialsStep
              isLoading={isLoading}
              result={result}
              onGenerate={generateCredentials}
              onNext={() => setStep("complete")}
              onBack={() => setStep("seed")}
            />
          )}
          
          {step === "complete" && (
            <CompleteStep 
              needsRedeploy={bindingCreated && !data.storageConfigured}
              deploymentTriggered={deploymentTriggered}
              isLoading={isLoading}
              onTriggerDeployment={triggerDeployment}
              onFinish={() => navigate("/admin")} 
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Step Components ====================

function WelcomeStep({ storageMode, onNext }: { storageMode: string; onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🎉</div>
      <h2 className="text-2xl font-bold text-white mb-4">Welcome to VictoPress!</h2>
      
      {storageMode === "demo" ? (
        <div className="space-y-4">
          <p className="text-gray-300">
            Your site is running in <span className="text-yellow-400 font-medium">Demo Mode</span> with sample content.
          </p>
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-left">
            <p className="text-yellow-200 text-sm">
              <strong>Demo Mode Limitations:</strong>
            </p>
            <ul className="text-yellow-300/80 text-sm mt-2 space-y-1 list-disc list-inside">
              <li>Read-only access to galleries</li>
              <li>Cannot upload new photos</li>
              <li>Cannot edit content</li>
            </ul>
          </div>
          <p className="text-gray-400">
            Let's set up Cloudflare R2 storage to unlock the full CMS functionality.
          </p>
        </div>
      ) : (
        <p className="text-gray-300">
          Let's complete the setup to get your photo gallery running.
        </p>
      )}
      
      <button
        onClick={onNext}
        className="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
      >
        Get Started →
      </button>
    </div>
  );
}

function TokenStep({
  token,
  setToken,
  showToken,
  setShowToken,
  accounts,
  selectedAccountId,
  setSelectedAccountId,
  isLoading,
  result,
  onVerify,
  onNext,
  onBack,
}: {
  token: string;
  setToken: (token: string) => void;
  showToken: boolean;
  setShowToken: (show: boolean) => void;
  accounts: CloudflareAccount[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  isLoading: boolean;
  result: { success: boolean; message?: string; error?: string; permissions?: VerificationResult["permissions"] } | undefined;
  onVerify: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const hasValidToken = result?.success && accounts.length > 0;
  const hasRequiredPermissions = result?.permissions?.r2 && result?.permissions?.pages;
  
  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-2">Connect to Cloudflare</h2>
      <p className="text-gray-400 mb-6">
        Create an API Token to automatically set up R2 storage.
      </p>
      
      {/* Required Permissions */}
      <div className="bg-gray-900/50 rounded-lg p-4 mb-6">
        <h3 className="text-white font-medium mb-3">Required Permissions</h3>
        <p className="text-gray-400 text-sm mb-3">
          Click "Create Token" → "Create Custom Token" and add these permissions:
        </p>
        <div className="space-y-2 text-sm bg-gray-800 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className={result?.permissions?.accountRead ? "text-green-400" : "text-blue-400"}>
              {result?.permissions?.accountRead ? "✓" : "1."}
            </span>
            <span className="text-gray-300">
              <span className="text-gray-400">Account</span> → <span className="text-white">Account Settings</span> → <span className="text-green-400">Read</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={result?.permissions?.r2 ? "text-green-400" : "text-blue-400"}>
              {result?.permissions?.r2 ? "✓" : "2."}
            </span>
            <span className="text-gray-300">
              <span className="text-gray-400">Account</span> → <span className="text-white">Workers R2 Storage</span> → <span className="text-yellow-400">Edit</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={result?.permissions?.pages ? "text-green-400" : "text-blue-400"}>
              {result?.permissions?.pages ? "✓" : "3."}
            </span>
            <span className="text-gray-300">
              <span className="text-gray-400">Account</span> → <span className="text-white">Cloudflare Pages</span> → <span className="text-yellow-400">Edit</span>
            </span>
          </div>
        </div>
        <p className="text-gray-500 text-xs mt-2">
          Under "Account Resources", select your account (or "All accounts").
        </p>
        
        <a 
          href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22page%22%2C%22type%22%3A%22edit%22%7D%5D&name=VictoPress"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm"
        >
          <span>📋</span>
          Create Token with Pre-filled Permissions ↗
        </a>
      </div>
      
      {/* Token Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          API Token
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your API token here..."
            className="w-full px-4 py-3 pr-20 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
          >
            {showToken ? "🙈" : "👁️"}
          </button>
        </div>
      </div>
      
      {/* Account Selection (if multiple) */}
      {accounts.length > 1 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Select Account
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select an account...</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
      )}
      
      {/* Result */}
      {result && (
        <div className={`mb-6 p-4 rounded-lg ${
          result.success 
            ? "bg-green-900/30 border border-green-700" 
            : "bg-red-900/30 border border-red-700"
        }`}>
          {result.success ? (
            <div>
              <p className="text-green-400 font-medium">✓ Token verified successfully!</p>
              {accounts.length === 1 && (
                <p className="text-green-300/70 text-sm mt-1">
                  Account: {accounts[0].name}
                </p>
              )}
              {/* Warning if missing Pages permission */}
              {result.permissions && !result.permissions.pages && (
                <div className="mt-3 p-3 bg-yellow-900/30 border border-yellow-700 rounded">
                  <p className="text-yellow-400 text-sm">
                    ⚠️ Missing "Cloudflare Pages" permission. You can still create the R2 bucket, 
                    but you'll need to manually bind it in the Cloudflare Dashboard.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-red-400">{result.error}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={onVerify}
            disabled={isLoading || token.length < 20}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isLoading ? "Verifying..." : "Verify Token"}
          </button>
          <button
            onClick={onNext}
            disabled={!hasValidToken || !result?.permissions?.r2 || !selectedAccountId}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

function BucketStep({
  bucketName,
  setBucketName,
  projects,
  selectedProject,
  setSelectedProject,
  bucketCreated,
  bindingCreated,
  setBindingCreated,
  hasPagesPermission,
  deploymentTriggered,
  isLoading,
  result,
  onCreateBucket,
  onBindR2,
  onTriggerDeployment,
  onListProjects,
  onNext,
  onBack,
}: {
  bucketName: string;
  setBucketName: (name: string) => void;
  projects: Array<{ name: string; subdomain: string; domains: string[] }>;
  selectedProject: string;
  setSelectedProject: (name: string) => void;
  bucketCreated: boolean;
  bindingCreated: boolean;
  setBindingCreated: (created: boolean) => void;
  hasPagesPermission: boolean;
  deploymentTriggered: boolean;
  isLoading: boolean;
  result: { success: boolean; message?: string; error?: string; alreadyExists?: boolean; deploymentId?: string } | undefined;
  onCreateBucket: () => void;
  onBindR2: () => void;
  onTriggerDeployment: () => void;
  onListProjects: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  // Track binding success
  useEffect(() => {
    if (result?.success && result.message?.includes("bound")) {
      setBindingCreated(true);
    }
  }, [result, setBindingCreated]);
  
  // Auto-refresh countdown after deployment is triggered
  const [countdown, setCountdown] = useState(90);
  
  useEffect(() => {
    if (deploymentTriggered) {
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            window.location.reload();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [deploymentTriggered]);
  
  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-2">Create R2 Bucket</h2>
      <p className="text-gray-400 mb-6">
        {hasPagesPermission 
          ? "We'll create an R2 bucket and bind it to your Pages project."
          : "We'll create an R2 bucket for your content."
        }
      </p>
      
      {/* Step 1: Create Bucket */}
      <div className="bg-gray-900/50 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
            bucketCreated ? "bg-green-600 text-white" : "bg-blue-600 text-white"
          }`}>
            {bucketCreated ? "✓" : "1"}
          </div>
          <h3 className="text-white font-medium">Create R2 Bucket</h3>
        </div>
        
        <div className="ml-9">
          <label className="block text-sm text-gray-400 mb-2">Bucket Name</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              disabled={bucketCreated}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-50"
            />
            <button
              onClick={onCreateBucket}
              disabled={isLoading || bucketCreated || !bucketName}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {isLoading ? "Creating..." : bucketCreated ? "Created ✓" : "Create"}
            </button>
          </div>
        </div>
      </div>
      
      {/* Step 2: Bind to Pages - Only show if we have Pages permission */}
      {hasPagesPermission ? (
        <div className="bg-gray-900/50 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
              bindingCreated ? "bg-green-600 text-white" : bucketCreated ? "bg-blue-600 text-white" : "bg-gray-600 text-gray-400"
            }`}>
              {bindingCreated ? "✓" : "2"}
            </div>
            <h3 className={`font-medium ${bucketCreated ? "text-white" : "text-gray-500"}`}>
              Bind to Pages Project
            </h3>
          </div>
          
          <div className="ml-9">
            <label className="block text-sm text-gray-400 mb-2">Pages Project</label>
            <div className="flex gap-3">
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                disabled={!bucketCreated || bindingCreated}
                className="flex-1 min-w-0 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-50 truncate"
              >
                <option value="">Select project...</option>
                {projects.map((project) => (
                  <option key={project.name} value={project.name}>
                    {project.name}
                  </option>
                ))}
              </select>
            {projects.length === 0 && bucketCreated && (
              <button
                onClick={onListProjects}
                disabled={isLoading}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Refresh
              </button>
            )}
            <button
              onClick={onBindR2}
              disabled={isLoading || !bucketCreated || bindingCreated || !selectedProject}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {isLoading ? "Binding..." : bindingCreated ? "Bound ✓" : "Bind"}
            </button>
          </div>
        </div>
      </div>
      ) : (
        /* Manual Binding Instructions - No Pages Permission */
        bucketCreated && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm bg-yellow-600 text-white">
                2
              </div>
              <h3 className="text-yellow-400 font-medium">Manual Binding Required</h3>
            </div>
            <p className="text-yellow-300/70 text-sm mb-3">
              Your API token doesn't have Cloudflare Pages permission, so you'll need to manually bind the R2 bucket.
            </p>
            <div className="bg-gray-900 rounded-lg p-3 text-sm">
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>Go to <a href="https://dash.cloudflare.com/?to=/:account/pages" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Cloudflare Pages Dashboard ↗</a></li>
                <li>Select your project → <strong>Settings</strong> → <strong>Functions</strong></li>
                <li>Scroll to <strong>R2 bucket bindings</strong></li>
                <li>Add binding:
                  <div className="mt-1 bg-gray-800 rounded p-2 font-mono text-xs">
                    <div>Variable name: <span className="text-green-400">CONTENT_BUCKET</span></div>
                    <div>R2 bucket: <span className="text-green-400">{bucketName}</span></div>
                  </div>
                </li>
                <li>Save and redeploy</li>
              </ol>
            </div>
          </div>
        )
      )}
      
      {/* Result - only show if there's a bucket/binding related message */}
      {result && (result.message?.toLowerCase().includes("bucket") || result.message?.toLowerCase().includes("bound") || (result.error && !result.accounts)) && (
        <div className={`mb-6 p-4 rounded-lg ${
          result.success 
            ? "bg-green-900/30 border border-green-700" 
            : "bg-red-900/30 border border-red-700"
        }`}>
          <p className={result.success ? "text-green-400" : "text-red-400"}>
            {result.message || result.error}
          </p>
        </div>
      )}
      
      {/* Redeploy Notice */}
      {(bindingCreated || (bucketCreated && !hasPagesPermission)) && !deploymentTriggered && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-6">
          <p className="text-yellow-400 font-medium mb-2">⚠️ Redeploy Required</p>
          <p className="text-yellow-300/70 text-sm mb-3">
            {hasPagesPermission 
              ? "The R2 binding has been configured. A new deployment is needed for the changes to take effect."
              : "After adding the R2 binding in the Cloudflare Dashboard, trigger a new deployment."
            }
          </p>
          {hasPagesPermission && (
            <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
              <p className="text-gray-300 text-sm mb-2">
                <strong>Note:</strong> Triggering a redeploy will make this page temporarily unavailable (~1-2 minutes).
              </p>
              <p className="text-gray-400 text-xs">
                Bookmark this page or copy the URL to return after deployment completes.
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            {hasPagesPermission && (
              <button
                onClick={onTriggerDeployment}
                disabled={isLoading}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
              >
                {isLoading ? "Deploying..." : "🚀 Trigger Redeploy Now"}
              </button>
            )}
            <button
              onClick={onNext}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              Skip for now →
            </button>
          </div>
        </div>
      )}
      
      {/* Deployment Triggered - Full screen takeover */}
      {deploymentTriggered && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-6 mb-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">🚀 Deployment in Progress!</h3>
            <p className="text-blue-300 mb-4">
              Your site is being redeployed with the new R2 binding.
              <br />
              This usually takes <strong>1-2 minutes</strong>.
            </p>
            <div className="bg-gray-900/50 rounded-lg p-4 mb-4 text-left">
              <p className="text-gray-300 text-sm font-medium mb-2">What happens next:</p>
              <ol className="text-gray-400 text-sm space-y-1 list-decimal list-inside">
                <li>This page will become unavailable shortly</li>
                <li>Wait 1-2 minutes for the deployment to complete</li>
                <li>Refresh this page to continue the setup wizard</li>
              </ol>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
              >
                📋 Copy This URL
              </button>
              <a
                href="https://dash.cloudflare.com/?to=/:account/pages"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
              >
                View in Cloudflare ↗
              </a>
            </div>
            <div className="flex items-center justify-center gap-2 mt-4">
              <p className="text-gray-500 text-xs">
                Auto-refresh in
              </p>
              <span className="px-2 py-1 bg-gray-800 rounded text-blue-400 font-mono text-sm">
                {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
              </span>
              <button
                onClick={() => window.location.reload()}
                className="text-blue-400 hover:text-blue-300 text-xs underline"
              >
                Refresh now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!bucketCreated}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function SeedStep({
  seedContent,
  setSeedContent,
  isDev,
  isLoading,
  result,
  onSeed,
  onSimulate,
  onNext,
  onBack,
  isR2Configured,
  needsRedeploy,
}: {
  seedContent: boolean;
  setSeedContent: (value: boolean) => void;
  isDev: boolean;
  isLoading: boolean;
  result: { success: boolean; message?: string; error?: string; simulated?: boolean; hint?: string } | undefined;
  onSeed: () => void;
  onSimulate: () => void;
  onNext: () => void;
  onBack: () => void;
  isR2Configured: boolean;
  needsRedeploy: boolean;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Initial Content</h2>
      
      <p className="text-gray-300 mb-6">
        Would you like to start with sample galleries or an empty storage?
      </p>
      
      {/* Options */}
      <div className="space-y-3 mb-6">
        <label 
          className={`block p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            seedContent 
              ? "bg-blue-900/30 border-blue-600" 
              : "bg-gray-800/50 border-gray-700 hover:border-gray-600"
          }`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              checked={seedContent}
              onChange={() => setSeedContent(true)}
              className="w-4 h-4 text-blue-600"
            />
            <div>
              <span className="text-white font-medium">Copy sample galleries to R2</span>
              <p className="text-gray-400 text-sm">
                Start with demo content to explore all features
              </p>
            </div>
          </div>
        </label>
        
        <label 
          className={`block p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            !seedContent 
              ? "bg-blue-900/30 border-blue-600" 
              : "bg-gray-800/50 border-gray-700 hover:border-gray-600"
          }`}
        >
          <div className="flex items-center gap-3">
            <input
              type="radio"
              checked={!seedContent}
              onChange={() => setSeedContent(false)}
              className="w-4 h-4 text-blue-600"
            />
            <div>
              <span className="text-white font-medium">Start with empty storage</span>
              <p className="text-gray-400 text-sm">
                Create your own galleries from scratch
              </p>
            </div>
          </div>
        </label>
      </div>

      {/* Redeploy Notice */}
      {needsRedeploy && seedContent && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-6">
          <p className="text-yellow-400 text-sm">
            ⚠️ Content seeding requires the R2 binding to be active. You can seed content after redeploying,
            or skip this step for now and seed later from Settings.
          </p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`mb-6 p-4 rounded-lg ${
          result.success 
            ? result.simulated 
              ? "bg-purple-900/30 border border-purple-700"
              : "bg-green-900/30 border border-green-700" 
            : "bg-red-900/30 border border-red-700"
        }`}>
          <p className={result.success ? (result.simulated ? "text-purple-400" : "text-green-400") : "text-red-400"}>
            {result.message || result.error}
          </p>
          {result.hint && (
            <p className="text-yellow-400 text-sm mt-2">{result.hint}</p>
          )}
        </div>
      )}

      {/* Development Mode Notice */}
      {isDev && seedContent && !isR2Configured && (
        <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-purple-400 mb-2">
            <span className="text-lg">🧪</span>
            <span className="font-medium">Development Mode</span>
          </div>
          <p className="text-purple-300/70 text-sm">
            You can simulate seeding to test the complete setup flow.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <div className="flex gap-3">
          {seedContent && isR2Configured && !needsRedeploy && (
            <button
              onClick={onSeed}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg transition-colors"
            >
              {isLoading ? "Seeding..." : "Seed Now"}
            </button>
          )}
          
          {isDev && seedContent && (!isR2Configured || needsRedeploy) && (
            <button
              onClick={onSimulate}
              disabled={isLoading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white rounded-lg transition-colors"
            >
              {isLoading ? "Simulating..." : "🧪 Simulate Seed"}
            </button>
          )}
          
          <button
            onClick={onNext}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsStep({
  isLoading,
  result,
  onGenerate,
  onNext,
  onBack,
}: {
  isLoading: boolean;
  result: { success: boolean; message?: string; error?: string; generatedPassword?: string; generatedUsername?: string; credentialsSetAutomatically?: boolean } | undefined;
  onGenerate: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  
  const copyToClipboard = (text: string, type: "username" | "password") => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const hasCredentials = result?.generatedPassword && result?.generatedUsername;
  const wasAutomatic = result?.credentialsSetAutomatically;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-2">Admin Credentials</h2>
      <p className="text-gray-400 mb-6">
        Generate a secure password for your admin panel.
      </p>
      
      {!hasCredentials ? (
        <>
          <div className="bg-gray-900/50 rounded-lg p-6 mb-6 text-center">
            <div className="text-4xl mb-4">🔐</div>
            <p className="text-gray-300 mb-4">
              Click the button below to generate a secure random password and configure your admin account automatically.
            </p>
            <button
              onClick={onGenerate}
              disabled={isLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {isLoading ? "Setting up..." : "🔐 Generate & Configure Password"}
            </button>
          </div>
          
          {result?.error && (
            <div className="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-700">
              <p className="text-red-400">{result.error}</p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Success Message - different based on whether auto-configured */}
          {wasAutomatic ? (
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 mb-6">
              <p className="text-green-400 font-medium mb-1">✅ Credentials Configured Automatically!</p>
              <p className="text-green-300/70 text-sm">
                Your admin credentials have been set in Cloudflare. Save your password below - you'll need it to log in.
              </p>
            </div>
          ) : (
            <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4 mb-6">
              <p className="text-yellow-400 font-medium mb-1">⚠️ Manual Configuration Required</p>
              <p className="text-yellow-300/70 text-sm">
                Couldn't set credentials automatically. Please set them manually in Cloudflare (see instructions below).
              </p>
            </div>
          )}
          
          {/* Credentials Display */}
          <div className="space-y-4 mb-6">
            {/* Username */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-400">Username</label>
                <button
                  onClick={() => copyToClipboard(result.generatedUsername!, "username")}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
                >
                  {copied === "username" ? "✓ Copied!" : "Copy"}
                </button>
              </div>
              <code className="text-lg text-white font-mono">{result.generatedUsername}</code>
            </div>
            
            {/* Password */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-400">Password</label>
                <button
                  onClick={() => copyToClipboard(result.generatedPassword!, "password")}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
                >
                  {copied === "password" ? "✓ Copied!" : "Copy"}
                </button>
              </div>
              <code className="text-lg text-yellow-400 font-mono break-all">{result.generatedPassword}</code>
            </div>
          </div>
          
          {/* Manual Instructions - only show if NOT auto-configured */}
          {!wasAutomatic && (
            <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mb-6">
              <p className="text-blue-300 text-sm font-medium mb-2">
                📋 Set these as Cloudflare secrets:
              </p>
              <div className="bg-gray-900 rounded p-3 mb-3">
                <p className="text-xs text-gray-500 mb-1">Option 1: Via Cloudflare Dashboard</p>
                <p className="text-gray-300 text-sm">
                  Pages → Your Project → Settings → Environment Variables → Add variables
                </p>
              </div>
              <div className="bg-gray-900 rounded p-3">
                <p className="text-xs text-gray-500 mb-1">Option 2: Via CLI</p>
                <pre className="text-xs text-gray-300 overflow-x-auto">
{`wrangler pages secret put ADMIN_USERNAME
wrangler pages secret put ADMIN_PASSWORD`}
                </pre>
              </div>
            </div>
          )}
          
          {/* Warning to save password */}
          <div className="bg-orange-900/20 border border-orange-700 rounded-lg p-3 mb-6">
            <p className="text-orange-300 text-sm">
              ⚠️ <strong>Save this password now!</strong> It won't be shown again.
            </p>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!hasCredentials}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function CompleteStep({ 
  needsRedeploy, 
  deploymentTriggered,
  isLoading,
  onTriggerDeployment,
  onFinish 
}: { 
  needsRedeploy: boolean;
  deploymentTriggered: boolean;
  isLoading: boolean;
  onTriggerDeployment: () => void;
  onFinish: () => void;
}) {
  // Auto-refresh countdown after deployment is triggered
  const [countdown, setCountdown] = useState(90);
  
  useEffect(() => {
    if (deploymentTriggered) {
      const interval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            window.location.reload();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [deploymentTriggered]);

  // Show deployment in progress screen
  if (deploymentTriggered) {
    return (
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-full mb-6">
          <svg className="w-10 h-10 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-4">🚀 Deploying Your Site!</h2>
        <p className="text-blue-300 mb-6">
          Your site is being redeployed with the new R2 configuration.
          <br />
          This usually takes <strong>1-2 minutes</strong>.
        </p>
        
        <div className="bg-gray-900/50 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
          <p className="text-gray-300 text-sm font-medium mb-2">What happens next:</p>
          <ol className="text-gray-400 text-sm space-y-1 list-decimal list-inside">
            <li>This page will become unavailable shortly</li>
            <li>Wait for the deployment to complete</li>
            <li>Page will auto-refresh and redirect to admin</li>
          </ol>
        </div>
        
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Auto-refresh in</span>
            <span className="px-3 py-1 bg-gray-800 rounded text-blue-400 font-mono">
              {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
            </span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="text-blue-400 hover:text-blue-300 text-sm underline"
          >
            Refresh now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🚀</div>
      <h2 className="text-2xl font-bold text-white mb-4">Setup Complete!</h2>
      
      {needsRedeploy ? (
        <div className="space-y-4">
          <p className="text-gray-300">
            Your R2 bucket has been created and configured!
          </p>
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
            <p className="text-yellow-200 font-medium mb-2">⚠️ One More Step</p>
            <p className="text-yellow-300/80 text-sm mb-4">
              Trigger a deployment to activate the R2 binding. Your site will be unavailable for ~1-2 minutes.
            </p>
            <button
              onClick={onTriggerDeployment}
              disabled={isLoading}
              className="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {isLoading ? "Deploying..." : "🚀 Trigger Redeploy Now"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-300 mb-6">
          Your VictoPress installation is ready. You can now start managing your photo galleries.
        </p>
      )}
      
      <div className="bg-gray-900/50 rounded-lg p-4 mb-8 text-left mt-6">
        <h3 className="text-white font-medium mb-3">Next Steps</h3>
        <ul className="text-sm text-gray-300 space-y-2">
          {needsRedeploy && (
            <li className="flex items-center gap-2">
              <span className="text-yellow-400">○</span>
              Trigger a new deployment
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Create your first gallery
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Upload photos
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Customize your site settings
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            Change your password in Settings
          </li>
        </ul>
      </div>
      
      <a
        href="/admin"
        className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
      >
        Go to Admin Panel →
      </a>
    </div>
  );
}
