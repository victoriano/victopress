import { Link } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  PhotoGraphCanvas,
  type PhotoGraphCluster,
  type PhotoGraphEdge,
  type PhotoGraphNode,
} from "~/components/PhotoGraphCanvas";
import { photoMessages, type Locale } from "~/lib/i18n";

export interface ExploreMapNode extends PhotoGraphNode {
  path: string;
  tags: string[];
  gallerySlug: string;
  gallerySlugs: string[];
  title?: string;
  galleryTitle: string;
  galleryTitles: string[];
  thumbnailUrl: string;
  href: string;
}

export interface ExploreMapData {
  nodes: ExploreMapNode[];
  edges: PhotoGraphEdge[];
  clusters: PhotoGraphCluster[];
  tags: string[];
  galleries: Array<{ slug: string; title: string }>;
}

interface ExplorePhotoGraphProps {
  data: ExploreMapData;
  nodes: ExploreMapNode[];
  locale: Locale;
  onTagSelect: (tag: string) => void;
}

export function ExplorePhotoGraph({
  data,
  nodes,
  locale,
  onTagSelect,
}: ExplorePhotoGraphProps) {
  const messages = photoMessages[locale];
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleIds = useMemo(
    () => new Set(nodes.map((node) => node.assetId)),
    [nodes],
  );
  const activeNode = activeId
    ? nodes.find((node) => node.assetId === activeId) ?? null
    : null;
  const selectedIds = useMemo(
    () => new Set(activeNode ? [activeNode.assetId] : []),
    [activeNode],
  );
  const clusters = useMemo(() =>
    data.clusters.flatMap((cluster) => {
      const members = nodes.filter((node) => node.clusterId === cluster.id);
      if (members.length === 0) return [];
      return [{
        ...cluster,
        count: members.length,
        x: members.reduce((sum, node) => sum + node.x, 0) / members.length,
        y: members.reduce((sum, node) => sum + node.y, 0) / members.length,
      }];
    }),
  [data.clusters, nodes]);

  useEffect(() => {
    setActiveId((current) => current && visibleIds.has(current) ? current : null);
  }, [visibleIds]);

  if (nodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-6 py-24 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {messages.exploreNoMatches}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <PhotoGraphCanvas
        nodes={nodes}
        edges={data.edges}
        clusters={clusters}
        selectedIds={selectedIds}
        onSelectNode={(node) => setActiveId(node.assetId)}
        ariaLabel={messages.graphAriaLabel.replace("{count}", String(nodes.length))}
        instructions={messages.graphInstructions}
        resetLabel={messages.resetGraph}
        zoomInLabel={messages.zoomIn}
        zoomOutLabel={messages.zoomOut}
        heightClassName="h-[460px] sm:h-[560px] xl:h-[620px]"
      />

      <aside className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        {activeNode ? (
          <article>
            <Link
              to={activeNode.href}
              prefetch="intent"
              className="group block overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-900"
            >
              <img
                src={activeNode.thumbnailUrl}
                alt={activeNode.title || activeNode.caption || activeNode.filename}
                className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </Link>
            <h2 className="mt-4 break-words font-medium text-gray-900 dark:text-white">
              <Link to={activeNode.href} prefetch="intent">
                {activeNode.title || activeNode.caption || activeNode.filename}
              </Link>
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {activeNode.galleryTitles.join(" · ")}
            </p>
            {activeNode.caption && activeNode.caption !== activeNode.title && (
              <p className="mt-3 text-sm leading-5 text-gray-700 dark:text-gray-300">
                {activeNode.caption}
              </p>
            )}
            {activeNode.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5" aria-label={messages.detectedElements}>
                {activeNode.tags.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onTagSelect(item)}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            <Link
              to={activeNode.href}
              prefetch="intent"
              className="mt-5 inline-flex text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition hover:decoration-gray-900 dark:text-white dark:decoration-gray-700 dark:hover:decoration-white"
            >
              {messages.viewPhoto}
            </Link>
          </article>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center py-10 text-center xl:min-h-full">
            <p className="font-medium text-gray-900 dark:text-white">
              {messages.selectGraphPhoto}
            </p>
            <p className="mt-2 max-w-52 text-sm leading-5 text-gray-500 dark:text-gray-400">
              {messages.selectGraphPhotoHint}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
