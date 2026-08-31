import { SETTING_KEYS } from "~/domain/content/gates";

/**
 * Human labels and help text for every merchant setting.
 *
 * The settings screen used to label each field with its own database key: a
 * shopkeeper in Sulmona was shown a form field called `business.vat_number`.
 * Dotted keys are the right thing to store and the wrong thing to show, exactly
 * like the English status values the order list used to print.
 *
 * Three things every field carries, and why each matters more than it looks:
 *
 *   - **`help`** answers "what goes in here", in the merchant's words. Not the
 *     field name restated. Where a value is legally required, it says which law
 *     and what happens if it is missing, because "REA" means nothing to most
 *     people who nonetheless have one.
 *
 *   - **`consequence`** answers "what happens on the site if I leave this
 *     blank". This is the honest counterpart to the empty-configuration rule:
 *     the storefront hides features rather than printing placeholders, so a
 *     blank field silently removes something. Saying which thing turns an
 *     invisible behaviour into an informed choice.
 *
 *   - **`example`** is a *format* hint shown as a placeholder, never a
 *     defaulted value. It must never look like real merchant data, because a
 *     plausible-looking example is how invented information ends up published.
 */

export type FieldType = "text" | "email" | "tel" | "url" | "number" | "textarea" | "boolean";

export interface SettingField {
  key: string;
  label: string;
  help: string;
  /** What the storefront does when this is empty. Omitted when nothing hides. */
  consequence?: string;
  type: FieldType;
  /** A format hint only. Never prefilled. */
  example?: string;
  /** Blocks a launch. Drives the "obbligatorio" mark, not HTML validation. */
  required?: boolean;
}

