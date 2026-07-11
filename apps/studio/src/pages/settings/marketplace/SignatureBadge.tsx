import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type InvalidReason = 'fingerprint-mismatch' | 'payload-hash-mismatch' | 'ui-hash-mismatch' | 'bad-signature';

// Distinct failing checks get distinct labels: a valid signature over bytes that were later altered
// (e.g. a CRLF checkout) fails the payload/UI hash — NOT the signature — so "Invalid signature" would
// be wrong. bad-signature (and unknown) keep the generic label, which is accurate for that case.
const REASON_KEY: Record<InvalidReason, string> = {
  'ui-hash-mismatch': 'invalidUi',
  'payload-hash-mismatch': 'invalidPayload',
  'fingerprint-mismatch': 'invalidFingerprint',
  'bad-signature': 'invalid',
};

export function SignatureBadge({ valid, invalidReason, publisher }: { valid?: boolean; invalidReason?: InvalidReason; publisher: { name: string } | null }) {
  const { t } = useTranslation();
  if (valid === false) {
    const key = (invalidReason && REASON_KEY[invalidReason]) ?? 'invalid';
    return <Badge variant="secondary" className="border-destructive/50 text-destructive">{t(`settings.marketplace.${key}`)}</Badge>;
  }
  if (valid === undefined) {
    return <Badge variant="outline" className="text-muted-foreground">{t('settings.marketplace.unverified')}</Badge>;
  }
  if (publisher) {
    return <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.verified')}</Badge>;
  }
  return <Badge variant="outline">{t('settings.marketplace.firstUse')}</Badge>;
}
