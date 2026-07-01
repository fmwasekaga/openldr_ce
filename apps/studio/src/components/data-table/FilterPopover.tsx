import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { DatePicker } from "../ui/date-picker";
import { DateRangePicker } from "../ui/date-range-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  COMBINE_OPTIONS,
  FILTER_OPERATORS,
  newId,
  validOperators,
  type ColumnDef,
  type FilterOperator,
  type FilterRule,
} from "./types";

interface FilterPopoverProps<T> {
  columns: ColumnDef<T>[];
  filters: FilterRule[];
  onApply: (filters: FilterRule[]) => void;
}

function FilterValueInput({
  column,
  operator,
  value,
  onChange,
}: {
  column: ColumnDef<unknown>;
  operator: FilterOperator;
  value: FilterRule["value"];
  onChange: (v: FilterRule["value"]) => void;
}) {
  const { t } = useTranslation();
  const def = FILTER_OPERATORS.find((o) => o.value === operator);
  if (def?.noValue) return null;

  // between → range picker for date, two inputs otherwise
  if (operator === "between") {
    if (column.type === "date") {
      const range = Array.isArray(value) && value.length === 2
        ? { from: String(value[0] ?? ""), to: String(value[1] ?? "") }
        : null;
      return (
        <DateRangePicker
          value={range?.from || range?.to ? range : null}
          onChange={(v) => onChange(v ? [v.from, v.to] : ["", ""])}
          placeholder={t("table.pickRange")}
        />
      );
    }
    const pair = Array.isArray(value) ? value : ["", ""];
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-8 text-xs"
          value={String(pair[0] ?? "")}
          onChange={(e) => onChange([e.target.value, String(pair[1] ?? "")])}
          placeholder={t("table.from")}
        />
        <Input
          className="h-8 text-xs"
          value={String(pair[1] ?? "")}
          onChange={(e) => onChange([String(pair[0] ?? ""), e.target.value])}
          placeholder={t("table.to")}
        />
      </div>
    );
  }

  if (column.type === "date" && (operator === "eq" || operator === "ne" || operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte")) {
    return (
      <DatePicker
        value={typeof value === "string" && value !== "" ? value : null}
        onChange={(v) => onChange(v ?? "")}
        placeholder={t("table.pickDate")}
      />
    );
  }

  if (column.type === "enum" && operator !== "in") {
    return (
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={(v) => onChange(v)}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={t("table.pickValue")} />
        </SelectTrigger>
        <SelectContent>
          {column.enumOptions?.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.labelKey ? t(opt.labelKey) : opt.label ?? opt.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Default: plain text; `in` uses comma-separated
  return (
    <Input
      className="h-8 text-xs"
      value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      placeholder={operator === "in" ? t("table.commaSeparated") : t("table.enterValue")}
    />
  );
}

export function FilterPopover<T>({ columns, filters, onApply }: FilterPopoverProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Local draft so the user's edits don't refetch until they click Apply.
  const [draft, setDraft] = useState<FilterRule[]>(filters);

  const filterable = columns.filter((c) => c.filterable !== false);

  const openPopover = (v: boolean) => {
    if (v) setDraft(filters); // seed draft with current applied filters
    setOpen(v);
  };

  const addFilter = () => {
    const col = filterable[0];
    if (!col) return;
    const ops = validOperators(col.type);
    setDraft([
      ...draft,
      { id: newId("f"), column: col.id, operator: ops[0]!, value: "", combine: "and" },
    ]);
  };

  const updateFilter = (id: string, patch: Partial<FilterRule>) => {
    setDraft(draft.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeFilter = (id: string) => {
    setDraft(draft.filter((f) => f.id !== id));
  };

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  const clearAll = () => {
    setDraft([]);
    onApply([]);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={openPopover}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          {t("table.filter")}
          {filters.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {filters.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[640px] p-0">
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {draft.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("table.noFilters")}
            </p>
          ) : (
            <ul className="space-y-2">
              {draft.map((rule, idx) => {
                const col = filterable.find((c) => c.id === rule.column) ?? filterable[0];
                if (!col) return null;
                const ops = validOperators(col.type);
                return (
                  <li key={rule.id} className="flex items-center gap-1.5">
                    <div className="w-14">
                      {idx === 0 ? (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("table.where")}
                        </span>
                      ) : (
                        <Select
                          value={rule.combine}
                          onValueChange={(v) => updateFilter(rule.id, { combine: v as "and" | "or" })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COMBINE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {t(o.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <Select
                      value={rule.column}
                      onValueChange={(v) => {
                        const next = filterable.find((c) => c.id === v);
                        if (!next) return;
                        const nextOps = validOperators(next.type);
                        const nextOp = nextOps.includes(rule.operator) ? rule.operator : nextOps[0]!;
                        updateFilter(rule.id, { column: v, operator: nextOp, value: "" });
                      }}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {filterable.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {t(c.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={rule.operator}
                      onValueChange={(v) => updateFilter(rule.id, { operator: v as FilterOperator, value: "" })}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FILTER_OPERATORS.filter((o) => ops.includes(o.value)).map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {t(o.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex-1 min-w-0">
                      <FilterValueInput
                        column={col as ColumnDef<unknown>}
                        operator={rule.operator}
                        value={rule.value}
                        onChange={(v) => updateFilter(rule.id, { value: v })}
                      />
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeFilter(rule.id)}
                      aria-label={t("common.delete")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}>
            <Plus className="h-3 w-3" /> {t("table.addFilter")}
          </Button>
          <div className="flex items-center gap-2">
            {filters.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAll}>
                {t("table.clear")}
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs" onClick={apply}>
              {t("table.apply")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
