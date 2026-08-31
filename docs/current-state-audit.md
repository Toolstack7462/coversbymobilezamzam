# Current state audit

Recorded at the start of the **Secure Merchant Operations** milestone,
2026-08-31. Every figure here was produced by running the command shown, on a
clean `npm ci`. Nothing is carried over from an earlier report.

> **This is a dated snapshot, not the current state.** It is kept as written so
> the milestone has an honest starting line. In particular the single
> all-routes JS budget quoted below has since been replaced by separate
> storefront and admin budgets — see `docs/performance-budget.md` for what the
> gate measures now.

---

## 1. Repository

| Property     | Value                                                       |
| ------------ | ----------------------------------------------------------- |
| Root         | `C:\Users\User\italian-tech-atelier-commerce`               |
| Branch       | `main`                                                      |
| HEAD         | **`54c4f12`**                                               |
| Working tree | clean (0 modified)                                          |
| Remote       | `https://github.com/Toolstack7462/coversbymobilezamzam.git` |
| Divergence   | 0 behind, 0 ahead — in sync                                 |
| Commits      | 8 (`45f9fcd` GitHub initial commit + 7 project commits)     |

The Shopify reference repository at `..\italian-tech-atelier` was checked and is
**untouched**: HEAD `f1a7df6`, clean tree, remote `coversbymobiile`. It is not
modified by this milestone.

### Remote visibility — a divergence from the brief, on record

The remote is **public**. The brief specifies a private repository.

This was raised explicitly before the first push and the merchant chose to
publish. It is recorded here rather than silently re-litigated. Two consequences
follow and neither is a security defect:

- No secrets, credentials or customer data are tracked — verified by
  `npm run secret-scan` and a direct check for `.env`, `.dev.vars`, `*.key`,
  `backups/`, `proofs/`, `uploads/`.
- `LICENSE.md` still reads "all rights reserved, no open-source licence
  granted", which sits oddly beside a public repository. It is contradictory,
  not dangerous. Recorded in `docs/known-limitations.md`.

---

## 2. Toolchain

| Tool     | Version  | Required                      | Status |
| -------- | -------- | ----------------------------- | ------ |
| Node     | v24.14.1 | ≥ 22.22.0 for React Router v8 | PASS   |
| npm      | 11.11.0  | —                             | —      |
| Wrangler | 4.127.1  | ^4                            | PASS   |

---

## 3. Framework compatibility audit

React Router v8 is installed, so the v8 requirements were checked individually:

| Check                                    | Result                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node ≥ 22.22.0                           | **PASS** — v24.14.1                                                                            |
| React ≥ 19.2.7                           | **PASS** — 19.2.8 (react and react-dom)                                                        |
| No import depends on `react-router-dom`  | **PASS** — zero occurrences in `app/`, `workers/`, `db/`, `tests/`, `scripts/`, `package.json` |
| Cloudflare via `@cloudflare/vite-plugin` | **PASS** — 1.54.2, `cloudflare({ viteEnvironment: { name: "ssr" } })`                          |
| Deprecated v7/v8 future flags absent     | **PASS** — no `future` key in `react-router.config.ts` or `vite.config.ts`                     |
| ESM build                                | **PASS** — `"type": "module"`                                                                  |

### Installed versions

    react              19.2.8      react-router        8.3.1
    react-dom          19.2.8      @react-router/dev   8.3.1
    vite               8.2.2       wrangler            4.127.1
    typescript         5.9.3       better-auth         1.7.2
    drizzle-orm        0.45.2      @playwright/test    1.62.1

**No upgrade is warranted.** Nothing is required for compatibility, nothing is a
security fix, and chasing a newer version for its own sake is explicitly out of
scope.

### Dependabot has opened a branch that would break the build

`git fetch` surfaced two Dependabot branches on the remote:

- `dependabot/github_actions/actions/upload-artifact-7`
- **`dependabot/npm_and_yarn/typescript-7.0.2`**

