import * as React from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '@/lib/cn';

interface DateRangePickerProps {
  value: { from: string; to: string } | null;
  onChange: (value: { from: string; to: string } | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DateRangePicker({ value, onChange, placeholder = 'Pick a date range', disabled, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dateRange: DateRange | undefined =
    value?.from || value?.to ? { from: value.from ? new Date(value.from) : undefined, to: value.to ? new Date(value.to) : undefined } : undefined;

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) return;
    onChange({ from: range.from ? format(range.from, 'yyyy-MM-dd') : '', to: range.to ? format(range.to, 'yyyy-MM-dd') : '' });
  };
  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };
  const displayText = () => {
    if (!value?.from) return placeholder;
    if (!value.to) return format(new Date(value.from), 'dd/MM/yyyy') + ' – ...';
    return format(new Date(value.from), 'dd/MM/yyyy') + ' – ' + format(new Date(value.to), 'dd/MM/yyyy');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className={cn('h-9 justify-start text-left font-normal', !value?.from && 'text-muted-foreground', className)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0">
            <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
          </svg>
          <span className="text-xs">{displayText()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={dateRange} onSelect={handleSelect} numberOfMonths={2} />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-muted-foreground">
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
