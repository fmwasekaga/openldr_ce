import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns3 } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import type { ColumnDef } from "./types";

interface ColumnPickerProps<T> {
  columns: ColumnDef<T>[];
  visibleIds: string[];
  onChange: (visibleIds: string[]) => void;
  onResetDefaults: () => void;
}

export function ColumnPickerPopover<T>({
  columns,
  visibleIds,
  onChange,
  onResetDefaults,
}: ColumnPickerProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const toggle = (id: string, checked: boolean) => {
    if (checked && !visibleIds.includes(id)) onChange([...visibleIds, id]);
    if (!checked) {
      // Always keep at least one column visible to avoid a header-only table.
      const next = visibleIds.filter((v) => v !== id);
      if (next.length > 0) onChange(next);
    }
  };

  const pickerColumns = columns.filter((c) => !c.id.startsWith("__"));
  const hiddenCount = pickerColumns.length - visibleIds.filter((id) => !id.startsWith("__")).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          {t("table.columns")}
          {hiddenCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {visibleIds.filter((id) => !id.startsWith("__")).length}/{pickerColumns.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {pickerColumns.map((col) => {
            const checked = visibleIds.includes(col.id);
            const visiblePickerCount = visibleIds.filter((id) => !id.startsWith("__")).length;
            const isLast = checked && visiblePickerCount === 1;
            return (
              <label
                key={col.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[rgba(70,130,180,0.08)]"
              >
                <Checkbox
                  checked={checked}
                  disabled={isLast}
                  onCheckedChange={(c) => toggle(col.id, !!c)}
                />
                <span className="flex-1 text-foreground">{t(col.labelKey)}</span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onResetDefaults}
          >
            {t("table.resetToDefaults")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
