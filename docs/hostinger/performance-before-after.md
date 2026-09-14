# Performance, before and after

What changed, what it was worth, and one earlier measurement that turned out to
be wrong.

Reproduce with `npm run performance:compare`. Raw results are written to
`test-results/performance/compare-*.json`.

---

## 1. First, a correction

[performance-baseline.md](performance-baseline.md), measured 2026-09-13,
reported a homepage p50 of **86 ms** and **11.5 req/s** at eight concurrent
clients.

Re-measured on 2026-09-14 on the **same build, same database, same
configuration, with the response cache switched off**, the same machine
produced **14.6 ms** and **66.6 req/s**.

That is roughly six times faster, and nothing in the application accounts for
it. The likely cause is the machine: the original baseline was taken while the
migration's own test runs were competing for it. This project has already made
that mistake once in a different form — 68 Playwright failures were attributed
to a "saturated server" when the saturation was its own concurrent test runs —
and the same lesson applies here.

**Which means the published baseline overstated the cost of a request by about
6× and understated throughput by about the same.** Everything below is measured
in one sitting on a quiet machine, both halves within the same minute, which is
the only kind of comparison worth drawing a conclusion from. The 2026-09-13
figures should not be compared against anything here.

---

## 2. Configuration

Identical on both sides except for one environment variable.

|          |                                                                               |
| -------- | ----------------------------------------------------------------------------- |
| Commit   | `ea82b04` + this change set, on `feat/hostinger-migration`                    |
| Runtime  | Node v24.14.1, one Express process, `NODE_ENV=development`, `APP_ENV=staging` |
| Database | MariaDB 10.11.19, local, `zamzam_staging`, 26 products / 1,792 rows           |
| Pool     | `DB_CONNECTION_LIMIT=8` plus 2 for Better Auth                                |
| Media    | filesystem store, **0 objects** — no image bytes are in any figure here       |
| Variable | `RESPONSE_CACHE=off` then `RESPONSE_CACHE=on`                                 |
| Host     | Windows 11, loopback, nothing else running                                    |

Both halves are started by the same script, from the same build, against the
same database, in the same minute. The ordering is fixed (off first) rather than
randomised, so a machine that got busier during the run would flatter the first
half — `--reverse` exists for checking that, and the effect below is far too
large to be ordering.

---

## 3. What changed

| Change                                             | Where                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| An anonymous response cache with two-way isolation | `server/response-cache.ts`, `server/cache-middleware.ts`            |
| Version + TTL invalidation, shared across workers  | Same                                                                |
| A wider storefront listing index                   | `0007_product_listing_index` / `0003_product_listing_index`         |
| The first row of `/shop` no longer lazy-loads      | `app/components/storefront/product-card.tsx`                        |
| A scheduled-job runner                             | `server/jobs.ts` — new capability, not a speed change               |
| A 2,000-row import cap                             | `app/domain/import/product-import.ts` — a bound, not a speed change |

---

## 4. Per-route, unloaded

25 requests each, 5 warm-up discarded.

| Route                | Before   | After    | Change   |
| -------------------- | -------- | -------- | -------- |
| `/`                  | 14.58 ms | 2.60 ms  | **−82%** |
| `/shop`              | 15.21 ms | 1.93 ms  | **−87%** |
| `/shop?q=cover`      | 11.23 ms | 1.64 ms  | **−85%** |
| `/shop?q=usb-c`      | 12.48 ms | 1.77 ms  | **−86%** |
| `/trova-dispositivo` | 9.13 ms  | 1.62 ms  | **−82%** |
| `/negozio`           | 6.94 ms  | 1.42 ms  | **−80%** |
| `/en`                | 11.30 ms | 1.67 ms  | **−85%** |
| `/carrello`          | 17.11 ms | 18.17 ms | **+6%**  |
| `/api/health`        | 2.62 ms  | 2.45 ms  | −7%      |
| `/robots.txt`        | 1.39 ms  | 1.59 ms  | +14%     |
| `/admin` (anonymous) | 2.22 ms  | 2.47 ms  | +11%     |

**Read the last four rows, not only the first seven.** They are the routes the
cache refuses, and they got slightly slower — the middleware still inspects
every request. On `/robots.txt` that is 0.2 ms on a 1.4 ms route, which is 14%
and is also 0.2 ms; on the cart it is 1 ms on 17. Both are inside the run-to-run
noise on this machine and neither is worth reporting as a regression, but
leaving them out of the table would be choosing which numbers to show.

---

