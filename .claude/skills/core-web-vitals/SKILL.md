---
name: core-web-vitals
description: Performance budgets and the techniques that hold them. Use when adding a dependency, an image, a font, or a route.
---

# Core Web Vitals

## Targets and budgets

LCP <= 2.5s · INP <= 200ms · CLS <= 0.1
Initial storefront JS **< 160KB gzip** · CSS **< 45KB gzip**

`npm run budgets` is a hard gate, not a warning.

## Before adding any dependency

Ask what it costs gzipped and whether 30 lines would do. A date library, a
carousel, a component kit and an icon package will each individually seem fine
and collectively blow the budget.

**Never add:** a CSS framework, a component library, an animation library, a
carousel, an analytics script.

## CLS

Every image has `width` and `height` or an `aspect-ratio` box. Reserve space for
anything async. The device-context flag is set **before first paint** so
compatibility badges do not shift the layout in.

## LCP

SSR the above-fold content. Eager-load only the genuine LCP image; lazy-load
everything below the fold. Preload only the two fonts actually used above the
fold, with `font-display: swap`.

## INP

Minimal hydration. Native `details` for accordions — zero JS. Debounce search
input. Keep main-thread work per frame under ~16ms.

## Database

`EXPLAIN QUERY PLAN` on any query over a growing table. Paginate. Never ship the
whole catalogue to the browser.

## Honesty rule

**Core Web Vitals are not claimed until measured against a deployed preview.**
A local Lighthouse run on localhost is not evidence.
