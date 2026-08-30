# Legal review checklist

> ## This document is not legal advice.
>
> Nothing in this repository has been reviewed by a lawyer. The system provides
> **surfaces and data fields** for legal information; the content is the
> merchant's responsibility.
>
> **Before launch, have an Italian lawyer (_avvocato_) and an accountant
> (_commercialista_) review every item below.** Italian consumer and e-commerce
> law carries real penalties, and a review costs a fraction of getting it wrong.

---

## What the system provides vs what you must supply

| Provided                                                                    | You must supply                          |
| --------------------------------------------------------------------------- | ---------------------------------------- |
| Page templates for every required policy                                    | The actual text, professionally reviewed |
| Configurable fields for all business identifiers                            | Correct, verified values                 |
| A GPSR product-safety surface, per product                                  | Genuine manufacturer and safety data     |
| Versioned legal documents, with the accepted version recorded on each order | The document content                     |
| A price-integrity field for the 30-day reference price                      | Real historical price data               |
| `LocalBusiness` structured data, gated on verified values                   | Verified NAP details                     |

**No legal text ships with this system.** There is no boilerplate privacy policy
to accidentally launch with — deliberately, because generated legal text that
looks finished is more dangerous than an obviously empty page.

---

## 1. Business identification (D.Lgs. 70/2003)

Italian e-commerce must identify the trader. Admin → Store settings.

- [ ] Ragione sociale
- [ ] Full registered address
- [ ] Email address
- [ ] Telephone number
- [ ] **P.IVA**
- [ ] **REA** / Chamber of Commerce registration
- [ ] Share capital, if a company that must state it
- [ ] ODR platform link, if required

The footer block renders **all or nothing**: a partial legal footer looks like
compliance without being it. Blank is safer than wrong — but blank is not
compliant either.

**Open question:** is _ZAM ZAM_ the ragione sociale or a second brand? It
appears on the merchant's card beneath "Covers by Mobile". This must be resolved.

---

## 2. Consumer rights — distance selling (D.Lgs. 206/2005)

- [ ] **14-day right of withdrawal** explained, with when the period starts
- [ ] **Standard withdrawal form** (Annex I(B)) provided
- [ ] Who pays return shipping, stated explicitly
- [ ] Return address configured
- [ ] Refund timing and method
- [ ] Any lawful exceptions stated accurately
- [ ] **2-year legal guarantee of conformity** explained, and clearly
      distinguished from any commercial warranty
- [ ] Pre-contractual information available before the order is placed

The order state machine treats `delivered` and `collected` as **fulfilled, not
terminal**, precisely so a lawful withdrawal can be recorded.

---

## 3. Price indication — the one most often got wrong

Italy implements the Price Indication Directive via **D.Lgs. 84/2022**. An
announced reduction must state the **lowest price applied in the previous 30
days**.

| Data present                             | Displayed                                                 |
| ---------------------------------------- | --------------------------------------------------------- |
| Current price only                       | The price                                                 |
| Current + previous                       | Struck-through price. **No percentage.**                  |
| Current + previous + recorded 30-day low | Strikethrough, percentage, and the reference price stated |

The middle row is the point. A previous price is a merchandising figure; it is
not evidence of the 30-day low. `app/domain/pricing/resolve.ts` returns no
percentage without that data, so no template can invent one, and
`tests/unit/price-display.test.ts` fails if that ever changes.

- [ ] Confirm with your adviser how the 30-day low will be evidenced
- [ ] `price_history` populated for every discounted product
- [ ] Confirm whether any promotions fall within an exception
- [ ] Confirm VAT-inclusive display and shipping-cost disclosure

---

## 3b. Repair terms — flag raised, NOT published

The merchant's business card carries a disclaimer along the lines of:

> "Non siamo responsabili di eventuali danni durante la riparazione."

**This has deliberately NOT been added to the website**, and it should not be
published as drafted. Against a consumer it is likely unenforceable:

- **Codice del Consumo art. 33** — terms excluding or limiting the trader's
  liability toward a consumer are presumed _vessatorie_ and void.
- **Codice Civile art. 1229** — any clause excluding liability for _dolo_ or
  _colpa grave_ is void outright, consumer or not.

A blanket "not responsible for any damage during repair" is close to both. The
risk is not only that it fails, but that it creates a false sense of protection.

