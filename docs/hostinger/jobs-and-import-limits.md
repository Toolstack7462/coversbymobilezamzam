# Scheduled jobs and import limits

The work that happens without anybody watching, and the bounds that stop it
becoming the reason the shop is down.

---

## 1. The gap this closes

On Cloudflare, `workers/app.ts` exports a `scheduled` handler and the platform
calls it every five minutes.

**Nothing called it on the Node runtime.** The migration had ported the routes,
the database and the storage, and the scheduled work had no equivalent at all.

That is not a missing nicety. The one job is the reservation sweeper, and
without it:

- stock stays reserved against orders nobody ever paid for;
- `available` — which is `on_hand` minus `reserved` — falls towards zero;
- the shop stops being able to sell things that are sitting on the shelf;
- nothing reports it. The numbers are simply wrong, and they get worse daily.

`server/jobs.ts` is the equivalent. It is new work, not a port: the Worker's
`scheduled` export has no meaning outside Cloudflare.

---

## 2. The jobs

| Job                   | What it does                                            | Interval  | Idempotent |
| --------------------- | ------------------------------------------------------- | --------- | ---------- |
| `expire-reservations` | Releases stock held by orders that were never paid for. | 5 minutes | Yes        |

One job. The registry is a map rather than a switch so that the HTTP endpoint,
the CLI runner and this table cannot disagree about what exists.

**Every job must be idempotent, and this one is by construction.** It claims
each reservation with a conditional update, so two overlapping runs cannot
release the same reservation twice, and it re-checks payment _after_ claiming,
which closes the race where a customer pays at minute 119 and staff verify at
minute 121. Cron delivery is at-least-once on every platform, and a job that is
only correct when run exactly once will one day be run twice.

---

## 3. Two ways to launch it, because one of them may not exist

Capability check C-4 asks whether Hostinger's cron can run `node` — whether it
is on the PATH and which one. It is unanswered, so the design does not depend
on the answer.

### If cron can run node

```
*/5 * * * *  cd ~/apps/zamzam && /usr/bin/env node scripts/hostinger/run-job.mjs expire-reservations
```

A separate process with its own two-connection pool. It does the work and
exits. Nothing depends on the web application being up — which is the property
that matters at 3am, when the thing that is broken is the web application.

It exits non-zero on failure, which is how cron's mail and hPanel's job history
report one.

### If cron can only run curl

```
*/5 * * * *  curl -fsS -X POST -H "x-job-secret: $JOB_AUTH_SECRET" https://<host>/api/jobs/run
```

No new process and no new connection pool: the application is already running.

`POST`, not `GET` — it changes data, and a `GET` that changes data is one
prefetcher away from running itself.

### Neither is preferred

The node runner survives an unhealthy application; the HTTP endpoint costs
nothing extra. Pick whichever C-4 says is available; if both are, prefer the
node runner for the independence.

---

## 4. The secret is a header, never a URL

A cron command line appears in hPanel's job list and in the process listing on
the machine. A secret in a query string is a secret on somebody else's screen.

`JOB_AUTH_SECRET` goes in a header, it is compared with `timingSafeEqual`
(`===` on a secret leaks its length and matching prefix through timing, and
removing that costs one function call), and a wrong or missing secret gets
**404, not 401** — an unauthenticated caller learns nothing about whether this
deployment has scheduled work at all.

With `JOB_AUTH_SECRET` unset, the endpoint refuses everything. That is
deliberate: a job endpoint that works without configuration is a job endpoint
anybody can run.

---

## 5. Overlap

Two protections, and the difference between them matters:

**In-process.** A map of in-flight runs. A second request for a job already
running _awaits the run in progress_ rather than starting a second one or
returning "busy" — the caller asked for the job to have run, and it will have
when the response arrives.

**Across processes: none.** Two Passenger workers each have their own copy of
that map, and the CLI runner shares nothing with either. This is written here
because a reader who believes it is a distributed lock will eventually write a
job that relies on it. The real protection against concurrent runs is that
every job is idempotent. If a job ever appears that is not, it needs a database
lock, and that is a design decision to take deliberately rather than to
discover.

---

## 6. Resource budget

| Path          | Processes    | Connections                       | Notes                                               |
| ------------- | ------------ | --------------------------------- | --------------------------------------------------- |
| CLI runner    | 1, transient | **2**                             | Fixed at 2, deliberately not `DB_CONNECTION_LIMIT`. |
| HTTP endpoint | 0 new        | Borrowed from the application's 8 | No new pool.                                        |

