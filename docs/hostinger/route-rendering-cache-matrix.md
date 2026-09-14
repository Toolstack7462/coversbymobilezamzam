# Route, rendering and cache matrix

Every route this application serves, how it is rendered, and who is allowed to
keep a copy of the answer.

It exists because "the site is cached" is not a statement anybody can check. A
caching decision is per route, and the wrong one on a single row hands one
customer's basket to the next person. This is the row-by-row version, and
[cache-invalidation.md](cache-invalidation.md) is what makes the "cached"
entries safe to write down.

Measured against commit `ea82b04` on `feat/hostinger-migration`, 2026-09-14.

---

## 1. The three caches, and which one each column means

There are three, they are independent, and confusing them is how a shared cache
ends up holding a session.

| Cache                  | Where                      | Column here     | Cleared by                                                                 |
| ---------------------- | -------------------------- | --------------- | -------------------------------------------------------------------------- |
| **Server micro-cache** | This Node process's heap   | _Server cache_  | A version bump or the TTL — [cache-invalidation.md](cache-invalidation.md) |
| **Browser cache**      | Each visitor's own machine | _Cache-Control_ | Nothing we control. Whatever is handed out is gone.                        |
| **Static asset cache** | Browser, and any proxy     | _Cache-Control_ | Never. The filename contains a hash of the content.                        |

There is deliberately **no shared proxy or CDN cache** in front of the
application. Every storefront response is `private`, which forbids one. That is
not an oversight: these pages carry no per-visitor content today, but the rule
that keeps them safe if they ever do is the one written in the response, and a
`public` page is one feature away from being wrong.

---

## 2. Rendering classes

|                    |                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **SSR, streamed**  | Server-rendered React, streamed. Every storefront and admin page.                                |
| **SSR, replayed**  | The same bytes, served from the server micro-cache without re-running the loaders or the render. |
| **Generated text** | Built per request from the database, not React. `robots.txt`, `sitemap.xml`.                     |
| **Passthrough**    | Bytes from the object store. `/media/*`.                                                         |
| **Static file**    | Served by `express.static` from `build/client`, never reaching the application.                  |

Nothing here is pre-rendered at build time, and nothing is a single-page
application shell. A shop whose prices and stock are baked into a build is a
shop that lies between deployments.

---

## 3. Storefront

Both language paths, since `/en/...` mirrors every row.

| Route                  | Rendering      | Server cache | Cache-Control                        | Why                                                                                                     |
| ---------------------- | -------------- | ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/`                    | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Identical for every anonymous visitor. Measured 14.6 ms → 2.6 ms.                                       |
| `/shop`                | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Same, per query string. Each filter combination is its own entry.                                       |
| `/prodotti/:slug`      | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Price and stock are in the page, so the version bump matters more here than anywhere.                   |
| `/trova-dispositivo`   | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Device data changes rarely.                                                                             |
| `/negozio`             | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Editorial; settings-driven.                                                                             |
| `/pagine/:slug`        | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Merchant-authored. An edit bumps the version.                                                           |
| `/legale/:code`        | SSR → replayed | **Yes**      | `private, no-cache, must-revalidate` | Versioned documents.                                                                                    |
| `/carrello`            | SSR            | **Never**    | `private, no-cache, must-revalidate` | It **is** the session. Refused by path AND by the cookie rule, so removing either one still refuses it. |
| `/cassa`               | SSR            | **Never**    | `private, no-cache, must-revalidate` | Same, and it writes.                                                                                    |
| `/ordine/:orderNumber` | SSR            | **Never**    | `private, no-cache, must-revalidate` | Somebody's order, addressed by a secret in the URL.                                                     |
| `/traccia/:token`      | SSR            | **Never**    | `private, no-cache, must-revalidate` | Same.                                                                                                   |

**Why every storefront page is `no-cache` in the browser and yet cached on the
server.** They are different questions. `no-cache` tells the browser to
revalidate before reusing a copy it already holds — correct, because prices and
stock change and there is no way to reach a copy already handed out. The server
cache is reachable: a version bump empties it in one move. Something we can
invalidate may be cached; something we cannot must be revalidated.

---

## 4. Staff, operational and assets

| Route                             | Rendering      | Server cache | Cache-Control                                   | Why                                                                                                           |
| --------------------------------- | -------------- | ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/admin`, `/admin/*`              | SSR            | **Never**    | `private, no-store, max-age=0, must-revalidate` | Order details, customer names, payment state. Not merely revalidated — never written down.                    |
| `/api/health`                     | JSON           | **Never**    | `no-store, max-age=0`                           | A cached health check reports the health of the past.                                                         |
| `/api/auth/*`                     | Better Auth    | **Never**    | `private, no-store, …`                          | Issues cookies. The one thing a shared cache must never hold.                                                 |
| `/api/jobs/run`                   | JSON, POST     | **Never**    | `private, no-store`                             | A mutation. Refused by method before anything else looks at it.                                               |
| `/api/cache-stats`                | JSON           | **Never**    | `private, no-store`                             | Describes the process. 404s without the job secret.                                                           |
| `/robots.txt`                     | Generated text | No           | `public, max-age=300`                           | Public by definition and cheap; five minutes is short enough that a change is not stuck.                      |
| `/sitemap.xml`                    | Generated text | No           | `public, max-age=300`                           | Same.                                                                                                         |
| `/media/*`                        | Passthrough    | **Never**    | `public, max-age=31536000, immutable`           | The key contains a content hash, so the object at a URL cannot change. Bytes belong on disk, not in the heap. |
| `/assets/*`                       | Static file    | n/a          | `public, max-age=31536000, immutable`           | Hashed filenames.                                                                                             |
| everything else in `build/client` | Static file    | n/a          | `public, max-age=3600`                          | Stable URLs whose content CAN change — fonts, icons, the manifest.                                            |

