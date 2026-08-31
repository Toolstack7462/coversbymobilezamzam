# Admin user flows

The jobs the shop actually does, traced through the screens, with the failure
each flow is designed around.

Written from the counter's point of view rather than the code's: the test of
this document is whether someone who has never seen the admin could follow a
flow with a customer waiting.

---

## 1. A payment arrives (the daily flow)

**Trigger:** a customer sends a transfer or a Satispay payment and tells you.

1. Open `/admin` — **Da fare adesso** shows _Pagamenti da verificare_ at the top
   as a blocking item, because a customer is waiting on their money.
2. **Apri** goes to `/admin/pagamenti?vista=da-verificare`, already filtered.
   The queue is ordered by reservation clock: whoever is closest to losing their
   stock is first.
3. Each card shows expected, claimed and received amounts, the reference, how
   many proofs were uploaded, and whether that reference already appears on
   another order.
4. **Check the actual bank account or app.** The screen says so, on the screen,
   because staff are the control and should know they are the control.
5. First verification of a session asks for the password again (step-up). It
   lasts ten minutes and is consumed on use, so it cannot be replayed.
6. Record what was actually received. A mismatch is refused rather than rounded.

**The failure this is built around:** a screenshot from a customer is not
evidence of payment, and no amount of interface can make it one. Nothing in the
system can mark a payment verified except a human with `payment.verify` plus a
fresh step-up (invariant 6).

---

## 2. An order needs the customer contacted

**Trigger:** an order is placed on the site. No card was taken; the customer
needs payment instructions.

1. `/admin` shows _Ordini in attesa del vostro contatto_ — blocking.
2. **Apri** goes to `/admin/ordini?vista=da-contattare`.
3. Open the order, send the WhatsApp message.
4. Stock is already reserved and the reservation is counting down. If the
   customer never pays, the sweeper releases it automatically.

**The failure this is built around:** an order sitting uncontacted holds stock
out of the shop for nothing. It is blocking severity for that reason, not
because the customer is impatient.

---

## 3. Preparing what has been paid for

1. `/admin` shows _Ritiri da preparare_ and _Ordini da spedire_ separately —
   different physical jobs, different places in the shop.
2. Each links to `/admin/ordini?vista=da-preparare&consegna=ritiro` (or
   `spedizione`).
3. The **Sposta a** dropdown offers exactly the transitions the state machine
   allows from the current status, minus `paid`, which only the verification
   queue can set.

**The failure this is built around:** a dropdown that offers a move the domain
will reject is a bug performed in front of staff. The options are computed
server-side from the same state machine that enforces them.

---

## 4. Adding a product

1. `/admin/prodotti` → **Aggiungi prodotto**.
2. After creating it, the saved views make what is missing findable: _Senza
   prezzo_, _Senza immagine_, _Senza compatibilità_ are tabs with live counts.
3. The setup centre surfaces the same gaps as blocking or recommended steps.

**The failure this is built around:** a product that is saved but not sellable.
Rather than a wizard that refuses to finish, the product can be saved
incomplete and the gaps are made impossible to lose track of. A merchant
interrupted by a customer mid-form should not lose the work.

**Not yet built:** the six-step guided wizard, and the product/variant/media
editors. See `docs/launch-checklist.md`.

---

## 5. Correcting stock

1. `/admin/inventario`, or the _Esauriti_ / _Scorte basse_ tabs.
2. Every adjustment requires a **reason** and writes a movement plus an
   adjustment row with the before and after quantities.

**The failure this is built around:** there is deliberately no bare "set
quantity to N" field. Without a reason and a ledger entry, a discrepancy is
unexplainable — you know the count is wrong and cannot find out when or why
(invariant 4).

Note that "available" is always `on_hand − reserved`. A unit reserved against an
unpaid order is not available to sell, and a stock screen showing the raw count
is how a shop oversells.

---

## 6. Filling in the shop's details

1. `/admin/configurazione` lists what is missing, computed from real data.
2. Each step links to the exact screen — mostly `/admin/impostazioni`.
3. Each settings field says what goes in it, which law requires it where one
   does, and **what the site does if it is left blank**.

**The failure this is built around:** the storefront hides features rather than
printing placeholders, so a blank field silently removes something. Saying which
thing turns an invisible behaviour into an informed choice.

---

## 7. Changing a price

1. `/admin/prodotti`, open the product, edit the price.
2. A `price_history` row is written automatically.

**The failure this is built around:** without that history the 30-day prior
price cannot be evidenced, and a discount could not lawfully be announced
(D.Lgs. 84/2022). A percentage saving renders on the storefront **only** when a
prior price is on record — the interface cannot be talked into claiming one.

---

## 8. Adding a staff member

1. `/admin/personale` → invite by email. The invitation is scoped to that
   address and its token is stored hashed.
2. They set a password and **must** enrol in TOTP before reaching anything
   privileged.
3. Until they do, the sidebar shows only the security pages — offering the full
   menu would produce a wall of redirects.

**The failure this is built around:** the four routes that could leave the shop
with no super admin (removing the role, suspending, disabling, archiving) are
all refused by `wouldOrphanSuperAdmin`. Nobody can lock the shop out of its own
admin, including by accident.

---

## 9. Checking the system is actually running

`/admin/sistema` reads live: when the reservation sweeper last ran, how many
expired reservations are still holding stock, whether any inventory row breaks
its invariant, and when a backup was last actually restored.

Nothing here is a stored health flag. A flag that says "healthy" is only ever as
fresh as the last thing that remembered to update it.

**The failure this is built around:** a stopped sweeper is silent. Stock stays
reserved forever and products quietly vanish from sale while sitting in the
stockroom. It appears as a blocking action-centre item within thirty minutes.

---

## What every flow has in common

- **Deep links land filtered.** No flow ends with "now filter this list
  yourself".
- **Counts never lie.** Dashboard figures are built from the same SQL the lists
  use, so a badge cannot disagree with the page it opens.
- **Nothing shows at zero.** An item that says "0 to do" trains people to skim
  past the row that one day says 3.
- **Nothing irreversible is one click.** Archive, never delete. Verification
  needs step-up. Adjustments need a reason.
