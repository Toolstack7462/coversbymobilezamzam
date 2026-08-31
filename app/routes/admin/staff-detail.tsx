import { Form, Link } from "react-router";
import { data } from "react-router";
import type { Route } from "./+types/staff-detail";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff, hasStepUp, consumeStepUp } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import {
  canChangeStatus,
  allowedStatusChanges,
  guardLastSuperAdmin,
  canGrantRole,
  canActOnStaff,
  type StaffStatus,
  type StaffSummary,
} from "~/domain/users/staff-guards";
import type { Permission } from "~/domain/users/permissions";

/**
 * One staff member: status, roles, sessions, history.
 *
 * Every mutation here is checked against the domain guards in
 * `staff-guards.ts`, not against what the UI happens to render. Hiding a button
 * is a courtesy; the action refusing is the control.
 */

export function meta() {
  return [{ title: "Personale" }, { name: "robots", content: "noindex, nofollow" }];
}

/** Everyone's status and roles — the input the last-super-admin guard needs. */
async function loadSummaries(env: Env): Promise<StaffSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT sp.user_id, sp.status,
            (SELECT GROUP_CONCAT(r.code) FROM user_roles ur
               JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = sp.user_id) AS role_codes
       FROM staff_profiles sp WHERE sp.archived_at IS NULL`,
  ).all<{ user_id: string; status: string; role_codes: string | null }>();

  return results.map((r) => ({
    userId: r.user_id,
    status: r.status as StaffStatus,
    roleCodes: r.role_codes?.split(",") ?? [],
  }));
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "staff.read");
  const now = systemClock.now();

  const member = await env.DB.prepare(
    `SELECT sp.id, sp.user_id, sp.display_name, sp.job_title, sp.status, sp.last_login_at,
            sp.suspended_reason, u.email,
            (SELECT COUNT(*) FROM two_factor tf WHERE tf.user_id = sp.user_id AND tf.verified = 1) AS totp_verified,
            (SELECT COUNT(*) FROM session s WHERE s.user_id = sp.user_id AND s.expires_at > ?1) AS active_sessions
       FROM staff_profiles sp JOIN user u ON u.id = sp.user_id
      WHERE sp.id = ?2`,
  )
    .bind(now, params.staffId)
    .first<{
      id: string;
      user_id: string;
      display_name: string;
      job_title: string | null;
      status: string;
      last_login_at: number | null;
      suspended_reason: string | null;
      email: string;
      totp_verified: number;
      active_sessions: number;
    }>();

  if (!member) throw data(null, { status: 404 });

  const [roles, assigned, history] = await Promise.all([
    env.DB.prepare(
      `SELECT r.id, r.code, r.name_it,
              (SELECT GROUP_CONCAT(p.code) FROM role_permissions rp
                 JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id) AS permission_codes
         FROM roles r ORDER BY r.sort_order`,
    ).all<{ id: string; code: string; name_it: string; permission_codes: string | null }>(),

    env.DB.prepare(`SELECT role_id FROM user_roles WHERE user_id = ?1`)
      .bind(member.user_id)
      .all<{ role_id: string }>(),

    env.DB.prepare(
      `SELECT action, after_value, created_at, actor_label FROM audit_logs
        WHERE entity_id = ?1 OR entity_id = ?2 ORDER BY created_at DESC LIMIT 25`,
    )
      .bind(member.user_id, member.id)
      .all<{
        action: string;
        after_value: string | null;
        created_at: number;
        actor_label: string | null;
      }>(),
  ]);

  const assignedIds = new Set(assigned.results.map((r) => r.role_id));

  return {
    member: { ...member, totpEnrolled: member.totp_verified > 0 },
    roles: roles.results.map((r) => ({
      ...r,
      assigned: assignedIds.has(r.id),
      // Computed server-side so the UI cannot offer what the guard will refuse.
      grantable: canGrantRole(actor, {
        code: r.code,
        permissions: (r.permission_codes?.split(",") ?? []) as Permission[],
      }).allowed,
    })),
    history: history.results,
    allowedStatuses: allowedStatusChanges(member.status as StaffStatus),
    canWrite: actor.permissions.includes("staff.write"),
    canManageRoles: actor.permissions.includes("staff.roles"),
    stepUpActive: await hasStepUp(env, actor.userId, "staff.roles", now),
    isSelf: actor.userId === member.user_id,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  const member = await env.DB.prepare(
    `SELECT id, user_id, status, display_name FROM staff_profiles WHERE id = ?1`,
  )
    .bind(params.staffId)
    .first<{ id: string; user_id: string; status: string; display_name: string }>();
  if (!member) throw data(null, { status: 404 });

  const summaries = await loadSummaries(env);

  // ── Status change ────────────────────────────────────────────────────────
  if (intent === "set-status") {
    const actor = await requireStaff(request, env, "staff.write");
    const to = String(form.get("status") ?? "") as StaffStatus;
    const from = member.status as StaffStatus;

    const selfGuard = canActOnStaff(
      actor.userId,
      member.user_id,
      to === "archived" ? "archive" : to === "disabled" ? "disable" : "suspend",
    );
    if (!selfGuard.allowed) return { error: selfGuard.reason };

    if (!canChangeStatus(from, to)) {
      return { error: `Passaggio non consentito da "${from}" a "${to}".` };
    }

    const guard = guardLastSuperAdmin(summaries, {
      targetUserId: member.user_id,
      resultingStatus: to,
    });
    if (!guard.allowed) return { error: guard.reason };

    const usable = to === "active";

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE staff_profiles
            SET status = ?1, active = ?2, suspended_at = ?3, suspended_by = ?4,
                suspended_reason = ?5, archived_at = ?6, updated_at = ?7
          WHERE id = ?8`,
      ).bind(
        to,
        usable ? 1 : 0,
        to === "suspended" ? now : null,
        to === "suspended" ? actor.userId : null,
        to === "suspended" ? String(form.get("reason") ?? "").trim() || null : null,
        to === "archived" ? now : null,
        now,
        member.id,
      ),
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
         VALUES (?1,?2,?3,'staff.status','staff_profile',?4,?5,?6,?7)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        member.id,
        JSON.stringify({ status: from }),
        JSON.stringify({ status: to }),
        now,
      ),
    ];

    /**
     * Losing `active` revokes every session IMMEDIATELY.
     *
     * Otherwise a suspended colleague keeps working until their cookie expires,
     * which can be hours — and suspension is usually urgent.
     */
    if (!usable) {
      statements.push(
        env.DB.prepare(`DELETE FROM session WHERE user_id = ?1`).bind(member.user_id),
      );
    }

    await env.DB.batch(statements);
    return { success: `Stato aggiornato: ${to}. ${usable ? "" : "Sessioni chiuse."}` };
  }

  // ── Role change ──────────────────────────────────────────────────────────
  if (intent === "set-roles") {
    const actor = await requireStaff(request, env, "staff.roles");

    // Role changes are step-up gated, and the step-up is CONSUMED so it cannot
    // be reused for a second, unnoticed change.
    if (!(await consumeStepUp(env, actor.userId, "staff.roles", now))) {
      return { error: "Conferma la tua identità nella pagina Personale, poi riprova." };
    }

    const requestedIds = form.getAll("roleIds").map(String);

    const { results: roleRows } = await env.DB.prepare(
      `SELECT r.id, r.code,
              (SELECT GROUP_CONCAT(p.code) FROM role_permissions rp
                 JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id) AS permission_codes
         FROM roles r`,
    ).all<{ id: string; code: string; permission_codes: string | null }>();

    const byId = new Map(roleRows.map((r) => [r.id, r]));
    const resulting = requestedIds.map((id) => byId.get(id)?.code).filter(Boolean) as string[];

    // The actor must be able to grant every role being ADDED.
    const currentIds = new Set(
      (
        await env.DB.prepare(`SELECT role_id FROM user_roles WHERE user_id = ?1`)
          .bind(member.user_id)
          .all<{ role_id: string }>()
      ).results.map((r) => r.role_id),
    );

    for (const id of requestedIds) {
      if (currentIds.has(id)) continue;
      const role = byId.get(id);
      if (!role) return { error: "Ruolo non riconosciuto." };
      const guard = canGrantRole(actor, {
        code: role.code,
        permissions: (role.permission_codes?.split(",") ?? []) as Permission[],
      });
      if (!guard.allowed) return { error: guard.reason };
    }

    const guard = guardLastSuperAdmin(summaries, {
      targetUserId: member.user_id,
      resultingRoleCodes: resulting,
    });
    if (!guard.allowed) return { error: guard.reason };

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`DELETE FROM user_roles WHERE user_id = ?1`).bind(member.user_id),
    ];
    for (const id of requestedIds) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO user_roles (id, user_id, role_id, granted_by, granted_at)
           VALUES (?1,?2,?3,?4,?5)`,
        ).bind(cryptoIds.generate(), member.user_id, id, actor.userId, now),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'staff.roles','user',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        member.user_id,
        JSON.stringify({ roleCodes: resulting }),
        now,
      ),
      /**
       * Role removal takes effect immediately.
       *
       * Permissions are read fresh per request, so the change is live at once
       * — but revoking sessions also forces a clean re-authentication rather
       * than leaving a session that was established under the old role.
       */
      env.DB.prepare(`DELETE FROM session WHERE user_id = ?1`).bind(member.user_id),
    );

    await env.DB.batch(statements);
    return { success: "Ruoli aggiornati. Le sessioni della persona sono state chiuse." };
  }

  // ── Revoke sessions ──────────────────────────────────────────────────────
  if (intent === "revoke-sessions") {
    const actor = await requireStaff(request, env, "staff.write");
    const result = await env.DB.prepare(`DELETE FROM session WHERE user_id = ?1`)
      .bind(member.user_id)
      .run();

    await env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'auth.session_revoked','user',?4,?5,?6)`,
    )
      .bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        member.user_id,
        JSON.stringify({ scope: "by_admin", count: result.meta.changes }),
        now,
      )
      .run();

    return { success: `Chiuse ${result.meta.changes} sessioni.` };
  }

  return { error: "Azione non riconosciuta." };
}

