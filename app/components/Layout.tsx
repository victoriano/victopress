/**
 * Main Layout Component
 * 
 * Portfolio layout with fixed sidebar (desktop) and hamburger menu (mobile)
 */

import { Link } from "@remix-run/react";
import { Sidebar, type NavItem, type PhotoNavigation } from "./Sidebar";
import { MobileMenu } from "./MobileMenu";

interface LayoutProps {
  children: React.ReactNode;
  navigation: NavItem[];
  siteName?: string;
  socialLinks?: {
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    facebook?: string;
  };
  photoNav?: PhotoNavigation;
}

export function Layout({
  children,
  navigation,
  siteName = "VictoPress",
  socialLinks,
  photoNav,
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className="hidden lg:block">
        <Sidebar
          siteName={siteName}
          navigation={navigation}
          socialLinks={socialLinks}
          photoNav={photoNav}
        />
      </div>

      {/* Mobile Menu - hidden on desktop */}
      <div className="lg:hidden">
        <MobileMenu
          siteName={siteName}
          navigation={navigation}
          socialLinks={socialLinks}
        />
      </div>
      
      {/* Main Content - offset by sidebar width on desktop, with top padding on mobile */}
      <main className="lg:ml-56 min-h-screen pt-16 lg:pt-0">
        {children}
      </main>
    </div>
  );
}

/**
 * Photo Grid Component - responsive
 */
export function PhotoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 p-1">
      {children}
    </div>
  );
}

/**
 * Photo Item for the grid
 */
export function PhotoItem({
  src,
  alt,
  aspectRatio = "auto",
  href,
  onClick,
}: {
  src: string;
  alt: string;
  aspectRatio?: "auto" | "square" | "portrait" | "landscape";
  href?: string;
  onClick?: () => void;
}) {
  const aspectClasses = {
    auto: "",
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    landscape: "aspect-[4/3]",
  };

  const className = `
    relative overflow-hidden bg-gray-100 dark:bg-gray-900
    ${aspectClasses[aspectRatio]}
    group cursor-pointer block
  `;

  const image = (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      loading="lazy"
    />
  );

  if (href) {
    return (
      <Link to={href} className={className}>
        {image}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {image}
    </button>
  );
}
