import { useEffect, useMemo, useState } from 'react';
import { Network } from 'lucide-react';
import type { CodingSystem, MapType, TermMapping, TermMappingInput } from '../api';
import { createTermMapping, updateTermMapping } from '../api';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { TermPicker, type PickedTerm } from './TermPicker';
import { MoreHorizontal } from 'lucide-react';

// ── runtime constants ─────────────────────────────────────────────────────────

const MAP_TYPE_VALUES: readonly MapType[] = [
  'SAME-AS',
  'NARROWER-THAN',
  'BROADER-THAN',
  'RELATED-TO',
  'UNMAPPED-FROM',
] as const;

// ── en.json labels (inlined — no i18n dependency in web) ─────────────────────
// Source: corlix/apps/desktop/src/renderer/i18n/locales/en.json terminology.mapping.*
const L = {
  editTitle: 'Edit mapping',
  newTitle: 'New mapping',
  sectionGeneral: 'General',
  sectionStatus: 'Status',
  target: 'Target',
  mapType: 'Map type',
  mapTypeOptions: {
    'SAME-AS': 'Same as',
    'NARROWER-THAN': 'Narrower than',
    'BROADER-THAN': 'Broader than',
    'RELATED-TO': 'Related to',
    'UNMAPPED-FROM': 'Unmapped from',
  } as Record<MapType, string>,
  relationship: 'Relationship',
  relationshipPlaceholder: 'e.g. equivalent',
  owner: 'Owner',
  ownerPlaceholder: 'e.g. WHO',
  manualSystem: 'System',
  manualCode: 'Code',
  manualDisplay: 'Display',
  manualDisplayPlaceholder: 'Human-readable label',
  manualHint: 'Enter the target code directly.',
  searchPlaceholder: 'Search terms…',
  searchHint: 'Search for a term in the target system.',
  switchToManual: 'Enter manually',
  switchToSearch: 'Search terms',
  isActive: 'Active mapping',
  browseSystem: (name: string) => `Browse ${name}`,
  browseDisabledHint: 'Available once an ontology index exists (a later update).',
  // common.*
  save: 'Save',
  saving: 'Saving…',
  create: 'Create',
  cancel: 'Cancel',
} as const;

// ── types ─────────────────────────────────────────────────────────────────────

type TargetMode = 'search' | 'manual';

// ── public contract ───────────────────────────────────────────────────────────

