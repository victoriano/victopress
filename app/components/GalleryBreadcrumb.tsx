/**
 * Gallery Breadcrumb Component (Mobile)
 * 
 * Shows hierarchical navigation with dropdowns for sibling galleries.
 * Only visible on mobile devices.
 */

import { Link } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { NavItem } from "./Sidebar";

interface GalleryBreadcrumbProps {
  currentSlug?: string;
  navigation: NavItem[];
}

// Static page links to show in the root dropdown
const STATIC_PAGES: NavItem[] = [
  { title: "Blog", slug: "blog", path: "/blog" },
  { title: "About Me", slug: "about", path: "/about" },
  { title: "Contact", slug: "contact", path: "/contact" },
];

interface BreadcrumbSegment {
  title: string;
  slug: string;
  path: string;
  children: NavItem[]; // Next level galleries to discover
}

export function GalleryBreadcrumb({ currentSlug, navigation }: GalleryBreadcrumbProps) {
  const segments = currentSlug ? buildBreadcrumb(currentSlug, navigation) : [];
  
  // Create root segment with galleries only
  const rootSegment: BreadcrumbSegment = {
    title: "PHOTOS",
    slug: "",
    path: "/",
    children: navigation,
  };

  const isRootPage = !currentSlug || segments.length === 0;

  return (
    <nav className="lg:hidden sticky top-16 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {/* Root "PHOTOS" with dropdown */}
        <BreadcrumbItem
          segment={rootSegment}
          isLast={isRootPage && segments.length === 0}
          isRoot={true}
        />
        
        {/* Gallery path segments */}
        {segments.map((segment, index) => (
          <BreadcrumbItem
            key={segment.slug}
            segment={segment}
            isLast={index === segments.length - 1}
          />
        ))}

        {/* Static page links - same level as PHOTOS */}
        {isRootPage && (
          <>
            {STATIC_PAGES.map((page) => (
              <Link
                key={page.slug}
                to={page.path}
                className="shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors py-1 px-2"
              >
                {page.title}
              </Link>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}

function BreadcrumbItem({ 
  segment, 
  isLast,
  isRoot = false,
}: { 
  segment: BreadcrumbSegment; 
  isLast: boolean;
  isRoot?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Track if we're mounted (for portal)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    // Small delay to prevent immediate close on the same tap
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const hasChildren = segment.children.length > 0;

  const handleOpen = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 192)),
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Separator - not shown for root */}
      {!isRoot && <ChevronRightIcon className="text-gray-300 dark:text-gray-600" />}
      
      {/* Segment with dropdown */}
      <div className="relative">
        {hasChildren ? (
          <>
            <button
              ref={buttonRef}
              type="button"
              onClick={handleOpen}
              className={`
                flex items-center gap-1 text-sm font-medium transition-colors py-1 px-2
                ${isRoot
                  ? "text-gray-500 dark:text-gray-400 uppercase tracking-wide text-xs"
                  : isLast 
                    ? "text-black dark:text-white" 
                    : "text-gray-600 dark:text-gray-400"
                }
              `}
            >
              <span className={isRoot ? "" : "max-w-[120px] truncate"}>{segment.title}</span>
              <ChevronDownIcon className={`transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
            </button>
            
            {/* Dropdown - rendered via portal to escape overflow constraints */}
            {isOpen && mounted && typeof document !== 'undefined' && createPortal(
              <div
                ref={dropdownRef}
                className="fixed min-w-[180px] max-h-[50vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1"
                style={{
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  zIndex: 9999,
                }}
              >
                {segment.children.map((child) => (
                  <Link
                    key={child.slug}
                    to={child.path}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                    }}
                    className="block px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    {child.title}
                  </Link>
                ))}
              </div>,
              document.body
            )}
          </>
        ) : (
          <Link
            to={segment.path}
            className={`
              text-sm font-medium transition-colors max-w-[120px] truncate block py-1
              ${isLast 
                ? "text-black dark:text-white" 
                : "text-gray-600 dark:text-gray-400"
              }
            `}
          >
            {segment.title}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Build breadcrumb segments from current slug and navigation tree
 * Each segment includes its children (next level) for discovery
 */
function buildBreadcrumb(currentSlug: string, navigation: NavItem[]): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];
  const slugParts = currentSlug.split("/");
  
  let currentLevel = navigation;
  let accumulatedSlug = "";
  
  for (let i = 0; i < slugParts.length; i++) {
    const part = slugParts[i];
    accumulatedSlug = accumulatedSlug ? `${accumulatedSlug}/${part}` : part;
    
    // Find the item at this level
    const item = currentLevel.find((nav) => nav.slug === accumulatedSlug);
    
    if (item) {
      segments.push({
        title: item.title,
        slug: item.slug,
        path: item.path,
        children: item.children || [], // Show children for discovery
      });
      
      // Move to children for next iteration
      currentLevel = item.children || [];
    } else {
      // Item not found in navigation, create a basic segment
      const title = part.charAt(0).toUpperCase() + part.slice(1);
      segments.push({
        title,
        slug: accumulatedSlug,
        path: `/gallery/${accumulatedSlug}`,
        children: [],
      });
      break;
    }
  }
  
  return segments;
}

// Icons
function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
