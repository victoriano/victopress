import { useFetcher } from "@remix-run/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { getOptimizedImageUrl } from "~/utils/image-optimization";

interface MapNode {
  assetId: string;
  path: string;
  filename: string;
  caption: string;
  tags: string[];
  gallerySlug: string;
  gallerySlugs: string[];
  x: number;
  y: number;
  clusterId: number;
}

interface MapCluster {
  id: number;
  label: string;
  count: number;
  x: number;
  y: number;
}

interface PhotoAiMapData {
  nodes: MapNode[];
  edges: Array<{ source: string; target: string }>;
  clusters: MapCluster[];
  tags: string[];
  galleries: Array<{ slug: string; title: string }>;
}

interface AssignmentResponse {
  success?: boolean;
  added?: number;
  skipped?: number;
  message?: string;
  error?: string;
}

interface PhotoAiGraphProps {
  onChanged: () => void;
  onNotice: (notice: { type: "success" | "error"; text: string }) => void;
}

const WIDTH = 1_000;
const HEIGHT = 680;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const CLUSTER_COLORS = [
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#2563eb",
  "#ca8a04",
  "#9333ea",
];

function isMapData(value: PhotoAiMapData | { error: string } | undefined): value is PhotoAiMapData {
  return Boolean(value && "nodes" in value && "clusters" in value && "galleries" in value);
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function PhotoAiGraph({ onChanged, onNotice }: PhotoAiGraphProps) {
  const mapFetcher = useFetcher<PhotoAiMapData | { error: string }>();
  const assignmentFetcher = useFetcher<AssignmentResponse>();
  const initialLoadStarted = useRef(false);
  const handledAssignment = useRef<AssignmentResponse | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [tag, setTag] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [targetGallery, setTargetGallery] = useState("");
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  const refresh = useCallback(() => mapFetcher.load("/api/admin/ai-map"), [mapFetcher]);

  useEffect(() => {
    if (
      !initialLoadStarted.current &&
      mapFetcher.state === "idle" &&
      mapFetcher.data === undefined
    ) {
      initialLoadStarted.current = true;
      refresh();
    }
  }, [mapFetcher.data, mapFetcher.state, refresh]);

  useEffect(() => {
    const response = assignmentFetcher.data;
    if (
      assignmentFetcher.state !== "idle" ||
      !response ||
      handledAssignment.current === response
    ) return;
    handledAssignment.current = response;
    const error = response.error || (response.success === false ? response.message : undefined);
    onNotice(error
      ? { type: "error", text: error }
      : { type: "success", text: response.message || "Photos added to the gallery." });
    if (!error) {
      refresh();
      onChanged();
    }
  }, [assignmentFetcher.data, assignmentFetcher.state, onChanged, onNotice, refresh]);

  const data = isMapData(mapFetcher.data) ? mapFetcher.data : null;
  const error = mapFetcher.data && "error" in mapFetcher.data ? mapFetcher.data.error : null;
  const tagOptions = useMemo(() => {
    if (!data) return [];

    const counts = new Map<string, number>();
    data.nodes.forEach((node) => {
      const photoTags = new Set(
        node.tags.map((candidate) => candidate.toLocaleLowerCase()),
      );
      photoTags.forEach((candidate) => {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      });
    });

    return data.tags
      .map((label) => ({
        label,
        count: counts.get(label.toLocaleLowerCase()) ?? 0,
      }))
      .sort((left, right) =>
        right.count - left.count
        || left.label.localeCompare(right.label, "es", { sensitivity: "base" }),
      );
  }, [data]);
  const visibleNodes = useMemo(() => {
    if (!data) return [];
    if (tag === "all") return data.nodes;
    const normalized = tag.toLocaleLowerCase();
    return data.nodes.filter((node) =>
      node.tags.some((candidate) => candidate.toLocaleLowerCase() === normalized),
    );
  }, [data, tag]);
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.assetId)),
    [visibleNodes],
  );
  const nodesById = useMemo(
    () => new Map((data?.nodes ?? []).map((node) => [node.assetId, node])),
    [data],
  );
  const activeNode = activeId ? nodesById.get(activeId) ?? null : null;
  const selectedVisibleNodes = visibleNodes.filter((node) => selectedIds.has(node.assetId));
  const isAssigning = assignmentFetcher.state !== "idle";

  useEffect(() => {
    setSelectedIds((current) => new Set(Array.from(current).filter((id) => visibleIds.has(id))));
    setActiveId((current) => current && visibleIds.has(current) ? current : null);
  }, [visibleIds]);

  const assign = useCallback((nodes: readonly MapNode[]) => {
    if (!targetGallery || nodes.length === 0) return;
    const formData = new FormData();
    formData.append("action", "assign-gallery");
    formData.append("gallerySlug", targetGallery);
    nodes.forEach((node) => formData.append("photoPaths", node.path));
    handledAssignment.current = null;
    assignmentFetcher.submit(formData, { method: "POST", action: "/api/admin/ai" });
  }, [assignmentFetcher, targetGallery]);

  const selectNode = useCallback((node: MapNode, additive: boolean) => {
    setActiveId(node.assetId);
    setSelectedIds((current) => {
      if (!additive) return new Set([node.assetId]);
      const next = new Set(current);
      if (next.has(node.assetId)) next.delete(node.assetId);
      else next.add(node.assetId);
      return next;
    });
  }, []);

  const resetView = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), []);
  const zoomBy = useCallback((factor: number) => {
    setTransform((current) => {
      const nextScale = clampZoom(current.scale * factor);
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      return {
        scale: nextScale,
        x: centerX - ((centerX - current.x) * nextScale) / current.scale,
        y: centerY - ((centerY - current.y) * nextScale) / current.scale,
      };
    });
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const pointerY = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    setTransform((current) => {
      const nextScale = clampZoom(current.scale * factor);
      return {
        scale: nextScale,
        x: pointerX - ((pointerX - current.x) * nextScale) / current.scale,
        y: pointerY - ((pointerY - current.y) * nextScale) / current.scale,
      };
    });
  }, []);

  const beginPan = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const pan = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.x) / rect.width) * WIDTH;
    const deltaY = ((event.clientY - drag.y) / rect.height) * HEIGHT;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setTransform((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
  }, []);

  const endPan = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }, []);

  if (!data && !error) {
    return <div className="h-[680px] rounded-xl bg-gray-100 dark:bg-gray-900 animate-pulse" role="status" aria-label="Building embedding map" />;
  }
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        <p>{error}</p>
        <button type="button" onClick={refresh} className="mt-2 font-medium underline">Try again</button>
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500 dark:text-gray-400">
        Analyze photos first to build the embedding map.
      </div>
    );
  }

  return (
    <section aria-label="Photo embedding map" className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="photo-ai-tag" className="text-sm font-medium text-gray-700 dark:text-gray-200">Tag</label>
          <select
            id="photo-ai-tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            className="max-w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="all">All tags ({data.nodes.length})</option>
            {tagOptions.map((item) => (
              <option key={item.label} value={item.label}>
                {item.label} ({item.count})
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500 dark:text-gray-400">{visibleNodes.length} visible</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(visibleNodes.map((node) => node.assetId)))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Select visible
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setActiveId(null); }}
            disabled={selectedIds.size === 0}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
          <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="px-3 py-2 text-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">+</button>
            <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="border-x border-gray-300 px-3 py-2 text-lg text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">−</button>
            <button type="button" onClick={resetView} className="px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800">Reset</button>
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[620px] w-full cursor-grab touch-none active:cursor-grabbing"
            onWheel={handleWheel}
            onPointerDown={beginPan}
            onPointerMove={pan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            aria-label={`${visibleNodes.length} photos clustered by visual similarity`}
          >
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
              {data.clusters.map((cluster) => (
                <g key={`cluster-${cluster.id}`} opacity={visibleNodes.some((node) => node.clusterId === cluster.id) ? 1 : 0.15}>
                  <circle
                    cx={cluster.x * WIDTH}
                    cy={cluster.y * HEIGHT}
                    r={110}
                    fill={CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length]}
                    opacity={0.045}
                  />
                  <text
                    x={cluster.x * WIDTH}
                    y={cluster.y * HEIGHT - 116}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill={CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length]}
                  >
                    {cluster.label} · {cluster.count}
                  </text>
                </g>
              ))}
              {data.edges.map((edge) => {
                if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
                const source = nodesById.get(edge.source);
                const target = nodesById.get(edge.target);
                if (!source || !target) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.target}`}
                    x1={source.x * WIDTH}
                    y1={source.y * HEIGHT}
                    x2={target.x * WIDTH}
                    y2={target.y * HEIGHT}
                    stroke="currentColor"
                    className="text-gray-300 dark:text-gray-700"
                    strokeWidth={0.7 / transform.scale}
                    opacity={0.42}
                  />
                );
              })}
              {visibleNodes.map((node) => {
                const selected = selectedIds.has(node.assetId);
                const active = activeId === node.assetId;
                return (
                  <circle
                    key={node.assetId}
                    cx={node.x * WIDTH}
                    cy={node.y * HEIGHT}
                    r={(active ? 9 : selected ? 7.5 : 5.2) / Math.sqrt(transform.scale)}
                    fill={CLUSTER_COLORS[node.clusterId % CLUSTER_COLORS.length]}
                    stroke={selected ? "white" : "transparent"}
                    strokeWidth={selected ? 2 / transform.scale : 0}
                    className="cursor-pointer transition-opacity hover:opacity-70"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectNode(node, event.metaKey || event.ctrlKey || event.shiftKey);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") selectNode(node, event.shiftKey);
                    }}
                  >
                    <title>{node.caption || node.filename}</title>
                  </circle>
                );
              })}
            </g>
          </svg>
          <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-xs text-gray-600 shadow-sm backdrop-blur dark:bg-gray-900/90 dark:text-gray-300">
            Scroll or use +/− to zoom · drag to pan · Shift/Cmd click to multi-select
          </div>
        </div>

        <aside className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          {activeNode ? (
            <div>
              <img
                src={getOptimizedImageUrl(activeNode.path, { width: 800 })}
                alt={activeNode.caption || activeNode.filename}
                className="aspect-[4/3] w-full rounded-lg bg-gray-100 object-cover dark:bg-gray-900"
              />
              <h3 className="mt-4 break-words font-medium text-gray-900 dark:text-white">{activeNode.filename}</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {activeNode.gallerySlugs.join(" · ")}
              </p>
              {activeNode.caption && <p className="mt-3 text-sm leading-5 text-gray-700 dark:text-gray-300">{activeNode.caption}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {activeNode.tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTag(item)}
                    className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="font-medium text-gray-900 dark:text-white">Select a photo</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Its image, caption, tags and memberships will appear here.</p>
            </div>
          )}

          <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
            <label htmlFor="photo-ai-gallery" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Add to gallery
            </label>
            <select
              id="photo-ai-gallery"
              value={targetGallery}
              onChange={(event) => setTargetGallery(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">Choose a gallery…</option>
              {data.galleries.map((gallery) => (
                <option key={gallery.slug} value={gallery.slug}>{gallery.title} — {gallery.slug}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => assign(selectedVisibleNodes.length > 0 ? selectedVisibleNodes : activeNode ? [activeNode] : [])}
              disabled={!targetGallery || (!activeNode && selectedVisibleNodes.length === 0) || isAssigning}
              className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
            >
              {isAssigning
                ? "Adding…"
                : selectedVisibleNodes.length > 1
                  ? `Add ${selectedVisibleNodes.length} selected photos`
                  : "Add photo"}
            </button>
            {selectedVisibleNodes.length > 0 && (
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                {selectedVisibleNodes.length} selected
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
