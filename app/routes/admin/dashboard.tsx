import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Link, useLocation } from "react-router";
import type { Route } from "./+types/dashboard";
import { appContext } from "~/runtime/context";
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
import { ORDER_VIEWS, PAYMENT_VIEWS, ORDER_DELIVERY_FACET, type ListView } from "~/lib/order-views";
import { INVENTORY_VIEWS } from "~/lib/inventory-views";
import { viewClause } from "~/lib/order-views";
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
const clause = (views: readonly ListView[], slug: string, nowMs: number): string =>
  viewClause(
    views.find((v) => v.slug === slug)!,
    nowMs,
  );

/*
 * Resolved per request rather than at module load.
 *
 * One of these views compares against "now", and a module-level constant would
 * freeze that at the moment the isolate started — so a long-lived Node process
 * would report expired reservations as of whenever it was last deployed.
 */
const badgeClauses = (nowMs: number) => ({
  toPrepare: clause(ORDER_VIEWS, "da-preparare", nowMs),
  toContact: clause(ORDER_VIEWS, "da-contattare", nowMs),
  toVerify: clause(PAYMENT_VIEWS, "da-verificare", nowMs),
  underVerification: clause(PAYMENT_VIEWS, "in-verifica", nowMs),
  lowStock: clause(INVENTORY_VIEWS, "scorte-basse", nowMs),
  outOfStock: clause(INVENTORY_VIEWS, "esauriti", nowMs),
});

