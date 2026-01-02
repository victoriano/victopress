/**
 * Sidebar Navigation Component
 * 
 * Fixed sidebar with hierarchical navigation like victoriano.me
 */

import { Link, useLocation } from "@remix-run/react";

export interface NavItem {
  title: string;
  slug: string;
  path: string;
  children?: NavItem[];
}

interface SidebarProps {
  siteName: string;
  navigation: NavItem[];
  socialLinks?: {
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    facebook?: string;
  };
}

export function Sidebar({ siteName, navigation, socialLinks }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-56 flex-col justify-between p-8 bg-white dark:bg-gray-950 border-r border-gray-100 dark:border-gray-900 z-50">
      {/* Site Name */}
      <div>
        <Link to="/" className="block mb-10">
          <h1 className="text-xl font-bold leading-tight tracking-tight">
            {siteName.split(" ").map((word, i) => (
              <span key={i} className="block">
                {word}
              </span>
            ))}
          </h1>
        </Link>

        {/* Navigation */}
        <nav className="space-y-6">
          {navigation.map((item) => (
            <NavSection
              key={item.slug}
              item={item}
              currentPath={location.pathname}
            />
          ))}

          {/* Static Links */}
          <div className="space-y-2 pt-4 border-t border-gray-100 dark:border-gray-800">
            <NavLink href="/blog" currentPath={location.pathname}>
              Blog
            </NavLink>
            <NavLink href="/about" currentPath={location.pathname}>
              About Me
            </NavLink>
            <NavLink href="/contact" currentPath={location.pathname}>
              Contact
            </NavLink>
          </div>
        </nav>
      </div>

      {/* Social Links */}
      {socialLinks && (
        <div className="flex gap-4">
          {socialLinks.instagram && (
            <a
              href={socialLinks.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              aria-label="Instagram"
            >
              <InstagramIcon />
            </a>
          )}
          {socialLinks.twitter && (
            <a
              href={socialLinks.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              aria-label="Twitter"
            >
              <TwitterIcon />
            </a>
          )}
          {socialLinks.linkedin && (
            <a
              href={socialLinks.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              aria-label="LinkedIn"
            >
              <LinkedInIcon />
            </a>
          )}
        </div>
      )}
    </aside>
  );
}

function NavSection({
  item,
  currentPath,
}: {
  item: NavItem;
  currentPath: string;
}) {
  const isActive =
    currentPath === item.path ||
    currentPath.startsWith(item.path + "/") ||
    item.children?.some(
      (child) =>
        currentPath === child.path || currentPath.startsWith(child.path + "/")
    );

  return (
    <div className="space-y-1">
      <NavLink
        href={item.path}
        currentPath={currentPath}
        isParent={!!item.children?.length}
        isParentActive={isActive}
      >
        {item.title}
      </NavLink>

      {item.children && item.children.length > 0 && (
        <div className="pl-3 space-y-1">
          {item.children.map((child) => (
            <NavLink
              key={child.slug}
              href={child.path}
              currentPath={currentPath}
              isChild
            >
              {child.title}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({
  href,
  currentPath,
  isParent,
  isParentActive,
  isChild,
  children,
}: {
  href: string;
  currentPath: string;
  isParent?: boolean;
  isParentActive?: boolean;
  isChild?: boolean;
  children: React.ReactNode;
}) {
  const isActive = currentPath === href || currentPath.startsWith(href + "/");

  return (
    <Link
      to={href}
      className={`
        block text-sm font-medium transition-colors
        ${isChild ? "text-gray-500 dark:text-gray-500 !font-normal" : ""}
        ${isActive ? "text-gray-900 dark:text-white !font-semibold" : ""}
        ${!isActive && !isChild ? "text-gray-600 dark:text-gray-400" : ""}
        ${isParentActive && isParent ? "text-gray-500 dark:text-gray-500" : ""}
        hover:text-gray-900 dark:hover:text-white
      `}
    >
      {children}
    </Link>
  );
}

// Icons
function InstagramIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

