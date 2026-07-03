import { describe, it, expect } from 'vitest';
import { extractCorrelationId } from './correlation';

describe('extractCorrelationId', () => {
  it('prefers the trigger input batchId (reactive/ingest run)', () => {
    expect(extractCorrelationId({ batchId: 'from-event' }, { results: [] })).toBe('from-event');
  });
  it('falls back to a persist node meta.batchId (originating run)', () => {
    const result = { results: [{ meta: { persisted: 2, batchId: 'from-persist' } }] };
    expect(extractCorrelationId({ body: {} }, result)).toBe('from-persist');
  });
  it('returns null when neither is present', () => {
    expect(extractCorrelationId({ body: {} }, { results: [{ meta: undefined }] })).toBeNull();
  });
});
