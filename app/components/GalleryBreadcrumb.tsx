/**
 * Gallery Breadcrumb Component (Mobile)
 * 
 * Shows hierarchical navigation with dropdowns for sibling galleries.
 * Only visible on mobile devices.
 */

import { Link } from "@remix-run/react";
import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { personalSiteSectionHref } from "./PersonalSiteNavLinks";
import type { NavItem } from "./Sidebar";
import { localizedPath, photoMessages, type Locale } from "~/lib/i18n";

interface GalleryBreadcrumbProps {
  currentSlug?: string;
  navigation: NavItem[];
  locale: Locale;
}

export interface BreadcrumbSegment {
  title: string;
  slug: string;
  path: string;
  options: NavItem[];
  selectedOptionSlug?: string;
}

export function GalleryBreadcrumb({ currentSlug, navigation, locale }: GalleryBreadcrumbProps) {
  const messages = photoMessages[locale];
  const segments = currentSlug ? buildBreadcrumbSegments(currentSlug, navigation, locale) : [];
  const staticPages = [
    {
      title: messages.blog,
      slug: "blog",
      path: localizedPath(locale, "/blog"),
      external: false,
    },
    {
      title: messages.about,
      slug: "about",
      path: personalSiteSectionHref(locale, "about"),
      external: true,
    },
    {
      title: messages.contact,
      slug: "contact",
      path: personalSiteSectionHref(locale, "contact"),
      external: true,
    },
  ];
  
  // Create root segment with galleries only.
  const rootSegment: BreadcrumbSegment = {
    title: locale === "es" ? "FOTOS" : "PHOTOS",
    slug: "",
    path: localizedPath(locale, "/"),
    options: navigation,
    selectedOptionSlug: segments[0]?.slug,
  };

  const isRootPage = !currentSlug || segments.length === 0;

  return (
    <nav
      aria-label={locale === "es" ? "Navegación de galerías" : "Gallery navigation"}
      className="lg:hidden sticky top-16 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800"
    >
      <div className="flex items-center gap-2 px-4 py-1 overflow-x-auto scrollbar-hide">
        {/* Root "PHOTOS" with dropdown */}
        <BreadcrumbItem
          segment={rootSegment}
          isLast={isRootPage && segments.length === 0}
          isRoot={true}
          locale={locale}
        />
        
        {/* Gallery path segments */}
        {segments.map((segment, index) => (
          <BreadcrumbItem
            key={segment.slug}
            segment={segment}
            isLast={index === segments.length - 1}
            locale={locale}
          />
        ))}

        {/* Static page links - same level as PHOTOS */}
        {isRootPage && (
          <>
            {staticPages.map((page) => {
              const className =
                "shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 rounded-md transition-colors py-3 px-2";

              return page.external ? (
                <a key={page.slug} href={page.path} className={className}>
                  {page.title}
                </a>
              ) : (
                <Link
                  key={page.slug}
                  to={page.path}
                  className={className}
                >
                  {page.title}
                </Link>
              );
            })}
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
  locale,
}: { 
  segment: BreadcrumbSegment; 
  isLast: boolean;
  isRoot?: boolean;
  locale: Locale;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const dropdownId = useId();

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    // Small delay to prevent immediate close on the same tap
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const hasOptions = segment.options.length > 0;

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
        {hasOptions ? (
          <>
            <button
              ref={buttonRef}
              type="button"
              onClick={handleOpen}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              aria-controls={isOpen ? dropdownId : undefined}
              aria-label={`${locale === "es" ? "Elegir galería" : "Choose gallery"}: ${segment.title}`}
              className={`
                flex items-center gap-1 text-sm font-medium transition-colors py-3 px-2 rounded-md
                hover:bg-gray-100/70 dark:hover:bg-gray-900
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950
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
                id={dropdownId}
                ref={dropdownRef}
                role="menu"
                aria-label={`${locale === "es" ? "Opciones de" : "Options for"} ${segment.title}`}
                className="fixed min-w-[180px] max-h-[50vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1"
                style={{
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  zIndex: 9999,
                }}
              >
                {segment.options.map((option) => {
                  const isSelected = option.slug === segment.selectedOptionSlug;

                  return (
                    <Link
                      key={option.slug}
                      to={option.path}
                      role="menuitem"
                      aria-current={isSelected ? "page" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                      }}
                      className={`flex min-h-11 items-center justify-between gap-4 px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${
                        isSelected
                          ? "bg-gray-50 text-black dark:bg-gray-800 dark:text-white"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span>{option.title}</span>
                      {isSelected && <CheckIcon className="shrink-0 text-gray-500 dark:text-gray-400" />}
                    </Link>
                  );
                })}
              </div>,
              document.body
            )}
          </>
        ) : (
          <Link
            to={segment.path}
            className={`
              text-sm font-medium transition-colors max-w-[120px] truncate block py-3 px-2 rounded-md
              hover:bg-gray-100/70 dark:hover:bg-gray-900
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950
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
 * Build breadcrumb segments from the current slug and navigation tree.
 *
 * The active gallery is represented at its actual depth. When it has children,
 * a synthetic "All" segment makes that next level visible immediately. Selecting
 * a child replaces "All" while keeping "All" and its siblings in the dropdown.
 */
export function buildBreadcrumbSegments(
  currentSlug: string,
  navigation: NavItem[],
  locale: Locale,
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];
  const slugParts = currentSlug.split("/");
  const allTitle = locale === "es" ? "Todas" : "All";
  
  let currentLevel = navigation;
  let accumulatedSlug = "";
  let parentItem: NavItem | undefined;
  let lastItem: NavItem | undefined;
  
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
        options: parentItem
          ? [
              {
                title: allTitle,
                slug: parentItem.slug,
                path: parentItem.path,
              },
              ...currentLevel,
            ]
          : [],
        selectedOptionSlug: item.slug,
      });
      
      // Move to children for next iteration
      parentItem = item;
      lastItem = item;
      currentLevel = item.children || [];
    } else {
      // Item not found in navigation, create a basic segment
      const title = part.charAt(0).toUpperCase() + part.slice(1);
      segments.push({
        title,
        slug: accumulatedSlug,
        path: localizedPath(locale, `/gallery/${accumulatedSlug}`),
        options: parentItem
          ? [
              {
                title: allTitle,
                slug: parentItem.slug,
                path: parentItem.path,
              },
              ...currentLevel,
            ]
          : [],
        selectedOptionSlug: accumulatedSlug,
      });
      lastItem = undefined;
      break;
    }
  }

  if (lastItem?.children?.length) {
    segments.push({
      title: allTitle,
      slug: `${lastItem.slug}::__all__`,
      path: lastItem.path,
      options: [
        {
          title: allTitle,
          slug: lastItem.slug,
          path: lastItem.path,
        },
        ...lastItem.children,
      ],
      selectedOptionSlug: lastItem.slug,
    });
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

function CheckIcon({ className }: { className?: string }) {
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
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
