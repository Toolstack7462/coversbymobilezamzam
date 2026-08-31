import { Link, useLocation } from "react-router";
import type { Route } from "./+types/setup-centre";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { computeSetupSteps, summariseSetup } from "~/domain/content/setup-steps";
import type { SettingsMap } from "~/domain/content/gates";

/**
 * Centro configurazione.
 *
 * Every row is computed from the database on this request. There is no
 * `setup_completed` column, deliberately: a stored `true` would keep saying the
 * shop is ready long after someone deleted the only payment method.
 */

export function meta() {
  return [{ title: "Centro configurazione" }, { name: "robots", content: "noindex, nofollow" }];
}

/** One query pass, so the domain function stays pure and the SQL stays here. */
export async function loadSetupSnapshot(env: Env, now: number) {
  const [settingsResult, counts] = await Promise.all([
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),

    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM staff_profiles sp
          WHERE sp.active = 1 AND sp.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM user_roles ur
                          JOIN role_permissions rp ON rp.role_id = ur.role_id
                          JOIN permissions p ON p.id = rp.permission_id
                         WHERE ur.user_id = sp.user_id
                           AND p.code IN ('payment.verify','payment.settings','staff.roles',
                                          'staff.write','settings.write','order.refund'))
            AND NOT EXISTS (SELECT 1 FROM two_factor tf
                             WHERE tf.user_id = sp.user_id AND tf.verified = 1)
        ) AS privileged_without_totp,

        (SELECT COUNT(*) FROM products WHERE archived_at IS NULL) AS product_count,
        (SELECT COUNT(*) FROM products WHERE status = 'active' AND archived_at IS NULL) AS published_count,

        (SELECT COUNT(*) FROM products p
          WHERE p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)
        ) AS products_without_image,

        (SELECT COUNT(*) FROM products p
          WHERE p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM product_variants v
                              JOIN variant_prices vp ON vp.variant_id = v.id
                             WHERE v.product_id = p.id)
        ) AS products_without_price,

        (SELECT COUNT(*) FROM product_variants WHERE archived_at IS NULL) AS variant_count,
        (SELECT COUNT(DISTINCT variant_id) FROM inventory_levels) AS variants_with_inventory,

        (SELECT COUNT(*) FROM product_compatibility) AS compatibility_records,
        (SELECT COUNT(*) FROM product_compatibility
          WHERE compatibility_level = 'exact_fit' AND verified = 0) AS exact_fit_unverified,

        (SELECT COUNT(*) FROM payment_methods WHERE active = 1 AND archived_at IS NULL) AS active_payment_methods,
        (SELECT COUNT(*) FROM shipping_methods WHERE active = 1 AND archived_at IS NULL) AS active_shipping_methods,

        (SELECT COUNT(*) FROM legal_documents) AS legal_documents,
        (SELECT COUNT(*) FROM legal_document_versions WHERE published_at IS NOT NULL) AS published_legal_versions,

        (SELECT COUNT(*) FROM orders) AS order_count,
        (SELECT value FROM system_settings WHERE key = 'ops.last_restore_test_at') AS last_restore_test_at,
        (SELECT value FROM system_settings WHERE key = 'ops.preview_deployed_at') AS preview_deployed_at`,
    ).first<Record<string, number | string | null>>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  const n = (key: string): number => Number(counts?.[key] ?? 0);
  const t = (key: string): number | null => {
    const raw = counts?.[key];
    return raw === null || raw === undefined || raw === "" ? null : Number(raw);
  };

  return {
    settings,
    privilegedWithoutTotp: n("privileged_without_totp"),
    productCount: n("product_count"),
    publishedProductCount: n("published_count"),
    productsWithoutImage: n("products_without_image"),
    productsWithoutPrice: n("products_without_price"),
    variantCount: n("variant_count"),
    variantsWithInventory: n("variants_with_inventory"),
    compatibilityRecordCount: n("compatibility_records"),
    exactFitUnverified: n("exact_fit_unverified"),
    activePaymentMethods: n("active_payment_methods"),
    shippingConfigured: n("active_shipping_methods") > 0,
    pickupConfigured: settings["pickup.enabled"] === "true",
    publishedLegalDocuments: n("published_legal_versions"),
    // The eleven documents the legal checklist requires before launch.
    requiredLegalDocuments: 11,
    orderCount: n("order_count"),
    lastRestoreTestAt: t("last_restore_test_at"),
    previewDeployedAt: t("preview_deployed_at"),
    now,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env);

  const snapshot = await loadSetupSnapshot(env, systemClock.now());
  return { progress: summariseSetup(computeSetupSteps(snapshot)) };
}

export default function SetupCentre({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { progress } = loaderData;

  return (
    <>
      <PageHeader
        title="Centro configurazione"
        description="Cosa manca prima di poter vendere. Ogni voce è calcolata dai dati reali, non spuntata a mano."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

      <section className="panel stack">
        <div className="ac-progress">
          <div className="ac-progress__track">
            <div className="ac-progress__fill" style={{ width: `${progress.percentage}%` }} />
          </div>
          <span className="small numeric">
            {progress.complete} / {progress.total}
          </span>
        </div>

        {progress.readyToTrade ? (
          <p className="notice notice--info small" role="status">
            Tutti i passaggi obbligatori sono completi. I punti consigliati rimasti non bloccano la
            vendita, ma vale la pena chiuderli.
          </p>
        ) : (
          <p className="notice notice--warning small" role="status">
            <strong>{progress.blockingIncomplete.length} passaggi obbligatori</strong> mancano
            ancora. Finché restano aperti il negozio non è pronto a vendere.
          </p>
        )}
      </section>

      <section className="stack" style={{ marginBlockStart: "var(--space-5)" }}>
        <h2>Passaggi</h2>
        <ol className="ac-steps">
          {progress.steps.map((step) => (
            <li
              key={step.id}
              className={[
                "ac-step",
                step.status === "complete" ? "ac-step--done" : "",
                step.severity === "blocking" && step.status !== "complete"
                  ? "ac-step--blocking"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {/*
                A mark AND a word AND a border. Status is never carried by
                colour alone.
              */}
              <span className="ac-step__mark" aria-hidden="true">
                {step.status === "complete" ? "✓" : ""}
              </span>

              <div>
                <p className="ac-step__title">
                  {step.title}
                  <span className="visually-hidden">
                    {step.status === "complete" ? " — completato" : " — da completare"}
                  </span>
                  {step.severity === "blocking" && step.status !== "complete" ? (
                    <span className="badge badge--warning"> obbligatorio</span>
                  ) : null}
                </p>
                <p className="ac-step__why">
                  {step.status === "complete" ? step.description : step.reason}
                </p>
              </div>

              {step.status !== "complete" ? (
                <Link className="btn btn--secondary" to={step.href}>
                  Configura
                </Link>
              ) : (
                <span className="small muted">Fatto</span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
