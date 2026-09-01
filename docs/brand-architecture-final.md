# Brand architecture

Settled by audit, not by preference. Sources: the merchant's own Shopify theme
(`Toolstack7462/coversbymobiile`, read only), its configured
`config/settings_data.json`, its `settings_schema.json`, its store-page copy,
its documentation, and the two GitHub repository names.

---

## The four names, and which is which

| Layer                            | Value                                                                        | Evidence                                                                                                                                          | Where it may appear                                               |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Public customer-facing brand** | **Covers by Mobile**                                                         | `store_name` in the merchant's configured theme settings; used in their own store-page copy                                                       | Everywhere a customer looks                                       |
| **Store name**                   | **Covers by Mobile**, inside Centro Commerciale Il Nuovo Borgo, Sulmona (AQ) | Store-page copy plus configured street, postcode, city, coordinates                                                                               | Store page, footer, map, structured data                          |
| **Legal / business identity**    | **Not established**                                                          | `business_legal_name`, `business_vat`, `business_registration` all exist in the schema and are all EMPTY                                          | Footer legal line, invoices, D.Lgs. 70/2003 trader identification |
| **Internal project name**        | **Italian Tech Atelier**                                                     | `package.json`, code comments, theme token defaults. This project's own README calls it "Internal project name. It is not the public brand name." | Repository, code, documentation. **Never the storefront.**        |

### "Zam Zam" is not part of the brand

It appears in the two GitHub repository names (`coversbymobiile`,
`coversbymobilezamzam`) and **nowhere else**. A case-insensitive search across
every Liquid template, JSON config, JavaScript file and Markdown document in the
merchant's own theme returns exactly one hit, and that hit is a coincidental
base64 fragment inside `package-lock.json`.

A repository name is chosen by whoever ran `git init`. It is not evidence of a
trading name. **Unless the merchant says otherwise, "Zam Zam" does not go on the
storefront.**

### The direct quotation that settles it

From the merchant's own store page, written by them:

> "Covers by Mobile è il nostro negozio all'interno del Centro Commerciale Il
> Nuovo Borgo a Sulmona. Accessori per smartphone, riparazioni e protezione
> tagliata su misura."

That sentence gives the public name, the location, and the three things the
business does. It is the most authoritative brand statement in either project.

---

## The rule

**The storefront must never display the internal project name.**

Implemented as a fallback chain in the header, and audited:

```
business.brand_name  →  store.name  →  the generic word for "shop"
```

The chain deliberately ends in a generic word rather than a developer's working
title. A working title presented as a wordmark is worse than no wordmark: it
looks deliberate, so nobody reports it. That is precisely what happened here —
"Italian Tech Atelier" sat in the header and above the hero of a live preview
until it was audited out.

**Current state: zero occurrences in the served HTML.** One occurrence remains
in code and is out of scope for storefront work:

| Location                         | What it affects                                                               | Status                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.server.ts` → `TOTP_ISSUER` | The name shown in the merchant's authenticator app when they enrol two-factor | Env-overridable. **Set `TOTP_ISSUER=Covers by Mobile` before the merchant enrols**, or their phone will say the wrong company forever |

---

## What the merchant has supplied, and what is still blank

Copied into this storefront from their configured Shopify settings:

| Field                      | Value                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Shop name                  | Covers by Mobile                                            |
| Street                     | Viale della Repubblica 8a, Centro Il Nuovo Borgo, negozio 6 |
| Postcode / city / province | 67039 Sulmona (AQ)                                          |
| Coordinates                | 42.0614846, 13.9200965                                      |
| Opening hours              | Tutti i giorni 09:00-20:00                                  |
| Phone                      | +39 350 881 6173                                            |
| WhatsApp                   | 393508816173                                                |
| Email                      | a personal Gmail address                                    |
| Directions                 | Google Maps deep link                                       |

**Offered by the theme and left empty by the merchant** — so empty here too,
and every dependent block correctly renders nothing:

`business_legal_name` · `business_vat` · `business_registration` ·
`business_return_address` · `business_dispute_url` · `legal_notice_page` ·
`legal_guarantee_page` · `social_instagram` · `social_facebook` ·
`social_tiktok` · `social_youtube` · logo asset · SEO title / description

### The two that block launch

1. **Legal identity.** `business_legal_name` + `business_vat` are required by
   D.Lgs. 70/2003 for trader identification, and the footer renders the legal
   line all-or-nothing by design: a partial legal footer looks like compliance
   without being it.
2. **No logo exists.** Not in the theme, not as an asset, not as a setting. The
   wordmark is currently set in Manrope. That is a defensible interim answer and
   it is not a brand mark.

### One to raise, not to fix

The configured business email is a **personal Gmail address**. It is already
public on their Shopify storefront, so carrying it across changes nothing about
its exposure — but as the contact for a shop asking for card details, a
gmail.com address is a materially weaker trust signal than a domain address,
and this storefront's entire job is trust from a stranger.
