# Process topology and resource budget

What runs, how many of it, and what each one is allowed to consume.

Every measured number here comes from
[performance-baseline.md](performance-baseline.md). Every Hostinger number is
marked **UNVERIFIED** until capability checks C-1, C-2 and C-7 come back —
see [capability-audit.md](capability-audit.md).

---

## 1. What actually runs

### One Node process. No PHP.

```
Hostinger reverse proxy  (theirs — topology UNVERIFIED, see §2)
        │
        ▼
  node build/server-node/index.js        ONE process
        ├── Express 5                    routing, static assets, headers
        ├── React Router SSR             the same routes the Worker serves
        ├── mysql2 pool                  8 connections, bounded
        ├── mysql2 pool (Better Auth)    2 connections, bounded
        └── libuv thread pool            4 threads, Node's default, UNCHANGED
        │
        ▼
  MariaDB  (Hostinger's, over the network — NOT localhost, see C-2)
  Filesystem  PUBLIC_MEDIA_ROOT and PRIVATE_MEDIA_ROOT, outside the deploy dir
```

Measured: **12 OS threads**, RSS **105.9 MB idle / 233.1 MB after load**.

### What is deliberately absent

| Not used                                                 | Why                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PHP, WordPress, WooCommerce, Laravel                     | No PHP application code exists. The only place PHP could appear is a cron launcher, and the design in [jobs-and-email.md](jobs-and-email.md) does not need one.                                         |
| A second API server                                      | The storefront, the admin and the API are one origin and one process.                                                                                                                                   |
| Microservices                                            | Nothing here is large enough to justify a network hop between two parts of it.                                                                                                                          |
| A permanent queue daemon                                 | The outbox is database rows. A scheduled runner drains it; nothing sits resident.                                                                                                                       |
| Redis                                                    | Nothing yet needs shared state between processes, because there is one process. Adding it before that is true would be adding a service to manage and a failure mode to handle for no measured benefit. |
| PM2 cluster mode                                         | See §3.                                                                                                                                                                                                 |
| A worker process per request                             | —                                                                                                                                                                                                       |
| Browser automation                                       | —                                                                                                                                                                                                       |
| A dev server, hot reload or a file watcher in production | The server refuses to start without a build, and never runs Vite.                                                                                                                                       |

### The libuv thread pool is left alone

Four threads, Node's default. It serves `fs` and `crypto` work — which for this
application means reading product images off disk and hashing passwords.

**Shrinking it would not be an optimisation.** Every filesystem read and every
password hash would queue behind the main thread, so a single sign-in would
block page rendering. The thread count is not a resource to minimise; it is
what keeps blocking work off the event loop.

---

## 2. What Hostinger controls, and what we do not

**UNVERIFIED.** Hostinger runs its own supervisor in front of a managed Node
application, and how many instances it starts, whether it restarts on failure,
and what sits in front of the process are not things this repository decides.

What check **C-1** must establish:

- how many instances of the application Hostinger runs;
- whether that is configurable;
- whether the reverse proxy is per-instance or shared;
- the port/socket contract (the server reads `PORT` and does not choose one).

**Why it matters for every number below:** the connection budget in §4 assumes
ONE application instance. If Hostinger runs two, the budget doubles and
`DB_CONNECTION_LIMIT` must halve. Getting this wrong exhausts the per-user
connection cap and takes the shop down with a database error, not a slow page.

---

## 3. Why one process, and when that should change

The measurement: **11.5 req/s at 8 concurrent, p50 732 ms, zero errors.**

A single Node process serialises SSR on one event loop. Two processes would
roughly double throughput — and would also double RSS (to ~470 MB under load),
double the connection count, and require shared state for anything currently
held in memory.

That trade is **not** taken now, for reasons that are measurements rather than
preferences:

1. **The plan's RAM allowance is unverified.** On Web Premium (2 GB, shared with
   the merchant's existing website) two instances at 233 MB each is a
   meaningful fraction. On Cloud Startup (4 GB) it is not. Check C-7.
2. **The connection cap is the binding constraint, not CPU.** 50 connections per
   user on Web Premium, shared with staging, the job runner and migration
   tooling.
3. **There is no measured demand.** 11.5 req/s is ~1 million requests a day
   sustained. The shop has never taken an order.

**The trigger to revisit:** p95 above 1 s at the merchant's real concurrency, or
event-loop delay above 100 ms sustained. Both are measurable with
`npm run performance:smoke` and neither is guesswork.

If it is revisited, the change is Hostinger's instance count — not PM2 cluster
mode inside one managed app, which would put a supervisor inside a supervisor.

---

## 4. The connection budget

The binding constraint. **UNVERIFIED until C-1 names the plan.**

