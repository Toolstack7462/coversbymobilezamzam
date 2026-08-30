# Admin guide

For the person running the shop. No coding required for anything here.

---

## 1. First access

Go to **`/admin/installazione`** and create your account.

That page works **once**. The moment the first administrator exists it stops
existing — permanently — so nobody can use it to create a second account later.
After that, sign in at **`/admin/accedi`**.

There is no default account and no public registration. If you lose access to
the only administrator account, a developer has to grant a role in the database.
**Create a second administrator early.**

---

## 2. The screens

| Screen                | What it is for                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Dashboard**         | Today's numbers, what needs doing, and which parts of the site are hidden because a setting is empty |
| **Pagamenti**         | The verification queue — the most important screen here                                              |
| **Ordini**            | Order list and status changes                                                                        |
| **Prodotti**          | Publish, unpublish, archive                                                                          |
| **Inventario**        | Stock levels and adjustments                                                                         |
| **Impostazioni**      | Shop details and payment methods                                                                     |
| **Registro attività** | Who changed what, and when                                                                           |

You only see the screens your role allows. If a menu entry is missing, your
account does not hold that permission — that is not a fault.

---

## 3. Verifying a payment — read this once, properly

This is the part where mistakes cost real money.

**A screenshot from a customer is not proof of payment.** It is an image, and
images are trivially edited. Before you mark anything verified:

1. Open your **actual** bank account, or the Satispay Business app.
2. Find the money.
3. Check the amount matches.
4. Check the _causale_ matches the order number.

Only then record it in the queue.

### How the screen works

The queue asks for your password before you can verify anything. That is
deliberate: it confirms it is really you and not someone who sat down at an
unlocked computer. The confirmation lasts **10 minutes and covers one
verification** — verifying a second payment asks again. That is not a bug.

For each payment you record:

- **Esito** — what actually happened
- **Importo ricevuto** — what you actually saw, in cents (`3990` = €39,90)
- **Riferimento operazione** — the bank or app reference
- **Nota** — required if there is no reference

### The amount does not match

The system will refuse to mark it "verificato". That is intentional. Choose:

- **Pagamento parziale** — they sent less. The order stays reserved and you
  contact them.
- **Pagamento in eccesso** — they sent more. Decide about a refund.

Never round a mismatch away by editing the amount. The record should say what
happened.

### "Riferimento duplicato"

The same reference appears on another order. This is **flagged, not blocked**,
because it is often legitimate — one transfer covering two orders, or a customer
reusing a reference by mistake. Look at both orders and decide.

---

## 4. Stock

**Disponibile = giacenza − prenotato.** Reserved units belong to unpaid orders
that are still within their window; they are not available to anyone else.

Every adjustment needs a real reason. "Contate 3, sistema 5: 2 mancanti" is a
reason. "Sbagliato" is not — in six months it will explain nothing.

You cannot reduce stock below the reserved quantity. Cancel the orders holding
it first.

---

## 5. Payment methods

Every method ships **disabled**, and stays disabled until you fill in where the
money goes. That is why nothing appears at checkout on a fresh install.

**Use a business account, never a personal one.** A personal IBAN taking
business receipts creates tax and traceability problems that are yours, not the
website's.

Changing an IBAN asks for your password again. The value is encrypted, never
shown in full afterwards, and never written to any log. Every change is recorded
with who made it.

**BANCOMAT Pay stays off** until you have real merchant activation. Being able
to send money person-to-person is not the same as being able to accept it as a
business.

---

## 6. Why is something missing from the website?

Because the setting it needs is empty. That is the design: a blank field renders
**nothing** rather than `[TELEFONO]` or an invented value.

The dashboard lists exactly which features are hidden and which settings are
missing. Fill them in under **Impostazioni** and they appear.

Currently hidden until you supply the data: shop name, opening hours, phone,
WhatsApp button, the legal footer, and the Google business listing data.

---

## 7. What the system will not let you do

| Request                                          | Why not                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| "Mark this order paid without checking the bank" | The one rule this system will not bend.                                                  |
| "Add a countdown to the sale"                    | A fabricated deadline is an unfair commercial practice under EU law.                     |
| "Show a percentage off"                          | Only with a genuine recorded 30-day prior price (D.Lgs. 84/2022).                        |
| "Show some review stars until we get real ones"  | Stars render only from real reviews.                                                     |
| "Delete this product"                            | It is archived instead — orders reference it, and deleting would break your own history. |
| "Say ready for pickup today"                     | Only once a staff member has physically set the item aside.                              |

---

## 8. Every day

- Check **Pagamenti** for anything awaiting verification
- Check the dashboard for orders ready for pickup that nobody has collected
- Glance at "Job automatico". If it says **NON attivo**, tell your developer:
  stock stays reserved and products quietly vanish from sale.

## Before going live

See `docs/launch-checklist.md`. The short version: your legal details, at least
one working payment method, a lawyer's review of the legal pages, and an
accountant's review of the invoicing.
