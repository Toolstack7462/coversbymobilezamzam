import { Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { gateStatuses, type SettingsMap } from "~/domain/content/gates";

/**
 * The dashboard.
 *
 * Real counts only. **No charts**, because with no data a chart is decoration
 * and with a little data it is misleading. Every card is a number someone can
 * act on, and each links to the screen where they would act.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  const now = systemClock.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const [counts, settingsResult, jobs] = await Promise.all([
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE created_at > ?1) AS orders_today,
        (SELECT COALESCE(SUM(grand_total), 0) FROM orders
          WHERE created_at > ?1 AND status NOT IN ('cancelled','expired')) AS value_today,
        (SELECT COUNT(*) FROM order_payments
          WHERE status IN ('proof_received','under_verification')) AS to_verify,
        (SELECT COUNT(*) FROM order_payments WHERE status = 'awaiting_payment') AS awaiting_payment,
        (SELECT COUNT(*) FROM orders WHERE status = 'ready_for_pickup') AS ready_for_pickup,
        (SELECT COUNT(*) FROM orders WHERE status = 'processing') AS processing,
        (SELECT COUNT(*) FROM inventory_levels
          WHERE reorder_threshold IS NOT NULL AND (on_hand - reserved) <= reorder_threshold
            AND (on_hand - reserved) > 0) AS low_stock,
        (SELECT COUNT(*) FROM inventory_levels WHERE (on_hand - reserved) <= 0) AS out_of_stock,
        (SELECT COUNT(*) FROM stock_reservations
          WHERE status = 'active' AND expires_at < ?2) AS overdue_reservations`,
    )
      .bind(dayAgo, now)
      .first<Record<string, number>>(),

    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),

    env.DB.prepare(
      `SELECT job_name, status, started_at FROM scheduled_job_runs
        ORDER BY started_at DESC LIMIT 1`,
    ).first<{ job_name: string; status: string; started_at: number }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  return {
    displayName: actor.displayName,
    counts: counts ?? {},
    // Which storefront features are hidden, and exactly why.
    gates: gateStatuses(settings).filter((g) => !g.enabled),
    lastJob: jobs,
    now,
    canSeePayments: actor.permissions.includes("payment.read"),
  };
}

interface CardProps {
  label: string;
  value: string | number;
  to?: string;
  tone?: "default" | "warning";
}

function Card({ label, value, to, tone = "default" }: CardProps) {
  const body = (
    <>
      <span className="admin-card__value numeric">{value}</span>
      <span className="admin-card__label">{label}</span>
    </>
  );
  const className = `admin-card${tone === "warning" ? " admin-card--warning" : ""}`;
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { displayName, counts, gates, lastJob, now, canSeePayments } = loaderData;

  // A sweeper that stopped leaves stock reserved forever, so it gets a card of
  // its own rather than being buried in logs.
  const sweeperStale = !lastJob || now - lastJob.started_at > 30 * 60 * 1000;

  return (
    <div className="stack">
      <h1>Ciao, {displayName}</h1>

      <section>
        <h2>Ultime 24 ore</h2>
        <div className="admin-cards">
          <Card label="Ordini" value={counts.orders_today ?? 0} to="/admin/ordini" />
          <Card label="Valore ordini" value={formatMoney(money(counts.value_today ?? 0))} />
          {canSeePayments ? (
            <Card
              label="Da verificare"
              value={counts.to_verify ?? 0}
              to="/admin/pagamenti"
              tone={(counts.to_verify ?? 0) > 0 ? "warning" : "default"}
            />
          ) : null}
          <Card label="In attesa di pagamento" value={counts.awaiting_payment ?? 0} />
        </div>
      </section>

      <section>
        <h2>Da fare</h2>
        <div className="admin-cards">
          <Card
            label="Pronti per il ritiro"
            value={counts.ready_for_pickup ?? 0}
            to="/admin/ordini"
          />
          <Card label="In preparazione" value={counts.processing ?? 0} to="/admin/ordini" />
          <Card
            label="Scorte in esaurimento"
            value={counts.low_stock ?? 0}
            to="/admin/inventario"
            tone={(counts.low_stock ?? 0) > 0 ? "warning" : "default"}
          />
          <Card label="Esauriti" value={counts.out_of_stock ?? 0} to="/admin/inventario" />
        </div>
      </section>

      <section>
        <h2>Sistema</h2>
        <div className="admin-cards">
          <Card
            label="Prenotazioni scadute non rilasciate"
            value={counts.overdue_reservations ?? 0}
            tone={(counts.overdue_reservations ?? 0) > 0 ? "warning" : "default"}
          />
          <Card
            label={sweeperStale ? "Job automatico: NON attivo" : "Job automatico: attivo"}
            value={lastJob ? lastJob.status : "mai eseguito"}
            tone={sweeperStale ? "warning" : "default"}
          />
        </div>
        {sweeperStale ? (
          <p className="notice notice--warning small">
            Il job di rilascio prenotazioni non risulta eseguito di recente. Se non gira, le scorte
            restano bloccate e i prodotti spariscono dalla vendita. Vedi{" "}
            <code>docs/operations-runbook.md</code>.
          </p>
        ) : null}
      </section>

      {/*
        Not an error list. This is the honest answer to "why is my phone number
        not on the site?" — the feature is off because the value is empty.
      */}
      {gates.length > 0 ? (
        <section>
          <h2>Funzioni nascoste sul sito</h2>
          <p className="small muted">
            Queste parti del sito non vengono mostrate perché mancano i dati. Non viene inventato
            nulla: un campo vuoto non produce un segnaposto.
          </p>
          <ul className="stack small">
            {gates.map((gate) => (
              <li key={gate.feature}>
                <strong>{gate.feature}</strong> — mancano:{" "}
                <code>{gate.missingKeys.join(", ")}</code>
              </li>
            ))}
          </ul>
          <p>
            <Link className="btn btn--secondary" to="/admin/impostazioni">
              Completa le impostazioni
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
