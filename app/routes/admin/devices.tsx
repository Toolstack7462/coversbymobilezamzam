import { Form, useSearchParams } from "react-router";
import type { Route } from "./+types/devices";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { slugify } from "~/domain/catalogue/slug";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Devices: brands, families and models.
 *
 * This is the spine of the whole shop. Nothing about compatibility can be
 * recorded until the phone exists here, and compatibility is the single reason
 * a customer chooses a specialist over a marketplace.
 *
 * **One screen for all three levels, not three screens.** A model cannot exist
 * without a family and a family cannot exist without a brand, so splitting them
 * up would mean navigating between three pages to add one phone — and a shop
 * adds phones in bursts, when a new range launches. The three-column layout
 * lets a merchant pick Apple, pick iPhone 16, and add four models without
 * leaving the page.
 *
 * Nothing here is ever deleted. A device model is referenced by compatibility
 * records and by past orders' `device_model_name` snapshots; `active = 0` takes
 * it out of the storefront's pickers while leaving every historical record
 * readable.
 */

export function meta() {
  return [{ title: "Dispositivi" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const url = new URL(request.url);
  const brandId = url.searchParams.get("marca");
  const familyId = url.searchParams.get("famiglia");

  const [brands, families, models] = await Promise.all([
    env.DB.prepare(
      `SELECT b.id, b.name, b.handle, b.active,
              (SELECT COUNT(*) FROM device_models m WHERE m.device_brand_id = b.id) AS model_count
         FROM device_brands b ORDER BY b.sort_order, b.name`,
    ).all<{ id: string; name: string; handle: string; active: number; model_count: number }>(),

    brandId
      ? env.DB.prepare(
          `SELECT f.id, f.name, f.handle, f.release_year, f.active,
                  (SELECT COUNT(*) FROM device_models m WHERE m.device_family_id = f.id) AS model_count
             FROM device_families f
            WHERE f.device_brand_id = ?1
            ORDER BY f.release_year DESC, f.sort_order, f.name`,
        )
          .bind(brandId)
          .all<{
            id: string;
            name: string;
            handle: string;
            release_year: number | null;
            active: number;
            model_count: number;
          }>()
      : Promise.resolve({ results: [] }),

    familyId
      ? env.DB.prepare(
          `SELECT m.id, m.name, m.handle, m.release_year, m.connector, m.is_popular, m.active,
                  (SELECT COUNT(*) FROM product_compatibility pc
                    WHERE pc.device_model_id = m.id) AS compat_count
             FROM device_models m
            WHERE m.device_family_id = ?1
            ORDER BY m.sort_order, m.name`,
        )
          .bind(familyId)
          .all<{
            id: string;
            name: string;
            handle: string;
            release_year: number | null;
            connector: string | null;
            is_popular: number;
            active: number;
            compat_count: number;
          }>()
      : Promise.resolve({ results: [] }),
  ]);

  return {
    brands: brands.results,
    families: families.results,
    models: models.results,
    selectedBrand: brandId,
    selectedFamily: familyId,
    canWrite: actor.permissions.includes("product.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.write");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  const logAudit = (action: string, entityId: string, after: unknown) =>
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,?4,'device',?5,?6,?7)`,
    ).bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      action,
      entityId,
      JSON.stringify(after),
      now,
    );

  /** Shared insert for all three levels: they differ only in their parents. */
  async function addDevice(
    table: "device_brands" | "device_families" | "device_models",
    name: string,
    extraColumns: Record<string, string | number | null>,
  ) {
    if (name.length < 1) return { error: "Il nome è obbligatorio." };

    const handle = slugify(name);
    if (handle === "") {
      return { error: `"${name}" non produce un identificativo utilizzabile.` };
    }

    // The handle is unique per table. Checked here so the merchant gets a
    // sentence; the unique index is what actually guarantees it.
    const existing = await env.DB.prepare(`SELECT id FROM ${table} WHERE handle = ?1`)
      .bind(handle)
      .first<{ id: string }>();
    if (existing) return { error: `"${name}" esiste già.` };

    const id = cryptoIds.generate();
    const columns = [
      "id",
      "handle",
      "name",
      ...Object.keys(extraColumns),
      "created_at",
      "updated_at",
    ];
    const values = [id, handle, name, ...Object.values(extraColumns), now, now];
    const placeholders = values.map((_, i) => `?${i + 1}`).join(", ");

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(
        ...values,
      ),
      logAudit(`${table}.create`, id, { name, handle }),
    ]);

    return { success: `"${name}" aggiunto.`, id };
  }

  if (intent === "add-brand") {
    return addDevice("device_brands", String(form.get("name") ?? "").trim(), {});
  }

  if (intent === "add-family") {
    const brandId = String(form.get("brandId") ?? "");
    if (!brandId) return { error: "Scegli prima una marca." };
    return addDevice("device_families", String(form.get("name") ?? "").trim(), {
      device_brand_id: brandId,
      release_year: Number(form.get("releaseYear")) || null,
    });
  }

  if (intent === "add-model") {
    const brandId = String(form.get("brandId") ?? "");
    const familyId = String(form.get("familyId") ?? "");
    if (!brandId || !familyId) return { error: "Scegli prima marca e famiglia." };

    return addDevice("device_models", String(form.get("name") ?? "").trim(), {
      device_brand_id: brandId,
      device_family_id: familyId,
      release_year: Number(form.get("releaseYear")) || null,
      connector: String(form.get("connector") ?? "").trim() || null,
    });
  }

  if (intent === "toggle-active") {
    const table = String(form.get("table") ?? "");
    const id = String(form.get("id") ?? "");
    if (!["device_brands", "device_families", "device_models"].includes(table)) {
      return { error: "Tabella non valida." };
    }

    // Never a delete. Compatibility records and past orders' device-name
    // snapshots reference these rows; deactivating removes it from the
    // storefront's pickers and leaves the history readable.
    const row = await env.DB.prepare(`SELECT active, name FROM ${table} WHERE id = ?1`)
      .bind(id)
      .first<{ active: number; name: string }>();
    if (!row) return { error: "Elemento non trovato." };

    const next = row.active === 1 ? 0 : 1;
    await env.DB.batch([
      env.DB.prepare(`UPDATE ${table} SET active = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        next,
        now,
        id,
      ),
      logAudit(`${table}.active`, id, { active: next === 1 }),
    ]);

    return {
      success:
        next === 1
          ? `"${row.name}" è di nuovo selezionabile.`
          : `"${row.name}" non è più selezionabile dai clienti. I dati storici restano.`,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function Devices({ loaderData, actionData }: Route.ComponentProps) {
  const { brands, families, models, selectedBrand, selectedFamily, canWrite } = loaderData;
  const [params] = useSearchParams();

  const brandName = brands.find((b) => b.id === selectedBrand)?.name;
  const familyName = families.find((f) => f.id === selectedFamily)?.name;

  return (
    <>
      <PageHeader
        title="Dispositivi"
        description="Le marche, le famiglie e i modelli di telefono. Senza questi non si può registrare nessuna compatibilità."
        breadcrumbs={breadcrumbsFor("/admin/dispositivi")}
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

      <p className="notice notice--info small">
        Un modello si aggiunge in tre passaggi, da sinistra a destra: prima la marca, poi la
        famiglia (la serie), poi il modello. Nulla viene mai cancellato — si disattiva, così
        sparisce dai filtri del sito ma gli ordini e le compatibilità già registrate restano
        leggibili.
      </p>

      <div className="ac-columns">
        {/* ── Brands ────────────────────────────────────────────────────── */}
        <section className="panel stack">
          <h2>1. Marca</h2>
          <ul className="ac-picker">
            {brands.map((brand) => (
              <li key={brand.id}>
                <a
                  href={`?marca=${brand.id}`}
                  className={brand.id === selectedBrand ? "ac-pick ac-pick--active" : "ac-pick"}
                  aria-current={brand.id === selectedBrand ? "true" : undefined}
                >
                  <span>
                    {brand.name}
                    {brand.active === 0 ? (
                      <span className="badge badge--muted"> disattivata</span>
                    ) : null}
                  </span>
                  <span className="ac-pick__count numeric">{brand.model_count}</span>
                </a>
              </li>
            ))}
          </ul>

          {brands.length === 0 ? (
            <p className="small muted">Nessuna marca. Cominciate da qui: Apple, Samsung, Xiaomi…</p>
          ) : null}

          {canWrite ? (
            <Form method="post" className="cluster">
              <input type="hidden" name="intent" value="add-brand" />
              <label className="visually-hidden" htmlFor="brand-name">
                Nome della marca
              </label>
              <input
                id="brand-name"
                name="name"
                className="input"
                placeholder="Apple"
                required
                maxLength={80}
              />
              <button type="submit" className="btn btn--secondary btn--small">
                Aggiungi
              </button>
            </Form>
          ) : null}
        </section>

        {/* ── Families ──────────────────────────────────────────────────── */}
        <section className="panel stack">
          <h2>2. Famiglia</h2>
          {!selectedBrand ? (
            <p className="small muted">Scegliete una marca a sinistra.</p>
          ) : (
            <>
              <ul className="ac-picker">
                {families.map((family) => (
                  <li key={family.id}>
                    <a
                      href={`?marca=${selectedBrand}&famiglia=${family.id}`}
                      className={
                        family.id === selectedFamily ? "ac-pick ac-pick--active" : "ac-pick"
                      }
                      aria-current={family.id === selectedFamily ? "true" : undefined}
                    >
                      <span>
                        {family.name}
                        {family.release_year ? (
                          <span className="muted small"> {family.release_year}</span>
                        ) : null}
                        {family.active === 0 ? (
                          <span className="badge badge--muted"> disattivata</span>
                        ) : null}
                      </span>
                      <span className="ac-pick__count numeric">{family.model_count}</span>
                    </a>
                  </li>
                ))}
              </ul>

              {families.length === 0 ? (
                <p className="small muted">
                  Nessuna famiglia per {brandName}. Una famiglia è una serie: iPhone 16, Galaxy S24.
                </p>
              ) : null}

              {canWrite ? (
                <Form method="post" className="stack">
                  <input type="hidden" name="intent" value="add-family" />
                  <input type="hidden" name="brandId" value={selectedBrand} />
                  <div className="cluster">
                    <label className="visually-hidden" htmlFor="family-name">
                      Nome della famiglia
                    </label>
                    <input
                      id="family-name"
                      name="name"
                      className="input"
                      placeholder="iPhone 16"
                      required
                      maxLength={80}
                    />
                    <label className="visually-hidden" htmlFor="family-year">
                      Anno
                    </label>
                    <input
                      id="family-year"
                      name="releaseYear"
                      className="input"
                      type="number"
                      min={2000}
                      max={2100}
                      placeholder="2024"
                      style={{ maxWidth: "7rem" }}
                    />
                    <button type="submit" className="btn btn--secondary btn--small">
                      Aggiungi
                    </button>
                  </div>
                </Form>
              ) : null}
            </>
          )}
        </section>

        {/* ── Models ────────────────────────────────────────────────────── */}
        <section className="panel stack">
          <h2>3. Modello</h2>
          {!selectedFamily ? (
            <p className="small muted">Scegliete una famiglia.</p>
          ) : (
            <>
              <ul className="ac-picker">
                {models.map((model) => (
                  <li key={model.id}>
                    <div className="ac-pick">
                      <span>
                        {model.name}
                        {model.connector ? (
                          <span className="muted small"> · {model.connector}</span>
                        ) : null}
                        {model.active === 0 ? (
                          <span className="badge badge--muted"> disattivato</span>
                        ) : null}
                      </span>
                      <span className="cluster">
                        <span
                          className="ac-pick__count numeric"
                          title={`${model.compat_count} accessori collegati`}
                        >
                          {model.compat_count}
                        </span>
                        {canWrite ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="toggle-active" />
                            <input type="hidden" name="table" value="device_models" />
                            <input type="hidden" name="id" value={model.id} />
                            <button type="submit" className="btn btn--ghost btn--small">
                              {model.active === 1 ? "Disattiva" : "Riattiva"}
                            </button>
                          </Form>
                        ) : null}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {models.length === 0 ? (
                <p className="small muted">Nessun modello in {familyName}.</p>
              ) : null}

              {canWrite ? (
                <Form method="post" className="stack">
                  <input type="hidden" name="intent" value="add-model" />
                  <input type="hidden" name="brandId" value={selectedBrand ?? ""} />
                  <input type="hidden" name="familyId" value={selectedFamily} />

                  <div className="field">
                    <label className="field__label" htmlFor="model-name">
                      Nome del modello
                    </label>
                    <input
                      id="model-name"
                      name="name"
                      className="input"
                      placeholder="iPhone 16 Pro Max"
                      required
                      maxLength={80}
                    />
                  </div>

                  <div className="cluster">
                    <div className="field">
                      <label className="field__label" htmlFor="model-connector">
                        Connettore
                      </label>
                      <input
                        id="model-connector"
                        name="connector"
                        className="input"
                        placeholder="USB-C"
                        list="connectors"
                        maxLength={40}
                      />
                      {/* A datalist, not a select: the list is a convenience and
                          a new connector standard must not require a migration. */}
                      <datalist id="connectors">
                        <option value="USB-C" />
                        <option value="Lightning" />
                        <option value="Micro-USB" />
                      </datalist>
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor="model-year">
                        Anno
                      </label>
                      <input
                        id="model-year"
                        name="releaseYear"
                        className="input"
                        type="number"
                        min={2000}
                        max={2100}
                        placeholder="2024"
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn btn--primary">
                    Aggiungi modello
                  </button>
                </Form>
              ) : null}
            </>
          )}
        </section>
      </div>

      {params.get("marca") ? (
        <p className="caption muted">
          <a href="/admin/dispositivi">Azzera la selezione</a>
        </p>
      ) : null}
    </>
  );
}
