# Device compatibility

The hardest data problem in this shop, and the one that decides whether customers
trust it. A wrong "compatible" costs a return, a refund and a review.

---

## Hierarchy

    Brand      Apple, Samsung, Xiaomi, Google, OPPO, OnePlus, Motorola, Huawei, Nothing
      └─ Family        iPhone 16, Galaxy S24, Redmi Note 13
           └─ Model    iPhone 16 Pro, iPhone 16 Pro Max   ← compatibility attaches HERE

**Brands are data, not code.** No brand name is hardcoded in a component. The
admin can add, edit, reorder and archive them, because this list will change and
a code change should not be required when it does.

Compatibility attaches to the **exact model**. "iPhone 16" and "iPhone 16 Pro"
are different sizes; a case for one does not fit the other.

---

## Aliases

`device_aliases` carries the ways real people type a model:

    iPhone 16 Pro  →  iphone16pro · iphone 16pro · ip16 pro · 16 pro · iphone16 pro

Customers do not type canonical names. Aliases feed search and the device finder,
and are the difference between "no results" and a sale.

---

## Compatibility levels

| Level              | Customer sees (IT)                                                       |
| ------------------ | ------------------------------------------------------------------------ |
| `exact_fit`        | _Compatibilità esatta con iPhone 16 Pro_                                 |
| `compatible`       | _Compatibile con iPhone 16 Pro_                                          |
| `universal`        | _Accessorio universale — controlla connettore e potenza_                 |
| `adapter_required` | _Compatibile tramite adattatore_                                         |
| `incompatible`     | _Questo prodotto non risulta compatibile con il dispositivo selezionato_ |
| `unverified`       | _Compatibilità non verificata_                                           |

---

## Resolution

`app/domain/compatibility/resolve.ts` — a pure function. Input: the product's
compatibility records and the selected device. Output: one state.

1. **Variant record beats product record.** A colour that only exists for one
   model is variant-level.
2. **Explicit `incompatible` wins** over any broader compatibility.
3. **`universal` never becomes exact fit.** A 20W USB-C charger works with an
   iPhone 16 Pro, but it is not _made for_ it, and saying so would be a false
   precision that erodes trust in every other badge.
4. **`unverified` surfaces as unverified.** Never silently upgraded.
5. **No record means unknown**, never compatible. Absence of evidence is not
   evidence of fit.
6. **Nothing is inferred** from title, tag, category, URL, brand, search result
   or collection.

Rule 6 is the one under constant pressure, because inference is so easy and looks
right most of the time. It is wrong exactly when it costs money: a bulk import
titled "Cover per iPhone 16" that also fits nothing else.

---

## Mismatch behaviour

When the selected device is not compatible:

- **Warn clearly** — the state is shown prominently near the buy button.
- **Never block.** The customer may be buying for someone else, and blocking a
  sale on our data being complete is arrogant.
- **Offer alternatives** — compatible products in the same category.
- **Do not nudge toward the mistake.** No pre-selected quantity, no highlighted
  add-to-cart.

---

## Verification

`product_compatibility` carries `verified`, `verification_source`, `verified_by`,
`verified_at`, and `compatibility_verification_logs` records the history.

Sources: `manufacturer_spec`, `physical_test`, `supplier_data`, `staff_judgement`.

A record entered from a supplier spreadsheet is not the same as one where someone
put the case on the phone, and the admin shows which is which. Verification
changes are audited (invariant 8).

---

## The device finder

_"Trova accessori per il tuo dispositivo"_ — brand → family → model → category.

Search with aliases · popular devices · recently selected · persistent selection ·
change device · remove device · no-results recovery · full keyboard operation ·
full-screen on mobile, guided panel on desktop.

### Why the selection is client-side

The selected device lives in `localStorage`, and compatibility badges resolve in
the browser from data the server rendered.

SSR pages are cacheable. If the server baked one visitor's device into the HTML,
the next visitor could be served it. Rendering the facts server-side and
resolving them client-side keeps pages cacheable and correct.

The flag is set before first paint so badges do not shift layout (CLS).

### What selecting a device changes, and what it does not

Changes: compatibility labels · compatible-only filtering · related products ·
mismatch warnings · recommendations.

Does **not** change: the authoritative `product_compatibility` records. A
customer's selection is a lens, never a write.

---

## Cross-device persistence

The selection does not follow a customer to another browser or phone, and the
interface says so rather than letting them assume otherwise. Signed-in
persistence is possible later; it is deliberately not faked now.

---

## Tests

`tests/unit/compatibility.test.ts` covers every level, variant override,
explicit-incompatible precedence, universal-never-exact, unverified surfacing,
and the missing-record case.
