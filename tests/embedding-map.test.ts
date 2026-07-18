import { describe, expect, test } from "bun:test";
import { projectEmbeddingMap } from "../app/lib/ai/embedding-map";

describe("embedding map projection", () => {
  test("is deterministic, bounded and creates clusters without exposing vectors", () => {
    const input = Array.from({ length: 24 }, (_, index) => {
      const firstGroup = index < 12;
      return {
        id: `photo-${String(index).padStart(2, "0")}`,
        values: [
          firstGroup ? 1 + index * 0.002 : -1 - index * 0.002,
          firstGroup ? 0.5 : -0.5,
          Math.sin(index) * 0.04,
          Math.cos(index) * 0.03,
        ],
        tags: [firstGroup ? "architecture" : "portrait"],
      };
    });

    const first = projectEmbeddingMap(input);
    const reversed = projectEmbeddingMap([...input].reverse());

    expect(first).toEqual(reversed);
    expect(first.points).toHaveLength(24);
    expect(first.clusters.length).toBeGreaterThanOrEqual(2);
    expect(first.edges.length).toBeGreaterThan(0);
    expect(first.points.every((point) =>
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    )).toBe(true);
    expect(first.edges.every((edge) => edge.source !== edge.target)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("values");
    expect(first.clusters.map((cluster) => cluster.label).join(" ")).toMatch(
      /architecture|portrait/,
    );
  });

  test("rejects inconsistent vectors", () => {
    expect(() => projectEmbeddingMap([
      { id: "a", values: [1, 2] },
      { id: "b", values: [1] },
    ])).toThrow("consistent finite dimensions");
  });
});
