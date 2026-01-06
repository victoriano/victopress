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
  },
  // Exclude Workers-only WASM packages from Vite bundling
  // These only work in wrangler pages dev / production
  optimizeDeps: {
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
