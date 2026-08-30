---
name: accessibility-wcag22
description: WCAG 2.2 AA rules this codebase can realistically break. Use when building any interactive component or reviewing markup.
---

# Accessibility (WCAG 2.2 AA)

## Measured contrast facts for this palette

`--color-success` as text on porcelain is **4.40:1**. `--color-danger` on its own
tint is **4.22:1**. Both fail AA. Both are fine as **fills** — white on
`#D92D20` is 4.83:1.

Use `--color-success-text` / `--color-danger-text` / `--color-warning-text`
wherever the colour carries text.

## Target size (2.5.8)

**44x44px minimum.** For a label-wrapped checkbox or radio, the *label* is the
target — measure the label, not the box. A 36px chip is a failure, and it is
easy to reintroduce by duplicating a CSS rule.

## Required on every interactive component

- Reachable and operable by keyboard alone
- Visible focus indicator, never removed
- Accessible name — icon-only buttons need `aria-label`
- `Escape` closes dialogs and drawers
- Focus trapped inside a modal, and **returned** to the trigger on close
- Status changes announced via a live region
- Never colour alone to convey state

## Forms

Visible labels, not placeholder-only. Errors beside the field, not only at the
top. `aria-live` or `role=alert` for error summaries. Focus the first invalid
field on submit. Semantic input types so mobile shows the right keyboard.

## Structure

One `h1`. No skipped heading levels. Landmarks. A skip link that actually moves
focus.

## Testing caveat, stated honestly

Automated axe checks cover roughly a third of WCAG. They do not replace manual
keyboard testing or a screen reader. Say so in reports rather than implying
coverage.

Note: WebKit does not Tab to links without full keyboard access enabled. A test
asserting that is testing a browser preference, not the site. Assert DOM focus
order instead.
