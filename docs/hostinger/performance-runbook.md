# Performance runbook

What to do when the shop is slow, in the order to do it.

Written for whoever is looking at it at the time, which may not be whoever built
it. Every step says what to run, what a healthy answer looks like, and what the
answer rules out.

---

## 0. Before anything else: is it the shop?

Two minutes, and it decides which half of this document is relevant.

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' https://<host>/api/health
curl -s https://<host>/api/health | jq
```

| Answer                      | Means                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| 200 in well under a second  | The process is up and the database answers. The problem is a specific route or the network.             |
| 200 but slow                | The process is up and something is saturating it. Go to §2.                                             |
| `checks.database.ok: false` | Not a performance problem. Go to §3.                                                                    |
| No answer at all            | Not a performance problem. The application is down — [operations-runbook.md](../operations-runbook.md). |
| 421 Misdirected             | The Host header is not in `TRUSTED_HOSTS`. A configuration problem wearing a performance costume.       |

`/api/health` is deliberately unauthenticated and `no-store`: the thing most
likely to be broken is authentication, and a health check that needs a working
login cannot tell you the login is broken.

---

## 1. Is the cache working?

The single most likely cause of "it got slow and nothing changed".

```bash
curl -s -H "x-job-secret: $JOB_AUTH_SECRET" https://<host>/api/cache-stats | jq
```

```json
{
  "enabled": true,
  "ttlMs": 60000,
  "version": 1789344287317,
  "hitRate": 0.83,
  "hits": 12419,
  "misses": 2544,
  "entries": 41,
  "bytes": 1994304,
  "refusals": { "path": 978, "cookie": 310, "content-type": 30 }
}
```

| Reading                            | What it means                                      | What to do                                                                                     |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `enabled: false`                   | Somebody set `RESPONSE_CACHE=off`.                 | Turn it back on, unless the person who turned it off is still debugging.                       |
| `hitRate` near 0 with real traffic | Something bumps the version constantly.            | §1a.                                                                                           |
| `invalidated` climbing fast        | Same cause, seen from the other side.              | §1a.                                                                                           |
| `stale-render` climbing            | Writes landing during renders.                     | Normal during a busy import. Sustained, it means a mutation on a hot path.                     |
| `entries` at 500 or `bytes` at cap | Eviction is churning.                              | More distinct URLs than the budget holds. Raise `RESPONSE_CACHE_MAX_ENTRIES` if memory allows. |
| `refusals.cookie` large            | Normal. Every returning visitor with a cart.       | Nothing. This is the isolation rule doing its job.                                             |
| 404 from this endpoint             | `JOB_AUTH_SECRET` is unset or the header is wrong. | Not a cache problem.                                                                           |

### 1a. Something keeps emptying the cache

Watch `version` over a minute:

```bash
for i in $(seq 6); do
  curl -s -H "x-job-secret: $JOB_AUTH_SECRET" https://<host>/api/cache-stats | jq -r .version
  sleep 10
