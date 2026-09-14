# Load test results

Three runs: a short burst, a thirty-minute soak, and the same measurements
against a catalogue forty-one times the size of the real one.

**Every figure here is a LAB measurement on one developer machine over
loopback.** Nothing in this document was run against Hostinger, and nothing in
it may be. The shared live hosting account has not been load-tested and must
not be without the merchant's explicit approval: it is shared with their other
website, and saturating it affects a site this project is not allowed to touch.

Raw results: `test-results/performance/`.

---

## 1. What was measured against

|           |                                                                               |
| --------- | ----------------------------------------------------------------------------- |
| Runtime   | Node v24.14.1, one Express process, `NODE_ENV=development`, `APP_ENV=staging` |
| Database  | MariaDB 10.11.19, local, port 3399                                            |
| Pool      | 8 application connections + 2 for Better Auth                                 |
| Catalogue | `zamzam_staging` — 26 products; and `zamzam_scale` — 1,066 products           |
| Media     | **0 objects.** No image bytes are in any number here.                         |
| Client    | The same machine. Its own event-loop delay is measured, as a sanity check.    |
| Host      | Windows 11, loopback, nothing else running                                    |

The client and the server share a CPU. The harness reports its own event-loop
delay for exactly that reason: at 12–15 ms mean it was not the bottleneck, and
if it had climbed the run would not have been describing the server.

---

## 2. Burst: 8 concurrent clients, 20 seconds

Weighted browse mix — homepage ×5, collection ×4, search ×2, device finder ×2,
store ×1, cart ×1.

| Catalogue      | Cache | Throughput      | p50    | p95    | p99    | Failures |
| -------------- | ----- | --------------- | ------ | ------ | ------ | -------- |
| 26 products    | off   | 66.6 req/s      | 80 ms  | 326 ms | 389 ms | 0        |
| 26 products    | on    | **639.2 req/s** | 5.7 ms | 47 ms  | 86 ms  | 0        |
| 1,066 products | off   | 51.5 req/s      | 118 ms | 375 ms | 419 ms | 0        |
| 1,066 products | on    | **678.9 req/s** | 5.5 ms | 40 ms  | 82 ms  | 0        |

**The cached numbers are almost identical at both catalogue sizes**, which is
the expected shape and also the reason the uncached numbers still matter: a
cold cache pays the real cost, and the real cost grows with the catalogue.

**The hit rate in these runs was 0.997.** The load generator draws from six
URLs; real traffic does not. A shop with 26 products has a tail of product
pages, and the honest expectation in the field is a hit rate well below this.
Treat 639 req/s as the ceiling of this configuration, not as a forecast.

---

## 3. Soak: 30 minutes, 2 concurrent clients

The question the burst could not answer. RSS went from 105.9 MB to 233.1 MB in
twenty seconds and did not come back, which is equally consistent with V8
holding a heap it grew and with a leak.

```
519,425 requests   0 failures   30.0 minutes
```

| Sample window | RSS floor | RSS ceiling |
| ------------- | --------- | ----------- |
| 0–5 min       | 346 MB    | 353 MB      |
| 5–10 min      | 341 MB    | 365 MB      |
| 10–15 min     | 341 MB    | 360 MB      |
| 15–20 min     | 346 MB    | 369 MB      |
| 20–25 min     | 347 MB    | 372 MB      |
| 25–30 min     | 348 MB    | 372 MB      |

|                                |                    |
| ------------------------------ | ------------------ |
| Threads                        | 12–14, no trend    |
| **Handles**                    | **262, unchanged** |
| p95, first half → second       | 31.1 ms → 31.9 ms  |
| Least squares over all samples | **+30.7 MB/hour**  |
| Least squares over the FLOOR   | **+11.3 MB/hour**  |

### Reading it

The two slopes disagree by a factor of three, and the difference is the whole
interpretation.

The samples oscillate by ~25 MB within every five-minute window — that is the
garbage collector, and a straight line through it mostly measures where in the
GC cycle each sample happened to land. **The floor is the number that a leak
moves**, and the floor went 346 → 341 → 341 → 346 → 347 → 348 MB: it dips and
then returns, ending 2 MB above where it started after half a million requests.

Two other things point the same way:

- **The handle count did not move.** 262 at minute one and 262 at minute
  twenty-nine. A leak of sockets, file handles or database connections shows
  here first, and there is nothing.
- **p95 did not move.** 31.1 ms over the first half, 31.9 ms over the second.
  A process accumulating work slows down; this one did not.

