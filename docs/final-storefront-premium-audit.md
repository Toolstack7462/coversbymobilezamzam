# Final storefront premium audit

Chromium, 1440 / 768 / 390, against the deployed preview. Compared against the
merchant's own Shopify theme (`C:\Users\User\italian-tech-atelier`, read only)
and against six real storefronts measured in the same browser.

---

## The measurement that explains "ordinary"

Rather than argue about taste, I loaded six real stores and read their computed
styles.

| Store         | Sections | Images  | Page height | h1 size  | h1 weight |
| ------------- | -------- | ------- | ----------- | -------- | --------- |
| Spigen        | 17       | **190** | 7348px      | 56px     | 500       |
| dbrand        | 9        | 101     | 5438px      | 16px     | 400       |
| Cellularline  | 4        | 80      | 6508px      | 56px     | 700       |
| Native Union  | 7        | 57      | 5534px      | 30px     | 700       |
| Peak Design   | 9        | 27      | 6718px      | 25.6px   | 700       |
| Mous          | 8        | 28      | 3447px      | —        | —         |
| **This shop** | **5**    | **10**  | **3068px**  | **72px** | **800**   |

Two things fall out of that table, and neither is about colour or polish.

**1. The gap is images and length, not styling.** Every store measured carries
between 27 and 190 images. This one carries 10. Every one runs 3.4k to 7.3k
pixels tall; this one is 3.1k. A premium storefront is mostly _photography with
type on it_, and that is the one material this shop does not have.

**2. The headline is the loudest on the list, by a distance.** 72px at weight
800 with -2.5px tracking, against a field where the largest is 56px and dbrand
— the most confident brand in the set — ships a **16px, weight 400** h1. The
instinct that "premium means big type" is inverted: the more assured the store,
the quieter its headline, because the photograph is doing the talking.

That is the honest diagnosis. Restraint reads as ordinary only when there is
nothing beside it; the fix is not a louder page, it is more to look at.

---

## What was done in this pass

**1. Branding.** `Italian Tech Atelier` no longer appears anywhere a customer
can see. The header wordmark, the hero eyebrow and the page copy now resolve
from `store.name` = **Covers by Mobile**, with a fallback chain that ends in a
generic word rather than a developer's working title.

One occurrence remains and is deliberately untouched: `TOTP_ISSUER` in
`auth.server.ts`, which is what appears in the merchant's authenticator app
when they enrol 2FA. It is auth code, which this pass was told not to touch,
and it is already overridable by environment variable. **It should be changed
before the merchant enrols.**

**2. Preview banner.** Was a full-width peach band with an orange rule, sitting
between the last section and the footer — an operational warning rendered as
the loudest element on the page, cutting it in half exactly where it should
have closed. It is now a single small line at the very bottom, after the
footer, on the same near-black as the footer itself. Still says the same thing.
Hidden entirely when `APP_ENV` is production.

**3. Footer.** Six columns: brand and tagline, the full eight-category
taxonomy, shop links plus counter services (repairs, screen-protector fitting,
device assistance), address with hours and a directions link, contact with
phone, email and WhatsApp, and language.

The category list is generated from the **same `PRIMARY_NAV` constant the header
rail uses**. Two hand-maintained copies of a taxonomy drift, and the footer is
the copy nobody notices has drifted.

Services render as plain text, not links: there is no page behind any of them
yet, and a link to nowhere is worse than a label.

**4. Gradients.** Two, both structural. A ~3% vertical wash lifts the hero from
the band below it, and a two-step luminance gradient gives the dark bands a
horizon so the type sits on something rather than floating on a flat fill. No
mesh, no blobs, no colour outside the palette. A gradient that announces itself
is the cheap kind.

**5. `[DEMO]` removed** from every product, category, brand, device and
description. It did a real job while the prefix was the only signal that prices
were invented; that job now belongs to the banner and to `robots.txt`, and the
prefix had started reading as a fault to anyone shown the site cold.

**6. Device brands** widened from two to eight: Apple, Samsung, Xiaomi, Google
Pixel, Oppo, OnePlus, Huawei, Motorola. The six new ones have **no models
beneath them**, so the finder shows them and finds nothing. That is the honest
state — a model list is something the merchant fills in, and inventing model
names would put unverified fits in front of a customer.

**7. CMS-controlled images.** Hero, store band and per-category images are
settings and `categories.image_key`, editable in the admin with no deploy. A
dedicated lifestyle _section_ is **not built** — see What is still missing.

