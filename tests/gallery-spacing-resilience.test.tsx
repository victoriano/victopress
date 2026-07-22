import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoGrid, PhotoItem } from "../app/components/Layout";
import { GallerySettingsPanel } from "../app/routes/admin.galleries.$";
import {
  DEFAULT_GALLERY_THUMBNAIL_ASPECT_RATIO,
  normalizeGalleryThumbnailAspectRatio,
} from "../app/lib/content-engine/gallery-layout";

describe("gallery spacing resilience", () => {
  test("ships responsive spacing in the markup instead of new Tailwind utilities", () => {
    const markup = renderToStaticMarkup(
      <PhotoGrid>
        <span>Photo</span>
      </PhotoGrid>,
    );

    expect(markup).toContain(
      "gap:clamp(0.625rem, calc(3.125rem - 3.90625vw), 1.25rem)",
    );
    expect(markup).toContain(
      "padding:clamp(1.25rem, calc(-2.5rem + 7.8125vw), 2.5rem)",
    );
    expect(markup).not.toContain("lg:gap-");
    expect(markup).not.toContain("lg:p-");
  });

  test("matches the original three-column desktop rhythm until ultrawide screens", () => {
    const markup = renderToStaticMarkup(
      <PhotoGrid>
        <span>Photo</span>
      </PhotoGrid>,
    );

    expect(markup).toContain("md:grid-cols-3");
    expect(markup).toContain("items-start");
    expect(markup).toContain("min-[1780px]:grid-cols-4");
    expect(markup).not.toContain("lg:grid-cols-4");
  });

  test("advertises image widths for the rendered desktop column count", () => {
    const markup = renderToStaticMarkup(
      <PhotoItem
        src="/api/images/galleries/spaces/landscape.jpg"
        alt="Landscape"
        width={2400}
        height={1600}
      />,
    );

    expect(markup).toContain(
      'sizes="(min-width: 1780px) calc((100vw - 22.875rem) / 4), (min-width: 1024px) calc((100vw - 22.25rem) / 3)',
    );
  });

  test("uses a uniform 3:2 crop by default and can preserve the original frame", () => {
    const uniformMarkup = renderToStaticMarkup(
      <PhotoItem src="/api/images/photo.jpg" alt="Uniform photo" />,
    );
    const originalMarkup = renderToStaticMarkup(
      <PhotoItem
        src="/api/images/photo.jpg"
        alt="Original photo"
        width={1600}
        height={1200}
        aspectRatio="original"
      />,
    );

    expect(uniformMarkup).toContain("aspect-[3/2]");
    expect(originalMarkup).not.toContain("aspect-[3/2]");
    expect(originalMarkup).toContain("aspect-ratio:1600 / 1200");
    expect(DEFAULT_GALLERY_THUMBNAIL_ASPECT_RATIO).toBe("3:2");
    expect(normalizeGalleryThumbnailAspectRatio(undefined)).toBe("3:2");
    expect(normalizeGalleryThumbnailAspectRatio("original")).toBe("original");
  });

  test("marks original-ratio grids for the compact masonry enhancement", () => {
    const uniformMarkup = renderToStaticMarkup(
      <PhotoGrid>
        <span>Photo</span>
      </PhotoGrid>,
    );
    const originalMarkup = renderToStaticMarkup(
      <PhotoGrid layout="original">
        <span>Photo</span>
      </PhotoGrid>,
    );

    expect(uniformMarkup).toContain('data-gallery-layout="3:2"');
    expect(originalMarkup).toContain('data-gallery-layout="original"');
  });

  test("shows the gallery-level selector with uniform 3:2 selected by default", () => {
    const markup = renderToStaticMarkup(
      <GallerySettingsPanel
        gallery={{
          slug: "humans",
          path: "galleries/humans",
          title: "Humans",
          photoCount: 12,
        }}
        onUpdate={() => {}}
        onDelete={() => {}}
        isLoading={false}
      />,
    );

    expect(markup).toContain("Gallery image proportions");
    expect(markup).toContain("Uniform 3:2");
    expect(markup).toContain("Original proportions");
    expect(markup).toMatch(
      /<input(?=[^>]*name="thumbnailAspectRatio")(?=[^>]*value="3:2")(?=[^>]*checked="")[^>]*>/,
    );
  });
});
