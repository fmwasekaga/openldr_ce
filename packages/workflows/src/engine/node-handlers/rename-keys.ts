import type { NodeHandler } from './types';

/** Rename object keys per a { from, to }[] config. Missing/incomplete pairs are skipped. */
export const renameKeysHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const renames = (config.renames as Array<{ from: string; to: string }> | undefined) ?? [];
  return input.map((item) => {
    const json: Record<string, unknown> = { ...item.json };
    for (const { from, to } of renames) {
      if (!from || !to) continue;
      if (Object.prototype.hasOwnProperty.call(json, from)) {
        json[to] = json[from];
        delete json[from];
      }
    }
    return { json };
  });
};
