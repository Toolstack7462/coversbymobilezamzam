# Premium storefront — visual QA

Deployed preview, version `3975d5a7`, captured in Chromium at 1440px, 768px and
390px. Compared against `docs/frontend-premium-audit.md` (the state before this
pass) and `docs/shopify-reference-audit.md` (the merchant's own Shopify theme).

**Verdict: substantially improved and not yet finished.** The parts that were
embarrassing are fixed; the parts that are merely ordinary are listed at the
bottom rather than described as done.

---

## Measured

|                     | Desktop 1440     | Tablet 768       | Mobile 390       |
| ------------------- | ---------------- | ---------------- | ---------------- |
| Homepage height     | 2380px           | 3144px           | 5178px           |
| Horizontal overflow | none             | none             | none             |
| Broken images       | 0                | 0                | 0                |
| Heading font        | Manrope Variable | Manrope Variable | Manrope Variable |

| Page        | LCP   | CLS | TTFB  |
| ----------- | ----- | --- | ----- |
| Homepage    | 769ms | 0   | 362ms |
| Catalogue   | 494ms | 0   | 239ms |
| Product     | 794ms | 0   | 514ms |
| Cart        | 445ms | 0   | 229ms |
| Admin login | 280ms | 0   | 81ms  |

No console errors, no failed requests, no CSP violations at any width. CSS
8.2KB of a 45KB budget. `npm run verify` 10/10; browser suite 87 passed, 2
skipped.

LCP rose from a 166–638ms range to 280–794ms. That is the cost of self-hosted
fonts and real images, it is well inside the 2.5s "good" threshold, and it is
the right trade: the previous numbers were partly fast because there was
nothing to render.

---

## Against the audit's priority list

| #   | Was                                          | Now                                                                                                                     |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | No trust signals anywhere                    | Trust band under the hero, every claim gated on the setting that makes it true                                          |
| 2   | Compatibility invisible until the PDP        | Availability on every card; fit badge renders when a device is known                                                    |
| 3   | Hero named a category                        | _Proteggi. Ricarica. Connetti._ — a statement, one accented verb                                                        |
| 4   | Device finder was a bordered notice          | A two-column conversion block with real model shortcuts, ordered by how many products fit, count shown before the click |
| 5   | No mobile navigation, no sticky purchase bar | Both                                                                                                                    |
| 6   | One flat light tone throughout               | Warm canvas, white surfaces, stone tiles, near-black footer                                                             |
| 7   | Categories were text pills                   | Tiles with a hairline that fills on hover                                                                               |

## Fixed during QA

- **The trust band had lost its gutter.** `padding-inline-start: 0` — the usual
  way to drop a list's indent — was applied to an element that was also `.page`,
  and took the page gutter with it, pinning the band to the left edge while
  every other section stayed aligned. Caught by looking at a screenshot, not by
  any test.
- **The bottom-bar device label wrapped to two lines** at a fifth of 390px.
  Shortened to one word.

---

## Still ordinary

Named honestly, because a QA document that only lists wins is not QA.

1. **The hero has no image.** The right half of a 1440px screen is empty. It
   works because the type is doing the work, and it would work better with a
   photograph. Blocked on real imagery.
2. **Product artwork is line illustration, not photography.** Correct as a
   placeholder and clearly labelled as one; it is not what a premium retailer
   ships. See `docs/image-requirements.md`.
3. **The dark store band does not render.** It is gated on a public shop name
   the merchant has not supplied. One setting away, and correctly absent until
   then — the page currently has one dark surface (the footer) where the design
   intends two.
4. **Category tiles are empty stone rectangles.** Built to look deliberate while
   empty and to accept imagery without a layout change, but they are waiting.
5. **`[DEMO]` prefixes everywhere.** Correct for demo data, and it will read as
   a fault to anyone shown the preview without that explanation.
6. **The collection page is still a grid.** No editorial header, no filters, no
   device selector. The brief asks for all three; none is built.
7. **The PDP has one image and no gallery.** Specifications are a plain list.
8. **No wishlist, no quick view, no compare, no colour swatches** on the card.
   The reference theme has all four.
9. **No buying guides, no featured collections, no best sellers.** The last is
   correctly absent — there is no order data to justify it.
10. **The preview banner still sits between the content and the footer**, which
    now reads worse than before: it interrupts the page just as the dark footer
    is meant to close it.

---

## Against the Shopify reference

|                                      | Reference | Here       |
| ------------------------------------ | --------- | ---------- |
| Homepage sections                    | 15        | 6          |
| Product card elements                | 11        | 6          |
| Mega menu                            | yes       | flat rail  |
| Predictive search                    | yes       | plain form |
| Compare / wishlist / recently viewed | yes       | none       |
| Guides / reviews                     | yes       | none       |

The gap has narrowed and has not closed. What this storefront has that the
reference does not remains true: compatibility as a relational fact rather than
a tag, prior-price evidence behind every discount, reserved stock, and a
server-rendered page that costs 119KB of JavaScript.

---

## Recommendation

**Do not merge to `main` as finished.** This is a good preview of a premium
direction, on a branch, with the backend untouched and every gate green. The
remaining work above is real, and items 1–4 all depend on the merchant supplying
photography and completing shop settings — which is the honest next step, not
more CSS.
