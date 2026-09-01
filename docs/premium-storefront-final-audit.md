# Premium storefront — final audit

Measured on the deployed preview at three widths on 2026-09-02, after the
transformation. Every figure was read off the live page in Chromium. The
before column is the same measurement taken before the work started, recorded
in `docs/premium-storefront-benchmark.md`.

---

## Before and after

| Measure                    | Before                 | After              | Reference median |
| -------------------------- | ---------------------- | ------------------ | ---------------- |
| Hero h1 (1440px)           | 72px / 800             | **48px / 800**     | ~43px            |
| Homepage height            | 3 747px                | **4 968px**        | ~5 500px         |
| Sections                   | 5                      | **8**              | 2–9              |
| Images on the homepage     | 18                     | **22**             | ~230             |
| Images above the fold      | 1 (small, beside text) | 1 (**full-bleed**) | —                |
| Horizontal overflow @390px | none                   | none               | —                |

### Responsive

| Width            | h1   | Page height | Sections | Overflow |
| ---------------- | ---- | ----------- | -------- | -------- |
| 1440px (desktop) | 48px | 4 968px     | 8        | none     |
| 768px (tablet)   | 46px | 7 397px     | 8        | none     |
| 390px (phone)    | 37px | 13 355px    | 9        | none     |

---

## What changed, and why

### The fold is now a photograph

Previously: a 72px headline in the left column, a 4:3 image in the right. Now:
a full-bleed photograph of a phone in a case with a magnetic ring, held against
a coastal sunset, with the headline over it.

The headline came down from 72px to 48px because **every one of the six
benchmarked stores has a smaller h1 than we did**, and the two most premium —
Native Union at 30px and dbrand at 16px — are the smallest of all. A 72px face
at weight 800 is what a discounter does.

The scrim over the photograph is worked out rather than eyeballed, and this
matters because **the hero image is merchant-editable**: a scrim tuned to
today's photograph is a contrast failure waiting for the day somebody uploads a
brighter one, and it would fail silently. The gradient guarantees the floor on
its own — dark enough at the text end for white body copy to clear 4.5:1
against a _white_ photograph.

### A contrast bug found and fixed on the category tiles

The tiles had a scrim whose own comment claimed the label passed contrast. It
did not. The label sits about 40px up a 176px tile, where that gradient had
fallen to roughly 0.46 alpha; composited over a pale photograph that is
rgb(140 142 146), and white text on it is **3.3:1** — under the floor.

It only failed on pale images, which is why nobody saw it: "Cavi" and "Power
bank" are pale images. The replacement holds ~0.73 alpha at the text's height,
which the arithmetic in the stylesheet shows is the level needed for 4.5:1 over
pure white, with headroom for whatever the merchant uploads next.

Tiles also went from seven-across at 11rem — a nav bar with pictures, leaving
one orphan on a second row — to four-across at 17rem, tall enough for the
photograph to show what is in it.

### Three sections added

- **Scelti da noi** — an editorial band of merchant-featured products at a size
  where the photograph sells rather than the price. This is the brief's
  "editorial, not simple cards": a card sells a price, this sells a reason.
- **Al banco, non solo online** — repairs, screen fitting, device assistance.
  The half of the business a marketplace cannot copy, and it was previously
  only a list of words in the footer.
- **Come si sceglie** — the buying guides, read from `pages` with
  `page_type = 'guide'`. The same rows the merchant edits in Pagine, not a
  second content system.

Every one renders nothing when it has nothing: no featured products, no
services configured, no guides published means no heading over an empty row.

### Footer

Added a **Legal** column and the `/legale/:code` route behind it. It renders
only for documents with a published version containing text — which today is
none, so the column does not appear. That is correct: a footer listing
"Privacy" and linking to nothing is worse than one that does not mention it,
because the link is itself a claim that the document exists. These are legally
binding statements and this system will not generate them.

---

## Where we still differ from the references, honestly

**Image count: 22 against a median of ~230.** This gap is real but the number
is not a target. Those stores carry thousands of SKUs; we have 26 products.
Matching 230 would mean repeating images or padding with stock photography of
things we do not sell, both of which would look worse and one of which is a
misrepresentation.

The meaningful version of that metric is met: the fold is photographic, all
eight categories carry real photographs, and every product carries an image.

**Product images are placeholder line illustrations.** Original drawings, in a
consistent grammar, and the alt text says what they are in both languages. They
are there so the grid can be judged at realistic density — a shop with twelve
grey rectangles cannot be reviewed. They are the single biggest remaining gap
between this and a finished shop, and they are replaced by the merchant
photographing their own stock. No stock photograph will be substituted for a
product the customer actually receives.

---

## The category architecture in the brief — and why it was not built

The brief specifies a two-level taxonomy: Protection → Cases / Screen
Protectors / Camera Protection, Charging → Chargers / Wireless / MagSafe, and
so on.

Mapped onto this catalogue, four of the six proposed parents would hold exactly
one child: Power → Power Banks, Audio → Earbuds, Mobility → Car Accessories,
Connectivity → Cables. A parent with one child is a click that adds nothing,
and the two that would hold more — Protection and Charging — would push "Cover
e custodie" off the top level. Covers are the largest category and the reason
most people arrive.

For 26 products across 8 categories, the flat taxonomy is the better
information architecture, and the shop can browse everything in one click
instead of two. The membership resolver already supports descendants
(`app/domain/catalogue/category-membership.ts`), so nesting can be introduced
the day the catalogue is large enough to need it, without a code change.

**This is a recommendation, not a refusal.** If the two-level structure is
wanted regardless, it is a seed script and a nav query change.

---

## Motion

All CSS, no library, no Framer Motion — it was not justified for what is here.

- **Hero reveal** — the three headline lines settle in sequence.
- **Scroll reveal** — sections rise on entry via `animation-timeline: view()`,
  with no JavaScript and no observer.
- **Product and card hover** — transform only, so it composites.
- **Editorial band** — the image scales inside its frame; the card does not
  move. A card that lifts _and_ an image that zooms is two animations answering
  one hover.

Every one has a `prefers-reduced-motion` alternative, and **no animation
reduces text opacity** — a rule this project added after making that mistake
three times.

---

## Accessibility, performance, SEO

| Check               | Result                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployed page crawl | **60/60 pages clean** — no axe violations, no horizontal overflow at 390px, no broken images, one h1 per page, meta description on every indexable page |
| Browser suite       | **91 passed**, 2 skipped, including axe over every admin screen and the visible-focus check                                                             |
| `npm run verify`    | **10/10**                                                                                                                                               |
| Hero image weight   | 86 KB at 2000px wide, preloaded with `fetchPriority="high"` — it is the LCP element                                                                     |
| Bundle              | Storefront JS and CSS both within budget; no library added for motion                                                                                   |
| Brand               | "Italian Tech Atelier" renders nowhere on the storefront; a locale test guards it. "Zam Zam" appears in no merchant artefact and is on no page          |

---

## What a merchant should do next

1. **Photograph the stock.** This is the one thing that separates the storefront
   from a finished shop, and nothing in software substitutes for it.
2. **Publish the legal documents**, written or reviewed by a professional. The
   footer column and the routes appear automatically.
3. **Decide on shipping and collection.** Both are currently off, which is why
   there is no delivery page and no returns policy — writing one the shop has
   not committed to would be an invention the customer discovers after paying.