done
```

It should change only when staff save something. If it changes constantly with
nobody in the admin, something is sending credentialed mutations — a stuck
browser tab retrying a form, a monitoring probe with a cookie, a mis-set cron.
[cache-invalidation.md §3](cache-invalidation.md) lists exactly what qualifies.

---

## 2. It is slow and the cache is fine

### 2a. Which route?

```bash
npm run performance:baseline -- --base https://<host>
```

Compare against [performance-before-after.md §4](performance-before-after.md).
A single route far off its number is a query; **every** route off by a similar
factor is the machine or the database connection.

### 2b. How many queries is it running?

On a non-production environment every request logs its query count:

```
[queries] GET /shop 10 queries, 12ms
[queries] GET /shop 10 queries, 358ms   ← same queries, 30× the time
```

Same count, more time → the database, not the code. A **rising** count for the
same route → an N+1 has been introduced; the instrumentation flags any statement
shape repeated five times in one request.

The instrumentation is off in production, because `AsyncLocalStorage` has a real
cost on a hot path. To use it, reproduce on staging.

### 2c. Is it the database?

```sql
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Max_used_connections';
SHOW FULL PROCESSLIST;
```

Expected: 8 application connections plus 2 for Better Auth, plus 2 more while a
job runs. `Max_used_connections` at the plan's per-user cap means something —
possibly another application on the account — is exhausting it, and every
request is then waiting for a connection rather than for a query.

For a slow query, get the plan:

```sql
EXPLAIN <the query>;
```

`type: ALL` with `Using filesort` on a large table is the shape that caused the
one index change this project has made — see
[database-performance.md](database-performance.md).

### 2d. Is it the process?

```bash
npm run performance:soak -- --minutes 10
```

Reports RSS, private bytes, thread count, handle count and per-interval p95.
Memory flat and p95 flat means the process is fine and the problem is upstream.
Memory climbing steadily is §4.

---

## 3. The database is not answering

Not a performance problem, but it arrives looking like one.

1. `checks.database.ok: false` in `/api/health` — read `checks.database.error`.
2. Wrong host or credentials → configuration. `npm run validate-env`.
3. Connection refused → the database server, or the plan's connection cap.
4. Timeouts under load only → the cap, or another application on the account.

The application does **not** run migrations at startup, so a schema mismatch
never presents as a startup failure. `npm run hostinger:migrate` (dry run by
default) says what is pending.

---

## 4. Memory

```bash
npm run performance:soak -- --minutes 30
```

The output's `drift (settled)` is megabytes per hour over the second two-thirds
of the run.

There is no pass mark, and that is deliberate: the right threshold depends on
the plan's memory allowance, which the hosting account has not yet told us.
What to read:

| Pattern                                   | Means                                                         |
| ----------------------------------------- | ------------------------------------------------------------- |
| Step up, then flat with a saw-tooth       | V8 holding a heap it grew. Normal.                            |
| Steady climb with a flat handle count     | An object graph accumulating. A leak in application code.     |
| Steady climb with a climbing handle count | Sockets or file handles not being released. A different leak. |
| Thread count moving                       | Something is creating threads. Nothing here should.           |

If the cache is suspected, the fastest test is to remove it from the equation:
restart with `RESPONSE_CACHE=off` and soak again. It is bounded to
`RESPONSE_CACHE_MAX_MB` (24 MB) and reports its own `bytes`, so it should be
easy to exonerate.

---

## 5. It got slow after a deploy

In this order, because each is faster to check than the next:

1. **Is the cache cold?** A deploy empties it. Give it a minute.
2. **Did the build change?** `/api/health` reports the commit. Compare with what
   was deployed.
3. **Did a migration run?** `npm run hostinger:migrate` (dry run). An index that
   was dropped and not recreated is the classic.
4. **Did the catalogue grow?** `SELECT COUNT(*) FROM products`. Query plans
   change with size — that is the whole reason `npm run scale:fixture` exists.
5. **Roll back.** The deployment is a directory swap
   ([deployment.md](../deployment.md)). Diagnose afterwards.

---

## 6. Measuring safely

**Never load-test the shared live hosting account without the merchant's
explicit approval.** It is shared: saturating it affects their other website,
and the plan's terms may treat it as abuse. Nothing in this project has been run
against Hostinger, and that is a rule rather than an omission.

Also never load-test third-party payment, WhatsApp or SMTP endpoints. They are
somebody else's service.

Safe anywhere:

| Command                        | What it does                                         | Load              |
| ------------------------------ | ---------------------------------------------------- | ----------------- |
| `curl /api/health`             | One request.                                         | None              |
| `curl /api/cache-stats`        | One request.                                         | None              |
| `npm run performance:baseline` | 25 requests per route, sequential.                   | Trivial           |
| `npm run performance:smoke`    | 8 concurrent for 20 s.                               | **Real**          |
| `npm run performance:soak`     | 2 concurrent for N minutes.                          | Modest, sustained |
| `npm run performance:compare`  | Starts two local servers and runs both of the above. | Local only        |
| `npm run test:cache-isolation` | Starts a local server, ~40 requests.                 | Local only        |

The last two start their own server and refuse to run if something is already
on the port — measuring a server the script did not start means measuring an
unknown build, and that has already produced one wrong result in this project.

---

## 7. Reproducing locally

```bash
npm run mariadb:start                  # MariaDB 10.11 on port 3399
npm run build:hostinger                # the Node build, not wrangler
npm run hostinger:server               # serves on http://127.0.0.1:3210
```

Then, in another terminal:

```bash
npm run performance:baseline
npm run performance:smoke
```

At forty times the catalogue:

```bash
npm run scale:fixture -- --copies 40   # builds zamzam_scale, never touches staging
DB_NAME=zamzam_scale npm run hostinger:server
```

`scale:fixture` refuses any target database whose name does not contain
"scale", because it drops the target first.

---

## 8. Knobs, and when to turn them

| Variable                     | Default | Turn it when                                                                        |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `RESPONSE_CACHE`             | `on`    | A page is stale and you need to know whether the cache is why. Off, then reproduce. |
| `RESPONSE_CACHE_TTL_MS`      | 60000   | Rarely. Lower only if a stale page is reported and the version bump is not firing.  |
| `RESPONSE_CACHE_MAX_ENTRIES` | 500     | `evictions` climbing on a catalogue with many URLs.                                 |
| `RESPONSE_CACHE_MAX_MB`      | 24      | Memory pressure — down. Never up without knowing the plan's allowance.              |
| `DB_CONNECTION_LIMIT`        | 8       | Only after counting every other consumer of the plan's per-user cap.                |

**`DB_CONNECTION_LIMIT` is the one to be careful with.** The cap is per database
user and is shared with staging, the job runner, migration tooling and any other
application on the account. Raising it here is taking connections from
somewhere; count them in
[process-and-resource-budget.md](process-and-resource-budget.md) first.

---

## 9. What this runbook cannot help with

|                                    |                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| "It is slow for one customer"      | That is a field problem — their network, their device. Nothing here measures it.     |
| LCP, CLS, INP                      | Field metrics. They need real visitors and a real deployment.                        |
| Image load times                   | The local media store is empty; the media migration is blocked on Hostinger access.  |
| Anything about the merchant's plan | Unmeasured. Every number in this project is a lab number from one developer machine. |
| The admin under load               | Never load-tested. It is not cached and it is not on the customer path.              |
