import { defineConfig } from "vite";

/**
 * Compiles the Node server and the runtime tools it shares with the scripts.
 *
 * ── WHY THE SERVER IS COMPILED RATHER THAN RUN AS TYPESCRIPT ────────────────
 *
 * Node can strip type annotations from a `.ts` file on its own, and for a
 * moment that looked like the simpler path. It is not: stripping is
 * syntax-only, so it does not resolve this project's `~/` and `@db/` aliases
 * and does not add the file extensions that Node's ESM resolver requires. Every
 * import in the application is extensionless, because the whole codebase is
 * written for a bundler. Making the runtime the exception would mean rewriting
 * several hundred import statements to suit one entry point.
 *
 * Compiling also gives the deployment something it needs anyway: a single
 * `start` command pointing at a file whose provenance is a build, not a
 * transform Node performs differently between minor versions.
 *
 * ── TWO ENTRIES ─────────────────────────────────────────────────────────────
 *
 *   index.js   the HTTP server
 *   tools.js   the runtime pieces the migration scripts need — the MariaDB
 *              adapter and the search indexer
 *
 * `tools.js` exists so that scripts/hostinger/*.mjs do not each grow their own
 * copy of the adapter. A migration script that reimplements the connection
 * pool is a script that tests something other than what runs.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": new URL("./app", import.meta.url).pathname,
      "@db": new URL("./db", import.meta.url).pathname,
    },
  },

  build: {
    ssr: true,
    target: "node20",
    outDir: "build/server-node",
    emptyOutDir: true,
    // Not minified. This is server code that nobody downloads, and a readable
    // stack trace in a production log is worth more than the bytes.
    minify: false,
    sourcemap: true,

    rollupOptions: {
      input: {
        index: new URL("./server/index.ts", import.meta.url).pathname,
        tools: new URL("./server/tools.ts", import.meta.url).pathname,
      },
      output: {
        format: "esm",
        entryFileNames: "[name].js",
      },
      /*
       * Everything in node_modules stays external.
       *
       * mysql2 resolves its own files at runtime and Better Auth resolves
       * adapters dynamically; bundling either produces a build that works here
       * and fails on the server with a module it cannot find. They are ordinary
       * dependencies and `npm ci` installs them on the host.
       */
      external: (id) => {
        // The project's own aliases are NOT external. Rollup sees the raw
        // specifier here, before Vite's alias plugin rewrites it, so a plain
        // "is it a bare specifier?" test marks `~/infrastructure/db/mariadb`
        // as a package — and the built file then tries to import a package
        // called `~` at runtime.
        if (id.startsWith("~/") || id.startsWith("@db/")) return false;
        return !id.startsWith(".") && !id.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(id);
      },
    },
  },
});
