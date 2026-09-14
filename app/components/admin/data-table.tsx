import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Link, Form } from "react-router";
import {
  buildTableQuery,
  sortLink,
  ariaSort,
  type TableState,
  type TableSpec,
  type Pagination,
} from "~/lib/table-params";

/**
 * The shared table.
 *
 * Every list in the admin is this component, so that learning one list teaches
 * all of them. Its defining constraint: **it works with JavaScript disabled.**
 * Tabs, sort headings and pagination are links; search is a GET form; bulk
 * actions are a POST form. Nothing is a click handler.
 *
 * That is not nostalgia. A shop assistant on a phone in a stockroom with one
 * bar of signal gets HTML long before they get a hydrated bundle, and a table
 * that needs its bundle to sort is a table that is broken exactly when it is
 * needed most.
 *
 * On narrow screens the same markup becomes a list of cards through CSS alone
 * — no second component, so the two can never drift apart.
 */

export interface Column<Row> {
  /** Matches a key in the spec's `sortable` list when the column can sort. */
  key: string;
  header: string;
  render: (row: Row) => React.ReactNode;
  /** Right-aligns and applies tabular figures. For money and counts. */
  numeric?: boolean;
  /** Hidden below the card breakpoint, where space is scarce. */
  secondary?: boolean;
  /**
   * A width hint, applied through `<colgroup>`.
   *
   * Semantic rather than a pixel value, because a data table's columns have to
   * negotiate with their content and a hardcoded width loses that argument the
   * first time a product is called something long:
   *
   *   `shrink`  take only what the content needs — thumbnails, badges, actions
   *   `wide`    take the remaining space — the column carrying the name
   *
   * Added when the product list gained image, SKU and stock columns and every
   * name started wrapping onto three lines. Without a hint the browser shares
   * width equally, which gives a 40px thumbnail the same room as a product
   * title.
   */
  width?: "shrink" | "wide";
  /**
   * Forbids wrapping inside the cell.
   *
   * For identifiers — a SKU, an order number — where a line break in the
   * middle of the token makes it unreadable and, worse, unsearchable by eye.
   * The cell truncates with an ellipsis instead, and keeps its full value as a
   * title so nothing is lost.
   */
  nowrap?: boolean;
}

export interface SavedView {
  slug: string;
  label: string;
  /** Shown beside the label. Omitted, not zero, when there is nothing. */
  count?: number | undefined;
}

interface Props<Row> {
  state: TableState;
  spec: TableSpec;
  pagination: Pagination;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Where each row links. Omit for tables whose rows have no detail page. */
  rowHref?: (row: Row) => string;
  views?: SavedView[];
  /** Placeholder for the search box. Omit to hide search entirely. */
  searchLabel?: string;
  /** Shown when the unfiltered table is genuinely empty. */
  emptyState: { title: string; body: string; action?: { label: string; to: string } };
  /** Bulk actions post here with `ids`. Omit for read-only tables. */
  bulkActions?: { action: string; options: { value: string; label: string }[] };
}

