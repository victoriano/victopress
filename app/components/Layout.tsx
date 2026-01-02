/**
 * Main Layout Component
 * 
 * Portfolio layout with fixed sidebar and content area
 */

import { Link } from "@remix-run/react";
import { Sidebar, type NavItem } from "./Sidebar";

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
}

export function Layout({
  children,
  navigation,
  siteName = "VictoPress",
  socialLinks,
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <Sidebar
        siteName={siteName}
        navigation={navigation}
        socialLinks={socialLinks}
      />
      
      {/* Main Content - offset by sidebar width */}
      <main className="ml-56 min-h-screen">
        {children}
      </main>
    </div>
  );
}

/**
 * Photo Grid Component
 */
export function PhotoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 p-1">
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
