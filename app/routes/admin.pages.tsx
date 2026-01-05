/**
 * Admin - Pages List
 * 
 * GET /admin/pages
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Add isHtml property based on path
  const pages = contentIndex.pages.map(page => ({
    ...page,
    isHtml: page.path.endsWith('.html'),
  }));
  
  return json({ username, pages });
}

export default function AdminPages() {
  const { username, pages } = useLoaderData<typeof loader>();

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pages</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {pages.length} static pages
            </p>
          </div>
        </div>

        {/* Pages List */}
        {pages.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <PageIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No pages yet</h3>
            <p className="text-gray-500 dark:text-gray-400">
              Create pages in the <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/pages</code> folder
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                    Slug
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
                    Type
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pages.map((page) => (
                  <tr key={page.slug} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {page.title}
                        </p>
                        {page.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                            {page.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        /{page.slug}
                      </span>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                        page.isHtml
                          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200"
                          : "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
                      }`}>
                        {page.isHtml ? "HTML" : "Markdown"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        to={`/${page.slug}`}
                        target="_blank"
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 inline-block"
                        title="View"
                      >
                        <ExternalIcon />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Help */}
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">How to create pages</h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Create a folder in <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">content/pages/</code> with either an <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">index.md</code> (Markdown) or <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">index.html</code> (HTML) file.
            Add a <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">style.css</code> file for custom styling.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}

// Icons
function PageIcon() {
  return (
    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
