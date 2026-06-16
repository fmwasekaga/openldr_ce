import { test, expect } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

// Single per-run suffix shared by all creates in this file.
// Using Date.now() is intentional test code — avoids cross-run DB collisions.
const RUN = Date.now();

async function seedReadyOntology(systemId: string, systemCode: string, systemUrl: string): Promise<void> {
  loadDotenv({ path: new URL('../../.env', import.meta.url) });
  const url = process.env.INTERNAL_DATABASE_URL;
  if (!url) throw new Error('INTERNAL_DATABASE_URL is required for terminology ontology e2e seed');
  const pool = new pg.Pool({ connectionString: url });
  try {
    // Seed rows directly instead of building through SSE; this keeps headless e2e
    // deterministic and avoids requiring licensed LOINC source files on CI.
    await pool.query('delete from term_mappings where from_system = $1 or to_system = $1', [systemUrl]);
    await pool.query('delete from concept_map_elements where source_system = $1 or target_system = $1', [systemUrl]);
    await pool.query('delete from terminology_concepts where system = $1', [systemUrl]);
    await pool.query('delete from ontology_specimen_map where coding_system_id = $1', [systemId]);
    await pool.query('delete from ontology_answer_options where coding_system_id = $1', [systemId]);
    await pool.query('delete from ontology_panel_members where coding_system_id = $1', [systemId]);
    await pool.query('delete from ontology_edges where coding_system_id = $1', [systemId]);
    await pool.query('delete from ontology_nodes where coding_system_id = $1', [systemId]);
    await pool.query('delete from ontology_distributions where coding_system_id = $1', [systemId]);
    await pool.query('delete from coding_systems where id = $1', [systemId]);

    await pool.query(
      `insert into coding_systems
       (id, system_code, system_name, url, system_version, description, active, publisher_id, seeded)
       values ($1, $2, 'E2E Ontology System', $3, null, 'Seeded by terminology SP4 e2e', true, 'pub-system', false)`,
      [systemId, systemCode, systemUrl],
    );
    await pool.query(
      `insert into terminology_concepts (system, code, display, status, properties)
       values ($1, 'SRC', 'Source observation', 'ACTIVE', null)`,
      [systemUrl],
    );
    await pool.query(
      `insert into ontology_nodes (coding_system_id, code, display, kind, extra)
       values
         ($1, 'ROOT-LAB', 'Laboratory observations', 'class', null),
         ($1, '2345-7', 'Blood glucose', 'loinc', '{"component":"Glucose"}'::jsonb)`,
      [systemId],
    );
    await pool.query(
      `insert into ontology_edges (coding_system_id, parent_code, child_code, seq, label)
       values
         ($1, '__ROOT__', 'ROOT-LAB', 1, null),
         ($1, 'ROOT-LAB', '2345-7', 1, 'Chemistry')`,
      [systemId],
    );
    await pool.query(
      `insert into ontology_distributions
       (coding_system_id, ontology_type, source_path, index_status, index_error, node_count, edge_count, manifest, built_at, updated_at)
       values ($1, 'loinc', 'e2e-seeded', 'ready', null, 2, 2, $2::jsonb, $3, $3)`,
      [
        systemId,
        JSON.stringify({ adapter: 'loinc', generatedAt: new Date().toISOString(), files: [] }),
        new Date().toISOString(),
      ],
    );
  } finally {
    await pool.end();
  }
}

test('terminology page lists seeded publishers and creates a publisher', async ({ page }) => {
  await page.goto('/terminology');
  await expect(page.getByText('Publishers', { exact: true })).toBeVisible();
  // Seeded publishers are always shown; select one so the Actions menu appears.
  await page.getByRole('button', { name: 'System' }).first().click();
  // The breadcrumb bar has an Actions button; table rows also have one — use first() to
  // pick the breadcrumb one which always appears first in DOM order.
  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Publisher' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();
  await page.getByLabel('Name').fill(`E2E Lab ${RUN}`);
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page.getByRole('button', { name: `E2E Lab ${RUN}` })).toBeVisible();
});

test('terminology SP3: create system -> add term -> author a value set -> preview expands', async ({ page }) => {
  const SYS_CODE = `VS${RUN}`;
  const SYS_URL = `http://e2e.test/vs/${RUN}`;
  const VS_URL = `urn:e2e:valueset:${RUN}`;

  await page.goto('/terminology');
  await page.getByRole('button', { name: 'System' }).first().click();

  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Code system' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();
  await page.getByLabel('System code').fill(SYS_CODE);
  await page.getByLabel('System name').fill('E2E VS System');
  await page.getByLabel('Canonical URL').fill(SYS_URL);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(SYS_CODE)).toBeVisible();

  await page.getByText(SYS_CODE).click();
  await page.getByRole('button', { name: 'New term' }).click();
  await page.locator('#termCode').fill('T1');
  await page.locator('#termDisplay').fill('Test term');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Create' }).click();
  await expect(page.getByText('T1')).toBeVisible();

  await page.getByRole('button', { name: '← Code systems' }).click();
  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Value set' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();

  await page.getByLabel('Canonical URL').fill(VS_URL);
  await page.getByLabel('Title').fill(`E2E VS ${RUN}`);
  // Radix Select's placeholder is not exposed consistently in headless Chromium;
  // the include-clause system picker is the last combobox in this sheet.
  await page.locator('[role="dialog"]').getByRole('combobox').last().click();
  await page.getByRole('option', { name: new RegExp(SYS_CODE) }).click();
  await page.getByRole('button', { name: 'Add concept' }).first().click();
  await page.locator('[role="dialog"] input[placeholder="code"]').first().fill('T1');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Save' }).click();

  await expect(page.locator('[role="dialog"]').getByText('T1')).toBeVisible();
});

