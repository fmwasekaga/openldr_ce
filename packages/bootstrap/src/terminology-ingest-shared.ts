import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { AuditStore } from '@openldr/audit';
import { deriveSystemCode, resolveSeedPublisherId, type TerminologyAdminStore, type TerminologyIngestJob, type TerminologyIngestJobStore } from '@openldr/db';
import { canonicalSystemUrl, ingestDistribution, type IngestProgress } from '@openldr/terminology';
import { downloadAndExtract } from './terminology-dist-extract';

// Resolve the coding system for a systemType by its loader-backed canonical URL, creating it if
// absent with the SAME values loadLoinc's saveSystem uses (so it is one row, not a duplicate).
// Shared by the upload route and the CLI so both key concepts to exactly one URL per system.
export async function resolveCodingSystemId(
  admin: TerminologyAdminStore,
  systemType: string,
  version: string | null,
): Promise<string> {
  const url = canonicalSystemUrl(systemType);
  if (!url) throw new Error(`unsupported system type: ${systemType}`);
  let cs = await admin.codingSystems.getByUrl(url);
  if (!cs) {
    await admin.codingSystems.upsertByUrl({
      url,
      systemCode: deriveSystemCode(url),
      systemName: deriveSystemCode(url),
      systemVersion: version,
      publisherId: resolveSeedPublisherId(url),
    });
    cs = await admin.codingSystems.getByUrl(url);
  }
  return cs!.id;
}
