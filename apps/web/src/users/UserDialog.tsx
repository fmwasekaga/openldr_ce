import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { createUser, updateUser, listPublishedForms, getForm, type UserSummary } from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { FormSchema, RuntimeAnswers } from '@/forms-runtime/types';

// CORE apiProperty keys that map to Keycloak identity fields.
const CORE_KEYS = new Set(['firstName', 'lastName', 'email', 'roles']);

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
      else if (ap === 'roles') val = user.roles.length > 0 ? user.roles : undefined;
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
  const identity: { firstName?: string | null; lastName?: string | null; email?: string | null; roles?: string[] } = {};
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
      else if (ap === 'roles') identity.roles = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    setSchemaLoading(true);
    listPublishedForms('users')
      .then(async (summaries) => {
        if (summaries.length === 0) { setNoForm(true); return; }
        // Use the first published 'users' form
        const summary = summaries[0];
        const def = await getForm(summary.id);
        // Cast to FormSchema — the server stores the schema as the parsed object
        const loaded = def.schema as FormSchema;
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

  const handleSubmit = async (answers: RuntimeAnswers) => {
    if (!schema) return;
    if (!isEdit && !username.trim()) { setError('Username is required.'); return; }
    if (!isEdit && password && password !== confirmPassword) { setError(t('users.passwordMismatch')); return; }

    const { identity, extras } = splitAnswers(schema, answers);
    setSaving(true);
    setError(null);
    try {
      let saved: UserSummary;
      if (isEdit) {
        saved = await updateUser(user.id, {
          ...identity,
          extras,
          formSchemaId: schema.id,
          formVersion: schema.version,
        });
      } else {
        saved = await createUser({
          username: username.trim(),
          ...identity,
          ...(password ? { password } : {}),
          extras,
          formSchemaId: schema.id,
          formVersion: schema.version,
        });
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

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

          {/* Form-template body */}
          {schemaLoading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : noForm ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {t('users.noUsersForm')}
            </div>
          ) : schema ? (
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
            // No schema loaded yet but not in loading/error state — render footer only
            <SheetFooter className="border-t border-border px-6 py-4 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
            </SheetFooter>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
