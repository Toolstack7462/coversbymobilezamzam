import english from "~/locales/admin/en.compact.json";
import patternKeys from "~/locales/admin/patterns.json";
import { adminMessageKey } from "./admin-message-key";
import type { Locale } from "./i18n";

const messages: Readonly<Record<string, string>> = english;
type Values = Readonly<Record<string, string | number>>;
export type AdminTranslator = ((source: string, values?: Values) => string) & {
  locale: Locale;
  intl: "it-IT" | "en-GB";
};
const normalise = (text: string) => text.replace(/\s+/g, " ").trim();
const interpolate = (text: string, values: Values) =>
  text.replace(/\{\{(\w+)\}\}/g, (token, key: string) => String(values[key] ?? token));

// Existing actions return Italian messages, including counts/identifiers.
// Translate only at explicitly marked UI/feedback boundaries. Never translate
// merchant fields, submitted values, SQL, SKUs or audit records.
const patterns = patternKeys.map((key) => {
  const translated = messages[adminMessageKey(key)]!;
  const names: string[] = [];
  const escaped = key
    .split(/(\{\{v\d+\}\})/)
    .map((part) => {
      if (/^\{\{v\d+\}\}$/.test(part)) {
        names.push(part.slice(2, -2));
        return "([\\s\\S]*?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { expression: new RegExp(`^${escaped}$`), names, translated };
});

export function adminTranslator(locale: Locale): AdminTranslator {
  return Object.assign(
    (source: string, values: Values = {}) => {
      const key = normalise(source);
      if (locale === "it") return interpolate(source, values);
      let result = messages[adminMessageKey(key)];
      if (result === undefined) {
        for (const pattern of patterns) {
          const match = pattern.expression.exec(key);
          if (match) {
            result = interpolate(
              pattern.translated,
              Object.fromEntries(
                pattern.names.map((name, index) => [name, match[index + 1] ?? ""]),
              ),
            );
            break;
          }
        }
      }
      if (result === undefined) return interpolate(source, values);
      return `${source.match(/^\s*/)?.[0] ?? ""}${interpolate(result, values)}${source.match(/\s*$/)?.[0] ?? ""}`;
    },
    { locale, intl: locale === "en" ? ("en-GB" as const) : ("it-IT" as const) },
  );
}
