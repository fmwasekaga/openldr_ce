import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp, Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "../ui/button";
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
} from "../ui/select";
import { TruncatedText } from "../ui/truncated-text";
import type { ColumnDef, SortRule } from "./types";
import { newId } from "./types";

interface SortPopoverProps<T> {
  columns: ColumnDef<T>[];
  sorts: SortRule[];
  onApply: (sorts: SortRule[]) => void;
}

export function SortPopover<T>({ columns, sorts, onApply }: SortPopoverProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SortRule[]>(sorts);

  const sortable = columns.filter((c) => c.sortable !== false);

  const openPopover = (v: boolean) => {
    if (v) setDraft(sorts);
    setOpen(v);
  };

  const available = sortable.filter((c) => !draft.some((s) => s.column === c.id));

  const addSort = (columnId: string) => {
    setDraft([...draft, { id: newId("s"), column: columnId, ascending: true }]);
  };

  const toggleDirection = (id: string) => {
    setDraft(draft.map((s) => (s.id === id ? { ...s, ascending: !s.ascending } : s)));
  };

  const removeSort = (id: string) => {
    setDraft(draft.filter((s) => s.id !== id));
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
          <ArrowDownUp className="h-3.5 w-3.5" />
          {t("table.sort")}
          {sorts.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {sorts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-95 p-0">
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {draft.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("table.noSorts")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {draft.map((rule) => {
                const col = sortable.find((c) => c.id === rule.column);
                return (
                  <li key={rule.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
                    <TruncatedText text={col ? t(col.labelKey) : rule.column} className="min-w-0 flex-1 text-xs text-foreground" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleDirection(rule.id)}
                      title={rule.ascending ? t("table.ascending") : t("table.descending")}
                    >
                      {rule.ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      {rule.ascending ? t("table.asc") : t("table.desc")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSort(rule.id)}
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

        <div className="border-t border-border px-3 py-2 flex items-center gap-2">
          {available.length > 0 ? (
            <Select value="" onValueChange={(v) => addSort(v)}>
              <SelectTrigger className="h-7 flex-1 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Plus className="h-3 w-3" /> {t("table.addSort")}
                </div>
              </SelectTrigger>
              <SelectContent>
                {available.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {t(c.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="flex-1 text-xs text-muted-foreground">{t("table.allColumnsSorted")}</span>
          )}
          {sorts.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAll}>
              {t("table.clear")}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={apply}>
            {t("table.apply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
