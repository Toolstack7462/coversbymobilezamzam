---
name: Covers by Mobile
description: A shop counter for smartphone accessories in Sulmona — flat, specific and evidence-first.
colors:
  slate-ink: "#0b1220"
  slate-ink-deep: "#060b14"
  slate-ink-80: "#33404f"
  slate-ink-60: "#5c6675"
  signal-blue: "#2457ff"
  signal-blue-pressed: "#1743d3"
  signal-blue-surface: "#edf2ff"
  voltage: "#b9f227"
  voltage-surface: "#f2fbd9"
  canvas: "#faf9f6"
  page: "#f7f8f5"
  surface: "#ffffff"
  surface-sunken: "#f0f2ef"
  stone: "#e8e8e3"
  border: "#dde3ea"
  border-strong: "#c3ccd6"
  text-secondary: "#667085"
  text-secondary-on-sunken: "#4b5565"
  on-deep: "#f4f6fa"
  on-deep-secondary: "#9aa6b8"
  on-deep-border: "#1c2634"
  success: "#15845a"
  success-text: "#147d56"
  success-surface: "#e7f4ee"
  danger: "#d92d20"
  danger-text: "#d02b1f"
  danger-surface: "#fdecea"
  warning: "#b54708"
  warning-surface: "#fdf3e8"
typography:
  display:
    fontFamily: "Manrope Variable, Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 1.55rem + 4.2vw, 4.5rem)"
    fontWeight: 800
    lineHeight: "0.98"
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Manrope Variable, Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.5rem + 1.6vw, 2.5rem)"
    fontWeight: 700
    lineHeight: "clamp(2.25rem, 1.9rem + 1.5vw, 3rem)"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Manrope Variable, Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.3rem + 0.9vw, 1.875rem)"
    fontWeight: 700
    lineHeight: "clamp(2rem, 1.75rem + 1vw, 2.5rem)"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: "1.25rem"
    letterSpacing: "0.08em"
  price:
    fontFamily: "Manrope Variable, Manrope, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)"
    fontWeight: 700
    lineHeight: "clamp(1.625rem, 1.5rem + 0.5vw, 1.875rem)"
    letterSpacing: "normal"
rounded:
  notch: "2px"
  control: "10px"
  card: "12px"
  editorial: "18px"
  chip: "999px"
spacing:
  half: "0.125rem"
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.5rem"
  6: "2rem"
  7: "3rem"
  8: "4rem"
  9: "5rem"
  10: "6rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 1.5rem"
    height: "48px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-pressed}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.control}"
    padding: "0 1.5rem"
    height: "48px"
  button-large:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 2rem"
    height: "52px"
  button-on-deep:
    backgroundColor: "{colors.on-deep}"
    textColor: "{colors.slate-ink-deep}"
    rounded: "{rounded.control}"
    height: "52px"
  product-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.card}"
    padding: "0"
  category-tile:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.card}"
    padding: "1rem"
    height: "7.5rem"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.chip}"
    padding: "0 1rem"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.slate-ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.chip}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.control}"
    height: "48px"
  store-band:
    backgroundColor: "{colors.slate-ink-deep}"
    textColor: "{colors.on-deep}"
    padding: "3rem 0"
  site-footer:
    backgroundColor: "{colors.slate-ink-deep}"
    textColor: "{colors.on-deep}"
    padding: "3rem 0"
---

# Design System: Covers by Mobile

## 1. Overview

**The Counter.**

The system is a shop counter: a flat, honest surface where things are laid out,
examined and explained. One person, answering one question, with the thing in
their hand.

That metaphor decides most arguments before they start. A counter has no
gradients on it. Nothing floats. Objects sit on a plane with visible edges, and
what makes them credible is that you can see them clearly and someone can tell
you exactly what they are.

The mood is **specific, warm and unembarrassed**. Specific: real model names,
real counts, a real address, real hours — never "premium accessories for your
device". Warm: a family-scale shop in Abruzzo, Italian first and in the shop's
own voice. Unembarrassed: it states plainly what it does and does not do,
without apologising for the gaps.

The emotional target is **relief** — the feeling of having found someone who
actually knows whether the thing fits.

