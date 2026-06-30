import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { NodeHandler } from './types';

// Stateless across calls — instantiate once at module scope.
const parser = new XMLParser();
const builder = new XMLBuilder();

/** Parse XML→JSON or build JSON→XML. fast-xml-parser does not resolve external entities (no XXE). */
export const xmlHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const operation = (config.operation as string) ?? 'parse';
  const field = (config.field as string) || (operation === 'parse' ? 'xml' : 'data');
  const outputField = (config.outputField as string) || (operation === 'parse' ? 'data' : 'xml');

  return input.map((item) => {
    const value = item.json[field];
    if (operation === 'build') {
      const xml = (value !== null && typeof value === 'object') ? builder.build(value) : null;
      return { json: { ...item.json, [outputField]: xml } };
    }
    const parsed = parser.parse(String(value ?? ''));
    return { json: { ...item.json, [outputField]: parsed } };
  });
};
