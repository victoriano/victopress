import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarkdownEditor,
  resizeTextareaToContent,
} from "../app/components/MarkdownEditor";

describe("MarkdownEditor auto-height", () => {
  test("resets the textarea before measuring its full content height", () => {
    const style = { height: "900px" };
    const textarea = {
      style,
      get scrollHeight() {
        return style.height === "auto" ? 1280 : 900;
      },
    } as unknown as HTMLTextAreaElement;

    resizeTextareaToContent(textarea);

    expect(textarea.style.height).toBe("1280px");
  });

  test("renders an auto-sized editor without a manual resize handle", () => {
    const markup = renderToStaticMarkup(
      <MarkdownEditor
        value={"## A complete article\n\nFirst paragraph.\n\nSecond paragraph."}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('data-autosize="true"');
    expect(markup).toContain("shrink-0");
    expect(markup).toContain("resize-none");
    expect(markup).toContain("overflow-hidden");
    expect(markup).not.toContain("flex-1");
    expect(markup).not.toContain("resize-y");
  });
});
