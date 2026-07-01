import type { ColumnDef, FilterOperator, FilterRule, SortRule } from "./types";

// Client-side filter/sort/pagination for pages that fetch the full row set in one call.
// Server-side pagination (patient:query, audit:query) bypasses this entirely.

function getFieldValue<T>(row: T, columnId: string, getter?: (r: T) => unknown): unknown {
  if (getter) return getter(row);
  return (row as Record<string, unknown>)[columnId];
}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;

  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;

  // Fallback to locale string comparison (covers dates as ISO strings and text).
  return String(a).localeCompare(String(b));
}

function matchesRule(value: unknown, operator: FilterOperator, target: FilterRule["value"]): boolean {
  switch (operator) {
    case "eq":  return String(value ?? "") === String(target);
    case "ne":  return String(value ?? "") !== String(target);
    case "like": {
      const needle = (Array.isArray(target) ? target.join(",") : String(target ?? "")).toLowerCase();
      if (!needle) return true;
      return String(value ?? "").toLowerCase().includes(needle);
    }
    case "gt":  return compareValues(value, Array.isArray(target) ? target[0] : target) > 0;
    case "gte": return compareValues(value, Array.isArray(target) ? target[0] : target) >= 0;
    case "lt":  return compareValues(value, Array.isArray(target) ? target[0] : target) < 0;
    case "lte": return compareValues(value, Array.isArray(target) ? target[0] : target) <= 0;
    case "between": {
      if (!Array.isArray(target) || target.length !== 2) return false;
      return compareValues(value, target[0]) >= 0 && compareValues(value, target[1]) <= 0;
    }
    case "in": {
      const set = Array.isArray(target)
        ? target.map((s) => String(s))
        : String(target ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (set.length === 0) return false;
      return set.includes(String(value ?? ""));
    }
    case "is_null":     return value === null || value === undefined || value === "";
    case "is_not_null": return !(value === null || value === undefined || value === "");
  }
}

export interface TableStateValueGetters<T> {
  /** Optional per-column getter. Defaults to row[column.id]. */
  [columnId: string]: (row: T) => unknown;
}

export function applyTableState<T>(
  allRows: T[],
  state: {
    filters: FilterRule[];
    sorts: SortRule[];
    page: number;
    pageSize: number;
  },
  columns: ColumnDef<T>[],
  valueGetters?: TableStateValueGetters<T>,
): { rows: T[]; total: number } {
  const columnsById = new Map(columns.map((c) => [c.id, c] as const));

  // ─── Filter ────────────────────────────────────────────────
  let filtered = allRows;
  if (state.filters.length > 0) {
    filtered = allRows.filter((row) => {
      // Left-to-right evaluation with explicit AND/OR. Matches the backend's
      // flat combine semantics: `A AND B OR C` == `(A AND B) OR C`.
      // First rule has no connector; subsequent rules apply their `combine`.
      let result = true;
      for (let i = 0; i < state.filters.length; i++) {
        const rule = state.filters[i]!;
        const col = columnsById.get(rule.column);
        const getter = valueGetters?.[rule.column];
        const value = col ? getFieldValue(row, rule.column, getter) : (row as Record<string, unknown>)[rule.column];
        const match = matchesRule(value, rule.operator, rule.value);
        if (i === 0) result = match;
        else if (rule.combine === "or") result = result || match;
        else result = result && match;
      }
      return result;
    });
  }

  // ─── Sort ──────────────────────────────────────────────────
  if (state.sorts.length > 0) {
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      for (const s of state.sorts) {
        const getter = valueGetters?.[s.column];
        const av = getFieldValue(a, s.column, getter);
        const bv = getFieldValue(b, s.column, getter);
        // For dates/timestamps stored as Date-parseable strings, coerce to ms for proper order.
        const an = typeof av === "string" && !Number.isNaN(Date.parse(av)) ? Date.parse(av) : av;
        const bn = typeof bv === "string" && !Number.isNaN(Date.parse(bv)) ? Date.parse(bv) : bv;
        const num = coerceNumber(an) !== null && coerceNumber(bn) !== null
          ? (coerceNumber(an)! - coerceNumber(bn)!)
          : compareValues(av, bv);
        if (num !== 0) return s.ascending ? num : -num;
      }
      return 0;
    });
    filtered = sorted;
  }

  // ─── Paginate ──────────────────────────────────────────────
  const total = filtered.length;
  const start = state.page * state.pageSize;
  const rows = filtered.slice(start, start + state.pageSize);

  return { rows, total };
}
