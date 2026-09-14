import { useLocation } from "react-router";
import { useAdminTranslator } from "./use-admin-translator";

/** Native POST and redirect: persistent preference, also before hydration. */
export function AdminLanguageSwitcher() {
  const t = useAdminTranslator();
  const location = useLocation();
  return (
    <details className="ac__menu ac__language">
      <summary
        className="ac__icon-btn"
        aria-label={t.locale === "en" ? "Admin language: English" : "Lingua pannello: Italiano"}
      >
        <span aria-hidden="true">{t.locale.toUpperCase()}</span>
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
