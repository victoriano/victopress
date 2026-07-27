import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import { SitePreferenceControls } from "../app/components/SitePreferenceControls";
import { ThemeToggle } from "../app/components/ThemeToggle";

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
    expect(controls).toContain('data-theme-toggle-size="compact"');
    expect(controls).toContain("p-1");
    expect(controls).toContain("w-4 h-4");
  });

  test("keeps the theme switcher available on single-language sites", () => {
    const markup = renderControls(false);

    expect(markup).toContain("data-site-preference-controls");
    expect(markup).toContain("<button");
    expect(markup).not.toContain(">ES<");
    expect(markup).not.toContain(">EN<");
  });

  test("keeps the default theme switcher size available for the admin", () => {
    const markup = renderToStaticMarkup(<ThemeToggle />);

    expect(markup).toContain('data-theme-toggle-size="default"');
    expect(markup).toContain("p-2");
    expect(markup).toContain("w-5 h-5");
  });
});
