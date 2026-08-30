---
name: mobile-device-compatibility
description: Rules for the device compatibility model. Use when touching compatibility records, the resolver, the device finder, or any badge that claims a product fits a phone.
---

# Device compatibility

Brand -> Family -> **Model**. Compatibility attaches to the exact model, because
iPhone 16 and iPhone 16 Pro are different sizes.

## Resolution order

1. Variant record beats product record.
2. Explicit `incompatible` beats any broader compatibility.
3. `universal` **never** becomes `exact_fit`.
4. `unverified` surfaces as unverified. Never silently upgraded.
5. **No record means unknown, not compatible.**
6. Nothing is inferred from title, tag, category, URL, brand or collection.

Rule 6 is the one under constant pressure because inference looks right most of
the time. It is wrong exactly when it costs money.

## Levels

`exact_fit` · `compatible` · `universal` · `adapter_required` · `incompatible` ·
`unverified`

## Mismatch

Warn clearly. **Never block the purchase** — the customer may be buying for
someone else. Offer compatible alternatives. Do not nudge toward the mistake.

## Device selection is client-side

It lives in `localStorage`. SSR pages are cacheable, so a server-rendered device
would leak one visitor choice to the next. The server emits the facts; the
browser resolves them. Set the flag before first paint so badges do not shift
layout.

A customer selection is a lens, **never a write** to compatibility data.

## Aliases matter

Customers type `iphone16pro`, `ip16 pro`, `16 pro`. Without `device_aliases`
these are zero-result searches, which is a lost sale rather than a data problem.

## Verification

Record the source: `manufacturer_spec`, `physical_test`, `supplier_data`,
`staff_judgement`. A spreadsheet import is not the same as someone putting the
case on the phone, and the admin shows which is which.
