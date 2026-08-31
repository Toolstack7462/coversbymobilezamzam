# Premium storefront design system

The rules the customer-facing side is built from. The admin has its own
(`docs/admin-design-system.md`) and the two share primitives but not intent: the
admin is a tool used all day by one person, the storefront is a shop seen once
by a stranger who has not decided to trust it yet.

Everything here is a CSS custom property in `app/styles/tokens.css`. **No
literal colour, size or duration belongs in a component.**

---

## Colour

### Brand

| Token             | Value     | Use                                          |
| ----------------- | --------- | -------------------------------------------- |
| `--color-ink`     | `#0B1220` | Text, and the rule above a trust statement   |
| `--color-primary` | `#2457FF` | One action per view. Never decoration        |
| `--color-accent`  | `#B9F227` | Device context only — never a generic button |

The same three the merchant's Shopify storefront uses. A customer who sees both
properties sees one shop.

### Surfaces

| Token                | Value     | Use                              |
| -------------------- | --------- | -------------------------------- |
| `--color-canvas`     | `#FAF9F6` | Warm ground. The hero sits on it |
| `--color-surface`    | `#FFFFFF` | Cards, panels, the header        |
| `--color-stone`      | `#E8E8E3` | Category tiles, quiet blocks     |
| `--color-ink-deep`   | `#060B14` | The dark band and the footer     |
| `--color-background` | `#F7F8F5` | The page beneath everything      |

**Why the ground is warm.** Against `#FAF9F6`, a white product surface reads as
lit rather than as an absence of colour. On pure white the same card reads as a
gap in the page. It is the cheapest way to make an object look photographed
rather than pasted, and it costs nothing.

**Why there is a near-black.** So the page can go quiet once. One dark band
carries more weight than five accent colours, and it is where the physical shop
and the legal identity live — the two things that say this is a business.

### On the dark

`--color-on-deep`, `--color-on-deep-secondary`, `--color-on-deep-border` exist
so contrast on that surface is decided once rather than improvised. Note that
`--color-primary` on `--color-ink-deep` is about 2.5:1 — legible as a large
shape, failing as a control — which is why `.btn--on-deep` is a white fill.

---

## Type

**Manrope** for headings, **Inter** for interface and body. Both self-hosted,
both SIL OFL 1.1, licences retained in `docs/font-licenses/`.

| Token            | Range     | Use                                        |
| ---------------- | --------- | ------------------------------------------ |
| `--text-display` | 40 → 72px | The hero statement. Once per page, at most |
| `--text-h1`      | 30 → 40px | Page title                                 |
| `--text-h2`      | 24 → 30px | Section heading                            |
| `--text-h3`      | 24px      | Card group, lead paragraph                 |
| `--text-body`    | 16px      | Prose                                      |
| `--text-ui`      | 14px      | Controls, meta, trust copy                 |
| `--text-eyebrow` | 13px      | Section label, uppercase, `0.08em` tracked |
| `--text-caption` | 12px      | Legal, SKU, counts                         |

Display was widened from a 48px ceiling to 72px on purpose: at 48 it competed
with h1, so a hero and a section heading carried the same weight and nothing
told the eye where to start.

**Tracking.** Display and h1 tighten (`-0.035em` / `-0.025em`); the eyebrow
opens up. Large type set at default tracking looks unset.

**Measure.** `--measure` is 46rem. Prose stops there whatever the page does. A
sentence 1400px wide is not read.

---

## Space

A 4px base: `--space-1` (4) through `--space-10`. Section padding is not
uniform — `clamp()` between a phone value and a desktop one, so the rhythm opens
up with the screen instead of staying metronomic.

Rhythm carries meaning: a lot of air above a statement, less between related
rows. Even spacing everywhere is what makes a page read as a template.

---

## Components

### Buttons

`.btn` with `--primary`, `--secondary`, `--ghost`, `--lg`, `--on-deep`.
One primary per view. `--lg` exists because a primary action beneath
display-size type has to hold its own against it.

### Cards

`.product-card` — image, brand, title, availability, fit, price, in that order,
because that is the order a customer decides in: what is it → can I have it →
what does it cost. Media crops square so the grid stays a grid.

### Badges

`.badge--sale` renders **only** when a 30-day prior price exists (D.Lgs.
84/2022). `.compat--*` carries fit. `.stock--*` carries availability. None of
these can be produced by a template without the data behind them.

### Surfaces

`.trust-band` (white, ruled), `.finder-callout` (surface, editorial radius),
`.category-tile` (stone, hairline fills on hover), `.store-band` and
`.site-footer` (near-black).

### Sections

`.section` for rhythm, `.section__head` for a heading with a link opposite,
`.eyebrow` to label a section without spending a heading on it.

---

## Motion

`transform` and `opacity` only; no animation library; decorative motion removed
outright under `prefers-reduced-motion`. Full rules in
[motion-guidelines.md](./motion-guidelines.md).

---

## The rules that are not negotiable

1. **Nothing renders from data that does not exist.** Every trust claim, every
   section, every badge is gated. An absent block looks finished; an empty one
   looks broken.
2. **No invented merchant facts.** No stock photography, no plausible shop name,
   no example phone number, no shipping promise the settings do not support.
3. **Colour is never the only signal.** Fit, availability and errors all carry
   text.
4. **The budget holds.** CSS under 45KB, JS under its own ceiling, and CPU under
   10ms per request on the free plan.
