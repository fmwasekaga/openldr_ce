import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { resetUserPassword, type User } from '@/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onDone: (user: User) => void;
}

/** Strong random password from an unambiguous alphabet (no 0/O/1/l/I). */
function generatePassword(len = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export function ResetPasswordDialog({ open, onOpenChange, user, onDone }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [requireChange, setRequireChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) { setPassword(''); setConfirm(''); setReveal(false); setRequireChange(true); setError(null); setCopied(false); }
  }, [open]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* admin can reveal + read the field */ }
  };

  const generate = () => { const p = generatePassword(); setPassword(p); setConfirm(p); setReveal(true); };

  const submit = async () => {
    if (password.length < 1) { setError(t('users.passwordRequired')); return; }
    if (password !== confirm) { setError(t('users.passwordMismatch')); return; }
    if (!user) return;
    setError(null); setSaving(true);
    try {
      await resetUserPassword(user.id, password, requireChange);
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
            <div className="flex items-center justify-between">
              <Label htmlFor="rp-new">{t('users.newPassword')}</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={generate}>
                <RefreshCw className="mr-1 h-3 w-3" />{t('users.generatePassword')}
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input id="rp-new" type={reveal ? 'text' : 'password'} className="pr-9" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder={t('users.newPasswordPlaceholder')} />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? t('users.hidePassword') : t('users.showPassword')}
                  className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => void copy()} disabled={password.length === 0} aria-label={t('users.copyPassword')}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="rp-confirm">{t('users.confirmPassword')}</Label>
            <Input id="rp-confirm" type={reveal ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={requireChange} onCheckedChange={(c) => setRequireChange(!!c)} />
            {t('users.requireChangeLabel')}
          </label>
          <p className="text-[11px] text-muted-foreground">{requireChange ? t('users.resetPasswordHint') : t('users.resetPasswordHintPermanent')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? t('common.saving') : t('users.resetPasswordButton')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