**The TypeScript 7 branch must not be merged.** `typescript-eslint@8.68.0`
declares `typescript: ">=4.8.4 <6.1.0"`. TypeScript 5.9.3 is pinned for exactly
that reason — it was verified at project bootstrap, not guessed. Merging that PR
makes `npm run lint` fail.

This is recorded in `docs/known-limitations.md` so nobody merges it on the
assumption that a green Dependabot badge means safe.

---

## 4. Verified baseline — measured, not quoted

`npm ci` (277 packages) followed by `npm run verify`:

    PASS  Format check           5.6s
    PASS  Lint                  40.1s
    PASS  Typecheck             27.0s
    PASS  Locale parity          0.6s
    PASS  Migration check        3.6s
    PASS  Unit tests             5.5s
    PASS  Integration tests     39.4s
    PASS  Build                  9.0s
    PASS  Bundle budgets         0.9s
    PASS  Secret scan            0.8s
    VERIFIED — 10 checks in 132.5s

### Test counts

| Suite                                        | Files | Tests   | Result         |
| -------------------------------------------- | ----- | ------- | -------------- |
| Unit (`--project unit`)                      | 10    | **173** | PASS           |
| Integration + security (`--project workers`) | 5     | **42**  | PASS           |
| **Browser (Playwright)**                     | **0** | **0**   | **None exist** |

The browser figure is zero. Playwright is installed and `playwright.config.ts`
does not exist yet; no `.spec` file is present anywhere under `tests/`. The
earlier report's claim that browser tests were missing is **confirmed**.

> Since this audit: `playwright.config.ts` and `tests/browser/` now exist and
> 33 browser tests pass. See `docs/launch-checklist.md`.

### Bundle budgets

    PASS  client JavaScript (all routes): 130.4 KB / 160.0 KB (82%)
    PASS  CSS (all routes):                 2.9 KB /  45.0 KB (6%)

These are all-route totals and therefore conservative — React Router code-splits
per route, so no single page loads 130 KB. The real per-page figure is lower and
is not measured here.

---

## 5. What was verified to exist

Claims from the previous milestone, checked against the code rather than
accepted:

| Claim                                  | Verified                                                               |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Better Auth authentication             | Yes — `app/infrastructure/auth/auth.server.ts`, wired at `/api/auth/*` |
| Server-side RBAC                       | Yes — `requireStaff()` in every admin loader and action                |
| Step-up **consumed**, not just checked | Yes — conditional `UPDATE … WHERE consumed_at IS NULL`                 |
| Payment verification                   | Yes — `app/application/commands/verify-payment.ts`, tested             |
| Atomic stock reservations              | Yes — CHECK-constraint guard inside a D1 batch, concurrency-tested     |
| Manual payments                        | Yes — all methods ship disabled                                        |
| WhatsApp confirmation                  | Yes — server-composed, exclusion list tested                           |

---

## 6. Known limitations carried into this milestone

Confirmed still true at `54c4f12`:

- **No browser tests.** Zero spec files.
- **TOTP two-factor is not implemented.** The library supports it and the table
  exists; nothing surfaces enrolment. **Launch blocker.**
- **No staff-management UI.** Roles are granted by hand in SQL.
- **`/admin/installazione` is not race-safe.** Two simultaneous requests can both
  observe zero staff profiles. Addressed in Phase 2 of this milestone.
- **No product or variant editors.** Products can be published, archived and
  repriced only.
- **No media upload, import/export, or FTS5 search.**
- **No email/outbox worker.**
- Backorder is not fully supported (the CHECK bounds `reserved` by `on_hand`).
- Workers compatibility date pinned to `2026-08-22` by the bundled `workerd`.
- Merchant data, legal review, fiscal review, tested restore and measured
  performance all outstanding.

---

## 7. Starting point for this milestone

    HEAD          54c4f12
    branch        main (in sync with origin)
    unit          173 passing
    integration   42 passing
    browser       0
    verify        10/10 PASS
    status        DO NOT LAUNCH

