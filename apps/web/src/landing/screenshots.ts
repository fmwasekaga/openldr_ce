import dashboardOverviewUrl from '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png?url';
import workflowBuilderUrl from '../../../studio/src/docs/0.1.0/screenshots/workflow-builder.png?url';
import reportsRunResultUrl from '../../../studio/src/docs/0.1.0/screenshots/reports-run-result.png?url';
import formBuilderUrl from '../../../studio/src/docs/0.1.0/screenshots/form-builder.png?url';
import queryWorkbenchUrl from '../../../studio/src/docs/0.1.0/screenshots/query-workbench.png?url';
import reportDesignerCanvasUrl from '../../../studio/src/docs/0.1.0/screenshots/report-designer-canvas.png?url';
import syncSettingsCardUrl from '../../../studio/src/docs/0.1.0/screenshots/sync-settings-card.png?url';

export const PUBLIC_SCREENSHOT_NAMES = [
  'dashboard-overview.png',
  'workflow-builder.png',
  'reports-run-result.png',
  'form-builder.png',
  'query-workbench.png',
  'report-designer-canvas.png',
  'sync-settings-card.png',
] as const;

export type PublicScreenshotName = (typeof PUBLIC_SCREENSHOT_NAMES)[number];

const screenshotModules: Record<string, string> = {
  '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png': dashboardOverviewUrl,
  '../../../studio/src/docs/0.1.0/screenshots/workflow-builder.png': workflowBuilderUrl,
  '../../../studio/src/docs/0.1.0/screenshots/reports-run-result.png': reportsRunResultUrl,
  '../../../studio/src/docs/0.1.0/screenshots/form-builder.png': formBuilderUrl,
  '../../../studio/src/docs/0.1.0/screenshots/query-workbench.png': queryWorkbenchUrl,
  '../../../studio/src/docs/0.1.0/screenshots/report-designer-canvas.png': reportDesignerCanvasUrl,
  '../../../studio/src/docs/0.1.0/screenshots/sync-settings-card.png': syncSettingsCardUrl,
};

export function makeScreenshotMap(modules: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
  );
}

export const SCREENSHOTS = makeScreenshotMap(screenshotModules);

export function screenshotUrl(name: PublicScreenshotName | string): string | null {
  return SCREENSHOTS[name] ?? null;
}
