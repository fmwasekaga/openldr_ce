import { describe, it, expect } from 'vitest';
import { AppError, CATALOG, DOMAINS, appError, catalogFor, domainForPrefix, codeForStatus, codeForUnknown } from './error-catalog';
import { ZodError } from 'zod';

describe('error catalog', () => {
  it('every code is well-formed and unique', () => {
    const codes = Object.keys(CATALOG);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2,4}\d{4}$/);
      expect(CATALOG[code].code).toBe(code); // entry self-consistent
      expect(CATALOG[code].httpStatus).toBeGreaterThanOrEqual(400);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code prefix maps to a known domain', () => {
    for (const entry of Object.values(CATALOG)) {
      const prefix = entry.code.replace(/\d+$/, '');
      expect(DOMAINS[prefix], `prefix ${prefix} missing from DOMAINS`).toBeDefined();
      expect(entry.domain).toBe(DOMAINS[prefix]);
    }
  });

  it('appError builds an AppError from the catalog', () => {
    const err = appError('RP0001');
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RP0001');
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe(CATALOG.RP0001.message);
  });

  it('appError message override keeps the code', () => {
    const err = appError('FM0003', { message: 'field "patientId" is required' });
    expect(err.code).toBe('FM0003');
    expect(err.message).toBe('field "patientId" is required');
  });

  it('appError carries cause and details through', () => {
    const cause = new Error('io');
    const err = appError('RP0003', { cause, details: { id: 'x' } });
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ id: 'x' });
  });

  it('appError throws for an unknown code (programmer error)', () => {
    expect(() => appError('ZZ9999')).toThrow(/unknown error code/i);
  });

  it('catalogFor lists a domain by prefix', () => {
    const reports = catalogFor('RP');
    expect(reports.every((e) => e.code.startsWith('RP'))).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(4);
  });

  it('domainForPrefix maps known prefixes', () => {
    expect(domainForPrefix('RP')).toBe('reports');
    expect(domainForPrefix('ZZ')).toBeUndefined();
  });

  it('codeForUnknown classifies raw errors to SY codes', () => {
    expect(codeForUnknown(new ZodError([]))).toBe('SY0400');
    expect(codeForUnknown(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe('SY0503');
    expect(codeForUnknown(new Error('boom'))).toBe('SY0500');
  });

  it('codeForUnknown does not false-positive on connect-substring words', () => {
    expect(codeForUnknown(new Error('reconnect attempt failed'))).toBe('SY0500');
    expect(codeForUnknown(new Error('connection refused'))).toBe('SY0503');
  });

  // codeForStatus derives the code from `SY0<status>`, so the derivation is only sound while every
  // status-named SY entry actually carries the status it is named for. Pin that invariant.
  it('every SY04xx/SY05xx entry has an httpStatus matching its own number', () => {
    const statusNamed = Object.values(CATALOG).filter((e) => /^SY0[45]\d\d$/.test(e.code));
    expect(statusNamed.length).toBeGreaterThan(0);
    for (const entry of statusNamed) {
      expect(entry.httpStatus, `${entry.code} must map to HTTP ${entry.code.slice(2)}`).toBe(Number(entry.code.slice(2)));
    }
  });

  it('codeForStatus returns the exact catalog entry for a status it knows', () => {
    expect(codeForStatus(400)).toBe('SY0400');
    expect(codeForStatus(413)).toBe('SY0413');
    expect(codeForStatus(415)).toBe('SY0415');
    expect(codeForStatus(503)).toBe('SY0503');
  });

  it('codeForStatus falls back to the generic code for a status with no entry', () => {
    expect(codeForStatus(422)).toBe('SY0400'); // unmapped 4xx → generic bad request
    expect(codeForStatus(429)).toBe('SY0400');
    expect(codeForStatus(502)).toBe('SY0500'); // unmapped 5xx → generic server error
    expect(codeForStatus(504)).toBe('SY0500');
  });

  it('codeForStatus only ever answers with a real catalog code', () => {
    for (let status = 400; status <= 599; status++) {
      expect(CATALOG[codeForStatus(status)], `status ${status}`).toBeDefined();
    }
  });
});
