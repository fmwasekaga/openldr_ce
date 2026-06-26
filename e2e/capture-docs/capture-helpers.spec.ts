import { expect, test } from '@playwright/test';

import { addCallouts, removeCallouts } from './capture-helpers';

test('adds and removes numbered callout overlays', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="save">Save training form</button>
    </main>
  `);

  await addCallouts(page, [{ number: 1, selector: '#save' }]);

  const callout = page.locator('[data-doc-callout="1"]');
  await expect(callout).toHaveText('1');
  await expect(callout).toHaveCSS('pointer-events', 'none');

  await removeCallouts(page);

  await expect(page.locator('[data-doc-callout]')).toHaveCount(0);
});
