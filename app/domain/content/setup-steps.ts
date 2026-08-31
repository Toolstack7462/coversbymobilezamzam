import { isConfigured, allConfigured, SETTING_KEYS, type SettingsMap } from "./gates";

/**
 * The setup checklist.
 *
 * **Every step is DERIVED from data on each load. Nothing is a stored boolean.**
 *
 * That is the whole design. A checkbox someone ticked is a claim; a query is
 * evidence. If a merchant deletes their only payment method six months from
 * now, the checklist must go back to incomplete on its own — a stored `true`
 * would sit there saying the shop is ready to take money when it is not.
 *
 * A pure function over a snapshot, so it is unit-testable without a database.
 */

export const SETUP_STEP_IDS = [
  "brand_identity",
  "legal_identity",
  "store_details",
  "contact_channels",
  "admin_totp",
  "first_product",
  "product_image",
  "product_price",
  "inventory",
  "compatibility_verified",
  "payment_method",
  "delivery_method",
  "legal_documents",
  "test_order",
  "backup_restore",
  "preview_deployment",
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStatus = "complete" | "incomplete" | "attention";

/**
 * `blocking` means the shop genuinely cannot trade correctly without it.
 * `recommended` is real but survivable.
 *
 * The distinction matters: marking everything blocking is the same as marking
 * nothing blocking, because the merchant stops believing the label.
 */
export type SetupSeverity = "blocking" | "recommended";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  severity: SetupSeverity;
  status: SetupStatus;
  /** Why it is not complete. Empty when it is. */
  reason: string;
  /** Where to go to fix it. */
  href: string;
}

/**
 * The facts the checklist needs. Gathered by the route in one query pass, so
 * this function stays pure and the queries stay in one place.
 */
