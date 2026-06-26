import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AvailableArtifact, InstalledArtifact } from '@/api';
import { PackageCard } from './PackageCard';
import { PackageDetail } from './PackageDetail';
import { RegistriesTab } from './RegistriesTab';
import { availableToEntry, installedToEntry, type CardEntry } from './util';

interface MarketplaceTabsProps {
  configured: boolean;
  available: AvailableArtifact[];
  installed: InstalledArtifact[];
  onInstall: (entry: CardEntry, capabilities: unknown[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRollback: (id: string, version: string) => void;
  onRemove: (entry: CardEntry) => void;
  onDetach?: (entry: CardEntry) => void;
  onOpenForm?: (formId: string) => void;
  canPublish?: boolean;
  onPublish?: (entry: CardEntry) => void;
  source: 'local' | 'http' | null;
  host: string | null;
  onRefresh: () => void;
  loadError?: string | null;
}

/** Icon-only refresh control (shared by Browse + Installed). */
function RefreshButton({ onClick, label, testId }: { onClick: () => void; label: string; testId: string }) {
  return (
    <Button variant="outline" size="icon" data-testid={testId} onClick={onClick} aria-label={label} title={label}>
      <RefreshCw className="h-4 w-4" />
    </Button>
  );
}

/** Search + type filter toolbar, shared by Browse + Installed. `right` holds the
 *  tab-specific trailing controls (source label / refresh). */
function FilterBar({ filter, setFilter, typeFilter, setTypeFilter, right }: {
  filter: string; setFilter: (v: string) => void;
  typeFilter: string; setTypeFilter: (v: string) => void;
  right?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center gap-2">
      <Input className="max-w-xs" placeholder={t('settings.marketplace.searchPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('settings.marketplace.allTypes')}</SelectItem>
          <SelectItem value="plugin">Plugin</SelectItem>
          <SelectItem value="form-template">Form template</SelectItem>
          <SelectItem value="report-template">Report</SelectItem>
        </SelectContent>
      </Select>
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Full-bleed divider between the toolbar and the cards (negates the page's p-4). */
function Separator() {
  return <div className="-mx-4 mb-4 border-b border-border" />;
}

export function MarketplaceTabs(props: MarketplaceTabsProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<CardEntry | null>(null);

  const installedById = useMemo(() => new Map(props.installed.map((a) => [a.id, a])), [props.installed]);

  const browseEntries = useMemo(() => props.available
    .filter((b) => {
      const textMatch = !filter || b.id.toLowerCase().includes(filter.toLowerCase()) || b.ref.toLowerCase().includes(filter.toLowerCase());
      const typeMatch = typeFilter === 'all' || b.type === typeFilter;
      return textMatch && typeMatch;
    })
    .map((b) => availableToEntry(b, installedById)), [props.available, filter, typeFilter, installedById]);

  const installedEntries = useMemo(() => props.installed
    .filter((a) => {
      const textMatch = !filter || a.id.toLowerCase().includes(filter.toLowerCase());
      const typeMatch = typeFilter === 'all' || a.type === typeFilter;
      return textMatch && typeMatch;
    })
    .map(installedToEntry), [props.installed, filter, typeFilter]);

  if (selected) {
    return (
      <PackageDetail
        entry={selected}
        onBack={() => setSelected(null)}
        onInstall={props.onInstall}
        onToggleEnabled={props.onToggleEnabled}
        onRollback={props.onRollback}
        onRemove={props.onRemove}
        onDetach={props.onDetach}
        onOpenForm={props.onOpenForm}
        canPublish={props.canPublish}
        onPublish={props.onPublish}
      />
    );
  }

  return (
    <Tabs defaultValue="browse" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="-mx-4 px-4">
        <TabsTrigger value="browse">{t('settings.marketplace.browse')}</TabsTrigger>
        <TabsTrigger value="installed">{t('settings.marketplace.installedTab')} ({props.installed.length})</TabsTrigger>
        <TabsTrigger value="registries">{t('settings.marketplace.registriesTab')}</TabsTrigger>
      </TabsList>

      <TabsContent value="browse" className="mt-4 min-h-0 flex-1">
        <FilterBar
          filter={filter} setFilter={setFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          right={<>
            {props.source ? (
              <span className="text-xs text-muted-foreground" data-testid="registry-source">
                {props.source === 'http' ? t('settings.marketplace.sourceRemote', { host: props.host ?? '' }) : t('settings.marketplace.sourceLocal')}
              </span>
            ) : null}
            <RefreshButton onClick={props.onRefresh} label={t('settings.marketplace.refresh')} testId="refresh-registry" />
          </>}
        />
        <Separator />
        {props.loadError ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t('settings.marketplace.registryUnreachable')}
          </div>
        ) : null}
        {!props.configured ? (
          <div className="px-1 py-6 text-sm text-muted-foreground">{t('settings.marketplace.notConfigured')}</div>
        ) : browseEntries.length === 0 ? (
          <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyBrowse')}</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {browseEntries.map((e) => <PackageCard key={e.ref ?? e.id} entry={e} onClick={() => setSelected(e)} />)}
          </div>
        )}
      </TabsContent>

      <TabsContent value="installed" className="mt-4 min-h-0 flex-1">
        <FilterBar
          filter={filter} setFilter={setFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          right={<RefreshButton onClick={props.onRefresh} label={t('settings.marketplace.refresh')} testId="refresh-installed" />}
        />
        <Separator />
        {installedEntries.length === 0 ? (
          <div className="px-1 py-6 text-center text-sm text-muted-foreground">{t('settings.marketplace.emptyInstalled')}</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {installedEntries.map((e) => <PackageCard key={e.id} entry={e} onClick={() => setSelected(e)} />)}
          </div>
        )}
      </TabsContent>

      <TabsContent value="registries" className="mt-4 min-h-0 flex-1">
        <RegistriesTab onChanged={props.onRefresh} />
      </TabsContent>
    </Tabs>
  );
}
