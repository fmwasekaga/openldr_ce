import { randomUUID } from 'node:crypto';
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

const BUNDLE_TYPES = new Set(['transaction', 'batch', 'collection']);
const ALLOWED_METHODS = new Set(['POST', 'PUT']);

type Res = Record<string, unknown>;

/** Recursively rewrite every { reference } string that matches a map key. */
function rewriteRefs(value: unknown, map: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const v of value) rewriteRefs(v, map);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  const ref = obj['reference'];
  if (typeof ref === 'string' && map.has(ref)) obj['reference'] = map.get(ref);
  for (const k of Object.keys(obj)) if (k !== 'reference') rewriteRefs(obj[k], map);
}

/** Bundle or bare array → flat resource list with references resolved. Throws on invalid input. */
export function bundleToResources(payload: unknown): Res[] {
  if (Array.isArray(payload)) return payload as Res[]; // bare-array passthrough (today's contract)

  if (payload === null || typeof payload !== 'object' || (payload as Res).resourceType !== 'Bundle') {
    throw new Error('unwrap-bundle: expected a FHIR Bundle or an array of resources');
  }
  const bundle = payload as Res;
  const type = String(bundle['type'] ?? '');
  if (!BUNDLE_TYPES.has(type)) {
    throw new Error(`unwrap-bundle: unsupported Bundle.type "${type}" (expected transaction/batch/collection)`);
  }

  const entries = (bundle['entry'] as Res[] | undefined) ?? [];
  const resources: Res[] = [];
  const map = new Map<string, string>();

  // Pass 1: collect resources, assign ids, build fullUrl/Type-id → Type/id map.
  for (const entry of entries) {
    const method = String((entry['request'] as Res | undefined)?.['method'] ?? '').toUpperCase();
    if (method && !ALLOWED_METHODS.has(method)) {
      throw new Error(`unwrap-bundle: unsupported request.method "${method}" (v1 accepts POST/PUT)`);
    }
    const resource = entry['resource'] as Res | undefined;
    if (!resource || typeof resource !== 'object') continue;
    if (typeof resource['id'] !== 'string' || (resource['id'] as string).length === 0) {
      resource['id'] = randomUUID(); // urn:uuid create with no id
    }
    const typeId = `${String(resource['resourceType'])}/${String(resource['id'])}`;
    const fullUrl = entry['fullUrl'];
    if (typeof fullUrl === 'string' && fullUrl.length > 0) map.set(fullUrl, typeId);
    map.set(typeId, typeId); // relative refs resolve to themselves
    resources.push(resource);
  }

  // Pass 2: rewrite references now that all ids are known.
  for (const r of resources) rewriteRefs(r, map);
  return resources;
}

export const unwrapBundleHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sourcePath = (config['sourcePath'] as string) || 'body';
  const out: WorkflowItem[] = [];
  for (const item of input) {
    for (const resource of bundleToResources(item.json[sourcePath])) {
      out.push({ json: resource });
    }
  }
  return out;
};