## 5. Under load

8 concurrent clients, 20 seconds, weighted browse mix.

|                  | Before     | After           | Change   |
| ---------------- | ---------- | --------------- | -------- |
| **Throughput**   | 66.6 req/s | **639.2 req/s** | **×9.6** |
| p50              | 79.95 ms   | **5.68 ms**     | −93%     |
| p95              | 326.42 ms  | **47.03 ms**    | −86%     |
| p99              | 388.53 ms  | **86.22 ms**    | −78%     |
| Failures (5xx)   | 0          | 0               | —        |
| Requests served  | 1,333      | 12,795          | ×9.6     |
| RSS, idle        | 243 MB     | 244 MB          | +0.4%    |
| RSS, after load  | 323 MB     | 331 MB          | +2.5%    |
| Cache hit rate   | n/a        | 0.997           | —        |
| Cache bytes held | n/a        | 0.19 MiB        | —        |

**The memory column is the one to check before believing the throughput
column.** Ten times the throughput for 8 MB more RSS, because seven distinct
pages fit in 190 KB. A cache that bought a tenfold speed-up by holding a
gigabyte would be a bad trade on a shared plan; this one is holding less than a
single product photograph.

### What this does and does not license saying

- It supports: _with the cache on, this configuration served 639 req/s of
  catalogue browsing with no errors and an 86 ms p99, on this machine._
- It does **not** support any claim about visitors per day, about the merchant's
  plan, or about headroom beside their existing website. A slower shared CPU
  pushes it down; a real network hop to the database pushes the **uncached**
  side down much further than the cached side, so the ratio on Hostinger is
  likely to be larger than 9.6 and the absolute numbers smaller.
- The hit rate is 0.997 because the load generator draws from six URLs. **Real
  traffic will not do that.** A shop with 26 products has a long tail of product
  pages, and the honest expectation is a hit rate well below this. The
  per-route table in §4 is the better guide to what one visitor experiences.

---

## 6. At forty times the catalogue

The cache is only half the picture: it hides the cost of a page rather than
removing it, and the cost is what a cold cache pays. So the same measurements
were taken against a synthetic catalogue of **1,066 products** built by
`npm run scale:fixture` (the real catalogue multiplied 41 times).

| Route         | 26 products | 1,066 before index | 1,066 after index |
| ------------- | ----------- | ------------------ | ----------------- |
| `/`           | 14.6 ms     | 28.1 ms            | **25.7 ms**       |
| `/shop`       | 15.2 ms     | 44.5 ms            | **25.6 ms**       |
| `/shop?q=…`   | 11.2 ms     | 57.4 ms            | **55.8 ms**       |
| device finder | 9.1 ms      | 8.6 ms             | 18.7 ms           |
| Throughput    | 66.6 req/s  | 43.0 req/s         | **51.5 req/s**    |

With the cache on at 1,066 products: **678.9 req/s**, p50 5.5 ms — the cache
does not care how big the catalogue is, which is exactly why the uncached
numbers still matter.

The index change is measured in
[database-performance.md](database-performance.md); the short version is that at
1,066 rows the optimiser abandoned `(status, archived_at)`, scanned the whole
table and sorted it, and adding the two `ORDER BY` columns to the tail of the
index took the collection query from 9.1 ms to 3.4 ms.

**Search is now the slow route and it was not fixed.** 55.8 ms at 1,066
products, and the reason is measured rather than guessed: the search predicate
itself is index-served (6 ms), but the collection query and the `COUNT(*)` that
pages it each evaluate the same UNION subquery separately — 16.9 ms and 15.0 ms.
Deriving the count from the same subquery is the obvious next step and is not
attempted here.

---

## 7. Honest summary

**What improved, with evidence:** anonymous catalogue latency by 80–87%,
throughput under concurrency by 9.6×, the collection query at scale by 2.7×,
and the LCP element on `/shop` is no longer deferred by a lazy-loading
attribute.

**What did not improve:** the cart, the checkout and every admin screen, none of
which are cached and none of which were touched. A returning visitor holding a
cart cookie gets no cached page anywhere, by design.

**What is worse:** four uncached routes by 0.2–1.0 ms each, from the
middleware's per-request inspection.

**What is unmeasured:** everything about Hostinger, every field metric, all
image transfer (the media store is empty), and the admin under load.

**What is not claimed:** that the site is fast, that it is optimised, or that it
will serve any particular number of visitors. It is faster than it was, by these
amounts, in this configuration, and the configuration is not the one the
merchant will run.
