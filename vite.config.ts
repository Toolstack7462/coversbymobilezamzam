import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";

export default defineConfig({
  plugins: [
    // viteEnvironment.name must be "ssr" so the Worker is merged into React
    // Router's SSR environment rather than built as a second, separate Worker.
    // Without it the framework and the Worker each build their own bundle and
    // the bindings are not visible to loaders.
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter(),
  ],
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "@db": new URL("./db", import.meta.url).pathname,
    },
  },
  build: {
    // Surfaces bundle growth in review rather than at the budget gate.
    chunkSizeWarningLimit: 200,
  },
});
