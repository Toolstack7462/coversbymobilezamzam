# Brand and motion

Confirmed public identity: **Covers by Mobile Zam Zam**. Header/footer continue reading the existing identity settings; the complete name remains the accessible home link. Original symbol: rounded protective-cover silhouette with two interlocking Z strokes. No manufacturer logo and no merchant-uploaded inline SVG.

## Assets

- `app/components/storefront/brand-symbol.tsx`: trusted reusable SVG, explicit width/height/viewBox and decorative accessibility semantics inside the named link.
- `public/brand/logo.svg`, `public/brand/logo-reversed.svg`: full wordmark exports.
- `public/favicon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png`: standalone marks.

Static exported assets use the audited token colours baked into the file; application styles use tokens. Header and footer use the same mark and words. Page metadata uses React Router's existing `meta` API, never a client-only document.title effect.

## Composition

All refinement rules live in the storefront route's stylesheet under `.storefront` or uniquely named showcase/discovery selectors. Shared admin controls and styles are not overridden. Container: 1344px, responsive 16–32px gutters. Hero heading: 44–60px. Existing Manrope/Inter fonts, navy/cobalt/ivory tokens and focus rules are retained.

The default hero is explicitly labelled brand illustration, not a saleable product. Merchant replacement artwork renders eagerly with high fetch priority and fixed dimensions. Heading, lead and both navigation actions exist on the initial server render. Essential text never fades.

## Motion

A 380ms entrance moves the decorative object group using individual translate/rotate properties, preserving the tablet scale throughout the entrance. Three pressed-state buttons change restrained cover, charging-disc and cable transforms; a sliding background identifies the selected mode without fading text. Decorative case seams and disc rings provide depth without additional image downloads.

Product cards rise 3px and hero actions 2px on devices with hover and no reduced-motion preference. A short navigation underline has matching keyboard feedback; card keyboard focus gets an outer ring that is not clipped by the image. Product prices align at the bottom of equal-height cards. The photo-review text explicitly resets the old placeholder opacity to preserve the audited contrast.

No carousel, timer, scroll handler, WebGL or animation dependency. Reduced motion removes entrance, state-dependent object movement and sliding transitions; the selected mode updates immediately. Essential text stays readable in every state and all links are available in the server render.

This intentionally follows the user's newer entrance/depth direction over the older project's flat/no-first-paint-motion guidance. Browser animation cost and server CPU are separate measurements: CSS runs in the browser; a dependency's size cannot establish server load. No server-CPU or frame-rate improvement is claimed without a measurement.

## CMS controls

- Existing identity and media settings remain authoritative. Homepage heading overrides and hero supporting copy now read the existing section translation fields.
- Product photographs: existing product media editor and primary-image control.
- Homepage section visibility/order: existing homepage editor.
- Service content: existing Pagine editor gains `Servizio verificato` (`page_type=service`). Uses the existing free-text column and publishing lifecycle, with no migration, new URL or replacement CMS. Publish only confirmed service descriptions; unpublished services disappear from the homepage. Existing guide/page records remain compatible.
- Footer help/legal links continue to derive from published content.
