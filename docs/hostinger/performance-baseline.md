# Performance baseline

Measured 2026-09-13 against the **target runtime**, not against Cloudflare and
not against a guess.

**Everything here is a LAB measurement on one developer machine.** It says what
a request costs in this configuration. It does not say what the merchant's
Hostinger plan can serve, and it is not a field measurement of what a customer
in Sulmona experiences on a phone. Both of those need the hosting account, which
is still unavailable — see [capability-audit.md](capability-audit.md).

Reproduce with `npm run performance:baseline` and `npm run performance:smoke`.

---

## 0. CORRECTION, 2026-09-14 — the numbers below are about 6× too slow

Re-measured the next day on the **same build, same database, same
configuration**, with the response cache switched off so the comparison is
like-for-like, this machine produced:

|                          | Published below | Re-measured 2026-09-14 |
| ------------------------ | --------------- | ---------------------- |
| Homepage p50             | 86 ms           | **14.6 ms**            |
| Throughput, 8 concurrent | 11.5 req/s      | **66.6 req/s**         |
| p50 under load           | 732 ms          | **80 ms**              |

Nothing in the application explains it. The likely cause is the machine: this
baseline was taken while the migration's own test runs were competing for it.
The project has already made that mistake once in a different form — 68
Playwright failures attributed to a "saturated server" that turned out to be its
own concurrent test runs.

**So the tables below overstate what a request costs.** They are left in place
rather than rewritten, because deleting a measurement that turned out to be
wrong is how the same mistake gets made again. What is still true of them: the
per-route QUERY COUNTS, the absence of N+1, the connection-pool behaviour and
the shape of the degradation under concurrency. What is not: the milliseconds.

For numbers to compare against, use
[performance-before-after.md](performance-before-after.md), where both halves
were measured in the same minute on a quiet machine.

---

## 1. What was measured

