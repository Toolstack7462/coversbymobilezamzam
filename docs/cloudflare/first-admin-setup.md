# Creating the first administrator

The preview is deployed and waiting for you to create the first account. Nobody
else can do this step, and that is deliberate: **the password must be one only
you know.** It was never chosen, seen, or stored by anyone building this.

    https://italian-tech-atelier-commerce-preview.genzdigitaltools7462.workers.dev/admin/installazione

---

## Before you start

You need two things to hand:

1. **The setup token.** It was placed in your clipboard during installation and
   you were asked to save it in a password manager. It is a long random string.
   It has never been printed to a screen, written to a file, put in a URL, or
   committed to the repository — so if it is not in your password manager, it is
   gone, and it has to be replaced (see [If you no longer have the
   token](#if-you-no-longer-have-the-token)).

2. **An authenticator app** on your phone — Google Authenticator, Microsoft
   Authenticator, 1Password, Aegis, or any other. You will scan a QR code during
   setup and the app will produce a six-digit code that changes every thirty
   seconds.

Set aside ten uninterrupted minutes. The middle of this process is the one point
where stopping half-way is genuinely awkward.

---

## The steps

### 1. Open the setup page

Go to the address above. You should see **Configurazione iniziale**. If you
instead see a login form, the installation has already been completed — stop and
say so, because it should not have been.

### 2. Fill in the form

| Field                  | What to put                                          |
| ---------------------- | ---------------------------------------------------- |
| Nome                   | Your name, as you want it to appear in the audit log |
| Email                  | The address you will sign in with                    |
| Password               | See below                                            |
| Conferma password      | The same password again                              |
| Token di installazione | The setup token from your password manager           |

**About the password.** Minimum twelve characters, and it is worth more than
that. This account can verify payments and change the bank details customers
are told to pay into, so it deserves a password that protects money rather than
one that protects a mailing list. Generate a random one in your password
manager and let the manager remember it — do not invent one you can type from
memory, and do not reuse anything.

Paste the setup token rather than typing it. It is deliberately long.

### 3. Save it before you submit

Put the email and password in your password manager **now**, before pressing the
button. There is no "forgot password" on this preview — email sending is not
configured, so a reset link would go nowhere.

### 4. Set up two-factor authentication

Immediately after the account is created you will be taken to two-factor setup.
Do not skip this and come back later.

- Scan the QR code with your authenticator app.
- Type the six-digit code it shows to confirm.
- **Write down the recovery codes** the page gives you and put them somewhere
  physical — a safe, a drawer at home. They are what gets you in when your phone
  is lost, broken, or replaced. Each one works once.

Nobody should ever ask you for the QR code, the secret behind it, your recovery
codes, or your password. Not the person who built this, not support, not anyone.
There is no legitimate reason for that request.

### 5. Sign in properly, once

Sign out and sign back in from the beginning: email, password, then a code from
your phone. This confirms the whole loop works while you are still sitting in
front of it, rather than at eight in the morning before the shop opens.

---

## After you are in

The dashboard opens on **Configurazione** — a checklist of what still needs
filling in before the shop could take a real order. Everything is currently
demo data.

Everything you see is invented. The products, prices, stock levels and
compatibility are test data prefixed `[DEMO]`, and every page carries a banner
saying so. **No payment method is connected and no real order can be placed.**

---

## If you no longer have the token

Nothing is lost. The token is replaced rather than recovered:

    npx wrangler secret put INITIAL_ADMIN_SETUP_TOKEN --env preview

Paste a new long random value when prompted, then reload the setup page. It is
never recoverable by design — a secret that can be looked up later is a secret
that can be looked up by somebody else.

---

## Once setup is done

Tell whoever set this up, so the setup token can be removed. It has no further
purpose: the installation page closes permanently after the first
administrator exists, and a leftover credential that opens nothing is still a
credential to look after.

Then clear your clipboard, if the token is still in it.
