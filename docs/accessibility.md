# Accessibility

Target: **WCAG 2.2 AA**. The European Accessibility Act has applied to
e-commerce since 28 June 2025.

---

## Two measured facts about this palette

The brief's palette contains two combinations that fail AA **as text**. Measured
by axe in the Shopify reference project, and carried forward:

| Token                                      | As text    | Verdict             |
| ------------------------------------------ | ---------- | ------------------- |
| `--color-success` `#15845A` on porcelain   | **4.40:1** | Fails (needs 4.5:1) |
| `--color-danger` `#D92D20` on its own tint | **4.22:1** | Fails               |

Both are **correct as fills** — white on `#D92D20` is 4.83:1.

The resolution was to separate fill tokens from text tokens rather than alter
the specified palette:

    --color-success-text: #147D56;
    --color-danger-text:  #D02B1F;
    --color-warning-text: #B54708;

**Use the `-text` variants wherever the colour carries text.** This is the
single easiest thing to get wrong here, and the UI-consistency reviewer checks
for it.

---

## Decisions built into the system

**Target size (2.5.8).** 44×44px minimum. `.chip` is defined exactly once, in
`app/styles/app.css` — a duplicated rule previously reintroduced a 36px target
in the reference project, with the stale copy winning the cascade.

**Status is never colour alone (1.4.1).** Every compatibility and availability
state renders text plus an SVG icon. `CompatibilityBadge` has no colour-only
path.

**Zoom is never disabled (1.4.4).** The viewport meta carries no
`user-scalable=no`.

**Focus is never removed (2.4.7).** A single `:focus-visible` rule, which keeps
the ring off mouse clicks without hiding it from keyboard users.

**Skip link (2.4.1).** Moves focus, not just scroll position.

**Everything works without JavaScript.** Search and sort are GET forms, cart
operations are POST forms, accordions are native `<details>`, pagination is real
links. Nothing depends on script to be operable, which removes an entire class
of keyboard and assistive-technology failure.

**Labels are visible, never placeholder-only.** A placeholder disappears the
moment someone types, which is exactly when they need it.

**Semantic input types** so mobile shows the right keyboard: `type="email"`,
`inputMode="numeric"` on the CAP field.

**Motion.** `prefers-reduced-motion` zeroes the duration tokens at the root, so
every transition respects it without per-component handling.

---

## Italian text is the harder case

Italian labels run longer than English. _"Questo prodotto non risulta
compatibile con il dispositivo selezionato"_ is far longer than its English
equivalent.

**Check Italian first, at 390px.** English will pass when Italian does; the
reverse is not true.

---

## Testing, and its honest limits

Planned: Playwright + axe-core at 390 / 768 / 1440, keyboard traversal, and
manual review. **Browser tests are not yet written** — stated plainly rather
than implied.

**Automated checks cover roughly a third of WCAG.** They do not detect a
confusing focus order, an unhelpful error message, an unclear label, or anything
a screen-reader user would actually struggle with. They are evidence of effort,
not of compliance.

A note on a specific trap: WebKit does not Tab to links unless full keyboard
access is enabled in macOS. A test asserting that is testing a browser
preference, not the site. Assert DOM focus order instead — engine-independently.

---

## Before launch

- [ ] Browser tests written and passing
- [ ] Manual keyboard pass over every flow
- [ ] **Independent audit including real screen-reader testing**
- [ ] Accessibility statement published
- [ ] Feedback route for accessibility problems
