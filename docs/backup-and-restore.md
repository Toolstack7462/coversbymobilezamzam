# Backup and restore

> **A backup nobody has restored is not a backup.**
>
> `npm run restore:test` exists for exactly this reason. Until it has actually
> been run against a disposable database, the backup is an assumption. This is a
> launch gate, and it is currently **unmet**.

---

## What must be recoverable

| Data                                   | Where              | Recoverable from                               |
| -------------------------------------- | ------------------ | ---------------------------------------------- |
| Orders, payments, inventory, catalogue | D1                 | D1 export                                      |
| Product media                          | R2 `MEDIA`         | Bucket copy                                    |
| Payment proofs                         | R2 `PRIVATE_FILES` | Bucket copy — **personal data**                |
| Secrets                                | Cloudflare         | **Not backed up.** Regenerate or hold offline. |
| Source, schema, migrations             | git                | The repository                                 |

Losing the database loses orders and money owed. Losing media is embarrassing
but survivable. Losing secrets means re-issuing them — except
`SETTINGS_ENCRYPTION_KEY`, whose loss makes every stored IBAN unreadable.

**Hold `SETTINGS_ENCRYPTION_KEY` in a password manager, offline, before it is
ever needed.**

---

## Taking a backup

    npm run backup

Writes a timestamped SQL dump to `backups/` — a gitignored directory, because a
dump contains real customer data and must never enter version control.

Underneath:

    npx wrangler d1 export ita-commerce --remote --output backups/<timestamp>.sql

**Mandatory before any remote migration.** No exceptions.

---

## Restoring — the procedure

Never restore over a live database as a first move. Restore into a **new** one,
verify it, then decide.

    # 1. A disposable target
    npx wrangler d1 create ita-commerce-restore-test

    # 2. Load the dump
    npx wrangler d1 execute ita-commerce-restore-test \
      --remote --file backups/<timestamp>.sql

    # 3. Verify it is actually intact
    npm run restore:test

Step 3 is the one that matters. It checks:

- every expected table exists
- order, order-item and payment counts are non-zero and consistent
- `inventory_levels` satisfies `reserved <= on_hand`
- every `order_items` row still resolves to its order
- the most recent order is as recent as the dump
- the migrations table matches the committed migration files

A dump that loads without error can still be missing rows. Only the checks tell
you.

---

## Recovery time

| Scenario                       | Approach                                                 | Realistic time              |
| ------------------------------ | -------------------------------------------------------- | --------------------------- |
| Bad migration                  | Restore + corrective forward migration                   | 30–60 min                   |
| Accidental data deletion       | Restore to a new database, copy the rows back            | 1–2 h                       |
| Total D1 loss                  | Restore latest dump into a new database, repoint binding | 1–2 h                       |
| Media loss                     | Re-upload from the merchant's originals                  | Days                        |
| `SETTINGS_ENCRYPTION_KEY` loss | Re-enter payment identifiers by hand                     | 1 h + merchant availability |

**Data loss window equals the time since the last backup.** With manual backups
that could be a week. Automate it before launch.

---

## Media

R2 has no built-in point-in-time restore here, so:

    npx wrangler r2 object get ita-commerce-media/<key> --file <local>

`scripts/verify/media-inventory.mjs` cross-checks `product_images` against
bucket contents in both directions — a database row with no object, and an
object with no row. Run it after any bulk media operation.

**Payment proofs are personal financial data.** A copy of that bucket is a copy
of customer data: encrypt it at rest and apply the same retention policy as the
originals.

---

## Before every remote migration

1. `npm run backup`
2. `npx wrangler d1 migrations list ita-commerce --remote` — record the state
3. Apply
4. Smoke test
5. Keep this document to hand

Forward-only migrations mean recovery is **restore plus a corrective forward
migration**, never a down-migration (ADR 0008). A down-migration for "drop
column" cannot restore the data it dropped; believing otherwise encourages
riskier changes.

---

## Still to do before launch

- [ ] Automate daily backups
- [ ] Store backups off Cloudflare
- [ ] **Perform a real restore test** and record the date and result here
- [ ] Agree the acceptable data-loss window with the merchant
- [ ] Store `SETTINGS_ENCRYPTION_KEY` offline

| Restore test           | Date | Result | By  |
| ---------------------- | ---- | ------ | --- |
| _(none performed yet)_ |      |        |     |
