# Admin table patterns

Every list in the admin is one component, `DataTable`, driven by one state
model, `table-params.ts`. Learning one list teaches all of them.

Not every screen is a table, and the exceptions are listed at the end with the
reason each one earns.

---

## All state lives in the URL

View, page, sort, search and facets are query parameters. Nothing is component
state and nothing is stored server-side per user.

| Parameter     | Meaning                | Example                |
| ------------- | ---------------------- | ---------------------- |
| `vista`       | saved view             | `?vista=da-verificare` |
| `q`           | search text            | `?q=iphone%2015`       |
| `ordina`      | sort key, `-` for desc | `?ordina=-total`       |
| `pagina`      | page number, 1-based   | `?pagina=3`            |
| `per-pagina`  | page size              | `?per-pagina=50`       |
| _facet names_ | declared per table     | `?consegna=ritiro`     |

This is not a stylistic preference. It is what makes four separate things work
at once:

1. **The back button behaves.** Filter a list, open an order, press back, and
   you are in the filtered list — not at the top of an unfiltered one.
2. **A filtered list is a link.** "Look at these five" can be sent to a
   colleague.
3. **Deep links need no second mechanism.** The action centre points at
   `/admin/pagamenti?vista=da-verificare` using the same parameters a human
   would produce by clicking.
4. **It works without JavaScript**, because every control is a link or a GET
   form.

### Defaults are omitted

`buildTableQuery` leaves out any value that equals the default, so the plain
list has a clean address and one list has one canonical URL rather than a dozen
equivalent ones.

---

## Parsing is defensive, because the URL is user input

Query strings arrive from bookmarks, from other people's links, and from
hand-editing. `parseTableParams` therefore treats every value as hostile:

- **An undeclared sort key falls back** to the default. It never reaches the
  query builder. `orderByClause` maps declared keys to columns through a table
  the caller supplies, so no user-supplied string ever becomes SQL.
- **`per-pagina` is capped at 100.** `?per-pagina=100000` against D1 is
  otherwise a cheap way for anyone with a staff login to time out the Worker.
- **A page below 1 becomes 1**, and a page past the end clamps to the last page
  — a bookmark to page 9 of a list that has since shrunk shows the last results
  rather than an empty table with no explanation.
- **Undeclared facet values are dropped**, not passed through.
- **Search whitespace is collapsed**, so `"  iphone   15 "` and `"iphone 15"`
  are one query.

---

## ORDER BY is never empty

`orderByClause` always returns a clause, and every list query appends a unique
tiebreaker (`, p.id`). An unordered page in SQLite is not stable: rows can
appear on two pages or on none as the merchant pages through, which looks
exactly like data loss.

`tests/integration/product-views.test.ts` proves this against real D1 by paging
through twelve rows that share one timestamp.

---

## Saved views are a contract

The view slugs live in their own modules — `app/lib/product-views.ts`,
`order-views.ts`, `inventory-views.ts` — not in the routes.

They are a contract between screens that do not import each other. The action
centre links to `?vista=senza-prezzo`; the products route decides whether that
value exists. **Nothing in TypeScript connects those two facts.** Rename a slug
and the links keep compiling, keep looking right, and silently land on the
default view — a bug that hides because the page still loads.

`tests/unit/deep-links.test.ts` is that connection. It asserts every `?vista=`
in the action centre and the setup centre resolves against the list that parses
it, that no deep link uses a parameter name the lists do not read, and that
facet values are declared. Screens with no saved views yet are listed
explicitly, so their absence is a recorded decision rather than a silent gap.

`tests/integration/*-views.test.ts` then executes every clause against real D1,
because a clause naming a column that a migration renamed passes every unit test
and throws a 500 on first click.

### Views are phrased as jobs

"Da contattare", "Da preparare", "Pronti" — not "processing", not "awaiting
customer contact". The merchant is not asking which orders are in a given
status; they are asking which ones go in a bag today.

### Tab counts ignore the search box

A tab whose number moves as you type is telling you about your query, not about
your shop.

### Counts elsewhere are built from the same clauses

The dashboard metrics and the action centre import the view clauses rather than
restating them. A badge reading 4 that opens a list of 7 is read as broken
software, with the merchant left to reconcile it. Deriving both from one source
makes that drift impossible rather than merely tested for.

---

## Mobile: the same markup becomes cards

Below 48rem the table becomes a stack of cards **through CSS alone**. There is
no second component, so the two can never drift apart.

- `<thead>` is visually hidden but stays in the accessibility tree — the headers
  are what make the cells mean anything. `display: none` would remove both.
- Each cell prints its header from `data-label` via `::before`.
- Columns marked `secondary` are dropped. Choosing what to lose is the design's
  job, not the browser's.

---

## Accessibility

- `aria-sort` on every sortable header, including `none` on the inactive ones.
  The arrow glyph is `aria-hidden`: it is decoration, and `aria-sort` is what is
  announced.
- Rows carry an explicit `Apri` link, never a click handler on the `<tr>`. A
  clickable row is unreachable by keyboard and cannot be opened in a new tab.
- Pagination's unavailable ends render as inert text, not disabled links. A
  disabled anchor still takes focus and announces as a link that does nothing.
- Bulk-action checkboxes are labelled per row.

---

## Empty states say which kind of empty

Two different situations, two different messages:

- **A filtered list with no matches** says so and offers to clear the filters.
  Telling a merchant with 400 products to "add your first product" is wrong and
  slightly insulting.
- **A genuinely empty table** explains what will appear here and offers the
  action that creates the first one.

---

## Screens that are deliberately not tables

| Screen                | Why                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment verification  | Verification is a judgement. Expected, claimed and received amounts, the reference, the duplicate check and the reservation clock must all be visible at the moment of deciding. A row cannot hold that honestly. |
| Inventory adjustments | An adjustment needs a quantity, a reason and a note beside the current count.                                                                                                                                     |
| Settings              | Grouped form with per-field help, not a grid of key/value rows.                                                                                                                                                   |

All three still use the URL-state convention, so deep links land correctly and
the back button behaves the same way everywhere.

---

## Adding a list

1. Add a `*-views.ts` module with slugs and complete SQL `where` fragments.
   Fragments are written in full and never built from request data.
2. Define a `TableSpec`: views, sortable keys, default sort, facets, page size.
3. Map sort keys to columns in a `SORT_COLUMNS` record. Never interpolate a
   request value.
4. In the loader: `parseTableParams`, then one count query, one page query with
   `orderByClause` plus a tiebreaker, and one tab-count query.
5. Render `<DataTable>`.
6. Add the module to `tests/unit/deep-links.test.ts` and its clauses to the
   integration view test. Both are cheap and both catch failures that look fine
   on screen.
