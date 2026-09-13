import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";

/**
 * The Node build, for Hostinger.
 *
 * A SEPARATE config rather than a flag on the existing one, because the two
 * builds differ in the one way that matters: this one has no
 * `@cloudflare/vite-plugin`. That plugin does not merely add bindings — it
 * changes the SSR environment to workerd, so a build that includes it produces
 * a Worker bundle that Node cannot execute, and one that includes it
 * "conditionally" is a config where the deployed artifact depends on an
 * environment variable nobody sets correctly twice.
 *
 * The Cloudflare build is untouched. `npm run build` still produces exactly
 * what it produced before this migration, which is what keeps the existing
 * deployment recoverable until cutover is approved.
 *
 * Output:
 *   build/client        static assets, served by Express (and by Cloudflare)
 *   build/server/index.js  the SSR bundle server/index.ts imports
 */

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function gitDirty(): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
}

export default defineConfig({
  plugins: [reactRouter()],

  resolve: {
    alias: [
      /*
       * The Node SSR entry, in place of the Web Streams one.
       *
       * React Router finds the application's entry by FILENAME, so there can
       * only be one `app/entry.server.tsx`. That one renders with
       * `renderToReadableStream` for workerd. Node needs
       * `renderToPipeableStream`, so this build swaps the module underneath
       * the name.
       *
       * An exact match, not a prefix: a loose pattern would also catch
       * `entry.server.node.tsx` and alias the file to itself.
       */
      {
        find: /^.*[\\/]app[\\/]entry\.server\.tsx$/,
        replacement: new URL("./app/entry.server.node.tsx", import.meta.url).pathname,
      },
      { find: "~", replacement: new URL("./app", import.meta.url).pathname },
      { find: "@db", replacement: new URL("./db", import.meta.url).pathname },
    ],
  },

  define: {
    __GIT_SHA__: JSON.stringify(gitSha()),
    __GIT_DIRTY__: JSON.stringify(gitDirty()),
    // eslint-disable-next-line no-restricted-syntax
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  ssr: {
    /*
     * Left external, not bundled.
     *
     * mysql2 loads native-ish modules and resolves its own files at runtime;
     * bundling it produces a build that works locally and fails on the server
     * with a module it cannot find. Better Auth and Drizzle resolve adapters
     * dynamically for the same reason. These are ordinary dependencies in
     * package.json and `npm ci` installs them on the host.
     */
    external: ["mysql2", "mysql2/promise", "better-auth", "drizzle-orm", "nodemailer", "express"],
  },

  build: {
    chunkSizeWarningLimit: 200,
  },
});
