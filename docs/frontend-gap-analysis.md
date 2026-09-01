# Frontend gap analysis

Forensic comparison of the deployed Cloudflare storefront against the merchant's
own Shopify theme (`C:\Users\User\italian-tech-atelier` →
`Toolstack7462/coversbymobiile`), read and not modified.

**No implementation. This is an audit, awaiting approval.**

---

## 0. The finding that outranks every visual one

**The storefront is starved of merchant data the merchant has already
supplied.** It is not sparse because of design. It is sparse because most of
what would fill it is empty in this project's database and populated in the
other one.

From `config/settings_data.json` in the reference — the merchant's own
configured theme settings, not defaults:

| Fact                                | Reference                      | This storefront |
| ----------------------------------- | ------------------------------ | --------------- |
| Public shop name                    | **Covers by Mobile**           | _empty_         |
| Opening hours                       | **Tutti i giorni 09:00–20:00** | _empty_         |
| Phone                               | **+39 350 881 6173**           | _empty_         |
| WhatsApp                            | **393508816173**               | _empty_         |
| Email                               | **afridinaseer068@gmail.com**  | _empty_         |
| Directions URL                      | Google Maps deep link          | _empty_         |
| Street, postcode, city, coordinates | present                        | **present**     |

Every sparse section is a gate behaving correctly on nothing:

- the trust band shows **one** of three items — pickup and assistance are gated
  on settings that are blank;
- the footer shows **three** columns instead of contact, hours and help;
- the product page's reassurance block shows one line instead of three;
- the store band had to fall back to the city because there is no shop name.

**Filling those six fields will visibly change more of the page than any CSS I
could write.** It is the first recommendation and it costs nothing.

---

## 1. Brand identity — unverified, and currently wrong

Three strings are in play. They are not interchangeable.

| String                       | Where it comes from                                                                         | Status                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Covers by Mobile**         | `settings_data.json` → `store_name`, and the merchant's own store-page copy                 | The only one appearing as _configured merchant data_                                    |
| **Italian Tech Atelier**     | `package.json`, code comments, token defaults — and the header of this storefront right now | This project's README calls it "Internal project name. It is not the public brand name" |
| **Covers by Mobile Zam Zam** | Repository names only (`coversbymobiile`, `coversbymobilezamzam`), and your message         | Appears in no configured field in either project                                        |

The reference's own store page reads:

> "Covers by Mobile è il nostro negozio all'interno del Centro Commerciale Il
> Nuovo Borgo a Sulmona."

**The deployed storefront is showing an internal project name to customers as
though it were the brand.** No amount of premium styling survives that.

I am not going to pick. The three differ in ways only the merchant can settle —
whether "Zam Zam" is part of the trading name, whether the sign over the door
and the company on the invoice are the same.

### Proposed branding system (design only)

`shop.name` already exists and is already read by the header and store band.
What is missing is that it is empty and the fallback is a developer string.

On approval:

1. `shop.name` becomes the single source for the wordmark, store band, page
   titles and structured data.
2. The fallback stops being "Italian Tech Atelier" and becomes **nothing** — the
   shop's own name or an unbranded mark, never a placeholder that reads as real.
3. `shop.legal_name` stays separate. The company issuing the invoice is often
   not the name over the door, and Italian law wants the former in the footer.
4. A `shop.logo` media slot, alongside the hero and store slots already built.

Small change. Blocked entirely on the name.

---

## 2. What the shop actually sells, versus what the storefront says

The reference's store page describes the business:

> "Accessori per smartphone, **riparazioni** e **protezione tagliata su misura**."
> "**Diagnosi e riparazione in negozio.** Portaci il dispositivo e ti diciamo
> subito cosa si può fare."
> "Ordina online e ritira in negozio al **Centro Il Nuovo Borgo**."

The storefront mentions **none** of it. Not repairs, not custom-cut screen
protection, not the shopping centre.

A shop that diagnoses and repairs on the spot and cuts protective film to
measure is not competing with a marketplace at all — which is exactly the
"premium, Italian, trustworthy" position the brief asks for, currently invisible.

**Legal note:** the reference carries a repair-liability disclaimer from the
merchant's business card that was deliberately **not** published, because as
drafted it is likely void under Codice del Consumo art. 33 and Codice Civile
art. 1229. If repairs surface here, that flag comes with them and needs the
lawyer first.

---

## 3. Why the reference feels more premium

Not craft. **Surface count and merchandising depth.**

