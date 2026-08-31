# Storefront audit — against a premium benchmark

Audited 1 September 2026 on the deployed preview at 1440px, 768px and 390px,
in Chromium, against the standard set by Apple, Native Union, Back Market,
Cellularline and Spigen — for **interaction and presentation patterns only**.
No code, layout, copy, imagery or branding is taken from any of them.

**The verdict: it is correct, fast and honest, and it does not yet look like a
shop anyone would trust with a card.**

Nothing here is a defect in the ordinary sense. Every page renders, every price
is right, nothing shifts, LCP is well inside budget. What is missing is the part
that makes a stranger believe the shop is real.

---

## Where it stands

Three things landed immediately before this audit and are already counted in it:

- **Type.** Manrope and Inter are now self-hosted; every page had been rendering
  in the system UI font.
- **Images.** The demo catalogue has artwork, served from R2 through `/media/*`.
- **Layout.** The storefront stylesheet, previously unwritten, now exists.

So this audit is not about a broken site. It is about the distance between
"working" and "premium".

---

## 1. Hierarchy

**The hero does not lead.** It is a heading, a sentence and two buttons on white,
occupying the top third with the right half of a 1440px screen empty. A premium
retailer opens with a composition — product, context, one clear promise. This
opens with a category label: _"Accessori per il tuo smartphone."_

**Everything after it has the same weight.** "Categorie popolari", "Nuovi
arrivi" and the device-finder card are all the same size, the same colour, on
the same background, separated by the same gap. Nothing tells the eye what
matters. The page is a list of blocks, not a route through a shop.

**The most valuable element on the site is presented as a notice.** This shop's
one real advantage over a marketplace is that it can answer _"will this fit my
phone?"_ — and the device finder is a bordered box with a heading and a button
that navigates away. It should be the second thing on the page and it should be
usable in place: brand → family → model, without leaving.

## 2. Typography

Manrope and Inter are the right pairing and are now actually loading. The scale
is the problem: `--text-h1` and `--text-h2` are close enough that a section
heading competes with the page heading, and body copy sits at one size
throughout. There is no editorial voice — no eyebrow, no lead paragraph, no
pull-quote weight — so every sentence reads with equal urgency, which is to say
none.

## 3. Spacing

Section padding is uniform (`--space-7` everywhere). Premium layouts breathe
unevenly on purpose: a lot of air above a statement, less between related rows.
Here the rhythm is metronomic, which reads as a template.

The `--page-width` of 1440px is also too wide for prose. At full width the hero
sentence runs the whole monitor.

## 4. Imagery

Product artwork now exists and is honest — original line illustrations, with alt
text in both languages saying exactly that. It is the right placeholder and the
wrong final answer. There is:

- no lifestyle photography;
- no category imagery (categories are text pills);
- no hero image;
- no second product angle, and no gallery on the product page.

## 5. Product presentation

The card shows image, brand, name, price. For a shop whose entire proposition is
compatibility, **the card does not mention compatibility at all** — no exact-fit
badge, no device context, no availability, no pickup signal. A customer must
open every product to learn the one fact they came for.

The product page is worse in one specific way: it has a single image, no
gallery, no variant presentation beyond a quantity box, and the specification
list is a plain `<dl>`.

## 6. Conversion path

There is no path. From the homepage a customer can search, browse everything, or
open the device finder on another page. There is no:

- shop-by-device entry, though device data exists;
- featured collection or curated set;
- best-seller row (correctly absent — there is no order data to justify one);
- guide or explainer to resolve doubt before the basket.

## 7. Trust signals

**There are none.** Not one of: verified compatibility, collection in store,
Italian assistance, returns, secure payment, VAT-registered identity. The footer
carries an address and nothing else. For an unknown Italian shop asking for a
card number, this is the single largest gap on the site.

## 8. Mobile usability

No overflow at 390px, no layout shift, no console errors — the mechanics are
sound. The experience is not:

- the homepage is **3,869px tall** with no way back to search or cart except
  scrolling to the top;
- there is no bottom navigation;
- the product page has no sticky purchase bar, so on a 2,021px page the price
  and the add-to-cart button leave the screen and do not come back;
- the category bar scrolls sideways with no affordance that it can be scrolled.

## 9. Presentation faults worth naming

- The preview banner renders **between the content and the footer**, where it
  reads as a page section rather than an environment warning.
- The collection page is a grid with a `Ordina` select and a `Continua` submit
  button beside it — the no-JS fallback, correct and unstyled.
- No filters are offered on the collection page at all.
- Category chips carry the `[DEMO]` prefix, which is correct for demo data and
  will look like a mistake to anyone shown the preview without explanation.

---

## What this means for the redesign

In priority order, judged by what a first-time visitor would notice:

1. **Trust signals near the buy decision** — nothing else on this list matters if
   the customer does not believe the shop exists.
2. **Compatibility on the card and in the grid** — the differentiator, currently
   invisible until the product page.
3. **A hero that states a position** rather than naming a category.
4. **The device finder as an inline, in-place conversion element.**
5. **Mobile: bottom navigation and a sticky purchase bar.**
6. **Editorial contrast** — a dark section, a real type scale, uneven rhythm.
7. **Category and lifestyle imagery**, once real photography exists.

Performance is currently a strength and must survive: LCP 166–638ms, CLS 0 at
every width, 119KB of JS on first load. Every change below is measured against
that, not excused from it.
