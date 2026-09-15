# Branded admin depth refresh

## Language and identity follow-up — 15 September 2026

This follow-up builds on verified feature commit `465243e` and integrates main `9a6a8120654d3dfbc2ded80195d59e0561e9090a`, whose sole change raises the established storefront budget to 142 KiB. The prior feature's passing CI and screenshots are the before evidence for this request. Main's updated budget policy is preserved; this follow-up does not change it.

Audit findings and repairs:

- The admin disclosure exposed only IT/EN. It now shows a globe, a translated Lingua / Language label, the current language's full native name and a chevron. Selected options have a visual check and `aria-pressed`. The existing POST, cookie, safe return URL and no-JavaScript behaviour remain. Menus are stationary; narrow headers use two stable rows so the full identity, language, search and account fit.
- Staff sign-in hardcoded `/brand/logo.svg`, while public/admin headers resolved merchant settings separately. All four wordmarks now use `BrandLockup` and `BrandSymbol`, with one geometry and complete accessible names. Login and the protected shell read only the three public identity fields through a shared server helper, preserving access checks. Login's decorative cover also uses the same trusted inline symbol, without a filtered favicon image. Its home link respects the staff language.
- The existing `business.brand_secondary` setting was relegated to technical fields. It now has a translated **Second brand line / Seconda riga del marchio** control in `/admin/impostazioni`, under store identity. No schema change or new field is needed. Primary and secondary names remain editable without deploying code. A repeated trailing identity is suppressed when the primary already contains the full shop name.
- The public footer now visibly labels its existing language links. Routes, filters, fragment preservation and public URL-based locale selection remain authoritative.
- The hero's visible “brand illustration” caption and unused dictionary/CSS entries are removed. The decorative composition and interactions remain; merchant hero media/text still override them from the homepage editor.

Hardcoding boundary: merchant identity, products, prices, counts, media, contact/store facts and published content continue to come from existing loaders/settings/editors. Static route identifiers, translated interface dictionaries, design tokens and trusted vector geometry remain code. Downloadable approved brand SVGs/favicon and emergency metadata fallbacks retain the confirmed public identity; no arbitrary uploaded SVG is inlined. This is a targeted identity/language audit, not a claim that every literal or every production route has been audited.

Verification added to the existing suites: visible labels and current language; 44px targets; header overlap and dropdown bounds at 390/768/1366/1440px; complete secondary wordmark visibility; shared SVG geometry across public header/footer/admin/login; CMS save/reload propagation and restoration in the isolated fixture; login SSR branding/title; absent hero caption. Existing language persistence, no-JavaScript, accessibility, password, motion and commerce checks remain required. Final results and current evidence are recorded in PR #18 after CI completes.

Starting release: `03960bf395d6ffafb5a89a2e1ff7bf7317035a2a` on current main, fetched 2026-09-15. PR #17 is merged in that release, together with the shared password control and admin validation repairs. This work uses a separate checkout and `feat/admin-depth-refresh`; it neither rewrites that work nor deploys production.

During review, main advanced to `23d6f303bf2a0991792de7ba1d15c37714d92664`, which independently repairs the shared password reveal control. That release is integrated into this branch; its control styling, behavior and regression test are retained. Final CI compares against this newer base.

The user's latest request explicitly expands the earlier storefront ownership boundary to the admin dashboard. Existing light-only/no-gradient design prose is superseded by this request for restrained depth and a balanced light/dark gradient treatment. English and Italian remain supported. The installed commerce, motion and accessibility guidance informs contrast, focus, finite motion and functional controls; browser animation is not treated as server CPU work.

## What changed

