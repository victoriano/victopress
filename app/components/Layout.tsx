/**
 * Main Layout Component
 * 
 * Portfolio layout with fixed sidebar and content area
 */

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
  onClick,
}: {
  src: string;
  alt: string;
  aspectRatio?: "auto" | "square" | "portrait" | "landscape";
  onClick?: () => void;
}) {
  const aspectClasses = {
    auto: "",
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    landscape: "aspect-[4/3]",
  };

  return (
    <button
      onClick={onClick}
      className={`
        relative overflow-hidden bg-gray-100 dark:bg-gray-900
        ${aspectClasses[aspectRatio]}
        group cursor-pointer
      `}
    >
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
      />
    </button>
  );
}
