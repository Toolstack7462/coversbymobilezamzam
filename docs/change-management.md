# Change management

A change is not done when the code works. It is done when the things that keep it
working are also true.

Each rule below exists because the missing companion causes a specific, seen
failure.

---

## Database change

Not complete until:

- [ ] a versioned migration exists in `db/migrations`
- [ ] Drizzle schema types updated
- [ ] `docs/data-dictionary.md` updated
- [ ] indexes reviewed for the queries that will use the column
- [ ] integration tests exist
- [ ] backup and restore impact considered
- [ ] an ADR written if architecture is affected

**Never** `drizzle-kit push` against a deployed database. It infers a diff and
applies it without review, which can mean dropping a column holding real orders.

---

## API change

Not complete until:

- [ ] request and response schemas updated
- [ ] Zod validation updated
- [ ] tests updated
- [ ] existing clients still work, or the version changed

The storefront and admin are clients. A field removed from a response is a
breaking change even though both halves live in this repository.

---

## Status machine change

Not complete until:

- [ ] the transition map is updated
- [ ] invalid-transition tests are updated
- [ ] the admin UI offers exactly the legal transitions
- [ ] documentation is updated

A new status the admin cannot reach is dead code. A status the admin offers but
the machine rejects is a bug in front of staff.

---

## Price or inventory rule change

Not complete until:

- [ ] domain tests exist
- [ ] order-snapshot behaviour verified — history must not shift
- [ ] audit-log behaviour verified

These two subsystems are where a quiet mistake becomes money.

---

## Design system change

Not complete until:

- [ ] tokens updated (never a literal colour in a component)
- [ ] affected screens reviewed at 390 / 768 / 1440
- [ ] contrast checked, including the fill-versus-text token split
- [ ] Italian labels checked at 390px — they overflow before English does

---

## Locale change

Not complete until:

- [ ] every locale file has the key
- [ ] `npm run locales:check` passes
- [ ] the longest translation has been seen at 390px

A missing key must fail the build, not render `undefined` to a customer.

---

## Preferred change shapes

In order of preference:

1. **Additive** — new nullable column, new optional field, new route.
2. **Feature-flagged** — ship dark, enable deliberately.
3. **Deprecated then removed** — mark, migrate, remove in a later release.
4. **Backfilled** — add, populate, then enforce `NOT NULL`.
5. **Compatibility adapter** — accept old and new during transition.

Breaking changes are a last resort and need a written reason.

---

## Release

1. `npm run verify` passes.
2. Working tree clean.
3. Migrations reviewed by a human.
4. `CHANGELOG.md` updated.
5. Backup taken before remote migration.
6. Deploy to staging.
7. Smoke test staging.
8. **Production deploy only with explicit authorisation, every time.**

---

## What is never done casually

- Dropping a column or table
- Changing a money column's type or unit
- Changing an order-number format
- Renaming a status value
- Changing a permission's meaning
- Rotating `SETTINGS_ENCRYPTION_KEY` without a re-encryption plan

The last one deserves its own note: rotating that key without re-encrypting makes
every stored IBAN unreadable. The procedure is in
`docs/operations-runbook.md` and it is not a one-liner.
