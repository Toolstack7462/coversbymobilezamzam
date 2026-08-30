import { drizzle } from "drizzle-orm/d1";
import * as schema from "@db/schema";

/**
 * The Drizzle client, for reads and simple writes.
 *
 * Anything that must be atomic across several statements uses `D1Database.batch`
 * directly instead - see app/application/commands/create-order.ts. Drizzle has
 * no transaction API on D1 (workerd has no interactive transactions), so the
 * batch is the transaction, and being explicit about that is better than
 * pretending otherwise.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

export { schema };
