# Branded admin depth refresh

Starting release: `03960bf395d6ffafb5a89a2e1ff7bf7317035a2a` on current main, fetched 2026-09-15. PR #17 is merged in that release, together with the shared password control and admin validation repairs. This work uses a separate checkout and `feat/admin-depth-refresh`; it neither rewrites that work nor deploys production.

The user's latest request explicitly expands the earlier storefront ownership boundary to the admin dashboard. Existing light-only/no-gradient design prose is superseded by this request for restrained depth and a balanced light/dark gradient treatment. English and Italian remain supported. The installed commerce, motion and accessibility guidance informs contrast, focus, finite motion and functional controls; browser animation is not treated as server CPU work.

## What changed

| File                                   | Purpose                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/styles/admin.css`                 | Admin-scoped palette, gradient surfaces, blue navigation, raised logo, compact welcome, restrained metric and menu motion, reduced-motion handling              |
| `app/components/admin/admin-shell.tsx` | Original cover/double-Z SVG on CSS perspective planes, scoped theme modifier and actual router loading status; existing navigation and locale controls retained |
| `app/routes/admin/dashboard.tsx`       | Existing greeting/actions plus compact brand composition; all metrics, ordering and business conditions unchanged                                               |
| `tests/browser/admin-visual.spec.ts`   | Adds 1366px coverage, mid-animation/contrast checks, reduced motion, delayed navigation, locale persistence, keyboard drawer and no-JS navigation               |

The existing login already contains the full approved logo, blue/stone gradient and finite 3D plate entrance. Its presentation and the newly integrated `PasswordField` are preserved. Shared root styles, locale dictionaries, authentication, 2FA, role checks, payment/inventory actions, CMS fields, dependencies, deployment and database configuration are unchanged.

The theme uses the existing admin stylesheet and the scene shares the existing admin shell module. This avoids a second stylesheet request and a redundant direct brand-module import in the dashboard. No budget script or limit changes.

## Visual and motion contract

- Light workspace: `#EDF2F8 → #F6F3ED`; welcome: ice `#E0EAFB`, soft canvas and stone `#E8E7E2`. The single deep headline metric and navigation use `#18283D → #29435F`.
- Dark navigation has `#EDF3FC` text and `#C1D0E3` secondary text. At its lightest gradient endpoint these are 9.13:1 and 6.50:1. Blue active-state text on ice is 6.23:1; secondary text on ice is 6.25:1. Existing status fill/text tokens remain paired; colour is accompanied by the original count and task wording.
- Trusted existing `BrandSymbol` is reused in the topbar and decorative composition. Merchant-configured complete brand text remains authoritative. No uploaded SVG is inlined.
- Brand planes enter once in 900ms, using transforms. Suitable-pointer hover changes their perspective slightly; linked metrics lift 2px. Text, real figures, links and forms stay opaque and usable from the server-rendered first view.
- Menu motion uses the existing short duration tokens. No perpetual decorative loop, scroll handler, canvas, engine or new animation dependency. Only the real router's pending indicator loops while a navigation is outstanding; it unmounts when navigation finishes and never claims a percentage.
- Reduced motion removes new transitions/animations and decorative hover transforms. The complete static illustration and real controls remain.
- The compact scene is omitted below 768px; the complete topbar logo remains. The existing native mobile drawer and desktop collapse continue to work without JavaScript. A login/storefront bottom-clearance rule no longer adds unused space to the protected staff workspace.

## Verification and evidence

Before edits, `npm run verify` passed all 11 checks: 588 unit tests, 219 Workers integration tests, types/lint/format, locale parity, migration/SQL checks, build, budgets and secret scan. Starting aggregate gzip budgets: storefront 136.0 KiB, admin 125.1 KiB, CSS 21.4 KiB. The actual limits remain 136/130/45 KiB; no limit is raised.

The existing dashboard capture in `docs/frontend/evidence/admin-languages/after-admin-1440.png` was inspected before editing, alongside current source. It is prior isolated-browser evidence, not a fresh live-production screenshot. The current main's dashboard/shell markup is unchanged from that capture; later shared password/form repairs were inspected and preserved. The PR's existing CI separately captures its exact base and updated application, each against its own throwaway fixture.

The updated visual survey covers 19 implemented admin screens at 390, 768, 1366 and 1440px: overview, products/new product, inventory, orders/order detail, search, payments, customers, devices, compatibility, taxonomy, homepage/pages, settings, staff, security, setup and system health. Additional tests exercise English/Italian persistence, real delayed navigation feedback, finite motion at 250ms, no page/CSP errors in that exercised flow, axe contrast, keyboard drawer and the no-JavaScript baseline. Login/password, save integrity, permission and storefront regressions remain in the existing CI suites.

Exact post-change results, commit and artifact links are recorded in the feature PR once its checks complete. Review `admin-visual-baseline` and `admin-visual-updated` artifacts; files use `test-results/admin-visual/<screen>-<width>.png`, with extra `depth-midpoint-1366.png`, `overview-en-1366.png` and `drawer-390.png`/`drawer-768.png`. Actions retains these for 14 days. Captures show labelled test data, not live merchant customers or payments.

Local interactive browser execution is unavailable in this workspace, so actual Chromium QA runs in the repository's existing GitHub Actions. This verifies the built application on the isolated Workers/D1 fixture; a Hostinger build verifies compilation separately. It does not establish live Hostinger browser behaviour, field Core Web Vitals, screen-reader conformance or server CPU changes. A production merge/deployment and any hosted preview remain separate integration actions.
