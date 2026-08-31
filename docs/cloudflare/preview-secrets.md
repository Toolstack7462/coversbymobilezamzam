# Preview secrets

**No secret value appears in this file, in the repository, or in any transcript.**
That is the point of the page: it records which secrets exist and how they were
handled, so nobody has to reconstruct that from memory later.

---

## What is set on the preview Worker

| Name                        | Required  | Purpose                                      |
| --------------------------- | --------- | -------------------------------------------- |
| `BETTER_AUTH_SECRET`        | yes       | Session and cart-token signing               |
| `SETTINGS_ENCRYPTION_KEY`   | yes       | AES-GCM key for merchant payment identifiers |
| `INITIAL_ADMIN_SETUP_TOKEN` | for setup | Gates `/admin/installazione`, one-time use   |

Read the current list with:

    npx wrangler secret list --env preview

That prints names only. Cloudflare cannot show a secret's value after it is
written, to anyone, including the account owner — which is the correct design
and the reason the setup token had to be captured at the moment of creation.

## What is NOT set, and what that means

| Absent                              | Consequence                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `RESEND_API_KEY`, `EMAIL_FROM`      | No email is sent. The outbox still records events, so nothing is lost.    |
| `TURNSTILE_SITE_KEY` / `SECRET_KEY` | No bot protection on high-risk forms.                                     |
| `PUBLIC_MEDIA_BASE_URL`             | Images are served by the Worker's own `/media/*` route rather than a CDN. |

Each absence **gates a feature off** rather than breaking one (invariant 12). A
preview with no email provider is a valid state, not a misconfiguration.

`APP_BASE_URL` is required by the validator but is **not** a secret: it is the
public URL of the site. It lives in `vars` in `wrangler.jsonc`, where it can be
reviewed in a diff.

---

## How the values were generated and handed over

`BETTER_AUTH_SECRET` and `SETTINGS_ENCRYPTION_KEY` are machine-generated random
values that no human ever needs to see. They were piped directly from
`crypto.randomBytes` into `wrangler secret put` — never written to a file, never
passed as a command-line argument (argv is visible in process listings), never
printed.

`INITIAL_ADMIN_SETUP_TOKEN` is different: a person has to type it once, into the
installation form. It was generated, written to the Windows clipboard, and piped
to Wrangler in a single step, with progress messages sent to stderr so that
stdout carried only the secret into the pipe. It was never displayed.

**The token must be saved to a password manager immediately.** Cloudflare will
not show it again, and the clipboard is one copy away from being lost.

## After the first administrator exists

1. Confirm `/admin/installazione` returns **404**. The route closes itself
   permanently once installation completes; if it does not, stop and
   investigate before anything else.
2. Clear the clipboard.
3. Delete the token:

       npx wrangler secret delete INITIAL_ADMIN_SETUP_TOKEN --env preview

   The setup route already refuses to run once installed, so this is defence in
   depth rather than the control itself. It is worth doing anyway: a secret that
   no longer has a purpose is only a liability.

---

## Rules that do not bend

- Never in `wrangler.jsonc`, `.dev.vars`, a committed file, or a screenshot.
- Never as a command-line argument.
- Never in a URL — not even a one-time setup token, because URLs end up in
  browser history, server logs and referrer headers.
- Never pasted into a chat, an issue, or a commit message.
- If a secret is ever exposed, **rotate it**. A leaked secret that was
  "probably fine" is a leaked secret.
