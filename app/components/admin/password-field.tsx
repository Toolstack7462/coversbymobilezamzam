import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FormField } from "./patterns";
import { useAdminTranslator } from "./use-admin-translator";

/**
 * The one password input in the admin.
 *
 * There were twelve `type="password"` inputs across nine screens and not one of
 * them could be revealed. A merchant typing a long generated password into a
 * field they cannot read — to confirm a payment, or to enrol a second factor —
 * gets a single signal when it fails, "wrong password", and no way to tell a
 * typo from a password they have genuinely forgotten. That is the whole reason
 * this exists.
 *
 * It wraps `FormField` rather than repeating its markup, so the label, the
 * required marker, the hint and the error keep behaving exactly as they do on
 * every other admin field, and there is one place to change them.
 *
 * ── WHY THE TOGGLE IS A SIBLING, NOT AN OVERLAY ─────────────────────────────
 *
 * The usual implementation absolutely-positions the button inside the input's
 * right edge. That is exactly where Chrome, Safari and every password manager
 * put THEIR icon, so the two overlap: our button sits under 1Password's key, or
 * the browser's own reveal control sits under ours, and on a phone the tap
 * lands on whichever won the z-index.
 *
 * A flex row with the button beside the input cannot overlap anything, gets a
 * full-size tap target for free, and leaves the input's own padding alone. It
 * costs a little horizontal space and is the only version that is correct in
 * every browser rather than in the one it was built in.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It never asks the server for anything. Revealing is a `type` attribute change
 * on a value the person at the keyboard just typed: no request, no stored
 * password, no other account's credential. There is a test asserting the toggle
 * makes no network call, because "show password" is precisely the feature
 * somebody would one day implement by fetching one.
 *
 * It never writes the value or the visibility state anywhere — no
 * `localStorage`, no URL, no analytics. Visibility lives in component state, so
 * navigation or a reload always comes back masked.
 */

