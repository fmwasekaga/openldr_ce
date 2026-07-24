import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { slugify } from '@openldr/rbac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/auth/AuthProvider';
import { createRole, updateRole, getRoleCatalog, type RoleRecord, type CapabilityGroup } from '@/api';
import { CapabilityGrid } from './CapabilityGrid';

export interface RoleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create; a RoleRecord = edit/view that role. */
  role: RoleRecord | null;
  onSaved: (role: RoleRecord) => void;
}

/**
 * instatic-style "Create Role" / "Edit Role" sheet: Name, auto-derived Slug, Description,
 * then the grouped capability grid. Locked roles (the built-in Administrator) render
 * everything read-only; users without `roles.manage` get the same read-only treatment so
 * they can inspect a role's capabilities without being able to change them.
 */
export function RoleSheet({ open, onOpenChange, role, onSaved }: RoleSheetProps) {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const isEdit = role !== null;
  const locked = role?.locked ?? false;
  const canManage = hasCapability('roles.manage');
  // Locked (built-in Administrator) is always read-only; so is anyone lacking roles.manage —
  // they can still open the sheet (e.g. via row click) to inspect a role's capabilities.
  const readOnly = locked || !canManage;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<CapabilityGroup[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the capability catalog once — it's mounted for the lifetime of the parent page
  // (open/close only toggles visibility), and the catalog doesn't change during a session.
  useEffect(() => {
    let cancelled = false;
    getRoleCatalog()
      .then((res) => { if (!cancelled) setGroups(res.groups); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // (Re)seed the draft whenever the sheet opens, for whichever role it was opened with.
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setSlug(role?.slug ?? '');
    setSlugTouched(false);
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.capabilities ?? []));
    setError(null);
    setSaving(false);
  }, [open, role]);

  const handleNameChange = (value: string) => {
    setName(value);
    // Only auto-derive on create, and only until the user edits the slug themselves.
    if (!isEdit && !slugTouched) setSlug(slugify(value));
  };

  const handleSave = async () => {
    if (saving || readOnly) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setError(t('roles.nameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const capabilities = [...selected];
      const saved = isEdit && role
        ? await updateRole(role.id, { name: trimmedName, description: description.trim() || null, capabilities })
        : await createRole({ name: trimmedName, slug: slug.trim() || undefined, description: description.trim() || null, capabilities });
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isEdit ? t('roles.editRoleTitle') : t('roles.newRoleTitle')}</SheetTitle>
          <SheetDescription>{t('roles.sheetDescription')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="role-sheet-error">
              {error}
            </div>
          ) : null}
          {locked ? (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700" data-testid="role-locked-notice">
              {t('roles.lockedNotice')}
            </div>
          ) : null}

          <div className="grid gap-4">
            <div className="space-y-1">
              <Label htmlFor="role-name">{t('roles.fieldName')}</Label>
              <Input id="role-name" data-testid="role-name" value={name} onChange={(e) => handleNameChange(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-slug">{t('roles.fieldSlug')}</Label>
              {/* Slug is immutable once a role exists (the API's updateRole doesn't accept it) —
                  so it's only ever editable while creating a new role. */}
              <Input
                id="role-slug"
                data-testid="role-slug"
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
                disabled={readOnly || isEdit}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-description">{t('roles.fieldDescription')}</Label>
              <Textarea
                id="role-description"
                data-testid="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('roles.descriptionPlaceholder')}
                disabled={readOnly}
                rows={2}
              />
            </div>
          </div>

          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold">{t('roles.capabilitiesHeading')}</h3>
            {catalogLoading ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : (
              <CapabilityGrid groups={groups} selected={selected} onChange={setSelected} readOnly={readOnly} />
            )}
          </div>
        </div>

        <SheetFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? t('common.close') : t('common.cancel')}</Button>
          {!readOnly ? (
            <Button data-testid="role-save" disabled={saving || !name.trim()} onClick={() => void handleSave()}>
              {saving ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
