# Product

## Register

brand

## Users

Three people, in order of how much the design has to work for them.

**A stranger, Italy-wide, on a phone.** Found the shop through search. Has never
heard of Covers by Mobile, is holding a phone with a cracked screen or a dead
battery, and is comparing this against Amazon. They are one tap from leaving.
Everything they need — does this fit my exact model, can I get it, who are these
people — has to be answerable without scrolling twice.

**A local who already knows the shop.** Sulmona and nearby. Has been to the unit
in Centro Il Nuovo Borgo, or will be. For them the site is not a shop, it is a
window: check it exists, check the price, then walk in. Collection and repairs
matter more than delivery.

**Someone mid-task.** Standing in front of the broken thing right now. Not
browsing. Their question is narrow and urgent and the site either answers it or
wastes their time.

## Product Purpose

Covers by Mobile is a real shop inside Centro Commerciale Il Nuovo Borgo in
Sulmona. It sells smartphone accessories, repairs devices on the counter, and
cuts screen protection to measure.

This storefront exists so that a person who has never heard of it will believe
it is real and competent, and buy — or come in.

That is the whole job. Everything else is a means to it. The catalogue is small,
the prices are not the lowest, and the shop cannot win on delivery speed. It can
win on being the only seller that states, per product, exactly which phones an
accessory fits — and on being somewhere with a door you can walk through.

Success is a cold visitor deciding to trust it. Not traffic, not time on page,
not how premium it looks.

## Brand Personality

**Specific, warm, unembarrassed.**

Specific: real model names, real counts, a real address, real hours. The
opposite of "premium accessories for your device".

Warm: it is a family-scale shop in Abruzzo, not a distribution centre. Italian
first, English second, and the Italian is the shop's own voice rather than
translated marketing.

Unembarrassed: it says plainly what it does and does not do. It does not have
same-day delivery. It does have a counter where someone will fit your screen
protector. Saying the second without apologising for the first is the tone.

The emotional goal is **relief** — the feeling of having found someone who
actually knows whether the thing fits.

## Anti-references

**A dropshipper.** Stock photography standing in for real products, invented
urgency, countdown timers, "only 3 left", fabricated reviews, prices in red.
This is the failure mode a small unknown shop is most at risk of, because every
one of those patterns is cheap to add and each one costs credibility with
exactly the visitor this site is for.

**Cold enterprise SaaS.** Navy-and-gray, stock illustration, corporate distance,
a tone that could belong to any company in any country. A shop with a physical
address and a person behind the counter must not read as a landing page for a
platform.

Also rejected, from the wider category: the generic Shopify theme (identical
card grids, an uppercase eyebrow above every section, rounded-everything), and
loud discount electronics (red badges, price-first shouting) — the shop cannot
and should not compete on being cheapest.

## Design Principles

**1. Proof outranks polish.**
The reference is Back Market: a retailer that sells inherently doubtful goods and
wins by making the guarantee louder than the product. Structure and evidence do
the persuading. Given a choice between a more beautiful section and a more
believable one, take the believable one.

**2. Nothing renders from data that does not exist.**
Every claim, section and badge is gated on the fact behind it. An absent block
looks finished; an empty one looks broken; an invented one is a lie the customer
discovers after paying. This is already an invariant in the codebase and it is a
strategic position, not a technical convenience: it is the difference between
this shop and a dropshipper.

**3. Answer the fit question before it is asked.**
The catalogue's one real advantage is that compatibility is a relational fact —
products join to device models with a verified flag — not a tag someone typed.
That belongs on the card, in the grid and in the filters, not only on the
product page.

**4. The shop is the differentiator.**
A counter in Sulmona where a person diagnoses, repairs and cuts film to measure
is the thing no marketplace can copy. It should be visible from the first
screen, not filed under "about".

**5. Premium by subtraction.**
Type, space and one accent. The shop's credibility comes from restraint and
specificity, never from decoration — and decoration is what a cold visitor reads
as compensation.

## Accessibility & Inclusion

**WCAG 2.2 AA, held as a gate rather than an aspiration.** The storefront is
currently axe-clean across 45 page/width combinations at 390px, 768px and
1440px. A regression is a bug that blocks, not a ticket that gets logged.

Concretely, and already true:

- Contrast verified against real backgrounds, including text over photography.
- Colour is never the only signal — fit, availability and errors all carry text.
- `prefers-reduced-motion` removes decorative motion outright rather than
  shortening it; a transform that still happens instantly is still movement.
- Every interactive control is keyboard-reachable, including scrolling regions.
- The site works with no JavaScript: real forms, real links, real pagination.

The primary user is on a phone, often one-handed, often in a hurry, sometimes
with a cracked screen between their eye and the content. That is an
accessibility context as much as a design one.

The European Accessibility Act applies to EU ecommerce and should be reviewed
before launch; AA is being treated as the floor, not the ceiling.
