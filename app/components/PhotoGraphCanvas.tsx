import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

export interface PhotoGraphNode {
  assetId: string;
  x: number;
  y: number;
  clusterId: number;
  caption: string;
  filename: string;
}

export interface PhotoGraphCluster {
  id: number;
  label: string;
  count: number;
  x: number;
  y: number;
}

export interface PhotoGraphEdge {
  source: string;
  target: string;
}

interface PhotoGraphCanvasProps<Node extends PhotoGraphNode> {
  nodes: readonly Node[];
  edges: readonly PhotoGraphEdge[];
  clusters: readonly PhotoGraphCluster[];
  selectedIds?: ReadonlySet<string>;
  onSelectNode: (node: Node, additive: boolean) => void;
  ariaLabel: string;
  instructions: string;
  resetLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  heightClassName?: string;
}

const WIDTH = 1_000;
const HEIGHT = 680;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;

export const PHOTO_GRAPH_CLUSTER_COLORS = [
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#2563eb",
  "#ca8a04",
  "#9333ea",
] as const;

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function PhotoGraphCanvas<Node extends PhotoGraphNode>({
  nodes,
  edges,
  clusters,
  selectedIds = new Set<string>(),
  onSelectNode,
  ariaLabel,
  instructions,
  resetLabel,
  zoomInLabel,
  zoomOutLabel,
  heightClassName = "h-[620px]",
}: PhotoGraphCanvasProps<Node>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const nodesById = new Map(nodes.map((node) => [node.assetId, node]));

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

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
      <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          aria-label={zoomInLabel}
          className="px-3 py-2 text-lg text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.8)}
          aria-label={zoomOutLabel}
          className="border-x border-gray-300 px-3 py-2 text-lg text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {resetLabel}
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`${heightClassName} w-full cursor-grab touch-none active:cursor-grabbing`}
        onWheel={handleWheel}
        onPointerDown={beginPan}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        aria-label={ariaLabel}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {clusters.map((cluster) => (
            <g key={`cluster-${cluster.id}`}>
              <circle
                cx={cluster.x * WIDTH}
                cy={cluster.y * HEIGHT}
                r={110}
                fill={PHOTO_GRAPH_CLUSTER_COLORS[cluster.id % PHOTO_GRAPH_CLUSTER_COLORS.length]}
                opacity={0.045}
              />
              <text
                x={cluster.x * WIDTH}
                y={cluster.y * HEIGHT - 116}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill={PHOTO_GRAPH_CLUSTER_COLORS[cluster.id % PHOTO_GRAPH_CLUSTER_COLORS.length]}
              >
                {cluster.label} · {cluster.count}
              </text>
            </g>
          ))}

          {edges.map((edge) => {
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

          {nodes.map((node) => {
            const selected = selectedIds.has(node.assetId);
            return (
              <circle
                key={node.assetId}
                cx={node.x * WIDTH}
                cy={node.y * HEIGHT}
                r={(selected ? 9 : 5.2) / Math.sqrt(transform.scale)}
                fill={PHOTO_GRAPH_CLUSTER_COLORS[node.clusterId % PHOTO_GRAPH_CLUSTER_COLORS.length]}
                stroke={selected ? "white" : "transparent"}
                strokeWidth={selected ? 2 / transform.scale : 0}
                className="cursor-pointer transition-opacity hover:opacity-70 focus:outline-none"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode(node, event.metaKey || event.ctrlKey || event.shiftKey);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNode(node, event.shiftKey);
                  }
                }}
              >
                <title>{node.caption || node.filename}</title>
              </circle>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg bg-white/90 px-3 py-2 text-xs text-gray-600 shadow-sm backdrop-blur dark:bg-gray-900/90 dark:text-gray-300">
        {instructions}
      </div>
    </div>
  );
}
