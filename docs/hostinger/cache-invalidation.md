# Cache invalidation

What empties the response cache, when, and what happens if it fails.

A cache is a promise that a stored answer is still the right answer. This
document is the part of that promise that can be checked. The companion is
[route-rendering-cache-matrix.md](route-rendering-cache-matrix.md), which says
what is cached at all.

---

## 1. The failure this is designed around

A merchant changes a price, reloads the shop, and sees the old one.

That is not a performance problem. It is the shop telling a customer a price
the merchant has already decided is wrong, and if the customer adds it to a
cart, the checkout — which never reads a cached page — charges the new price.
The merchant finds out from a complaint.

Everything below is arranged so that this cannot happen for longer than one
second on the worker that took the write, and one second plus the TTL on any
other worker.

---

## 2. Two mechanisms, deliberately overlapping

### The version

Every cache key embeds a number. Change the number and every stored entry is
unreachable at once — no walk over the map, no list of which pages a given save
affected, no possibility of missing one.

The number is a **timestamp**, not a counter. A counter has to be read before it
can be incremented, and two workers doing that at the same moment produce the
same number. `Date.now()` needs no read, so a bump is one write that cannot lose
a race. (`Math.max(now, previous + 1)` keeps it strictly increasing when two
bumps land in the same millisecond, and when the clock steps backwards.)

### The TTL

Sixty seconds, as a backstop. It catches whatever the version did not: a row
changed by hand in phpMyAdmin, a scheduled job on another process, a bump whose
file write failed.

Neither mechanism is sufficient alone. The version is precise but only knows
about writes that went through this application; the TTL knows about everything
but is a minute late. Together the common case is instant and the uncommon case
is bounded.

---

## 3. What bumps the version

A request bumps it when **all** of these are true, checked on `finish` so the
status is the one that was actually sent:

1. The method is not `GET`, `HEAD` or `OPTIONS`.
2. The response status is under 400.
3. The request carried a credential — a `Cookie`, an `Authorization` header, or
   the scheduled-job secret.
4. The path is not `/carrello` or `/api/auth/*`.

### Why the default is to invalidate

Rule 4 is a deny-list, not an allow-list, and that direction is the whole
design. A route added next year that changes a price invalidates the cache
without anybody remembering this file. The cost of being wrong in this
direction is a cold cache; the cost of being wrong in the other is a customer
shown a stale price.

The two exceptions are exceptions because of a fact about the domain rather
than a guess: **a cart holds no stock.** Reservations are created by orders,
not by carts ([inventory-and-reservations.md](../inventory-and-reservations.md)),
so adding something to a basket changes nothing an anonymous visitor can see.
Without that exception, every add-to-cart would empty the cache under exactly
the traffic the cache exists to serve.

Checkout is **not** an exception. Placing an order reserves stock, stock is
shown on product pages, so `POST /cassa` bumps.

### Why a credential is required

Without rule 3, `POST /admin/prodotti` from anywhere on the internet bumps the
version. It changes nothing — it is redirected to the login page — but a 302 is
a success, and anything on the internet could hold the cache permanently cold
with a loop of them. Every write in this application needs a session cookie, a
cart cookie or the job secret, so a request carrying none of them cannot have
changed a row and must not be able to invalidate anything.

Pinned in `tests/unit/response-cache.test.ts` — _"does not let an anonymous
request empty the cache"_.

---

## 4. Reaching the other workers

Passenger may run more than one Node worker for the same application. Each has
its own heap and therefore its own cache, and they share nothing but the
filesystem and the database.

So the version is written to a file — `<PRIVATE_MEDIA_ROOT>/.cache-version` —
and each worker re-reads it at most once a second.

```
worker A          worker B                        file
   |                 |                              |
 merchant saves      |                              |
   |--- bump ------->|                              |
   |--------------------------- write 1789… ------->|
   |                 |                              |
   |            GET / (cache HIT, still stale)      |
   |                 |--- refresh (≤1s later) ----->|
   |                 |<-- 1789… --------------------|
   |            GET / (MISS, re-rendered)           |
```

Three properties worth being explicit about:

- **The read is never on the request path.** `current()` returns the value it
  already holds and starts a refresh in the background if the last one was more
  than a second ago. A request never waits for a file.
- **The bound is one second, and it is a bound, not an average.** Another
  worker can serve a stale page for up to a second after a save. Said plainly
  rather than rounded to "immediately".
- **A failed write does not fail the save.** If the file cannot be written the
  bump still applies in this worker and the TTL covers the others. A merchant's
  price change must not fail because an optimisation could not write a file.

