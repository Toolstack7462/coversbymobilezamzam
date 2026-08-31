# Admin design system

The rules the merchant control centre is built from, and the reasons. Where a
rule cost something, the cost is named — a design system that only records the
wins cannot be argued with, and therefore cannot be improved.

The storefront and the admin share one token file, `app/styles/tokens.css`, and
diverge in density and in which components exist. There is no separate
storefront design document — the tokens file carries those decisions in its own
comments, which is worth knowing before looking for one.

---

## Who this is for

One person who owns a phone-accessory shop in Sulmona, plus whoever else works
the counter. Not a merchandising team. That single fact decides most of what
follows:

- **Nobody is trained on this.** The interface has to teach itself, in Italian,
  without a manual open beside it.
- **It is used between customers**, often on a phone, often one-handed, often
  with someone waiting. Anything that takes four clicks will not be done.
- **A mistake here costs real money.** A wrong price, a wrongly verified
  payment, an oversold last unit. Confirmation and reversibility matter more
  than speed.

---

## Light only

There is no dark mode, and this is deliberate rather than unfinished.

A shop's back office is used under shop lighting, next to a window, on a phone
held at arm's length. A dark admin looks considered on a developer's monitor at
night and washes out completely on a counter at midday. Supporting both would
also double the surface every contrast decision has to hold across, and every
status colour below would need a second verified pairing.

**The cost:** anyone who prefers dark interfaces does not get one here. That is
a real loss, accepted knowingly, and it is a two-token change if the merchant
ever asks.

---

## Colour

### Not purple

Hostinger's admin is purple. This one is not, and the reason is not squeamishness
about the resemblance: the palette was chosen for the storefront first, and an
admin that shares the shop's colours is an admin that looks like part of the
same product. Borrowing another company's brand colour would be the only reason
to be purple, which is not a reason.

### Status is never carried by colour alone

Every state in the interface is expressed **three** ways: a word, a shape, and a
colour. A blocking item in the action centre has a red left border, a red-tinted
surface, and the word `obbligatorio`. A completed setup step has a check mark, a
border, and the word `Fatto`.

This is WCAG 1.4.1, but the practical reason is smaller and more common than
colour blindness: the merchant will screenshot a screen and send it on WhatsApp,
where it will be compressed, and will read it on a phone in sunlight.

### Fill and text tokens are separate

`--color-warning` is a border and fill colour. `--color-warning-text` is the
colour of words on that fill. They are different values because a single token
that passes AA as a border fails it as small text on its own surface. Keeping
one token for both is the most common way an accessible palette stops being
accessible.

---

## Typography and numbers

Numbers use `font-variant-numeric: tabular-nums` everywhere — the `.numeric`
class. Prices, stock counts, order numbers and page counts all sit in columns
that are read by comparison, and proportional digits make a column of prices
shift left and right as it scrolls.

Currency is always formatted through `format()` from the money module. Money is
integer minor units throughout (invariant 1); `parseFloat` is banned by lint so
that a float can never get near it.

---

## Density

The admin is denser than the storefront and less dense than a spreadsheet.

- Touch targets are at least 44px (`--target-min`) **including in tables**. The
  compact `.btn--small` inside a row is 32px tall but sits in a row whose own
  padding meets the minimum.
- Table rows are readable at arm's length: 14px, not 12px.
- Secondary columns are marked `secondary` and disappear below 48rem rather than
  being squeezed. Deciding what to drop is the design's job, not the browser's.

---

## Components

| Component     | Where it lives                         | Notes                                           |
| ------------- | -------------------------------------- | ----------------------------------------------- |
| `AdminShell`  | `app/components/admin/admin-shell.tsx` | Sidebar, topbar, drawer. No client JS.          |
| `PageHeader`  | same file                              | One primary action, at most.                    |
| `DataTable`   | `app/components/admin/data-table.tsx`  | Every list. See `docs/admin-table-patterns.md`. |
| Action centre | `app/domain/content/action-centre.ts`  | Pure; the route only renders it.                |
| Setup centre  | `app/domain/content/setup-steps.ts`    | Pure; computed, never stored.                   |

### One primary action per page

`PageHeader` takes a single `primaryAction`. Two competing primary buttons mean
the merchant reads both and trusts neither. Secondary actions are available and
visually subordinate.

---

## No client JavaScript in the shell

The sidebar collapse is a checkbox. The mobile drawer is a `<details>`. Search
is a GET form. Sorting and pagination are links. None of it is a click handler.

This is not minimalism for its own sake. The person using this is in a
stockroom on one bar of signal, and a dashboard that needs its bundle to show
its own navigation is blank exactly when it is needed most. It is enforced by
`tests/browser/no-javascript.spec.ts`, which runs with scripting disabled at the
browser level.

**The cost:** a few interactions are less smooth than a client-side version
would be — the sidebar state does not persist across navigations, and filtering
is a page load rather than an instant filter. Both were judged worth it.

---

## Icons

Inline SVG from the project's own small set, stroked, 20px, `currentColor`.
Never emoji: emoji render differently on every platform, are read aloud by
screen readers with names nobody expects, and cannot inherit a text colour.

---

## Language

The admin is **Italian only**, while the storefront is Italian and English.

This is a deliberate divergence, recorded in
`docs/admin-information-architecture.md`. The staff are Italian; a second admin
locale would double the translation surface and the review burden for an
audience of one shop. If the shop hires someone who needs English, the
infrastructure for it already exists.

Status values, setting keys and error codes are stored in English snake_case and
**always** translated for display. The maps are exhaustive `Record<Status,
string>` types, so adding a status to a domain state machine fails the build
until someone has written the Italian for it.

---

## Writing

- Say what happened and what to do next. "3 prodotti senza prezzo" beats
  "Attenzione".
- Never restate the label in the help text.
- Never claim something is done unless it is. The setup centre computes from
  data for exactly this reason.
- Prefer the merchant's word to the domain's word: "Da preparare", not
  "processing".
- No exclamation marks, no congratulation. Finishing the day's payment
  verification is a job, not an achievement.
