import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { createUser, updateUser, setUserStatus, USER_ROLES, type CreateUserInput, type User } from '@/api';

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSaved: (user: User) => void;
}

function sortedRoles(roles: string[]): string[] {
  return [...new Set(roles)].sort((a, b) => {
    const ai = USER_ROLES.indexOf(a as (typeof USER_ROLES)[number]);
    const bi = USER_ROLES.indexOf(b as (typeof USER_ROLES)[number]);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function UserDialog({ open, onOpenChange, user, onSaved }: UserDialogProps) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [roleDraft, setRoleDraft] = useState('');
  const [status, setStatus] = useState<'active' | 'disabled'>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(user?.username ?? '');
    setDisplayName(user?.displayName ?? '');
    setEmail(user?.email ?? '');
    setRoles(sortedRoles(user?.roles ?? []));
    setRoleDraft('');
    setStatus(user?.status ?? 'active');
    setSaving(false);
    setError(null);
  }, [open, user]);

  const canSave = useMemo(() => isEdit || username.trim().length > 0, [isEdit, username]);

  const addRole = (role = roleDraft) => {
    const trimmed = role.trim();
    if (!trimmed) return;
    setRoles((prev) => sortedRoles([...prev, trimmed]));
    setRoleDraft('');
  };

  const removeRole = (role: string) => {
    setRoles((prev) => prev.filter((item) => item !== role));
  };

  const save = async () => {
    if (!canSave) {
      setError('Username is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let saved: User;
      if (isEdit) {
        saved = await updateUser(user.id, { displayName: displayName.trim() || null, email: email.trim() || null, roles });
        if (saved.status !== status) saved = await setUserStatus(saved.id, status);
      } else {
        const input: CreateUserInput = { username: username.trim(), displayName: displayName.trim() || null, email: email.trim() || null, roles };
        saved = await createUser(input);
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <section className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="user-username">Username</Label>
              <Input id="user-username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={isEdit} autoComplete="off" />
              {isEdit ? <p className="text-[11px] text-muted-foreground">Username cannot be changed after creation.</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="user-display-name">Full name</Label>
              <Input id="user-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
          </section>

          <section className="space-y-2">
            <div>
              <Label htmlFor="user-role-draft">Roles</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="user-role-draft"
                  aria-label="Add role"
                  list="user-role-options"
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addRole();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={() => addRole()}>Add</Button>
                <datalist id="user-role-options">
                  {USER_ROLES.map((role) => <option key={role} value={role} />)}
                </datalist>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roles.length === 0 ? <span className="text-xs text-muted-foreground">No roles assigned.</span> : roles.map((role) => (
                <button
                  key={role}
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/30 px-2 text-xs"
                  onClick={() => removeRole(role)}
                >
                  {role}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </section>

          {isEdit ? (
            <section className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
              <Checkbox id="user-active" checked={status === 'active'} onCheckedChange={(checked) => setStatus(checked === true ? 'active' : 'disabled')} />
              <div className="-mt-0.5">
                <Label htmlFor="user-active" className="cursor-pointer">Active</Label>
                <p className="text-[11px] text-muted-foreground">Disabled users remain listed but cannot sign in.</p>
              </div>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border px-6 py-4 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={() => { void save(); }} disabled={saving || !canSave}>
            {saving ? t('common.loading') : isEdit ? t('common.save') : t('common.create')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