export interface PasswordFieldProps {
  id: string;
  name: string;
  label: string;
  /**
   * `current-password` for a password the person already has, `new-password`
   * for one they are choosing.
   *
   * Required rather than defaulted: this is what stops a password manager
   * filling the old password into a "new password" box, and a default would let
   * a new screen inherit the wrong value silently.
   *
   * `off` exists for exactly one field — the first-run setup token, which is a
   * masked secret pasted from elsewhere and must never be offered by, or saved
   * into, a password manager as if it were an account credential.
   */
  autoComplete: "current-password" | "new-password" | "off";
  required?: boolean;
  /**
   * Disables the input AND the toggle together.
   *
   * A reveal button that stays live beside a disabled input is a control that
   * does nothing, which is worse than one that is visibly unavailable.
   */
  disabled?: boolean;
  hint?: string;
  error?: string | undefined;
  /** Shown BEFORE submission, so the rule is not learned by failing. */
  requirements?: readonly string[];
  autoFocus?: boolean;
  minLength?: number;
}

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  required,
  hint,
  error,
  requirements,
  autoFocus,
  minLength,
  disabled,
}: PasswordFieldProps) {
  /*
   * The control speaks the staff language, not a hard-coded one.
   *
   * Its own strings used to be Italian literals. Once the admin became
   * bilingual that made the reveal button the one part of a translated screen
   * still speaking Italian — and this is a control whose whole job is telling
   * somebody what pressing it will do.
   */
  const t = useAdminTranslator();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  /*
   * Where the caret was when the type changed.
   *
   * Switching an input between `password` and `text` sends the caret to the end
   * in WebKit and drops the selection in Chrome. Somebody who reveals a password
   * to check one character in the middle of it should not have to find their
   * place again afterwards.
   */
  const caret = useRef<{ start: number | null; end: number | null } | null>(null);

  const capsId = `${id}-caps`;
  const requirementsId = requirements?.length ? `${id}-requirements` : undefined;

  const toggle = useCallback(() => {
    const element = input.current;
    if (element) {
      caret.current = { start: element.selectionStart, end: element.selectionEnd };
    }
    setVisible((wasVisible) => !wasVisible);
  }, []);

  // Restore the caret once React has applied the new `type`.
  useLayoutEffect(() => {
    const element = input.current;
    const saved = caret.current;
    if (!element || !saved) return;
    caret.current = null;

    if (document.activeElement !== element) return;
    try {
      element.setSelectionRange(saved.start, saved.end);
    } catch {
      // Some browsers refuse setSelectionRange on a password input. Losing the
      // caret is a far smaller problem than throwing inside a click handler.
    }
  }, [visible]);

  /*
   * Re-mask when the page is hidden.
   *
   * A revealed password left on screen while the merchant switches to their
   * banking tab, or puts the phone down with the browser in the background, is
   * readable by whoever picks it up and by anything that captures the tab.
   * Coming back to a masked field costs one click and removes that.
   */
  useEffect(() => {
    if (!visible) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") setVisible(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [visible]);

  /*
   * Re-mask on submit.
   *
   * Found by the test, not by reasoning: reveal the password, submit, get the
   * password wrong. The action returns an error, React Router re-renders the
   * same component — and because it is the SAME component, `visible` survives.
   * The rejected password stayed legible on screen, on the one screen where
   * somebody is most likely to give up and walk away from the keyboard.
   *
   * Listening on the owning form rather than taking an `onSubmit` prop: every
   * caller would have to remember to pass it, and the one that forgot would be
   * the one that leaked. The listener is attached to `element.form`, so a field
   * outside a form simply has nothing to listen to.
   */
  useEffect(() => {
    if (!visible) return;
    const form = input.current?.form;
    if (!form) return;

    const remask = () => setVisible(false);
    form.addEventListener("submit", remask);
    return () => form.removeEventListener("submit", remask);
  }, [visible]);

  const trackCapsLock = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    // `getModifierState` is absent on some synthetic events.
    if (typeof event.getModifierState !== "function") return;
    setCapsLock(event.getModifierState("CapsLock"));
  }, []);

  return (
    <FormField
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(required === undefined ? {} : { required })}
    >
      {(field) => (
        <>
          {requirements?.length ? (
            <ul id={requirementsId} className="caption muted ac-password__requirements">
              {requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : null}

          <div className="ac-password">
            <input
              ref={input}
              id={field.id}
              name={name}
              type={visible ? "text" : "password"}
              className="input ac-password__input"
              autoComplete={autoComplete}
              /*
               * Deliberate: a phone keyboard must not capitalise the first
               * character of a password, and a revealed password must not be
               * sent to a spell-checking service.
               */
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              {...(field.required ? { required: true } : {})}
              {...(disabled ? { disabled: true } : {})}
              {...(minLength === undefined ? {} : { minLength })}
              {...(autoFocus ? { autoFocus: true } : {})}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={
                [field["aria-describedby"], requirementsId, capsLock ? capsId : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              onBlur={() => setCapsLock(false)}
            />
            <button
              type="button"
              className="btn btn--ghost ac-password__toggle"
              onClick={toggle}
              {...(disabled ? { disabled: true } : {})}
              aria-controls={field.id}
              aria-pressed={visible}
            >
              {visible ? t("Nascondi password") : t("Mostra password")}
            </button>
          </div>

          {/*
            Caps Lock — the single most common reason a correct password is
            rejected.

            The region is in the DOM from first render and filled later, rather
            than inserted when the key is pressed, because a live region that
            appears at the same moment as its content is announced unreliably.
            It is hidden by CSS while empty. This is the accepted pattern; it has
            NOT been verified here against an actual screen reader.
          */}
          <p className="caption muted ac-password__caps" id={capsId} role="status">
            {capsLock ? t("Bloc Maiusc è attivo.") : ""}
          </p>
        </>
      )}
    </FormField>
  );
}
