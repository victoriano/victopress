import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import { SitePreferenceControls } from "../app/components/SitePreferenceControls";

function renderControls(multilingual: boolean) {
  return renderToStaticMarkup(
    <StaticRouter location="/">
      <SitePreferenceControls
        multilingual={multilingual}
        locale="en"
      />
    </StaticRouter>,
  );
}

describe("site preference controls", () => {
  test("groups the language edition and theme switcher together", () => {
    const markup = renderControls(true);
    const controls = markup.match(/<div[^>]*data-site-preference-controls[^>]*>([\s\S]*)<\/div>/)?.[1];

    expect(controls).toContain("ES");
    expect(controls).toContain("EN");
    expect(controls).toContain("<button");
    expect(controls?.indexOf("EN")).toBeLessThan(controls?.indexOf("<button") ?? -1);
  });

  test("keeps the theme switcher available on single-language sites", () => {
    const markup = renderControls(false);

    expect(markup).toContain("data-site-preference-controls");
    expect(markup).toContain("<button");
    expect(markup).not.toContain(">ES<");
    expect(markup).not.toContain(">EN<");
  });
});