**Conclusion, stated at the strength the evidence supports:** thirty minutes and
half a million requests produced no evidence of a leak. It is not proof of the
absence of one — a leak of a few hundred kilobytes an hour would be invisible
in this noise, and an eight-hour run is what would see it. What can be said is
that nothing accumulated fast enough to matter over a working day.

### The RSS number itself

341–372 MB is much higher than the 105.9 MB idle recorded in the original
baseline, and most of it is not the cache: **the cache held 0.11 MiB** for the
entire run. It is V8's heap under sustained load, on a machine with plenty of
memory and therefore no reason to give any back.

That has a direct consequence for the hosting plan, and it is the one number in
this document that should worry somebody: **a Node process serving this
application under load wants a few hundred megabytes.** Whether the merchant's
plan allows that, beside their existing website, is capability check C-1's
question and it is unanswered. On a smaller allowance the process will collect
more aggressively and run slower, and none of the throughput figures above
would hold.

---

## 4. At forty-one times the catalogue

`npm run scale:fixture -- --copies 40` builds `zamzam_scale`: the real
catalogue multiplied, 1,066 products and 30,996 catalogue rows in 4.8 MB.

Uncached, per route:

| Route                | 26 products | 1,066 (before index) | 1,066 (after index) |
| -------------------- | ----------- | -------------------- | ------------------- |
| `/`                  | 14.6 ms     | 28.1 ms              | 25.7 ms             |
| `/shop`              | 15.2 ms     | 44.5 ms              | **25.6 ms**         |
| `/shop?q=cover`      | 11.2 ms     | 57.4 ms              | 55.8 ms             |
| `/shop?q=usb-c`      | 12.5 ms     | 60.5 ms              | 58.9 ms             |
| `/trova-dispositivo` | 9.1 ms      | 8.6 ms               | 18.7 ms             |
| `/negozio`           | 6.9 ms      | 16.9 ms              | 7.0 ms              |
| Throughput           | 66.6 req/s  | 43.0 req/s           | **51.5 req/s**      |

**Query counts did not change at any size.** The homepage runs 12 statements
against 26 products and 12 against 1,066; the collection runs 10 and 10. There
is no N+1 hiding behind the small catalogue.

**41× the data cost 2–5× the time**, which is sub-linear and is what indexed
access should look like. The one place it was not — the collection query, where
the optimiser abandoned the index and sorted the whole table — is measured and
fixed in [database-performance.md](database-performance.md).

**Search is the remaining slow route, at 55.8 ms.** The cause is measured
rather than assumed: the search predicate is index-served (6 ms), but the
listing query and the `COUNT(*)` that pages it evaluate the same UNION subquery
independently, at 16.9 ms and 15.0 ms. Deriving the count from the same
subquery is the obvious next step and is not attempted here.

### A caveat that makes these numbers pessimistic

The fixture multiplies 26 real products, so every copy shares a brand, a
category and a compatibility set. Index selectivity is far worse than a genuine
catalogue of the same size, and the search tokens repeat so a full-text query
matches proportionally more rows. Both errors are in the safe direction.

---

## 5. What was NOT tested

Listed because a load-test document that only reports what was run implies the
rest was fine.

|                                          |                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Hostinger**                            | Never. Requires the merchant's explicit approval, which has not been given, and the account, which we lack.                   |
| Anything with images                     | The media store holds zero objects. Photographs are ~94% of a real page — see [media-optimisation.md](media-optimisation.md). |
| The admin under load                     | Never load-tested. It is uncached and it is not on the customer path.                                                         |
| An import while the shop is browsed      | The interaction that matters on a shared plan. Not exercised.                                                                 |
| Connection exhaustion and recovery       | What happens when the app's 8, the job runner's 2 and another site collide with the plan's per-user cap.                      |
| Cold start                               | Every figure is warm — warm InnoDB buffer pool, warm V8. First-request cost is not measured.                                  |
| A soak longer than 30 minutes            | A slow leak would need hours to become visible above the GC noise.                                                            |
| Checkout, payment verification, WhatsApp | Write paths and third-party endpoints. Load-testing somebody else's service is not ours to do.                                |
| Field metrics — LCP, CLS, INP            | Need real visitors on a real deployment.                                                                                      |

---

## 6. Reproducing

```bash
npm run mariadb:start
npm run build:hostinger

npm run performance:compare              # cache off vs on, both halves in one run
npm run performance:soak -- --minutes 30 # memory over time
npm run scale:fixture -- --copies 40     # builds zamzam_scale
```

`performance:compare` and `performance:soak` start their own server and refuse
to run if something is already listening on the port. That guard exists because
a leftover server from an earlier run once answered the health check and an
entire isolation run measured a build from before the feature being tested.
