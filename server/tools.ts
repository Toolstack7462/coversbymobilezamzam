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
