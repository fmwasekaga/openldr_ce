import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { resetUserPassword, type User } from '@/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onDone: (user: User) => void;
}

export function ResetPasswordDialog({ open, onOpenChange, user, onDone }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (open) { setPassword(''); setConfirm(''); setError(null); setCopied(false); } }, [open]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* admin can read the field */ }
  };

  const submit = async () => {
    if (password.length < 1) { setError(t('users.passwordRequired')); return; }
    if (password !== confirm) { setError(t('users.passwordMismatch')); return; }
    if (!user) return;
    setError(null); setSaving(true);
    try {
      await resetUserPassword(user.id, password, true);
      onDone(user);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="space-y-1.5">
          <DialogTitle>{t('users.resetPasswordTitle')}</DialogTitle>
          <DialogDescription>{user ? t('users.resetPasswordDescription', { username: user.username }) : ''}</DialogDescription>
        </div>
        <div className="space-y-3 py-2">
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          <div>
            <Label htmlFor="rp-new">{t('users.newPassword')}</Label>
            <div className="flex gap-2">
              <Input id="rp-new" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={t('users.newPasswordPlaceholder')} />
              <Button type="button" variant="outline" size="icon" onClick={() => void copy()} disabled={password.length === 0} aria-label={t('users.copyPassword')}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="rp-confirm">{t('users.confirmPassword')}</Label>
            <Input id="rp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <p className="text-[11px] text-muted-foreground">{t('users.resetPasswordHint')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? t('common.saving') : t('users.resetPasswordButton')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
