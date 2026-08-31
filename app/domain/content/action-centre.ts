/**
 * The Action Centre.
 *
 * A dashboard's job is to answer one question: **what needs me today?**
 *
 * So this is not a feed and not a notification list. It is a short, ordered
 * list of things a person can finish, each with an exact destination. Three
 * rules, all of which exist because the alternative was tried by every admin
 * panel that became noise:
 *
 *   1. **Nothing appears at zero.** An item reading "0 payments to verify"
 *      trains people to skim past the row that one day says 3.
 *   2. **Every item deep-links to the exact filtered page**, never to a section
 *      root the merchant then has to filter by hand.
 *   3. **Severity is earned.** `blocking` means money or stock is actually
 *      stuck. If everything is urgent, nothing is.
 *
 * Pure over a snapshot, so the ordering rules are unit-testable without a
 * database.
 */

export type ActionSeverity = "blocking" | "attention" | "informational";

export interface ActionItem {
  id: string;
  /** What needs doing, in the merchant's words. */
  label: string;
  /** Why it matters, in one sentence. Never a restatement of the label. */
  detail: string;
  count: number;
  severity: ActionSeverity;
  /** An exact filtered destination — not a section root. */
  href: string;
  /** The permission required to act on it. Filtered on the server. */
  permission: string | null;
}

export interface ActionSnapshot {
  paymentsToVerify: number;
  paymentsUnderVerification: number;
  ordersAwaitingContact: number;
  pickupsToPrepare: number;
  ordersToShip: number;
  outOfStock: number;
  lowStock: number;
  overdueReservations: number;
  productsWithoutPrice: number;
  productsWithoutImage: number;
  unverifiedExactFit: number;
  privilegedWithoutTotp: number;
  /** Blocking setup steps still open, from the setup centre. */
  blockingSetupSteps: number;
  /** True when the reservation sweeper has not run recently. */
  sweeperStale: boolean;
}

const SEVERITY_ORDER: Record<ActionSeverity, number> = {
  blocking: 0,
  attention: 1,
  informational: 2,
};

/**
 * Builds the list for one actor.
 *
 * `permissions` filters by what the person can actually do: telling a warehouse
 * assistant that six payments need verifying, when they cannot open the payment
 * screen, is just an unclearable badge.
 */
