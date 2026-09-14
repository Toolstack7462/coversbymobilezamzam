import type { CompatibilityState } from "~/domain/compatibility/resolve";
import { compatibilityLabelKey } from "~/domain/compatibility/resolve";
import type { Translator } from "~/lib/i18n";

/**
 * The compatibility badge.
 *
 * Every state carries TEXT and a SHAPE as well as a colour — status is never
 * conveyed by colour alone (WCAG 1.4.1). The symbols are inline SVG from one
 * set, never emoji.
 */

interface Props {
  state: CompatibilityState;
  deviceName: string | null;
  t: Translator;
  compact?: boolean;
}

export function CompatibilityBadge({ state, deviceName, t, compact = false }: Props) {
  // `prompt` means no device is selected. Say nothing rather than guessing: a
  // badge with no device behind it is noise.
  if (state === "prompt" && compact) return null;

  const label = t(compatibilityLabelKey(state), { device: deviceName ?? "" });

  return (
    <p className={`compat compat--${state}`}>
      <StateIcon state={state} />
      <span>{label}</span>
    </p>
  );
}

function StateIcon({ state }: { state: CompatibilityState }) {
  const positive = state === "exact" || state === "compatible";
  const circle = state === "universal" || state === "unverified" || state === "prompt";
  const path = positive
    ? "M20 6 9 17l-5-5"
    : state === "mismatch"
      ? "M18 6 6 18M6 6l12 12"
      : state === "adapter"
        ? "M12 2v6M8 8h8v5a4 4 0 0 1-8 0V8ZM12 17v5"
        : state === "universal"
          ? "M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"
          : "M12 16h.01M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7";
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {circle ? <circle cx="12" cy="12" r="9" /> : null}
      <path d={path} />
    </svg>
  );
}
