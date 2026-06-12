import { describe, it, expect } from 'vitest';
import { fhirId, fhirCode, fhirDate, fhirDateTime } from './primitives';

describe('fhir primitives', () => {
  it('fhirId accepts valid ids and rejects spaces / overlength', () => {
    expect(fhirId.safeParse('abc-123.4').success).toBe(true);
    expect(fhirId.safeParse('has space').success).toBe(false);
    expect(fhirId.safeParse('x'.repeat(65)).success).toBe(false);
  });
  it('fhirCode rejects leading/trailing whitespace', () => {
    expect(fhirCode.safeParse('final').success).toBe(true);
    expect(fhirCode.safeParse(' final').success).toBe(false);
  });
  it('fhirDate accepts partial dates, rejects malformed', () => {
    expect(fhirDate.safeParse('2024').success).toBe(true);
    expect(fhirDate.safeParse('2024-05').success).toBe(true);
    expect(fhirDate.safeParse('2024-05-01').success).toBe(true);
    expect(fhirDate.safeParse('2024-5-1').success).toBe(false);
    expect(fhirDate.safeParse('notadate').success).toBe(false);
  });
  it('fhirDateTime accepts a full timestamp', () => {
    expect(fhirDateTime.safeParse('2024-05-01T10:30:00Z').success).toBe(true);
    expect(fhirDateTime.safeParse('2024-05-01T10:30:00+03:00').success).toBe(true);
    expect(fhirDateTime.safeParse('2024-05-01 10:30').success).toBe(false);
  });
});
