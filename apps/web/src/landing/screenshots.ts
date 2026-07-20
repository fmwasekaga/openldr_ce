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

const screenshotModules = import.meta.glob('../../../studio/src/docs/0.1.0/screenshots/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function makeScreenshotMap(modules: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
  );
}

export const SCREENSHOTS = makeScreenshotMap(screenshotModules);

export function screenshotUrl(name: PublicScreenshotName | string): string | null {
  return SCREENSHOTS[name] ?? null;
}
