import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import type { BlobStoragePort } from '@openldr/ports';

/** Stream a distribution zip from the blob store to `workDir`, extract it via random-access (reading
 *  the zip's central directory — robust to data descriptors / ZIP64 that streaming inflate chokes on
 *  with `Z_BUF_ERROR`), and return the extracted root plus a cleanup. Per-entry streaming keeps memory
 *  bounded regardless of archive size. */
export async function downloadAndExtract(
  blob: Pick<BlobStoragePort, 'getStream'>,
  key: string,
  workDir: string,
): Promise<{ distDir: string; cleanup(): Promise<void> }> {
  const zipPath = join(workDir, 'distribution.zip');
  const distDir = join(workDir, 'dist');
  await mkdir(distDir, { recursive: true });

  const src = await blob.getStream(key);
  await pipeline(src, createWriteStream(zipPath));

  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;
    const dest = join(distDir, entry.path);
    // Zip-slip guard: the resolved destination must stay inside distDir.
    const rel = relative(distDir, dest);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`invalid entry escapes distribution dir (zip-slip): ${entry.path}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(dest));
  }

  return {
    distDir,
    async cleanup() { await rm(workDir, { recursive: true, force: true }); },
  };
}
