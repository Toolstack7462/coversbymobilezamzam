import { defineConfig } from "drizzle-kit";

// Drizzle Kit is used ONLY to generate SQL migration files from the schema.
// It is never pointed at a live database and `push` is never used: D1 migrations
// are forward-only files applied by Wrangler, so that what runs in production is
// a reviewed artefact in git rather than a diff computed at deploy time.
// See docs/migrations.md and docs/adr/0008-forward-only-migrations.md.
export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  driver: "d1-http",
  verbose: true,
  strict: true,
});
