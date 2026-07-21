import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, createReadStream } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
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

// Build a zip on disk via Python (no zip *writer* dep is present in this repo) with forward-slash
// entries, then expose it through a fake blob (getStream = plain file read) so downloadAndExtract's
// random-access path (unzipper.Open.file) can be exercised against a real on-disk zip, including
// zip-slip entries that a streaming Extract() would silently write outside distDir.
async function makeZip(files: Record<string, string>, root: string): Promise<string> {
  const stage = join(root, 'stage');
  for (const [rel, content] of Object.entries(files)) {
    const p = join(stage, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, content);
  }
  const zipPath = join(root, 'dist.zip');
  execFileSync('python', ['-c',
    `import zipfile,os,sys\n` +
    `root=sys.argv[1]; out=sys.argv[2]\n` +
    `z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)\n` +
    `[z.write(os.path.join(dp,f), os.path.relpath(os.path.join(dp,f),root).replace(os.sep,'/')) for dp,_,fs in os.walk(root) for f in fs]\n` +
    `z.close()`,
    stage, zipPath]);
  return zipPath;
}

function fakeBlob(zipPath: string) {
  return { async getStream() { return createReadStream(zipPath); } };
}

describe('downloadAndExtract (random-access)', () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it('extracts a nested-directory zip to the right paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    const zipPath = await makeZip({
      'LoincTable/Loinc.csv': 'LOINC_NUM\n1-0\n',
      'AccessoryFiles/PartFile/x.csv': 'a,b\n1,2\n',
    }, root);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    const { distDir, cleanup } = await downloadAndExtract(fakeBlob(zipPath), 'k', workDir);
    expect((await readFile(join(distDir, 'LoincTable', 'Loinc.csv'), 'utf8'))).toContain('LOINC_NUM');
    expect((await stat(join(distDir, 'AccessoryFiles', 'PartFile', 'x.csv'))).isFile()).toBe(true);
    await cleanup();
  });

  it('rejects a zip-slip entry escaping the dist dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    // craft a slip entry via python (arcname with ../)
    const stage = join(root, 's'); await mkdir(stage, { recursive: true }); await writeFile(join(stage, 'ok.txt'), 'ok');
    const zipPath = join(root, 'slip.zip');
    execFileSync('python', ['-c',
      `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[2],'w')\nz.writestr('../evil.txt','x')\nz.write(sys.argv[1]+'/ok.txt','ok.txt')\nz.close()`,
      stage, zipPath]);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    await expect(downloadAndExtract(fakeBlob(zipPath), 'k', workDir)).rejects.toThrow(/zip.?slip|outside|invalid entry/i);
  });
});
