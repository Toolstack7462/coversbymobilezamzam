import { Form } from "react-router";
import type { Route } from "./+types/payments";
import { cloudflareContext } from "../../../workers/app";
import {
  requireStaff,
  getSession,
  grantStepUp,
  hasStepUp,
} from "~/infrastructure/auth/session.server";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import { verifyPayment, VerifyPaymentInput } from "~/application/commands/verify-payment";

/**
 * The verification queue.
 *
 * Everything staff need to decide is on one screen: expected, claimed and
 * received amounts, the reference, the reservation expiry, and whether the
 * reference collides with another order.
 *
 * The screen does NOT decide anything. It surfaces facts; a human verifies
 * against the real bank account or merchant app (invariant 6).
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "payment.read");
  const now = systemClock.now();

  const { results } = await env.DB.prepare(
    `SELECT op.id, op.status, op.amount_expected, op.amount_claimed, op.amount_received,
            op.currency, op.transaction_reference, op.created_at,
            o.order_number, o.customer_first_name, o.customer_last_name,
            o.reservation_expires_at, o.status AS order_status,
            pm.name_it AS method_name,
            (SELECT COUNT(*) FROM payment_proofs pp WHERE pp.order_payment_id = op.id) AS proof_count,
            (SELECT COUNT(*) FROM order_payments d
              WHERE d.transaction_reference = op.transaction_reference
                AND d.transaction_reference IS NOT NULL
                AND d.id <> op.id) AS duplicate_count
       FROM order_payments op
       JOIN orders o ON o.id = op.order_id
       LEFT JOIN payment_methods pm ON pm.id = op.payment_method_id
      WHERE op.status IN ('awaiting_payment','proof_received','under_verification','partially_paid','overpaid')
      ORDER BY
        CASE op.status WHEN 'proof_received' THEN 0 WHEN 'under_verification' THEN 1 ELSE 2 END,
        o.reservation_expires_at ASC
      LIMIT 100`,
  ).all<{
    id: string;
    status: string;
    amount_expected: number;
    amount_claimed: number | null;
    amount_received: number | null;
    currency: string;
    transaction_reference: string | null;
    created_at: number;
    order_number: string;
    customer_first_name: string;
    customer_last_name: string;
    reservation_expires_at: number | null;
    order_status: string;
    method_name: string | null;
    proof_count: number;
    duplicate_count: number;
  }>();

  return {
    rows: results,
    canVerify: actor.permissions.includes("payment.verify"),
    // Drives whether the form asks for a password first.
    stepUpActive: actor.permissions.includes("payment.verify")
      ? await hasStepUp(env, actor.userId, "payment.verify", now)
      : false,
    now,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  // `payment.verify`, not `payment.read`. Reading the queue and acting on it
  // are different powers.
  const actor = await requireStaff(request, env, "payment.verify");

  // ── Step-up: re-authenticate for a short, purpose-scoped window ──────────
  if (intent === "step-up") {
    const password = String(form.get("password") ?? "");
    const auth = createAuth(env);

    try {
      const response = await auth.api.signInEmail({
        body: { email: actor.email, password },
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
      "payment.verify",
      now,
      cryptoIds.generate(),
    );
    return { stepUpGranted: true };
  }

  // ── Verification ─────────────────────────────────────────────────────────
  if (intent === "verify") {
    const rawAmount = String(form.get("amountReceived") ?? "").trim();

    const parsed = VerifyPaymentInput.safeParse({
      orderPaymentId: String(form.get("orderPaymentId") ?? ""),
      outcome: String(form.get("outcome") ?? ""),
      amountReceived: rawAmount === "" ? undefined : Number(rawAmount),
      transactionReference: String(form.get("transactionReference") ?? "").trim() || undefined,
      note: String(form.get("note") ?? "").trim() || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Dati non validi." };
    }

    const result = await verifyPayment(parsed.data, {
      env,
      clock: systemClock,
      ids: cryptoIds,
      actor,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "step_up_required":
          return { error: "Autenticazione aggiuntiva richiesta o scaduta. Inserisci la password." };
        case "amount_mismatch":
          return {
            error: `L'importo ricevuto (${formatMoney(result.received)}) non corrisponde a quello atteso (${formatMoney(result.expected)}). Registra un pagamento parziale o in eccesso.`,
          };
        case "invalid_transition":
          return { error: `Transizione non consentita da "${result.from}".` };
        case "not_found":
          return { error: "Pagamento non trovato." };
      }
    }

    return {
      success: `Pagamento aggiornato: ${result.to}.`,
      duplicateReference: result.duplicateReference,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminPayments({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, canVerify, stepUpActive, now } = loaderData;

  return (
    <div className="stack">
      <h1>Verifica pagamenti</h1>

      {/*
        The rule, stated on the screen where it applies. Staff are the control,
        so they should know they are the control.
      */}
      <p className="notice notice--info small">
        Verifica sempre sul conto bancario o nell&apos;app del servizio. Una schermata inviata dal
        cliente <strong>non</strong> è una prova di pagamento.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {actionData.success}
          {"duplicateReference" in actionData && actionData.duplicateReference
            ? " Attenzione: questo riferimento è già presente su un altro ordine."
            : ""}
        </p>
      ) : null}

      {!canVerify ? (
        <p className="notice notice--warning small">
          Puoi consultare la coda ma non verificare i pagamenti. Serve il permesso
          <code> payment.verify</code>.
        </p>
      ) : !stepUpActive ? (
        /* Step-up first. A live session is not enough for this action. */
        <section className="panel stack">
          <h2>Conferma la tua identità</h2>
          <p className="small muted">
            Per verificare un pagamento devi reinserire la password. La conferma vale 10 minuti e
            solo per questa operazione.
          </p>
          <Form method="post" className="cluster">
            <input type="hidden" name="intent" value="step-up" />
            <div className="field">
              <label className="field__label" htmlFor="stepup-password">
                Password
              </label>
              <input
                id="stepup-password"
                name="password"
                type="password"
                className="input"
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn--primary">
              Conferma
            </button>
          </Form>
        </section>
      ) : (
        <p className="notice notice--info small" role="status">
          Autenticazione confermata. Puoi verificare i pagamenti per i prossimi 10 minuti.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>Nessun pagamento in attesa di verifica.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Pagamenti in attesa di verifica</caption>
            <thead>
              <tr>
                <th scope="col">Ordine</th>
                <th scope="col">Cliente</th>
                <th scope="col">Metodo</th>
                <th scope="col">Atteso</th>
                <th scope="col">Riferimento</th>
                <th scope="col">Stato</th>
                <th scope="col">Scadenza</th>
                <th scope="col">Azione</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expiring =
                  row.reservation_expires_at !== null && row.reservation_expires_at < now;
                return (
                  <tr key={row.id}>
                    <td className="numeric">{row.order_number}</td>
                    <td>
                      {row.customer_first_name} {row.customer_last_name}
                    </td>
                    <td>{row.method_name ?? "—"}</td>
                    <td className="numeric">{formatMoney(money(row.amount_expected))}</td>
                    <td className="small">
                      {row.transaction_reference ?? <span className="muted">—</span>}
                      {row.duplicate_count > 0 ? (
                        /* FLAGGED, never auto-rejected: duplicates are often
                           legitimate, and blocking them would block real
                           payments. */
                        <span className="badge badge--warning"> riferimento duplicato</span>
                      ) : null}
                      {row.proof_count > 0 ? (
                        <span className="badge"> {row.proof_count} ricevuta</span>
                      ) : null}
                    </td>
                    <td className="small">{row.status}</td>
                    <td className="small">
                      {row.reservation_expires_at ? (
                        <span className={expiring ? "stock--low_stock" : undefined}>
                          {formatDateTime(row.reservation_expires_at, "it")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {canVerify && stepUpActive ? (
                        <details>
                          <summary className="btn btn--secondary">Verifica</summary>
                          <Form method="post" className="stack admin-verify-form">
                            <input type="hidden" name="intent" value="verify" />
                            <input type="hidden" name="orderPaymentId" value={row.id} />

                            <div className="field">
                              <label className="field__label" htmlFor={`outcome-${row.id}`}>
                                Esito
                              </label>
                              <select
                                id={`outcome-${row.id}`}
                                name="outcome"
                                className="input"
                                defaultValue="verified"
                              >
                                <option value="verified">Pagamento verificato</option>
                                <option value="partially_paid">Pagamento parziale</option>
                                <option value="overpaid">Pagamento in eccesso</option>
                                <option value="rejected">Non riscontrato</option>
                              </select>
                            </div>

                            <div className="field">
                              <label className="field__label" htmlFor={`amount-${row.id}`}>
                                Importo ricevuto (centesimi)
                              </label>
                              <input
                                id={`amount-${row.id}`}
                                name="amountReceived"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                className="input numeric"
                                defaultValue={row.amount_expected}
                              />
                              <span className="field__hint">
                                {formatMoney(money(row.amount_expected))} attesi
                              </span>
                            </div>

                            <div className="field">
                              <label className="field__label" htmlFor={`ref-${row.id}`}>
                                Riferimento operazione
                              </label>
                              <input
                                id={`ref-${row.id}`}
                                name="transactionReference"
                                className="input"
                                defaultValue={row.transaction_reference ?? ""}
                              />
                            </div>

                            <div className="field">
                              <label className="field__label" htmlFor={`note-${row.id}`}>
                                Nota
                              </label>
                              <input id={`note-${row.id}`} name="note" className="input" />
                              <span className="field__hint">
                                Obbligatoria se non inserisci un riferimento.
                              </span>
                            </div>

                            <button type="submit" className="btn btn--primary">
                              Registra esito
                            </button>
                          </Form>
                        </details>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
