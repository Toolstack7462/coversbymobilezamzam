import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Form, Link } from "react-router";
import type { Route } from "./+types/promotions";
import { appContext } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Promotions.
 *
 * ── The difference from discount codes ───────────────────────────────────────
 *
 * A coupon is something the customer types. A promotion applies on its own to
 * whatever it covers, for as long as it runs. They are separate tables and
 * separate screens because they are separate decisions: "20% off cases this
 * week" is merchandising, "SUMMER10 for the newsletter" is a campaign.
 *
 * ── Why a promotion is never edited in place ─────────────────────────────────
 *
 * Changing the percentage on a running promotion rewrites what buyers an hour
 * ago were offered, and there is no record afterwards that it was ever
 * different. So a running promotion can be ENDED, and a new one started. That
 * is one more click and it keeps a truthful history of what the shop actually
 * offered and when — which is the same reason price_history exists.
 *
 * ── Price integrity ──────────────────────────────────────────────────────────
 *
 * This screen shows a discount but never claims a "was" price. Italian law
 * (D.Lgs. 84/2022) requires a percentage claim to reference the lowest price of
 * the previous 30 days, which lives in price_history, and inventing that
 * reference is exactly the kind of number nobody can later defend.
 */
export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Promozioni") }, { name: "robots", content: "noindex, nofollow" }];
}

const DISCOUNT_TYPES = [
  ["percentage", "Percentuale"],
  ["fixed_amount", "Importo fisso"],
] as const;

const CHANNELS = [
  ["online", "Solo online"],
  ["in_store", "Solo in negozio"],
  ["all", "Ovunque"],
] as const;

