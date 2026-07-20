# Final Fix Report

## Files Changed

- `apps/web/src/components/Hero.tsx`: replaced the fragment CTA with an accessible button that smoothly scrolls to `#install` without changing the HashRouter location.
- `apps/web/src/components/Hero.test.tsx`: added a regression test for the CTA click, hash preservation, and `scrollIntoView` call.
- `apps/web/src/components/ScreenshotFrame.tsx`: changed fixed-frame screenshots to `object-contain` so non-16:10 assets remain uncropped.
- `apps/web/src/components/ScreenshotFrame.test.tsx`: asserted non-cropping image fit classes.
- `apps/web/src/main.tsx`: removed the redundant side-effect screenshot import.

## Tests Run

- `pnpm --filter @openldr/web test -- src/components/Hero.test.tsx src/components/ScreenshotFrame.test.tsx src/App.test.tsx` (6 passed)
- `pnpm --filter @openldr/web typecheck` (passed)
- `pnpm --filter @openldr/web build` (passed)

## Visual/Browser Checks

- Confirmed the local Vite server served the landing page at `http://127.0.0.1:4173`.
- Attempted a Playwright CLI desktop/mobile check, but the CLI did not return a usable snapshot or interaction result after its first-run setup. The focused DOM regression test covers the CTA behavior; browser visual validation was not completed.

## Commit

- `fix(web): repair landing CTA and screenshot framing`