export interface SettingGroup {
  slug: string;
  title: string;
  /** One line on why this group exists, shown under the heading. */
  blurb: string;
  fields: SettingField[];
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    slug: "identita",
    title: "Identità del negozio",
    blurb: "Come vi chiamate, per i clienti e per la legge.",
    fields: [
      {
        key: SETTING_KEYS.brandName,
        label: "Nome pubblico",
        help: "Il nome con cui i clienti vi conoscono. Compare in cima al sito e nel titolo delle pagine.",
        consequence: "Il sito non mostra alcun nome.",
        type: "text",
        required: true,
      },
      {
        key: SETTING_KEYS.shopName,
        label: "Nome del negozio fisico",
        help: "Se l'insegna del negozio è diversa dal nome pubblico, scrivetela qui. Altrimenti ripetete lo stesso nome.",
        type: "text",
      },
      {
        key: SETTING_KEYS.legalName,
        label: "Ragione sociale",
        help: "Il nome legale completo dell'azienda, come risulta in Camera di Commercio. Obbligatorio per legge (D.Lgs. 70/2003).",
        consequence: "Il blocco con i dati legali in fondo al sito resta nascosto.",
        type: "text",
        required: true,
      },
      {
        key: SETTING_KEYS.vatNumber,
        label: "Partita IVA",
        help: "Undici cifre, con o senza il prefisso IT. Obbligatoria per vendere online.",
        consequence: "Il blocco con i dati legali in fondo al sito resta nascosto.",
        type: "text",
        example: "IT00000000000",
        required: true,
      },
      {
        key: SETTING_KEYS.reaNumber,
        label: "Numero REA",
        help: "Il numero di iscrizione al Registro delle Imprese, sulla visura camerale. Sigla della provincia più il numero.",
        consequence: "Il blocco con i dati legali in fondo al sito resta nascosto.",
        type: "text",
        example: "AQ-000000",
        required: true,
      },
      {
        key: SETTING_KEYS.shareCapital,
        label: "Capitale sociale",
        help: "Solo per società di capitali (Srl, SpA). Una ditta individuale lascia vuoto.",
        type: "text",
      },
    ],
  },
  {
    slug: "negozio",
    title: "Il negozio fisico",
    blurb: "Dove siete, quando siete aperti, come ci si arriva.",
    fields: [
      {
        key: SETTING_KEYS.storeStreet,
        label: "Via e numero civico",
        help: "Via e numero civico del negozio, come su una lettera.",
        type: "text",
      },
      {
        key: SETTING_KEYS.storePostcode,
        label: "CAP",
        help: "Il codice di avviamento postale del negozio, cinque cifre.",
        type: "text",
        example: "67039",
      },
      {
        key: SETTING_KEYS.storeCity,
        label: "Comune",
        help: "Il comune in cui si trova il negozio.",
        type: "text",
      },
      {
        key: SETTING_KEYS.storeProvince,
        label: "Provincia",
        help: "La sigla di due lettere della provincia, come sulle targhe.",
        type: "text",
        example: "AQ",
      },
      {
        key: SETTING_KEYS.storeHoursDisplay,
        label: "Orari di apertura",
        help: "Scritti come li direste a un cliente al telefono. Vengono mostrati esattamente così.",
        consequence: "Il sito non mostra alcun orario. Meglio vuoto che sbagliato.",
        type: "text",
        example: "Lun-Sab 09:00-13:00 e 16:00-20:00",
      },
      {
        key: SETTING_KEYS.storeDirectionsUrl,
        label: "Link per le indicazioni stradali",
        help: "Un collegamento a Google Maps o simile, per il pulsante “Come arrivare”.",
        consequence: "Il pulsante non compare.",
        type: "url",
      },
      {
        key: SETTING_KEYS.storeParkingInfo,
        label: "Parcheggio",
        help: "Dove si parcheggia. Una o due frasi.",
        type: "textarea",
      },
      {
        key: SETTING_KEYS.storeAccessibilityInfo,
        label: "Accessibilità",
        help: "Gradini, rampa, larghezza della porta. Scrivete quello che è vero, anche se non è ideale: chi ha bisogno di saperlo preferisce un'informazione onesta a nessuna informazione.",
        type: "textarea",
      },
    ],
  },
  {
    slug: "contatti",
    title: "Contatti",
    blurb: "Come i clienti vi raggiungono dopo aver ordinato. Serve almeno uno.",
    fields: [
      {
        key: SETTING_KEYS.whatsappNumber,
        label: "Numero WhatsApp",
        help: "Con il prefisso internazionale e senza spazi o simboli. È il canale su cui arrivano i clienti dopo l'ordine.",
        consequence: "Il pulsante WhatsApp non compare da nessuna parte sul sito.",
        type: "tel",
        example: "393000000000",
        required: true,
      },
      {
        key: SETTING_KEYS.phone,
        label: "Telefono",
        help: "Il numero che risponde in negozio.",
        consequence: "Il numero non compare sul sito.",
        type: "tel",
      },
      {
        key: SETTING_KEYS.email,
        label: "Email",
        help: "L'indirizzo che leggete davvero.",
        consequence: "L'indirizzo non compare sul sito.",
        type: "email",
      },
      {
        key: SETTING_KEYS.returnAddress,
        label: "Indirizzo per i resi",
        help: "Dove il cliente spedisce un reso. Può coincidere con il negozio.",
        consequence: "Le istruzioni per il reso restano incomplete.",
        type: "textarea",
      },
    ],
  },
  {
    slug: "consegna",
    title: "Consegna e ritiro",
    blurb: "Come il cliente riceve l'ordine. Serve almeno una delle due.",
    fields: [
      {
        key: SETTING_KEYS.pickupEnabled,
        label: "Ritiro in negozio attivo",
        help: "Permette al cliente di ordinare online e ritirare in negozio.",
        type: "boolean",
      },
      {
        key: SETTING_KEYS.pickupPreparationTime,
        label: "Tempo di preparazione del ritiro",
        help: "Quanto ci mettete a preparare un ordine da ritirare. Detto al cliente in cassa, quindi meglio abbondare.",
        type: "text",
        example: "2 ore",
      },
      {
        key: SETTING_KEYS.pickupInstructions,
        label: "Istruzioni per il ritiro",
        help: "Cosa deve portare il cliente e a chi si rivolge una volta in negozio.",
        type: "textarea",
      },
      {
        key: SETTING_KEYS.shippingEnabled,
        label: "Spedizione attiva",
        help: "Permette al cliente di farsi spedire l'ordine.",
        type: "boolean",
      },
      {
        key: SETTING_KEYS.freeShippingThreshold,
        label: "Soglia per la spedizione gratuita",
        help: "L'importo oltre il quale la spedizione non si paga. Lasciate vuoto se non offrite spedizione gratuita: uno zero qui significherebbe “sempre gratis”.",
        type: "text",
        example: "49,00",
      },
    ],
  },
];

/** Field metadata by key, for the settings form. */
export const SETTING_FIELDS: ReadonlyMap<string, SettingField> = new Map(
  SETTING_GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f]),
);

/**
 * Keys the groups above do not cover.
 *
 * The database is the source of truth for which settings exist, so a key added
 * by a migration but not described here must still be editable — otherwise the
 * merchant would have a value they can see gating a feature and no way to set
 * it. Those fall into a clearly-labelled "other" group rather than vanishing.
 */
export function uncoveredKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter((key) => !SETTING_FIELDS.has(key));
}
