/**
 * Mobile Menu Component
 * 
 * Full-screen mobile menu with hamburger toggle
 */

import { Link, useLocation, useNavigate } from "@remix-run/react";
import { useEffect, useState, useMemo } from "react";
import type { NavItem } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

interface MobileMenuProps {
  siteName: string;
  navigation: NavItem[];
  socialLinks?: {
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    facebook?: string;
  };
}

export function MobileMenu({ siteName, navigation, socialLinks }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  // Find all slugs in the active path that should be expanded
  const activePathSlugs = useMemo(() => {
    const slugs: string[] = [];
    
    const findPath = (items: NavItem[], path: string[]): boolean => {
      for (const item of items) {
        const currentPath = [...path, item.slug];
        
        if (location.pathname === item.path || location.pathname.startsWith(item.path + "/")) {
          slugs.push(...currentPath);
          
          if (item.children && item.children.length > 0) {
            findPath(item.children, currentPath);
          }
          return true;
        }
        
        if (item.children && item.children.length > 0) {
          if (findPath(item.children, currentPath)) {
            return true;
          }
        }
      }
      return false;
    };
    
    findPath(navigation, []);
    return slugs;
  }, [location.pathname, navigation]);

  const [expandedItems, setExpandedItems] = useState<string[]>(() => activePathSlugs);

  // Update expanded items when route changes
  useEffect(() => {
    setExpandedItems((prev) => {
      const newExpanded = new Set(prev);
      activePathSlugs.forEach(slug => newExpanded.add(slug));
      return Array.from(newExpanded);
    });
  }, [activePathSlugs]);

  // Prevent background scrolling when the menu is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Toggle expand/collapse for a specific item (accordion behavior at root level)
  const toggleExpanded = (slug: string) => {
    setExpandedItems((prev) => {
      if (prev.includes(slug)) {
        return prev.filter(s => !s.startsWith(slug));
      } else {
        // Open this item - close siblings at root level (accordion)
        const isRootLevel = !slug.includes("/");
        if (isRootLevel) {
          // Close all other root-level items and their descendants
          const rootSlugs = navigation.map(n => n.slug);
          const filtered = prev.filter(s => {
            const sRoot = s.split("/")[0];
            return !rootSlugs.includes(sRoot) || sRoot === slug.split("/")[0];
          });
          return [...filtered, slug];
        } else {
          return [...prev, slug];
        }
      }
    });
  };
  
  // Collapse descendants of a slug but keep the slug itself expanded
  const collapseDescendants = (slug: string) => {
    setExpandedItems((prev) => {
      return prev.filter(s => s === slug || !s.startsWith(slug + "/"));
    });
  };
  
  const collapseAll = () => {
    setExpandedItems([]);
  };

  return (
    <>
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white dark:bg-gray-950 border-b border-gray-100 dark:border-gray-900 z-50 flex items-center justify-between px-6 lg:hidden">
        <Link to="/" className="font-bold text-lg">
          {siteName}
        </Link>
        <button
          onClick={() => setIsOpen(true)}
          className="p-2 -mr-2"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-white dark:bg-gray-950 z-[100] lg:hidden overflow-y-auto">
          {/* Header - matches the mobile header exactly */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-800">
            <Link 
              to="/" 
              className="font-bold text-lg"
              onClick={() => setIsOpen(false)}
            >
              {siteName}
            </Link>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 -mr-2"
              aria-label="Close menu"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Navigation */}
          <nav className="px-6 py-8 space-y-2">
            {navigation.map((item) => (
              <MobileNavSection
                key={item.slug}
                item={item}
                currentPath={location.pathname}
                expandedItems={expandedItems}
                onToggle={toggleExpanded}
                onCollapseAll={collapseAll}
                onCollapseDescendants={collapseDescendants}
                onNavigate={() => setIsOpen(false)}
                depth={0}
              />
            ))}

            {/* Static Links */}
            <div className="space-y-2 pt-6 mt-2">
              <MobileNavLink href="/blog" currentPath={location.pathname} onClick={() => setIsOpen(false)}>
                Blog
              </MobileNavLink>
              <MobileNavLink href="/about" currentPath={location.pathname} onClick={() => setIsOpen(false)}>
                About Me
              </MobileNavLink>
              <MobileNavLink href="/contact" currentPath={location.pathname} onClick={() => setIsOpen(false)}>
                Contact
              </MobileNavLink>
            </div>
          </nav>

          {/* Social Links + Theme Toggle */}
          <div className="px-6 py-8 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-6">
              {socialLinks?.instagram && (
                <a
                  href={socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400"
                  aria-label="Instagram"
                >
                  <InstagramIcon />
                </a>
              )}
              {socialLinks?.twitter && (
                <a
                  href={socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400"
                  aria-label="Twitter"
                >
                  <TwitterIcon />
                </a>
              )}
              {socialLinks?.linkedin && (
                <a
                  href={socialLinks.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400"
                  aria-label="LinkedIn"
                >
                  <LinkedInIcon />
                </a>
              )}
              {/* Theme Toggle */}
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileNavSection({
  item,
  currentPath,
  expandedItems,
  onToggle,
  onCollapseAll,
  onCollapseDescendants,
  onNavigate,
  depth,
}: {
  item: NavItem;
  currentPath: string;
  expandedItems: string[];
  onToggle: (slug: string) => void;
  onCollapseAll: () => void;
  onCollapseDescendants: (slug: string) => void;
  onNavigate: () => void;
  depth: number;
}) {
  const navigate = useNavigate();
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedItems.includes(item.slug);
  const isExactMatch = currentPath === item.path;
  const isInPath = currentPath === item.path || currentPath.startsWith(item.path + "/");
  
  // Check if any descendants are expanded
  const hasExpandedDescendants = expandedItems.some(
    s => s !== item.slug && s.startsWith(item.slug + "/")
  );

  const handleClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      if (isExpanded && depth === 0 && !hasExpandedDescendants) {
        // Top-level expanded item with no expanded descendants - collapse all and go home
        e.preventDefault();
        onCollapseAll();
        navigate("/");
        onNavigate();
      } else if (isExpanded && hasExpandedDescendants) {
        // Already expanded with expanded descendants - collapse descendants only
        onCollapseDescendants(item.slug);
        onNavigate();
      } else if (!isExpanded) {
        // Not expanded - expand this item (navigation happens via Link)
        onToggle(item.slug);
        onNavigate();
      } else {
        // Expanded at top level with no descendants - just navigate and close menu
        onNavigate();
      }
    } else {
      onNavigate();
    }
  };

  // Determine text color based on state
  const getTextColor = () => {
    if (isExactMatch) {
      return "text-black dark:text-white font-bold";
    }
    if (isInPath && hasChildren && isExpanded) {
      return "text-gray-400";
    }
    if (isInPath) {
      return "text-black dark:text-white font-bold";
    }
    return depth > 0 ? "text-gray-400" : "text-black dark:text-white";
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Link
          to={item.path}
          onClick={handleClick}
          prefetch="intent"
          className={`
            text-[15px] font-medium leading-[24px] transition-colors
            ${getTextColor()}
            hover:text-black dark:hover:text-white
          `}
        >
          {item.title}
        </Link>
        {hasChildren && (
          <button
            onClick={() => onToggle(item.slug)}
            className="p-1 text-gray-400"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronIcon className={`transform transition-transform ${isExpanded ? "rotate-90" : ""}`} />
          </button>
        )}
      </div>

      {/* Children - recursively render when expanded */}
      {hasChildren && isExpanded && (
        <div className="pl-4 space-y-1">
          {item.children!.map((child) => (
            <MobileNavSection
              key={child.slug}
              item={child}
              currentPath={currentPath}
              expandedItems={expandedItems}
              onToggle={onToggle}
              onCollapseAll={onCollapseAll}
              onCollapseDescendants={onCollapseDescendants}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileNavLink({
  href,
  currentPath,
  onClick,
  children,
}: {
  href: string;
  currentPath: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const isActive = currentPath === href || currentPath.startsWith(href + "/");
  
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`
        block text-xs transition-colors
        ${isActive ? "text-black font-bold dark:text-white" : "text-gray-400"}
        hover:text-black dark:hover:text-white
      `}
    >
      {children}
    </Link>
  );
}

// Icons
function HamburgerIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
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

function InstagramIcon() {
  return (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

