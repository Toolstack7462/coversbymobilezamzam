import { useLocation } from "react-router";
import { useAdminTranslator } from "./use-admin-translator";

/** Native POST and redirect: persistent preference, also before hydration. */
export function AdminLanguageSwitcher() {
  const t = useAdminTranslator();
  const location = useLocation();
  const language = t.locale === "en" ? "English" : "Italiano";
  return (
    <details className="ac__menu ac__language">
      <summary
        className="ac__icon-btn"
        aria-label={t("Lingua pannello: {{language}}", { language })}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18" />
        </svg>
        <span className="ac__language-copy">
          <span className="ac__language-label">{t("Lingua")}</span>
          <span lang={t.locale}>{language}</span>
        </span>
        <svg
          className="ac__language-chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <form
        className="ac__menu-panel"
        method="post"
        action="/admin/lingua"
        onSubmit={(event) => {
          const input = event.currentTarget.elements.namedItem("returnTo") as HTMLInputElement;
          input.value = `${location.pathname}${location.search}${window.location.hash}`;
        }}
      >
        <input
          type="hidden"
          name="returnTo"
          value={`${location.pathname}${location.search}`}
          readOnly
        />
        <button type="submit" name="language" value="it" lang="it" aria-pressed={t.locale === "it"}>
          Italiano
        </button>
        <button type="submit" name="language" value="en" lang="en" aria-pressed={t.locale === "en"}>
          English
        </button>
      </form>
    </details>
  );
}
