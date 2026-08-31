import { Link } from "react-router";
import type { Route } from "./+types/security";
import { cloudflareContext } from "../../../workers/app";
import {
  requireStaff,
  requiresTwoFactor,
  hasVerifiedTwoFactor,
  TOTP_REQUIRED_PERMISSIONS,
} from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";

/** Security hub for the signed-in staff member's own account. */
export function meta() {
  return [{ title: "Sicurezza" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  const sessions = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM session WHERE user_id = ?1 AND expires_at > ?2`,
  )
    .bind(actor.userId, systemClock.now())
    .first<{ n: number }>();

  return {
    displayName: actor.displayName,
    email: actor.email,
    roleCodes: actor.roleCodes,
    enrolled: await hasVerifiedTwoFactor(env, actor.userId),
    mandatory: requiresTwoFactor(actor),
    // Which of the actor's permissions triggered the requirement - so the
    // answer to "why must I do this?" is on the page rather than in a doc.
    triggeringPermissions: TOTP_REQUIRED_PERMISSIONS.filter((p) => actor.permissions.includes(p)),
    activeSessions: sessions?.n ?? 0,
  };
}

export default function Security({ loaderData }: Route.ComponentProps) {
  const d = loaderData;

  return (
    <div className="stack" style={{ maxWidth: "42rem" }}>
      <h1>Sicurezza</h1>
      <p className="small muted">
        {d.displayName} · {d.email} · {d.roleCodes.join(", ")}
      </p>

      <section className="panel stack">
        <h2>Autenticazione a due fattori</h2>
        <p>
          {d.enrolled ? (
            <span className="stock--in_stock">Attiva</span>
          ) : (
            <span className="stock--low_stock">Non attiva</span>
          )}
          {d.mandatory ? <span className="badge badge--warning"> obbligatoria</span> : null}
        </p>

        {d.mandatory && d.triggeringPermissions.length > 0 ? (
          <p className="small muted">
            Richiesta perché il tuo account ha: <code>{d.triggeringPermissions.join(", ")}</code>
          </p>
        ) : null}

        <p className="cluster">
          <Link className="btn btn--primary" to="/admin/sicurezza/2fa">
            {d.enrolled ? "Gestisci" : "Attiva"}
          </Link>
          {d.enrolled ? (
            <Link className="btn btn--secondary" to="/admin/sicurezza/codici-recupero">
              Codici di recupero
            </Link>
          ) : null}
        </p>
      </section>

      <section className="panel stack">
        <h2>Sessioni</h2>
        <p className="small">
          {d.activeSessions} {d.activeSessions === 1 ? "sessione attiva" : "sessioni attive"}
        </p>
        <p>
          <Link className="btn btn--secondary" to="/admin/sicurezza/sessioni">
            Gestisci sessioni
          </Link>
        </p>
      </section>
    </div>
  );
}
