import { test, expect } from '@playwright/test';

test('terminology page renders the publisher rail', async ({ page }) => {
  await page.goto('/terminology');

  // The rail header says exactly 'Publishers' — use exact match to avoid the
  // strict-mode violation from partial matching against 'No publishers yet.'.
  await expect(page.getByText('Publishers', { exact: true })).toBeVisible();

  // publisherSections() filters seeded publishers that have no attached coding
  // systems. In the e2e environment the systems table is empty (no FHIR/HL7 data
  // has been imported), so all 6 seeded publishers are filtered out and the rail
  // shows the empty state. This confirms the page mounted and fetched successfully.
  //
  // The create-publisher flow (Actions → Publisher → New) requires a publisher
  // already selected in the rail (the Actions kebab only appears when activeSection
  // is non-null). Because no seeded publisher clears the filter, the full create
  // flow can only run once the DB has at least one publisher with a coding system
  // attached — that is covered by the Task 17 live-acceptance run (pnpm e2e:seed +
  // full FHIR import populates the systems table).
  await expect(page.getByText('No publishers yet.')).toBeVisible();
});
