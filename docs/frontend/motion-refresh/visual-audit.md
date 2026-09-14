# Storefront motion refresh

Starting commit: `2b88965efc6ef966c950749e2011000775a7928c` (PR #16). Isolated checkout: `covers-storefront-motion-refresh`; branch: `feat/storefront-motion-refresh`.

Main was independently fetched at `103fd139d0ec91570b3e9ddd1c7cb968ea28918a`. This work preserves the English admin/storefront repairs already in PR #16. Claude should integrate that PR first. No main push, live deployment or hosting configuration change is part of this refresh.

## Five defects and implemented response

| Observed in baseline Chromium screenshots                                                    | Response                                                                                                                          |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Dark framed hero illustration reads as a separate card; limited accessory depth              | Integrated blue/ice/stone gradient, phone/case foreground, separate charger/cable layers, finite entrance and bounded mouse depth |
| Collection filter labels inherit oversized section heading typography and push products down | Compact label/chip rows, smaller category header, image alongside text, horizontal filter rails on phones                         |
| Device finder reads as oversized unstructured headings                                       | Numbered brand/family/model steps using the original GET links, six shortcuts, bounded search form                                |
| Empty gallery is much shorter than the purchase panel; variant choice is missing             | Stable square gallery, balanced purchase panel, real URL-selected variants with matching price, availability and POST ID          |
| Flat footer and empty cart have weak grouping/alignment                                      | Blue/slate footer gradient, four data-gated groups, correctly aligned empty-state actions                                         |

The existing single featured product and exclusion from new arrivals were already implemented in the starting loader; they remain intact. CMS section ordering stays authoritative. Category/editorial images now have explicit dimensions. Unverified product images remain visibly marked as awaiting merchant verification.

## Scope and references

Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and the installed commerce, motion, visual QA and accessibility skills. The explicit current brief overrides older no-gradient/no-floating-object design prose and permits storefront-scoped palette tokens. No external design plugin or motion library was installed. The Windows Shopify reference was not mounted; no reference code or licensed Shopify assets were copied.

The later user message separately authorises the admin **login presentation only**, with the full brand and 3D depth. That isolated exception is `app/routes/admin/login.tsx` plus `app/styles/admin-login.css`; authentication, login loader/action, protected dashboard and shared admin CSS remain unchanged.

Local interactive browser access was blocked in this environment. Actual Chromium review uses the existing GitHub Actions production-build fixture, with downloadable screenshots/video. The public live site could not be freshly opened here; screenshots prove the isolated source build, not production deployment.

## Baseline

All 11 local verification checks passed before edits: formatting, lint, types, locale parity, migrations, SQL portability, unit/integration tests, build, budgets, secret scan. Unit: 584; Workers integration: 219. Baseline Chromium CI run: `34895506014`, commit `6a688023c7d4037f8d256d4eb3461848ad7f757c` (measurement-only change), all six jobs passed. Storefront job `104148955681` includes 10 tests and before screenshots at all four requested widths.

Before design screenshots also exist in run `34892219506` at the unchanged starting application commit. All catalogue content in these jobs is explicitly `[DEMO]`.