export interface SetupSnapshot {
  settings: SettingsMap;
  /** Privileged staff who have NOT verified a second factor. */
  privilegedWithoutTotp: number;
  productCount: number;
  publishedProductCount: number;
  productsWithoutImage: number;
  productsWithoutPrice: number;
  variantsWithInventory: number;
  variantCount: number;
  exactFitUnverified: number;
  compatibilityRecordCount: number;
  activePaymentMethods: number;
  shippingConfigured: boolean;
  pickupConfigured: boolean;
  publishedLegalDocuments: number;
  requiredLegalDocuments: number;
  orderCount: number;
  /** Epoch ms of the last verified restore, or null if never. */
  lastRestoreTestAt: number | null;
  /** Whether a preview/staging deployment has been recorded. */
  previewDeployedAt: number | null;
  now: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function computeSetupSteps(snapshot: SetupSnapshot): SetupStep[] {
  const s = snapshot;
  const set = s.settings;

  const step = (
    id: SetupStepId,
    title: string,
    description: string,
    severity: SetupSeverity,
    href: string,
    ok: boolean,
    reason: string,
    attention = false,
  ): SetupStep => ({
    id,
    title,
    description,
    severity,
    href,
    status: ok ? "complete" : attention ? "attention" : "incomplete",
    reason: ok ? "" : reason,
  });

  return [
    step(
      "brand_identity",
      "Nome pubblico del negozio",
      "Il nome che i clienti vedono sul sito.",
      "blocking",
      "/admin/impostazioni",
      isConfigured(set, SETTING_KEYS.brandName) || isConfigured(set, SETTING_KEYS.shopName),
      "Nessun nome pubblico configurato. Finché è vuoto il sito non mostra il nome del negozio.",
    ),

    step(
      "legal_identity",
      "Dati legali dell'azienda",
      "Ragione sociale, P.IVA e REA: obbligatori per legge (D.Lgs. 70/2003).",
      "blocking",
      "/admin/impostazioni",
      allConfigured(set, [SETTING_KEYS.legalName, SETTING_KEYS.vatNumber, SETTING_KEYS.reaNumber]),
      "Mancano ragione sociale, P.IVA o REA. Il blocco legale in fondo al sito resta nascosto e il negozio non è in regola per vendere online.",
    ),

    step(
      "store_details",
      "Indirizzo e orari del negozio",
      "Dove siete e quando siete aperti.",
      "recommended",
      "/admin/impostazioni",
      allConfigured(set, [
        SETTING_KEYS.storeStreet,
        SETTING_KEYS.storePostcode,
        SETTING_KEYS.storeCity,
      ]) && isConfigured(set, SETTING_KEYS.storeHoursDisplay),
      "L'indirizzo c'è, ma mancano gli orari. Senza orari il sito non li mostra: meglio vuoto che sbagliato, ma i clienti non sanno quando venire.",
    ),

    step(
      "contact_channels",
      "Telefono, WhatsApp ed email",
      "Come i clienti vi raggiungono dopo l'ordine.",
      "blocking",
      "/admin/impostazioni",
      isConfigured(set, SETTING_KEYS.whatsappNumber) ||
        isConfigured(set, SETTING_KEYS.phone) ||
        isConfigured(set, SETTING_KEYS.email),
      "Nessun contatto configurato. Il pulsante WhatsApp non compare e il cliente non ha modo di completare il pagamento.",
    ),

    step(
      "admin_totp",
      "Autenticazione a due fattori",
      "Obbligatoria per chi verifica i pagamenti o modifica l'IBAN.",
      "blocking",
      "/admin/personale",
      s.privilegedWithoutTotp === 0,
      `${s.privilegedWithoutTotp} account con permessi critici non hanno attivato la 2FA. Non possono usare le sezioni operative finché non la attivano.`,
    ),

    step(
      "first_product",
      "Primo prodotto",
      "Serve almeno un prodotto per vendere.",
      "blocking",
      "/admin/prodotti/nuovo",
      s.productCount > 0,
      "Nessun prodotto nel catalogo.",
    ),

    step(
      "product_image",
      "Immagini dei prodotti",
      "Ogni prodotto pubblicato ha bisogno di almeno una foto.",
      "recommended",
      "/admin/prodotti?vista=senza-immagine",
      s.productCount > 0 && s.productsWithoutImage === 0,
      s.productCount === 0
        ? "Aggiungi prima un prodotto."
        : `${s.productsWithoutImage} prodotti senza immagine. Sul sito compare un riquadro vuoto.`,
    ),

    step(
      "product_price",
      "Prezzi",
      "Un prodotto senza prezzo non è acquistabile.",
      "blocking",
      "/admin/prodotti?vista=senza-prezzo",
      s.productCount > 0 && s.productsWithoutPrice === 0,
      s.productCount === 0
        ? "Aggiungi prima un prodotto."
        : `${s.productsWithoutPrice} prodotti senza prezzo.`,
    ),

    step(
      "inventory",
      "Giacenze",
      "Quante unità avete, e dove.",
      "blocking",
      "/admin/inventario",
      s.variantCount > 0 && s.variantsWithInventory === s.variantCount,
      s.variantCount === 0
        ? "Aggiungi prima un prodotto con almeno una variante."
        : `${s.variantCount - s.variantsWithInventory} varianti senza giacenza registrata. Non risultano disponibili.`,
    ),

    step(
      "compatibility_verified",
      "Compatibilità verificata",
      "Quali accessori entrano in quali telefoni.",
      "blocking",
      "/admin/compatibilita",
      s.compatibilityRecordCount > 0 && s.exactFitUnverified === 0,
      s.compatibilityRecordCount === 0
        ? "Nessuna compatibilità registrata. I clienti non possono filtrare per dispositivo."
        : `${s.exactFitUnverified} prodotti dichiarati "compatibilità esatta" ma non verificati. Sul sito compaiono come non verificati, ed è il tipo di errore che genera resi.`,
      s.compatibilityRecordCount > 0,
    ),

    step(
      "payment_method",
      "Metodo di pagamento",
      "Come i clienti vi pagano.",
      "blocking",
      "/admin/impostazioni",
      s.activePaymentMethods > 0,
      "Nessun metodo di pagamento attivo. In cassa il cliente non può concludere l'ordine.",
    ),

    step(
      "delivery_method",
      "Spedizione o ritiro",
      "Come il cliente riceve l'ordine.",
      "blocking",
      "/admin/impostazioni",
      s.shippingConfigured || s.pickupConfigured,
      "Né la spedizione né il ritiro in negozio sono attivi.",
    ),

    step(
      "legal_documents",
      "Documenti legali",
      "Privacy, termini, resi e diritto di recesso.",
      "blocking",
      "/admin/contenuti/legale",
      s.requiredLegalDocuments > 0 && s.publishedLegalDocuments >= s.requiredLegalDocuments,
      `${s.requiredLegalDocuments - s.publishedLegalDocuments} documenti legali mancanti. Vanno scritti e fatti rivedere da un avvocato: il sistema non ne genera nessuno.`,
    ),

    step(
      "test_order",
      "Ordine di prova",
      "Provate il percorso completo prima dei clienti.",
      "recommended",
      "/admin/ordini",
      s.orderCount > 0,
      "Nessun ordine registrato. Fatene uno di prova per vedere cosa riceve il cliente.",
    ),

    step(
      "backup_restore",
      "Backup verificato",
      "Un backup che nessuno ha mai ripristinato non è un backup.",
      "recommended",
      "/admin/sistema",
      s.lastRestoreTestAt !== null && s.now - s.lastRestoreTestAt < THIRTY_DAYS_MS,
      s.lastRestoreTestAt === null
        ? "Nessun ripristino mai testato."
        : "L'ultimo test di ripristino risale a più di 30 giorni fa.",
    ),

    step(
      "preview_deployment",
      "Anteprima online",
      "Il sito pubblicato su un indirizzo di prova.",
      "recommended",
      "/admin/sistema",
      s.previewDeployedAt !== null,
      "Nessuna anteprima pubblicata. Le prestazioni reali non sono misurabili in locale.",
    ),
  ];
}

export interface SetupProgress {
  steps: SetupStep[];
  total: number;
  complete: number;
  blockingIncomplete: SetupStep[];
  percentage: number;
  readyToTrade: boolean;
}

export function summariseSetup(steps: SetupStep[]): SetupProgress {
  const complete = steps.filter((s) => s.status === "complete").length;
  const blockingIncomplete = steps.filter(
    (s) => s.severity === "blocking" && s.status !== "complete",
  );

  return {
    steps,
    total: steps.length,
    complete,
    blockingIncomplete,
    percentage: steps.length === 0 ? 0 : Math.round((complete / steps.length) * 100),
    // "Ready to trade" is about blocking steps only. A shop can open without a
    // verified backup; it cannot open without a way to be paid.
    readyToTrade: blockingIncomplete.length === 0,
  };
}
