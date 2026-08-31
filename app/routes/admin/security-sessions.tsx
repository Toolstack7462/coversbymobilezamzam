import { Form } from "react-router";
import type { Route } from "./+types/security-sessions";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff, getSession } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";

/**
 * Active sessions.
 *
 * Session TOKENS are never selected, never rendered and never logged — the
 * token IS the session, so putting it on a page would hand anyone reading over
 * a shoulder a working login. Rows are identified by their opaque id.
 *
 * The user agent is shown because "which of these is my laptop?" is the whole
 * question this page answers. The IP is shown truncated: enough to recognise a
 * network, not enough to be a location log.
 */

export function meta() {
  return [{ title: "Sessioni attive" }, { name: "robots", content: "noindex, nofollow" }];
}

/** 203.0.113.42 -> 203.0.113.x — recognisable, not a precise record. */
function truncateIp(ip: string | null): string {
  if (!ip) return "—";
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}:…`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.x` : "—";
}

/** A readable device label. Best-effort, never presented as certain. */
function describeAgent(agent: string | null): string {
  if (!agent) return "Dispositivo sconosciuto";
  const browser = /Firefox\/|FxiOS/.test(agent)
    ? "Firefox"
    : /Edg\//.test(agent)
      ? "Edge"
      : /Chrome\/|CriOS/.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "—";
  return `${browser} · ${platform}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);
  const current = await getSession(request, env);

  const { results } = await env.DB.prepare(
    // NOTE: `token` is deliberately absent from this SELECT.
    `SELECT id, ip_address, user_agent, created_at, updated_at, expires_at
       FROM session WHERE user_id = ?1 AND expires_at > ?2
      ORDER BY updated_at DESC`,
  )
    .bind(actor.userId, systemClock.now())
    .all<{
      id: string;
      ip_address: string | null;
      user_agent: string | null;
      created_at: number;
      updated_at: number;
      expires_at: number;
    }>();

  return {
    sessions: results.map((s) => ({
      id: s.id,
      device: describeAgent(s.user_agent),
      ip: truncateIp(s.ip_address),
      createdAt: s.created_at,
      lastSeenAt: s.updated_at,
      isCurrent: s.id === current?.session?.id,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);
  const current = await getSession(request, env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  // Scoped to the actor's OWN sessions in the WHERE clause. Passing another
  // user's session id must do nothing, not merely be hidden from the UI.
  if (intent === "revoke") {
    const sessionId = String(form.get("sessionId") ?? "");
    if (sessionId === current?.session?.id) {
      return { error: "Per chiudere la sessione corrente usa Esci." };
    }

    const result = await env.DB.prepare(`DELETE FROM session WHERE id = ?1 AND user_id = ?2`)
      .bind(sessionId, actor.userId)
      .run();

    if (result.meta.changes === 0) return { error: "Sessione non trovata." };

    await env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'auth.session_revoked','session',?4,?5,?6)`,
    )
      .bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        sessionId,
        JSON.stringify({ scope: "single" }),
        now,
      )
      .run();

    return { success: "Sessione chiusa." };
  }

  if (intent === "revoke-others") {
    const result = await env.DB.prepare(`DELETE FROM session WHERE user_id = ?1 AND id <> ?2`)
      .bind(actor.userId, current?.session?.id ?? "")
      .run();

    await env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'auth.session_revoked','user',?2,?4,?5)`,
    )
      .bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        JSON.stringify({ scope: "all_others", count: result.meta.changes }),
        now,
      )
      .run();

    return { success: `Chiuse ${result.meta.changes} altre sessioni.` };
  }

  return { error: "Azione non riconosciuta." };
}

export default function SecuritySessions({ loaderData, actionData }: Route.ComponentProps) {
  const { sessions } = loaderData;

  return (
    <div className="stack" style={{ maxWidth: "48rem" }}>
      <h1>Sessioni attive</h1>
      <p className="small muted">
        Se non riconosci un accesso, chiudilo e cambia subito la password.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {actionData.success}
        </p>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="visually-hidden">Sessioni attive del tuo account</caption>
          <thead>
            <tr>
              <th scope="col">Dispositivo</th>
              <th scope="col">Rete</th>
              <th scope="col">Ultimo utilizzo</th>
              <th scope="col">Iniziata</th>
              <th scope="col">Azione</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.device}
                  {s.isCurrent ? <span className="badge"> questa sessione</span> : null}
                </td>
                <td className="numeric small">{s.ip}</td>
                <td className="small">{formatDateTime(s.lastSeenAt, "it")}</td>
                <td className="small">{formatDateTime(s.createdAt, "it")}</td>
                <td>
                  {s.isCurrent ? (
                    <span className="muted small">—</span>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button type="submit" className="btn btn--ghost">
                        Chiudi
                      </button>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sessions.length > 1 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="revoke-others" />
          <button type="submit" className="btn btn--secondary">
            Chiudi tutte le altre sessioni
          </button>
        </Form>
      ) : null}
    </div>
  );
}
