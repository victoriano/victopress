export interface EmbeddingMapInput {
  id: string;
  values: readonly number[];
  tags?: readonly string[];
}

export interface EmbeddingMapPoint {
  id: string;
  x: number;
  y: number;
  clusterId: number;
}

export interface EmbeddingMapEdge {
  source: string;
  target: string;
}

export interface EmbeddingMapCluster {
  id: number;
  label: string;
  count: number;
  x: number;
  y: number;
}

export interface EmbeddingMapProjection {
  points: EmbeddingMapPoint[];
  edges: EmbeddingMapEdge[];
  clusters: EmbeddingMapCluster[];
}

const POWER_ITERATIONS = 16;

function magnitude(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function normalize(values: number[]): number[] {
  const length = magnitude(values);
  if (length < 1e-12) return values.map(() => 0);
  return values.map((value) => value / length);
}

function dot(left: readonly number[], right: readonly number[]): number {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index] * right[index];
  }
  return result;
}

function orthogonalize(values: number[], previous: readonly number[][]): number[] {
  const result = [...values];
  for (const component of previous) {
    const projection = dot(result, component);
    for (let index = 0; index < result.length; index += 1) {
      result[index] -= projection * component[index];
    }
  }
  return result;
}

function fallbackComponent(dimensions: number, previous: readonly number[][]): number[] {
  for (let axis = 0; axis < dimensions; axis += 1) {
    const candidate = Array.from({ length: dimensions }, (_, index) => index === axis ? 1 : 0);
    const orthogonal = normalize(orthogonalize(candidate, previous));
    if (magnitude(orthogonal) > 0.5) return orthogonal;
  }
  return Array.from({ length: dimensions }, () => 0);
}

function principalComponent(
  rows: readonly number[][],
  dimensions: number,
  seed: number,
  previous: readonly number[][],
): number[] {
  let component = normalize(
    Array.from(
      { length: dimensions },
      (_, index) => Math.sin((index + 1) * (seed + 1) * 1.61803398875),
    ),
  );
  component = normalize(orthogonalize(component, previous));

  for (let iteration = 0; iteration < POWER_ITERATIONS; iteration += 1) {
    const next = Array.from({ length: dimensions }, () => 0);
    for (const row of rows) {
      const projection = dot(row, component);
      for (let index = 0; index < dimensions; index += 1) {
        next[index] += row[index] * projection;
      }
    }
    const orthogonal = orthogonalize(next, previous);
    if (magnitude(orthogonal) < 1e-10) return fallbackComponent(dimensions, previous);
    component = normalize(orthogonal);
  }

  return component;
}

function normalizeAxis(values: readonly number[]): number[] {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  if (span < 1e-10) return values.map(() => 0.5);
  return values.map((value) => 0.06 + ((value - minimum) / span) * 0.88);
}

function squaredDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function clusterPoints(points: Array<{ id: string; x: number; y: number }>): number[] {
  if (points.length < 12) return points.map(() => 0);
  const clusterCount = Math.min(8, Math.max(2, Math.round(Math.sqrt(points.length / 18))));
  const centroids: Array<{ x: number; y: number }> = [{ x: points[0].x, y: points[0].y }];

  while (centroids.length < clusterCount) {
    let candidate = points[0];
    let candidateDistance = -1;
    for (const point of points) {
      const nearest = Math.min(...centroids.map((centroid) => squaredDistance(point, centroid)));
      if (nearest > candidateDistance) {
        candidate = point;
        candidateDistance = nearest;
      }
    }
    centroids.push({ x: candidate.x, y: candidate.y });
  }

  let assignments = points.map(() => 0);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assignments = points.map((point) => {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = squaredDistance(point, centroid);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    });

    centroids.forEach((centroid, clusterId) => {
      const members = points.filter((_, index) => assignments[index] === clusterId);
      if (members.length === 0) return;
      centroid.x = members.reduce((sum, point) => sum + point.x, 0) / members.length;
      centroid.y = members.reduce((sum, point) => sum + point.y, 0) / members.length;
    });
  }

  const ordered = centroids
    .map((centroid, id) => ({ ...centroid, id }))
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const stableIds = new Map(ordered.map((centroid, index) => [centroid.id, index]));
  return assignments.map((assignment) => stableIds.get(assignment) ?? 0);
}

