import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/product-new";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { createProduct, CreateProductInput } from "~/application/commands/create-product";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Adding a product.
 *
 * **Deliberately one short form, not a six-step wizard.**
 *
 * A wizard is the obvious choice and the wrong one here. The person filling
 * this in is behind a counter and will be interrupted — by a customer, by the
 * phone, by the door. A wizard punishes that: leave at step four and the first
 * three steps are gone. This form asks for the five things a product genuinely
 * cannot exist without, saves them, and then hands over to the full editor for
 * everything else.
 *
 * What is NOT asked for here, and why:
 *
 *   - Images, long description, SEO, compatibility, extra variants. All real,
 *     none of them required for the product to exist, and every one of them
 *     easier to do with the product already saved and visible.
 *   - The slug. Derived from the name, because a merchant should not have to
 *     have an opinion about URLs, and a slug typed under time pressure is one
 *     that gets typed badly and then lives forever.
 *
 * Nothing is lost by saving early: the "Senza prezzo", "Senza immagine" and
 * "Senza compatibilità" views, plus the setup centre, make every gap visible
 * and none of them silent.
 */

export function meta() {
  return [{ title: "Aggiungi prodotto" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "product.write");

  const [brands, categories, location] = await Promise.all([
    env.DB.prepare(`SELECT id, name FROM brands ORDER BY name`).all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT c.id, ct.name
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        ORDER BY ct.name`,
    ).all<{ id: string; name: string | null }>(),
    env.DB.prepare(`SELECT id, name FROM inventory_locations ORDER BY created_at LIMIT 1`).first<{
      id: string;
      name: string;
    }>(),
  ]);

  return {
    brands: brands.results,
    categories: categories.results.filter((c) => c.name !== null),
    locationName: location?.name ?? null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.write");
  const form = await request.formData();

  const location = await env.DB.prepare(
    `SELECT id FROM inventory_locations ORDER BY created_at LIMIT 1`,
  ).first<{ id: string }>();
  if (!location) {
    return {
      error:
        "Nessuna sede di magazzino configurata. Senza una sede non è possibile registrare le giacenze.",
      values: {},
    };
  }

  const parsed = CreateProductInput.safeParse({
    name: form.get("name") ?? "",
    sku: form.get("sku") ?? "",
    price: form.get("price") ?? "",
    onHand: form.get("onHand") ?? 0,
    brandId: form.get("brandId") || undefined,
    categoryId: form.get("categoryId") || undefined,
    shortDescription: form.get("shortDescription") || undefined,
    publish: form.get("publish") === "true",
  });

  // Values are echoed back on every failure path. Retyping a form because one
  // field was wrong is how a merchant learns to dread the software.
  const values = Object.fromEntries(
    ["name", "sku", "price", "onHand", "brandId", "categoryId", "shortDescription"].map((k) => [
      k,
      String(form.get(k) ?? ""),
    ]),
  );

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Dati non validi.", values };
  }

  const result = await createProduct(parsed.data, {
    d1: env.DB,
    clock: systemClock,
    ids: cryptoIds,
    defaultLocationId: location.id,
    actorId: actor.userId,
    actorLabel: actor.displayName,
  });

  if (!result.ok) return { error: result.error, values };

  // Straight to the editor rather than back to the list: the merchant came here
  // to add a product, and the next thing they want is the product.
  return redirect(`/admin/prodotti/${result.productId}?creato=1`);
}

export default function NewProduct({ loaderData, actionData }: Route.ComponentProps) {
  const { brands, categories, locationName } = loaderData;
  const values = (actionData && "values" in actionData ? actionData.values : {}) as Record<
    string,
    string
  >;

  return (
    <>
      <PageHeader
        title="Aggiungi prodotto"
        description="Solo l'essenziale. Foto, descrizione e compatibilità si aggiungono dopo, con il prodotto già salvato."
        breadcrumbs={breadcrumbsFor("/admin/prodotti/nuovo")}
      />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}

      <Form method="post" className="panel stack">
        <div className="field">
          <label className="field__label" htmlFor="name">
            Nome del prodotto
            <span className="badge badge--warning"> obbligatorio</span>
          </label>
          <input
            id="name"
            name="name"
            className="input"
            required
            maxLength={200}
            defaultValue={values.name ?? ""}
            aria-describedby="name-help"
          />
          <span className="field__hint" id="name-help">
            Come lo chiamereste a un cliente. L&apos;indirizzo della pagina viene creato da questo
            nome, quindi conviene scriverlo per esteso.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="sku">
            Codice SKU
            <span className="badge badge--warning"> obbligatorio</span>
          </label>
          <input
            id="sku"
            name="sku"
            className="input"
            required
            maxLength={64}
            defaultValue={values.sku ?? ""}
            aria-describedby="sku-help"
          />
          <span className="field__hint" id="sku-help">
            Il codice con cui riconoscete il prodotto in magazzino. Deve essere diverso da ogni
            altro: due prodotti con lo stesso codice diventano un inventario che non torna. Viene
            salvato in maiuscolo.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="price">
            Prezzo di vendita
          </label>
          <input
            id="price"
            name="price"
            className="input"
            inputMode="decimal"
            placeholder="39,90"
            defaultValue={values.price ?? ""}
            aria-describedby="price-help"
          />
          <span className="field__hint" id="price-help">
            IVA inclusa. Potete lasciarlo vuoto e deciderlo dopo: il prodotto resta in bozza e
            compare nell&apos;elenco &ldquo;Senza prezzo&rdquo; finché non lo impostate.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="onHand">
            Quantità disponibile
          </label>
          <input
            id="onHand"
            name="onHand"
            className="input"
            type="number"
            min={0}
            step={1}
            defaultValue={values.onHand || "0"}
            aria-describedby="onhand-help"
          />
          <span className="field__hint" id="onhand-help">
            Quanti pezzi avete adesso{locationName ? ` in ${locationName}` : ""}. Si corregge in
            qualsiasi momento dall&apos;inventario, indicando un motivo.
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="brandId">
            Marchio
          </label>
          <select id="brandId" name="brandId" className="input" defaultValue={values.brandId ?? ""}>
            <option value="">— nessuno —</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          {brands.length === 0 ? (
            <span className="field__hint">
              Non ci sono ancora marchi. Il prodotto si crea lo stesso e il marchio si aggiunge
              dopo.
            </span>
          ) : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="categoryId">
            Categoria
          </label>
          <select
            id="categoryId"
            name="categoryId"
            className="input"
            defaultValue={values.categoryId ?? ""}
          >
            <option value="">— nessuna —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="shortDescription">
            Descrizione breve
          </label>
          <textarea
            id="shortDescription"
            name="shortDescription"
            className="input"
            rows={2}
            maxLength={500}
            defaultValue={values.shortDescription ?? ""}
            aria-describedby="desc-help"
          />
          <span className="field__hint" id="desc-help">
            Una o due righe, quelle che compaiono sotto il nome negli elenchi.
          </span>
        </div>

        {/*
          Publishing is opt-in, and it is a hidden field plus a checkbox for the
          same reason every other boolean here is: an unchecked box submits
          nothing, and "nothing" must mean false rather than unchanged.
        */}
        <div className="field">
          <input type="hidden" name="publish" value="false" />
          <label className="field__checkbox" htmlFor="publish">
            <input id="publish" name="publish" type="checkbox" value="true" />
            <span>Pubblica subito sul sito</span>
          </label>
          <span className="field__hint">
            Se lasciate la casella vuota il prodotto resta in bozza: visibile solo a voi, finché non
            decidete di pubblicarlo. È quasi sempre la scelta giusta, perché mancano ancora foto e
            compatibilità.
          </span>
        </div>

        <div className="cluster">
          <button type="submit" className="btn btn--primary">
            Crea prodotto
          </button>
          <Link to="/admin/prodotti" className="btn btn--ghost">
            Annulla
          </Link>
        </div>
      </Form>
    </>
  );
}