|                                      | Reference  | Here           |
| ------------------------------------ | ---------- | -------------- |
| Homepage sections                    | 15         | 7              |
| Product card elements                | 11         | 6              |
| Navigation                           | mega menu  | flat rail      |
| Search                               | predictive | plain GET form |
| Wishlist / compare / recently viewed | all three  | none           |
| Guides / reviews                     | both       | neither        |

The reference's homepage order — hero, device finder, category cards, featured
products, shop by brand, campaign, featured products **again**, bundles, store
pickup, why-us, recently viewed, reviews, guides, newsletter, rich text — puts
products twice, separated by a brand rail and a campaign band. It reads as a
sequence of ideas. Ours reads as a list of blocks, because there are seven and
none repeats.

Typography, palette, spacing scale and the font files themselves are now
**identical** between the two projects. That part of the gap is closed.

## 4. Visual hierarchy that is missing

1. **No second product surface.** One grid, once.
2. **No campaign band.** Nothing is emphasised over anything else but the hero.
3. **No editorial category treatment.** Tiles carry images now, but a tile is
   still a link — "Protection", "Charging", "Connectivity" as _stories_ do not
   exist.
4. **Section heads are uniform.** Every `h2` is the same size, weight and colour
   with a link opposite. Nothing says which section matters.
5. **The preview banner interrupts** between the last section and the footer,
   breaking the one moment the page is meant to close.

## 5. Animation — the honest state

| What animates                     | How                              |
| --------------------------------- | -------------------------------- |
| Hero statement, lead, CTAs        | transform-only settle, staggered |
| Product card image                | scale on hover                   |
| Category tile image and underline | scale, scaleX                    |
| Chips, nav, footer links, buttons | colour and background            |

Eight transitions and one keyframe — which is **the same weight of motion as the
reference**, and the reference is the thing being called more premium. **Motion
is not the gap.**

What a genuinely animated version needs, in value order:

1. **Scroll reveal** on section entry — `IntersectionObserver`, ~1KB, starting
   from `opacity: 1` and enhancing downward so nothing is invisible without
   JavaScript.
2. **Device-finder step transitions** — brand → family → model is the memorable
   interaction and is currently three full page loads.
3. **Gallery cross-fade** rather than a scroll jump.
4. **Add-to-cart feedback.** Today the page simply changes.
5. **Header condense on scroll.**

Two constraints that do not move. The hero must not fade in: it is the LCP
element, and animating its opacity already produced a real transient contrast
failure that axe caught. And no animation library — 40KB of Framer Motion
against a 119KB bundle, on a Worker at 4–7ms of a 10ms CPU ceiling, to do what
CSS already does.

## 6. Images still required

Six are in place (hero, store, four categories) — licensed, chosen, wired to
admin-editable slots. Still needed, and only the merchant can supply them:

| Need                                      | Why stock cannot do it                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Product photography, 3–5 per product**  | A stock photo standing in for the actual case is a misrepresentation discovered after paying             |
| **The actual shop interior**              | The band shows the town, honestly. A _different_ shop under "come and see us" would be a false statement |
| **Shop sign / logo**                      | Required before any wordmark decision is real                                                            |
| Repair bench, custom-cut film in progress | The differentiator, unphotographed                                                                       |

`docs/image-requirements.md` has the specification. A phone camera by the shop
window genuinely suffices.

## 7. What I would rebuild, in order

| #   | Component                                                   | Blocked on                  |
| --- | ----------------------------------------------------------- | --------------------------- |
| 1   | Branding system                                             | **The name**                |
| 2   | Footer contact / hours / help                               | Six settings                |
| 3   | Trust band (shows 1 of 3)                                   | Two settings                |
| 4   | Store section — repairs, custom-cut, the centre, hours, map | Copy + settings             |
| 5   | Product card — no fit badge, wishlist or swatches           | Device memory between pages |
| 6   | Editorial category stories                                  | Copy                        |
| 7   | Predictive search                                           | —                           |
| 8   | Scroll reveal and finder transitions                        | —                           |
| 9   | Second product surface, campaign band                       | Merchandising decisions     |

## 8. What is blocking design, precisely

1. **The brand name.** Three candidates, none confirmed. Everything sits
   downstream.
2. **Six settings** already filled in elsewhere.
3. **Whether repairs and custom-cut protection belong here** — and if so, the
   repair-terms legal flag.
4. **Product photography.**
5. **Whether the copy should be the merchant's own.** The reference hero reads
   "Accessori per il tuo smartphone. Online e nel nostro negozio." I replaced it
   with "Proteggi. Ricarica. Connetti." — mine, not theirs. That was a judgement
   call and it should be yours.

---

## Recommendation

Answer 1 and 2 and the storefront changes visibly with no design work at all.
Everything in section 7 is ready to start on approval.
