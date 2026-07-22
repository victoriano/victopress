import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OptimizedImage } from "../app/components/OptimizedImage";

describe("gallery image reveal", () => {
  test("keeps the server-rendered image visible before hydration", () => {
    const markup = renderToStaticMarkup(
      <OptimizedImage
        src="/api/images/galleries/spaces/example.jpg"
        alt="Example"
        width={2400}
        height={1600}
      />,
    );

    expect(markup).toContain('data-image-state="visible"');
    expect(markup).toContain("opacity-100");
    expect(markup).not.toContain("opacity-0");
  });

  test("ships a short reveal and disables it for reduced motion", () => {
    const markup = renderToStaticMarkup(
      <OptimizedImage
        src="/api/images/galleries/spaces/example.jpg"
        alt="Example"
        width={2400}
        height={1600}
      />,
    );

    expect(markup).toContain("duration-[480ms]");
    expect(markup).toContain("cubic-bezier(0.22,0.61,0.36,1)");
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("motion-reduce:transform-none");
  });
});
