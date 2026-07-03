import type { ReportTemplate } from './schema';

export function createEmptyTemplate(id: string, name: string): ReportTemplate {
  return {
    id,
    name,
    description: '',
    category: 'operational',
    status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [],
    rows: [],
  };
}

export interface InterpolateContext {
  params?: Record<string, unknown>;
  dataset?: Record<string, unknown>;
}

// Replaces {{param.<id>}} and {{dataset.<field>}} tokens. A token is `{{`, optional space,
// `param.`|`dataset.`, a dotless key of word chars, optional space, `}}`. Anything not matching
// (e.g. `{{ not a token }}`) is left verbatim. Unknown keys resolve to ''.
const TOKEN = /\{\{\s*(param|dataset)\.(\w+)\s*\}\}/g;

export function interpolate(input: string, ctx: InterpolateContext): string {
  return input.replace(TOKEN, (_m, scope: string, key: string) => {
    const bag = scope === 'param' ? ctx.params : ctx.dataset;
    const v = bag?.[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