The CLI runner ignores `DB_CONNECTION_LIMIT` on purpose. A job runner that can
open the web application's entire connection budget is a job runner that takes
the shop down every five minutes. Two connections: one for the work, one spare
so a slow release cannot deadlock a single-connection pool against itself.

Both are counted in
[process-and-resource-budget.md](process-and-resource-budget.md).

The sweeper's own work is bounded by `batchSize`, default 100 reservations per
run. At five-minute intervals that is 1,200 an hour, far above anything this
shop will produce, and it means one run cannot become unboundedly long because
a backlog built up while cron was misconfigured.

---

## 7. Import limits

### What an import does

1. **Analyse.** The file is read, the delimiter detected (Italian Excel writes
   `;`), every row planned against the current catalogue, and the merchant is
   shown what would change. Nothing is written.
2. **Apply.** The file is re-parsed and **re-planned against the catalogue as it
   is now** — another member of staff may have changed a price in between, and
   applying a stale plan would quietly undo their work — and then applied row by
   row.

### The limits, and where each number comes from

| Limit         | Value     | Why                                                                                           |
| ------------- | --------- | --------------------------------------------------------------------------------------------- |
| File size     | **5 MB**  | Pre-existing. The whole file is held in memory and carried between the two steps in the form. |
| Rows          | **2,000** | New. See the arithmetic below.                                                                |
| Request body  | 12 MB     | `server/index.ts`, enforced by a byte counter rather than `Content-Length`, which can lie.    |
| Sweeper batch | 100       | Per run, every 5 minutes.                                                                     |

**The row cap, and the arithmetic behind it.** A changed row costs about six
database round trips: two reads to find the variant and its current price, then
a four-statement transaction for the price, the price history and the audit
entry. Measured on the target stack over a loopback connection:

```
update-path reads per row          1.0 ms
four-statement transaction         1.5 ms
                                   ───────
                                   ~2.5 ms per changed row
```

On Hostinger the database is on another host, so each of those round trips pays
a real network hop. At a pessimistic **15 ms per row**, 2,000 rows is about
thirty seconds — inside any reverse proxy's patience with room to spare.

That number is an **assumption about Hostinger's database latency**, and it is
written down as one so it can be corrected when capability check C-2 measures
it, rather than sitting in the code as an unexplained constant.

**Why a cap and not a queue.** A queue is the right answer for a shop importing
fifty thousand rows. This shop has twenty-six products, and the optimisation
brief rules out a permanent queue daemon. A cap is honest about the limit: a
file over it is refused **before anything is written**, with a message saying to
split it. Accepting it and timing out halfway leaves the catalogue
half-updated with no record of where it stopped, which is the worst of the
three outcomes.

**Checked twice, on analyse and on apply.** The payload is carried in the form
between the two steps, so a caller who skips the first screen — or edits the
hidden field — would otherwise reach the write loop with an unbounded file. A
limit enforced only on the screen that shows it is not a limit.

---

## 8. What an import does NOT do

|                                 |                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change a price without a record | Every price change writes `price_history` exactly as a manual edit does. An import must not be a way around D.Lgs. 84/2022.                               |
| Run without a permission        | `import.run`, checked on both steps.                                                                                                                      |
| Run in the background           | It is synchronous inside the request. That is what the row cap is for.                                                                                    |
| Resume                          | There is no checkpoint. A failure mid-apply leaves the rows before it applied and the rows after it not, and `import_jobs` records the totals it planned. |
| Write to `import_job_rows`      | The table exists and nothing writes it. Per-row outcomes live only in the response. Recorded here as a real gap, not a design.                            |

---

## 9. Not tested, and what it would take

|                                        |                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| An import at the 2,000-row cap         | Needs an authenticated admin session against the Node runtime. The browser suite runs against `wrangler dev` and D1. |
| Import while the shop is being browsed | The interaction that matters on a shared plan — an import holding connections while customers wait. Not exercised.   |
| Cron on Hostinger                      | C-4. Nothing about the launcher can be verified without the hosting account.                                         |
| The sweeper against real expiries      | There are no orders. It has been run against the migrated database and correctly reported `examined: 0`.             |
| Connection exhaustion recovery         | What happens when the job runner's 2 and the application's 8 collide with the plan's per-user cap. Needs the plan.   |