---

---

# Audit — Merchant Control Centre milestone

Re-audited 2026-08-31 at HEAD `4bd6c26`, branch
`feat/secure-merchant-operations`. Reproduced by running the commands, not
carried over from the previous section.

## Repository

| Property               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| Branch                 | `feat/secure-merchant-operations`                                     |
| HEAD                   | `4bd6c26`                                                             |
| Working tree           | clean                                                                 |
| Remote                 | `coversbymobilezamzam` — **public**, merchant's explicit choice       |
| `gh auth status`       | **not authenticated** (git push works via Windows Credential Manager) |
| Node / npm / wrangler  | v24.14.1 / 11.11.0 / 4.127.1                                          |
| Shopify reference repo | untouched, `f1a7df6`, clean                                           |

## Feature inventory — what actually exists

Checked against `app/routes.ts`, `app/routes/admin/`, `app/application/commands/`
and `tests/`, not against memory.

| Feature                    | State       | Evidence                                                                                     |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Better Auth                | **Works**   | `auth.server.ts`, `/api/auth/*`                                                              |
| Staff authentication       | **Works**   | `login.tsx`, `logout.tsx`, generic failure messages                                          |
| TOTP                       | **Works**   | 5 routes; mandatory for privileged roles, enforced per request                               |
| RBAC                       | **Works**   | `requireStaff()` in every admin loader and action                                            |
| Initial-admin installation | **Works**   | Race-safe singleton claim, 16 tests                                                          |
| Payment verification       | **Works**   | `verify-payment.ts` + `/admin/pagamenti`, step-up consumed                                   |
| Staff management           | **Works**   | Invitations, roles, statuses, sessions                                                       |
| Product management         | **PARTIAL** | List, publish/unpublish, archive, price edit. **No create, no edit, no variants, no media.** |
| Variant management         | **ABSENT**  | Schema exists; no UI                                                                         |
| Compatibility management   | **ABSENT**  | Domain resolver + schema exist; **no admin UI at all**                                       |
| Inventory management       | **PARTIAL** | Levels list + adjustments. No receipts, transfers, movements or reservations pages.          |
| Customer management        | **ABSENT**  |                                                                                              |
| Discounts                  | **ABSENT**  | `coupons` / `promotions` tables exist; no UI                                                 |
| Content management         | **ABSENT**  | `pages`, `homepage_sections`, `banners` exist; no UI                                         |
| Import / export            | **ABSENT**  | Job tables exist; no UI, no parsers                                                          |
| FTS search                 | **ABSENT**  | Storefront listing uses `LIKE`; no FTS5 index                                                |
| Browser tests              | **ABSENT**  | 0 spec files                                                                                 |
| GitHub remote              | **Exists**  | Public                                                                                       |
| Cloudflare preview         | **None**    | No resource created, nothing deployed                                                        |

### A broken script found during the audit

`package.json` declares `"test:e2e": "playwright test"`, but **there is no
`playwright.config.ts`**. The script would fail if anyone ran it. It is not part
of `npm run verify`, so it has never failed a gate — which is precisely why it
went unnoticed. Recorded here and fixed when the browser suite lands.

## Baseline measurements

    unit          207 passing (12 files)
    integration    58 passing (6 files)
    browser          0 — none exist
    verify        10/10 PASS
    bundle        140.4 KB / 160 KB JS (88%) · 3.0 KB / 45 KB CSS

## What this milestone must not break

Preserved without modification:

- the compatibility resolver and its invariants;
- the inventory ledger and the CHECK-constraint oversell guard;
- atomic order creation in a single D1 batch;
- the four status machines;
- payment verification's permission + step-up + amount + reference requirement;
- the WhatsApp message exclusion list;
- TOTP enforcement and the pre-enrolment allowlist;
- the last-super-admin guard;
- immutable audit rows.

**The dashboard is an operational layer over these, not a replacement for them.**
Any UI that reimplements one of these rules locally is a defect.
