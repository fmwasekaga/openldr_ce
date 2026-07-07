// apps/studio/src/query/QueryPage.tsx
import { AppShell } from '../shell/AppShell';
import { useTranslation } from 'react-i18next';

export function QueryPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <AppShell title={t('nav.query')}>
      <div className="flex h-full">
        <div className="w-60 border-r border-border" data-testid="query-explorer" />
        <div className="flex-1" data-testid="query-workspace" />
      </div>
    </AppShell>
  );
}
