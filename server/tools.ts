/**
 * The runtime pieces the migration and maintenance scripts need.
 *
 * Compiled alongside the server by vite.server.config.ts and imported by
 * scripts/hostinger/*.mjs, so that a script exercises the SAME adapter, the
 * same translator and the same indexer the application runs.
 *
 * The alternative — each script constructing its own mysql2 pool and writing
 * its own SQL — is how a migration ends up proving that the migration script
 * works rather than that the application does.
 */

export { createMariaDb, MariaDbDatabase, type MariaDbConfig } from "~/infrastructure/db/mariadb";
export { translate, UntranslatableSqlError } from "~/infrastructure/db/dialect";
export { classifySqlError, supportsInteractiveTransactions } from "~/infrastructure/db/sql";
export type { SqlDatabase, SqlStatement, SqlDialect } from "~/infrastructure/db/sql";

export { rebuildAll, reindexStatements, loadSearchRows } from "~/infrastructure/search/indexer";
export { searchPredicate } from "~/infrastructure/search/predicate";
export { parseSearchQuery } from "~/domain/search/query";

export { FilesystemObjectStore } from "~/infrastructure/storage/filesystem";
export {
  assertSafeObjectKey,
  isSafeObjectKey,
  ALLOWED_MEDIA_TYPES,
} from "~/infrastructure/storage/object-store";
export type { ObjectStore, StoredObject } from "~/infrastructure/storage/object-store";

export { withQueryMetrics, summarise, shapeOf } from "~/infrastructure/db/query-metrics";
export type { QueryMetrics, QuerySummary } from "~/infrastructure/db/query-metrics";

/*
 * Scheduled work, so the CLI runner can reach it WITHOUT importing
 * server/index.ts.
 *
 * That file calls `main()` at module scope: importing it to borrow one export
 * would start a second HTTP server on the application's port every time cron
 * fires.
 */
export { JOBS, JOB_NAMES, runJob, secretMatches } from "../server/jobs";
export type { JobResult, JobContext } from "../server/jobs";
