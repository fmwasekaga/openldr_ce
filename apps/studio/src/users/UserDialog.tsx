import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  createUser, updateUser, listPublishedForms, getForm,
  listRoles, getUserRoles, setUserRoles,
  type UserSummary, type RoleRecord, type CreateUserPayload,
} from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { FormSchema, RuntimeAnswers } from '@/forms-runtime/types';
import { FormSchema as FormSchemaZ } from '@openldr/forms/pure';

// CORE apiProperty keys that map to Keycloak identity fields. OpenLDR role assignment is
// handled separately (below) via the roles.* capability API, not written to Keycloak here.
const CORE_KEYS = new Set(['firstName', 'lastName', 'email']);

// Sentinel value for the "no role" option in the role Select — Radix Select disallows an
// empty-string item value, so we map this sentinel back to '' (no role) at the state boundary.
const NO_ROLE_VALUE = '__none__';

type IdentityPatch = { firstName?: string | null; lastName?: string | null; email?: string | null };
type FormMeta = Pick<CreateUserPayload, 'formSchemaId' | 'formVersion'>;

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserSummary | null;
  onSaved: (user: UserSummary) => void;
}

/** Build initialAnswers from a UserSummary, keyed by fieldId, using the schema fields. */
function seedAnswers(schema: FormSchema, user: UserSummary): RuntimeAnswers {
  const answers: RuntimeAnswers = {};
  for (const field of schema.fields) {
    const ap = field.apiProperty;
    if (!ap) continue;
    if (CORE_KEYS.has(ap)) {
      // Seed from identity
      let val: unknown;
      if (ap === 'firstName') val = user.firstName ?? undefined;
      else if (ap === 'lastName') val = user.lastName ?? undefined;
      else if (ap === 'email') val = user.email ?? undefined;
      if (val !== undefined && val !== null) answers[field.id] = val;
    } else {
      // Seed from extras[apiProperty]
      const extVal = user.extras[ap];
      if (extVal !== undefined && extVal !== '') answers[field.id] = extVal;
    }
  }
  return answers;
}

/** Split FormRuntime answers back into identity payload + extras. */
function splitAnswers(schema: FormSchema, answers: RuntimeAnswers) {
  const identity: { firstName?: string | null; lastName?: string | null; email?: string | null } = {};
  const extras: Record<string, { value: string; fhirPath: string | null }> = {};

  for (const field of schema.fields) {
    const ap = field.apiProperty;
    if (!ap) continue;
    const raw = answers[field.id];
    if (raw === undefined || raw === null) continue;

    if (CORE_KEYS.has(ap)) {
      if (ap === 'firstName') identity.firstName = String(raw);
      else if (ap === 'lastName') identity.lastName = String(raw);
      else if (ap === 'email') identity.email = String(raw);
    } else {
      extras[ap] = { value: String(raw), fhirPath: field.fhirPath ?? null };
    }
  }

  return { identity, extras };
}

