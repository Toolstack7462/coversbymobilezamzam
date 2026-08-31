/**
 * Table state lives in the URL. All of it.
 *
 * Which view, which page, which sort, which search — every one is a query
 * parameter. That is not a stylistic choice; it is what makes the rest work:
 *
 *   - The back button behaves. A merchant who filters, opens an order and
 *     presses back returns to the filtered list, not the top of an unfiltered
 *     one.
 *   - A filtered list can be sent to a colleague as a link.
 *   - The Action Centre can deep-link straight to "payments awaiting
 *     verification" without inventing a second mechanism.
 *   - The whole table works with JavaScript disabled, because every control is
 *     a link or a GET form.
 *
 * Everything here is pure and parses defensively: query strings arrive from
 * bookmarks, from other people's links and from hand-editing, so an unknown
 * sort key must fall back rather than reach SQL.
 */

export interface ColumnSort {
  /** A key the caller has declared sortable. Never user-supplied text. */
  key: string;
  direction: "asc" | "desc";
}

export interface TableState {
  /** The active saved view, e.g. "da-verificare". */
  view: string;
  page: number;
  perPage: number;
  sort: ColumnSort | null;
  /** Trimmed free-text search, or "" when absent. */
  q: string;
  /** Extra facet filters the caller declared, e.g. { consegna: "ritiro" }. */
  filters: Record<string, string>;
}

export interface TableSpec {
  /** Allowed view slugs. The first is the default. */
  views: readonly string[];
  /** Allowed sort keys. Anything else is ignored. */
  sortable: readonly string[];
  /** Default sort applied when the URL says nothing. */
  defaultSort?: ColumnSort;
  /** Allowed facet parameter names, each with its allowed values. */
  facets?: Readonly<Record<string, readonly string[]>>;
  perPage?: number;
}

export const DEFAULT_PER_PAGE = 25;

/**
 * A hard ceiling on page size.
 *
 * Not a nicety: `?perPage=100000` on a table over a D1 database is a cheap way
 * for anyone with a staff login to make the Worker time out.
 */
export const MAX_PER_PAGE = 100;

/** Parses a query string into table state, discarding anything not declared. */
export function parseTableParams(params: URLSearchParams, spec: TableSpec): TableState {
  const requestedView = params.get("vista") ?? "";
  const view = spec.views.includes(requestedView) ? requestedView : (spec.views[0] ?? "");

  const page = clampPage(params.get("pagina"));

  const requestedPerPage = Number.parseInt(params.get("per-pagina") ?? "", 10);
  const perPage =
    Number.isInteger(requestedPerPage) && requestedPerPage > 0
      ? Math.min(requestedPerPage, MAX_PER_PAGE)
      : (spec.perPage ?? DEFAULT_PER_PAGE);

  const sort = parseSort(params.get("ordina"), spec);

  const filters: Record<string, string> = {};
  for (const [name, allowed] of Object.entries(spec.facets ?? {})) {
    const value = params.get(name);
    if (value !== null && allowed.includes(value)) filters[name] = value;
  }

  return {
    view,
    page,
    perPage,
    sort,
    // Collapse runs of whitespace so " iphone   15 " and "iphone 15" are one
    // cache key and one query.
    q: (params.get("q") ?? "").trim().replace(/\s+/g, " "),
    filters,
  };
}

function clampPage(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Sort is encoded as `key` or `-key`. The leading minus is the only direction
 * syntax, so there is no second parameter to fall out of step with the first.
 */
function parseSort(raw: string | null, spec: TableSpec): ColumnSort | null {
  if (!raw) return spec.defaultSort ?? null;

  const direction = raw.startsWith("-") ? "desc" : "asc";
  const key = raw.startsWith("-") ? raw.slice(1) : raw;

  // An undeclared key falls back rather than reaching the query builder.
  if (!spec.sortable.includes(key)) return spec.defaultSort ?? null;
  return { key, direction };
}

/**
 * Rebuilds a query string from state, with an optional patch.
 *
 * Defaults are omitted so the common URL stays short and one list has one
 * canonical address rather than a dozen equivalent ones.
 */
export function buildTableQuery(
  state: TableState,
  spec: TableSpec,
  patch: Partial<TableState> = {},
): string {
  const next: TableState = { ...state, ...patch };
  const params = new URLSearchParams();

  if (next.view && next.view !== spec.views[0]) params.set("vista", next.view);
  if (next.q) params.set("q", next.q);

  for (const [name, value] of Object.entries(next.filters)) {
    if (value) params.set(name, value);
  }

  if (next.sort && !sameSort(next.sort, spec.defaultSort)) {
    params.set("ordina", `${next.sort.direction === "desc" ? "-" : ""}${next.sort.key}`);
  }

  const perPageDefault = spec.perPage ?? DEFAULT_PER_PAGE;
  if (next.perPage !== perPageDefault) params.set("per-pagina", String(next.perPage));

  if (next.page > 1) params.set("pagina", String(next.page));

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function sameSort(a: ColumnSort, b: ColumnSort | undefined): boolean {
  return b !== undefined && a.key === b.key && a.direction === b.direction;
}

/**
 * The href for a column heading.
 *
 * Clicking the active column flips its direction; clicking any other column
 * starts it ascending. Changing the sort always returns to page 1 — staying on
 * page 7 of a differently ordered list shows rows the merchant never asked for.
 */
export function sortLink(state: TableState, spec: TableSpec, key: string): string {
  const active = state.sort?.key === key;
  const direction: "asc" | "desc" = active && state.sort?.direction === "asc" ? "desc" : "asc";
  return buildTableQuery(state, spec, { sort: { key, direction }, page: 1 });
}

/** `aria-sort` for a column heading. `none` on the inactive ones is required. */
export function ariaSort(state: TableState, key: string): "ascending" | "descending" | "none" {
  if (state.sort?.key !== key) return "none";
  return state.sort.direction === "asc" ? "ascending" : "descending";
}

export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  offset: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** 1-based index of the first row shown, or 0 when there are none. */
  firstRow: number;
  lastRow: number;
}

export function paginate(state: TableState, total: number): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / state.perPage));
  // A bookmark to page 9 of a list that has since shrunk should show the last
  // page of results, not an empty table with no explanation.
  const page = Math.min(state.page, totalPages);
  const offset = (page - 1) * state.perPage;

  return {
    page,
    perPage: state.perPage,
    total,
    totalPages,
    offset,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    firstRow: total === 0 ? 0 : offset + 1,
    lastRow: Math.min(offset + state.perPage, total),
  };
}

/**
 * Maps a declared sort key to a SQL fragment.
 *
 * The caller supplies the map, so no user input ever becomes SQL. An unknown
 * key returns the fallback rather than an empty ORDER BY, because an unordered
 * page in SQLite is not stable and rows can repeat or vanish across pages.
 */
export function orderByClause(
  sort: ColumnSort | null,
  columns: Readonly<Record<string, string>>,
  fallback: string,
): string {
  if (!sort) return fallback;
  const column = columns[sort.key];
  if (!column) return fallback;
  return `${column} ${sort.direction === "desc" ? "DESC" : "ASC"}`;
}
