export const GALLERY_THUMBNAIL_ASPECT_RATIOS = ["3:2", "original"] as const;

export type GalleryThumbnailAspectRatio =
  (typeof GALLERY_THUMBNAIL_ASPECT_RATIOS)[number];

export const DEFAULT_GALLERY_THUMBNAIL_ASPECT_RATIO: GalleryThumbnailAspectRatio =
  "3:2";

export function isGalleryThumbnailAspectRatio(
  value: unknown,
): value is GalleryThumbnailAspectRatio {
  return value === "3:2" || value === "original";
}

export function normalizeGalleryThumbnailAspectRatio(
  value: unknown,
): GalleryThumbnailAspectRatio {
  return isGalleryThumbnailAspectRatio(value)
    ? value
    : DEFAULT_GALLERY_THUMBNAIL_ASPECT_RATIO;
}