| File                                      | Purpose                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/styles/admin.css`                    | Admin-scoped palette, gradient surfaces, blue navigation, raised logo, compact welcome, restrained metric motion, reduced-motion handling                       |
| `app/components/admin/admin-shell.tsx`    | Original cover/double-Z SVG on CSS perspective planes, scoped theme modifier and actual router loading status; existing navigation and locale controls retained |
| `app/routes/admin/dashboard.tsx`          | Existing greeting/actions plus compact brand composition; all metrics, ordering and business conditions unchanged                                               |
| `tests/browser/admin-visual.spec.ts`      | Adds 1366px coverage, mid-animation/contrast checks, reduced motion, delayed navigation, locale persistence, keyboard drawer and no-JS navigation               |
| `app/styles/admin-login.css`              | Limits the full-width button rule to submit, repairing the desktop password input squeezed by the sibling reveal button                                         |
| `tests/browser/storefront-design.spec.ts` | Verifies usable password typing width with both reveal labels at all four login widths                                                                          |

The existing login already contains the full approved logo, blue/stone gradient and finite 3D plate entrance. Current-commit Chromium screenshots exposed a merge-related layout conflict: the login's full-width button style also targeted the newly integrated password reveal button, squeezing the desktop password input to 34px. The full-width rule now applies only to submit; the shared `PasswordField` behavior is preserved. Shared root styles, locale dictionaries, authentication, 2FA, role checks, payment/inventory actions, CMS fields, dependencies, deployment and database configuration are unchanged.

The theme uses the existing admin stylesheet and the scene shares the existing admin shell module. This avoids a second stylesheet request and a redundant direct brand-module import in the dashboard. No budget script or limit changes.

## Visual and motion contract

- Light workspace: `#EDF2F8 → #F6F3ED`; welcome: ice `#E0EAFB`, soft canvas and stone `#E8E7E2`. The single deep headline metric and navigation use `#18283D → #29435F`.
- Dark navigation has `#EDF3FC` text and `#C1D0E3` secondary text. At its lightest gradient endpoint these are 9.13:1 and 6.50:1. Blue active-state text on ice is 6.23:1; secondary text on ice is 6.25:1. Existing status fill/text tokens remain paired; colour is accompanied by the original count and task wording.
- Trusted existing `BrandSymbol` is reused in the topbar and decorative composition. Merchant-configured complete brand text remains authoritative. No uploaded SVG is inlined.
- Brand planes enter once in 900ms, using transforms. Suitable-pointer hover changes their perspective slightly; linked metrics lift 2px. Text, real figures, links and forms stay opaque and usable from the server-rendered first view.
- Native menus and navigation targets stay stationary. The first browser pass exposed no-JavaScript navigation timeouts with transformed disclosure contents; those optional transforms were removed while retaining the original native controls and their existing tests. No perpetual decorative loop, scroll handler, canvas, engine or new animation dependency. Only the real router's pending indicator loops while a navigation is outstanding; it unmounts when navigation finishes and never claims a percentage.
- Reduced motion removes new transitions/animations and decorative hover transforms. The complete static illustration and real controls remain.
- The compact scene is omitted below 768px; the complete topbar logo remains. The existing native mobile drawer and desktop collapse continue to work without JavaScript. A login/storefront bottom-clearance rule no longer adds unused space to the protected staff workspace.

## Verification and evidence

Before edits, `npm run verify` passed all 11 checks: 588 unit tests, 219 Workers integration tests, types/lint/format, locale parity, migration/SQL checks, build, budgets and secret scan. Starting aggregate gzip budgets: storefront 136.0 KiB, admin 125.1 KiB, CSS 21.4 KiB. The actual limits remain 136/130/45 KiB; no limit is raised.

The existing dashboard capture in `docs/frontend/evidence/admin-languages/after-admin-1440.png` was inspected before editing, alongside current source. It is prior isolated-browser evidence, not a fresh live-production screenshot. The current main's dashboard/shell markup is unchanged from that capture; later shared password/form repairs were inspected and preserved. The PR's existing CI separately captures its exact base and updated application, each against its own throwaway fixture.

The updated visual survey covers 19 implemented admin screens at 390, 768, 1366 and 1440px: overview, products/new product, inventory, orders/order detail, search, payments, customers, devices, compatibility, taxonomy, homepage/pages, settings, staff, security, setup and system health. Additional tests exercise English/Italian persistence, real delayed navigation feedback, finite motion at 250ms, no page/CSP errors in that exercised flow, axe contrast, keyboard drawer and the no-JavaScript baseline. Login/password, save integrity, permission and storefront regressions remain in the existing CI suites.

Exact post-change results, commit and artifact links are recorded in the feature PR once its checks complete. Review `admin-visual-baseline` and `admin-visual-updated` artifacts; files use `test-results/admin-visual/<screen>-<width>.png`, with extra `depth-midpoint-1366.png`, `overview-en-1366.png` and `drawer-390.png`/`drawer-768.png`. Actions retains these for 14 days. Captures show labelled test data, not live merchant customers or payments.

Local interactive browser execution is unavailable in this workspace, so actual Chromium QA runs in the repository's existing GitHub Actions. This verifies the built application on the isolated Workers/D1 fixture; a Hostinger build verifies compilation separately. It does not establish live Hostinger browser behaviour, field Core Web Vitals, screen-reader conformance or server CPU changes. A production merge/deployment and any hosted preview remain separate integration actions.
