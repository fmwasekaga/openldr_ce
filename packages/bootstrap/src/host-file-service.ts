import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWithinRoot } from './host-file-sandbox';

export interface HostFileDeps { enabled: boolean; root: string; maxBytes: number; }

export function createHostFileService(deps: HostFileDeps) {
  const resolve = (userPath: string, mustExist: boolean) =>
    resolveWithinRoot({ enabled: deps.enabled, root: deps.root, userPath, mustExist });

  return {
    async hostFileRead(userPath: string): Promise<{ bytes: Uint8Array }> {
      const abs = resolve(userPath, true);
      const st = fs.statSync(abs);
      if (st.isDirectory()) throw new Error('Read/Write File: path is a directory');
      if (st.size > deps.maxBytes) throw new Error(`Read/Write File: file exceeds the ${deps.maxBytes}-byte limit`);
      return { bytes: new Uint8Array(fs.readFileSync(abs)) };
    },
    async hostFileWrite(userPath: string, bytes: Uint8Array): Promise<{ byteSize: number }> {
      if (bytes.byteLength > deps.maxBytes) throw new Error(`Read/Write File: file exceeds the ${deps.maxBytes}-byte limit`);
      const abs = resolve(userPath, false);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      return { byteSize: bytes.byteLength };
    },
    async hostFileList(userPath: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }> {
      const abs = resolve(userPath, true);
      const dirents = fs.readdirSync(abs, { withFileTypes: true });
      const entries = dirents.map((d) => {
        let size = 0;
        try { size = fs.statSync(path.join(abs, d.name)).size; } catch { /* ignore */ }
        return { name: d.name, type: d.isDirectory() ? ('dir' as const) : ('file' as const), size };
      });
      return { entries };
    },
    async hostFileDelete(userPath: string): Promise<{ ok: true }> {
      const abs = resolve(userPath, true);
      if (fs.statSync(abs).isDirectory()) throw new Error('Read/Write File: refusing to delete a directory');
      fs.unlinkSync(abs);
      return { ok: true };
    },
  };
}