export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Panoramica") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env);

  const now = systemClock.now();
  const { toPrepare, toContact, toVerify, underVerification, lowStock, outOfStock } =
    badgeClauses(now);
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

        (SELECT COUNT(*) FROM order_payments op WHERE ${toVerify}) AS to_verify,
        (SELECT COUNT(*) FROM order_payments op WHERE ${underVerification}) AS under_verification,
        (SELECT COUNT(*) FROM orders o WHERE ${toContact}) AS awaiting_contact,

        -- Built FROM the saved-view definitions rather than restated here. A
        -- badge reading 4 that opens a list of 7 is read as broken software,
        -- and it is the merchant left to reconcile the difference. Deriving
        -- both from one source makes that drift impossible rather than merely
        -- unlikely.
        (SELECT COUNT(*) FROM orders o
          WHERE ${toPrepare} AND ${ORDER_DELIVERY_FACET["ritiro"]}) AS pickups_to_prepare,
        (SELECT COUNT(*) FROM orders o
          WHERE ${toPrepare} AND ${ORDER_DELIVERY_FACET["spedizione"]}) AS orders_to_ship,

        (SELECT COUNT(*) FROM inventory_levels il WHERE ${lowStock}) AS low_stock,
        (SELECT COUNT(*) FROM inventory_levels il WHERE ${outOfStock}) AS out_of_stock,
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
    canManageProducts: actor.permissions.includes("product.write"),
    canReadProducts: actor.permissions.includes("product.read"),
    photoTasks: setupSnapshot.productsWithoutImage,
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
  const t = useAdminTranslator();
  const body = (
    <>
      <span className="ac-metric__label">{t(label)}</span>
      <span className="ac-metric__value numeric">{value}</span>
      {note ? <span className="ac-metric__note">{t(note)}</span> : null}
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
  const t = useAdminTranslator();
  return (
    <li className={`ac-action ${SEVERITY_CLASS[item.severity]}`}>
      <span className="ac-action__count numeric" aria-hidden="true">
        {item.count}
      </span>
      <div className="ac-action__body">
        <p className="ac-action__label">
          {t(item.label)}
          {/*
            The badge is hidden from assistive tech because a bare number read
            before its label is noise; it is spoken here as part of a sentence.
          */}
          <span className="visually-hidden">: {item.count}</span>
        </p>
        <p className="ac-action__detail small muted">{t(item.detail)}</p>
      </div>
      <Link to={item.href} className="btn btn--secondary">
        {t("Apri")}
      </Link>
    </li>
  );
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { pathname } = useLocation();
  const {
    displayName,
    actions,
    setup,
    metrics,
    canSeePayments,
    gates,
    canManageProducts,
    canReadProducts,
    photoTasks,
  } = loaderData;
  const visibleCount = Math.max(4, actions.filter((item) => item.severity === "blocking").length);
  const priorityActions = actions.slice(0, visibleCount);
  const otherActions = actions.slice(visibleCount);

  return (
    <>
      <PageHeader
        title={t("Ciao, {{v0}}", { v0: displayName })}
        description={t("Ordini, pagamenti e catalogo: il lavoro di oggi.")}
        breadcrumbs={breadcrumbsFor(pathname)}
        {...(canManageProducts
          ? { primaryAction: { label: "Aggiungi prodotto", to: "/admin/prodotti/nuovo" } }
          : {})}
      />
      <div className="ac-dashboard">
        <section className="ac-dashboard__overview" aria-labelledby="riepilogo">
          <div className="ac-dashboard__section-head">
            <h2 id="riepilogo">{t("Ultime 24 ore")}</h2>
            <p className="small muted">
              {t("Ultimi 7 giorni: ")}
              <strong className="numeric">{metrics.ordersWeek}</strong> {t(" ordini")}
            </p>
          </div>
          <div className="ac-headline">
            <Metric
              variant="headline"
              label={t("Ordini ricevuti")}
              value={metrics.ordersToday}
              to="/admin/ordini"
            />
            <Metric
              variant="headline"
              label={t("Valore degli ordini")}
              value={formatMoney(money(metrics.valueToday), t.intl)}
              note="Ordini creati, non incassati"
            />
          </div>
          <div className="ac-metrics">
            {canSeePayments ? (
              <>
                <Metric
                  label={t("Pagamenti verificati")}
                  value={formatMoney(money(metrics.verifiedToday), t.intl)}
                  note="Confermati da una persona"
                />
                <Metric
                  label={t("Pagamenti da verificare")}
                  value={metrics.toVerify}
                  to="/admin/pagamenti?vista=da-verificare"
                />
              </>
            ) : null}
            <Metric
              label={t("Ritiri da preparare")}
              value={metrics.pickupsToPrepare}
              to="/admin/ordini?vista=da-preparare&consegna=ritiro"
            />
            <Metric
              label={t("Scorte in esaurimento")}
              value={metrics.lowStock}
              to="/admin/inventario?vista=scorte-basse"
            />
          </div>
        </section>
        <div className="ac-dashboard__workspace">
          <section className="ac-panel ac-dashboard__priorities" aria-labelledby="azioni">
            <div className="ac-dashboard__section-head">
              <div>
                <h2 id="azioni">{t("Da fare adesso")}</h2>
                <p className="small muted">{t("Le attività in ordine di priorità.")}</p>
              </div>
              <span
                className="ac-dashboard__count numeric"
                aria-label={t("{{v0}} tipi di attività", { v0: actions.length })}
              >
                {actions.length}
              </span>
            </div>
            {isClear(actions) ? (
              <p className="notice notice--success" role="status">
                {t(
                  "Non c'è nulla in attesa. Nessun pagamento da verificare, nessun ordine da preparare, nessuna scorta esaurita.",
                )}
              </p>
            ) : (
              <>
                <ul className="ac-actions">
                  {priorityActions.map((item) => (
                    <ActionRow key={item.id} item={item} />
                  ))}
                </ul>
                {otherActions.length > 0 ? (
                  <details className="ac-dashboard__more">
                    <summary>
                      {t("Altre attività (")}
                      {otherActions.length})
                    </summary>
                    <ul className="ac-actions">
                      {otherActions.map((item) => (
                        <ActionRow key={item.id} item={item} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </section>
          <aside className="ac-dashboard__side" aria-label={t("Preparazione del negozio")}>
            {canReadProducts ? (
              <section className="ac-panel ac-dashboard__photos" aria-labelledby="foto-catalogo">
                <p className="ac-dashboard__eyebrow">{t("Catalogo")}</p>
                <h2 id="foto-catalogo">{t("Le foto fanno la differenza")}</h2>
                <p className="small muted">
                  {photoTasks > 0
                    ? t("{{v0}} prodotti senza una foto utilizzabile sul sito.", { v0: photoTasks })
                    : t("Ogni prodotto ha almeno una foto utilizzabile sul sito.")}
                </p>
                <Link className="btn btn--secondary" to="/admin/prodotti?vista=senza-immagine">
                  {t("Rivedi le foto ")}
                  <span aria-hidden="true">↗</span>
                </Link>
              </section>
            ) : null}
            <section className="ac-panel" aria-labelledby="stato-negozio">
              <h2 id="stato-negozio">{t("Il tuo negozio")}</h2>
              <div className="ac-dashboard__progress-label">
                <span>{t("Configurazione")}</span>
                <strong className="numeric">{setup.percentage}%</strong>
              </div>
              <progress
                className="ac-dashboard__progress"
                max="100"
                value={setup.percentage}
                aria-label={t("Configurazione del negozio")}
              />
              <p className="small muted">
                {setup.readyToTrade
                  ? t("I passaggi obbligatori sono completati.")
                  : t("Completa i passaggi obbligatori prima di vendere.")}
              </p>
              <Link className="ac-dashboard__text-link" to="/admin/configurazione">
                {t("Apri configurazione ")}
                <span aria-hidden="true">↗</span>
              </Link>
            </section>
            {gates.length > 0 ? (
              <details className="ac-panel ac-dashboard__settings">
                <summary>
                  {t("Dati da completare (")}
                  {gates.length})
                </summary>
                <p className="small muted">
                  {t("Queste sezioni del sito sono nascoste finché non completi i dati.")}
                </p>
                <ul className="ac-gates">
                  {gates.map((gate) => {
                    const label = GATE_LABELS[gate.feature];
                    return (
                      <li className="ac-gate" key={gate.feature}>
                        <span className="ac-gate__what">{t(label?.what ?? gate.feature)}</span>
                        {label ? <span className="ac-gate__where">{t(label.where)}</span> : null}
                        <span className="ac-gate__missing">
                          {t("Manca: ")}
                          {gate.missingKeys.map((k) => t(SETTING_LABELS[k] ?? k)).join(", ")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Link className="ac-dashboard__text-link" to="/admin/impostazioni">
                  {t("Completa le impostazioni")}
                </Link>
              </details>
            ) : null}
          </aside>
        </div>
      </div>
    </>
  );
}