export function DataTable<Row>({
  state,
  spec,
  pagination,
  columns,
  rows,
  rowKey,
  rowHref,
  views,
  searchLabel,
  emptyState,
  bulkActions,
}: Props<Row>) {
  const t = useAdminTranslator();
  const filtered = state.q !== "" || Object.keys(state.filters).length > 0;

  return (
    <div className="ac-table-wrap stack">
      {views && views.length > 1 ? <ViewTabs views={views} state={state} spec={spec} /> : null}

      {searchLabel ? <SearchBox state={state} spec={spec} label={searchLabel} /> : null}

      {rows.length === 0 ? (
        filtered ? (
          // A filtered list with no matches is not an empty shop. Saying "add
          // your first product" here would be wrong and slightly insulting.
          <div className="empty-state">
            <p>
              <strong>{t("Nessun risultato")}</strong>
            </p>
            <p className="small muted">
              {t(
                "Nessuna riga corrisponde ai filtri attivi. Il resto dei dati è ancora al suo posto.",
              )}
            </p>
            <p>
              <Link className="btn btn--secondary" to={clearFilters(state, spec)}>
                {t("Rimuovi i filtri")}
              </Link>
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <p>
              <strong>{t(emptyState.title)}</strong>
            </p>
            <p className="small muted">{t(emptyState.body)}</p>
            {emptyState.action ? (
              <p>
                <Link className="btn btn--primary" to={emptyState.action.to}>
                  {t(emptyState.action.label)}
                </Link>
              </p>
            ) : null}
          </div>
        )
      ) : (
        <FormOrDiv bulkActions={bulkActions}>
          <div
            className="ac-table-scroll"
            /* See the note in the admin routes: a sideways-scrolling
               box that cannot be focused cannot be scrolled without a
               mouse. */
            tabIndex={0}
            role="region"
            aria-label={t("Tabella scorrevole")}
          >
            <table className="ac-table">
              {/*
                Column widths belong in `<colgroup>`, not on each cell: it is
                the mechanism the table layout algorithm actually reads, and
                setting a width on every `<td>` means the decision is repeated
                once per row and can disagree with itself.
              */}
              <colgroup>
                {bulkActions ? <col className="ac-col--shrink" /> : null}
                {columns.map((col) => (
                  <col key={col.key} className={col.width ? `ac-col--${col.width}` : undefined} />
                ))}
                <col className="ac-col--shrink" />
              </colgroup>
              <thead>
                <tr>
                  {bulkActions ? (
                    <th scope="col" className="ac-table__select">
                      <span className="visually-hidden">{t("Seleziona")}</span>
                    </th>
                  ) : null}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        spec.sortable.includes(col.key) ? ariaSort(state, col.key) : undefined
                      }
                      className={[
                        col.numeric ? "ac-table__numeric" : "",
                        col.secondary ? "ac-table__secondary" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {spec.sortable.includes(col.key) ? (
                        <Link to={sortLink(state, spec, col.key)} className="ac-table__sort">
                          {t(col.header)}
                          {/*
                            The arrow is decorative: aria-sort on the cell is
                            what a screen reader announces.
                          */}
                          <span aria-hidden="true" className="ac-table__arrow">
                            {state.sort?.key === col.key
                              ? state.sort.direction === "asc"
                                ? "↑"
                                : "↓"
                              : "↕"}
                          </span>
                        </Link>
                      ) : (
                        col.header
                      )}
                    </th>
                  ))}
                  {rowHref ? (
                    <th scope="col">
                      <span className="visually-hidden">{t("Azioni")}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <tr key={key}>
                      {bulkActions ? (
                        <td className="ac-table__select">
                          <input
                            type="checkbox"
                            name="ids"
                            value={key}
                            aria-label={t("Seleziona {{v0}}", { v0: key })}
                          />
                        </td>
                      ) : null}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          data-label={t(col.header)}
                          className={[
                            col.numeric ? "ac-table__numeric numeric" : "",
                            col.secondary ? "ac-table__secondary" : "",
                            col.nowrap ? "ac-table__nowrap" : "",
                            col.width ? `ac-table__${col.width}` : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                      {rowHref ? (
                        <td className="ac-table__actions">
                          {/*
                            An explicit link, not a click handler on the row. A
                            clickable <tr> is invisible to the keyboard and
                            cannot be opened in a new tab.
                          */}
                          <Link to={rowHref(row)} className="btn btn--ghost btn--small">
                            {t("Apri")}
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {bulkActions ? <BulkBar bulkActions={bulkActions} /> : null}
        </FormOrDiv>
      )}

      {rows.length > 0 ? <Paginator state={state} spec={spec} pagination={pagination} /> : null}
    </div>
  );
}

function FormOrDiv({
  bulkActions,
  children,
}: {
  bulkActions: Props<unknown>["bulkActions"];
  children: React.ReactNode;
}) {
  return bulkActions ? (
    <Form method="post" action={bulkActions.action}>
      {children}
    </Form>
  ) : (
    <>{children}</>
  );
}

function BulkBar({ bulkActions }: { bulkActions: NonNullable<Props<unknown>["bulkActions"]> }) {
  const t = useAdminTranslator();
  return (
    <div className="ac-bulk">
      <label htmlFor="bulk-action" className="small">
        {t("Azione sulle righe selezionate")}
      </label>
      <select id="bulk-action" name="bulkAction" defaultValue="">
        <option value="" disabled>
          {t("Scegli…")}
        </option>
        {bulkActions.options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn--secondary">
        {t("Applica")}
      </button>
      <p className="caption muted">
        {t("Le azioni in blocco chiedono conferma e vengono registrate nel registro attività.")}
      </p>
    </div>
  );
}

function ViewTabs({
  views,
  state,
  spec,
}: {
  views: SavedView[];
  state: TableState;
  spec: TableSpec;
}) {
  const t = useAdminTranslator();
  return (
    <nav className="ac-views" aria-label={t("Viste salvate")}>
      <ul>
        {views.map((view) => {
          const active = view.slug === state.view;
          return (
            <li key={view.slug}>
              <Link
                to={buildTableQuery(state, spec, { view: view.slug, page: 1 })}
                className={active ? "ac-view ac-view--active" : "ac-view"}
                aria-current={active ? "page" : undefined}
              >
                {t(view.label)}
                {/* Omitted rather than shown as zero — see the action centre. */}
                {view.count !== undefined && view.count > 0 ? (
                  <span className="ac-view__count numeric">{view.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SearchBox({ state, spec, label }: { state: TableState; spec: TableSpec; label: string }) {
  const t = useAdminTranslator();
  return (
    // A GET form, so the result is a real URL the merchant can bookmark.
    <form method="get" className="ac-search" role="search">
      {/* The view and facets ride along as hidden fields, or searching would
          silently reset them. */}
      {state.view && state.view !== spec.views[0] ? (
        <input type="hidden" name="vista" value={state.view} />
      ) : null}
      {Object.entries(state.filters).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <label htmlFor="table-search" className="visually-hidden">
        {t(label)}
      </label>
      <input
        id="table-search"
        type="search"
        name="q"
        defaultValue={state.q}
        placeholder={t(label)}
        autoComplete="off"
      />
      <button type="submit" className="btn btn--secondary">
        {t("Cerca")}
      </button>
      {state.q ? (
        <Link className="btn btn--ghost" to={buildTableQuery(state, spec, { q: "", page: 1 })}>
          {t("Annulla")}
        </Link>
      ) : null}
    </form>
  );
}

function Paginator({
  state,
  spec,
  pagination,
}: {
  state: TableState;
  spec: TableSpec;
  pagination: Pagination;
}) {
  const t = useAdminTranslator();
  const { page, totalPages, total, firstRow, lastRow, hasPrevious, hasNext } = pagination;

  return (
    <nav className="ac-pagination" aria-label={t("Paginazione")}>
      <p className="small muted">
        <span className="numeric">
          {firstRow}–{lastRow}
        </span>{" "}
        {t("di ")}
        <span className="numeric">{total}</span>
      </p>

      <div className="cluster">
        {hasPrevious ? (
          <Link
            className="btn btn--secondary"
            to={buildTableQuery(state, spec, { page: page - 1 })}
          >
            {t("Precedente")}
          </Link>
        ) : (
          // Rendered as inert text rather than a disabled link: a disabled
          // anchor is still focusable and announces as a link that does nothing.
          <span className="btn btn--secondary is-inert" aria-hidden="true">
            {t("Precedente")}
          </span>
        )}

        <span className="small">
          {t("Pagina ")}
          <span className="numeric">{page}</span> {t(" di")}{" "}
          <span className="numeric">{totalPages}</span>
        </span>

        {hasNext ? (
          <Link
            className="btn btn--secondary"
            to={buildTableQuery(state, spec, { page: page + 1 })}
          >
            {t("Successiva")}
          </Link>
        ) : (
          <span className="btn btn--secondary is-inert" aria-hidden="true">
            {t("Successiva")}
          </span>
        )}
      </div>
    </nav>
  );
}

function clearFilters(state: TableState, spec: TableSpec): string {
  return buildTableQuery(state, spec, { q: "", filters: {}, page: 1 });
}
