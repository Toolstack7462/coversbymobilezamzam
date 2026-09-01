# Storefront visual audit

Chromium, 1 September 2026, against the deployed preview at 390px, 768px and
1440px. Sixteen customer-facing routes, axe against WCAG 2.0/2.1/2.2 A and AA.
Compared against the merchant's own Shopify theme at
`C:\Users\User\italian-tech-atelier`, which was read and not modified.

---

## Machine-checkable state

**48 page/width combinations, zero violations.** No axe findings, one `<h1>` per
page, no heading-level skips, no horizontal overflow, every page titled, no
console errors, no unlabelled fields, no duplicate ids, no unnamed links.

Three faults were found and fixed to reach that:

| Fault                           | Where                                        | Cause                                                                               |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `aria-pressed` on an anchor     | 9 chips per page, collection + device finder | Not a valid attribute on a link. The admin already carried a comment saying so      |
| Scrollable region not focusable | product gallery                              | A strip that scrolls and cannot be focused is unusable without a mouse              |
| No `<title>`                    | every 404 and 500                            | `<Meta />` renders the matched route's metadata; a route that threw matched nothing |

Performance, deployed: LCP 476–981ms, **CLS 0 at every width**, CSS 8.8KB of a
45KB budget, first-load JS 119KB.

---

## Where it stands against the reference

|                                       | Shopify reference                      | Here                                  |
| ------------------------------------- | -------------------------------------- | ------------------------------------- |
| Homepage sections                     | 15                                     | 7                                     |
| Product card elements                 | 11                                     | 6                                     |
| Motion                                | 10 transitions, 1 keyframe, no library | 8 transitions, 1 keyframe, no library |
| Mega menu                             | yes                                    | flat category rail                    |
| Predictive search                     | yes                                    | plain form                            |
| Wishlist / compare / recently viewed  | yes                                    | none                                  |
| Reviews / guides                      | yes                                    | none                                  |
| Self-hosted Manrope + Inter           | yes                                    | yes                                   |
| Compatibility as relational data      | tag-derived                            | `product_compatibility` join          |
| Prior-price evidence behind discounts | no                                     | yes                                   |

The gap that remains is **merchandising surface**, not craft: the reference has
more places to put things, and most of them need content this shop does not yet
have.

---

## Premium feeling — the honest read

**What now reads as premium.** The type is doing real work: Manrope at display
size with tightened tracking, one accented verb, a measure that stops prose at
46rem. Surfaces alternate — warm canvas, white, stone, near-black — so the page
has rhythm instead of one flat tone. The device shortcuts state a real product
count before the click. The footer is dark and closes the page.

**What still reads as a good custom build rather than a brand.** In order of how
much it costs:

1. **No photography.** The hero is type on a warm ground with the right half
   empty. It is composed rather than broken, and it is not what Apple or Native
   Union open with. Everything else on this list is smaller.
2. **Product artwork is line illustration.** Honest, labelled, and not what a
   premium retailer ships.
3. **Categories are stone rectangles.** Built to accept imagery without a
   layout change, and waiting for it.
4. **`[DEMO]` on every name.** Correct for demo data, and it reads as a fault to
   anyone shown the preview cold.
5. **The card has no fit badge until a device is chosen**, which is a real
   limitation of resolving compatibility client-side.

---

## Imagery — what happened when I tried

The brief asked for Unsplash or Pexels imagery. I can fetch it: the network is
open and `images.unsplash.com` returns JPEGs.

I cannot **choose** it. Neither service can be searched without an API key, so
selecting a photograph means guessing a photo ID and looking at what arrives.
Three attempts, three unusable results, for three different reasons:

| Slot  | What arrived                                    | Why it cannot ship                                                                                             |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hero  | An iOS 11 home screen                           | A dozen other companies' trademarks — Facebook, WhatsApp, Uber, Instagram, Airtel — across the merchant's hero |
| Cases | A hand holding a phone showing the YouTube logo | Another company's mark, and it says nothing about cases                                                        |
| Store | A menswear boutique                             | Presenting someone else's shop as the merchant's premises in Sulmona                                           |

That third one is the important one. "Our shop" under a photograph of a
different shop is not a design shortcut, it is a false statement about a real
business.

**So the slots were built instead of being filled.** See below. The moment
somebody chooses specific images — the merchant's own, or URLs picked by a human
who can see them — they are a setting, not a deploy.

### The line I am holding

Stock imagery is fine for **atmosphere**: a hero composition, a category mood, a
shop interior _if it is actually this shop_. It is not fine for **products**. A
stock photograph of a specific case, presented as the case being sold, is a
misrepresentation the customer discovers after paying — and it is the single
fastest way for a shop to look like a dropshipper, which is the failure mode the
brief names.

---

## Image slots, built

No image on this storefront comes from code.

| Slot       | Where it lives              | Editable via         |
| ---------- | --------------------------- | -------------------- |
| Hero       | `media.hero_image` setting  | Admin → Impostazioni |
| Store band | `media.store_image` setting | Admin → Impostazioni |
| Category   | `categories.image_key`      | Admin → the category |
| Product    | `product_images`            | Admin → the product  |

Every one is gated. Absent, the section renders its typographic form — which is
designed to stand on its own, not to look like a page with the pictures
missing. Present, the layout changes: the hero becomes a two-column
composition, category tiles gain a scrim over the lower third so the label keeps
its contrast whatever the photograph is doing, and the store band takes the
image behind its copy at low opacity so the text keeps the contrast it was
designed with.

The admin settings screen reads and writes every row of `store_settings`
generically, so these appeared there without a line of admin code.

---

## Motion

Eight transitions, one keyframe, no animation library — the same shape as the
reference, which reaches its feel the same way.

The hero reveal deserves a note because it is the one place motion could have
cost something real. The statement is the homepage's LCP element, and the usual
reveal — start at `opacity: 0`, animate up — means the browser does not count it
as rendered, trading a 717ms LCP for a flourish. It animates from `0.001`
instead and travels 0.4em: painted on the first frame, still read as a reveal.
Measured after: LCP unchanged.

Under `prefers-reduced-motion` it is removed, not shortened. The global reset
takes durations to 0.01ms, which still _moves_ the element — and movement is
what a vestibular disorder reacts to, however brief.

---

## What I would do next, in order

1. **Photography.** Everything above is waiting on it and nothing else moves the
   needle as far. `docs/image-requirements.md` says exactly what is needed.
2. **A fit badge on the card**, once a device is remembered between pages.
3. **Buying guides** — the surface exists in the reference and resolves doubt
   before the basket. Needs written content, not code.
4. **Predictive search.** The single biggest interaction gap against the
   reference.
5. **Wishlist**, guest-first.

## Recommendation

Do not merge as finished. The craft is sound and the accessibility is clean;
the shop is waiting on content only a human can supply.
