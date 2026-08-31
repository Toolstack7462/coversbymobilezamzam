# Admin information architecture

The Merchant Control Centre. Written for one audience: a shopkeeper in Sulmona
who sells phone accessories and does not write SQL.

---

## The organising principle

**Group by what the merchant is doing, not by what the database contains.**

"Prenotazioni" and "Movimenti" are both inventory tables, but one answers _why
can't I sell this?_ and the other answers _where did the count go wrong?_ They
live together under INVENTARIO because that is the mental context, not because
they share a foreign key.

---

## Sidebar

    PANORAMICA
      Panoramica                  /admin
      Centro configurazione       /admin/configurazione
      Attività                    /admin/registro

    VENDITE
      Ordini                      /admin/ordini
      Pagamenti da verificare     /admin/pagamenti
      Ritiri in negozio           /admin/ritiri
      Spedizioni                  /admin/spedizioni
      Resi                        /admin/resi
      Clienti                     /admin/clienti

    CATALOGO
      Prodotti                    /admin/prodotti
      Categorie                   /admin/categorie
      Marchi                      /admin/marchi
      Famiglie prodotto           /admin/famiglie
      Dispositivi                 /admin/dispositivi
      Compatibilità               /admin/compatibilita
      Recensioni                  /admin/recensioni

    INVENTARIO
      Panoramica scorte           /admin/inventario
      Movimenti                   /admin/inventario/movimenti
      Rettifiche                  /admin/inventario/rettifiche
      Trasferimenti               /admin/inventario/trasferimenti
      Scorte basse                /admin/inventario/scorte-basse
      Prenotazioni                /admin/inventario/prenotazioni

    PROMOZIONE
      Sconti                      /admin/sconti
      Promozioni                  /admin/promozioni
      Prodotti in evidenza        /admin/in-evidenza

    CONTENUTI
      Homepage                    /admin/contenuti/homepage
      Menu e navigazione          /admin/contenuti/menu
      Pagine                      /admin/contenuti/pagine
      Guide                       /admin/contenuti/guide
      Documenti legali            /admin/contenuti/legale
      SEO                         /admin/contenuti/seo

    IMPOSTAZIONI
      Identità aziendale          /admin/impostazioni/identita
      Negozio fisico              /admin/impostazioni/negozio
      Contatti e WhatsApp         /admin/impostazioni/contatti
      Pagamenti manuali           /admin/impostazioni/pagamenti
      Spedizione e ritiro         /admin/impostazioni/spedizione
      Lingue                      /admin/impostazioni/lingue
      Email                       /admin/impostazioni/email
      Personale e ruoli           /admin/personale
      Sicurezza                   /admin/sicurezza
      Importa ed esporta          /admin/importazioni
      Integrazioni                /admin/integrazioni
      Stato del sistema           /admin/sistema

---

## Two rules that shape everything

### 1. A section the merchant cannot use is not shown

Not greyed out, not "coming soon" — **absent**. Every disabled item in a sidebar
is a small daily lie about what the software does, and eight of them teach the
merchant to stop reading the sidebar.

Visibility is driven by two things:

- **Permission.** Server-checked. A store assistant does not see Pagamenti.
- **Feature flag.** A module still being built is hidden until it works.

The nav is filtered on the **server**, so the browser is never sent the names of
routes the user cannot open.

### 2. Hiding a link is never the access control

The link is a courtesy. The loader and the action refuse. Every route in this
architecture calls `requireStaff(request, env, permission)` or
`requireEnrolledStaff`, and the browser tests exercise routes **directly**,
without loading the page that links to them.

---

## Deliberate omissions

| Not built                                          | Why                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Subscriptions, appointments, donations, gift cards | Not this business.                                                    |
| Printful, TikTok Shop, marketplaces                | Not this business.                                                    |
| Payment gateways                                   | Phase 1 takes no card payments (ADR 0006).                            |
| Sales-channel switcher                             | One channel.                                                          |
| Email-marketing dashboard                          | No provider configured. A marketing screen that cannot send is a lie. |
| Multi-currency, multi-store                        | EUR, one shop.                                                        |

Each of these is a permanent tax on every screen a merchant scans, forever.

---

## Route naming

Italian, because the staff are Italian and the URL is part of the interface.
`/admin/prodotti`, not `/admin/products`.

The admin is **Italian only**, unlike the storefront. It is an internal tool
with a known audience; translating it would double the surface with no reader.
That is a deliberate divergence from the storefront's `it`/`en` rule and is
recorded here so it is not mistaken for an oversight.

---

## Progressive disclosure

Three levels, so the first screen is never the whole system:

1. **Overview** — what needs doing today. No configuration.
2. **Section list** — a table with saved views, filters and bulk actions.
3. **Detail / wizard** — the full depth, reached deliberately.

The product wizard is the clearest case: six steps rather than one form with
forty fields, because our product model carries variants, compatibility with
verification provenance, category-specific specifications and dual-language
content. A single page would be a wall.

---

## Where the merchant starts

A brand-new install opens on **Centro configurazione**, not the Overview: an
overview of nothing is discouraging, and there is exactly one useful next action.

Once the blocking steps are complete the Overview becomes the landing page and
the setup card collapses — but never disappears. Configuration is revisited, not
finished once.
