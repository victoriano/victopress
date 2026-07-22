import { useCallback, useEffect, useRef, useState } from "react";

const CROSSFADE_DURATION_MS = 600;

interface PhotoLayer {
  photoKey: string;
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  width?: number;
  height?: number;
  className: string;
}

interface CrossfadePhotoProps extends PhotoLayer {
  containerClassName?: string;
  loading?: "lazy" | "eager";
  priority?: boolean;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}

interface CrossfadeState {
  current: PhotoLayer;
  outgoing: PhotoLayer | null;
  phase: "idle" | "waiting" | "running";
}

function layersMatch(left: PhotoLayer, right: PhotoLayer): boolean {
  return (
    left.photoKey === right.photoKey &&
    left.src === right.src &&
    left.srcSet === right.srcSet &&
    left.sizes === right.sizes &&
    left.alt === right.alt &&
    left.width === right.width &&
    left.height === right.height &&
    left.className === right.className
  );
}

/**
 * Keeps the outgoing photo stacked behind the incoming one until the incoming
 * resource is ready, then crossfades them with the timing of victoriano.me.
 */
export function CrossfadePhoto({
  photoKey,
  src,
  srcSet,
  sizes,
  alt,
  width,
  height,
  className,
  containerClassName = "",
  loading = "eager",
  priority = false,
  onError,
}: CrossfadePhotoProps) {
  const incomingLayer: PhotoLayer = {
    photoKey,
    src,
    srcSet,
    sizes,
    alt,
    width,
    height,
    className,
  };
  const imageRef = useRef<HTMLImageElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const secondAnimationFrameRef = useRef<number | null>(null);
  const [crossfade, setCrossfade] = useState<CrossfadeState>(() => ({
    current: incomingLayer,
    outgoing: null,
    phase: "idle",
  }));

  // A route update reuses this component. Capture the previous layer during
  // render so React never commits a frame where the old photo has disappeared.
  if (crossfade.current.photoKey !== photoKey) {
    setCrossfade({
      current: incomingLayer,
      outgoing: crossfade.current,
      phase: "waiting",
    });
  } else if (!layersMatch(crossfade.current, incomingLayer)) {
    // Keep fallback URL/srcset changes current without treating them as a new
    // photo navigation.
    setCrossfade((current) => ({ ...current, current: incomingLayer }));
  }

  const startCrossfade = useCallback(() => {
    if (!crossfade.outgoing || crossfade.phase !== "waiting") return;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (secondAnimationFrameRef.current !== null) {
      cancelAnimationFrame(secondAnimationFrameRef.current);
    }

    // Two frames guarantee the browser paints the initial stacked state before
    // applying the opacity transition, including when the image was cached.
    animationFrameRef.current = requestAnimationFrame(() => {
      secondAnimationFrameRef.current = requestAnimationFrame(() => {
        setCrossfade((current) =>
          current.current.photoKey === photoKey && current.phase === "waiting"
            ? { ...current, phase: "running" }
            : current
        );
      });
    });
  }, [crossfade.outgoing, crossfade.phase, photoKey]);

  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) {
      startCrossfade();
    }
  }, [src, srcSet, startCrossfade]);

  useEffect(() => {
    if (crossfade.phase !== "running") return;

    const timeout = window.setTimeout(() => {
      setCrossfade((current) =>
        current.current.photoKey === photoKey
          ? { ...current, outgoing: null, phase: "idle" }
          : current
      );
    }, CROSSFADE_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [crossfade.phase, photoKey]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (secondAnimationFrameRef.current !== null) {
        cancelAnimationFrame(secondAnimationFrameRef.current);
      }
    },
    []
  );

  const incomingVisibility =
    crossfade.outgoing && crossfade.phase === "waiting"
      ? "photo-crossfade-hidden"
      : "photo-crossfade-visible";
  const outgoingVisibility =
    crossfade.phase === "running"
      ? "photo-crossfade-hidden"
      : "photo-crossfade-visible";

  return (
    <div className={`photo-crossfade-stack ${containerClassName}`}>
      {crossfade.outgoing && (
        <img
          src={crossfade.outgoing.src}
          srcSet={crossfade.outgoing.srcSet}
          sizes={crossfade.outgoing.srcSet ? crossfade.outgoing.sizes : undefined}
          alt=""
          aria-hidden="true"
          width={crossfade.outgoing.width}
          height={crossfade.outgoing.height}
          decoding="async"
          className={`${crossfade.outgoing.className} photo-crossfade-image photo-crossfade-outgoing ${outgoingVisibility}`}
        />
      )}

      <img
        ref={imageRef}
        key={`${photoKey}:${src}`}
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        // @ts-expect-error React 18's DOM types use a different casing.
        fetchpriority={priority ? "high" : undefined}
        className={`${className} photo-crossfade-image photo-crossfade-current ${incomingVisibility}`}
        onLoad={startCrossfade}
        onError={onError}
      />
    </div>
  );
}
