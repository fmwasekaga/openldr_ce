import { useTranslation } from 'react-i18next';
import type { ArtifactPayloadMeta } from '@/api';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-[12px] text-foreground/90 break-all">{value}</dd>
    </div>
  );
}

export function PayloadPreview({ payload }: { payload: ArtifactPayloadMeta | null }) {
  const { t } = useTranslation();
  if (!payload) {
    return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
  }
  if (payload.kind === 'plugin') {
    const sha = payload.wasmSha256 ? `${payload.wasmSha256.slice(0, 16)}…` : '—';
    return (
      <dl className="rounded-md border border-border p-3 text-[13px]">
        <Row label={t('settings.marketplace.entrypoint')} value={payload.entrypoint ?? 'convert'} />
        <Row label={t('settings.marketplace.checksum')} value={sha} />
        <Row label={t('settings.marketplace.sandbox')} value={payload.wasi ? t('settings.marketplace.wasiOn') : t('settings.marketplace.wasiOff')} />
        {payload.limits ? (
          <>
            <Row label={t('settings.marketplace.memoryLimit')} value={`${payload.limits.memoryMb} MB`} />
            <Row label={t('settings.marketplace.timeLimit')} value={`${payload.limits.timeoutMs} ms`} />
          </>
        ) : null}
      </dl>
    );
  }
  // Non-plugin kinds (form/report/test-definition) — fleshed out in sub-project C.
  return <p className="text-sm text-muted-foreground">{t('settings.marketplace.payloadUnavailable')}</p>;
}
