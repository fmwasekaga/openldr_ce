import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type CaptureStep =
  | { action: 'click'; role: string; name: string }
  | { action: 'clickTestId'; testId: string }
  | { action: 'fill'; label: string; value: string }
  | { action: 'selectText'; text: string }
  | { action: 'waitForText'; text: string };

export interface CaptureManifestShot {
  name: string;
  guide: string;
  route: string;
  purpose: string;
  fixture: string;
  theme: 'dark' | 'light';
  ready: { kind: 'selector' | 'text'; value: string };
  steps: CaptureStep[];
  crop?: string;
  mask?: string[];
  callouts?: Array<{ number: number; selector: string; offsetX?: number; offsetY?: number }>;
}

export interface CaptureManifest {
  version: number;
  viewport: { width: number; height: number };
  shots: CaptureManifestShot[];
}

const MANIFEST_PATH = fileURLToPath(
  new URL('../../apps/web/src/docs/0.1.0/screenshot-manifest.json', import.meta.url),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function requireString(shot: Record<string, unknown>, index: number, field: string): string {
  const value = shot[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`shot ${index} invalid ${field}`);
  }
  return value;
}

function validateShot(value: unknown, index: number): CaptureManifestShot {
  if (!isRecord(value)) throw new Error(`shot ${index} invalid shot`);
  const theme = requireString(value, index, 'theme');
  if (theme !== 'dark' && theme !== 'light') throw new Error(`shot ${index} invalid theme`);
  const ready = value.ready;
  if (!isRecord(ready)) throw new Error(`shot ${index} invalid ready`);
  if (ready.kind !== 'selector' && ready.kind !== 'text') throw new Error(`shot ${index} invalid ready.kind`);
  if (typeof ready.value !== 'string' || ready.value.trim() === '') {
    throw new Error(`shot ${index} invalid ready.value`);
  }
  if (!Array.isArray(value.steps)) throw new Error(`shot ${index} invalid steps`);
  return {
    name: requireString(value, index, 'name'),
    guide: requireString(value, index, 'guide'),
    route: requireString(value, index, 'route'),
    purpose: requireString(value, index, 'purpose'),
    fixture: requireString(value, index, 'fixture'),
    theme,
    ready: { kind: ready.kind, value: ready.value },
    steps: value.steps as CaptureStep[],
    crop: typeof value.crop === 'string' ? value.crop : undefined,
    mask: Array.isArray(value.mask) ? (value.mask as string[]) : undefined,
    callouts: Array.isArray(value.callouts)
      ? (value.callouts as CaptureManifestShot['callouts'])
      : undefined,
  };
}

export async function loadCaptureManifest(path = MANIFEST_PATH): Promise<CaptureManifest> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error('manifest invalid root');
  if (parsed.version !== 1) throw new Error('manifest invalid version');
  const viewport = parsed.viewport;
  if (!isRecord(viewport)) throw new Error('manifest invalid viewport');
  if (typeof viewport.width !== 'number' || typeof viewport.height !== 'number') {
    throw new Error('manifest invalid viewport');
  }
  if (!Array.isArray(parsed.shots)) throw new Error('manifest invalid shots');
  return {
    version: 1,
    viewport: { width: viewport.width, height: viewport.height },
    shots: parsed.shots.map((shot, index) => validateShot(shot, index)),
  };
}
