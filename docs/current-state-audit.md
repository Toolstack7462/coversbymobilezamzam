# Current state audit

Recorded at the start of the **Secure Merchant Operations** milestone,
2026-08-31. Every figure here was produced by running the command shown, on a
clean `npm ci`. Nothing is carried over from an earlier report.

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
