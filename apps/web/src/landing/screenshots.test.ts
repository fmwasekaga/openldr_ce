import { makeScreenshotMap, PUBLIC_SCREENSHOT_NAMES, SCREENSHOTS, screenshotUrl } from './screenshots';

describe('landing screenshots', () => {
  it('keys imported screenshot URLs by bare filename', () => {
    const map = makeScreenshotMap({
      '../../../studio/src/docs/0.1.0/screenshots/dashboard-overview.png': '/assets/dashboard.hash.png',
      '../../../studio/src/docs/0.1.0/screenshots/workflow-builder.png': '/assets/workflow.hash.png',
    });

    expect(map).toEqual({
      'dashboard-overview.png': '/assets/dashboard.hash.png',
      'workflow-builder.png': '/assets/workflow.hash.png',
    });
  });

  it('returns null for a screenshot name that is not available', () => {
    expect(screenshotUrl('missing-public-shot.png')).toBeNull();
  });

  it('includes only the curated public screenshots', () => {
    expect(Object.keys(SCREENSHOTS).sort()).toEqual([...PUBLIC_SCREENSHOT_NAMES].sort());
  });
});
