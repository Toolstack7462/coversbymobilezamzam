---
name: migration-safety
description: Database migration discipline. Use before any schema change.
---

# Migration safety

## Forward-only, always

`drizzle-kit generate` writes a file. The file is committed and reviewed.
`wrangler d1 migrations apply` applies it.

**`drizzle-kit push` is never run against a deployed database.** It infers a diff
and applies it with no review artefact — a rename reads as drop-plus-add. There
is deliberately no `db:push` script.

No down-migrations. A down-migration for "drop column" cannot restore the data,
so believing rollback exists encourages riskier changes. Recovery is
restore-from-backup plus a corrective forward migration.

## A schema change is not done until

- [ ] migration file exists and is committed
- [ ] Drizzle schema types updated
- [ ] `docs/data-dictionary.md` updated
- [ ] indexes reviewed for the queries that will use the column
- [ ] integration tests exist
- [ ] backup/restore impact considered
- [ ] ADR written if architecture is affected

## Preferred shapes

Additive > feature-flagged > deprecate-then-remove > backfill > adapter.
Breaking changes need a written reason.

**Renames are three steps:** add the new column, backfill, drop the old one in a
later release. One step risks data.

## Before any remote apply

1. Take a backup.
2. Record the current migration state.
3. Apply.
4. Smoke test.
5. Keep the restore instructions to hand.

## Never casually

Drop a column or table · change a money column type or unit · change the
order-number format · rename a status value · change a permission meaning ·
rotate `SETTINGS_ENCRYPTION_KEY` without a re-encryption plan.

The last one makes every stored IBAN unreadable.
