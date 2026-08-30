import { Link } from "react-router";
import type { Route } from "./+types/audit";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { formatDateTime } from "~/lib/i18n";

/**
 * The audit log (invariant 8).
 *
 * Read-only, deliberately. There is no delete and no edit: an audit trail that
 * can be tidied is not an audit trail, and "who changed this price?" must stay
 * answerable months later.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "audit.read");

  const url = new URL(request.url);
  const action = url.searchParams.get("azione") ?? "";

  const { results } = await env.DB.prepare(
    `SELECT id, actor_label, actor_id, action, entity_type, entity_id,
            before_value, after_value, created_at
       FROM audit_logs
      ${action ? "WHERE action = ?1" : ""}
      ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(...(action ? [action] : []))
    .all<{
      id: string;
      actor_label: string | null;
      actor_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      before_value: string | null;
      after_value: string | null;
      created_at: number;
    }>();

  const actions = await env.DB.prepare(
    `SELECT DISTINCT action FROM audit_logs ORDER BY action`,
  ).all<{ action: string }>();

  return { entries: results, actions: actions.results.map((a) => a.action), filter: action };
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  const { entries, actions, filter } = loaderData;

  return (
    <div className="stack">
      <h1>Registro attività</h1>
      <p className="small muted">
        Sola lettura. Le voci non possono essere modificate o cancellate.
      </p>

      {actions.length > 0 ? (
        <nav className="cluster" aria-label="Filtra per azione">
          <Link to="/admin/registro" className="chip" aria-pressed={filter === ""}>
            Tutte
          </Link>
          {actions.map((action) => (
            <Link
              key={action}
              to={`/admin/registro?azione=${encodeURIComponent(action)}`}
              className="chip"
              aria-pressed={filter === action}
            >
              {action}
            </Link>
          ))}
        </nav>
      ) : null}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna voce registrata.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Registro attività</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Chi</th>
                <th scope="col">Azione</th>
                <th scope="col">Oggetto</th>
                <th scope="col">Prima</th>
                <th scope="col">Dopo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="small">{formatDateTime(entry.created_at, "it")}</td>
                  <td className="small">{entry.actor_label ?? entry.actor_id}</td>
                  <td className="small">{entry.action}</td>
                  <td className="small">
                    {entry.entity_type}
                    <br />
                    <span className="muted numeric">{entry.entity_id}</span>
                  </td>
                  {/* Values are redacted before writing, so nothing sensitive
                      reaches this table in the first place. */}
                  <td className="caption">{entry.before_value ?? "—"}</td>
                  <td className="caption">{entry.after_value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
