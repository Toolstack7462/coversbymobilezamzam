import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Link } from "react-router";

/**
 * The admin's reusable pieces.
 *
 * ── WHY ONE FILE ────────────────────────────────────────────────────────────
 *
 * These patterns already existed — as markup, repeated. `ac-metric` appeared in
 * thirty places, `ac-panel` in a dozen, and each copy was free to drift. The
 * classes were shared; the *decisions* were not, so a change to how a panel
 * spaces its heading had to be made in twelve files or in none.
 *
 * Nothing here is new visual language. Every one of these renders the classes
 * `admin.css` already defines, so adopting them changes no pixels — it moves
 * the decision to one place. That is why this file could be introduced without
 * a visual diff.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * `StatusBadge` lives beside it in status-badge.tsx because it owns a large
 * label vocabulary; `DataTable` and `AdminShell` are large enough to be their
 * own files. This holds the small ones.
 */

// ── SectionPanel ────────────────────────────────────────────────────────────

/**
 * A titled block of related controls.
 *
 * `as` because the heading LEVEL is a document-structure decision the page
 * makes, not the panel: a screen with one `h1` and five panels wants `h2`, and
 * a panel nested inside another wants `h3`. Hardcoding `h2` produced pages
 * whose outline skipped levels, which a screen reader reads as a missing
 * section.
 */
