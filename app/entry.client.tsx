import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";

// Browser extensions and embedded-browser tooling can inject an overlay as a
// direct child of <html> before Remix hydrates. React owns the whole document,
// so those extra nodes cause a structural hydration mismatch. Detach only the
// nodes outside <head>/<body>, then restore them once hydration has committed.
const documentOverlays = Array.from(document.documentElement.children).filter(
  (element) => element !== document.head && element !== document.body,
);

for (const overlay of documentOverlays) overlay.remove();

function HydratedRemixBrowser() {
  useEffect(() => {
    for (const overlay of documentOverlays) {
      document.documentElement.appendChild(overlay);
    }
  }, []);

  return <RemixBrowser />;
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRemixBrowser />
    </StrictMode>
  );
});
