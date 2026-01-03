/**
 * Demo Mode Banner
 * 
 * Shows a warning banner when the site is running in demo mode
 * (no R2 storage configured).
 */

import { Link } from "@remix-run/react";

interface DemoModeBannerProps {
  className?: string;
}

export function DemoModeBanner({ className = "" }: DemoModeBannerProps) {
  return (
    <div className={`bg-yellow-500 text-yellow-900 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="text-sm font-medium">
            <strong>Demo Mode:</strong> Running with sample content. 
            <span className="hidden sm:inline"> Configure R2 storage to enable full CMS functionality.</span>
          </span>
        </div>
        <Link
          to="/admin/setup"
          className="px-3 py-1 bg-yellow-900 text-yellow-100 text-sm font-medium rounded hover:bg-yellow-800 transition-colors whitespace-nowrap"
        >
          Setup R2 →
        </Link>
      </div>
    </div>
  );
}

/**
 * Compact demo mode indicator for sidebar or smaller spaces
 */
export function DemoModeIndicator() {
  return (
    <Link
      to="/admin/setup"
      className="flex items-center gap-2 px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-lg text-sm hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors"
    >
      <span>⚠️</span>
      <span className="font-medium">Demo Mode</span>
    </Link>
  );
}
