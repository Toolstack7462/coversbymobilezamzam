import { drizzle } from "drizzle-orm/d1";
import * as schema from "@db/schema";

/**
 * The Drizzle client for D1.
 *
 * Used by ONE caller: the Worker entry point, to build the Better Auth adapter.
 * Everything else in the application goes through the `SqlDatabase` port and
 * raw SQL, which is why this file did not have to grow a MariaDB twin — see
 * app/infrastructure/auth/database.ts for why Better Auth is the exception.
 *
 * Anything that must be atomic across several statements uses `batch()` on the
 * port instead. Drizzle has no transaction API on D1 — workerd has no
 * interactive transactions — so the batch is the transaction, and being
 * explicit about that is better than pretending otherwise.
 */
export function createD1Db(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createD1Db>;

export { schema };
