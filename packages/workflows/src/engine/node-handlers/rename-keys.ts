import type { NodeHandler } from './types';

/**
 * Rename object keys per a { from, to }[] config. Missing/incomplete pairs are skipped.
 * Renames apply in array order against the same object, so a rename whose `to` already
 * exists overwrites it, and chained renames see prior results (matches n8n behaviour).
 */
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
