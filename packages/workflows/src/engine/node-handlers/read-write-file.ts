import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { resolveTemplate } from '../template';

/**
 * Host filesystem read/write/list/delete, confined to the sandbox root by the
 * injected hostFile* services. Operates per input item; the path is templated.
 */
export const readWriteFileHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const op = String(config.operation ?? 'read');
  const asText = config.asText === true;
  const field = (String(config.binaryField ?? '') || (asText ? 'content' : 'file'));
  const svc = ctx.services;
  const items: WorkflowItem[] = input.length ? input : [{ json: {} }];
  const out: WorkflowItem[] = [];

  for (const item of items) {
    const p = resolveTemplate(String(config.path ?? ''), ctx, [item]);
    if (op === 'read') {
      if (!svc?.hostFileRead) throw new Error('Read/Write File requires server services');
      const { bytes } = await svc.hostFileRead(p);
      if (asText) {
        out.push({ ...item, json: { ...item.json, [field]: Buffer.from(bytes).toString('utf8') } });
      } else {
        if (!svc.writeBinary) throw new Error('Read/Write File requires server services');
        const ref = await svc.writeBinary({ bytes, fileName: p.split(/[\\/]/).pop() || 'file', contentType: 'application/octet-stream' });
        out.push({ ...item, binary: { ...(item.binary ?? {}), [field]: ref } });
      }
    } else if (op === 'write') {
      if (!svc?.hostFileWrite) throw new Error('Read/Write File requires server services');
      let bytes: Uint8Array;
      const ref = item.binary?.[field];
      if (ref) {
        if (!svc.readBinary) throw new Error('Read/Write File requires server services');
        bytes = await svc.readBinary(ref.objectKey);
      } else {
        bytes = new Uint8Array(Buffer.from(resolveTemplate(String(config.textContent ?? ''), ctx, [item]), 'utf8'));
      }
      const { byteSize } = await svc.hostFileWrite(p, bytes);
      out.push({ ...item, json: { ...item.json, writtenBytes: byteSize, writtenPath: p } });
    } else if (op === 'list') {
      if (!svc?.hostFileList) throw new Error('Read/Write File requires server services');
      const { entries } = await svc.hostFileList(p);
      out.push({ ...item, json: { ...item.json, entries } });
    } else if (op === 'delete') {
      if (!svc?.hostFileDelete) throw new Error('Read/Write File requires server services');
      await svc.hostFileDelete(p);
      out.push({ ...item, json: { ...item.json, deletedPath: p } });
    } else {
      throw new Error(`Read/Write File: unknown operation: ${op}`);
    }
  }
  return out;
};
