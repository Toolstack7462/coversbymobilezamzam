# Changelog

Notable changes. Newest first.

Versions are not published to a registry, so entries are grouped by milestone
rather than semver tag.

## Unreleased

### Added

- **Phase 0** — environment audit, dependency compatibility verification,
  repository created with its own `.git`.
- **Phase 1** — `CLAUDE.md`, fourteen invariants, three status machines, ten
  ADRs, twelve project-local skills, eight read-only review subagents, CI.
- **Phase 2/3** — full D1 schema (60 tables), forward-only migration, and the
  pure domain layer: money, compatibility resolution, order/payment/fulfilment
  status machines, price and discount rules, availability, order numbers,
  WhatsApp message composition, configuration gates, permissions.
- **Phase 5/6 (partial)** — storefront: home, listing, product, device finder,
  cart, checkout, order confirmation, order tracking, shop page. Italian and
  English. Order creation with an atomic stock reservation, and the cron
  reservation sweeper.
- Verification: `npm run verify` runs ten gates. 173 unit tests and 31
  integration/security tests pass.
- Operational scripts: backup, restore verification, inventory reconciliation,
  media inventory, seed, locale parity, migration drift, bundle budgets, secret
  scan.

### Fixed during development

- SQLite treats NULLs as distinct in a unique index, so the original composite
  index would have allowed two contradictory product-level compatibility rows
  for one device. Replaced with partial unique indexes split on nullability.
- The reservation guard was a conditional `WHERE`, which is a **silent no-op**
  inside a D1 batch. Replaced with a CHECK constraint that throws. Found while
  writing the concurrency test.
- `normaliseOrderNumberInput` mapped `I` to `1` across the whole string, turning
  every pasted `ITA-…` into `1TA-…`.
- `delivered` and `collected` were listed as terminal order statuses, which
  would have made a lawful 14-day withdrawal impossible to record.
- A literal U+00A0 inside a regex character class in the money parser.

### Not built in this pass

Authentication, the admin panel, the payment verification screen, RBAC
enforcement, import/export, proof upload, FTS5 search, browser tests and the
outbox worker. See `docs/known-limitations.md` §2b.

### Notes

- No production deployment. No Cloudflare resources created.
- No GitHub remote: `gh` is installed but not authenticated.
- Status: **DO NOT LAUNCH** — see `docs/launch-checklist.md`.
