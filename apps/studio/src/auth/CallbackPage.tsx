import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchClientConfig } from '@/api';
import { getOidc } from './oidc';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';

export function CallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await fetchClientConfig();
        if (!cfg.oidc) { navigate('/', { replace: true }); return; }
        await getOidc(cfg.oidc).handleCallback();
        if (active) navigate('/', { replace: true });
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; };
  }, [navigate]);
  const retry = async () => {
    try {
      const cfg = await fetchClientConfig();
      if (cfg.oidc) await getOidc(cfg.oidc).signinRedirect();
    } catch { setError(true); }
  };
  return (
    <StripedEmpty className="min-h-screen">
      {error
        ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
            <p className="text-sm text-destructive">{t('common.callbackError')}</p>
            <Button onClick={() => void retry()}>{t('common.signIn')}</Button>
          </div>
        )
        : (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">{t('common.signingIn')}</p>
          </div>
        )}
    </StripedEmpty>
  );
}
