# CPU on the free plan — measured

> **The finding: this shop renders close to the free plan's CPU ceiling.**
> Median 4–7ms against a 10ms limit, with peaks touching 10–11ms on the two
> heaviest pages. Nothing has been terminated, and nothing is broken. But the
> headroom is roughly one page's worth of extra work, and that is worth knowing
> before traffic arrives rather than after.

Measured 31 August 2026 against the deployed preview, version `c49a18a9`.

---

## What the limit is

From Cloudflare's own documentation:

| Limit                     | Workers Free | Workers Paid                |
| ------------------------- | ------------ | --------------------------- |
| CPU time per HTTP request | **10 ms**    | 5 min (default: 30 seconds) |
| CPU time per Cron Trigger | **10 ms**    | 30 seconds                  |

CPU time is time spent _executing_. Waiting on D1, R2 or any other network call
does not count, which is why response time is no guide at all: the pages below
answer in 160–370ms of wall time while using 4–8ms of CPU.

Two details matter for reading the numbers:

- Exceeding the limit does not make a request slow. It **terminates** it, the
  customer gets Cloudflare error 1102, and the invocation is recorded as
  `exceededCpu`.
- An isolate has, in Cloudflare's words, "some built-in flexibility to allow for
  cases where your Worker infrequently runs over the configured limit", and
  terminates only once a Worker "starts hitting the limit consistently". So the
  11ms peak below was served successfully. It is a warning about sustained
  traffic, not a fault visible on a quiet preview.

For context, Cloudflare puts the average Worker at ~2.2ms and says workloads
that "handle authentication, server-side rendering, or parse large payloads
typically use 10-20 ms". This shop is all three.

---

## The measurements

70 invocations, seven per route, against the deployed preview:

| Route                | n   | max      | median | wall  |
| -------------------- | --- | -------- | ------ | ----- |
| `/trova-dispositivo` | 7   | **11ms** | 6ms    | 340ms |
| `/`                  | 7   | **10ms** | 7ms    | 192ms |
| `/prodotti/:slug`    | 7   | 9ms      | 6ms    | 356ms |
| `/en/shop`           | 7   | 8ms      | 6ms    | 183ms |
| `/shop`              | 7   | 7ms      | 5ms    | 184ms |
| `/en`                | 7   | 7ms      | 5ms    | 186ms |
| `/carrello`          | 7   | 6ms      | 4ms    | 172ms |
| `/negozio`           | 7   | 6ms      | 4ms    | 177ms |
| `/admin/accedi`      | 7   | 6ms      | 5ms    | 6ms   |
| `/api/health`        | 7   | 2ms      | 2ms    | 349ms |

Every invocation returned `outcome: "ok"`. None was terminated.

The gap between median and max is the interesting part: the same route costs
4ms sometimes and 10ms other times. That spread is isolate startup and garbage
collection, not the page doing different work — which means the peak is not
something the code can be tuned out of, only made smaller overall.

`/api/health` at 2ms against 349ms of wall time is the clearest illustration of
what CPU time measures: it spends almost all of its time waiting on D1 and two
R2 buckets, and almost none of it computing.

---

## The cron is the sharper risk

The same 10ms applies to each Cron Trigger invocation, and the reservation
sweeper is the one piece of code here written to process a **batch**:
`expireReservations` takes up to 100 rows per run.

On this preview it completes in 16ms of wall time with nothing to do. With a
hundred expired reservations to release — each one a claim, a stock movement and
an update — it will do considerably more work, and it has the same 10ms as a
page render.

**This has not been measured under load, because there is no load to measure.**
It is flagged here rather than asserted either way. Before the shop takes real
orders, either measure it with a realistic backlog or reduce `batchSize` so a
run is bounded by something known.

---

## How to reproduce

Two terminals, because the tail has to be running while the traffic runs:

    npx wrangler tail --env preview --format json > tail.jsonl

then drive traffic, then:

    node scripts/verify/cpu-report.mjs tail.jsonl

The script groups by route, collapses URL parameters, reports max and median
against the 10ms limit, and exits non-zero if anything is at or over it or was
terminated for CPU.

---

## What this means

**Nothing needs fixing today.** The preview serves every page correctly and no
request has been terminated.

What it does mean:

1. **The free plan is a real constraint for this shop, not a formality.** A
   server-rendered storefront is at the upper end of what 10ms allows.
2. **New work on the hot pages costs headroom.** Anything added to the homepage
   or the device finder spends from a 2ms margin.
3. **The paid plan removes the ceiling entirely** — 30 seconds by default rather
   than 10ms, for $5/month. If the shop takes real orders, that is the answer,
   and it is a smaller decision than optimising the render path.
4. **Watch for `exceededCpu`, not for slowness.** The failure mode is an error
   page, not a delay, so it will be reported as "the site is down" rather than
   "the site is slow".
