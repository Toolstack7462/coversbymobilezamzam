# Admin task map

Every task a merchant performs, where it happens, how many steps it takes, and
whether a browser test proves it works.

Written after the workflow tests rather than before them, so the step counts are
what the tests actually walked rather than what the screens were meant to
require.

---

## 1. How to read the "steps" column

A step is one thing the merchant does: a click, a typed field, a submit. Opening
a page from the sidebar counts as one. Steps are counted from the **Panoramica**,
because that is where somebody starts their day.

Numbers marked **(measured)** come from a browser test walking the flow.
Everything else was counted by hand from the screens and should be treated as
approximate.

---

## 2. Catalogue

| Task                                          | Where                               | Steps    | Proven by                                                                    |
| --------------------------------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Find a product by name                        | Prodotti → search                   | 3        | `admin-workflows` — search keeps its state in the URL **(measured)**         |
| Find a product by SKU                         | Top-bar search                      | **2**    | `admin-workflows` — finds a product by SKU **(measured)**                    |
| See what is in stock without opening anything | Prodotti                            | **1**    | `admin-workflows` — shows SKU and stock without opening a row **(measured)** |
| Create a product                              | Prodotti → Aggiungi prodotto        | 1 + form | `admin.spec`                                                                 |
| Change a product's name or description        | Prodotti → row → Dettagli → Salva   | 4        | `admin-workflows` — a saved detail survives a reload **(measured)**          |
| Jump to one section of a long product         | Product → section nav               | **3**    | `admin-workflows` — jumps straight to a section **(measured)**               |
| Change a price                                | Product → Varianti → Salva prezzo   | 4        | `admin.spec`                                                                 |
| Add a photo                                   | Product → Foto → upload             | **4**    | `admin-workflows` — a real PNG, uploaded and read back **(measured)**        |
| Choose the primary photo                      | Product → Foto → "Rendi principale" | 4        | `admin-workflows` — the pinned photo has no arrows **(measured)**            |
| Describe a photo after uploading it           | Product → Foto → Salva descrizione  | **4**    | `admin-workflows` — the warning badge clears **(measured)**                  |
| Reorder the photos                            | Product → Foto → ↑ ↓                | **3**    | `admin-workflows` — survives a reload **(measured)**                         |
| Delete a photo                                | Product → Foto → Elimina → conferma | **4**    | `admin-workflows` — asks first, in the markup **(measured)**                 |
| Record device compatibility                   | Product → Compatibilità → add       | 5        | `admin.spec`                                                                 |
| Record a technical specification              | Product → Varianti → variant → save | **5**    | `admin-workflows` — a cable's length survives a reload **(measured)**        |
| Duplicate a product in another colour         | Product → Duplica prodotto          | **2**    | `admin-workflows` — a draft copy with no stock **(measured)**                |
| Publish a product                             | Product → Pubblicazione → Pubblica  | 3        | `admin-workflows` — refuses without a price **(measured)**                   |
| Archive a product                             | Product → Archivia                  | 3        | `admin.spec`                                                                 |

### The specification fields change with the kind of product

A cable is asked for its length and its connectors. A phone case is asked for
neither, and never for a battery capacity. Six columns have existed on
`product_variants` since the first migration and the editor surfaced none of
them, so a charger's wattage could only go in the free-text description.

The type also decides which columns a submitted form may **write**, which is a
security property rather than a convenience: the column names are interpolated
into an `UPDATE`, because an identifier cannot be bound as a parameter.

### What a duplicate copies, and what it refuses to

| Copied                                                     | Not copied                       |
| ---------------------------------------------------------- | -------------------------------- |
| Name (with "(copia)"), descriptions, brand, category, type | **Stock — always zero**          |
| Variants, their specifications, and their prices           | **Publication — always a draft** |
| Photographs, as references to the same stored objects      | Variant-scoped compatibility     |
| Product-level device compatibility                         |                                  |

Stock is a physical fact about a shelf. A copy that arrived claiming twelve in
hand would oversell on its first day, so inventory rows are created at zero and
the confirmation notice says so in the first sentence. Variant SKUs get a `-C`
suffix, so a person holding the box can tell which is which.

### What the publication guard refuses, and why

Publishing a product with no price is **refused**, not warned about: the
storefront would render a live page with nothing to add to a cart. The message
says what is missing rather than that something is. A browser test presses the
button and then confirms the product is _still_ a draft — a refusal that showed
a message and published anyway would be worse than no message.

---

## 3. Inventory