|          |                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Commit   | `731f7df` on `feat/hostinger-migration`                                                                       |
| Runtime  | Node **v24.14.1**                                                                                             |
| Database | **MariaDB 10.11.19**, local, `sql_mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| Server   | one Express process, `NODE_ENV=development`, `APP_ENV=staging`                                                |
| Pool     | `DB_CONNECTION_LIMIT=8`, plus a separate 2-connection pool for Better Auth                                    |
| Data     | the real migrated catalogue — 26 products, 38 variants, 36 device models, 1,792 rows total                    |
| Media    | filesystem store, 0 objects (media migration not yet run)                                                     |
| Host     | Windows 11, local loopback, no competing load                                                                 |

The database and the application are on the same machine, so **network latency
to the database is ~0 here and will not be on Hostinger.** Every figure below
therefore understates the deployed cost by however long a round trip to
Hostinger's database host takes. That number is check C-2's to supply.

---

## 2. Per-route cost

25 requests per route, 5 warm-up requests discarded.

| Route                | Class               | Status          | p50   | p95    | p99    | Bytes  | Queries |
| -------------------- | ------------------- | --------------- | ----- | ------ | ------ | ------ | ------- |
| `/`                  | anonymous catalogue | 200             | 86 ms | 101 ms | 108 ms | 35,477 | **12**  |
| `/shop`              | anonymous catalogue | 200             | 93 ms | 127 ms | 146 ms | 37,477 | **10**  |
| `/shop?q=cover`      | anonymous catalogue | 200             | 65 ms | 87 ms  | 92 ms  | 24,932 | **10**  |
| `/shop?q=usb-c`      | anonymous catalogue | 200             | 70 ms | 86 ms  | 89 ms  | 26,344 | **10**  |
| `/trova-dispositivo` | anonymous catalogue | 200             | 47 ms | 75 ms  | 84 ms  | 18,252 | **7**   |
| `/negozio`           | anonymous editorial | 200             | 47 ms | 68 ms  | 71 ms  | 16,639 | **6**   |
| `/carrello`          | personalised        | 200             | 54 ms | 70 ms  | 88 ms  | 16,416 | **5**   |
| `/en`                | anonymous catalogue | 200             | 96 ms | 103 ms | 105 ms | 36,352 | **12**  |
| `/api/health`        | operational         | 200             | 6 ms  | 8 ms   | 9 ms   | 457    | **1**   |
| `/robots.txt`        | static              | 200             | 5 ms  | 7 ms   | 8 ms   | 119    | 0       |
| `/admin` anonymous   | authenticated staff | **302 → login** | 7 ms  | 10 ms  | 18 ms  | 0      | 0       |

### No N+1 queries

The per-request instrumentation (`app/infrastructure/db/query-metrics.ts`)
records every statement, groups them by shape with literals stripped, and flags
any shape run five or more times in one request.

**Across every route above, no shape repeated five times.** The product grid
does not run a query per card: prices, primary image and stock come from
correlated subqueries inside the one collection statement.

Twelve queries for the homepage is not obviously right or wrong; it is the
number, and it is now a number a change can be measured against. Reducing it is
[§5 of the optimisation work](#5-what-is-not-yet-done) and is not attempted
here, because doing it before the baseline existed would have been guessing.

---

## 3. The process

|               | Idle         | After 20 s of load |
| ------------- | ------------ | ------------------ |
| RSS           | **105.9 MB** | **233.1 MB**       |
| Private bytes | 114.8 MB     | 265.8 MB           |
| OS threads    | 12           | 12                 |

Twelve threads is Node's default shape: the main thread, the four-worker libuv
pool that serves filesystem and crypto work, and V8's helpers. **It has not been
reduced and must not be** — collapsing the pool to manufacture a lower thread
count would make every `fs` and `bcrypt` call serialise behind the main thread,
which is the opposite of the goal.

Memory more than doubles under load and does not return immediately; that is V8
holding a grown heap, not a leak, but **it is not evidence of no leak.** A
twenty-second burst cannot distinguish the two. A soak test is
[still owed](#5-what-is-not-yet-done).

### Database connections

Measured on the server during the load run:

```
connections held for zamzam_staging   8
Max_used_connections                 10
```

Exactly the configured budget: 8 application + 2 Better Auth. The pool is
bounded and behaves as configured, which is the property that matters on a plan
where connections are capped per user.

---

## 4. Under concurrency

`npm run performance:smoke` — 8 concurrent clients, 20 seconds, a weighted
browse mix (homepage ×5, collection ×4, search ×2, device finder ×2, store ×1,
cart ×1).

|                                |                |
| ------------------------------ | -------------- |
| Requests                       | 233 in 20.3 s  |
| **Throughput**                 | **11.5 req/s** |
| Failures (5xx)                 | **0**          |
| Transferred                    | 6.7 MiB        |
| p50                            | 732 ms         |
| p95                            | 901 ms         |
| p99                            | 966 ms         |
| max                            | 1,027 ms       |
| Client event-loop delay (mean) | 14.9 ms        |

### Reading this honestly

Latency rises roughly **tenfold** from unloaded (p50 86 ms) to 8 concurrent
(p50 732 ms), while throughput settles at 11.5 req/s. That is the expected shape
for **one process rendering server-side HTML**: requests queue behind a single
event loop, and each one does real work — twelve database round trips and a
React render.

The client's own event-loop delay stayed at 15 ms mean, so the measuring harness
was not the bottleneck and the numbers describe the server.

**What this does and does not license saying:**

- It supports: _this configuration served 11.5 req/s of catalogue browsing with
  no errors and sub-second p99, on this machine._
- It does **not** support any claim about visitors per day, concurrent
  shoppers on the merchant's plan, or headroom beside their existing website.
  Throughput on Hostinger will differ — a slower shared CPU and a real network
  hop to the database both push it down; a warm InnoDB buffer pool pushes it up.

---

## 5. What is not yet done

Recorded so the gaps are visible rather than implied.

|                                | Why not                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Soak test (hours)              | **Now run** — 30 minutes, see [load-test-results.md](load-test-results.md).                                                                                         |
| Import-while-browsing          | The import path has not been exercised under concurrent load.                                                                                                       |
| Connection-exhaustion recovery | Not tested.                                                                                                                                                         |
| Cold-cache measurement         | Every figure above is warm.                                                                                                                                         |
| Media serving                  | The media migration has not run, so `/media/*` served 0 objects.                                                                                                    |
| Response caching               | **Now implemented.** Every route above is still the UNCACHED cost, which is what a cold cache pays. See [performance-before-after.md](performance-before-after.md). |
| Field (real-user) metrics      | Impossible without a deployment.                                                                                                                                    |
| CPU percent                    | Not observable per-process from inside; the hosting panel's graph is an account-wide aggregate and reading a per-application figure off it would be inventing one.  |
| Anything on Hostinger          | No access.                                                                                                                                                          |

---

## 6. Comparison with Cloudflare

Not attempted, and the reason is worth stating rather than leaving as an
omission: the deployed Worker runs on Cloudflare's edge from wherever the
measuring client is, against D1. Comparing that against a loopback request to a
process on the same machine measures the distance between two computers, not the
two implementations.

A meaningful comparison needs both deployed. That is a cutover-readiness
measurement, and it belongs in
[performance-before-after.md](performance-before-after.md) once Hostinger
staging exists.
