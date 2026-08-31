# Performance budget

## Targets

| Metric                            | Target            |
| --------------------------------- | ----------------- |
| LCP                               | ≤ 2.5s            |
| INP                               | ≤ 200ms           |
| CLS                               | ≤ 0.1             |
| Storefront JS (shared + customer) | **< 130 KB gzip** |
| Admin JS (staff-only routes)      | **< 120 KB gzip** |
| Average admin chunk               | **< 3 KB gzip**   |
| CSS                               | **< 45 KB gzip**  |

`npm run budgets` is a **hard gate**, not a warning. A budget that only warns is
a budget that gets ignored, and bundle size only ever moves one way without one.

---

## Why there are two JS budgets

There used to be one: 160 KB for every client chunk. It was honest about being
an over-count, but it had a worse flaw — **it charged the customer for the
shopkeeper's tools.** Every admin screen consumed part of a number meant to
represent a customer's download. Left alone, the gate would eventually have
failed for a reason with nothing to do with the customer's experience, and the
only ways out would have been to raise the limit or to stop building the admin
properly. Neither is a good answer.

Chunks are now split by who downloads them. Anything named after a route under
`app/routes/admin/` or an admin-only component is the shopkeeper's; everything
else — framework, router, shared helpers, every storefront route — is the
customer's.

The classification is deliberately biased **against** the customer's budget:

- Shared chunks go to the storefront, because customers genuinely download them.
- An admin-only helper nobody remembered to list also goes to the storefront.
- `layout.tsx` exists in both trees and Vite emits two chunks with that stem, so
  neither can be told apart by name. Both go to the storefront.

Each of those errs toward over-counting the customer, which is the safe
direction for a budget whose purpose is to protect the customer. The two figures
always sum to the total, so nothing can quietly fall out of both.

Note that this is **tighter** on the customer than the 160 KB it replaces: the
storefront limit is 130 KB, and admin weight can no longer eat into it.

---

## Measured, with storefront and admin built

    PASS  storefront JavaScript (shared + customer routes): 122.4 KB / 130.0 KB (94%)
    PASS  admin JavaScript (staff-only routes):              54.5 KB / 120.0 KB (45%)
    PASS  CSS (all routes):                                   5.6 KB /  45.0 KB (13%)
    PASS  average admin chunk: 1.5 KB / 3.0 KB across 36 screens

    Total client JavaScript: 176.9 KB across 62 chunks (26 storefront, 36 admin-only).

**What these numbers are, precisely.** Each sums every chunk on its side, which
is deliberately conservative and is NOT what one page loads. React Router
code-splits per route: a customer on the homepage does not download the checkout
chunk, and a customer never downloads any admin chunk at all. The real per-page
figure is lower than both.

The over-count is kept on purpose. It fails early, and it cannot be gamed by
shifting weight into a lazily-loaded chunk that every page happens to need. A
budget that flatters the result is not a budget.

### Why the admin has a per-screen budget as well as a total

A flat total punishes **breadth** rather than **bloat**.

The admin sits at ~55 KB across 36 code-split chunks: about 1.5 KB per screen,
which is lean. Under the original flat 60 KB limit, adding five more
equally-lean screens would have failed the gate — and the only ways out would
have been to raise the number anyway, or to stop building screens. Neither has
anything to do with what the budget is for.

So the total became a generous ceiling that still catches a runaway dependency,
and **the average chunk size is the number that actually matters**. One screen
importing a chart package, a date library or a rich-text editor moves it
immediately; ten more lean screens do not move it at all. It was verified by
lowering the threshold until it failed, so it is known to be load-bearing rather
than decorative.

Raising a limit because you hit it is usually the wrong move, and it is worth
being explicit that this was not that: the limit that protects the customer is
unchanged, and the admin gained a check it did not have before.

**The storefront 93% is the number to watch, and it is less alarming than it
looks — but also less improvable.** Roughly 95 KB of the 121.3 KB is framework:

    56.6 KB  entry.client      React + React Router runtime
    27.4 KB  jsx-runtime
    11.3 KB  errorBoundaries
     5.2 KB  i18n
     3.9 KB  lib

That weight does not come down without changing the framework. So the ~9 KB of
headroom is the real allowance for storefront feature code, and it is meant to
feel tight.

**Not yet measured:** real per-page transfer, LCP, INP and CLS. All four require
a deployed preview, and no preview has been deployed. The four target rows above
are therefore **targets, not results** — see `docs/launch-checklist.md`.

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
