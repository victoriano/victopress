import { Link, useRouteLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

interface SimilarPhoto {
  assetId: string;
  path: string;
  filename: string;
  title?: string;
  gallerySlug: string;
  galleryTitle: string;
  score: number;
  thumbnailUrl: string;
  href: string;
}

interface SimilarPhotosResponse {
  photos: SimilarPhoto[];
}

interface SimilarPhotosProps {
  photoPath: string;
  limit?: number;
}

type LoadState =
  | { status: "loading"; photos: SimilarPhoto[] }
  | { status: "ready"; photos: SimilarPhoto[] }
  | { status: "hidden"; photos: SimilarPhoto[] };

/**
 * Loads recommendations after the main photo has rendered. Failures are kept
 * deliberately silent so this optional feature can never disrupt photo pages.
 */
export function SimilarPhotos({ photoPath, limit = 8 }: SimilarPhotosProps) {
  const rootData = useRouteLoaderData<{ photoAiEnabled?: boolean }>("root");
  const photoAiEnabled = rootData?.photoAiEnabled === true;
  const [state, setState] = useState<LoadState>({ status: "loading", photos: [] });

  useEffect(() => {
    if (!photoAiEnabled) {
      setState({ status: "hidden", photos: [] });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", photos: [] });

    const loadSimilarPhotos = async () => {
      try {
        const searchParams = new URLSearchParams({
          path: photoPath,
          limit: String(limit),
        });
        const response = await fetch(`/api/photos/similar?${searchParams.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Similar photos request failed (${response.status})`);
        }

        const payload = await response.json() as Partial<SimilarPhotosResponse>;
        const photos = Array.isArray(payload.photos) ? payload.photos.slice(0, limit) : [];
        setState(photos.length > 0
          ? { status: "ready", photos }
          : { status: "hidden", photos: [] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "hidden", photos: [] });
      }
    };

    void loadSimilarPhotos();
    return () => controller.abort();
  }, [limit, photoAiEnabled, photoPath]);

  if (!photoAiEnabled) return null;

  if (state.status === "hidden") return null;

  if (state.status === "loading") {
    return <SimilarPhotosSkeleton />;
  }

  return (
    <section
      aria-labelledby="similar-photos-heading"
      className="border-t border-gray-100 bg-white px-4 py-8 dark:border-gray-800 dark:bg-gray-950 lg:px-8 lg:py-10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="similar-photos-heading" className="text-base font-semibold text-gray-900 dark:text-white">
            Similar photos
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">Selected visually</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {state.photos.map((photo) => (
            <SimilarPhotoCard key={photo.assetId || photo.path} photo={photo} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SimilarPhotoCard({ photo }: { photo: SimilarPhoto }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = photo.title || photo.filename;
  const accessibleLabel = photo.galleryTitle
    ? `View ${title} from ${photo.galleryTitle}`
    : `View ${title}`;

  return (
    <Link
      to={photo.href}
      prefetch="intent"
      aria-label={accessibleLabel}
      className="group block min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-900">
        {imageFailed ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-gray-400 dark:text-gray-500">
            Preview unavailable
          </div>
        ) : (
          <img
            src={photo.thumbnailUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-2.5 pt-8 text-white">
          <p className="truncate text-xs font-medium">{title}</p>
          {photo.galleryTitle && (
            <p className="mt-0.5 truncate text-[11px] text-white/75">{photo.galleryTitle}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

function SimilarPhotosSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading similar photos"
      className="border-t border-gray-100 bg-white px-4 py-8 dark:border-gray-800 dark:bg-gray-950 lg:px-8 lg:py-10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 h-4 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-900" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="aspect-[4/3] animate-pulse bg-gray-100 dark:bg-gray-900"
            />
          ))}
        </div>
        <span className="sr-only">Loading similar photos…</span>
      </div>
    </section>
  );
}

export default SimilarPhotos;
