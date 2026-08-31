import { Form, useLocation } from "react-router";
import type { Route } from "./+types/discounts";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Discount codes.
 *
 * **This screen will not let the shop announce a saving it cannot evidence.**
 *
 * Italian law (D.Lgs. 84/2022, implementing the Omnibus directive) requires
 * that an announced price reduction be measured against the LOWEST price
 * charged in the previous thirty days — not against a list price, and not
 * against whatever the product cost yesterday. A shop that raises a price for a
 * week and then "discounts" it back is committing a specific offence, and it is
 * an easy one to commit by accident.
 *
 * So the code stored here is a code, and the storefront's percentage claim is
 * computed from `price_history` rather than from this table. This screen says
 * so, in the merchant's language, on the screen where the temptation arises.
 *
 * A coupon reduces the ORDER. A promotion reduces a PRODUCT'S displayed price
 * and is therefore the one that triggers the prior-price rule; only coupons are
 * managed here for that reason, and the difference is stated rather than
 * assumed.
 */

export function meta() {
  return [{ title: "Sconti" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "price.read");
  const now = systemClock.now();

  const coupons = await env.DB.prepare(
    `SELECT c.id, c.code, c.discount_type, c.discount_value, c.usage_limit, c.usage_count,
            c.per_customer_limit, c.starts_at, c.ends_at, c.min_order_amount, c.active,
            (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS redemptions
       FROM coupons c ORDER BY c.active DESC, c.starts_at DESC`,
  ).all<{
    id: string;
    code: string;
    discount_type: string;
    discount_value: number;
    usage_limit: number | null;
    usage_count: number;
    per_customer_limit: number | null;
    starts_at: number;
    ends_at: number | null;
    min_order_amount: number | null;
    active: number;
    redemptions: number;
  }>();

  return {
    coupons: coupons.results,
    now,
    canWrite: actor.permissions.includes("price.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "price.write");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  const audit = (action: string, entityId: string, after: unknown) =>
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,?4,'coupon',?5,?6,?7)`,
    ).bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      action,
      entityId,
      JSON.stringify(after),
      now,
    );

  if (intent === "create") {
    const code = String(form.get("code") ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const type = String(form.get("discountType") ?? "");
    const rawValue = String(form.get("discountValue") ?? "").trim();
    const rawMinOrder = String(form.get("minOrderAmount") ?? "").trim();
    const usageLimit = form.get("usageLimit") ? Number(form.get("usageLimit")) : null;
    const perCustomer = form.get("perCustomerLimit") ? Number(form.get("perCustomerLimit")) : null;
    const endsAtRaw = String(form.get("endsAt") ?? "").trim();

    if (code.length < 3) return { error: "Il codice deve avere almeno 3 caratteri." };
    if (!["percentage", "fixed"].includes(type)) return { error: "Tipo di sconto non valido." };

    let value: number;
    if (type === "percentage") {
      value = Number(rawValue);
      if (!Number.isInteger(value) || value < 1 || value > 90) {
        // 90 rather than 100: a coupon that makes an order free is almost
        // always a typo, and the ones that are not can be entered as a fixed
        // amount, deliberately.
        return { error: "La percentuale deve essere un numero intero fra 1 e 90." };
      }
    } else {
      try {
        value = parseAmountToMinorUnits(rawValue);
      } catch {
        return { error: `Importo non leggibile: "${rawValue}". Usa la forma 5,00.` };
      }
      if (value <= 0) return { error: "Lo sconto deve essere maggiore di zero." };
    }

    let minOrder: number | null = null;
    if (rawMinOrder !== "") {
      try {
        minOrder = parseAmountToMinorUnits(rawMinOrder);
      } catch {
        return { error: `Importo minimo non leggibile: "${rawMinOrder}".` };
      }
    }

    // A fixed discount larger than the minimum order lets an order end at zero
    // or below. The totals code clamps it, but a coupon that can only ever be
    // used at a loss is a mistake worth catching before it is handed out.
    if (type === "fixed" && minOrder !== null && value >= minOrder) {
      return {
        error:
          "Lo sconto fisso è maggiore o uguale all'ordine minimo: il cliente pagherebbe zero. Alza l'ordine minimo o abbassa lo sconto.",
      };
    }

    const existing = await env.DB.prepare(`SELECT id FROM coupons WHERE code = ?1`)
      .bind(code)
      .first<{ id: string }>();
    if (existing) return { error: `Il codice ${code} esiste già.` };

    const endsAt = endsAtRaw === "" ? null : Date.parse(`${endsAtRaw}T23:59:59Z`);
    if (endsAt !== null && Number.isNaN(endsAt)) return { error: "Data di scadenza non valida." };
    if (endsAt !== null && endsAt < now) {
      return { error: "La data di scadenza è già passata." };
    }

    const id = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO coupons
           (id, code, discount_type, discount_value, usage_limit, usage_count,
            per_customer_limit, starts_at, ends_at, min_order_amount, active, sort_order,
            created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,0,?6,?7,?8,?9,1,0,?7,?7)`,
      ).bind(id, code, type, value, usageLimit, perCustomer, now, endsAt, minOrder),
      audit("coupon.create", id, { code, type, value, endsAt, minOrder }),
    ]);

    return { success: `Codice ${code} creato.` };
  }

  if (intent === "toggle") {
    const id = String(form.get("id") ?? "");
    const row = await env.DB.prepare(`SELECT active, code FROM coupons WHERE id = ?1`)
      .bind(id)
      .first<{ active: number; code: string }>();
    if (!row) return { error: "Codice non trovato." };

    const next = row.active === 1 ? 0 : 1;
    await env.DB.batch([
      env.DB.prepare(`UPDATE coupons SET active = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        next,
        now,
        id,
      ),
      audit("coupon.active", id, { active: next === 1 }),
    ]);

    // Never deleted: redemptions reference it, and a past order must keep
    // saying which code was applied to it.
    return {
      success:
        next === 1
          ? `${row.code} è di nuovo utilizzabile.`
          : `${row.code} non è più utilizzabile. Gli ordini che lo hanno usato restano invariati.`,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function Discounts({ loaderData, actionData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { coupons, now, canWrite } = loaderData;

  return (
    <>
      <PageHeader
        title="Sconti"
        description="Codici sconto applicati al totale dell'ordine."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

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

      <p className="notice notice--warning">
        <strong>Sconto sull&apos;ordine, non sul prezzo del prodotto.</strong> Un codice qui riduce
        il totale in cassa e non cambia il prezzo esposto sul sito. Per ridurre il prezzo di un
        prodotto si modifica il prezzo dalla sua scheda: il sito può annunciare una percentuale di
        sconto <em>solo</em> se lo storico dei prezzi la dimostra, perché per legge lo sconto si
        calcola sul prezzo più basso praticato negli ultimi 30 giorni (D.Lgs. 84/2022). Alzare un
        prezzo per poi &ldquo;scontarlo&rdquo; è un illecito, ed è un errore facile da commettere
        senza accorgersene.
      </p>

      <section className="panel stack">
        <h2>Codici attivi</h2>

        {coupons.length === 0 ? (
          <div className="empty-state">
            <p>
              <strong>Nessun codice sconto</strong>
            </p>
            <p className="small muted">
              Non servono per vendere. Si creano quando servono davvero — un volantino, un cliente
              da recuperare.
            </p>
          </div>
        ) : (
          <div
            className="ac-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tabella scorrevole"
          >
            <table className="ac-table">
              <caption className="visually-hidden">Codici sconto</caption>
              <thead>
                <tr>
                  <th scope="col">Codice</th>
                  <th scope="col">Sconto</th>
                  <th scope="col" className="ac-table__numeric">
                    Usato
                  </th>
                  <th scope="col">Validità</th>
                  <th scope="col">Stato</th>
                  {canWrite ? <th scope="col">Azione</th> : null}
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const expired = coupon.ends_at !== null && coupon.ends_at < now;
                  const exhausted =
                    coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit;

                  return (
                    <tr key={coupon.id}>
                      <td data-label="Codice" className="numeric">
                        {coupon.code}
                      </td>
                      <td data-label="Sconto">
                        {coupon.discount_type === "percentage"
                          ? `${coupon.discount_value}%`
                          : formatMoney(money(coupon.discount_value))}
                        {coupon.min_order_amount !== null ? (
                          <>
                            <br />
                            <span className="caption muted">
                              da {formatMoney(money(coupon.min_order_amount))}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Usato" className="ac-table__numeric numeric">
                        {coupon.usage_count}
                        {coupon.usage_limit !== null ? ` / ${coupon.usage_limit}` : ""}
                      </td>
                      <td data-label="Validità" className="small">
                        {coupon.ends_at === null
                          ? "senza scadenza"
                          : `fino al ${formatDateTime(coupon.ends_at, "it")}`}
                      </td>
                      <td data-label="Stato">
                        {coupon.active === 0 ? (
                          <span className="badge badge--muted">disattivato</span>
                        ) : expired ? (
                          <span className="badge badge--warning">scaduto</span>
                        ) : exhausted ? (
                          <span className="badge badge--warning">esaurito</span>
                        ) : (
                          <span className="badge badge--success">attivo</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td data-label="Azione">
                          <Form method="post">
                            <input type="hidden" name="intent" value="toggle" />
                            <input type="hidden" name="id" value={coupon.id} />
                            <button type="submit" className="btn btn--ghost btn--small">
                              {coupon.active === 1 ? "Disattiva" : "Riattiva"}
                            </button>
                          </Form>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="caption muted">
          I codici non si eliminano: gli ordini che li hanno usati devono continuare a dire quale
          sconto è stato applicato.
        </p>
      </section>

      {canWrite ? (
        <section className="panel stack">
          <h2>Nuovo codice</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="create" />

            <div className="field">
              <label className="field__label" htmlFor="code">
                Codice
              </label>
              <input
                id="code"
                name="code"
                className="input numeric"
                required
                maxLength={32}
                placeholder="BENVENUTO10"
                aria-describedby="code-help"
              />
              <span className="field__hint" id="code-help">
                Quello che il cliente digita in cassa. Salvato in maiuscolo e senza spazi, così
                &ldquo;benvenuto10&rdquo; e &ldquo;BENVENUTO 10&rdquo; funzionano entrambi.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="discountType">
                Tipo di sconto
              </label>
              <select id="discountType" name="discountType" className="input" defaultValue="fixed">
                <option value="fixed">Importo fisso (es. 5,00 €)</option>
                <option value="percentage">Percentuale sull&apos;ordine</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="discountValue">
                Valore
              </label>
              <input
                id="discountValue"
                name="discountValue"
                className="input"
                required
                aria-describedby="value-help"
              />
              <span className="field__hint" id="value-help">
                Per un importo fisso scrivete <code>5,00</code>. Per una percentuale scrivete solo
                il numero, da 1 a 90.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="minOrderAmount">
                Ordine minimo
              </label>
              <input
                id="minOrderAmount"
                name="minOrderAmount"
                className="input"
                placeholder="25,00"
              />
              <span className="field__hint">
                Facoltativo. Sotto questa cifra il codice non si applica.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="usageLimit">
                Quante volte in tutto
              </label>
              <input
                id="usageLimit"
                name="usageLimit"
                className="input"
                type="number"
                min={1}
                placeholder="100"
              />
              <span className="field__hint">
                Facoltativo. Lasciate vuoto per un codice senza limite.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="perCustomerLimit">
                Quante volte per cliente
              </label>
              <input
                id="perCustomerLimit"
                name="perCustomerLimit"
                className="input"
                type="number"
                min={1}
                placeholder="1"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="endsAt">
                Scadenza
              </label>
              <input id="endsAt" name="endsAt" className="input" type="date" />
              <span className="field__hint">
                Facoltativa, ma consigliata: un codice senza scadenza gira per anni.
              </span>
            </div>

            <button type="submit" className="btn btn--primary">
              Crea codice
            </button>
          </Form>
        </section>
      ) : null}
    </>
  );
}
