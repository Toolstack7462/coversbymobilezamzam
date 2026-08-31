# Product imagery — what the shop needs

The catalogue currently ships **original line illustrations**, not photographs.
They are honest placeholders: the alt text says so in both languages, and every
product carrying one is prefixed `[DEMO]`. They exist so the grid can be judged
at realistic density, and they are the single largest thing standing between
this storefront and looking premium.

**No stock photography will be used, and no AI-generated product images.** A
picture of an accessory the shop may not stock is a lie told in a medium
customers trust more than text — and a generated image of a real product is
worse, because it will be subtly wrong in ways a customer discovers after
paying.

---

## What is needed, per product

|            | Requirement                                                                           |
| ---------- | ------------------------------------------------------------------------------------- |
| Count      | 3–5. One on white, one in the hand, one detail, one in the box                        |
| Primary    | On a plain background. This is the grid image                                         |
| Format     | Upload JPEG, PNG or WebP. **SVG is refused** — it is a document that can carry script |
| Dimensions | 2000×2000 minimum for the primary; square                                             |
| Aspect     | Square for the primary. The card crops to 1:1                                         |
| File size  | Under 5MB each before processing                                                      |
| Colour     | sRGB. Adobe RGB shifts once the browser converts it                                   |

## Composition

The three that matter, in order of value:

1. **On white, centred, full product.** Shot straight on, even light, no
   shadow crossing the edge. This is the one in the grid and it does more work
   than the other four combined.
2. **In a hand.** An accessories customer is judging size, and nothing conveys
   scale like a hand. It is also the shot that separates a real shop from a
   drop-shipper, because it cannot be taken from a supplier's catalogue.
3. **The detail that justifies the price.** The raised lip on a case, the
   braiding on a cable, the port layout on a charger.

Shoot on the counter with a window to one side and a sheet of white card
opposite. That is genuinely enough; a phone camera in good light beats a bad
studio shot, and it beats a stock image absolutely.

## Consistency

- Same background, same distance, same angle for every primary shot.
- Product occupies roughly 80% of the frame.
- No props that are not for sale.
- No text, badges or price stickers burned into the image — those are the
  interface's job, and burned-in text cannot be translated or made accessible.

---

## Category imagery

`.category-tile` is built to accept a background image without any layout
change. One landscape image per category, 1600×1000, dark enough at the lower
edge for the name to remain legible — or a scrim will be added.

## The hero

The right half of the hero is deliberately empty and reads as composed rather
than broken. A single hero image would fill it: 2400×1600, a product in context,
lit warm to sit against `--color-canvas`.

---

## How to upload

Admin → Prodotti → the product → images. The pipeline records width, height,
byte size, MIME type and a SHA-256 for every file, and serves it from R2 through
`/media/*` with a year of immutable caching.

To replace the demo artwork, upload real photographs and delete the placeholder:
it is marked `is_primary`, so a new primary must be set or the illustration
keeps the grid slot.

## What is already handled

- Responsive delivery and lazy loading below the fold.
- `width`/`height` on every image, so nothing shifts (CLS is currently 0 and
  must stay there).
- Alt text per locale.
- No resizing in the request path — that belongs in a build step or Cloudflare
  Images, not in a Worker with a 10ms CPU budget.
