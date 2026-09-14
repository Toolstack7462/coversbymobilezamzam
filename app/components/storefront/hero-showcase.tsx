import { useState } from "react";
import { Link } from "react-router";
import { localePath, type Locale, type Translator } from "~/lib/i18n";
import { BrandSymbol } from "./brand-symbol";

/** Editorial illustration, never represented as a photograph of a saleable SKU. */
export function HeroShowcase({
  imageKey,
  heading,
  lead,
  mediaBaseUrl,
  locale,
  t,
}: {
  imageKey: string | null;
  heading?: string | null;
  lead?: string | null;
  mediaBaseUrl: string;
  locale: Locale;
  t: Translator;
}) {
  const [mode, setMode] = useState(0);
  const labels = [
    t("home.hero_statement_1"),
    t("home.hero_statement_2"),
    t("home.hero_statement_3"),
  ];
  return (
    <section className="showcase">
      <div className="page showcase__layout">
        <div className="showcase__copy">
          <p className="eyebrow">{t("home.showcase_eyebrow")}</p>
          <h1>
            {heading ||
              labels.map((label, index) => (
                <span key={label} className={index === 2 ? "showcase__accent" : undefined}>
                  {label}
                </span>
              ))}
          </h1>
          <p className="showcase__lead">{lead || t("home.showcase_lead")}</p>
          <div className="cluster">
            <Link className="btn btn--primary btn--lg" to={localePath(locale, "/shop")}>
              {t("home.shop_now")}
            </Link>
            <Link
              className="btn btn--secondary btn--lg"
              to={localePath(locale, "/trova-dispositivo")}
            >
              {t("home.find_device")}
            </Link>
          </div>
        </div>
        <div className="showcase__visual" data-mode={mode}>
          {imageKey ? (
            <img
              className="showcase__photo"
              src={`${mediaBaseUrl}/${imageKey}`}
              width="800"
              height="800"
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          ) : (
            <div className="showcase__objects" aria-hidden="true">
              <div className="showcase__orbit" />
              <div className="showcase__case showcase__case--back">
                <span className="showcase__camera">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="showcase__case showcase__case--front">
                <span className="showcase__camera">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="showcase__signature">
                  <BrandSymbol />
                </span>
                <span className="showcase__ring" />
              </div>
              <div className="showcase__disc">
                <BrandSymbol />
              </div>
              <div className="showcase__cable">
                <span />
                <span />
              </div>
            </div>
          )}
          {!imageKey ? (
            <p className="showcase__caption">{t("home.showcase_illustration")}</p>
          ) : null}
          {!imageKey ? (
            <div
              className="showcase__controls"
              role="group"
              aria-label={t("home.showcase_explore")}
            >
              {labels.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={mode === index}
                  onClick={() => setMode(index)}
                >
                  {label}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
