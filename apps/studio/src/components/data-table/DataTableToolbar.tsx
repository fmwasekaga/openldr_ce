import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { FilterPopover } from "./FilterPopover";
import { SortPopover } from "./SortPopover";
import { ColumnPickerPopover } from "./ColumnPickerPopover";
import type { ColumnDef, FilterRule, SortRule } from "./types";

interface DataTableToolbarProps<T> {
  columns: ColumnDef<T>[];
  filters: FilterRule[];
  onFiltersChange: (filters: FilterRule[]) => void;
  sorts: SortRule[];
  onSortsChange: (sorts: SortRule[]) => void;
  visibleIds: string[];
  onVisibleIdsChange: (ids: string[]) => void;
  onResetColumns: () => void;
  onResetAll: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchEnter?: () => void;
  searchPlaceholder?: string;
  /** Right-aligned page-specific actions (e.g. the "…" dropdown with New / Import). */
  actions?: ReactNode;
}

export function DataTableToolbar<T>({
  columns,
  filters,
  onFiltersChange,
  sorts,
  onSortsChange,
  visibleIds,
  onVisibleIdsChange,
  onResetColumns,
  onResetAll,
  searchValue,
  onSearchChange,
  onSearchEnter,
  searchPlaceholder,
  actions,
}: DataTableToolbarProps<T>) {
  const { t } = useTranslation();
  const hasActiveState = filters.length > 0 || sorts.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearchChange && (
        <Input
          value={searchValue ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter?.(); }}
          placeholder={searchPlaceholder}
          className="h-8 w-60 text-xs"
        />
      )}
      <FilterPopover columns={columns} filters={filters} onApply={onFiltersChange} />
      <SortPopover columns={columns} sorts={sorts} onApply={onSortsChange} />
      <ColumnPickerPopover
        columns={columns}
        visibleIds={visibleIds}
        onChange={onVisibleIdsChange}
        onResetDefaults={onResetColumns}
      />
      {hasActiveState && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={onResetAll}
        >
          {t("table.reset")}
        </Button>
      )}
      <div className="flex-1" />
      {actions}
    </div>
  );
}