export function TermMappingDialog({
  open,
  onOpenChange,
  fromTerm,
  systems,
  mapping,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fromTerm: { system: string; code: string; display: string | null; systemCode: string };
  systems: CodingSystem[];
  mapping: TermMapping | null;
  onSaved: (mapping: TermMapping, draftCreated: boolean) => void;
}): JSX.Element {
  const editing = mapping !== null;

  // ── mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<TargetMode>('search');

  // ── search mode state ─────────────────────────────────────────────────────
  const [picked, setPicked] = useState<PickedTerm | null>(null);
  const [searchSystemId, setSearchSystemId] = useState<string>('');

  // ── manual mode state ─────────────────────────────────────────────────────
  const [manualSystemId, setManualSystemId] = useState<string>('');
  const [manualCode, setManualCode] = useState('');
  const [manualDisplay, setManualDisplay] = useState('');

  // ── general ───────────────────────────────────────────────────────────────
  const [mapType, setMapType] = useState<MapType>('SAME-AS');
  const [relationship, setRelationship] = useState('');
  const [owner, setOwner] = useState('');
  const [isActive, setIsActive] = useState(true);

  // ── ui ────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── derived ───────────────────────────────────────────────────────────────
  const activeSystems = useMemo(() => systems.filter((s) => s.active), [systems]);

  const manualTargetSystem = useMemo(
    () => activeSystems.find((s) => s.id === manualSystemId) ?? null,
    [activeSystems, manualSystemId],
  );
  const manualTargetSystemCode = manualTargetSystem?.systemCode ?? '';

  // For search mode: the system whose terms TermPicker will search
  const searchSystemObj = useMemo(
    () => activeSystems.find((s) => s.id === searchSystemId) ?? null,
    [activeSystems, searchSystemId],
  );

  // ── seed state on open / mapping change ───────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mapping) {
      // Edit mode — always use manual mode since we don't have toTermId in our API
      setMapType(mapping.mapType);
      setRelationship(mapping.relationship ?? '');
      setOwner(mapping.owner ?? '');
      setIsActive(mapping.isActive);
      setMode('manual');
      setPicked(null);
      setSearchSystemId(activeSystems[0]?.id ?? '');
      // Pre-fill the manual system by matching on url
      const matchedSystem = activeSystems.find((s) => s.url === mapping.toSystem);
      setManualSystemId(matchedSystem?.id ?? '');
      setManualCode(mapping.toCode);
      setManualDisplay(mapping.toDisplay ?? '');
    } else {
      // Create mode — default to search mode, empty
      setMode('search');
      setPicked(null);
      setSearchSystemId(activeSystems[0]?.id ?? '');
      setManualSystemId(activeSystems[0]?.id ?? '');
      setManualCode('');
      setManualDisplay('');
      setMapType('SAME-AS');
      setRelationship('');
      setOwner('');
      setIsActive(true);
    }
  }, [open, mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── canSave ───────────────────────────────────────────────────────────────
  const canSave =
    mode === 'search'
      ? picked !== null
      : manualSystemId.length > 0 && manualCode.trim().length > 0;

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Build the body — toSystem is the url, not the id
      const toSystemUrl =
        mode === 'search'
          ? (picked!.system)
          : (manualTargetSystem?.url ?? manualTargetSystem?.url ?? '');
      const toCode = mode === 'search' ? picked!.code : manualCode.trim();
      const toDisplay = mode === 'search' ? picked!.display : manualDisplay.trim() || null;

      const body: Omit<TermMappingInput, 'fromSystem' | 'fromCode'> = {
        toSystem: toSystemUrl,
        toCode,
        toDisplay,
        mapType,
        relationship: relationship.trim() || null,
        owner: owner.trim() || null,
        isActive,
      };

      if (editing) {
        const updated = await updateTermMapping(mapping.id, {
          fromSystem: fromTerm.system,
          fromCode: fromTerm.code,
          ...body,
        });
        onSaved(updated, false);
      } else {
        const res = await createTermMapping(fromTerm.system, fromTerm.code, body);
        onSaved(res.mapping, res.draftCreated);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleMode = (): void => {
    setMode((m) => (m === 'search' ? 'manual' : 'search'));
    setPicked(null);
    setManualCode('');
    setManualDisplay('');
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>
            {editing ? L.editTitle : L.newTitle}
          </SheetTitle>
          <SheetDescription>
            {fromTerm.systemCode} {fromTerm.code}
            {fromTerm.display ? ` — ${fromTerm.display}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6">
          {error && (
            <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* General section */}
          <section>
            <div className="flex items-center justify-between py-2">
              <h3 className="text-sm font-medium text-foreground">{L.sectionGeneral}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canSave || saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? L.saving : editing ? L.save : L.create}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onOpenChange(false)}>
                    {L.cancel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="-mx-6 border-b border-border" />
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
              <Label className="whitespace-nowrap">{L.mapType}</Label>
              <Select value={mapType} onValueChange={(v) => setMapType(v as MapType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAP_TYPE_VALUES.map((mt) => (
                    <SelectItem key={mt} value={mt}>
                      {L.mapTypeOptions[mt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label htmlFor="mapping-relationship" className="whitespace-nowrap">
                {L.relationship}
              </Label>
              <Input
                id="mapping-relationship"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder={L.relationshipPlaceholder}
              />

              <Label htmlFor="mapping-owner" className="whitespace-nowrap">
                {L.owner}
              </Label>
              <Input
                id="mapping-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder={L.ownerPlaceholder}
              />
            </div>
            <div className="-mx-6 border-b border-border" />
          </section>

          {/* Target section */}
          <section>
            <div className="flex items-center justify-between py-3">
              <h3 className="text-sm font-medium text-foreground">{L.target}</h3>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={toggleMode}
              >
                {mode === 'search' ? L.switchToManual : L.switchToSearch}
              </button>
            </div>
            <div className="-mx-6 border-b border-border" />

            {mode === 'search' ? (
              <div className="space-y-3 py-4">
                {activeSystems.length > 1 && (
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-4">
                    <Label className="whitespace-nowrap">{L.manualSystem}</Label>
                    <Select value={searchSystemId} onValueChange={(v) => { setSearchSystemId(v); setPicked(null); }}>
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSystems.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.systemCode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {searchSystemId && (
                  <TermPicker
                    value={picked}
                    onChange={setPicked}
                    systemId={searchSystemId}
                    statuses={['ACTIVE', 'DRAFT']}
                  />
                )}
                <p className="text-[11px] text-muted-foreground">{L.searchHint}</p>
              </div>
            ) : (
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 py-4">
                <Label className="whitespace-nowrap">{L.manualSystem}</Label>
                <Select value={manualSystemId} onValueChange={setManualSystemId}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSystems.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.systemCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Label htmlFor="mapping-manual-code" className="whitespace-nowrap">
                  {L.manualCode}
                </Label>
                <Input
                  id="mapping-manual-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="441407007"
                  className="font-mono"
                />

                <Label htmlFor="mapping-manual-display" className="whitespace-nowrap">
                  {L.manualDisplay}
                </Label>
                <Input
                  id="mapping-manual-display"
                  value={manualDisplay}
                  onChange={(e) => setManualDisplay(e.target.value)}
                  placeholder={L.manualDisplayPlaceholder}
                />

                <div className="col-span-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">{L.manualHint}</p>
                  {manualSystemId && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="shrink-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              className="pointer-events-none h-8 gap-1.5 text-xs"
                              aria-label={L.browseSystem(manualTargetSystemCode)}
                            >
                              <Network className="h-3.5 w-3.5" />
                              {L.browseSystem(manualTargetSystemCode)}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{L.browseDisabledHint}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            )}
            <div className="-mx-6 border-b border-border" />
          </section>

          {/* Status section */}
          <section>
            <h3 className="py-3 text-sm font-medium text-foreground">{L.sectionStatus}</h3>
            <div className="-mx-6 border-b border-border" />
            <div className="py-4">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={isActive}
                  onCheckedChange={(v) => setIsActive(v === true)}
                />
                <span className="text-sm">{L.isActive}</span>
              </label>
            </div>
            <div className="-mx-6 border-b border-border" />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
