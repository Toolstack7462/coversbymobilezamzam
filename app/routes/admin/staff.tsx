import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Form, Link } from "react-router";
import type { Route } from "./+types/staff";
import { PasswordField } from "~/components/admin/password-field";
import { appContext } from "~/runtime/context";
import { createAuth } from "~/infrastructure/auth/auth.server";
import {
  requireStaff,
  hasStepUp,
  grantStepUp,
  getSession,
} from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import {
  createInvitation,
  CreateInvitationInput,
  revokeInvitation,
} from "~/application/commands/staff-invitations";
import { activeSuperAdmins, type StaffSummary } from "~/domain/users/staff-guards";
import { StatusBadge } from "~/components/admin/status-badge";

/**
 * Staff list and invitations.
 *
 * There is no "create staff" form. A colleague is invited and sets their own
 * password: an administrator typing it means an administrator briefly knows a
 * colleague's credentials.
 */

export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Personale") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env, "staff.read");
  const now = systemClock.now();

  const [staffRows, invitations, roles] = await Promise.all([
    env.DB.prepare(
      `SELECT sp.id, sp.user_id, sp.display_name, sp.status, sp.job_title, sp.last_login_at,
              u.email, u.two_factor_enabled,
              (SELECT GROUP_CONCAT(r.code) FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = sp.user_id) AS role_codes,
              (SELECT COUNT(*) FROM two_factor tf WHERE tf.user_id = sp.user_id AND tf.verified = 1) AS totp_verified,
              (SELECT COUNT(*) FROM session s WHERE s.user_id = sp.user_id AND s.expires_at > ?1) AS active_sessions
         FROM staff_profiles sp
         JOIN user u ON u.id = sp.user_id
        WHERE sp.archived_at IS NULL
        ORDER BY sp.display_name`,
    )
      .bind(now)
      .all<{
        id: string;
        user_id: string;
        display_name: string;
        status: string;
        job_title: string | null;
        last_login_at: number | null;
        email: string;
        two_factor_enabled: number;
        role_codes: string | null;
        totp_verified: number;
        active_sessions: number;
      }>(),

    env.DB.prepare(
      `SELECT i.id, i.email, i.status, i.expires_at, i.created_at, u.name AS invited_by_name
         FROM staff_invitations i
         LEFT JOIN user u ON u.id = i.invited_by
        WHERE i.status = 'pending'
        ORDER BY i.created_at DESC`,
    ).all<{
      id: string;
      email: string;
      status: string;
      expires_at: number;
      created_at: number;
      invited_by_name: string | null;
    }>(),

    env.DB.prepare(`SELECT id, code, name_it FROM roles ORDER BY sort_order`).all<{
      id: string;
      code: string;
      name_it: string;
    }>(),
  ]);

  const summaries: StaffSummary[] = staffRows.results.map((s) => ({
    userId: s.user_id,
    status: s.status as StaffSummary["status"],
    roleCodes: s.role_codes?.split(",") ?? [],
  }));

  return {
    staff: staffRows.results.map((s) => ({
      ...s,
      roleCodes: s.role_codes?.split(",") ?? [],
      // An unenrolled privileged account is a live risk, so it is surfaced in
      // the list rather than hidden on a detail page.
      totpEnrolled: s.totp_verified > 0,
    })),
    invitations: invitations.results,
    roles: roles.results,
    canWrite: actor.permissions.includes("staff.write"),
    canManageRoles: actor.permissions.includes("staff.roles"),
    hasStepUp: await hasStepUp(env, actor.userId, "staff.roles", now),
    activeSuperAdminCount: activeSuperAdmins(summaries).length,
    now,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "invite") {
    // Inviting is granting access, so it needs role-management permission AND
    // a fresh step-up - the same bar as changing a role, because it is one.
    const actor = await requireStaff(request, env, "staff.roles");

    if (!(await hasStepUp(env, actor.userId, "staff.roles", now))) {
      return { error: "Conferma prima la tua identità qui sotto." };
    }

    const parsed = CreateInvitationInput.safeParse({
      email: String(form.get("email") ?? ""),
      roleIds: form.getAll("roleIds").map(String),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Dati non validi." };
    }

    const result = await createInvitation(parsed.data, {
      env,
      clock: systemClock,
      ids: cryptoIds,
      actor,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        already_staff: "Questa persona fa già parte del personale.",
        already_invited: "Esiste già un invito attivo per questo indirizzo.",
        unknown_role: "Ruolo non riconosciuto.",
        role_not_grantable: "detail" in result ? result.detail : "Ruolo non assegnabile.",
      };
      return { error: messages[result.reason] ?? "Invito non riuscito." };
    }

    /**
     * The link is returned ONCE, for the inviter to copy.
     *
     * No email provider is configured, so there is nowhere to send it. Showing
     * it once and never again is the honest alternative to storing a usable
     * token — which is exactly what the hash exists to avoid.
     */
    return {
      invitationUrl: `/admin/personale/invito/${result.token}`,
      invitationEmail: parsed.data.email,
      expiresAt: result.expiresAt,
    };
  }

  if (intent === "revoke-invitation") {
    const actor = await requireStaff(request, env, "staff.roles");
    const ok = await revokeInvitation(String(form.get("invitationId") ?? ""), {
      env,
      clock: systemClock,
      ids: cryptoIds,
      actor,
    });
    return ok ? { success: "Invito revocato." } : { error: "Invito non trovato o già usato." };
  }

  if (intent === "step-up") {
    const actor = await requireStaff(request, env, "staff.roles");
    const auth = createAuth(env);
    try {
      const response = await auth.api.signInEmail({
        body: { email: actor.email, password: String(form.get("password") ?? "") },
        headers: request.headers,
        asResponse: true,
      });
      if (!response.ok) return { error: "Password non corretta." };
    } catch {
      return { error: "Password non corretta." };
    }
    const session = await getSession(request, env);
    await grantStepUp(
      env,
      actor.userId,
      session?.session?.id ?? "unknown",
      "staff.roles",
      now,
      cryptoIds.generate(),
    );
    return { success: "Identità confermata." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminStaff({ loaderData, actionData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { staff, invitations, roles, canManageRoles, hasStepUp, activeSuperAdminCount, now } =
    loaderData;

  const invitationUrl =
    actionData && "invitationUrl" in actionData ? actionData.invitationUrl : null;

  return (
    <div className="stack">
      <h1>{t("Personale")}</h1>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {t(actionData.error)}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {t(actionData.success)}
        </p>
      ) : null}

      {activeSuperAdminCount === 1 ? (
        <p className="notice notice--warning small">
          {t(
            "C'è un solo amministratore attivo. Se perde l'accesso, nessuno può più entrare nell'area amministrativa. Invitane un secondo.",
          )}
        </p>
      ) : null}

      {invitationUrl ? (
        <section className="panel stack">
          <h2>{t("Invito creato")}</h2>
          <p className="notice notice--warning">
            <strong>{t("Copia questo link adesso.")}</strong>{" "}
            {t(
              " Non verrà mostrato di nuovo: nel database è salvato solo un hash, quindi non è recuperabile. Trattalo come una password.",
            )}
          </p>
          <p className="numeric" style={{ wordBreak: "break-all" }}>
            <code>{invitationUrl}</code>
          </p>
          <p className="small muted">
            {t("Per ")}
            {actionData && "invitationEmail" in actionData ? actionData.invitationEmail : ""}{" "}
            {t(" · scade il")}{" "}
            {actionData && "expiresAt" in actionData
              ? formatDateTime(actionData.expiresAt, t.locale)
              : ""}
          </p>
        </section>
      ) : null}

      <div
        className="admin-table-wrap"
        /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
        tabIndex={0}
        role="region"
        aria-label={t("Tabella scorrevole")}
      >
        <table className="admin-table">
          <caption className="visually-hidden">{t("Personale")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Nome")}</th>
              <th scope="col">Email</th>
              <th scope="col">{t("Ruoli")}</th>
              <th scope="col">{t("Stato")}</th>
              <th scope="col">2FA</th>
              <th scope="col">{t("Sessioni")}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.display_name}</td>
                <td className="small">{s.email}</td>
                <td className="small">{s.roleCodes.join(", ") || "—"}</td>
                <td>
                  <StatusBadge kind="staff" value={s.status} />
                </td>
                <td className="small">
                  {s.totpEnrolled ? (
                    <span className="stock--in_stock">{t("attiva")}</span>
                  ) : (
                    <span className="stock--low_stock">{t("non attiva")}</span>
                  )}
                </td>
                <td className="numeric">{s.active_sessions}</td>
                <td>
                  <Link className="btn btn--ghost" to={`/admin/personale/${s.id}`}>
                    {t("Gestisci")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManageRoles ? (
        <section className="panel stack">
          <h2>{t("Invita una persona")}</h2>

          {!hasStepUp ? (
            <Form method="post" className="cluster">
              <input type="hidden" name="intent" value="step-up" />
              <PasswordField
                id="stepup"
                name="password"
                label={t("Conferma la password per gestire il personale")}
                autoComplete="current-password"
                required
              />
              <button type="submit" className="btn btn--primary">
                {t("Conferma")}
              </button>
            </Form>
          ) : (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="invite" />
              <div className="field">
                <label className="field__label" htmlFor="email">
                  Email
                </label>
                <input id="email" name="email" type="email" className="input" required />
                <span className="field__hint">
                  {t("L'invito vale solo per questo indirizzo e scade dopo 7 giorni.")}
                </span>
              </div>

              <fieldset className="stack">
                <legend className="field__label">{t("Ruoli")}</legend>
                {roles.map((role) => (
                  <label key={role.id} className="cluster">
                    <input type="checkbox" name="roleIds" value={role.id} />
                    <span>
                      {role.name_it} <code className="caption">{role.code}</code>
                    </span>
                  </label>
                ))}
                <span className="field__hint">
                  {t("Puoi assegnare solo ruoli i cui permessi possiedi già.")}
                </span>
              </fieldset>

              <button type="submit" className="btn btn--primary">
                {t("Crea invito")}
              </button>
            </Form>
          )}
        </section>
      ) : null}

      {invitations.length > 0 ? (
        <section className="stack">
          <h2>{t("Inviti in sospeso")}</h2>
          <div
            className="admin-table-wrap"
            /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
            tabIndex={0}
            role="region"
            aria-label={t("Tabella scorrevole")}
          >
            <table className="admin-table">
              <caption className="visually-hidden">{t("Inviti in sospeso")}</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">{t("Invitato da")}</th>
                  <th scope="col">{t("Scade")}</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td className="small">{i.email}</td>
                    <td className="small">{i.invited_by_name ?? "—"}</td>
                    <td className="small">
                      {i.expires_at < now ? (
                        <span className="stock--low_stock">{t("scaduto")}</span>
                      ) : (
                        formatDateTime(i.expires_at, t.locale)
                      )}
                    </td>
                    <td>
                      {canManageRoles ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="revoke-invitation" />
                          <input type="hidden" name="invitationId" value={i.id} />
                          <button type="submit" className="btn btn--ghost">
                            {t("Revoca")}
                          </button>
                        </Form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
