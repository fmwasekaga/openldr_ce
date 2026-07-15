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

  it('honours a self-declared statusCode and maps it to a catalog code', () => {
    const err = Object.assign(new Error('file too large'), { statusCode: 413 });
    expect(toErrorResponse(err)).toEqual({ status: 413, code: 'SY0413', message: 'file too large' });
  });

  it('maps a status with no dedicated entry to the generic code for its class', () => {
    expect(toErrorResponse(Object.assign(new Error('slow down'), { statusCode: 429 })).code).toBe('SY0400');
    expect(toErrorResponse(Object.assign(new Error('upstream died'), { statusCode: 502 })).code).toBe('SY0500');
  });

  // The whole point of the mapping: a library's own error code is NOT our vocabulary. It must never
  // reach the client in `code`, or the catalog contract (and `openldr errors list`) is a lie.
  it('never leaks a library error code, even when the error declares one', () => {
    const err = Object.assign(new Error('unsupported content-encoding: br'), {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    const r = toErrorResponse(err);
    expect(r).toEqual({ status: 415, code: 'SY0415', message: 'unsupported content-encoding: br' });
  });

  it('ignores a statusCode outside the HTTP error range rather than returning it', () => {
    // A library error carrying statusCode 200/0 must not become the response status.
    expect(toErrorResponse(Object.assign(new Error('odd'), { statusCode: 200 })).status).toBe(500);
    expect(toErrorResponse(Object.assign(new Error('odd'), { statusCode: 0 })).status).toBe(500);
  });

  // A non-integer status would reach reply.code() and throw ERR_HTTP_INVALID_STATUS_CODE — from
  // INSIDE the error handler, i.e. while already handling a failure. Reject it up front instead.
  it('ignores a non-integer statusCode rather than passing it to reply.code', () => {
    expect(toErrorResponse(Object.assign(new Error('odd'), { statusCode: 404.5 })).status).toBe(500);
    expect(toErrorResponse(Object.assign(new Error('odd'), { statusCode: NaN })).status).toBe(500);
    expect(toErrorResponse(Object.assign(new Error('odd'), { statusCode: Infinity })).status).toBe(500);
  });

  it('falls back to the catalog message when the error carries none', () => {
    const r = toErrorResponse(Object.assign(new Error(''), { statusCode: 415 }));
    expect(r).toEqual({ status: 415, code: 'SY0415', message: 'unsupported media type' });
  });
});