That does not mean accepting unlimited risk. A lawyer can usually draft
something that holds: disclosing specific known risks **before** the customer
authorises work, obtaining written acknowledgement of the device's pre-existing
condition, and distinguishing pre-existing faults from repair-induced damage.

- [ ] Repair terms drafted by a lawyer
- [ ] Pre-authorisation disclosure and sign-off process agreed
- [ ] Card and in-store signage updated to match

---

## 4. Product safety — GPSR (EU) 2023/988

In force for products offered to EU consumers since 13 December 2024.

- [ ] Manufacturer name, address, electronic contact
- [ ] **EU responsible person** for every product manufactured outside the EU
- [ ] Product model / identifier
- [ ] Safety warnings and usage limitations, **in Italian**
- [ ] Battery and shipping notes (power banks, wireless chargers)
- [ ] Disposal and recycling information (RAEE / WEEE)
- [ ] Manual and safety-document links

**The system never draws a CE badge.** There is no `has_ce_mark` boolean:
`certification` is recorded text the merchant is accountable for. A compliance
mark rendered from a flag is a false declaration.

- [ ] Confirm which products are in scope
- [ ] Confirm RAEE registration and any _contributo ambientale_ duty

---

## 5. Privacy and cookies (GDPR + ePrivacy)

**Phase 1 sets no analytics, marketing or profiling cookies.** Only strictly
necessary ones: session, cart, security, localisation.

That means **no consent banner is required** for tracking that does not exist. A
banner asking permission for nothing is itself a dark pattern.

- [ ] Privacy policy naming every processor (Cloudflare, Resend if enabled)
- [ ] Cookie policy listing every cookie actually set — **audit the live site**,
      do not copy a template
- [ ] Lawful basis for each processing purpose
- [ ] Data Processing Agreements with Cloudflare and any provider
- [ ] Retention periods, including **payment proofs** (personal financial data)
- [ ] Whether a _Registro dei trattamenti_ is required
- [ ] Transfers outside the EEA

If a non-essential integration is added later, consent must be obtained first,
with rejection **as easy and as prominent as acceptance**.

---

## 6. Fiscal — commercialista required

**This system does not replace Italy's fiscal process.** It manages inventory
and internal order state. It does **not** produce a _documento commerciale_,
does not drive a _registratore telematico_, and does not transmit
_corrispettivi_.

- [ ] Invoicing workflow agreed
- [ ] Fatturazione elettronica / SDI handling agreed
- [ ] Corrispettivi telematici handled for counter and pickup sales
- [ ] VAT rate confirmed (configured, never hardcoded)
- [ ] Record-keeping obligations agreed

---

## 7. Accessibility (European Accessibility Act)

The EAA applies to e-commerce from **28 June 2025**.

- [ ] Confirm whether the business is in scope (micro-enterprise exemptions may
      apply)
- [ ] Commission an **independent audit** including manual screen-reader testing
- [ ] Publish an accessibility statement
- [ ] Establish a feedback route for accessibility problems

Automated checks cover roughly a third of WCAG. They are evidence of effort, not
of compliance.

---

## 8. Claims the system structurally cannot make

Recorded so a future change does not quietly reintroduce them. Each is
prohibited under the Unfair Commercial Practices Directive as amended by
(EU) 2019/2161:

| Claim                                      | Status                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| Countdown timers                           | Not implemented                                      |
| "N people viewing"                         | Not implemented                                      |
| Fabricated review stars                    | Structurally impossible                              |
| Invented scarcity                          | Requires a merchant threshold **and** real inventory |
| Percentage off without a prior price       | Gated in the domain layer                            |
| "Ready for pickup today" from online stock | Requires staff to record it                          |
| CE marks from a flag                       | Not implemented                                      |
| `AggregateRating` without reviews          | Gated                                                |
| `LocalBusiness` without verified data      | Gated                                                |

---

## Sign-off

| Role                                           | Name | Date | Signature |
| ---------------------------------------------- | ---- | ---- | --------- |
| Avvocato (consumer & e-commerce)               |      |      |           |
| Commercialista (VAT, invoicing, corrispettivi) |      |      |           |
| Privacy adviser / DPO                          |      |      |           |
| Accessibility auditor                          |      |      |           |
| Merchant                                       |      |      |           |

**Do not launch with unchecked boxes above.**