**9. Animations.** Hero reveal (staggered, transform-only), scroll reveal on
section entry, product-image hover, category-tile underline, chip and control
transitions. The scroll reveal is CSS `animation-timeline: view()` — no
JavaScript, no observer, no library — and critically the content is **visible by
default**, with the animation as an enhancement. The common implementation
starts at `opacity: 0` and waits for a class, which ships a blank section to
every crawler and every browser without the feature.

**Framer Motion was considered and not added.** 40KB against a 119KB bundle, on
a Worker already spending 4-7ms of a 10ms CPU ceiling, to do what CSS is doing
here. The merchant's own Shopify theme — the premium reference for this project
— ships no animation library either: ten transitions and one keyframe.

**12. Sitemap.** `/sitemap.xml`, generated from the database, with `hreflang`
alternates for both locales. It lists the home page, catalogue, device finder,
store page and every active product; never the cart, checkout, order
confirmation or tracking pages, several of which carry a token in the URL.

Outside production it returns a **valid but empty** sitemap. `robots.txt`
already disallows crawlers here, and a populated sitemap is a stronger signal
than a disallow — it is an explicit request to index every URL in it. Serving
one from a `noindex` environment is a contradiction, and search engines resolve
contradictions unpredictably. It is ready; it asks for nothing.

---

## A mistake I made three times

Three separate accessibility failures in this work, all the same root cause:
**reducing the opacity of text.**

| Where          | What broke                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Hero reveal    | Animated from `opacity: 0.001`, so the primary CTA failed contrast for as long as the animation ran |
| Scroll reveal  | Animated from `opacity: 0.55`, failing on the device-finder eyebrow and intro                       |
| Preview banner | Static `opacity: 0.7` on a 12px label, taking `#9aa6b8` to roughly `#6d7686` on near-black          |

Each was caught by axe in the browser suite, and each was invisible to me by
inspection. A transient contrast failure is still a failure: the person reading
during those 400ms is the person the rule exists for.

**The rule that avoids all three, now applied everywhere: text never animates
or reduces its opacity.** If it should be quieter, give it a colour that is
quieter, and check that colour. Movement alone reads as a reveal and costs
nothing.

---

## Against the Shopify reference

|                                      | Reference                                              | Here                                      |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------- |
| Homepage sections                    | 15                                                     | 7                                         |
| Product card elements                | 11                                                     | 7                                         |
| Footer columns                       | brand, shop, help, store, social, newsletter, payments | 6 (no social, no newsletter, no payments) |
| Navigation                           | mega menu                                              | flat scrolling rail                       |
| Search                               | predictive                                             | plain GET form                            |
| Wishlist / compare / recently viewed | all three                                              | none                                      |
| Guides / reviews                     | both                                                   | neither                                   |
| Motion                               | 10 transitions, 1 keyframe, no library                 | ~12 transitions, 3 keyframes, no library  |
| Type, palette, fonts                 | shared                                                 | **shared**                                |

Spacing, typography, palette and the font files themselves are now identical
between the two properties. Section count and merchandising surface are not.

---

## What is still missing

Ordered by how much a first-time visitor would notice.

1. **Product photography.** Ten images against a field of 27 to 190. This is
   the gap. Line illustrations are honest placeholders and are not what a
   premium retailer ships.
2. **A lifestyle section.** The slot system supports it; the section is not
   designed or built. It needs a photograph to be worth building.
3. **Predictive search.** The largest interaction gap against the reference.
4. **Wishlist, compare, recently viewed.** Three card affordances the reference
   has and this does not.
5. **Buying guides.** Resolves doubt before the basket. Needs written content.
6. **A second product surface and a campaign band**, so the page reads as a
   sequence rather than a list.
7. **Device models for the six new brands.** The merchant supplies these; they
   must not be invented.
8. **`pickup.preparation_time`.** One setting away from turning on the
   collect-in-store messaging across the trust band, product page and footer.
9. **`TOTP_ISSUER`** still says Italian Tech Atelier.
10. **Legal footer.** Needs ragione sociale and P.IVA; all-or-nothing by
    design, because a partial legal footer looks like compliance without being
    it.

---

## Verification

`npm run verify` 10/10. Browser suite 87 passed, 2 skipped. 45 page/width
combinations axe-clean. LCP 868-1308ms with CLS 0 at every width. CSS 9.2KB of
a 45KB budget; no JavaScript added in this pass.

## Recommendation

Do not merge as finished. The craft is sound, the accessibility is clean, the
branding is now correct and the sitemap is production-ready. What is left is
almost entirely content the merchant has to supply — photographs, device
models, one setting, and a legal identity — not design work.
