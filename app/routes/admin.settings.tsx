/**
 * Admin - Settings
 * 
 * GET /admin/settings
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { scanGalleries, scanBlog, scanPages, getStorage } from "~/lib/content-engine";

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  const [galleries, posts, pages] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
    scanPages(storage),
  ]);
  
  const totalPhotos = galleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  return json({
    username,
    stats: {
      galleries: galleries.length,
      photos: totalPhotos,
      posts: posts.length,
      pages: pages.length,
    },
    env: {
      hasAdminCredentials: !!(context.cloudflare?.env as any)?.ADMIN_USERNAME,
      hasR2Bucket: !!(context.cloudflare?.env as any)?.CONTENT_BUCKET,
    },
  });
}

export default function AdminSettings() {
  const { username, stats, env } = useLoaderData<typeof loader>();

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Site configuration and information
          </p>
        </div>

        {/* Site Info */}
        <Section title="Site Information">
          <InfoRow label="Site Name" value="VictoPress" />
          <InfoRow label="Version" value="0.1.0" />
        </Section>

        {/* Content Stats */}
        <Section title="Content Statistics">
          <InfoRow label="Galleries" value={stats.galleries.toString()} />
          <InfoRow label="Photos" value={stats.photos.toString()} />
          <InfoRow label="Blog Posts" value={stats.posts.toString()} />
          <InfoRow label="Pages" value={stats.pages.toString()} />
        </Section>

        {/* Environment */}
        <Section title="Environment">
          <InfoRow 
            label="Admin Auth" 
            value={env.hasAdminCredentials ? "Configured" : "Dev Mode (localhost bypass)"} 
            status={env.hasAdminCredentials ? "success" : "warning"}
          />
          <InfoRow 
            label="R2 Storage" 
            value={env.hasR2Bucket ? "Connected" : "Using Local Storage"} 
            status={env.hasR2Bucket ? "success" : "info"}
          />
        </Section>

        {/* File Structure */}
        <Section title="Content Structure">
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/galleries/</code> - Photo galleries</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/blog/</code> - Blog posts</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/pages/</code> - Static pages</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/home.yaml</code> - Homepage config</p>
          </div>
        </Section>

        {/* Documentation */}
        <Section title="Documentation">
          <div className="space-y-3">
            <a 
              href="https://www.notion.so/2dc358038bc5806e8d7bdd5649e4cef2" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Project Home (Notion)
            </a>
            <a 
              href="https://www.notion.so/1dd18ac214874a9da121897a495adc1d" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Architecture Documentation
            </a>
            <a 
              href="https://www.notion.so/2cfda3d4e02c42cd91b5b1850381329a" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Roadmap
            </a>
          </div>
        </Section>
      </div>
    </AdminLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{title}</h2>
      <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        {children}
      </div>
    </div>
  );
}

function InfoRow({ 
  label, 
  value, 
  status 
}: { 
  label: string; 
  value: string; 
  status?: "success" | "warning" | "info" | "error";
}) {
  const statusColors = {
    success: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
    error: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className={`font-medium ${status ? statusColors[status] : "text-gray-900 dark:text-white"}`}>
        {value}
      </span>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
