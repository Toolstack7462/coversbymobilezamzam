# Brand, motion and imagery

The full public identity remains **Covers by Mobile Zam Zam**. Existing original cover/double-Z SVG artwork is reused in the shared storefront lockup, hero and approved login artwork. The favicon SVG/ICO and Apple touch icon remain unchanged.

Storefront tokens are scoped under `.storefront`: canvas `#F1F5FB`, ink `#0B1220`, action `#2457FF`, secondary text `#475569`, white product/form surfaces, compatibility accent `#B9F227`. Hero gradient: `#E6EEFF → #EDF5FA → #F6F4F0`; footer: `#E4ECF6 → #D6E2F0`. No shared palette/admin dashboard overrides.

## Motion contract

- CSS 2.5D illustration, not WebGL or saleable product photography. Phone/case 950–1150ms entrance; accessories settle at 1250ms. No opacity gating of headings, CTA, scene or primary photograph.
- Pointer depth is event-driven, bounded to about ±3° horizontally/±2° vertically, mouse/hover only, and resets on leave. No requestAnimationFrame loop, off-screen loop, permanent `will-change` or engine.
- Protect/Charge/Connect controls change the accessory emphasis and translated guidance. Essential text stays fully opaque; no automatic rotation/carousel.
- Product/category hover lift: 2–3px, 220ms, suitable pointer only. Finder/accordion content entrance: 6px, 220ms. Gallery uses native anchors, scroll snap and predictable browser scrolling.
- Reduced motion removes animations/transitions, pointer depth and smooth scroll. Hero mode text/state remains functional, while object poses remain stationary.
- Real router pending state announces loading and leaves existing content visible. It does not show a fake percentage, delay navigation or block controls behind a splash. Add-to-cart and login forms expose pending state and disable duplicate submission while navigating.
- Login has its own scoped blue/stone gradient and finite 900ms decorative plate entrance; compact screens prioritise the real form and full logo.

## Image mapping

No product image was fabricated, generated, reassigned or relabelled in this pass. The previous audit's 26 quarantined demo-image associations remain excluded by `saleableImageKey`. In particular the charger/mouse, magnetic-wallet/setup and unclear hydrogel photographs remain excluded. Correct replacement photographs still need the merchant's confirmation of SKU, colour/model and connector/specification identity.

Hero illustration is explicitly labelled using the existing Italian/English `home.showcase_illustration` key. Setting merchant hero media replaces it through the existing field; the first image remains eager/high priority. Category and store photographs likewise retain their CMS keys. No city stock image is presented as a store photograph. Placeholder frames reserve real image proportions; they do not claim stock, compatibility or service availability.
