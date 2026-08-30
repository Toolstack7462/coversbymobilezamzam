---
name: ui-ux-commerce
description: Design system rules for this storefront and admin. Use when building or reviewing any UI. Complements the installed ui-ux-pro-max skill with project-specific constraints.
---

# UI/UX for this commerce project

`ui-ux-pro-max` is installed and covers general practice. This file is only the
project-specific part.

## Tokens

`app/styles/tokens.css` is the **only** place a literal colour may appear. A hex
value in a component is a review failure.

## The two rules people get wrong

**1. Fill tokens are not text tokens.** `--color-success` on porcelain is 4.40:1
and `--color-danger` on its tint is 4.22:1 — both below AA. Use
`--color-success-text`, `--color-danger-text`, `--color-warning-text` whenever the
colour carries text. Both were measured, not estimated.

**2. Lime is device-context only.** `--color-accent` marks the selected device,
verified compatibility, and the selected compatibility filter. It is never a
button, never a generic success, never a focus ring.

## Non-negotiables

- Interactive targets **≥44×44px**. For a label-wrapped control, the label is the
  target.
- Controls 48–52px tall.
- 8-point spacing scale.
- Status is never colour alone — text plus icon or shape.
- Tabular numerals for prices, quantities, order numbers, stock.
- SVG icons from one set. **Emoji are not interface icons.**
- Animate `transform` and `opacity` only. Respect `prefers-reduced-motion`.
- Every interactive element has a visible focus ring.

## Italian copy

Italian labels are longer than English. **Test at 390px**, not 1440.
Tone: concise, helpful, professional, reassuring. Never manipulative.

## Never build

Countdown timers · "N people viewing" · fake stars · invented scarcity · a
percentage saving without a recorded prior price · autoplay video · a carousel
library · an empty section frame where a configuration is missing.

A section with no data renders **nothing**. An empty section looks broken; an
absent one looks finished.
