import { describe, it, expect } from 'vitest';
import { toErrorResponse } from './error-handler';
import { appError } from '@openldr/core';
import { ZodError } from 'zod';

describe('toErrorResponse', () => {
  it('maps an AppError to its code + status + message', () => {
    const r = toErrorResponse(appError('RP0001'));
    expect(r).toEqual({ status: 400, code: 'RP0001', message: 'date range not selected' });
  });

  it('maps an AppError message override through', () => {
    const r = toErrorResponse(appError('FM0003', { message: 'field "x" required' }));
    expect(r).toEqual({ status: 400, code: 'FM0003', message: 'field "x" required' });
  });

  it('classifies a ZodError to SY0400', () => {
    const r = toErrorResponse(new ZodError([]));
    expect(r.code).toBe('SY0400');
    expect(r.status).toBe(400);
  });

  it('classifies a connection error to SY0503', () => {
    const r = toErrorResponse(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    expect(r.code).toBe('SY0503');
    expect(r.status).toBe(503);
  });

  it('classifies an unknown error to SY0500 and keeps its real message', () => {
    const r = toErrorResponse(new Error('kaboom'));
    expect(r.code).toBe('SY0500');
    expect(r.status).toBe(500);
    expect(r.message).toBe('kaboom');
  });

  it('honours a self-declared statusCode + code on a plain Error (e.g. @fastify/compress)', () => {
    const err = new Error('unsupported content-encoding: br') as Error & { statusCode: number; code: string };
    err.statusCode = 415;
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    const r = toErrorResponse(err);
    expect(r).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'unsupported content-encoding: br' });
  });
});