function clusterLabel(items: readonly EmbeddingMapInput[], fallback: string): string {
  const tags = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    for (const rawTag of item.tags ?? []) {
      const label = rawTag.trim();
      if (!label) continue;
      const key = label.toLocaleLowerCase();
      const existing = tags.get(key);
      tags.set(key, { label: existing?.label ?? label, count: (existing?.count ?? 0) + 1 });
    }
  }
  const leading = Array.from(tags.values())
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 2)
    .map((tag) => tag.label);
  return leading.length > 0 ? leading.join(" · ") : fallback;
}

function buildEdges(points: readonly EmbeddingMapPoint[]): EmbeddingMapEdge[] {
  const unique = new Map<string, EmbeddingMapEdge>();
  for (const point of points) {
    const nearest = points
      .filter((candidate) => candidate.id !== point.id)
      .map((candidate) => ({ candidate, distance: squaredDistance(point, candidate) }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);
    for (const { candidate } of nearest) {
      const [source, target] = [point.id, candidate.id].sort();
      unique.set(`${source}:${target}`, { source, target });
    }
  }
  return Array.from(unique.values());
}

/**
 * Deterministically projects image embeddings to two dimensions with PCA, then
 * groups the result with k-means. Raw vectors never need to leave the server.
 */
export function projectEmbeddingMap(input: readonly EmbeddingMapInput[]): EmbeddingMapProjection {
  if (input.length === 0) return { points: [], edges: [], clusters: [] };
  const ordered = [...input].sort((left, right) => left.id.localeCompare(right.id));
  const dimensions = ordered[0].values.length;
  if (dimensions === 0) throw new Error("Embedding map vectors cannot be empty");
  for (const item of ordered) {
    if (item.values.length !== dimensions || item.values.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding map vectors must have consistent finite dimensions");
    }
  }

  if (ordered.length === 1) {
    return {
      points: [{ id: ordered[0].id, x: 0.5, y: 0.5, clusterId: 0 }],
      edges: [],
      clusters: [{ id: 0, label: clusterLabel(ordered, "Cluster 1"), count: 1, x: 0.5, y: 0.5 }],
    };
  }

  const mean = Array.from({ length: dimensions }, () => 0);
  for (const item of ordered) {
    for (let index = 0; index < dimensions; index += 1) mean[index] += item.values[index];
  }
  for (let index = 0; index < dimensions; index += 1) mean[index] /= ordered.length;
  const centered = ordered.map((item) => item.values.map((value, index) => value - mean[index]));
  const first = principalComponent(centered, dimensions, 0, []);
  const second = principalComponent(centered, dimensions, 1, [first]);
  const rawX = centered.map((row) => dot(row, first));
  const rawY = centered.map((row) => dot(row, second));
  const x = normalizeAxis(rawX);
  const y = normalizeAxis(rawY);
  const basePoints = ordered.map((item, index) => ({ id: item.id, x: x[index], y: y[index] }));
  const assignments = clusterPoints(basePoints);
  const points = basePoints.map((point, index) => ({ ...point, clusterId: assignments[index] }));
  const clusterIds = Array.from(new Set(assignments)).sort((left, right) => left - right);
  const clusters = clusterIds.map((id) => {
    const memberIndexes = assignments.flatMap((clusterId, index) => clusterId === id ? [index] : []);
    const memberPoints = memberIndexes.map((index) => points[index]);
    const memberItems = memberIndexes.map((index) => ordered[index]);
    return {
      id,
      label: clusterLabel(memberItems, `Cluster ${id + 1}`),
      count: memberPoints.length,
      x: memberPoints.reduce((sum, point) => sum + point.x, 0) / memberPoints.length,
      y: memberPoints.reduce((sum, point) => sum + point.y, 0) / memberPoints.length,
    };
  });

  return { points, edges: buildEdges(points), clusters };
}