**What this must never feel like.** A dropshipper: stock photography standing in
for products, invented urgency, countdown timers, prices in red. And cold
enterprise SaaS: navy-and-gray corporate distance that could belong to any
company in any country. A shop with a door and a person behind the counter must
read as neither.

## 2. Colors: Slate, Signal and Voltage

Three brand colours, and a large supporting neutral range. The names are
functional on purpose: they say what the colour is for, not what it looks like.

**Primary — Signal Blue `#2457ff`.** A wayfinding colour, not decoration. It
marks the one action that matters on a view and nothing else. Its pressed state
is `#1743d3`; its tint `#edf2ff` carries quiet informational surfaces.

**Neutral — Slate Ink `#0b1220`.** Near-black with a blue cast, so it sits in the
same family as the primary rather than fighting it. `#33404f` and `#5c6675` step
down for secondary text. **Slate Ink Deep `#060b14`** is darker still and is a
_background_, never text: it carries the store band and the footer.

**Accent — Voltage `#b9f227`.** Acid lime, tied to charging — a third of what
the shop sells. It is device-context only. It must never become a generic button
colour, and it never carries text: at this luminance nothing legible sits on it.

**Surfaces, warm to cold.** `#faf9f6` canvas (warm, the hero ground), `#f7f8f5`
page, `#ffffff` surface, `#f0f2ef` sunken, `#e8e8e3` stone, `#060b14` deep. The
canvas is warm rather than neutral for one reason: against it a white product
surface reads as _lit_ rather than as an absence of colour. On pure white the
same card reads as a hole in the page.

**Status** is never colour alone. `#15845a` success, `#d92d20` danger, `#b54708`
warning — each paired with a tinted surface and always accompanied by text.
Fit, availability and errors all say what they mean in words.

**On the dark surfaces**, `#f4f6fa` and `#9aa6b8` are pre-decided so contrast is
never improvised. Note that Signal Blue on Slate Ink Deep is roughly 2.5:1 —
legible as a large shape, failing as a control — which is why the button on that
surface is a white fill.

## 3. Typography

**Manrope** for display and headings, **Inter** for interface and body. Both
self-hosted as subsetted woff2 under SIL OFL 1.1, with the licence texts
retained in `docs/font-licenses/`. Latin and Latin Extended are separate files
with a `unicode-range`, so a page of Italian fetches only the Latin subset.

The scale is fluid, `clamp()` throughout, and the gap between display and
headline is deliberately wide: display reaches 72px, headline stops at 40px, so
a hero and a section heading can never be mistaken for one another.

| Role     | Family  | Size                            | Weight |
| -------- | ------- | ------------------------------- | ------ |
| Display  | Manrope | 40 → 72px                       | 800    |
| Headline | Manrope | 30 → 40px                       | 700    |
| Title    | Manrope | 24 → 30px                       | 700    |
| Body     | Inter   | 16px                            | 400    |
| Label    | Inter   | 14px                            | 500    |
| Eyebrow  | Inter   | 13px, 0.08em tracked, uppercase | 600    |
| Caption  | Inter   | 12px                            | 400    |
| Price    | Manrope | 20 → 24px                       | 700    |

**Tracking.** Display tightens to −0.035em and headline to −0.025em; nothing goes
below −0.04em. The eyebrow opens up instead. Large type at default tracking
looks unset; type below the floor looks cramped.

**Measure.** Prose stops at `46rem` whatever the page does. `--page-width` is
1440px, but a sentence 1400px wide is not read.

**The eyebrow is rationed.** It labels a section without spending a heading on
it, and it is used where a section genuinely needs a label — not above every
section. An eyebrow on everything is scaffolding, not voice.

## 4. Elevation

**Three separate jobs that must not substitute for each other.**

**Borders define edges.** A 1px `#dde3ea` hairline, `#c3ccd6` when it needs to
assert itself. This is how cards, panels and inputs are bounded. Cards do not
cast shadows.

**Tone defines depth.** canvas → surface → sunken → stone → ink-deep. A section
recedes or advances by changing its ground, not by lifting.

