---
name: motion-design
description: Motion rules for this storefront — what may animate, for how long, and what must never. Use when adding a transition, a hover effect, a reveal, or any animation library.
---

# Motion

## The budget decides first

This shop renders at **4–7ms of CPU against the free plan's 10ms ceiling**, with
peaks touching it. Motion that costs main-thread work spends from a margin of
about one page render.

So the rule is not "animate tastefully". It is: **if it does not composite, it
does not ship.**

## What may be animated

`transform` and `opacity`. Nothing else.

Both are handled by the compositor without layout or paint, so a grid of twenty
animating cards does not repaint the page. Animating `width`, `height`, `top`,
`left`, `margin`, `box-shadow` blur or `background-position` forces layout or
paint on every frame and will be visible as jank on the mid-range Android phones
most of this shop's customers use.

## No animation library

The merchant's own Shopify storefront — the premium reference for this project —
achieves its feel with **ten CSS transitions and a single `@keyframes`**. It
ships no animation library at all.

Framer Motion is roughly 40KB gzipped. The entire current client bundle is
119KB. Before adding any motion dependency, state what it does that a CSS
transition cannot, and what it costs against
[core-web-vitals](../core-web-vitals/SKILL.md).

## Durations

Use the tokens, never a literal:

| Token             | Value                    | For                         |
| ----------------- | ------------------------ | --------------------------- |
| `--duration-fast` | hover, focus, colour     | anything the pointer causes |
| `--duration-base` | state change, reveal     | anything a click causes     |
| `--duration-slow` | image scale, large moves | anything covering distance  |

Entering eases out; leaving eases in; exits are shorter than entrances. A
transition slower than ~400ms on an interface control reads as lag, not polish.

## `prefers-reduced-motion` is not optional

The global reset shortens every duration to 0.01ms. **That is not enough for
decorative motion.** A transform that still happens instantly can still cause
nausea for someone with a vestibular disorder.

Decorative effects must be removed, not shortened:

```css
@media (prefers-reduced-motion: reduce) {
  .product-card__media img {
    transition: none;
  }
  .product-card:hover .product-card__media img {
    transform: none;
  }
}
```

Motion that conveys meaning — a drawer moving in from the edge it belongs to —
may remain, shortened.

## Never

- Motion on first paint. The hero must not fade or rise in: it is the LCP
  element, and animating it delays the metric it defines.
- Scroll-linked animation without `content-visibility` or an observer. A scroll
  handler that runs layout is the single easiest way to make a phone stutter.
- Skeletons that outlive their data. A shimmer that runs for four seconds
  communicates a broken page, not a loading one.
- `will-change` left on permanently. It reserves compositor memory for an
  animation that is not happening.
- Motion as the only signal that something changed. It must be legible with
  animation switched off entirely — see
  [accessibility-wcag22](../accessibility-wcag22/SKILL.md).

## Hover is not a state on a phone

`@media (hover: hover)` around every hover effect. Without it a touch device
applies the hover style on tap and leaves it applied until the next tap
somewhere else, which looks like a stuck selection.

## Where this is written down

`docs/motion-guidelines.md` carries the same rules with the reasoning and the
current inventory of what actually animates.
