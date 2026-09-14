# Media optimisation

What the shop's images and assets actually weigh, what was changed, and the one
large improvement that is deliberately not built yet.

Measured 2026-09-14 against the migrated catalogue in `zamzam_staging` and the
production build at commit `ea82b04`.

---

## 1. What the shop actually serves

Counted from `product_images` and from `build/client`, not estimated.

### Photographs

|                  |                                             |
| ---------------- | ------------------------------------------- |
| Product images   | **26**, one per product                     |
| Format           | **WebP**, all of them                       |
| Dimensions       | **900 × 900**, all of them                  |
| Average          | **75 KB**                                   |
| Largest          | **296 KB**                                  |
| Total            | **1.90 MB**                                 |
| Category tiles   | 8                                           |
| Lifestyle images | 2 (`media.hero_image`, `media.store_image`) |

Format and compression are already right. WebP at 75 KB for a 900 px square
product photograph is a good number, and re-encoding it would buy single-digit
percentages. **Nothing here needs a better codec.**

### Everything else the browser downloads

| Asset                   | Bytes    | Cache             |
| ----------------------- | -------- | ----------------- |
| `entry.client-*.js`     | 185.9 KB | 1 year, immutable |
| `jsx-runtime-*.js`      | 85.4 KB  | 1 year, immutable |
| `app-*.css`             | 50.7 KB  | 1 year, immutable |
| `manifest-*.js`         | 38.6 KB  | 1 year, immutable |
| `inter-latin.woff2`     | 48.3 KB  | 1 hour, preloaded |
| `manrope-latin.woff2`   | 24.8 KB  | 1 hour, preloaded |
| `inter-latin-ext.woff2` | 85.1 KB  | 1 hour            |
| Homepage HTML           | 34.6 KB  | revalidated       |

All of it is gzipped in transit by `compression()`, and everything with a hash
in its name is immutable for a year, so a returning visitor downloads none of
it again.

---

## 2. The number that matters

A first visit to the homepage downloads **~35 KB of HTML** and **eight product
photographs**.

```
HTML                      35 KB
8 product images    8 × 75 KB  =  600 KB
                              ─────────
                                 635 KB
```

**Images are 94% of the page.** Every kilobyte of JavaScript, CSS and HTML
optimisation on this page together is worth less than removing one photograph
from it.

That single fact decides what is worth doing, and it is why the rest of this
document is about images and not about bundles.

---

## 3. The over-fetch, measured

Every image is 900 × 900. Almost nowhere renders one at 900 px.

| Where                      | Rendered width | Device pixels at DPR 3 | Served | Waste                  |
| -------------------------- | -------------- | ---------------------- | ------ | ---------------------- |
| Product card, 390 px phone | ~170 CSS px    | ~510 px                | 900 px | ~1.8× linear, ~3× area |
| Product card, 1440 px grid | ~300 CSS px    | ~600 px at DPR 2       | 900 px | ~1.5× linear           |
| Product page, main image   | ~560 CSS px    | ~1120 px at DPR 2      | 900 px | **under-served**       |
| Product page, thumbnail    | ~80 CSS px     | ~240 px                | 900 px | ~3.7× linear           |

Two things at once: the grid is over-served and the product page's main image is
slightly under-served. Both are the same cause — one derivative for every use —
and both are fixed by the same thing.

A 400 px WebP of the same photograph is roughly a fifth of the bytes of a
900 px one. On a phone that is **~600 KB → ~130 KB** for the homepage grid.

---

## 4. What was changed

### The first row of `/shop` is no longer lazy

`ProductCard` marked every image `loading="lazy"`. On the homepage that is
right: the hero above it is preloaded with `fetchPriority="high"` and holds the
LCP.

On `/shop` there is no hero. **The first row of product photographs is the
largest element in the viewport**, and `loading="lazy"` told the browser to
defer the one request the page was waiting for.

`ProductCard` now takes a `priority` prop, and `/shop` passes it for the first
four cards — one column at 390 px, four at 1440 px, so a phone pays for one
extra eager image and a desktop stops deferring three.

Deliberately a caller's decision rather than an index test inside the card: only
the page knows what is above it. The homepage does not pass it, because two
images both claiming high priority are two images competing for the same
bandwidth.