export function SectionPanel({
  title,
  description,
  as: Heading = "h2",
  headingId,
  actions,
  children,
}: {
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  headingId?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useAdminTranslator();
  return (
    <section className="ac-panel" aria-labelledby={headingId}>
      <div className="ac-panel__head">
        <div>
          <Heading id={headingId} className="ac-panel__title">
            {t(title)}
          </Heading>
          {description ? <p className="muted small">{t(description)}</p> : null}
        </div>
        {actions ? <div className="cluster">{actions}</div> : null}
      </div>
      <div className="ac-panel__body">{children}</div>
    </section>
  );
}

// ── MetricCard ──────────────────────────────────────────────────────────────

/**
 * One figure, and what it means.
 *
 * `note` is not decoration. The dashboard's order-value card says "Ordini
 * creati, non incassati" because calling it revenue would be a lie — most of it
 * is not paid. A metric without that line invites the reader to supply their
 * own, more flattering, meaning.
 *
 * `to` makes the card a link, and the destination MUST use the same definition
 * as the figure. A badge showing four that opens a list of eleven is worse than
 * no badge.
 */
export function MetricCard({
  label,
  value,
  note,
  to,
  variant,
}: {
  label: string;
  value: string | number;
  note?: string;
  to?: string;
  variant?: "headline";
}) {
  const t = useAdminTranslator();
  const base = variant === "headline" ? "ac-metric ac-metric--headline" : "ac-metric";

  const body = (
    <>
      <span className="ac-metric__label">{t(label)}</span>
      <span className="ac-metric__value numeric">{value}</span>
      {note ? <span className="ac-metric__note">{t(note)}</span> : null}
    </>
  );

  return to ? (
    <Link
      to={to}
      className={`ac-metric ac-metric--link${variant === "headline" ? " ac-metric--headline" : ""}`}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

// ── AttentionItem ───────────────────────────────────────────────────────────

/**
 * Something waiting for a person.
 *
 * `count` leads, because the question is "how many" before it is "of what".
 * `tone` is `danger` only when the shop is losing money or cannot trade —
 * everything else is `warning`. A list where every row is red is a list where
 * nothing is urgent.
 */
export function AttentionItem({
  count,
  title,
  body,
  to,
  actionLabel = "Apri",
  tone = "warning",
}: {
  count: number;
  title: string;
  body: string;
  to: string;
  actionLabel?: string;
  tone?: "warning" | "danger";
}) {
  const t = useAdminTranslator();
  return (
    <li className={`ac-action ac-action--${tone}`}>
      <span className="ac-action__count numeric" aria-hidden="true">
        {count}
      </span>
      <div className="ac-action__body">
        <p className="ac-action__label">
          {t(title)}
          {/*
            The badge is hidden from assistive technology because a bare number
            read before its label is noise; it is spoken here as part of a
            sentence instead.
          */}
          <span className="visually-hidden">: {count}</span>
        </p>
        <p className="ac-action__detail small muted">{t(body)}</p>
      </div>
      <Link to={to} className="btn btn--secondary">
        {t(actionLabel)}
        <span className="visually-hidden"> — {t(title)}</span>
      </Link>
    </li>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────────────

/**
 * Nothing here, and what to do about it.
 *
 * The body says WHY it is empty, not just that it is. "Nessun ordine" is true
 * and useless; "when a customer completes an order it appears here, with the
 * payment instructions to send them" tells a new merchant the screen is working
 * and what will fill it.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; to: string };
}) {
  const t = useAdminTranslator();
  return (
    <div className="empty-state">
      <p>
        <strong>{t(title)}</strong>
      </p>
      <p className="small muted">{t(body)}</p>
      {action ? (
        <Link to={action.to} className="btn btn--primary">
          {t(action.label)}
        </Link>
      ) : null}
    </div>
  );
}

// ── FormField ───────────────────────────────────────────────────────────────

/**
 * A labelled control, with its hint and its error.
 *
 * Three things it does that hand-written markup kept forgetting:
 *
 *   - the label is a real `<label htmlFor>`, so tapping it focuses the control,
 *     which on a phone is the difference between a usable form and a fiddly one;
 *   - `aria-describedby` points at BOTH the hint and the error, so a screen
 *     reader hears the guidance and the problem rather than just the label;
 *   - `aria-invalid` is set, so the error is announced as an error rather than
 *     as more text.
 *
 * `hint` explains what the field is FOR. `error` says what is wrong with what
 * was typed. They are different and both can be present.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required: boolean | undefined;
  }) => React.ReactNode;
}) {
  const t = useAdminTranslator();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={error ? "ac-field ac-field--invalid" : "ac-field"}>
      <label htmlFor={id}>
        {t(label)}
        {required ? (
          <>
            {" "}
            <span className="ac-field__required" aria-hidden="true">
              *
            </span>
            <span className="visually-hidden"> {t(" (obbligatorio)")}</span>
          </>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="caption muted">
          {t(hint)}
        </p>
      ) : null}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || undefined,
      })}

      {error ? (
        <p id={errorId} className="ac-field__error small">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

// ── ErrorSummary ────────────────────────────────────────────────────────────

/**
 * Every problem with a submission, at the top, each one a link to its field.
 *
 * On a long form the inline error is below the fold and the merchant sees a
 * page that simply did not save. This is the thing that tells them why, and
 * `tabIndex={-1}` plus `role="alert"` means it is both announced and focusable
 * — the caller focuses it after a failed submit so the keyboard lands on the
 * explanation rather than back at the top of the document.
 */
export function ErrorSummary({
  title = "Non è stato possibile salvare",
  errors,
}: {
  title?: string;
  errors: { field: string; message: string }[];
}) {
  const t = useAdminTranslator();
  if (errors.length === 0) return null;

  return (
    <div className="notice notice--danger ac-error-summary" role="alert" tabIndex={-1}>
      <p>
        <strong>{t(title)}</strong>
      </p>
      <ul>
        {errors.map((e) => (
          <li key={e.field}>
            <a href={`#${e.field}`}>{t(e.message)}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── SaveBar ─────────────────────────────────────────────────────────────────

export type SaveState =
  | { status: "idle"; savedAt?: number | undefined }
  | { status: "saving" }
  | { status: "saved"; savedAt: number }
  | { status: "error"; message: string }
  /** Somebody else saved while this form was open. */
  | { status: "conflict"; message: string };

/**
 * The sticky bar that says whether the work is safe.
 *
 * ── WHY THE SERVER DECIDES ──────────────────────────────────────────────────
 *
 * `saved` is set from a server response and nothing else. A click is not proof,
 * and an optimistic tick that appears before the write lands is the single most
 * expensive lie an admin can tell: the merchant closes the laptop.
 *
 * `conflict` is its own state rather than an error, because the response is
 * different — an error invites a retry, a conflict must not be retried blindly
 * or it overwrites whatever the other person just did.
 */
export function SaveBar({
  state,
  submitLabel = "Salva",
  disabled,
  children,
}: {
  state: SaveState;
  submitLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const t = useAdminTranslator();
  return (
    <div className="ac-savebar">
      <div className="ac-savebar__status" role="status" aria-live="polite">
        {state.status === "saving" ? (
          <span className="small muted">{t("Salvataggio…")}</span>
        ) : state.status === "saved" ? (
          <span className="small">
            {t("Salvato alle ")}
            {timeOf(state.savedAt)}
          </span>
        ) : state.status === "error" ? (
          <span className="small ac-savebar__error">{t(state.message)}</span>
        ) : state.status === "conflict" ? (
          <span className="small ac-savebar__error">{t(state.message)}</span>
        ) : state.savedAt ? (
          <span className="small muted">
            {t("Ultimo salvataggio alle ")}
            {timeOf(state.savedAt)}
          </span>
        ) : null}
      </div>

      <div className="cluster">
        {children}
        <button
          type="submit"
          className="btn btn--primary"
          disabled={disabled || state.status === "saving"}
        >
          {state.status === "saving" ? t("Salvataggio…") : t(submitLabel)}
        </button>
      </div>
    </div>
  );
}

/** Europe/Rome, because that is where the shop is and when the merchant saved. */
function timeOf(epochMs: number): string {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(epochMs));
}

// ── ConfirmationDialog ──────────────────────────────────────────────────────

/**
 * A confirmation for something that cannot be undone.
 *
 * A native `<dialog>`-free implementation on purpose: this shell is
 * server-rendered with no client state, and `<details>` gives a keyboard-
 * operable disclosure for free that works before any script loads.
 *
 * `consequence` is required. "Sei sicuro?" asks the merchant to supply the
 * consequence from memory, and the answer is always yes. Saying what will
 * happen — "gli ordini storici restano intatti" — is what makes the choice real.
 */
export function ConfirmationDialog({
  trigger,
  title,
  consequence,
  confirmLabel,
  tone = "danger",
  children,
}: {
  trigger: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  tone?: "danger" | "warning";
  children?: React.ReactNode;
}) {
  const t = useAdminTranslator();
  return (
    <details className={`ac-confirm ac-confirm--${tone}`}>
      <summary className="btn btn--secondary">{trigger}</summary>
      <div className="ac-confirm__panel">
        <p>
          <strong>{t(title)}</strong>
        </p>
        <p className="small">{consequence}</p>
        {children}
        <button type="submit" className={`btn btn--${tone === "danger" ? "danger" : "primary"}`}>
          {confirmLabel}
        </button>
      </div>
    </details>
  );
}

// ── ActivityTimeline ────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  at: number;
  title: string;
  detail?: string | null;
  actor?: string | null;
}

/**
 * What happened, newest first.
 *
 * An ordered list, because the sequence carries meaning — "payment verified"
 * after "reservation expired" is a different story from the reverse, and a
 * screen reader should hear it as a sequence rather than as loose items.
 *
 * The absolute time, not "3 ore fa". A shop reconciling a bank statement needs
 * the time that is written on the statement.
 */
export function ActivityTimeline({ entries }: { entries: readonly TimelineEntry[] }) {
  const t = useAdminTranslator();
  if (entries.length === 0) {
    return <p className="muted small">{t("Nessuna attività registrata.")}</p>;
  }

  return (
    <ol className="ac-timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="ac-timeline__item">
          <time
            className="ac-timeline__when caption numeric"
            dateTime={new Date(entry.at).toISOString()}
          >
            {fullTimeOf(entry.at)}
          </time>
          <div>
            <strong className="small">{entry.title}</strong>
            {entry.detail ? <p className="small muted">{entry.detail}</p> : null}
            {entry.actor ? <p className="caption muted">{entry.actor}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function fullTimeOf(epochMs: number): string {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  }).format(new Date(epochMs));
}

// ── Skeleton ────────────────────────────────────────────────────────────────

/**
 * A placeholder for content that is on its way.
 *
 * Used sparingly. Everything in this admin is server-rendered, so there is no
 * loading state on a normal page load — this is for the few places a section is
 * fetched after the fact.
 *
 * `aria-hidden` with a live-region label beside it: a screen reader should hear
 * "caricamento" once, not read out a row of grey boxes.
 */
export function Skeleton({ rows = 3, label = "Caricamento" }: { rows?: number; label?: string }) {
  const t = useAdminTranslator();
  return (
    <div className="ac-skeleton">
      <span className="visually-hidden" role="status">
        {t(label)}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ac-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  );
}
