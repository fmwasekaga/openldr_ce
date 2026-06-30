import { describe, it, expect } from 'vitest';
import { dateTimeHandler } from './date-time';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'dt1', type: 'action', data: { action: 'date-time', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('dateTimeHandler', () => {
  it('formats a date field to ISO', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'format', outputField: 'iso' }),
      ctx(),
      [{ json: { d: '2026-01-02T03:04:05.000Z' } }],
    );
    expect((result[0].json as Record<string, unknown>).iso).toBe('2026-01-02T03:04:05.000Z');
  });
  it('adds a duration to a date field', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'add', amount: 1, unit: 'days', outputField: 'next' }),
      ctx(),
      [{ json: { d: '2026-01-01T00:00:00.000Z' } }],
    );
    expect((result[0].json as Record<string, unknown>).next).toBe('2026-01-02T00:00:00.000Z');
  });
  it('writes null for an unparseable date', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'format', outputField: 'iso' }),
      ctx(),
      [{ json: { d: 'not-a-date' } }],
    );
    expect((result[0].json as Record<string, unknown>).iso).toBeNull();
  });
});
