/**
 * Main Layout Component
 * 
 * Portfolio layout with fixed sidebar (desktop) and hamburger menu (mobile)
 */

import { Link, useRouteLoaderData } from "@remix-run/react";
import { Children, useEffect, useRef } from "react";
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
const photoGridSpacing = {
  // Keep the gallery rhythm in the rendered markup. A resumed Vite tab can
  // retain an older Tailwind build while still accepting the component HMR.
  gap: "clamp(0.625rem, calc(3.125rem - 3.90625vw), 1.25rem)",
  padding: "clamp(1.25rem, calc(-2.5rem + 7.8125vw), 2.5rem)",
} as const;

export function PhotoGrid({
  children,
  layout = "3:2",
}: {
  children: React.ReactNode;
  layout?: "3:2" | "original";
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const childCount = Children.count(children);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const items = Array.from(grid.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );

    const resetItemLayout = () => {
      for (const item of items) {
        item.style.removeProperty("height");
        item.style.removeProperty("grid-row-end");
      }
    };

    if (layout !== "original") {
      resetItemLayout();
      return;
    }

    // CSS Grid normally gives every item in a row the height of its tallest
    // neighbour. Original-ratio galleries need independent row endings, so a
    // fine-grained implicit grid lets each image occupy its own natural span.
    grid.style.gridAutoFlow = "dense";
    grid.style.gridAutoRows = "1px";
    grid.style.rowGap = "0px";

    let animationFrame: number | undefined;
    let lastMeasuredWidth = -1;

    const arrangeItems = () => {
      const gridStyles = window.getComputedStyle(grid);
      const visualGap = Number.parseFloat(gridStyles.columnGap) || 0;
      const rowHeight = Number.parseFloat(gridStyles.gridAutoRows) || 1;
      const parsedPackingGap = Number.parseFloat(gridStyles.rowGap);
      const packingGap = Number.isFinite(parsedPackingGap)
        ? parsedPackingGap
        : 0;

      for (const item of items) {
        const image = item.querySelector("img");
        const sourceWidth =
          Number.parseFloat(item.dataset.photoWidth || "") ||
          image?.naturalWidth ||
          3;
        const sourceHeight =
          Number.parseFloat(item.dataset.photoHeight || "") ||
          image?.naturalHeight ||
          2;
        const itemWidth = item.getBoundingClientRect().width;
        const itemHeight = itemWidth * (sourceHeight / sourceWidth);
        const rowSpan = Math.max(
          1,
          Math.ceil((itemHeight + visualGap) / (rowHeight + packingGap)),
        );

        item.style.height = `${itemHeight}px`;
        item.style.gridRowEnd = `span ${rowSpan}`;
      }
    };

    const scheduleArrangement = (force = false) => {
      const measuredWidth = grid.getBoundingClientRect().width;
      if (!force && Math.abs(measuredWidth - lastMeasuredWidth) < 0.5) return;
      lastMeasuredWidth = measuredWidth;

      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(arrangeItems);
    };

    const images = items
      .map((item) => item.querySelector("img"))
      .filter((image): image is HTMLImageElement => image !== null);
    const handleImageLoad = () => scheduleArrangement(true);
    for (const image of images) {
      image.addEventListener("load", handleImageLoad);
    }

    const resizeObserver = new ResizeObserver(() => scheduleArrangement());
    resizeObserver.observe(grid);
    scheduleArrangement(true);

    return () => {
      resizeObserver.disconnect();
      for (const image of images) {
        image.removeEventListener("load", handleImageLoad);
      }
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      resetItemLayout();
      grid.style.removeProperty("grid-auto-flow");
      grid.style.removeProperty("grid-auto-rows");
      grid.style.removeProperty("row-gap");
    };
  }, [childCount, children, layout]);

  return (
    <div
      ref={gridRef}
      data-gallery-layout={layout}
      className="grid items-start grid-cols-1 sm:grid-cols-2 md:grid-cols-3 min-[1780px]:grid-cols-4"
      style={photoGridSpacing}
    >
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
  aspectRatio = "3:2",
  href,
  onClick,
  priority = false,
}: {
  src: string;
  alt: string;
  /** Intrinsic dimensions from EXIF, used to reserve space before download. */
  width?: number;
  height?: number;
  aspectRatio?: "3:2" | "original" | "auto" | "square" | "portrait" | "landscape";
  href?: string;
  onClick?: () => void;
  /** Priority loading for above-the-fold images */
  priority?: boolean;
}) {
  const aspectClasses = {
    "3:2": "aspect-[3/2]",
    original: "",
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
    "(min-width: 1780px) calc((100vw - 22.875rem) / 4), " +
    "(min-width: 1024px) calc((100vw - 22.25rem) / 3), " +
    "(min-width: 768px) calc((100vw - 5rem) / 3), " +
    "(min-width: 640px) calc((100vw - 3.75rem) / 2), " +
    "calc(100vw - 2.5rem)";

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

  const photoDimensions = {
    "data-photo-width": width,
    "data-photo-height": height,
  };

  if (href) {
    return (
      <Link
        to={href}
        prefetch="intent"
        className={className}
        {...photoDimensions}
      >
        {image}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className} {...photoDimensions}>
      {image}
    </button>
  );
}
