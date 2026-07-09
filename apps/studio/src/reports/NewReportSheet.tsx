import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { listReportDesigns } from '../api';
import type { ReportDesign } from '@openldr/report-designer/pure';
import { queryApi } from '../query/api';
import type { CustomQuery } from '../query/custom-query-types';
import { createReportDef } from './reportDefsApi';
import { listReportCategories, saveReportCategories, type ReportCategory } from './reportCategoriesApi';
import { CategoryPicker } from './CategoryPicker';
import { useAuth } from '@/auth/AuthProvider';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

function newId(): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `r-${rand}`;
}

/** The queryId bound to the first table element found in the design, if any. */
function firstBoundQueryId(design: ReportDesign | undefined): string {
  if (!design) return '';
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind === 'table' && el.dataSource) return el.dataSource.queryId;
    }
  }
  return '';
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  /** Pre-select a template (e.g. "Publish as report" from the designer). */
  initialDesignId?: string;
}

export function NewReportSheet({ open, onOpenChange, onCreated, initialDesignId }: Props): JSX.Element {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const canManageCategories = hasRole('lab_admin') || hasRole('lab_manager');
  const [designs, setDesigns] = useState<ReportDesign[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [designId, setDesignId] = useState('');
  const [primaryQueryId, setPrimaryQueryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setError(undefined);
    Promise.all([listReportDesigns(), queryApi.list(), listReportCategories()])
      .then(([ds, qs, cats]) => {
        setDesigns(ds);
        setQueries(qs);
        setCategories(cats);
        setCategory(cats[0]?.id ?? '');
        const initial = (initialDesignId && ds.some((d) => d.id === initialDesignId)) ? initialDesignId : ds[0]?.id ?? '';
        setDesignId(initial);
        setPrimaryQueryId(firstBoundQueryId(ds.find((d) => d.id === initial)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDesignId]);

  const selectedDesign = useMemo(() => designs.find((d) => d.id === designId), [designs, designId]);

  const handleDesignChange = (id: string) => {
    setDesignId(id);
    setPrimaryQueryId(firstBoundQueryId(designs.find((d) => d.id === id)));
  };

  const handleCategoriesChange = (list: ReportCategory[]) => {
    setCategories(list);
    saveReportCategories(list).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const canCreate = name.trim().length > 0 && designId.length > 0 && primaryQueryId.length > 0 && category.length > 0 && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(undefined);
    try {
      await createReportDef({
        id: newId(),
        name: name.trim(),
        description: description.trim(),
        category,
        designId,
        primaryQueryId,
        status: 'published',
      });
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent hideClose className="flex w-full max-w-md flex-col gap-0 border-b-0 p-0">
        <SheetHeader className="flex flex-row items-start justify-between gap-2 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <SheetTitle>{t('reports.new.title')}</SheetTitle>
            <SheetDescription>{t('reports.new.subtitle')}</SheetDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label={t('common.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={!canCreate} onSelect={() => { void handleCreate(); }}>
                {t('reports.new.create')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenChange(false)}>
                {t('common.cancel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportName" className="text-xs uppercase text-muted-foreground">{t('reports.new.name')}</Label>
            <Input id="newReportName" className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase text-muted-foreground">{t('reports.new.category')}</Label>
            <CategoryPicker
              value={category}
              onChange={setCategory}
              categories={categories}
              onCategoriesChange={handleCategoriesChange}
              canEdit={canManageCategories}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportDescription" className="text-xs uppercase text-muted-foreground">{t('reports.new.description')}</Label>
            <Textarea id="newReportDescription" className="min-h-[60px] text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportTemplate" className="text-xs uppercase text-muted-foreground">{t('reports.new.template')}</Label>
            <Select value={designId} onValueChange={handleDesignChange}>
              <SelectTrigger id="newReportTemplate" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {designs.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportQuery" className="text-xs uppercase text-muted-foreground">{t('reports.new.primaryQuery')}</Label>
            <Select value={primaryQueryId} onValueChange={setPrimaryQueryId}>
              <SelectTrigger id="newReportQuery" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {queries.map((q) => <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted-foreground">{t('reports.new.filtersPreview')}</span>
            {selectedDesign && selectedDesign.parameters.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
                {selectedDesign.parameters.map((p) => <li key={p.key}>{p.label}</li>)}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('reports.new.noFilters')}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
