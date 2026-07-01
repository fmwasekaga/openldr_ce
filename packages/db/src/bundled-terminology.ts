import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// License-safe terminology fixtures bundled with OpenLDR CE and auto-imported (idempotently)
// on first boot. Only freely-redistributable sets live here: the HL7 FHIR R4 base ValueSet
// catalog and the full UCUM CodeSystem. LOINC / SNOMED CT / RxNorm stay user-provided.
//
// Resolution is relative to THIS source file so it works whether the package is consumed as
// TS source (the workspace default — `exports` points at ./src) or compiled to dist alongside
// a copied `fixtures/` dir. Fixtures live at packages/db/fixtures/fhir/*.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fhir');

export const BUNDLED_TERMINOLOGY = {
  /** HL7 FHIR R4 base ValueSet catalog (compact `{ version, valueSets[], codeSystems[] }`). */
  fhirR4Catalog: join(FIXTURES_DIR, 'R4.valuesets.json.gz'),
  /** Full UCUM code system as a FHIR CodeSystem (url http://unitsofmeasure.org). */
  ucumCodeSystem: join(FIXTURES_DIR, 'ucum.codesystem.json.gz'),
} as const;

/**
 * Read + gunzip + JSON-parse a bundled terminology fixture. Returns `null` if the file is
 * missing (ENOENT) so a fresh-install seed can degrade gracefully rather than abort. Any other
 * error (corrupt gzip, bad JSON) is thrown — that's a genuine packaging bug worth surfacing.
 */
export async function readBundledTerminology(path: string): Promise<unknown | null> {
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(gunzipSync(buf).toString('utf8'));
}
