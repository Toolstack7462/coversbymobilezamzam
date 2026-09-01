import { Link, useLocation } from "react-router";
import type { Route } from "./+types/dashboard";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import {
  gateStatuses,
  type SettingsMap,
  GATE_LABELS,
  SETTING_LABELS,
} from "~/domain/content/gates";
import { buildActionCentre, isClear, type ActionItem } from "~/domain/content/action-centre";
import { computeSetupSteps, summariseSetup } from "~/domain/content/setup-steps";
import { ORDER_VIEWS, PAYMENT_VIEWS, ORDER_DELIVERY_FACET } from "~/lib/order-views";
import { INVENTORY_VIEWS } from "~/lib/inventory-views";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { loadSetupSnapshot } from "./setup-centre";

/**
 * The Overview.
 *
 * Two things only: **what happened**, and **what needs me**.
 *
 * No charts. With no data a chart is decoration; with a fortnight of data it
 * invites conclusions the sample cannot support. Every number here is a real
 * count someone can act on, and every one links to the screen where they act.
 */

/**
 * The metric and action-centre counts are built from the SAME clauses the
 * saved views use, so a badge can never disagree with the list it opens.
 */
const clause = (views: readonly { slug: string; where: string }[], slug: string): string =>
  views.find((v) => v.slug === slug)!.where;

const TO_PREPARE = clause(ORDER_VIEWS, "da-preparare");
const TO_CONTACT = clause(ORDER_VIEWS, "da-contattare");
const TO_VERIFY = clause(PAYMENT_VIEWS, "da-verificare");
const UNDER_VERIFICATION = clause(PAYMENT_VIEWS, "in-verifica");
const LOW_STOCK = clause(INVENTORY_VIEWS, "scorte-basse");
const OUT_OF_STOCK = clause(INVENTORY_VIEWS, "esauriti");