export function buildActionCentre(
  snapshot: ActionSnapshot,
  permissions: readonly string[],
): ActionItem[] {
  const s = snapshot;

  const candidates: ActionItem[] = [
    {
      id: "sweeper_stale",
      label: "Il rilascio automatico delle prenotazioni è fermo",
      detail:
        "Le scorte prenotate da ordini non pagati non tornano disponibili. I prodotti spariscono dalla vendita anche se sono in magazzino.",
      // Not a count of things to do but a yes/no fault. It carries the count 1
      // so it can obey the "never show a zero" rule honestly.
      count: s.sweeperStale ? 1 : 0,
      severity: "blocking",
      href: "/admin/sistema",
      permission: "settings.read",
    },
    {
      id: "setup_incomplete",
      label: "Configurazione incompleta",
      detail:
        "Passaggi obbligatori ancora aperti. Finché restano, il negozio non è pronto a vendere.",
      count: s.blockingSetupSteps,
      severity: "blocking",
      href: "/admin/configurazione",
      permission: null,
    },
    {
      id: "privileged_without_totp",
      label: "Account senza autenticazione a due fattori",
      detail:
        "Hanno permessi critici ma non possono usarli finché non attivano la 2FA. Nel frattempo il lavoro si blocca.",
      count: s.privilegedWithoutTotp,
      severity: "blocking",
      href: "/admin/personale?vista=senza-2fa",
      permission: "staff.read",
    },
    {
      id: "payments_to_verify",
      label: "Pagamenti da verificare",
      detail:
        "Il cliente ha inviato una ricevuta e sta aspettando. Nessun ordine avanza finché una persona non controlla.",
      count: s.paymentsToVerify,
      severity: "blocking",
      href: "/admin/pagamenti?stato=da-verificare",
      permission: "payment.read",
    },
    {
      id: "orders_awaiting_contact",
      label: "Ordini in attesa del vostro contatto",
      detail:
        "Il cliente ha ordinato ma non ha ancora ricevuto le istruzioni di pagamento su WhatsApp.",
      count: s.ordersAwaitingContact,
      severity: "blocking",
      href: "/admin/ordini?stato=da-contattare",
      permission: "order.read",
    },
    {
      id: "payments_under_verification",
      label: "Verifiche iniziate e non concluse",
      detail: "Qualcuno ha aperto la verifica e non l'ha chiusa. Il cliente resta in attesa.",
      count: s.paymentsUnderVerification,
      severity: "attention",
      href: "/admin/pagamenti?stato=in-verifica",
      permission: "payment.read",
    },
    {
      id: "pickups_to_prepare",
      label: "Ritiri da preparare",
      detail: "Pagati e da mettere da parte prima che il cliente si presenti in negozio.",
      count: s.pickupsToPrepare,
      severity: "attention",
      href: "/admin/ordini?consegna=ritiro&stato=da-preparare",
      permission: "order.read",
    },
    {
      id: "orders_to_ship",
      label: "Ordini da spedire",
      detail: "Pagati e in attesa di partire.",
      count: s.ordersToShip,
      severity: "attention",
      href: "/admin/ordini?consegna=spedizione&stato=da-preparare",
      permission: "order.read",
    },
    {
      id: "out_of_stock",
      label: "Varianti esaurite",
      detail: "Non acquistabili sul sito in questo momento.",
      count: s.outOfStock,
      severity: "attention",
      href: "/admin/inventario?vista=esauriti",
      permission: "inventory.read",
    },
    {
      id: "overdue_reservations",
      label: "Prenotazioni scadute non rilasciate",
      detail: "Bloccano scorte che dovrebbero essere già tornate disponibili.",
      count: s.overdueReservations,
      severity: "attention",
      href: "/admin/inventario?vista=prenotazioni-scadute",
      permission: "inventory.read",
    },
    {
      id: "products_without_price",
      label: "Prodotti senza prezzo",
      detail: "Restano invisibili in cassa: nessuno può comprarli.",
      count: s.productsWithoutPrice,
      severity: "attention",
      href: "/admin/prodotti?vista=senza-prezzo",
      permission: "product.read",
    },
    {
      id: "unverified_exact_fit",
      label: "Compatibilità dichiarate esatte ma non verificate",
      detail:
        "Sul sito compaiono come non verificate. È il tipo di errore che genera resi e recensioni negative.",
      count: s.unverifiedExactFit,
      severity: "attention",
      href: "/admin/compatibilita?vista=non-verificate",
      permission: "product.read",
    },
    {
      id: "low_stock",
      label: "Scorte in esaurimento",
      detail: "Sotto la soglia di riordino che avete impostato.",
      count: s.lowStock,
      severity: "informational",
      href: "/admin/inventario?vista=scorte-basse",
      permission: "inventory.read",
    },
    {
      id: "products_without_image",
      label: "Prodotti senza immagine",
      detail: "Sul sito compare un riquadro vuoto al posto della foto.",
      count: s.productsWithoutImage,
      severity: "informational",
      href: "/admin/prodotti?vista=senza-immagine",
      permission: "product.read",
    },
  ];

  return candidates
    .filter((item) => item.count > 0)
    .filter((item) => item.permission === null || permissions.includes(item.permission))
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      // Within one severity, the bigger pile first: it is costing the most.
      return bySeverity !== 0 ? bySeverity : b.count - a.count;
    });
}

/** True when there is genuinely nothing waiting — worth saying out loud. */
export function isClear(items: ActionItem[]): boolean {
  return items.length === 0;
}
