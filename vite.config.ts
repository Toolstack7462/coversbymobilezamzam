import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";

/**
 * The exact commit this bundle was built from.
 *
 * Baked in at build time so a deployed Worker can state which source it is
 * running. Without it, "is the deployed version the one I pushed?" is answered
 * by looking at timestamps and hoping — and a deploy that silently shipped
 * stale code is indistinguishable from one that worked.
 *
 * Falls back rather than failing the build: a source tarball with no `.git`
 * still has to compile.
 */
function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Whether the working tree had uncommitted changes at build time. */
function gitDirty(): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
}

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
  define: {
    // Compile-time constants, not runtime lookups: the Worker has no git and no
    // filesystem. Declared in app/build-info.d.ts.
    __GIT_SHA__: JSON.stringify(gitSha()),
    __GIT_DIRTY__: JSON.stringify(gitDirty()),
    /*
     * The Clock port exists so DOMAIN code cannot read the wall clock directly
     * (invariant 10). This is a build script: there is no request, no clock to
     * inject, and the value being captured is literally "when this bundle was
     * made". The rule is right to be broad and wrong here.
     */
    // eslint-disable-next-line no-restricted-syntax
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  build: {
    // Surfaces bundle growth in review rather than at the budget gate.
    chunkSizeWarningLimit: 200,
  },
});