The file is read **synchronously once, at construction**. Without that, the
first request after every restart computes its key under version 0, the
background refresh moves the version mid-render, and the page is discarded as a
stale render — every worker throwing away its first page after every deploy for
no reason.

---

## 5. The mid-render race

A page can be rendered from data that a write invalidates before the response
finishes. The window is small and it is real: the render reads a price, the
merchant's save commits, the render finishes.

Storing that page under the old version would be pointless — nothing will ever
ask for it. Storing it under the new version would publish a stale page as
though it were fresh.

So it is thrown away. The response already in flight still goes to the visitor
who asked for it; nothing is stored, and the next request renders again. In the
statistics this appears as a `stale-render` refusal.

---

## 6. Everything that empties the cache

| Trigger                                     | Scope                   | Delay on this worker     | Delay on another worker |
| ------------------------------------------- | ----------------------- | ------------------------ | ----------------------- |
| A credentialed, successful, non-GET request | Everything              | Immediate                | Up to 1 second          |
| The TTL                                     | One entry               | 60 s after it was stored | Same                    |
| A restart or redeploy                       | Everything              | Immediate                | Immediate               |
| The byte or entry budget                    | The least recently used | Immediate                | n/a                     |
| `RESPONSE_CACHE=off` and a restart          | Everything, permanently | Immediate                | Immediate               |

There is no "clear the cache" button and there is deliberately not going to be
one. A restart clears it, and if a merchant ever needs a button then the
invalidation is wrong and the button would hide that.

---

## 7. What is NOT invalidated, and why that is safe

**A write made directly in phpMyAdmin.** The application never sees it. Covered
by the TTL alone: up to sixty seconds stale. Anybody editing rows by hand
already knows they are outside the application's guarantees.

**A scheduled job's writes, when the job runs as a separate process.**
`scripts/hostinger/run-job.mjs` has no HTTP request and cannot bump the
version through the middleware. Today the only job is the reservation sweeper,
which changes `stock_reservations` and therefore availability — so up to sixty
seconds of stale availability after a sweep. Two ways to close it if it ever
matters: have the runner write the version file directly, or run the job
through `POST /api/jobs/run`, which carries the job secret and therefore bumps.
Not done, because sixty seconds of stale "available" on a shop with no orders
yet is not worth a mechanism nobody has needed.

**Anything a browser already holds.** Out of reach by definition, which is why
every storefront response is `no-cache` rather than something with a lifetime.

---

## 8. How to check it is working

```
npm run test:cache-isolation
```

36 assertions against a real Node + MariaDB server, including the cross-worker
path: the test writes the shared version file itself — which is exactly what
another worker's bump does — and asserts the next request is a MISS and the one
after that is a HIT again.

Live, with the job secret configured:

```
curl -s -H "x-job-secret: $JOB_AUTH_SECRET" https://<host>/api/cache-stats
```

```json
{
  "enabled": true,
  "ttlMs": 60000,
  "version": 1789344287317,
  "hitRate": 0.997,
  "hits": 12419,
  "misses": 38,
  "entries": 7,
  "bytes": 199304,
  "refusals": { "path": 978, "content-type": 30 }
}
```

What to read from it:

| Symptom                                      | Means                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `hitRate` near zero with steady traffic      | Something is bumping the version constantly. Look for a mutation on a hot path.           |
| `invalidated` climbing fast                  | The same. Each one is an entry found under a version that had moved.                      |
| `stale-render` climbing                      | Writes are landing during renders — a busy admin, or a bump on something that should not. |
| `refusals.cookie` high                       | Normal. Every returning visitor with a cart is here.                                      |
| `version` not changing after a merchant save | The bump is not firing. Check that the save actually returned under 400.                  |
| `bytes` at the budget                        | Eviction is doing its job; consider `RESPONSE_CACHE_MAX_MB` against the plan's memory.    |

---

## 9. Settings

| Variable                     | Default | Effect                                                                  |
| ---------------------------- | ------- | ----------------------------------------------------------------------- |
| `RESPONSE_CACHE`             | `on`    | `off` disables it entirely. First thing to try when a page looks stale. |
| `RESPONSE_CACHE_TTL_MS`      | 60000   | The backstop. 0 means version-only, which trusts the bump completely.   |
| `RESPONSE_CACHE_MAX_ENTRIES` | 500     | Distinct URLs held.                                                     |
| `RESPONSE_CACHE_MAX_MB`      | 24      | Total body bytes. Sized against a measured 105 MB idle RSS.             |

`x-cache` is emitted on every response outside production (`HIT`, `MISS`,
`BYPASS-<reason>`). It is off in production because it tells a visitor which
requests are cheap to repeat, and it tells the merchant nothing.