export function meta() {
  return [{ title: "Panoramica" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  const now = systemClock.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [counts, settingsResult, lastJob, setupSnapshot] = await Promise.all([
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE created_at > ?1) AS orders_today,
        (SELECT COUNT(*) FROM orders WHERE created_at > ?3) AS orders_week,

        -- Order value, NOT revenue: an order created is not money received.
        (SELECT COALESCE(SUM(grand_total), 0) FROM orders
          WHERE created_at > ?1 AND status NOT IN ('cancelled','expired')) AS value_today,

        -- Money actually confirmed by a human. This one IS collected.
        (SELECT COALESCE(SUM(p.amount_received), 0) FROM order_payments p
          WHERE p.status = 'verified' AND p.verified_at > ?1) AS verified_today,

        (SELECT COUNT(*) FROM order_payments op WHERE ${TO_VERIFY}) AS to_verify,
        (SELECT COUNT(*) FROM order_payments op WHERE ${UNDER_VERIFICATION}) AS under_verification,
        (SELECT COUNT(*) FROM orders o WHERE ${TO_CONTACT}) AS awaiting_contact,

        -- Built FROM the saved-view definitions rather than restated here. A
        -- badge reading 4 that opens a list of 7 is read as broken software,
        -- and it is the merchant left to reconcile the difference. Deriving
        -- both from one source makes that drift impossible rather than merely
        -- unlikely.
        (SELECT COUNT(*) FROM orders o
          WHERE ${TO_PREPARE} AND ${ORDER_DELIVERY_FACET["ritiro"]}) AS pickups_to_prepare,
        (SELECT COUNT(*) FROM orders o
          WHERE ${TO_PREPARE} AND ${ORDER_DELIVERY_FACET["spedizione"]}) AS orders_to_ship,

        (SELECT COUNT(*) FROM inventory_levels il WHERE ${LOW_STOCK}) AS low_stock,
        (SELECT COUNT(*) FROM inventory_levels il WHERE ${OUT_OF_STOCK}) AS out_of_stock,
        (SELECT COUNT(*) FROM stock_reservations
          WHERE status = 'active' AND expires_at < ?2) AS overdue_reservations`,
    )
      .bind(dayAgo, now, weekAgo)
      .first<Record<string, number>>(),

    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{ key: string; value: string }>(),

    env.DB.prepare(
      `SELECT job_name, status, started_at FROM scheduled_job_runs
        ORDER BY started_at DESC LIMIT 1`,
    ).first<{ job_name: string; status: string; started_at: number }>(),

    loadSetupSnapshot(env, now),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  const c = counts ?? {};
  const n = (key: string) => Number(c[key] ?? 0);

  // A sweeper silent for half an hour has stopped; it runs every five minutes.
  const sweeperStale = !lastJob || now - lastJob.started_at > 30 * 60 * 1000;
  const setup = summariseSetup(computeSetupSteps(setupSnapshot));

  const actions = buildActionCentre(
    {
      paymentsToVerify: n("to_verify"),
      paymentsUnderVerification: n("under_verification"),
      ordersAwaitingContact: n("awaiting_contact"),
      pickupsToPrepare: n("pickups_to_prepare"),
      ordersToShip: n("orders_to_ship"),
      outOfStock: n("out_of_stock"),
      lowStock: n("low_stock"),
      overdueReservations: n("overdue_reservations"),
      productsWithoutPrice: setupSnapshot.productsWithoutPrice,
      productsWithoutImage: setupSnapshot.productsWithoutImage,
      unverifiedExactFit: setupSnapshot.exactFitUnverified,
      privilegedWithoutTotp: setupSnapshot.privilegedWithoutTotp,
      blockingSetupSteps: setup.blockingIncomplete.length,
      sweeperStale,
    },
    actor.permissions,
  );

  return {
    displayName: actor.displayName,
    actions,
    setup: { percentage: setup.percentage, readyToTrade: setup.readyToTrade },
    metrics: {
      ordersToday: n("orders_today"),
      ordersWeek: n("orders_week"),
      valueToday: n("value_today"),
      verifiedToday: n("verified_today"),
      toVerify: n("to_verify"),
      pickupsToPrepare: n("pickups_to_prepare"),
      lowStock: n("low_stock"),
    },
    canSeePayments: actor.permissions.includes("payment.read"),
    gates: gateStatuses(settings).filter((g) => !g.enabled),
  };
}

function Metric({
  label,
  value,
  note,
  to,
  variant,
}: {
  label: string;
  value: string | number;
  note?: string;
  to?: string;
  /** `headline` is one of the two figures the page exists for. */
  variant?: "headline";
}) {
  const body = (
    <>
      <span className="ac-metric__label">{label}</span>
      <span className="ac-metric__value numeric">{value}</span>
      {note ? <span className="ac-metric__note">{note}</span> : null}
    </>
  );
  return to ? (
    <Link
      to={to}
      className={`ac-metric ac-metric--link${variant === "headline" ? " ac-metric--headline" : ""}`}
    >
      {body}
    </Link>
  ) : (
    <div className={`ac-metric${variant === "headline" ? " ac-metric--headline" : ""}`}>{body}</div>
  );
}

const SEVERITY_CLASS = {
  blocking: "ac-action--blocking",
  attention: "ac-action--warning",
  informational: "ac-action--info",
} as const;

function ActionRow({ item }: { item: ActionItem }) {
  return (
    <li className={`ac-action ${SEVERITY_CLASS[item.severity]}`}>
      <span className="ac-action__count numeric" aria-hidden="true">
        {item.count}
      </span>
      <div className="ac-action__body">
        <p className="ac-action__label">
          {item.label}
          {/*
            The badge is hidden from assistive tech because a bare number read
            before its label is noise; it is spoken here as part of a sentence.
          */}
          <span className="visually-hidden">: {item.count}</span>
        </p>
        <p className="ac-action__detail small muted">{item.detail}</p>
      </div>
      <Link to={item.href} className="btn btn--secondary">
        Apri
      </Link>
    </li>
  );
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { displayName, actions, setup, metrics, canSeePayments, gates } = loaderData;

  return (
    <>
      <PageHeader
        title={`Ciao, ${displayName}`}
        description="Cosa è successo, e cosa aspetta voi."
        breadcrumbs={breadcrumbsFor(pathname)}
        primaryAction={{ label: "Aggiungi prodotto", to: "/admin/prodotti/nuovo" }}
        {...(setup.readyToTrade
          ? {}
          : {
              secondaryActions: [
                { label: "Completa la configurazione", to: "/admin/configurazione" },
              ],
            })}
      />

      {!setup.readyToTrade ? (
        <p className="notice notice--warning" role="status">
          Configurazione al <strong className="numeric">{setup.percentage}%</strong>. Alcuni
          passaggi obbligatori mancano ancora: finché restano aperti il negozio non è pronto a
          vendere. <Link to="/admin/configurazione">Vedi cosa manca</Link>.
        </p>
      ) : null}

      {/* ── What needs me ─────────────────────────────────────────────────── */}
      <section className="stack" aria-labelledby="azioni">
        <h2 id="azioni">Da fare adesso</h2>

        {isClear(actions) ? (
          <p className="notice notice--success" role="status">
            Non c&apos;è nulla in attesa. Nessun pagamento da verificare, nessun ordine da
            preparare, nessuna scorta esaurita.
          </p>
        ) : (
          <ul className="ac-actions">
            {actions.map((item) => (
              <ActionRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {/* ── What happened ─────────────────────────────────────────────────── */}
      <section className="stack" style={{ marginBlockStart: "var(--space-6)" }}>
        <h2>Ultime 24 ore</h2>

        {/*
          Two figures, then the counters.
          
          Six equal cards asked the reader to rank them, every time. Money and
          order count are what a shop owner opens this page for; the rest are
          work queues, and a queue is a number you check rather than read. The
          split is the hierarchy — same data, one decision made in advance.
        */}
        <div className="ac-headline">
          <Metric
            variant="headline"
            label="Ordini ricevuti"
            value={metrics.ordersToday}
            to="/admin/ordini"
          />
          <Metric
            variant="headline"
            label="Valore degli ordini"
            value={formatMoney(money(metrics.valueToday))}
            // Calling this "incasso" would be a lie: most of it is not paid yet.
            note="Ordini creati, non incassati"
          />
        </div>

        <div className="ac-metrics">
          {canSeePayments ? (
            <>
              <Metric
                label="Pagamenti verificati"
                value={formatMoney(money(metrics.verifiedToday))}
                note="Confermati da una persona"
              />
              <Metric
                label="Pagamenti da verificare"
                value={metrics.toVerify}
                to="/admin/pagamenti?vista=da-verificare"
              />
            </>
          ) : null}
          <Metric
            label="Ritiri da preparare"
            value={metrics.pickupsToPrepare}
            to="/admin/ordini?vista=da-preparare&consegna=ritiro"
          />
          <Metric
            label="Scorte in esaurimento"
            value={metrics.lowStock}
            to="/admin/inventario?vista=scorte-basse"
          />
        </div>
        <p className="caption muted">
          Ordini negli ultimi 7 giorni: <span className="numeric">{metrics.ordersWeek}</span>.
          Nessun grafico: con questi volumi una curva direbbe più di quanto i dati sappiano.
        </p>
      </section>

      {/*
        Not an error list. The honest answer to "why is my phone number not on
        the site?" — the feature is off because the value is empty.
      */}
      {gates.length > 0 ? (
        <section className="stack" style={{ marginBlockStart: "var(--space-6)" }}>
          <h2>Funzioni nascoste sul sito</h2>
          <p className="small muted">
            Queste parti del sito non vengono mostrate perché mancano i dati. Non viene inventato
            nulla: un campo vuoto non produce un segnaposto.
          </p>
          {/*
            Named, not coded.

            This printed the gate identifier and the raw setting keys —
            "legal_identity — mancano: business.legal_name, business.vat_number".
            Three database keys and an internal name, on the screen of somebody
            who runs a phone shop. The labels come from the gates module, beside
            the checks they describe.
          */}
          <ul className="ac-gates">
            {gates.map((gate) => {
              const label = GATE_LABELS[gate.feature];
              return (
                <li className="ac-gate" key={gate.feature}>
                  <span className="ac-gate__what">{label?.what ?? gate.feature}</span>
                  {label ? <span className="ac-gate__where">{label.where}</span> : null}
                  <span className="ac-gate__missing">
                    Manca: {gate.missingKeys.map((k) => SETTING_LABELS[k] ?? k).join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
          <p>
            <Link className="btn btn--secondary" to="/admin/impostazioni">
              Completa le impostazioni
            </Link>
          </p>
        </section>
      ) : null}
    </>
  );
}
