import type { StaffActor } from "~/infrastructure/auth/session.server";

/**
 * Seeds a staff actor with an exact permission set.
 *
 * Deliberately does NOT create a Better Auth user: these tests exercise the
 * authorisation rules, and coupling them to password hashing would make them
 * slower and would test the library rather than this project.
 */
export async function seedStaff(
  db: D1Database,
  options: { userId?: string; permissions: readonly string[]; displayName?: string },
): Promise<StaffActor> {
  const userId = options.userId ?? `user_${Math.random().toString(36).slice(2, 10)}`;
  const displayName = options.displayName ?? "Staff Test";
  const now = 1_756_000_000_000;

  await db.batch([
    db
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?1,?2,?3,1,0,?4,?4)`,
      )
      .bind(userId, displayName, `${userId}@example.test`, now),
    db
      .prepare(
        `INSERT INTO staff_profiles (id, user_id, display_name, active, created_at, updated_at)
         VALUES (?1,?2,?3,1,?4,?4)`,
      )
      .bind(`sp_${userId}`, userId, displayName, now),
  ]);

  return {
    userId,
    email: `${userId}@example.test`,
    displayName,
    permissions: [...options.permissions],
    roleCodes: ["test"],
  };
}

/** Grants a valid, unconsumed step-up for one purpose. */
export async function grantTestStepUp(
  db: D1Database,
  userId: string,
  purpose: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO step_up_sessions (id, user_id, session_id, purpose, expires_at, created_at)
       VALUES (?1,?2,'sess_test',?3,?4,?5)`,
    )
    .bind(`su_${Math.random().toString(36).slice(2)}`, userId, purpose, now + 600_000, now)
    .run();
}

/** The payment row for an order, for assertions. */
export async function paymentFor(db: D1Database, orderId: string) {
  return db
    .prepare(
      `SELECT id, status, amount_received, transaction_reference, verified_by, verified_at
         FROM order_payments WHERE order_id = ?1`,
    )
    .bind(orderId)
    .first<{
      id: string;
      status: string;
      amount_received: number | null;
      transaction_reference: string | null;
      verified_by: string | null;
      verified_at: number | null;
    }>();
}
