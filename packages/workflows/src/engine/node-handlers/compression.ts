import JSZip from 'jszip';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Zip the input items' binary files into one archive, or unzip an archive into per-entry items. */
export const compressionHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary || !ctx.services?.writeBinary) throw new Error('Compression requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'zip';
  const sourceField = (config.sourceField as string) || 'file';

  if (operation === 'unzip') {
    // Unzip reads a single archive from the first input item.
    const ref = input[0]?.binary?.[sourceField];
    if (!ref) throw new Error(`Compression: no file on the input item (field '${sourceField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const zip = await JSZip.loadAsync(bytes);
    const out: WorkflowItem[] = [];
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (entry.dir) continue;
      const entryBytes = await entry.async('uint8array');
      const entryRef = await ctx.services.writeBinary({ bytes: entryBytes, fileName: name, contentType: 'application/octet-stream' });
      out.push({ json: { fileName: name }, binary: { file: entryRef } });
    }
    return out;
  }

  // zip
  const binaryField = (config.binaryField as string) || 'zip';
  const fileName = (config.fileName as string) || 'archive.zip';
  const zip = new JSZip();
  const used = new Set<string>();
  let added = 0;
  for (const item of input) {
    const ref = item.binary?.[sourceField];
    if (!ref) continue;
    const bytes = await ctx.services.readBinary(ref.objectKey);
    let name = ref.fileName ?? `file-${added}`;
    if (used.has(name)) name = `${added}-${name}`;
    used.add(name);
    zip.file(name, bytes);
    added += 1;
  }
  if (added === 0) throw new Error(`Compression: no files found on input items (field '${sourceField}')`);
  const archive = await zip.generateAsync({ type: 'uint8array' });
  const ref = await ctx.services.writeBinary({ bytes: archive, fileName, contentType: 'application/zip' });
  const first = input[0] ?? { json: {} };
  return [{ ...first, binary: { ...(first.binary ?? {}), [binaryField]: ref } }];
};
