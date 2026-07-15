import { useCallback, useEffect, useState } from 'react';
import { Copy, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { fetchSites, enrollSite, rotateSite, revokeSite, type SyncSiteRow, type EnrollResult } from '@/api';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The one-time secret payload — the shape shared by enroll (full) and rotate (clientId+secret). */
interface Reveal {
  clientId: string;
  clientSecret: string;
  oidcIssuer?: string;
  centralUrl?: string;
}

export function Sites() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SyncSiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [centralUrl, setCentralUrl] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [pendingRotate, setPendingRotate] = useState<SyncSiteRow | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<SyncSiteRow | null>(null);

  const showError = useCallback((e: unknown) => {
    const status = (e as { status?: number }).status;
    if (status === 409) toast.error(t('sites.errAlreadyEnrolled'));
    else if (status === 400) toast.error(t('sites.errInvalid'));
    else if (status === 503) toast.error(t('sites.errNotConfigured'));
    else if (status === 404) toast.error(t('sites.errNotFound'));
    else toast.error(t('sites.errorToast', { error: e instanceof Error ? e.message : String(e) }));
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try { setRows(await fetchSites()); }
    catch (e) { setErrored(true); showError(e); }
    finally { setLoading(false); }
  }, [showError]);
  useEffect(() => { void load(); }, [load]);

  const openEnroll = () => { setSiteId(''); setName(''); setCentralUrl(''); setEnrollOpen(true); };

  const doEnroll = useCallback(async () => {
    if (busy || !siteId.trim() || !centralUrl.trim()) return;
    setBusy(true);
    try {
      const r: EnrollResult = await enrollSite({ siteId: siteId.trim(), name: name.trim() || undefined, centralUrl: centralUrl.trim() });
      setEnrollOpen(false);
      setReveal({ clientId: r.clientId, clientSecret: r.clientSecret, oidcIssuer: r.oidcIssuer, centralUrl: r.centralUrl });
      toast.success(t('sites.enrolledToast', { siteId: r.siteId }));
      await load();
    } catch (e) { showError(e); }
    finally { setBusy(false); }
  }, [busy, siteId, name, centralUrl, t, load, showError]);

  const doRotate = useCallback(async () => {
    if (!pendingRotate) return;
    const site = pendingRotate;
    setPendingRotate(null);
    try {
      const r = await rotateSite(site.siteId);
      setReveal({ clientId: r.clientId, clientSecret: r.clientSecret });
      toast.success(t('sites.rotatedToast', { siteId: site.siteId }));
    } catch (e) { showError(e); }
  }, [pendingRotate, t, showError]);

  const doRevoke = useCallback(async () => {
    if (!pendingRevoke) return;
    const site = pendingRevoke;
    setPendingRevoke(null);
    try {
      await revokeSite(site.siteId);
      toast.success(t('sites.revokedToast', { siteId: site.siteId }));
      await load();
    } catch (e) { showError(e); }
  }, [pendingRevoke, t, load, showError]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast.success(t('sites.copiedToast')),
      () => toast.error(t('sites.copyFailedToast')),
    );
  }, [t]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div>
            <h1 className="text-lg font-semibold">{t('sites.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('sites.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openEnroll}>{t('sites.enroll')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('sites.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { void load(); }}>{t('sites.refresh')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('sites.siteId')}</TableHead>
                <TableHead>{t('sites.name')}</TableHead>
                <TableHead>{t('sites.clientId')}</TableHead>
                <TableHead className="w-24">{t('sites.status')}</TableHead>
                <TableHead className="w-40">{t('sites.enrolledAt')}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            {!loading && !errored && rows.length > 0 && (
            <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((s) => (
                  <TableRow key={s.siteId}>
                    <TableCell className="font-medium">{s.siteId}</TableCell>
                    <TableCell>{s.name || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.clientId}</TableCell>
                    <TableCell>
                      {s.status === 'active'
                        ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('sites.statusActive')}</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">{t('sites.statusRevoked')}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(s.enrolledAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('sites.actionsFor', { siteId: s.siteId })}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPendingRotate(s)}>{t('sites.rotate')}</DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={s.status === 'revoked'}
                              className="text-destructive focus:text-destructive"
                              onClick={() => { if (s.status !== 'revoked') setPendingRevoke(s); }}
                            >
                              {t('sites.revoke')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
            )}
          </Table>
          {loading && <LoadingState className="flex-1" label={t('sites.loading')} />}
          {!loading && errored && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{t('sites.errorState')}</div>}
          {!loading && !errored && rows.length === 0 && <StripedEmpty className="flex-1">{t('sites.empty')}</StripedEmpty>}
        </div>
      </div>

      {/* Enroll dialog */}
      <Dialog open={enrollOpen} onOpenChange={(o) => { if (!o) setEnrollOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('sites.enrollTitle')}</DialogTitle>
          <DialogDescription>{t('sites.enrollDescription')}</DialogDescription>
          <div className="mt-2 grid grid-cols-1 gap-y-3 text-sm">
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.siteIdLabel')}</span>
              <Input value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder={t('sites.siteIdPlaceholder')} />
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.nameLabel')}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sites.namePlaceholder')} />
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.centralUrlLabel')}</span>
              <Input value={centralUrl} onChange={(e) => setCentralUrl(e.target.value)} placeholder={t('sites.centralUrlPlaceholder')} />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>{t('sites.cancel')}</Button>
            <Button disabled={busy || !siteId.trim() || !centralUrl.trim()} onClick={() => void doEnroll()}>{t('sites.enrollSubmit')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time secret reveal (enroll + rotate) */}
      <Dialog open={reveal !== null} onOpenChange={(o) => { if (!o) setReveal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('sites.secretTitle')}</DialogTitle>
          <DialogDescription className="text-destructive">{t('sites.secretWarning')}</DialogDescription>
          {reveal ? (
            <div className="mt-2 grid grid-cols-1 gap-y-3 text-sm">
              <SecretField label={t('sites.clientIdField')} value={reveal.clientId} onCopy={copy} copyLabel={t('sites.copy')} />
              <SecretField label={t('sites.clientSecretField')} value={reveal.clientSecret} onCopy={copy} copyLabel={t('sites.copy')} mono />
              {reveal.oidcIssuer !== undefined ? (
                <SecretField label={t('sites.oidcIssuerField')} value={reveal.oidcIssuer} onCopy={copy} copyLabel={t('sites.copy')} />
              ) : null}
              {reveal.centralUrl !== undefined ? (
                <SecretField label={t('sites.centralUrlField')} value={reveal.centralUrl} onCopy={copy} copyLabel={t('sites.copy')} />
              ) : null}
            </div>
          ) : null}
          <div className="mt-5 flex justify-end">
            <Button onClick={() => setReveal(null)}>{t('sites.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRotate !== null}
        onOpenChange={(o) => { if (!o) setPendingRotate(null); }}
        title={t('sites.rotateTitle', { siteId: pendingRotate?.siteId ?? '' })}
        description={t('sites.rotateDescription')}
        confirmLabel={t('sites.rotate')}
        onConfirm={() => { void doRotate(); }}
      />
      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => { if (!o) setPendingRevoke(null); }}
        title={t('sites.revokeTitle', { siteId: pendingRevoke?.siteId ?? '' })}
        description={t('sites.revokeDescription')}
        confirmLabel={t('sites.revoke')}
        destructive
        onConfirm={() => { void doRevoke(); }}
      />
    </>
  );
}

function SecretField({ label, value, onCopy, copyLabel, mono = false }: {
  label: string; value: string; onCopy: (v: string) => void; copyLabel: string; mono?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-xs ${mono ? 'font-mono' : ''}`}>{value}</code>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={copyLabel} onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
