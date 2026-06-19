import { useCallback, useMemo, useState } from "react";
import type { ColumnDef, FilterRule, SortRule } from "./types";

export interface TableStateOptions<T> {
  columns: ColumnDef<T>[];
  defaultPageSize?: number;
  /** Optional initial filter rules. resetAll() restores them rather than clearing. */
  defaultFilters?: FilterRule[];
  /** Optional initial sort rules. resetAll() restores them rather than clearing. */
  defaultSorts?: SortRule[];
}

export interface TableState<T> {
  columns: ColumnDef<T>[];
  visibleIds: string[];
  filters: FilterRule[];
  sorts: SortRule[];
  page: number;
  pageSize: number;
  setVisibleIds: (ids: string[]) => void;
  setFilters: (filters: FilterRule[]) => void;
  setSorts: (sorts: SortRule[]) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  resetAll: () => void;
  resetColumns: () => void;
  /** Visible column defs in declared order. */
  visibleColumns: ColumnDef<T>[];
}

export function useTableState<T>({
  columns,
  defaultPageSize = 25,
  defaultFilters,
  defaultSorts,
}: TableStateOptions<T>): TableState<T> {
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.defaultVisible || c.id.startsWith("__")).map((c) => c.id),
    [columns],
  );

  const initialFilters = useMemo(() => defaultFilters ?? [], [defaultFilters]);
  const initialSorts = useMemo(() => defaultSorts ?? [], [defaultSorts]);

  const [visibleIds, setVisibleIds] = useState<string[]>(defaultVisible);
  const [filters, setFilters] = useState<FilterRule[]>(initialFilters);
  const [sorts, setSorts] = useState<SortRule[]>(initialSorts);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const resetColumns = useCallback(() => setVisibleIds(defaultVisible), [defaultVisible]);

  const resetAll = useCallback(() => {
    setFilters(initialFilters);
    setSorts(initialSorts);
    setPage(0);
    setPageSize(defaultPageSize);
    setVisibleIds(defaultVisible);
  }, [defaultPageSize, defaultVisible, initialFilters, initialSorts]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.id.startsWith("__") || visibleIds.includes(c.id)),
    [columns, visibleIds],
  );

  return {
    columns,
    visibleIds,
    visibleColumns,
    filters,
    sorts,
    page,
    pageSize,
    setVisibleIds,
    setFilters: (f) => { setFilters(f); setPage(0); },
    setSorts:   (s) => { setSorts(s);   setPage(0); },
    setPage,
    setPageSize: (s) => { setPageSize(s); setPage(0); },
    resetAll,
    resetColumns,
  };
}