| Task                                  | Where                                             | Steps | Proven by                                                        |
| ------------------------------------- | ------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| See what is running out               | Inventario → Scorte basse                         | 2     | `admin-visual`                                                   |
| See what is already sold but not paid | Inventario → Con prenotazioni                     | 2     | `admin-visual`                                                   |
| Adjust a stock figure                 | Inventario → Rettifica → quantity + reason → save | **4** | `admin-workflows` — the reason reaches the ledger **(measured)** |
| Find out why a figure changed         | Inventario → Movimenti                            | 2     | `admin-workflows` **(measured)**                                 |

**Reserved stock is never editable.** It is derived from live orders, and a
field that let a merchant "correct" it would create two disagreeing numbers with
no way to tell which was right. A browser test asserts there is no such input.

**A reason is required by the browser, before the request is sent.** A stock
figure that changed for no recorded reason cannot be reconciled against a shelf
later.

---

## 4. Orders and payments

| Task                               | Where                             | Steps       | Proven by                                                    |
| ---------------------------------- | --------------------------------- | ----------- | ------------------------------------------------------------ |
| See who is waiting to be contacted | Ordini → Da contattare            | 2           | `admin-visual`                                               |
| Open an order                      | Ordini → row                      | 2           | `admin-workflows` **(measured)**                             |
| Message a customer on WhatsApp     | Order → Apri WhatsApp             | 3           | not yet                                                      |
| See the customer's phone number    | Order — side column, no scrolling | **2**       | `admin-workflows` — customer beside the order **(measured)** |
| Move an order to its next state    | Ordini → row select → Applica     | 3           | `admin-workflows` — survives a reload **(measured)**         |
| Verify a payment                   | Pagamenti → row → verify          | 3 + step-up | `tests/security/payment-verification`                        |
| Add an internal note               | Order → Nota interna              | 3           | not yet                                                      |

**The status control offers only legal transitions, and never `paid`.** `paid`
is set by payment verification alone: a dropdown that offered it would be a way
to mark money received without anyone looking at a bank account. A browser test
asserts the option is absent.

---

## 5. Content and settings

| Task                                 | Where                          | Steps    | Proven by      |
| ------------------------------------ | ------------------------------ | -------- | -------------- |
| Change the homepage hero             | Contenuti → Homepage           | 2 + form | `admin.spec`   |
| Edit a page's text                   | Contenuti → Pagine → page      | 3 + form | `admin.spec`   |
| Change opening hours                 | Impostazioni                   | 2 + form | `admin.spec`   |
| Change the WhatsApp number           | Impostazioni                   | 2 + form | `admin.spec`   |
| See what the site is hiding, and why | Panoramica → Funzioni nascoste | **1**    | `admin-visual` |

The overview's "Funzioni nascoste sul sito" panel is the answer to the question
a new merchant actually asks — _why is my phone number not on the site?_ — and
it names the setting that would fix each one.

---

## 6. Staff and security

| Task                | Where                        | Steps    | Proven by                               |
| ------------------- | ---------------------------- | -------- | --------------------------------------- |
| Invite a colleague  | Personale → invite           | 2 + form | `admin.spec`                            |
| Suspend somebody    | Personale → member → suspend | 3        | `admin.spec`                            |
| Enrol in two-factor | Sicurezza → 2FA              | 2        | `auth.setup` — the real flow, every run |
| End another session | Sicurezza → Sessioni         | 2        | `admin.spec`                            |

---

## 7. Tasks that still take too many steps

Recorded rather than quietly accepted.

| Task                                           | Steps | Why it is long                                                                                                        |
| ---------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| Add a photo to a new product                   | 6+    | Create → save → reopen → Foto → choose file → upload. The editor cannot accept an image until the product row exists. |
| Price every variant of a three-variant product | 9     | One save per variant. A single form covering all of them would be one submit.                                         |
| Record compatibility for ten devices           | 30+   | One add per device. A multi-select against a device family is the obvious fix and is not built.                       |

None of these is a correctness problem. All three are the same shape: a form
that handles one row where the merchant is thinking in batches.

---

## 8. What has no browser proof yet

|                                               |                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image derivatives                             | One 900×900 file serves every size. Measured and costed in [hostinger/media-optimisation.md](hostinger/media-optimisation.md); blocked on a dependency decision.                |
| The two write-heavy workflow tests on a phone | They run on desktop only. Both Playwright projects share one server and one database, so running a writing test twice concurrently tests the scheduler rather than the feature. |
| WhatsApp message composition                  | Opens an external URL; asserting the URL is possible, opening it is not.                                                                                                        |
| Internal notes                                |                                                                                                                                                                                 |
| Payment verification through the UI           | Covered server-side in `tests/security/payment-verification`, which exercises the rules including step-up. The screen itself is not walked.                                     |
| Anything on the MariaDB runtime               | The browser suite runs against `wrangler dev` and D1.                                                                                                                           |
| Firefox, WebKit                               | Chromium only.                                                                                                                                                                  |
