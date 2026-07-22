/**
 * Main Layout Component
 * 
 * Portfolio layout with fixed sidebar (desktop) and hamburger menu (mobile)
 */

import { Link, useRouteLoaderData } from "@remix-run/react";
import { Sidebar, type NavItem, type PhotoNavigation } from "./Sidebar";
import { MobileMenu } from "./MobileMenu";
import { OptimizedImage } from "./OptimizedImage";
import type { Locale } from "~/lib/i18n";

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
  locale: Locale;
}

export function Layout({
  children,
  navigation,
  siteName = "VictoPress",
  socialLinks,
  photoNav,
  locale,
}: LayoutProps) {
  const rootData = useRouteLoaderData<{
    photoAiEnabled?: boolean;
    siteLanguages?: { multilingual?: boolean };
  }>("root");
  const photoAiEnabled = rootData?.photoAiEnabled === true;
  const multilingual = rootData?.siteLanguages?.multilingual === true;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className="hidden lg:block">
        <Sidebar
          siteName={siteName}
          navigation={navigation}
          socialLinks={socialLinks}
          photoNav={photoNav}
          photoAiEnabled={photoAiEnabled}
          multilingual={multilingual}
          locale={locale}
        />
      </div>

      {/* Mobile Menu - hidden on desktop */}
      <div className="lg:hidden">
        <MobileMenu
          siteName={siteName}
          navigation={navigation}
          socialLinks={socialLinks}
          photoAiEnabled={photoAiEnabled}
          multilingual={multilingual}
          locale={locale}
        />
      </div>
      
      {/* Main Content - offset by sidebar width on desktop, with top padding on mobile */}
      <main className="lg:ml-64 min-h-screen pt-16 lg:pt-0">
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
  width,
  height,
  aspectRatio = "auto",
  href,
  onClick,
  priority = false,
}: {
  src: string;
  alt: string;
  /** Intrinsic dimensions from EXIF, used to reserve space before download. */
  width?: number;
  height?: number;
  aspectRatio?: "auto" | "square" | "portrait" | "landscape";
  href?: string;
  onClick?: () => void;
  /** Priority loading for above-the-fold images */
  priority?: boolean;
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

  // Responsive sizes for grid layout
  const sizes =
    "(min-width: 1024px) calc((100vw - 17rem) / 4), " +
    "(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw";

  const image = (
    <OptimizedImage
      src={src}
      alt={alt}
      width={width}
      height={height}
      className="w-full h-full transition-transform duration-500 group-hover:scale-105"
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      priority={priority}
    />
  );

  if (href) {
    return (
      <Link to={href} prefetch="intent" className={className}>
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
