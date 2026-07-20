import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import type { BlobStoragePort } from '@openldr/ports';

/** Stream a distribution zip from the blob store to `workDir`, extract it, and return the extracted
 *  root plus a cleanup that removes the whole working dir (zip + extracted tree). Nothing is buffered
 *  fully in memory: the blob is streamed to a temp file, then unzipper streams each entry to disk. */
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

  // NOTE: unzipper.Extract() is a duplexer2(parser, outStream) stream. duplexer2 auto-ends the
  // duplex (emitting the *native* 'finish' event) as soon as the inner zip `parser` has consumed
  // all input bytes -- which races ahead of `outStream` actually flushing extracted entries to
  // disk. `pipeline()` resolves on that native 'finish', so it can return before nested-directory
  // entries are written. unzipper's own `.promise()` instead waits for the 'close' event it emits
  // only after `outStream` finishes, which is the true "extraction complete" signal.
  await new Promise<void>((resolve, reject) => {
    const extractStream = unzipper.Extract({ path: distDir });
    const readStream = createReadStream(zipPath);
    readStream.on('error', reject);
    readStream.pipe(extractStream);
    extractStream.promise().then(resolve, reject);
  });

  return {
    distDir,
    async cleanup() { await rm(workDir, { recursive: true, force: true }); },
  };
}
