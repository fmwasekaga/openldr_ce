import type { ReactNode } from "react";

export type FilterOperator =
  | "eq"
  | "ne"
  | "like"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "is_null"
  | "is_not_null";

export type FilterCombine = "and" | "or";

export interface FilterRule {
  /** Client-side unique id for React keys. Never sent to the server. */
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | [string, string] | string[];
  combine: FilterCombine;
}

export interface SortRule {
  id: string;
  column: string;
  ascending: boolean;
}

export type ColumnType = "text" | "number" | "date" | "enum";

export interface ColumnDef<T> {
  /** Column id — must match the SQL column on the server whitelist. */
  id: string;
  /** i18n key for the header label. */
  labelKey: string;
  /** How to render the cell. */
  accessor: (row: T) => ReactNode;
  /** Column type — decides the filter input widget. */
  type: ColumnType;
  /** Options when type === 'enum'. */
  enumOptions?: { value: string; labelKey?: string; label?: string }[];
  defaultVisible: boolean;
  sortable?: boolean;
  filterable?: boolean;
  /** Optional Tailwind className for <TableCell>. */
  cellClassName?: string;
  /** Optional Tailwind className for <TableHead>. */
  headClassName?: string;
}

export const FILTER_OPERATORS: {
  value: FilterOperator;
  labelKey: string;
  /** Operators for which no value input is rendered. */
  noValue?: boolean;
}[] = [
  { value: "eq",           labelKey: "table.operators.eq" },
  { value: "ne",           labelKey: "table.operators.ne" },
  { value: "like",         labelKey: "table.operators.like" },
  { value: "gt",           labelKey: "table.operators.gt" },
  { value: "gte",          labelKey: "table.operators.gte" },
  { value: "lt",           labelKey: "table.operators.lt" },
  { value: "lte",          labelKey: "table.operators.lte" },
  { value: "between",      labelKey: "table.operators.between" },
  { value: "in",           labelKey: "table.operators.in" },
  { value: "is_null",      labelKey: "table.operators.is_null", noValue: true },
  { value: "is_not_null",  labelKey: "table.operators.is_not_null", noValue: true },
];

/** Operators that are valid for a given column type. */
export function validOperators(type: ColumnType): FilterOperator[] {
  switch (type) {
    case "text":
      return ["eq", "ne", "like", "in", "is_null", "is_not_null"];
    case "number":
    case "date":
      return ["eq", "ne", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"];
    case "enum":
      return ["eq", "ne", "in", "is_null", "is_not_null"];
  }
}

export const COMBINE_OPTIONS: { value: FilterCombine; labelKey: string }[] = [
  { value: "and", labelKey: "table.and" },
  { value: "or",  labelKey: "table.or" },
];

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
