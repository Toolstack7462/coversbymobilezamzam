# Motion

## The decision, first

**No animation library.** Not Framer Motion, not GSAP, not anything with a
runtime.

The reasoning is not aesthetic. The merchant's own Shopify storefront — the
premium reference this project is measured against — achieves its feel with
**ten CSS transition rules and one `@keyframes`**, and ships no animation
library at all. Framer Motion is roughly 40KB gzipped against a total client
bundle of 119KB: a third more JavaScript, to do what the reference does for
nothing.

There is a harder constraint underneath. This Worker spends **4–7ms of CPU
against the free plan's 10ms ceiling**, with measured peaks at 10–11ms
(`docs/cloudflare/free-plan-cpu-results.md`). Exceeding it does not make a page
slow — it terminates the request and shows a Cloudflare error. Motion that costs
main-thread work spends from a margin of about one page render.

---

## What may animate

`transform` and `opacity`. Nothing else.

Both are composited without layout or paint, so twenty animating cards do not
repaint the page. `width`, `height`, `top`, `left`, `margin`, shadow blur and
`background-position` all force layout or paint every frame, and will be visible
as stutter on the mid-range Android phones most of this shop's customers use.

## Durations

Tokens only, never a literal:

| Token             | For                                                |
| ----------------- | -------------------------------------------------- |
| `--duration-fast` | hover, focus, colour — anything the pointer causes |
| `--duration-base` | state change, reveal — anything a click causes     |
| `--duration-slow` | image scale, larger moves                          |

Entering eases out, leaving eases in, exits are shorter than entrances. Past
~400ms an interface control reads as lag rather than polish.

---

## `prefers-reduced-motion`

The global reset in `app.css` shortens every animation and transition to
0.01ms. **That is not sufficient for decorative motion**: a transform that still
happens, instantly, can still trigger nausea for someone with a vestibular
disorder.

Decorative effects are therefore _removed_, not shortened:

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

Motion that conveys meaning — a drawer arriving from the edge it belongs to —
may stay, shortened.

## Hover is not a state on a phone

Every hover effect sits inside `@media (hover: hover)`. Without it, a touch
device applies the hover style on tap and leaves it there until the next tap
elsewhere, which reads as a stuck selection.

---

## What actually animates today

The complete inventory. It is deliberately short.

| Element                        | Property                     | Duration |
| ------------------------------ | ---------------------------- | -------- |
| Product card image             | `transform: scale(1.03)`     | slow     |
| Product card border and shadow | `border-color`, `box-shadow` | fast     |
| Category tile underline        | `transform: scaleX()`        | base     |
| Device chip                    | `background`, `border-color` | fast     |
| Header nav link                | `background`                 | fast     |
| Footer link                    | `color`                      | fast     |
| Buttons                        | inherited from `.btn`        | fast     |

The two that use `transform` are the two that carry distance. Everything else is
a colour change, which costs a paint of one small element and nothing else.

## Never

- **Motion on first paint.** The hero must not fade or rise in. It is the LCP
  element; animating it delays the metric it defines. LCP is currently
  166–638ms and that is not being traded for a reveal.
- **Scroll-linked animation** without an observer. A scroll handler that reads
  layout is the easiest way to make a phone stutter.
- **Skeletons that outlive their data.** A shimmer running for four seconds
  communicates a broken page.
- **`will-change` left on permanently.** It reserves compositor memory for an
  animation that is not happening.
- **Motion as the only signal.** Everything must be legible with animation off
  entirely.

## If a reveal is wanted later

Scroll reveals were considered and not built. The honest version costs an
`IntersectionObserver`, a class toggle and a `prefers-reduced-motion` branch —
perhaps 1KB, which is affordable. What is not affordable is the version that
usually ships with it: opacity starting at 0, so the page is blank until
JavaScript runs, and every crawler and every visitor with a slow connection sees
nothing. If it is added, it must start from `opacity: 1` and enhance downward.