test('terminology SP4: browse seeded ontology and use picker for a mapping target', async ({ page }) => {
  const systemId = `cs-e2e-onto-${RUN}`;
  const systemCode = `E2EONTO${RUN}`;
  const systemUrl = `urn:e2e:ontology:${RUN}`;

  await seedReadyOntology(systemId, systemCode, systemUrl);

  await page.goto('/terminology');
  await page.getByRole('button', { name: 'System' }).first().click();
  const systemRow = page.getByRole('row', { name: new RegExp(systemCode) });
  await expect(systemRow).toBeVisible();

  await systemRow.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Browse ontology' }).click();
  await expect(page.getByRole('heading', { name: 'Browse E2E Ontology System' })).toBeVisible();

  const root = page.getByRole('button', { name: /Laboratory observations/ });
  await expect(root).toBeVisible();
  await root.click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('button', { name: /Blood glucose/ })).toBeVisible();

  await page.getByPlaceholder('Search the ontology...').fill('glucose');
  await page.getByRole('button', { name: /Blood glucose/ }).click();
  await expect(page.locator('[role="dialog"]').getByText('2345-7').last()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Browse E2E Ontology System' })).not.toBeVisible();

  await page.getByText(systemCode).click();
  await expect(page.getByText('Source observation')).toBeVisible();
  await page.getByText('Source observation').click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Mappings' }).click();
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Add mapping' }).click();

  await page.getByText('Enter manually').click();
  await page.locator('[role="dialog"]').getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: systemCode }).click();
  await page.getByRole('button', { name: `Browse ${systemCode}` }).click();
  await page.getByPlaceholder('Search the ontology...').fill('glucose');
  await page.getByRole('button', { name: /Blood glucose/ }).click();
  await page.getByRole('button', { name: 'Use as target' }).click();

  await expect(page.locator('#mapping-manual-code')).toHaveValue('2345-7');
  await expect(page.locator('#mapping-manual-display')).toHaveValue('Blood glucose');
});

test('terminology SP2: create system → drill → create term', async ({ page }) => {
  // Unique system code for this run — must be a valid code (uppercase, no spaces).
  const SYS_CODE = `E2E${RUN}`;
  const SYS_URL = `http://e2e.test/${RUN}`;

  await page.goto('/terminology');
  await expect(page.getByText('Publishers', { exact: true })).toBeVisible();

  // Step 1: select the seeded "System" publisher in the rail.
  await page.getByRole('button', { name: 'System' }).first().click();

  // Step 2: create a code system with a URL via ⋯ → "Code system" → "New".
  // The breadcrumb Actions button is first in DOM order; table rows may also have one.
  await page.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Code system' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();

  // CodingSystemDialog (Sheet) is now open.
  await expect(page.getByRole('heading', { name: 'New coding system' })).toBeVisible();
  await page.getByLabel('System code').fill(SYS_CODE);
  await page.getByLabel('System name').fill('E2E Test System');
  await page.getByLabel('Canonical URL').fill(SYS_URL);
  // Click the Create button in the Sheet footer.
  await page.getByRole('button', { name: 'Create' }).click();

  // The sheet closes and the code-systems table should show the new row.
  await expect(page.getByRole('heading', { name: 'New coding system' })).not.toBeVisible();
  await expect(page.getByText(SYS_CODE)).toBeVisible();

  // Step 3: drill into the system by clicking its row.
  await page.getByText(SYS_CODE).click();

  // The TermsTable renders — "No terms found." in the body and "0 terms" in the pagination.
  await expect(page.getByText('No terms found.')).toBeVisible();

  // Step 4: create a term via the "New term" button.
  await page.getByRole('button', { name: 'New term' }).click();

  // TermDialog (Sheet) opens in new-term mode.
  await expect(page.getByRole('heading', { name: 'New term' })).toBeVisible();

  // Fill Code and Display name (their HTML ids are termCode and termDisplay).
  await page.locator('#termCode').fill('T1');
  await page.locator('#termDisplay').fill('Test term');

  // Use the ⋯ Actions menu inside the open TermDialog Sheet to Create.
  // Scope to [role="dialog"] so we don't hit the breadcrumb Actions button behind the sheet.
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Create' }).click();

  // Sheet closes; term row T1 appears in the TermsTable.
  await expect(page.getByRole('heading', { name: 'New term' })).not.toBeVisible();
  await expect(page.getByText('T1')).toBeVisible();

  // Step 5 (mapping): open the term row, switch to Mappings tab, add a mapping.
  // NOTE: This step involves nested Radix Sheets which are flaky in headless Chromium
  // (the inner sheet's focus trap competes with the outer sheet). The mapping flow is
  // covered by component tests (TermMappingDialog.test.tsx) and the live-acceptance
  // task (SP2-T15), so we skip it here to keep the e2e suite reliable.
  // test.fixme() cannot be called mid-test; instead we simply omit the sub-step.
});
