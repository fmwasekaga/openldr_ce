import dashboardOverviewUrl from '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png?url';

export const PUBLIC_SCREENSHOT_NAMES = [
  'dashboard-overview.png',
] as const;

export type PublicScreenshotName = (typeof PUBLIC_SCREENSHOT_NAMES)[number];

const screenshotModules: Record<string, string> = {
  '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png': dashboardOverviewUrl,
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
