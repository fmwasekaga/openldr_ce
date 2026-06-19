import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FILTER_OPERATORS, type ColumnDef, type FilterRule } from "./types";

interface ActiveFilterChipsProps<T> {
  columns: ColumnDef<T>[];
  filters: FilterRule[];
  onChange: (filters: FilterRule[]) => void;
}

function formatValue(rule: FilterRule): string {
  if (rule.operator === "is_null" || rule.operator === "is_not_null") return "";
  if (Array.isArray(rule.value)) {
    if (rule.operator === "between") return `${rule.value[0] ?? ""} – ${rule.value[1] ?? ""}`;
    return rule.value.join(", ");
  }
  return String(rule.value ?? "");
}

export function ActiveFilterChips<T>({ columns, filters, onChange }: ActiveFilterChipsProps<T>) {
  const { t } = useTranslation();
  if (filters.length === 0) return null;

  const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));
  const clearAll = () => onChange([]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((rule, idx) => {
        const col = columns.find((c) => c.id === rule.column);
        const opDef = FILTER_OPERATORS.find((o) => o.value === rule.operator);
        const valueText = formatValue(rule);
        return (
          <div key={rule.id} className="flex items-center gap-1">
            {idx > 0 && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t(rule.combine === "or" ? "table.or" : "table.and")}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-xs text-primary">
              <span className="font-medium">{col ? t(col.labelKey) : rule.column}</span>
              <span className="text-primary/80">{opDef ? t(opDef.labelKey) : rule.operator}</span>
              {valueText && <span className="font-mono">{valueText}</span>}
              <button
                onClick={() => remove(rule.id)}
                className="ml-0.5 rounded-sm p-0.5 hover:bg-primary/20"
                aria-label={t("common.delete")}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        );
      })}
      <button
        onClick={clearAll}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("table.clearAll")}
      </button>
    </div>
  );
}
