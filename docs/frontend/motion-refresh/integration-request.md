# Integration request for Claude

## Integration order and ownership

1. Integrate/reconcile PR #16 (English admin and public locale work) at `2b88965efc6ef966c950749e2011000775a7928c`.
2. Review PR #17 (`feat/storefront-motion-refresh`) relative to that commit, not as a new collection of the inherited shared/admin changes.
3. Review the separately authorised login presentation exception (`app/routes/admin/login.tsx`, `app/styles/admin-login.css`). The user's follow-up explicitly requested a branded 3D login and visible loading feedback. No login loader/action or authentication semantics changed.
4. Use your safe preview environment for visual approval before any production merge. This branch changes no Hostinger settings or GitHub workflow.

No dependency, migration, payment/inventory service, server, shared root/base style or locale JSON edit is requested. No budget increase is requested.

## Small loader addition for the PDP presentation repair

`app/routes/storefront/product.tsx` retains all original queries and response fields, adding the selected variant’s `stock` display state and `compatibility`, the result of the existing domain `resolveCompatibility` for a null selected device. The old component performed exactly that calculation on every render. The existing `compatibilityRecords` contract is retained. Resolution and the stock display calculation now run once server-side using the original domain functions, instead of shipping those calculations with the customer bundle. The `variante` query selects the same existing variant in the loader and component. All original queries and fields remain intact.

The new `?variante=<existing variant ID>` parameter is presentation state. Unknown IDs fall back to the existing default variant; links preserve all other query parameters. Price, stock, SKU, buy bar, and the existing `/carrello` POST use the same selected variant. Server cart validation remains authoritative. This is backward-compatible with URLs without the parameter and works without JavaScript.

## Existing device-context gap requiring a coordinated decision

The finder routes carry selection in URLs; the PDP currently has no persisted device selection. The former finder statement claiming browser persistence was removed because it is not implemented. This refresh does not invent a persistence API or assert selected-device fit on the PDP. If persistence is desired, integrate the existing device domain with the shell and product links as one shared change, preserving explicit variant-level records and mismatch precedence. The current non-personalised compatibility prompt is honest and unchanged.

## New UI strings

None required. The refresh uses the existing Italian/English keys, including `common.loading`, `product.choose_variant` and the three hero guidance messages. Login uses existing admin `Caricamento` and existing translated labels. Merchant brand names and approved SVG artwork are not translated.

## Media and preview requirements

Use existing admin controls for hero/category/store media, product uploads/order/alt text, homepage sections and published pages. No new slot or database field was added. The approved `/brand/logo.svg`, `/favicon.svg`, favicon ICO and Apple icon are retained. Login reuses that approved public identity.

Supply verified merchant/supplier SKU photographs before replacing the explicitly marked missing-photo states. Production Hostinger deployment/branch automation must be checked in your hosting account; this isolated branch does not change it or assume a public preview URL exists.
