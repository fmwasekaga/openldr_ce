import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import { downloadAndExtract } from './terminology-dist-extract';

// Build a real 2-file zip in memory with adm-zip (the brief's hardcoded base64 fixture was
// fabricated and not a valid zip file, so we generate one instead).
function buildFixtureZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('A'));
  zip.addFile('b/c.txt', Buffer.from('C'));
  return zip.toBuffer();
}

describe('downloadAndExtract', () => {
  it('streams a zip from the blob and extracts its entries to a dir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kc-ext-'));
    const zipBytes = buildFixtureZip();
    const blob = { getStream: async () => Readable.from([zipBytes]) };
    const { distDir, cleanup } = await downloadAndExtract(blob, 'k.zip', workDir);
    expect(readFileSync(join(distDir, 'a.txt'), 'utf8')).toBe('A');
    expect(readFileSync(join(distDir, 'b', 'c.txt'), 'utf8')).toBe('C');
    await cleanup();
    expect(existsSync(distDir)).toBe(false);
  });
});
