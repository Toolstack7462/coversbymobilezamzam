# Performance budget

## Targets

| Metric                | Target            |
| --------------------- | ----------------- |
| LCP                   | ≤ 2.5s            |
| INP                   | ≤ 200ms           |
| CLS                   | ≤ 0.1             |
| Initial storefront JS | **< 160 KB gzip** |
| CSS                   | **< 45 KB gzip**  |

`npm run budgets` is a **hard gate**, not a warning. A budget that only warns is
a budget that gets ignored, and bundle size only ever moves one way without one.

---

## Measured, with storefront and admin built

    PASS  client JavaScript (all routes): 130.4 KB / 160.0 KB (82%)
    PASS  CSS (all routes):                 2.9 KB /  45.0 KB (6%)

**What this number is, precisely.** It sums every client chunk, which is
deliberately conservative and is NOT what one page loads. React Router
code-splits per route: a storefront visitor never downloads the admin chunks,
and an admin never downloads the device finder. The real per-page figure is
lower.

The over-count is kept on purpose. It fails early, and it cannot be gamed by
shifting weight into a lazily-loaded chunk that every page happens to need. A
budget that flatters the result is not a budget.

The 82% figure is still worth watching: most of it is React itself, so the
headroom for application code is smaller than it looks.

Largest client chunks:

    56.6 KB  entry.client
    27.4 KB  jsx-runtime
    11.3 KB  errorBoundaries
     5.2 KB  i18n
     3.9 KB  lib

The 74% JS figure is worth watching: most of it is React itself, so the headroom
for application code is smaller than it looks.

---

## How the budget is held

**No CSS framework, no component library, no animation library, no carousel.**
Each would individually seem reasonable and collectively blow the budget. CSS at
5% of budget is the direct result.

**Native platform features instead of dependencies.** `<details>` for accordions
is zero JavaScript. GET forms for search and sort are zero JavaScript. Real
pagination links are zero JavaScript.

**SSR for everything above the fold**, so the first response carries content
rather than a loading state.

**Reserved dimensions on every image**, or an aspect-ratio box, so nothing
shifts as media arrives.

---

## Database

Indexes exist for the queries that actually run, not speculatively. The two that
matter most:

- `product_compatibility(device_model_id, product_id)` — the device-filtered
  catalogue, the hottest path in the application
- `stock_reservations(status, expires_at)` — the cron sweeper's only query;
  without it the sweep scans the whole table every five minutes, forever

Before adding a query on a growing table, run `EXPLAIN QUERY PLAN`. `SCAN TABLE`
on a large table is a finding.

---

## Before adding any dependency

Ask what it costs gzipped, and whether thirty lines would do. A date library, an
icon package and a carousel each look small and together do not fit.

---

## The honesty rule

**Core Web Vitals are NOT claimed. They have not been measured.**

Measuring them needs a deployed preview under real network conditions; a
localhost Lighthouse run is not evidence. This is a launch gate in
`docs/launch-checklist.md` and it is currently unmet.

What _has_ been measured is the bundle. That is a real number, and it is the one
quoted above.
