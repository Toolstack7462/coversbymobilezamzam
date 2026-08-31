import { Form, Link } from "react-router";
import type { Route } from "./+types/compatibility";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { parseTableParams, paginate, orderByClause, type TableSpec } from "~/lib/table-params";
import {
  COMPATIBILITY_VIEWS,
  COMPATIBILITY_VIEW_SLUGS,
  COMPATIBILITY_LABELS,
  COMPATIBILITY_MEANING,
  compatibilityTone,
} from "~/lib/compatibility-views";
import { isCompatibilityLevel } from "~/domain/compatibility/resolve";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { DataTable, type Column } from "~/components/admin/data-table";

/**
 * The compatibility matrix.
 *
 * This screen exists because of one number: returns. A customer who buys a case
 * that does not fit their phone does not simply return it — they stop trusting
 * the shop's compatibility data entirely, and then they buy from a marketplace
 * where they can filter by model with confidence.
 *
 * Two rules are enforced here rather than assumed:
 *
 *   - **Compatibility is never inferred.** Not from the category, not from the
 *     product family, not from a name that happens to contain "iPhone 15". If
 *     there is no record, the storefront says unknown — it does not guess.
 *   - **`exact_fit` requires a human.** It is a promise about one specific
 *     phone, and the only thing that can support it is somebody holding both
 *     objects. Marking it verified records who did that and when, so the claim
 *     has an owner.
 */

export function meta() {
  return [{ title: "Compatibilità" }, { name: "robots", content: "noindex, nofollow" }];
}

const SPEC: TableSpec = {
  views: COMPATIBILITY_VIEW_SLUGS,
  sortable: ["product", "device", "level"],
  defaultSort: { key: "product", direction: "asc" },
  perPage: 50,
};

const SORT_COLUMNS: Record<string, string> = {
  product: "pt.name",
  device: "device_name",
  level: "pc.compatibility_level",
};

const FROM = `FROM product_compatibility pc
   JOIN products p ON p.id = pc.product_id
   LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
   LEFT JOIN device_models dm ON dm.id = pc.device_model_id
   LEFT JOIN device_model_translations dmt
          ON dmt.device_model_id = dm.id AND dmt.locale = 'it'
   LEFT JOIN device_brands db ON db.id = dm.device_brand_id`;

interface Row {
  id: string;
  product_id: string;
  product_name: string | null;
  product_slug: string;
  device_name: string | null;
  device_brand: string | null;
  compatibility_level: string;
  verified: number;
  verified_at: number | null;
  note: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const url = new URL(request.url);
  const state = parseTableParams(url.searchParams, SPEC);
  const view = COMPATIBILITY_VIEWS.find((v) => v.slug === state.view) ?? COMPATIBILITY_VIEWS[0]!;

  const conditions = [view.where, "p.archived_at IS NULL"];
  const binds: unknown[] = [];

  if (state.q) {
    binds.push(`%${state.q.toLowerCase()}%`);
    conditions.push(`(LOWER(pt.name) LIKE ?${binds.length}
                      OR LOWER(dm.name) LIKE ?${binds.length}
                      OR LOWER(db.name) LIKE ?${binds.length})`);
  }

  const where = conditions.join(" AND ");
  const orderBy = orderByClause(state.sort, SORT_COLUMNS, "pt.name ASC");

