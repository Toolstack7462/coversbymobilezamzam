# Operations runbook

For whoever is on call. Written on the assumption that they did not build this.

Each entry: the symptom, how to confirm it, and what to do.

---

## Orders are not appearing

**Confirm**

    SELECT COUNT(*) FROM orders WHERE created_at > (unixepoch() - 3600) * 1000;

**Check, in order**

1. Is at least one payment method active? With none, checkout says so and no
   order can be created — by design.

       SELECT code, active FROM payment_methods;

2. Is there a sellable inventory location?

       SELECT code, sellable_online, active FROM inventory_locations;

3. Is stock actually available? `available = on_hand − reserved`.

4. `npx wrangler tail --env production` while placing a test order.

---

## Stock is reserved but nothing is selling

Almost always a **stopped sweeper**. Reservations are never released, so stock
stays invisible to new customers.

**Confirm**

    SELECT job_name, status, started_at, items_processed
      FROM scheduled_job_runs ORDER BY started_at DESC LIMIT 10;

    SELECT COUNT(*) FROM stock_reservations
     WHERE status = 'active' AND expires_at < (unixepoch() * 1000);

Rows in the second query with no recent run in the first means the cron is not
firing.

**Fix**

1. Confirm the trigger exists: `npx wrangler deployments list`.
2. Redeploy — cron triggers are attached at deploy time.
3. Once running, the sweeper catches up on its own. It is idempotent, so no
   manual cleanup is needed.

**Do not** release reservations by hand with an UPDATE. That skips the ledger,
the order status and the audit entry, and leaves a discrepancy nobody can
explain later.

---

## `reserved` looks wrong

**Confirm** by replaying the ledger:

    npm run reconcile

**On drift: the ledger wins.** Investigate before correcting, and correct
through a stock adjustment with a written reason — never a bare UPDATE. A
silent fix hides the cause, and the cause will recur.

If `CHECK constraint failed: inventory_levels_reserved_bounds` appears in logs,
the oversell guard has been bypassed somewhere. That is a **bug**, not a data
problem. Find the write that skipped the batch.

---

## A customer says they paid and the order expired

This is a real scenario and it has a correct answer.

1. Check the actual bank account or merchant app. **Not the screenshot.**
2. If the money is there, the order was wrongly expired. Do **not** edit the
   database: create a new order, or use the admin's reinstate flow, so the
   history stays truthful.
3. If it is not there, the customer may have sent it elsewhere, or not at all.
   The _causale_ is the order number; ask for it.

Reservation windows are configurable per payment method. If this recurs, the
window is too short for how customers actually pay — lengthen it rather than
firefighting.

---

## Payment verified by mistake

`verified` does **not** transition back to `awaiting_payment`. That is
deliberate: silently un-verifying erases the evidence that someone got it wrong.

Use the privileged correction event, which records the reversal beside the
original. Requires `payment.settings` and step-up authentication, and is audited.

---

## Rotating SETTINGS_ENCRYPTION_KEY

**Read this before starting. Rotating without re-encrypting makes every stored
IBAN unreadable.**

1. Take a backup. Verify the backup restores.
2. Decrypt every `payment_methods.account_identifier_encrypted` with the OLD key.
3. Set the new key as a secret.
4. Re-encrypt and write back.
5. Verify each masked value still matches its decrypted value.
6. Only then remove the old key.

Do it in a maintenance window. There is no way to do it live safely.

---

## Migration failed halfway

D1 applies migrations one file at a time; a failure leaves earlier files applied.

1. `npx wrangler d1 migrations list ita-commerce --remote` to see the state.
2. **Do not** hand-edit the migrations table.
3. Restore from the pre-migration backup (`docs/backup-and-fts-restore.md`).
4. Fix the migration, test locally, apply again.

Forward-only means recovery is restore-plus-fix, never a down-migration
(ADR 0008).

---

## The site is slow

1. `npx wrangler tail` for slow requests.
2. Suspect an unindexed query on a growing table:

       EXPLAIN QUERY PLAN SELECT ...;

   `SCAN TABLE` on a large table is the usual culprit.

3. Check bundle size did not creep: `npm run build && npm run budgets`.
4. Confirm the catalogue is paginated. A missing `LIMIT` on a grown catalogue
   looks exactly like this.

---

## Email is not sending

Expected, and harmless, if `RESEND_API_KEY` is unset — the store works without
it and the outbox records everything.

    SELECT status, COUNT(*) FROM outbox_events GROUP BY status;
    SELECT status, error FROM email_logs ORDER BY created_at DESC LIMIT 20;

`pending` rows accumulating means delivery is failing; the events are not lost
and will retry. **A failed email never rolls back a valid order.**

---

## Suspected compromise

1. Revoke sessions: `DELETE FROM session;` — everyone logs in again.
2. **Check `payment_methods` for a changed IBAN first.** That is the highest-value
   target: an attacker who changes it redirects every future payment.

       SELECT code, account_identifier_masked, updated_at FROM payment_methods;
       SELECT * FROM audit_logs
        WHERE action LIKE 'payment.settings%' ORDER BY created_at DESC;

3. Rotate `BETTER_AUTH_SECRET`.
4. Review `audit_logs` for role changes and payment verifications.
5. Force password resets for staff.
6. Preserve the audit log. Do not clear it while investigating.

---

## Daily

- Payments awaiting verification
- Orders ready for pickup that have not been collected
- Low stock
- Failed scheduled jobs

## Weekly

- Reconcile inventory
- Review price changes in the audit log
- Confirm backups are being taken **and that one still restores**
