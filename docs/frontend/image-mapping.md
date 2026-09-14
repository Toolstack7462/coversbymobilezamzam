# Product image mapping

Audit of the existing source provenance and visible public homepage, 14 September 2026. No private merchant media store or supplier catalogue was available. The public site and checked-in credits were inspected before considering replacements. No replacement stock or generated SKU photographs were introduced.

| Product slug                           | Existing object key                    | Audit decision                                                      |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `cover-silicone-iphone-16-pro`         | `products/FQXbLmlmvWY-3e502e5165.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cover-antiurto-galaxy-s24`            | `products/SLRY3AP9g0Y-791f675793.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cover-a-libro-pixel-9`                | `products/erTPOr4SDmk-435e8ca8f0.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cover-trasparente-redmi-note-13`      | `products/GucoomUEQkA-1201235993.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `demo-cover-trasparente-iphone-16-pro` | `products/Z1XDmnXriTE-dcf8188bef.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `vetro-temperato-iphone-16-pro`        | `products/2SKjzvJfbKI-29215ab764.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `vetro-privacy-galaxy-s24`             | `products/PKdPVv-Eb2w-8796fa82a3.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `pellicola-idrogel-universale`         | `products/tYK_iGMdgwY-606231802e.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `caricatore-usb-c-45w`                 | `products/mR3UqBUU9Ts-ed22cf12a1.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `caricatore-due-porte-65w`             | `products/bSviTKDAV8o-15d2c46569.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `caricatore-da-auto-30w`               | `products/ut67iFuoD2o-8aee04c3c2.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `demo-caricatore-usb-c-25w`            | `products/NxnJX6YLDVk-0ef172e88d.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cavo-usb-c-lightning-1m`              | `products/59E1OFivRhE-74e27b45ed.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cavo-usb-c-intrecciato-2m`            | `products/E7EdaTTM7w8-5c8bbc4866.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `adattatore-usb-c-jack`                | `products/APHlCkuUXfU-15659c3681.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `demo-cavo-usb-c-100w`                 | `products/0tJKRYEdFhc-43a00a7620.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `power-bank-10000-mah`                 | `products/CY4mVpRvPxc-ce7586327a.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `power-bank-20000-mah`                 | `products/KI7M3RQezJI-a43a963a5f.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `demo-power-bank-magnetico`            | `products/ybTKLtBQ7NQ-ccb45aff5d.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `caricatore-magnetico-15w`             | `products/xIcr9ygfhIk-d0415c3fc1.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `portafoglio-magnetico`                | `products/UmlxLLbm9a4-ddf0380535.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `auricolari-bluetooth-anc`             | `products/z9NgXD6JLZs-a6060ea120.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `auricolari-con-filo-usb-c`            | `products/GS-imDgsKAQ-9041b43042.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `cuffie-over-ear-bluetooth`            | `products/B9XOTzqICkY-9ee6e401b9.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `supporto-auto-magnetico-bocchette`    | `products/pIFMaARy1yk-56bf5d2397.webp` | Stock photograph; SKU identity/specification unverified; suppressed |
| `supporto-auto-con-ricarica-15w`       | `products/cwHNgptHPxo-6e873bfa22.webp` | Stock photograph; SKU identity/specification unverified; suppressed |

The 45W charger, magnetic wallet and hydrogel photograph are part of this quarantine. An accessory-looking image alone does not establish wattage, capacity, exact fit, ANC, battery life or that the merchant stocks the depicted product. The provenance records explicitly identify stock photographs. All 26 therefore require merchant/supplier product photographs and a SKU check, including visually plausible ones.

The denylist in `app/domain/media/storefront-image.ts` applies to product cards (home, collections, recommendations, bundles) and PDP galleries. Legacy `demo/` illustration keys are also not saleable photography. Existing order snapshots are preserved; historic transaction records are not rewritten. The old stock-photography seeder now exits without uploading or changing any records.

## Merchant replacement workflow

Open the existing product editor, upload the real product photograph and choose the primary image. Retain accurate variant-specific images, alt text and compatibility. The new content-addressed object key is accepted automatically; no Git deployment or product-ID exception is required. This is a denylist of known defects, not a claim that every future upload is verified. The merchant remains responsible for confirming its SKU identity.

Missing deliverables: approved front/detail photographs for the 26 entries, evidence for their seed-derived specifications and actual inventory, and a verified store photograph. No supplier identity or catalogue was supplied, so an exact replacement cannot responsibly be selected from the web.

## Editorial assets

- Old hero `lifestyle/4lrS2PuN_2g-91057cb6bb.webp`: replaced by original brand illustration unless the merchant supplies a different image through `media.hero_image`.
- Store `lifestyle/WEer-k_jhE4-1b79f37377.webp`: documented city context, not shop photography; suppressed. New `media.store_image` remains supported.
- Category imagery continues through existing category media fields and existing attribution in docs/image-credits.json. It is category atmosphere, never a SKU photograph. Crops share one treatment; legibility scrims stay local to labels. Category imagery still needs merchant visual approval.
