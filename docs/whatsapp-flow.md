# WhatsApp flow

**Click-to-Chat only.** No WhatsApp Business Platform, no API, no webhook, no
programmatic message reading.

The site opens a pre-filled chat. Everything after that happens between two
people, and the system makes no claim to know what was said.

---

## Why not the Business API

It needs a Meta Business account, a verified business, a phone number dedicated
to the API (it stops working in the normal app), template approval, and a
per-conversation cost. For a shop confirming a handful of orders a day, a
`wa.me` link does the same job for nothing.

Nothing here depends on the choice: the handoff is a URL builder. If the merchant
later wants the API, that is a new adapter.

---

## Configuration gate

If `whatsapp_number` is not configured:

- the WhatsApp CTA **does not render** — no placeholder, no disabled button;
- order confirmation still works completely;
- another configured contact method is shown instead;
- if none is configured, the confirmation page shows the order details and the
  instructions, and says the shop will be in touch.

The order is never blocked on a contact channel being configured.

---

## The message

Built server-side, URL-encoded, opened via `https://wa.me/<number>?text=<encoded>`.

    Buongiorno, desidero confermare il mio ordine.

    Ordine: ITA-20260830-AB12CD
    Totale: €39,90
    Metodo di pagamento: Satispay
    Consegna: Spedizione

    Prodotti:
    1 × Cover MagSafe per iPhone 16 Pro — Nero
    1 × Vetro protettivo per iPhone 16 Pro

    Nome: Mario Rossi

    Attendo le istruzioni per completare il pagamento.

### Included

Order number · customer first and last name · total · payment method · delivery
or pickup · product names, variants and quantities.

Enough for staff to find the order and answer without asking the customer to
repeat themselves.

### Deliberately excluded

| Excluded                     | Why                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Full delivery address        | Not needed to identify an order, and it is personal data in a channel outside the system's control. |
| Internal notes               | Written for staff, not customers.                                                                   |
| Internal database ids        | Leaks structure; the order number is the public handle.                                             |
| Payment proof                | Belongs in the private bucket.                                                                      |
| Any token or tracking secret | A URL in a chat is forwarded, screenshotted and backed up to a cloud the shop does not control.     |
| Password or account data     | Never.                                                                                              |

The message is composed on the server so no client code decides what goes into
it — this exclusion list is testable, and it is tested.

---

## Encoding

`encodeURIComponent` over the whole body. Newlines, accented characters (_è_,
_à_, _ò_), `€` and `×` all survive. Italian product names break naive encoding
routinely, so `tests/unit/whatsapp-message.test.ts` asserts a round trip with
accents, a euro amount and a multiplication sign.

---

## Confirmation page

| Action                    | Behaviour                                                  |
| ------------------------- | ---------------------------------------------------------- |
| **Continua su WhatsApp**  | Opens the pre-filled chat. Only if configured.             |
| **Copia numero ordine**   | Copies `ITA-…`.                                            |
| **Copia importo**         | Copies the exact amount.                                   |
| **Visualizza istruzioni** | Full payment instructions, on the page — not only in chat. |
| **Traccia ordine**        | The tracking link with its random token.                   |

Instructions always appear on the page as well as in the chat. A customer who
never opens WhatsApp must still be able to pay.

---

## What is never claimed

- That a WhatsApp message confirms payment.
- That the shop has "received" anything because a link was clicked.
- That messages are read automatically.

Clicking the button changes **nothing** about order or payment status. Payment
moves only when a human verifies it against the real account.