**Not measured as an LCP improvement here, and that is stated rather than
implied.** LCP needs a browser against a server with images in its store; the
local media store holds zero objects because the media migration is blocked on
Hostinger access. What is verifiable today is that the markup is right; the
number needs a deployment.

### Already correct, and left alone

| Property                                      | State                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `width` and `height` on every `<img>`         | Present. Space is reserved, so nothing shifts as photos arrive.       |
| `decoding="async"`                            | Present.                                                              |
| Hero preload with `fetchPriority="high"`      | Present.                                                              |
| Immutable year-long cache on `/media/*`       | Present, and correct — keys contain a content hash.                   |
| `nosniff` and a sandbox CSP on media          | Present. Merchant-uploaded bytes are never re-interpreted.            |
| Format sniffed from magic bytes, not the MIME | Present. SVG refused outright — it is a script vector dressed as art. |
| 304 on `if-none-match`                        | Present.                                                              |

---

## 5. The large improvement that is NOT built

**Responsive derivatives — 400 / 640 / 900 px per image, with `srcset` and
`sizes`.** Worth roughly 470 KB on a phone's first homepage view, which is more
than everything else in this document combined.

It is not built because it needs a decision nobody has been asked for yet:

|                                        |                                                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resize where?**                      | At upload, in the application. That means an image library — `sharp` is the obvious one and it is a **native binary**. Whether it installs on this Hostinger plan is capability check C-1's business, and it is unanswered.             |
| **Or resize when?**                    | On demand in the request path, cached to disk. Cheaper to install, and it puts image decoding on the same CPU that serves pages. The optimisation addendum explicitly rules out a worker process per request; this would be that shape. |
| **Or not at all?**                     | A CDN with image transforms (`PUBLIC_MEDIA_BASE_URL` already exists for exactly this). Best result, no code, a bill, and a dependency on a service outside Hostinger — which is the thing the migration was for.                        |
| **What about the 26 existing images?** | A backfill, whichever route is taken. It is a script, not a problem.                                                                                                                                                                    |

Recommendation, stated so it can be argued with: **wait for capability check
C-1.** If `sharp` installs, generate derivatives at upload — it is a one-time
cost per photograph, it puts no work in the request path, and it needs no
third-party service. If it does not install, the CDN is the answer and the code
change is a base URL.

What must not happen is generating derivatives on demand in the request path on
a shared plan. It converts a memory problem into a CPU problem on the process
that is also rendering pages, and the first slow day it takes the shop down.

---

## 6. Everything else on the list, with why it is not worth doing

|                                        |                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AVIF                                   | ~20% smaller than WebP on photographs. Needs the same encoder as §5 and gains a fifth of what resizing gains. Do it in the same pass if at all, never on its own.                    |
| Re-encoding the existing WebPs         | They average 75 KB at 900 px. There is nothing to win.                                                                                                                               |
| Subsetting the fonts                   | `inter-latin-ext.woff2` is 85 KB and only loads for a page containing extended-Latin characters. Italian does not. It is already conditional.                                        |
| Inlining critical CSS                  | 50.7 KB of CSS, gzipped and immutable, on a same-origin connection already open for the HTML. The win is one round trip on a first visit; the cost is a build step and a CSP change. |
| Serving media from a CDN               | The right answer for an image-heavy shop and it needs a decision and a bill. `PUBLIC_MEDIA_BASE_URL` is already the switch.                                                          |
| Caching `/media/*` in the process heap | Refused on purpose. 1.9 MB of photographs in a heap that must fit beside another website on the same plan, to save a disk read the OS has already cached.                            |
| A blur-up or LQIP placeholder          | Costs bytes on every card to improve the feel of a page that already reserves its space. Not obviously positive.                                                                     |

---

## 7. What cannot be measured from here

|                                    |                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| LCP, CLS, INP                      | Field metrics. They need a deployment and real visitors. Nothing in this document claims one.                             |
| Actual image transfer times        | The local media store holds zero objects; the media migration is blocked on Hostinger access (capability audit C-1, C-3). |
| Whether Hostinger compresses media | `/media/*` is already WebP, so it should not be compressed twice. Unverified on their stack.                              |
| Whether `sharp` installs           | Capability check C-1.                                                                                                     |
