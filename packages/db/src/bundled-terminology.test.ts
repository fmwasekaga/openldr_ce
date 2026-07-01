import { describe, it, expect } from 'vitest';
import { BUNDLED_TERMINOLOGY, readBundledTerminology } from './bundled-terminology';

describe('readBundledTerminology', () => {
  it('reads + gunzips the bundled FHIR R4 catalog', async () => {
    const catalog = (await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog)) as {
      version?: string;
      valueSets?: unknown[];
    } | null;
    expect(catalog).not.toBeNull();
    expect(catalog!.version).toBe('R4');
    expect(Array.isArray(catalog!.valueSets)).toBe(true);
    expect(catalog!.valueSets!.length).toBeGreaterThan(100);
  });

  it('reads + gunzips the bundled UCUM CodeSystem with a plausible concept count', async () => {
    const ucum = (await readBundledTerminology(BUNDLED_TERMINOLOGY.ucumCodeSystem)) as {
      resourceType?: string;
      url?: string;
      content?: string;
      concept?: { code: string; display?: string }[];
    } | null;
    expect(ucum).not.toBeNull();
    expect(ucum!.resourceType).toBe('CodeSystem');
    expect(ucum!.url).toBe('http://unitsofmeasure.org');
    expect(ucum!.content).toBe('complete');
    // Hundreds of atomic UCUM units + prefixes.
    expect(ucum!.concept!.length).toBeGreaterThan(300);
    // Atomic units present (composed lab units ship separately via migration 017).
    expect(ucum!.concept!.some((c) => c.code === 'm' && c.display === 'meter')).toBe(true);
    expect(ucum!.concept!.some((c) => c.code === 'g')).toBe(true);
  });

  it('returns null for a missing fixture (graceful degradation)', async () => {
    const result = await readBundledTerminology(
      BUNDLED_TERMINOLOGY.ucumCodeSystem.replace('ucum.codesystem', 'does-not-exist'),
    );
    expect(result).toBeNull();
  });
});
