---
name: visual-qa
description: Screenshot matrix and what to look for. Use during visual QA passes.
---

# Visual QA

## Widths

**390** (iPhone) · **768** (tablet) · **1440** (desktop)

## Views

homepage · homepage with a selected device · predictive search · device finder ·
listing · mobile filters · product exact fit · product mismatch · product
universal · product out of stock · cart drawer · cart page · checkout · order
confirmation · WhatsApp CTA · store page · admin dashboard · admin product
editor · admin compatibility matrix · admin payment queue · admin inventory ·
empty search · 404 · Italian · English

## Look for

- Horizontal overflow at 390. **Italian labels overflow before English does** —
  check Italian first.
- Sticky add-to-cart colliding with mobile bottom navigation or the safe area.
- Device names clipping in badges and chips.
- Product titles wrapping to more than two lines in a card.
- Inconsistent spacing off the 8-point scale.
- Contrast, especially status text on tinted surfaces.
- Image aspect ratios drifting between card and detail.
- Empty gaps where a section rendered nothing but kept its padding.
- Focus rings missing or clipped by `overflow: hidden`.
- Anything that looks like a default admin template.

## Record

`docs/visual-qa-report.md` — what was checked, what was found, what was fixed,
and what was left with a reason.
