# Backup and restore

> **Restore test performed 31 August 2026 — PASSED.**
> `ita-commerce-preview-db` → `ita-commerce-preview-restore-test`, 207 rows
> across 20 tables, schema rebuilt from 6 migrations, full-text search rebuilt
> from its triggers. Command and result in [the log](#restore-test-log) below.
>
> This proves the **procedure**, on preview demo data. It does not yet prove a
> restore at production size or under production time pressure.

---

## What must be recoverable

| Data                                   | Where              | Recoverable from                               |
| -------------------------------------- | ------------------ | ---------------------------------------------- |
| Orders, payments, inventory, catalogue | D1                 | The SQL dump described here                    |
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

## Why the obvious backup command does not work

`wrangler d1 export` refuses this database outright:

    D1 Export error: cannot export databases with Virtual Tables (fts5)

Full-text search (migration `0005_product_search.sql`) adds an FTS5 virtual
table, and from that moment the plain export cannot run. It fails with a message
that sounds like a limitation rather than what it is: **the shop has no
backup.**

So `npm run backup` does not call it directly. It runs
`scripts/backup/export-fts-safe.mjs`, which exports the tables that hold facts
and leaves out the ones that hold copies.

---

## What the backup contains, and what it deliberately leaves out

| Excluded                                    | Why                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `product_search`                            | An index. Every word in it is already in `product_translations`.       |
| `product_search_data/_idx/_docsize/_config` | FTS5's internal storage. SQLite forbids writing to these directly.     |
| `product_search_map`                        | Rebuilt by the same triggers; importing it first collides with them.   |
| `d1_migrations`                             | Restoring it would tell a fresh database it had already been migrated. |

Everything else is exported as **data only** (`--no-schema`). The schema comes
from the migrations on restore, which is the point: it makes the restore a test
of the migrations rather than a test of whether a dump replays.

The search index is not backed up because it is **derived**. It is recreated by
applying the migrations and then letting the triggers repopulate it as the
product rows land — and the restore drill verifies that this actually happened
rather than assuming it.

Each dump is written with a `.manifest.json` beside it recording what was
exported, what was excluded and why, and the row count of every table. A dump
that silently omits tables is otherwise indistinguishable from a dump taken when
those tables were empty.

---

## Two ordering rules, and the errors they prevent

D1's export writes tables alphabetically. That is not restorable, and both
directions had to be fixed:

**Rows load parents first.** `role_permissions` alphabetically precedes `roles`,
so the restore dies on:

    FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY

The dump opens with `PRAGMA defer_foreign_keys=TRUE`, which looks like it should
prevent this and does not: deferred keys are checked at `COMMIT`, and the import
runs in batches rather than one transaction, so every statement commits and is
checked on the spot. The export therefore regroups the statements into
dependency order before writing the file.

**Tables drop children first** — the exact reverse. SQLite still resolves a
table's foreign keys while dropping it, so removing `roles` first makes the next
drop fail with:

    no such table: main.roles

which reads like a missing table and is really a wrong order.

Both orders come from one function, `scripts/lib/schema-order.mjs`, built by
reading the `REFERENCES` clauses out of the live schema. (D1 rejects the obvious
route — `pragma_foreign_key_list` returns `not authorized: SQLITE_AUTH`.) Two
copies that drifted apart would produce a backup that exports cleanly and cannot
be restored, so there is one, and it is unit-tested in
`tests/unit/schema-order.test.ts`.

---

## Taking a backup

    npm run backup                 # the base database
    npm run backup:preview         # the preview database

Writes a timestamped dump and its manifest to `backups/` — a gitignored
directory, because a dump contains real customer data and must never enter
version control.

**Mandatory before any remote migration.** No exceptions.

---

## Restoring

Never restore over a live database as a first move. Restore into a disposable
one, verify it, then decide.

    npm run restore:test

That runs `scripts/restore/restore-test.mjs`, which does the whole drill against
the database configured under `env.restore-test` in `wrangler.jsonc`:

1. **Refuses to run** unless that database's name contains `restore-test`, and
   refuses outright if it looks like a real environment. The script drops every
   table in its target, so it checks the resource it is about to destroy rather
   than trusting the environment flag it was handed.
2. Drops every table, children first.
3. Applies the migrations to the empty database.
4. Asserts the fresh schema has an **empty** search index, so a repopulated one
   later cannot be left over from before.
5. Loads the newest dump in `backups/`.
6. Verifies.

### What it actually checks

- Every table's row count against the manifest, table by table.
- No orphaned order items, payments, variants or compatibility rows. Right
  counts are not the same as right data: reordering statements to satisfy the
  foreign keys is exactly the kind of change that could load every row while
  attaching some of them to the wrong parent.
- `inventory_levels` satisfies `0 <= reserved <= on_hand`.
- `product_search` and `product_search_map` each hold one row per translation —
  proving the triggers ran.
- A real search (`MATCH '"cover"*'`) returns the expected product.

It exits non-zero and says **"This backup is NOT proven"** on any failure. A
dump that loads without error can still be missing rows; only the checks tell
you.

### Afterwards

The disposable database keeps the restored copy so it can be inspected. Delete
it when finished:

    npx wrangler d1 delete ita-commerce-preview-restore-test

Deleting it leaves `env.restore-test` pointing at a database that no longer
exists, and commands against that environment will then fail. That is the
normal resting state, not a fault — recreate it for the next drill and update
the `database_id`.

---

## Recovery time

| Scenario                       | Approach                                                 | Realistic time              |
| ------------------------------ | -------------------------------------------------------- | --------------------------- |
| Bad migration                  | Restore + corrective forward migration                   | 30–60 min                   |
| Accidental data deletion       | Restore to a new database, copy the rows back            | 1–2 h                       |
| Total D1 loss                  | Restore latest dump into a new database, repoint binding | 1–2 h                       |
| Media loss                     | Re-upload from the merchant's originals                  | Days                        |
| `SETTINGS_ENCRYPTION_KEY` loss | Re-enter payment identifiers by hand                     | 1 h + merchant availability |

The preview drill restored 207 rows in seconds. These estimates are dominated by
deciding what to do, not by the transfer — but they are estimates, and none of
them has been measured on a real dataset.

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

1. `npm run backup` (or `npm run backup:preview`)
2. `npx wrangler d1 migrations list <database> --remote` — record the state
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
- [x] **Perform a real restore test** — done on preview, see below
- [ ] Repeat the drill against a production-sized dataset
- [ ] Agree the acceptable data-loss window with the merchant
- [ ] Store `SETTINGS_ENCRYPTION_KEY` offline

## Restore test log

| Date       | Source                    | Target                              | Result                                                                                             |
| ---------- | ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-08-31 | `ita-commerce-preview-db` | `ita-commerce-preview-restore-test` | **PASS** — 207 rows / 20 tables, 6 migrations, FTS rebuilt, search returned `prod_demo_cover16pro` |
