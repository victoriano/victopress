import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/cloudflare" {
  interface Future {
    v3_singleFetch: true;
  }
}

export default defineConfig({
  server: {
    port: 5174,
    host: true,
    allowedHosts: ["victopress-dev.nominao.com"],
  },
  // Exclude Workers-only WASM packages from Vite bundling
  // These only work in wrangler pages dev / production
  optimizeDeps: {
    // Admin-only packages are not discovered from the initial public route.
    // Pre-bundle them on startup so Vite never reloads the dependency graph
    // after Safari has already hydrated the app with the previous React graph.
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "@remix-run/react",
      "@remix-run/cloudflare",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@aws-sdk/client-s3",
      "exifr",
      "gray-matter",
      "js-yaml",
      "yaml",
    ],
    exclude: ["@cf-wasm/photon"],
  },
  ssr: {
    external: ["@cf-wasm/photon"],
    noExternal: [],
  },
  plugins: [
    remixCloudflareDevProxy({
      remoteBindings: true,
      persist: { path: ".wrangler/state/v3" },
    }),
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
});
