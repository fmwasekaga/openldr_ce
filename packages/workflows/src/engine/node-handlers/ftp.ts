import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** SFTP transfer (download/upload/list/delete/rename). Binary I/O reuses readBinary/writeBinary. */
export const ftpHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorSftp) throw new Error('FTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('FTP node: a connector is required');
  const operation = (config.operation as string) || 'download';
  const remotePath = resolveTemplate(String(config.remotePath ?? ''), ctx, input);
  if (!remotePath) throw new Error('FTP node: a remote path is required');
  const binaryField = (config.binaryField as string) || 'file';

  if (operation === 'upload') {
    if (!ctx.services.readBinary) throw new Error('FTP node requires server services');
    const ref = input[0]?.binary?.[binaryField];
    if (!ref) throw new Error(`FTP node: no file on the input item (field '${binaryField}')`);
    const bytes = await ctx.services.readBinary(ref.objectKey);
    const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'upload', remotePath, bytes });
    return [{ json: { ok: res.ok ?? true, remotePath } }];
  }
  if (operation === 'list') {
    const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'list', remotePath });
    return rowsToItems((res.entries ?? []) as Record<string, unknown>[]);
  }
  if (operation === 'delete') {
    await ctx.services.runConnectorSftp({ connectorId, operation: 'delete', remotePath });
    return [{ json: { ok: true, remotePath } }];
  }
  if (operation === 'rename') {
    const toPath = resolveTemplate(String(config.toPath ?? ''), ctx, input);
    if (!toPath) throw new Error('FTP node: rename requires toPath');
    await ctx.services.runConnectorSftp({ connectorId, operation: 'rename', remotePath, toPath });
    return [{ json: { ok: true, from: remotePath, to: toPath } }];
  }
  if (!ctx.services.writeBinary) throw new Error('FTP node requires server services');
  const res = await ctx.services.runConnectorSftp({ connectorId, operation: 'download', remotePath });
  const fileName = res.fileName || (remotePath.split('/').pop() || 'download');
  const out = input.length > 0 ? input[0] : { json: {} };
  const ref = await ctx.services.writeBinary({ bytes: res.bytes ?? new Uint8Array(), fileName, contentType: 'application/octet-stream' });
  return [{ ...out, json: { ...out.json, fileName }, binary: { ...(out.binary ?? {}), [binaryField]: ref } }];
};