**Shadow defines detachment**, and is reserved for things genuinely above the
page: `--shadow-menu` for menus, `--shadow-drawer` for drawers,
`--shadow-dialog` for dialogs. All three are tinted with the ink hue rather than
neutral black, and all use a negative spread so they read as a lift rather than
a halo.

The consequence worth stating: **a 1px border and a wide soft drop shadow must
never appear on the same element.** That pairing is the "ghost card", and it is
decoration pretending to be structure.

## 5. Components

**Plain and certain.** Nothing is styled to look expensive. Controls are
unambiguous, generously sized, and say exactly what they do. Confidence comes
from clarity, because decoration is what a cold visitor reads as compensation.

**Buttons.** 48px tall, 10px radius, one primary per view. `--lg` at 52px exists
so a primary action can hold its own beneath display-size type. On the dark
band, `--on-deep` is a white fill — the brand blue fails contrast there.

**Product card.** Image, brand, title, availability, fit, price — in that order,
because that is the order a customer decides in: what is it → can I have it →
what does it cost. Media crops to a square so the grid stays a grid whatever
shape the photography is. The whole tile is the target, via a stretched
`::after` on the title link, so the accessible name stays the product name
rather than the price and badge being read out as part of it.

**Category tile.** Stone by default with the name at the bottom and a hairline
that fills on hover. With imagery it takes a scrim over the lower third only, so
the photograph is still a photograph and the label still passes contrast.

**Chip.** A pill, 44px tall. Selection inverts to Slate Ink and is keyed on
`aria-current` for links and `aria-pressed` for buttons — never on a class,
because the attribute has to be correct anyway and one source of truth cannot
disagree with itself.

**Inputs.** 48px, 10px radius, a visible label always. Never a placeholder
standing in for a label.

**Badges.** `badge--sale` renders only when a 30-day prior price exists, because
D.Lgs. 84/2022 requires the evidence. `compat--*` carries fit, `stock--*`
carries availability. None can be produced by a template without the data behind
it.

**Focus.** Never removed. `:focus-visible` with a 2px ring at the primary
colour, switched to `--color-on-deep` on the dark surfaces where the blue would
vanish.

**Motion.** `transform` and `opacity` only, tokens `--duration-fast|base|slow`
(140/180/220ms) on `cubic-bezier(0.2, 0, 0.13, 1)`. No animation library: the
whole system is eight transitions and one keyframe. Hover effects sit inside
`@media (hover: hover)` so a tap does not leave a stuck state. Under
`prefers-reduced-motion` decorative motion is **removed**, not shortened — a
transform that still happens instantly is still movement.

**Layout.** `.page` centres at `--page-width` with a `--gutter`. Flex for one
dimension, grid for two. Product grids use
`repeat(auto-fill, minmax(min(100%, 15rem), 1fr))` so they reflow without
breakpoints. Section rhythm is deliberately uneven — `clamp()` between a phone
value and a desktop one — because metronomic spacing is what reads as a
template.

## 6. Do's and Don'ts

**Do**

- Gate every claim, section and badge on the data behind it. An absent block
  looks finished; an empty one looks broken; an invented one is a lie the
  customer discovers after paying.
- State fit and availability on the card. It is the question the customer came
  with.
- Let the warm canvas do the work of making white surfaces read as lit.
- Reserve Signal Blue for the one action that matters, and Voltage for device
  context only.
- Use borders for edges, tone for depth, shadow only for detachment.
- Verify contrast against the real background, including text over photography.
- Keep prose inside `--measure`, whatever the page width.

**Don't**

- Pair a 1px border with a wide soft shadow on the same element.
- Round a card past 16px. Pills are for chips and buttons.
- Put an uppercase tracked eyebrow above every section.
- Use gradient text, glassmorphism, or a coloured side-stripe border.
- Let stock photography stand in for a product. Atmosphere may be licensed;
  the thing being sold may not.
- Show a shop name, phone number, opening time or shipping promise that is not
  configured. Placeholders that read as real are worse than blanks.
- Animate the hero's opacity. It is the LCP element, and a partially transparent
  control fails contrast for as long as the animation runs.
- Invent urgency. No countdowns, no "only 3 left", no fabricated reviews, no
  percentage saving without a recorded prior price.