  const [totalRow, page, viewCounts] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),

    env.DB.prepare(
      `SELECT pc.id, pc.product_id, pc.compatibility_level, pc.verified, pc.verified_at, pc.note,
              pt.name AS product_name, p.slug AS product_slug,
              COALESCE(dmt.display_name, dm.name) AS device_name,
              db.name AS device_brand
         ${FROM}
        WHERE ${where}
        ORDER BY ${orderBy}, pc.id
        LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, state.perPage, (state.page - 1) * state.perPage)
      .all<Row>(),

    env.DB.prepare(
      `SELECT ${COMPATIBILITY_VIEWS.map((v, i) => `SUM(CASE WHEN ${v.where} THEN 1 ELSE 0 END) AS v${i}`).join(", ")}
         ${FROM} WHERE p.archived_at IS NULL`,
    ).first<Record<string, number>>(),
  ]);

  return {
    rows: page.results,
    state,
    pagination: paginate(state, totalRow?.n ?? 0),
    views: COMPATIBILITY_VIEWS.map((v, i) => ({
      slug: v.slug,
      label: v.label,
      count: Number(viewCounts?.[`v${i}`] ?? 0),
    })),
    canWrite: actor.permissions.includes("product.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.write");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "verify") {
    const id = String(form.get("id") ?? "");
    const source = String(form.get("source") ?? "").trim();

    // A verification with no stated source is an unattributable claim. Six
    // months from now, "verified" with nothing beside it tells nobody whether
    // someone held the phone or read a website.
    if (source === "") {
      return { error: "Indica come hai verificato: serve a chi leggerà questo dato fra sei mesi." };
    }

    const claimed = await env.DB.prepare(
      // Conditional on still being unverified, and `changes` is checked below.
      // Two people verifying the same row at once would otherwise both write,
      // and the second would silently overwrite the first one's name.
      `UPDATE product_compatibility
          SET verified = 1, verification_source = ?1, verified_by = ?2, verified_at = ?3
        WHERE id = ?4 AND verified = 0`,
    )
      .bind(source, actor.userId, now, id)
      .run();

    if (claimed.meta.changes === 0) {
      return { error: "Questa riga risulta già verificata da qualcun altro." };
    }

    await env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'compatibility.verify','product_compatibility',?4,?5,?6)`,
    )
      .bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        id,
        JSON.stringify({ verified: true, source }),
        now,
      )
      .run();

    return { success: "Compatibilità verificata." };
  }

  if (intent === "set-level") {
    const id = String(form.get("id") ?? "");
    const level = String(form.get("level") ?? "");
    if (!isCompatibilityLevel(level)) return { error: "Livello non valido." };

    const before = await env.DB.prepare(
      `SELECT compatibility_level FROM product_compatibility WHERE id = ?1`,
    )
      .bind(id)
      .first<{ compatibility_level: string }>();
    if (!before) return { error: "Riga non trovata." };

    await env.DB.batch([
      env.DB.prepare(
        // Changing the level clears the verification. What was checked was the
        // OLD claim; carrying the tick across would make an unchecked claim
        // look checked, which is worse than no tick at all.
        `UPDATE product_compatibility
            SET compatibility_level = ?1, verified = 0, verified_by = NULL,
                verified_at = NULL, verification_source = NULL
          WHERE id = ?2`,
      ).bind(level, id),
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
         VALUES (?1,?2,?3,'compatibility.update','product_compatibility',?4,?5,?6,?7)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        id,
        JSON.stringify({ level: before.compatibility_level }),
        JSON.stringify({ level, verified: false }),
        now,
      ),
    ]);

    return {
      success:
        before.compatibility_level === level
          ? "Nessuna modifica."
          : "Livello aggiornato. La verifica è stata azzerata: riguardava la dichiarazione precedente.",
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function Compatibility({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, state, pagination, views, canWrite } = loaderData;

  const columns: Column<Row>[] = [
    {
      key: "product",
      header: "Prodotto",
      render: (row) => (
        <Link to={`/admin/prodotti/${row.product_id}`}>{row.product_name ?? row.product_slug}</Link>
      ),
    },
    {
      key: "device",
      header: "Dispositivo",
      render: (row) => (
        <>
          {row.device_brand ? <span className="muted">{row.device_brand} </span> : null}
          {row.device_name ?? <span className="muted">— tutti i modelli —</span>}
        </>
      ),
    },
    {
      key: "level",
      header: "Dichiarazione",
      render: (row) => (
        <span
          className={`badge ${compatibilityTone(row.compatibility_level, row.verified === 1)}`}
          title={
            isCompatibilityLevel(row.compatibility_level)
              ? COMPATIBILITY_MEANING[row.compatibility_level]
              : undefined
          }
        >
          {isCompatibilityLevel(row.compatibility_level)
            ? COMPATIBILITY_LABELS[row.compatibility_level]
            : row.compatibility_level}
        </span>
      ),
    },
    {
      key: "verified",
      header: "Verifica",
      render: (row) =>
        row.verified === 1 ? (
          <span className="badge badge--success">verificata</span>
        ) : row.compatibility_level === "exact_fit" ? (
          <span className="badge badge--warning">da verificare</span>
        ) : (
          <span className="muted small">non richiesta</span>
        ),
    },
    {
      key: "action",
      header: "Azione",
      render: (row) =>
        canWrite && row.verified === 0 && row.compatibility_level === "exact_fit" ? (
          <Form method="post" className="cluster">
            <input type="hidden" name="intent" value="verify" />
            <input type="hidden" name="id" value={row.id} />
            <label className="visually-hidden" htmlFor={`src-${row.id}`}>
              Come hai verificato
            </label>
            <input
              id={`src-${row.id}`}
              name="source"
              className="input"
              placeholder="provato in negozio"
              required
            />
            <button type="submit" className="btn btn--secondary btn--small">
              Verifica
            </button>
          </Form>
        ) : (
          <span className="muted small">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Compatibilità"
        description="Quali accessori entrano in quali telefoni. È il dato che evita i resi."
        breadcrumbs={breadcrumbsFor("/admin/compatibilita")}
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
        La compatibilità non viene mai dedotta dalla categoria o dal nome del prodotto. Se non è
        registrata qui, per il sito è <strong>sconosciuta</strong> e il cliente lo vede scritto.{" "}
        <strong>&ldquo;Compatibilità esatta&rdquo;</strong> è una promessa su un modello preciso: va
        verificata su un telefono vero, e chi la verifica resta registrato.
      </p>

      <DataTable
        state={state}
        spec={SPEC}
        pagination={pagination}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        views={views}
        searchLabel="Cerca per prodotto o modello"
        emptyState={{
          title: "Nessuna compatibilità registrata",
          body: "Finché non indicate quali accessori funzionano con quali telefoni, i clienti non possono filtrare per dispositivo — che è il motivo principale per cui visitano un sito di accessori.",
        }}
      />
    </>
  );
}
