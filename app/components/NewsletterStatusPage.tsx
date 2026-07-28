import { Link } from "@remix-run/react";

export function NewsletterStatusPage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f3] px-5 py-12 dark:bg-gray-950">
      <div className="w-full max-w-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-12">
        <Link
          to="/blog"
          className="mb-8 inline-block text-sm font-semibold tracking-wide text-gray-900 dark:text-white"
        >
          Victoriano Izquierdo
        </Link>
        <h1 className="mb-4 font-['Proxima_Nova_Title','Proxima_Nova',sans-serif] text-3xl font-medium text-gray-950 dark:text-white">
          {title}
        </h1>
        <p className="mx-auto max-w-md text-base leading-7 text-gray-600 dark:text-gray-300">
          {description}
        </p>
        {action && <div className="mt-8">{action}</div>}
      </div>
    </main>
  );
}