export default function StaffDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    member,
    roles,
    history,
    allowedStatuses,
    canWrite,
    canManageRoles,
    stepUpActive,
    isSelf,
  } = loaderData;

  return (
    <div className="stack" style={{ maxWidth: "52rem" }}>
      <p className="small">
        <Link to="/admin/personale">← Personale</Link>
      </p>
      <h1>{member.display_name}</h1>
      <p className="small muted">
        {member.email} · {member.status} · {member.active_sessions} sessioni attive
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

      {!member.totpEnrolled ? (
        <p className="notice notice--warning small">
          Questa persona non ha attivato l&apos;autenticazione a due fattori. Se il suo ruolo la
          richiede, non può accedere alle sezioni operative finché non la attiva.
        </p>
      ) : null}

      <section className="panel stack">
        <h2>Stato</h2>
        {canWrite && allowedStatuses.length > 0 && !isSelf ? (
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="set-status" />
            <div className="field">
              <label className="field__label" htmlFor="status">
                Nuovo stato
              </label>
              <select id="status" name="status" className="input">
                {allowedStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="reason">
                Motivo (per la sospensione)
              </label>
              <input id="reason" name="reason" className="input" />
            </div>
            <button type="submit" className="btn btn--secondary">
              Aggiorna stato
            </button>
          </Form>
        ) : (
          <p className="small muted">
            {isSelf
              ? "Non puoi sospendere, disattivare o archiviare il tuo stesso account."
              : "Nessun cambio di stato disponibile."}
          </p>
        )}
      </section>

      <section className="panel stack">
        <h2>Ruoli</h2>
        {canManageRoles ? (
          stepUpActive ? (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="set-roles" />
              {roles.map((r) => (
                <label key={r.id} className="cluster">
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={r.id}
                    defaultChecked={r.assigned}
                    disabled={!r.grantable && !r.assigned}
                  />
                  <span>
                    {r.name_it} <code className="caption">{r.code}</code>
                    {!r.grantable && !r.assigned ? (
                      <span className="caption muted"> — non assegnabile da te</span>
                    ) : null}
                  </span>
                </label>
              ))}
              <button type="submit" className="btn btn--primary">
                Salva ruoli
              </button>
            </Form>
          ) : (
            <p className="small muted">
              Conferma la tua identità nella pagina <Link to="/admin/personale">Personale</Link> per
              modificare i ruoli.
            </p>
          )
        ) : (
          <ul className="small">
            {roles
              .filter((r) => r.assigned)
              .map((r) => (
                <li key={r.id}>{r.name_it}</li>
              ))}
          </ul>
        )}
      </section>

      <section className="panel stack">
        <h2>Sessioni</h2>
        <p className="small muted">{member.active_sessions} sessioni attive.</p>
        {canWrite ? (
          <Form method="post">
            <input type="hidden" name="intent" value="revoke-sessions" />
            <button type="submit" className="btn btn--secondary">
              Chiudi tutte le sessioni
            </button>
          </Form>
        ) : null}
      </section>

      {history.length > 0 ? (
        <section className="stack">
          <h2>Cronologia</h2>
          <ul className="small stack">
            {history.map((h, i) => (
              <li key={i}>
                <span className="muted">{formatDateTime(h.created_at, "it")}</span> · {h.action}
                {h.actor_label ? ` · ${h.actor_label}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
