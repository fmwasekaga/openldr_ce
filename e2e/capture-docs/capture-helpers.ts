import type { Locator, Page } from '@playwright/test';

import type { CaptureStep, CaptureManifestShot } from './manifest';

export type ReadyTarget = CaptureManifestShot['ready'];
export type Callout = NonNullable<CaptureManifestShot['callouts']>[number];

const DISABLE_ANIMATIONS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
`;

export async function preparePage(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.addInitScript((selectedTheme) => {
    try {
      localStorage.setItem('openldr-theme', selectedTheme);
      localStorage.setItem('openldr-locale', 'en');
      localStorage.setItem('i18nextLng', 'en');
    } catch {
      // Ignore storage failures in synthetic pages.
    }
    document.documentElement.lang = 'en';
    document.documentElement.setAttribute('data-theme', selectedTheme);
  }, theme);
}

export async function runCaptureSteps(page: Page, steps: CaptureStep[]): Promise<void> {
  for (const step of steps) {
    try {
      if (step.action === 'click') {
        await page.getByRole(step.role as Parameters<Page['getByRole']>[0], { name: step.name }).click({ timeout: 5_000 });
      } else if (step.action === 'clickTestId') {
        await page.getByTestId(step.testId).click({ timeout: 5_000 });
      } else if (step.action === 'fill') {
        await page.getByLabel(step.label).fill(step.value, { timeout: 5_000 });
      } else if (step.action === 'fillTestId') {
        await page.getByTestId(step.testId).fill(step.value, { timeout: 5_000 });
      } else if (step.action === 'selectText') {
        await page.getByText(step.text, { exact: false }).first().click({ timeout: 5_000 });
      } else if (step.action === 'waitForText') {
        await page.getByText(step.text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5_000 });
      }
    } catch (error) {
      throw new Error(`capture step failed: ${JSON.stringify(step)}`, { cause: error });
    }
  }
}

export async function waitUntilReady(page: Page, ready: ReadyTarget): Promise<void> {
  try {
    if (ready.kind === 'selector') {
      await page.locator(ready.value).first().waitFor({ state: 'visible', timeout: 5_000 });
      return;
    }
    await page.getByText(ready.value, { exact: false }).first().waitFor({ state: 'visible', timeout: 5_000 });
  } catch (error) {
    throw new Error(`ready target not visible: ${ready.kind} ${ready.value}`, { cause: error });
  }
}

export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({ content: DISABLE_ANIMATIONS });
}

export async function addCallouts(page: Page, callouts: Callout[] = []): Promise<void> {
  await removeCallouts(page);
  for (const callout of callouts) {
    const target = page.locator(callout.selector).first();
    await target.waitFor({ state: 'visible', timeout: 5_000 }).catch((error: unknown) => {
      throw new Error(`callout ${callout.number} target not visible: ${callout.selector}`, { cause: error });
    });
    const box = await target.boundingBox();
    if (!box) throw new Error(`callout ${callout.number} target has no bounding box: ${callout.selector}`);
    await page.evaluate(
      ({ box, callout }) => {
        const marker = document.createElement('div');
        marker.dataset.docCallout = String(callout.number);
        marker.textContent = String(callout.number);
        marker.setAttribute('aria-hidden', 'true');
        const size = 28;
        const x = window.scrollX + box.x + box.width + (callout.offsetX ?? -14);
        const y = window.scrollY + box.y + (callout.offsetY ?? -14);
        Object.assign(marker.style, {
          alignItems: 'center',
          background: '#2f80a8',
          border: '2px solid white',
          borderRadius: '9999px',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.35)',
          color: 'white',
          display: 'flex',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: '14px',
          fontWeight: '800',
          height: `${size}px`,
          justifyContent: 'center',
          left: `${x}px`,
          lineHeight: '1',
          pointerEvents: 'none',
          position: 'absolute',
          top: `${y}px`,
          width: `${size}px`,
          zIndex: '2147483647',
        });
        document.body.append(marker);
      },
      { box, callout },
    );
  }
}

export async function removeCallouts(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[data-doc-callout]').forEach((node) => node.remove());
  });
}

export function maskLocators(page: Page, selectors: string[] = []): Locator[] {
  return selectors.map((selector) => page.locator(selector));
}
