# Forensic audit — the Shopify reference theme

Read-only audit of `C:\Users\User\italian-tech-atelier`
(`Toolstack7462/coversbymobiile`), the merchant's own Shopify OS 2.0 theme for
the same business. **Nothing in that repository was modified.**

It matters because it is the same merchant, the same catalogue and the same two
type families — so where the two properties disagree, a customer who sees both
notices. It is also further along in places this storefront is not, and the
distance is instructive rather than flattering.

---

## What it is

|                                 |                                                 |
| ------------------------------- | ----------------------------------------------- |
| Sections                        | 43                                              |
| Snippets                        | 27                                              |
| Homepage sections               | 15, ordered                                     |
| Stylesheets                     | one, `critical.css`                             |
| Fonts                           | Manrope + Inter, self-hosted, 4 subsetted woff2 |
| Animation library               | **none**                                        |
| `@keyframes` in the whole theme | **one** (`skeleton-sweep`)                      |

That last pair is the most useful single finding in this document.

---

## Homepage section order

```
 1. hero                 6. campaign            11. recently-viewed
 2. device-finder        7. featured-products   12. reviews
 3. category-cards       8. bundles             13. guides
 4. featured-products    9. store-pickup        14. newsletter
 5. shop-by-brand       10. why-us              15. rich-text
```

Two things stand out.

**The device finder is second.** Before categories, before products, before any
merchandising. The theme treats "which phone do you have?" as the first question
the shop asks — and this storefront had it as a bordered notice with a link.
That ordering is now matched.

**Products appear twice** (4 and 7), separated by a brand rail and a campaign
band. A single long grid is replaced by shorter runs with a change of surface
between them, so the page reads as a sequence of ideas rather than one
inventory dump.

---

## Product card anatomy

The reference card carries **eleven** elements:

```
media · media overlay · vendor · title · price · badge
compatibility · stock · colour swatches · wishlist · compare
```

This storefront's card carries four: image, brand, name, price.

The two that matter most for this catalogue are **compatibility** and **stock**,
because they are the two questions a customer opens the product page to answer.
Everything the card does not say is a click it costs.

---

## Motion

Ten transition rules, one keyframe, two `prefers-reduced-motion` blocks, and no
animation library at all.

This is worth stating plainly because the brief asks about Framer Motion: the
merchant's own premium storefront achieves its feel with CSS transitions on
`transform` and `opacity` and nothing else. Adding a runtime animation library
to this project would cost more in JavaScript than the entire current bundle and
buy nothing the reference did not get for free.

---

## Patterns worth rebuilding here

These are the merchant's own, and reusing them is consistency rather than
imitation:

1. **Device finder as the second element** — done.
2. **Self-hosted Manrope + Inter** — done; this project had named both and
   shipped neither, rendering everything in the system font.
3. **Line-illustration placeholder artwork** in the theme's own icon language,
   explicitly not photography, replaced by the merchant's shots — done, through
   R2.
4. **Alternating surfaces** between sections so the page has rhythm.
5. **A `why-us` trust block** and a **store-pickup** block, both gated on real
   settings.
6. **Guides** — the buying advice that resolves doubt before the basket.
7. **`brand` / `vendor` on the card**, above the title, small and quiet.
8. **Compare and wishlist as card affordances**, not separate pages.

## Design tokens the two projects already share

Identical values, arrived at independently and worth keeping identical:

```
ink #0B1220   primary #2457FF   accent #B9F227
background #F7F8F5   surface #FFFFFF   border #DDE3EA
```

The reference exposes them as Shopify theme settings; here they are CSS custom
properties. Same palette, different mechanism — correct in both cases.

---

## Where the reference is ahead

- Eleven-element product card against four.
- Fifteen homepage sections against six.
- A real mega menu; this has a flat category rail.
- Predictive search; this has a plain form.
- Compare, wishlist and recently-viewed; this has none.
- Reviews and guides surfaces; this has neither.

## Where this project is ahead

Worth recording, because "the other one is better" is not the whole truth:

- **Compatibility is a relational fact**, not a tag. `product_compatibility`
  joins products to `device_models` with a verified flag and a level; the theme
  derives a tag from a metaobject and filters on the tag.
- **Prices carry a 30-day prior-price record**, so a percentage saving cannot be
  rendered without the evidence D.Lgs. 84/2022 requires.
- **Stock is reserved**, with an expiry sweeper, rather than decremented at
  checkout.
- The storefront is **server-rendered with ~119KB of JavaScript**, most of it
  framework, against a theme carrying 17 hand-written JS modules.

---

## What must NOT be copied

- **Nothing from Shopify's Skeleton base.** `LICENSE.md` in that repository is
  Shopify's, and it permits use **only** to build themes that interoperate with
  Shopify. Copying Liquid, Skeleton CSS or Skeleton markup into a
  Cloudflare-hosted React application is outside that grant.
- **No Liquid, no section schema, no `settings_schema.json` shapes.** Different
  platform; a direct port would be wrong even where it were permitted.
- **No benchmark brand's assets.** The benchmark list in the brief — Apple,
  Native Union, Back Market, Cellularline, Spigen, Nothing — is a standard to
  reach, not a source to draw from. Patterns are observed; code, layout, copy,
  imagery and branding are not taken.

What **is** freely reusable is everything the merchant owns and paid for: the
palette, the type choices, the OFL font files, the original line artwork, the
copy voice, and the ordering decisions above.
