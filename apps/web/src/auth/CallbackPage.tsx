import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchClientConfig } from '@/api';
import { createOidc } from './oidc';
import { Button } from '@/components/ui/button';

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
        await createOidc(cfg.oidc).handleCallback();
        if (active) navigate('/', { replace: true });
      } catch { if (active) setError(true); }
    })();
    return () => { active = false; };
  }, [navigate]);
  const retry = async () => {
    const cfg = await fetchClientConfig();
    if (cfg.oidc) await createOidc(cfg.oidc).signinRedirect();
  };
  return (
    <div className="flex min-h-screen items-center justify-center">
      {error
        ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">{t('common.callbackError')}</p>
            <Button onClick={() => void retry()}>{t('common.signIn')}</Button>
          </div>
        )
        : <p className="text-sm text-muted-foreground">{t('common.signingIn')}</p>}
    </div>
  );
}
