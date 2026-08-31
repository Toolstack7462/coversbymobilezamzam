import { useLocation } from "react-router";
import type { Route } from "./+types/system-health";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { formatDateTime } from "~/lib/i18n";

/**
 * Stato del sistema.
 *
 * Answers the questions a shopkeeper cannot answer from the shop floor: is the
 * automatic job running, is the data consistent, when was the last backup
 * actually restored.
 *
 * Every figure is read live. Nothing here is a stored health flag - a flag that
 * says "healthy" is only ever as fresh as the last thing that remembered to
 * update it.
 */
export function meta() {
  return [{ title: "Stato del sistema" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "settings.read");
  const now = systemClock.now();

  const [lastJob, checks] = await Promise.all([
    env.DB.prepare(
      `SELECT job_name, status, started_at, items_processed, error
         FROM scheduled_job_runs ORDER BY started_at DESC LIMIT 1`,
    ).first<{
      job_name: string;
      status: string;
      started_at: number;
      items_processed: number;
      error: string | null;
    }>(),

    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM stock_reservations
          WHERE status = 'active' AND expires_at < ?1) AS overdue_reservations,
        (SELECT COUNT(*) FROM inventory_levels WHERE reserved > on_hand OR reserved < 0) AS invariant_breaches,
        (SELECT COUNT(*) FROM outbox_events WHERE status = 'pending') AS pending_outbox,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM audit_logs) AS audit_rows,
        (SELECT value FROM system_settings WHERE key = 'ops.last_restore_test_at') AS last_restore,
        (SELECT value FROM system_settings WHERE key = 'ops.preview_deployed_at') AS preview_at`,
    ).first<Record<string, number | string | null>>(),
  ]);

  // The sweeper runs every five minutes. Half an hour of silence means stopped,
  // and a stopped sweeper leaves stock reserved forever.
  const sweeperStale = !lastJob || now - lastJob.started_at > 30 * 60 * 1000;

  return {
    lastJob,
    sweeperStale,
    overdueReservations: Number(checks?.overdue_reservations ?? 0),
    invariantBreaches: Number(checks?.invariant_breaches ?? 0),
    pendingOutbox: Number(checks?.pending_outbox ?? 0),
    orders: Number(checks?.orders ?? 0),
    auditRows: Number(checks?.audit_rows ?? 0),
    lastRestore: checks?.last_restore ? Number(checks.last_restore) : null,
    previewAt: checks?.preview_at ? Number(checks.preview_at) : null,
    environment: env.APP_ENV ?? "development",
    now,
  };
}

export default function SystemHealth({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const d = loaderData;

  return (
    <>
      <PageHeader
        title="Stato del sistema"
        description="Controlli tecnici in tempo reale. Nessun valore è memorizzato: sono letti adesso."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

      <div className="ac-actions">
        <div className={`ac-action ${d.sweeperStale ? "ac-action--blocking" : ""}`}>
          <div>
            <strong>Job automatico di rilascio prenotazioni</strong>
            <p className="small muted">
              {d.lastJob
                ? `Ultima esecuzione: ${formatDateTime(d.lastJob.started_at, "it")} · ${d.lastJob.status}`
                : "Mai eseguito."}
              {d.sweeperStale
                ? " Se non gira, le scorte restano bloccate e i prodotti spariscono dalla vendita."
                : ""}
            </p>
          </div>
          <span className="ac-action__count">{d.sweeperStale ? "FERMO" : "ATTIVO"}</span>
        </div>

        <div className={`ac-action ${d.invariantBreaches > 0 ? "ac-action--blocking" : ""}`}>
          <div>
            <strong>Coerenza delle giacenze</strong>
            <p className="small muted">
              Righe in cui il prenotato supera la giacenza. Dovrebbe essere sempre zero: il vincolo
              del database lo impedisce, quindi un valore diverso è un bug.
            </p>
          </div>
          <span className="ac-action__count">{d.invariantBreaches}</span>
        </div>

        <div className={`ac-action ${d.overdueReservations > 0 ? "ac-action--warning" : ""}`}>
          <div>
            <strong>Prenotazioni scadute non rilasciate</strong>
            <p className="small muted">Se restano sopra zero a lungo, il job non sta girando.</p>
          </div>
          <span className="ac-action__count">{d.overdueReservations}</span>
        </div>

        <div className="ac-action">
          <div>
            <strong>Email in coda</strong>
            <p className="small muted">
              L&apos;invio email non è configurato: gli eventi restano in coda e non vanno persi.
              Nessun ordine fallisce per questo.
            </p>
          </div>
          <span className="ac-action__count">{d.pendingOutbox}</span>
        </div>

        <div className={`ac-action ${d.lastRestore === null ? "ac-action--warning" : ""}`}>
          <div>
            <strong>Ultimo ripristino verificato</strong>
            <p className="small muted">
              {d.lastRestore
                ? formatDateTime(d.lastRestore, "it")
                : "Mai. Un backup che nessuno ha mai ripristinato non è un backup."}
            </p>
          </div>
        </div>

        <div className="ac-action">
          <div>
            <strong>Ambiente</strong>
            <p className="small muted">
              {d.environment} ·{" "}
              {d.previewAt
                ? `anteprima pubblicata il ${formatDateTime(d.previewAt, "it")}`
                : "nessuna anteprima pubblicata"}
            </p>
          </div>
        </div>
      </div>

      <p className="caption muted" style={{ marginBlockStart: "var(--space-4)" }}>
        Ordini registrati: {d.orders} · voci nel registro attività: {d.auditRows}
      </p>
    </>
  );
}