/** A promotion's real state, which is not the same as its `active` column. */
function stateOf(
  row: { active: number; starts_at: number | null; ends_at: number | null },
  now: number,
) {
  if (!row.active) return "disattivata";
  if (row.starts_at !== null && row.starts_at > now) return "programmata";
  if (row.ends_at !== null && row.ends_at < now) return "conclusa";
  return "in corso";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env, "price.read");
  const now = systemClock.now();

  const promotions = await env.DB.prepare(
    `SELECT p.id, p.code, p.name, p.discount_type, p.discount_value, p.channel,
            p.starts_at, p.ends_at, p.priority, p.stackable, p.min_quantity,
            p.min_order_amount, p.active, p.created_at,
            (SELECT COUNT(*) FROM promotion_products pp WHERE pp.promotion_id = p.id) AS products
       FROM promotions p
      WHERE p.archived_at IS NULL
      ORDER BY p.active DESC, p.starts_at DESC, p.created_at DESC
      LIMIT 100`,
  ).all<{
    id: string;
    code: string | null;
    name: string;
    discount_type: string;
    discount_value: number;
    channel: string;
    starts_at: number | null;
    ends_at: number | null;
    priority: number;
    stackable: number;
    min_quantity: number | null;
    min_order_amount: number | null;
    active: number;
    created_at: number;
    products: number;
  }>();

  const categories = await env.DB.prepare(
    `SELECT c.slug, COALESCE(ct.name, c.slug) AS name,
            (SELECT COUNT(*) FROM products p
              WHERE p.primary_category_id = c.id AND p.status = 'active') AS products
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
      WHERE c.visible = 1 AND c.archived_at IS NULL
      ORDER BY c.sort_order`,
  ).all<{ slug: string; name: string; products: number }>();

  return {
    promotions: promotions.results,
    categories: categories.results,
    canWrite: actor.permissions.includes("price.write"),
    now,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "create") {
    await requireStaff(request, env, "price.write");

    const name = String(form.get("name") ?? "").trim();
    const type = String(form.get("discount_type") ?? "");
    const channel = String(form.get("channel") ?? "online");
    const categorySlug = String(form.get("category") ?? "").trim();
    const rawValue = String(form.get("discount_value") ?? "").trim();
    const starts = String(form.get("starts_at") ?? "").trim();
    const ends = String(form.get("ends_at") ?? "").trim();

    if (name === "") return { error: "Il nome è obbligatorio." };
    if (!DISCOUNT_TYPES.some(([v]) => v === type)) return { error: "Tipo di sconto non valido." };
    if (!CHANNELS.some(([v]) => v === channel)) return { error: "Canale non valido." };

    const value = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      return { error: "Il valore dello sconto deve essere maggiore di zero." };
    }
    if (type === "percentage" && value > 90) {
      // Not a hard limit anywhere in the schema, but a 95% promotion is almost
      // always a typo for 9.5%, and it would be discovered by selling the stock.
      return { error: "Uno sconto oltre il 90% è quasi sempre un errore di battitura." };
    }

    /*
     * Stored as an integer either way: a percentage becomes basis points, an
     * amount becomes cents, and both are the entered number times a hundred.
     * `discount_type` is what says which of the two it is.
     *
     * Integers throughout because a float percentage is how 19.99 turns into
     * 19.989999999999998 three operations later.
     */
    const storedValue = Math.round(value * 100);

    const startsAt = starts ? Date.parse(`${starts}T00:00:00Z`) : now;
    const endsAt = ends ? Date.parse(`${ends}T23:59:59Z`) : null;
    if (endsAt !== null && Number.isNaN(endsAt)) return { error: "Data di fine non valida." };
    if (Number.isNaN(startsAt)) return { error: "Data di inizio non valida." };
    if (endsAt !== null && endsAt <= startsAt) {
      return { error: "La data di fine deve essere successiva a quella di inizio." };
    }

    const promotionId = cryptoIds.generate();
    const statements = [
      env.DB.prepare(
        `INSERT INTO promotions
           (id, code, name, discount_type, discount_value, channel, starts_at, ends_at,
            priority, stackable, active, created_at, updated_at)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 1, ?8, ?8)`,
      ).bind(promotionId, name, type, storedValue, channel, startsAt, endsAt, now),
    ];

    if (categorySlug) {
      // Membership is resolved to the products that are in the category NOW.
      // A promotion that silently picked up products added next week would
      // discount stock nobody decided to discount.
      statements.push(
        env.DB.prepare(
          `INSERT INTO promotion_products (id, promotion_id, product_id, variant_id)
           SELECT lower(hex(randomblob(16))), ?1, p.id, NULL
             FROM products p
             JOIN categories c ON c.id = p.primary_category_id
            WHERE c.slug = ?2 AND p.status = 'active' AND p.archived_at IS NULL`,
        ).bind(promotionId, categorySlug),
      );
    }

    await env.DB.batch(statements);
    return {
      success: categorySlug
        ? `Promozione "${name}" creata sui prodotti attualmente in questa categoria.`
        : `Promozione "${name}" creata. Non copre ancora nessun prodotto.`,
    };
  }

  if (intent === "end") {
    await requireStaff(request, env, "price.write");
    const id = String(form.get("promotionId") ?? "");

    // Ended, not deleted and not edited: what the shop offered, and until when,
    // stays answerable.
    await env.DB.prepare(
      `UPDATE promotions SET active = 0, ends_at = ?2, updated_at = ?2 WHERE id = ?1`,
    )
      .bind(id, now)
      .run();

    return { success: "Promozione conclusa. Resta nello storico." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminPromotions({ loaderData, actionData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { promotions, categories, canWrite, now } = loaderData;
  const running = promotions.filter((p) => stateOf(p, now) === "in corso").length;

  return (
    <>
      <PageHeader title={t("Promozioni")} breadcrumbs={breadcrumbsFor("/admin/promozioni")} />

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

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">{t("In corso adesso")}</span>
            <span className="ac-metric__value numeric">{running}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">{t("Totali")}</span>
            <span className="ac-metric__value numeric">{promotions.length}</span>
          </div>
        </div>
        <p className="small">
          {t(
            "Una promozione si applica da sola a quello che copre. Un codice sconto invece lo digita il cliente: quelli stanno in ",
          )}
          <Link to="/admin/sconti">{t("Sconti")}</Link>.
        </p>
        <p className="small">
          {t(
            "Una promozione in corso non si modifica: si conclude e se ne fa un'altra. Cambiare la percentuale sotto ai piedi di chi ha comprato un'ora fa riscrive quello che gli era stato offerto, e dopo non resta traccia di com'era.",
          )}
        </p>
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>{t("Nuova promozione")}</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="create" />
            <label>
              {t("Nome")}
              <input
                name="name"
                required
                maxLength={80}
                placeholder={t("Cover -20% settimana corta")}
              />
              <span className="field-help">{t("Lo vedi solo tu, serve a riconoscerla.")}</span>
            </label>
            <label>
              {t("Tipo")}
              <select name="discount_type" defaultValue="percentage">
                {DISCOUNT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Valore")}
              <input name="discount_value" required inputMode="decimal" placeholder="20" />
              <span className="field-help">
                {t("Percentuale (20 = 20%) oppure euro (5 = 5,00 €), secondo il tipo scelto.")}
              </span>
            </label>
            <label>
              {t("Categoria")}
              <select name="category" defaultValue="">
                <option value="">{t("Nessuna — la imposti dopo")}</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name} ({c.products})
                  </option>
                ))}
              </select>
              <span className="field-help">
                {t(
                  "Copre i prodotti che sono in questa categoria adesso. I prodotti aggiunti domani non entrano da soli — uno sconto che si allarga da solo non lo ha deciso nessuno.",
                )}
              </span>
            </label>
            <label>
              {t("Canale")}
              <select name="channel" defaultValue="online">
                {CHANNELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Inizio")}
              <input name="starts_at" type="date" />
              <span className="field-help">{t("Vuoto: parte subito.")}</span>
            </label>
            <label>
              {t("Fine")}
              <input name="ends_at" type="date" />
              <span className="field-help">{t("Vuoto: resta finché non la concludi tu.")}</span>
            </label>
            <button className="btn btn--primary" type="submit">
              {t("Crea promozione")}
            </button>
          </Form>
        </section>
      ) : null}

      <section className="panel">
        <h2>{t("Elenco")}</h2>
        {promotions.length === 0 ? (
          <div className="empty-state">
            <p>{t("Nessuna promozione.")}</p>
            <p className="small">
              {t("Per un codice che il cliente digita al carrello, vai a")}{" "}
              <Link to="/admin/sconti">{t("Sconti")}</Link>.
            </p>
          </div>
        ) : (
          <div
            className="admin-table-wrap"
            /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
            tabIndex={0}
            role="region"
            aria-label={t("Tabella scorrevole")}
          >
            <table className="admin-table">
              <caption className="visually-hidden">{t("Promozioni")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Nome")}</th>
                  <th scope="col">{t("Sconto")}</th>
                  <th scope="col">{t("Canale")}</th>
                  <th scope="col" className="numeric">
                    {t("Prodotti")}
                  </th>
                  <th scope="col">{t("Periodo")}</th>
                  <th scope="col">{t("Stato")}</th>
                  {canWrite ? <th scope="col">{t("Azione")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => {
                  const state = stateOf(p, now);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="numeric">
                        {p.discount_type === "percentage"
                          ? `${(p.discount_value / 100).toFixed(p.discount_value % 100 === 0 ? 0 : 1)}%`
                          : `${(p.discount_value / 100).toFixed(2)} €`}
                      </td>
                      <td>{CHANNELS.find(([v]) => v === p.channel)?.[1] ?? p.channel}</td>
                      <td className="numeric">{p.products}</td>
                      <td className="small">
                        {p.starts_at ? formatDateTime(p.starts_at, t.locale) : "—"}
                        <br />
                        {p.ends_at ? formatDateTime(p.ends_at, t.locale) : t("senza scadenza")}
                      </td>
                      <td>
                        <span
                          className={
                            state === "in corso"
                              ? "badge badge--success"
                              : state === "programmata"
                                ? "badge badge--warning"
                                : "badge"
                          }
                        >
                          {state}
                        </span>
                      </td>
                      {canWrite ? (
                        <td>
                          {state === "in corso" || state === "programmata" ? (
                            <Form method="post">
                              <input type="hidden" name="intent" value="end" />
                              <input type="hidden" name="promotionId" value={p.id} />
                              <button className="btn" type="submit">
                                {t("Concludi")}
                              </button>
                            </Form>
                          ) : (
                            <span className="small muted">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