`/media/*` is marked "never" for the server micro-cache and `immutable` for the
browser at the same time, and both are right: the browser should keep an image
for a year, and this process should not hold megabytes of them in a heap that
has to fit beside another website on the same plan.

---

## 5. What makes a response ineligible

Applied in this order. The first match wins, and each is tested in
`tests/unit/response-cache.test.ts` and proved end to end by
`npm run test:cache-isolation`.

**Request side**

1. Not a `GET`.
2. **Any `Cookie` header at all.** Not "a session cookie" — any cookie. A rule
   that names the cookies it cares about is correct until something adds one.
3. An `Authorization` header.
4. A path under `/admin`, `/api`, `/carrello`, `/cassa`, `/ordine`, `/traccia`
   or `/media` — checked after the `/en` prefix is stripped, so the English
   mirror of each is refused too.

**Response side**

5. Not a 200.
6. **Any `Set-Cookie`.**
7. Not `text/html`.
8. `Cache-Control: no-store`.
9. Over 512 KB.
10. The invalidation version moved while the page was rendering.

The cost of rule 2 is real and accepted: a returning visitor holding a
`__Host-cart` cookie never gets a cached page. They also must not, because what
they see is allowed to differ from what a stranger sees.

---

## 6. Measured effect

Cache off → on, same build, same database, same minute
(`npm run performance:compare`, 2026-09-14):

| Route                | p50 off | p50 on  | Change  |
| -------------------- | ------- | ------- | ------- |
| `/`                  | 14.6 ms | 2.6 ms  | −82%    |
| `/shop`              | 15.2 ms | 1.9 ms  | −87%    |
| `/shop?q=cover`      | 11.2 ms | 1.6 ms  | −85%    |
| `/trova-dispositivo` | 9.1 ms  | 1.6 ms  | −82%    |
| `/negozio`           | 6.9 ms  | 1.4 ms  | −80%    |
| `/en`                | 11.3 ms | 1.7 ms  | −85%    |
| `/carrello`          | 17.1 ms | 18.2 ms | **+6%** |
| `/api/health`        | 2.6 ms  | 2.5 ms  | −7%     |

The cart is the honest row. It is never cached, so it gets no benefit and pays
the middleware's per-request bookkeeping. 1 ms on a route that costs 17 is the
price of the other rows, and it is in the table rather than left out of it.

Full numbers, including throughput and memory:
[performance-before-after.md](performance-before-after.md).

---

## 7. What is NOT cached that could be

Recorded so the next person measuring starts from the list rather than the
question.

|                                                  |                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Router's `.data` requests                  | Client-side navigation fetches loader data as `text/x-script`, which rule 7 refuses. They are cacheable under exactly the same conditions as the HTML. Not done, not measured, worth doing.    |
| `/robots.txt`, `/sitemap.xml`                    | Already cheap (1.4 ms) and already `public, max-age=300`. Caching a 1.4 ms route in the heap would be work for nothing.                                                                        |
| The storefront shell for cookie-bearing visitors | The layout loader's six queries are identical for everybody, cookie or not. A data-level cache would serve the cart and the checkout too. Deliberately not built in the same pass as this one. |
| Anything in the admin                            | Not a caching problem. Its slow screens are slow queries, and the fix is the query.                                                                                                            |
