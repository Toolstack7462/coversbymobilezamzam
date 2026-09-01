# Premium storefront benchmark

Six reference storefronts, measured in Chromium at 1440×900 on 2026-09-02, next
to ours. Every number below was read off the live page, not estimated.

Method: `chromium`, real user agent, `domcontentloaded` + 3.5s settle,
`getComputedStyle` on the rendered document. Raw output in the scratchpad as
`measurements.json`.

---

## The measurements

| Store                       | h1 size / weight | Page height | Sections | Images | Median radius | Body face    |
| --------------------------- | ---------------- | ----------- | -------- | ------ | ------------- | ------------ |
| **Covers by Mobile (ours)** | **72px / 800**   | **3 747px** | 5        | **18** | —             | Inter        |
| Native Union                | 30px / 700       | 5 541px     | —        | 84     | pill          | Museo Sans   |
| Mous                        | — (image h1)     | 3 447px     | 7        | 256    | 5px           | Brandon Text |
| Spigen                      | 56px / 500       | 7 348px     | 9        | 227    | 50px          | custom       |
| Cellularline                | 56px / 700       | 5 824px     | 2        | 70     | 7px           | Raleway      |
| dbrand                      | 16px / 400       | 5 438px     | —        | 235    | pill          | Replica      |
| Back Market                 | 40px / 600       | —           | —        | —      | pill          | system-ui    |

Back Market served a consent wall to the crawler, so its page-level numbers are
not usable. Its h1 and type stack are.

---

## What the numbers say

### 1. Our headline is larger than every single reference

72px at weight 800 with −2.52px tracking. The largest number in the reference
set is 56px, and the two most premium-positioned stores in it — Native Union at
30px and dbrand at 16px — are the _smallest_.

This is the clearest finding in the exercise, and it is counter-intuitive:
**shouting is what a cheap store does.** A 72px display face at weight 800 is
the visual behaviour of a discounter, because a shop confident in its product
photography does not need the type to carry the page. Native Union's h1 sits
_inside_ a full-bleed photograph of two hands holding phones; it can be 30px
because the picture is doing the work.

**Action:** bring the hero h1 to the 40–48px band and let an image carry the
fold.

### 2. We show a tenth of the imagery

18 images against a median of roughly 230, and **one** of ours is above the
fold. Mous, Spigen and dbrand all sit above 220.

This is not a styling gap — no amount of spacing or typography closes it. A
storefront reads as premium because it shows the product repeatedly, in use,
from angles, in context. Ours currently shows a hero, eight category tiles and
a product grid.

**Action:** the fold must open with photography. Every category needs a real
image. Product cards need a second view.

### 3. Our page is the shortest

3 747px against a median around 5 500px. Combined with five sections, the
homepage says less than any reference. Spigen runs to 7 348px across nine
sections, and Spigen is the least "designed" of the group — length here is
merchandising surface, not padding.

**Action:** the brief's eight-section homepage is the right shape. It roughly
doubles the surface.

---

## Pattern notes, per store

### Native Union — the closest positioning to ours

- Full-bleed lifestyle photograph as the fold, header **transparent over it**,
  centred wordmark.
- Small tracked eyebrow (`ONE TRACKER, BOTH ECOSYSTEMS`) above a modest h1, then
  a single pill CTA. Three elements, nothing else.
- Immediately below the fold: a positioning band — a quote, a three-line claim
  ("Tech Accessories Reimagined / Designed in Paris / Delivering Worldwide"),
  and a B-Corp mark. Credentials before products.
- **Adopt:** photographic fold; eyebrow + restrained h1 + one CTA; a credential
  band directly under the fold.
- **Reject:** the carousel. Five rotating slides is five messages, which is
  none, and it costs the LCP.

### Mous — product density

- 256 images, 3 447px. Achieves density by _tightening_, not lengthening.
- 5px radius throughout: near-square, engineering-flavoured.
- **Adopt:** density over height. A tight grid of many real images beats a long
  page of few.

### Spigen — the long merchandising page

- Nine sections, 7 348px, 227 images.
- Reads as a catalogue rather than a brand. Useful as a warning: length without
  editorial intent is a supermarket aisle.
- **Reject:** the model. **Adopt:** the willingness to put many products on the
  homepage.

### Cellularline — the Italian incumbent

- 56px/700 h1, Raleway, 7px radius, only 70 images.
- The most direct competitor and the least distinctive; it looks like a
  distributor. This is the trap our shop is closest to falling into.
- **Reject:** almost everything. Named here because "looks like Cellularline" is
  a failure state for this project, not a target.

### dbrand — the anti-premium premium

- 16px/400 h1. Sixteen pixels. The entire hierarchy is carried by photography
  and copy voice.
- Proof that the headline size has nothing to do with perceived quality.
- **Adopt:** the confidence to make type small. **Reject:** the voice; it is not
  this merchant's.

### Back Market — refurbished marketplace

- 40px/600, system-ui, pill radius.
- Trust signals dominate the fold: guarantees, ratings, return terms.
- **Adopt:** trust language early — this shop has a real counter in Sulmona,
  which is a stronger trust signal than any marketplace badge.

---

## The Shopify reference — `C:\Users\User\italian-tech-atelier`

The merchant's earlier Shopify theme is on disk and was read for palette and
structure rather than code. It is a theme, not a design: its value here is the
brand's own colour and naming, which `docs/brand-architecture-final.md` already
resolves.

**"Zam Zam" does not appear anywhere in the merchant's theme.** It is not a
trading name, a legal identity, or a parent business as far as any artefact in
this project shows — so it goes nowhere near the storefront. That finding is
recorded in `docs/brand-architecture-final.md` and is unchanged by this review.

The public brand is **Covers by Mobile**. "Italian Tech Atelier" is the internal
project name and must never render to a customer; a locale test guards it.

---

## What this benchmark changes

| Decision                                    | Because                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Hero h1 drops from 72px to the 40–48px band | Larger than all six references; the two most premium are the smallest       |
| The fold becomes photographic               | One image above the fold against a median of ~230 per page                  |
| Eight-section homepage                      | Ours is the shortest page in the set with the fewest sections               |
| Every category gets a real image            | Category tiles without imagery read as a nav menu, not merchandising        |
| Trust band directly under the fold          | Native Union and Back Market both do it; we have a better claim than either |
| No hero carousel                            | Five messages is none, and it is the LCP                                    |
| Radius stays restrained                     | Median across the set is 5–9px for content, pills for controls              |

---

## What it deliberately does not change

- **The compatibility system.** None of these six answers "will this fit my
  exact phone?" as a first-class question. It is this shop's one genuine
  advantage and no benchmark suggested it.
- **The physical shop.** Only Back Market leads with trust, and none of them
  has a counter in Sulmona. That is not a pattern to copy; it is the thing to
  say that none of them can.