export function UserDialog({ open, onOpenChange, user, onSaved }: UserDialogProps) {
  const { t } = useTranslation();
  const isEdit = user !== null;

  // Fixed fields (above the form, create-only)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Form schema state
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [noForm, setNoForm] = useState(false);

  // Seeded answers driven by the loaded schema + editing user
  const [initialAnswers, setInitialAnswers] = useState<RuntimeAnswers>({});

  // OpenLDR role assignment — separate from the Keycloak identity fields above. Roles are
  // read/written via /api/users/:id/roles, not the identity create/update payload. A role now
  // *is* a precise capability set, so a user gets at most one ('' = no role).
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The identity record once it has been created/updated this dialog-open session. Set when
  // the identity write succeeds but the subsequent setUserRoles call fails, so a retry only
  // re-attempts the role assignment instead of creating a duplicate user / re-PUTting identity.
  const [savedIdentity, setSavedIdentity] = useState<UserSummary | null>(null);

  // Load the published 'users' form schema when the dialog opens
  useEffect(() => {
    if (!open) return;
    setUsername(user?.username ?? '');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSaving(false);
    setSchema(null);
    setNoForm(false);
    setSavedIdentity(null);

    setSchemaLoading(true);
    listPublishedForms('users')
      .then(async (summaries) => {
        if (summaries.length === 0) { setNoForm(true); return; }
        // Use the first published 'users' form
        const summary = summaries[0];
        const def = await getForm(summary.id);
        // Validate the server-returned schema with the zod parser before trusting it.
        const parsed = FormSchemaZ.safeParse(def.schema);
        if (!parsed.success) {
          setNoForm(true);
          setError(`User form schema is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
          return;
        }
        const loaded = parsed.data as FormSchema;
        setSchema(loaded);
        // Seed answers from the user being edited (if any)
        if (user && loaded) setInitialAnswers(seedAnswers(loaded, user));
        else setInitialAnswers({});
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setSchemaLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  // Load the role catalog + (when editing) the user's current role assignment. A user may have
  // at most one role; if the API ever returns several (legacy data), take the first and don't
  // crash.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRolesLoading(true);
    setRoles([]);
    setSelectedRoleId('');

    const load = async () => {
      const allRoles = await listRoles();
      if (cancelled) return;
      setRoles(allRoles);
      if (user) {
        const current = await getUserRoles(user.id);
        if (!cancelled) setSelectedRoleId(current[0]?.id ?? '');
      }
    };
    load()
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, user?.id]);

  /** Shared create-only validation for the fixed username/password fields above the form. */
  const validateCore = (): boolean => {
    if (!isEdit && !username.trim() && !savedIdentity) { setError('Username is required.'); return false; }
    if (!isEdit && password && password !== confirmPassword && !savedIdentity) { setError(t('users.passwordMismatch')); return false; }
    return true;
  };

  /**
   * Shared create/update + role-assignment logic used by both the form-present path
   * (identity + extras collected from the published Users form) and the no-form path
   * (identity/extras are empty — only username/password/role apply). The published Users form
   * is optional enrichment on top of this core; it is never required to create or edit a user.
   */
  const persist = async (
    identity: IdentityPatch,
    extras: Record<string, { value: string; fhirPath: string | null }>,
    formMeta: FormMeta,
  ) => {
    setSaving(true);
    setError(null);
    try {
      // If a prior submit already persisted the identity but failed to assign roles, don't
      // re-create/re-update it — just retry the role assignment for the same directory id.
      let saved: UserSummary;
      if (savedIdentity) {
        saved = savedIdentity;
      } else if (isEdit) {
        saved = await updateUser(user.id, {
          ...identity,
          extras,
          ...formMeta,
        });
      } else {
        saved = await createUser({
          username: username.trim(),
          ...identity,
          // password is optional on create: Keycloak account is created; password set later via reset/activation email.
          ...(password ? { password } : {}),
          extras,
          ...formMeta,
        });
      }
      if (!savedIdentity) { setSavedIdentity(saved); onSaved(saved); }

      try {
        await setUserRoles(saved.id, selectedRoleId ? [selectedRoleId] : []);
      } catch (roleErr) {
        // The identity write already succeeded and onSaved has already run — surface this
        // inline and keep the dialog open so the user can retry role assignment (or close and
        // fix it later by re-editing this user).
        setError(t('users.rolesSaveError', { error: roleErr instanceof Error ? roleErr.message : String(roleErr) }));
        return;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** Form-present path: FormRuntime hands back validated answers, split into identity + extras. */
  const handleSubmit = async (answers: RuntimeAnswers) => {
    if (!schema) return;
    if (!validateCore()) return;
    const { identity, extras } = splitAnswers(schema, answers);
    await persist(identity, extras, { formSchemaId: schema.id, formVersion: schema.version });
  };

  /**
   * No-form path (seedless deployments, or the Users form failed to load): no extra profile
   * fields to collect, so identity/extras are empty and formSchemaId/formVersion are omitted
   * entirely — both are optional on CreateUserPayload/the server's create/update input schemas.
   */
  const handleCoreSubmit = async () => {
    if (!validateCore()) return;
    await persist({}, {}, {});
  };

  // Whether the published Users form is loaded and usable this render — everything else
  // (loading, no published form, or a form that failed schema validation) falls back to the
  // dialog's own core-only Save path so the user can always be created/edited.
  const formReady = !schemaLoading && !noForm && schema !== null;
  // Whether we've conclusively determined there is no usable form yet — guards the no-form
  // Save button so it isn't clickable during the brief window before the load effect has even
  // set schemaLoading (avoids racing ahead of a form that's about to load).
  const formUnresolved = !noForm && schema === null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isEdit ? t('users.editUserTitle') : t('users.newUserTitle')}</SheetTitle>
          <SheetDescription>{isEdit ? t('users.editUserDesc') : t('users.newUserDesc')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {/* Fixed fields above the form — create only */}
          {!isEdit && (
            <div className="grid gap-4 px-6 py-4 border-b border-border">
              <div className="space-y-1">
                <Label htmlFor="user-username">{t('users.username')}</Label>
                <Input
                  id="user-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="user-password">{t('users.newPassword')}</Label>
                <Input
                  id="user-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={t('users.newPasswordPlaceholder')}
                />
              </div>
              {password && (
                <div className="space-y-1">
                  <Label htmlFor="user-confirm-password">{t('users.confirmPassword')}</Label>
                  <Input
                    id="user-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}
            </div>
          )}

          {/* OpenLDR role assignment — separate from the form-template identity fields below.
              A role now IS a precise capability set, so a user gets exactly one (or none). */}
          <div className="grid gap-2 px-6 py-4 border-b border-border">
            <Label htmlFor="user-role-select">{t('users.rolesLabel')}</Label>
            {rolesLoading ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('users.noRolesAvailable')}</p>
            ) : (
              <Select
                value={selectedRoleId || NO_ROLE_VALUE}
                onValueChange={(v) => setSelectedRoleId(v === NO_ROLE_VALUE ? '' : v)}
              >
                <SelectTrigger id="user-role-select" className="w-full" aria-label={t('users.rolesLabel')}>
                  <SelectValue placeholder={t('users.selectRolePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE_VALUE}>{t('users.noRoleOption')}</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Form-template body — the published Users form is optional enrichment on top of the
              core username/password/role above; it is never required to create or edit a user. */}
          {schemaLoading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : null}

          {formReady && schema ? (
            <FormRuntime
              key={`${schema.id}-${user?.id ?? 'new'}`}
              schema={schema}
              initialAnswers={initialAnswers}
              onSubmit={handleSubmit}
              footer={
                <SheetFooter className="border-t border-border px-6 py-4 sm:justify-end">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
                  </Button>
                </SheetFooter>
              }
            />
          ) : (
            <>
              {noForm && !schemaLoading ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  {t('users.noUsersForm')}
                </div>
              ) : null}
              {/* No-form (or form-load-error) path: always-present, always-working Save —
                  creating/editing a user must never depend on a published Users form existing. */}
              <SheetFooter className="border-t border-border px-6 py-4 sm:justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
                <Button onClick={() => void handleCoreSubmit()} disabled={saving || schemaLoading || formUnresolved}>
                  {saving ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
                </Button>
              </SheetFooter>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