| Plan          | Cap per DB user | Documented                                                                                                              |
| ------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Web Premium   | 50              | [Hostinger plan limits](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/) |
| Web Unlimited | 75              | same                                                                                                                    |
| Cloud Startup | 100             | same                                                                                                                    |

Allocation, assuming ONE production instance and the Web Premium cap of 50:

| Consumer                    | Connections | Note                                            |
| --------------------------- | ----------- | ----------------------------------------------- |
| Production application pool | 8           | `DB_CONNECTION_LIMIT`                           |
| Production Better Auth pool | 2           | separate; Drizzle needs the driver's own pool   |
| Staging application pool    | 8           | **separate database user** — see below          |
| Staging Better Auth pool    | 2           |                                                 |
| Scheduled job runner        | 2           | short-lived, one at a time                      |
| Migration tooling           | 1           | run by hand, not resident                       |
| **Total**                   | **23**      | 46% of a 50 cap                                 |
| Headroom                    | 27          | for a redeploy overlapping the previous process |

**Staging must use a different database user**, not just a different database.
The cap is per USER, so sharing one would let a staging load test starve
production of connections.

The headroom is not spare capacity, it is the redeploy margin: during a restart
the old process may still hold its connections while the new one opens its own.
Graceful shutdown closes both pools (`server/index.ts`), which is what keeps
that window to seconds instead of until the server's `wait_timeout`.

Measured during the load run: **8 held, `Max_used_connections` 10.** Exactly
the configured budget.

---

## 5. The memory budget

**UNVERIFIED.** The plan's RAM allowance is C-7's to supply, and it is shared
with the merchant's existing website.

Measured for this application:

|                                |                                         |
| ------------------------------ | --------------------------------------- |
| Idle RSS                       | 105.9 MB                                |
| RSS after 20 s at 8 concurrent | 233.1 MB                                |
| Growth over hours              | **UNKNOWN — no soak test has been run** |

Bounded by design:

| Bound                       | Value         | Where                                                                                                                                  |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Request body                | 12 MB         | `MAX_REQUEST_BYTES`, `server/index.ts` — checked on the declared length AND counted on the stream, because `Content-Length` can lie    |
| Statement-translation cache | 2,000 entries | `mariadb.ts` — a route that builds SQL from filters produces a new string per combination, and an unbounded cache there is a slow leak |
| Per-request query records   | 2,000         | `query-metrics.ts` — instrumentation must not become the leak it was added to find                                                     |
| Media reads                 | streamed      | `FilesystemObjectStore.get` returns a stream; a 5 MB image is never fully in the heap                                                  |
| Import batches              | 200 rows      | `import-mariadb.mjs`, NDJSON read line by line                                                                                         |

**Not yet bounded, and owed:** upload processing concurrency, export size,
search result-set size, admin page size. Each is listed in
[jobs-and-import-limits.md](jobs-and-import-limits.md).

---

## 6. Disk and inodes

**UNVERIFIED** — C-3 and C-7.

Known sizes:

|                            |                                      |
| -------------------------- | ------------------------------------ |
| D1 database                | 1.94 MB, 1,792 rows                  |
| R2 media bucket            | 5.87 MB, 70 objects                  |
| R2 proofs bucket           | 0 B, 0 objects                       |
| Node build output          | ~1 MB server + client assets         |
| `node_modules` on the host | **the inode consumer, not the data** |

Inodes are the limit worth watching, not bytes. A `node_modules` tree is tens of
thousands of small files, and the plan caps inodes at 400,000 (Web Premium)
shared with the merchant's existing website. `npm ci --omit=dev` on the host
keeps the dev chain — wrangler, vite, playwright — off the disk entirely.

---

## 7. Scheduled work

|                         |                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron timezone           | **UTC**, [documented](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/) — same as Cloudflare, so schedule semantics do not change |
| Minimum interval        | **UNVERIFIED** — C-5                                                                                                                                              |
| `node` on the cron PATH | **UNVERIFIED** — C-4                                                                                                                                              |
| Current jobs            | one: the reservation sweeper, every 5 minutes on Cloudflare                                                                                                       |
| Job history             | `scheduled_job_runs`, 1,221 rows migrated                                                                                                                         |

The design does not depend on `node` being available to cron. See
[jobs-and-email.md](jobs-and-email.md).

---

## 8. The rule that keeps this true

Recorded in CLAUDE.md so a later change cannot quietly undo it:

- **One pool per process.** Never construct a pool inside a request handler.
- **Every pool is bounded**, and its size is budgeted here before it changes.
- **Every unbounded read is a bug.** Result sets, uploads, exports and imports
  are bounded by rows, bytes or time.
- **Measure before and after.** `npm run performance:baseline` and
  `npm run performance:smoke`, recorded in
  [performance-before-after.md](performance-before-after.md).
