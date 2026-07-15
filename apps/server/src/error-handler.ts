import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, CATALOG, codeForStatus, codeForUnknown, errorMessage } from '@openldr/core';

export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
}

/**
 * Classify any thrown value into { status, code, message }. AppErrors carry their own code +
 * status; an error that already self-declares an HTTP `statusCode` keeps that status and is mapped
 * onto a catalog code; everything else falls back to a SY#### code (ZodError→400, conn-refused→503,
 * else 500). The REAL error message is preserved throughout so "500" is never opaque.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message };
  }
  // Fastify's own client errors (FST_ERR_VALIDATION, FST_ERR_CTP_INVALID_JSON_BODY,
  // FST_ERR_CTP_INVALID_MEDIA_TYPE …) and node-style library errors self-declare a statusCode.
  // Honour it — the caller already classified the failure, and flattening it to 500 tells the
  // client its own bad request was our fault. Only the STATUS is taken: the code is derived from
  // our catalog, never read off the error, so a raw FST_ERR_* can't reach the wire (see
  // codeForStatus). The range guard keeps a bogus statusCode (0, 200) from becoming the response
  // status — that falls through to the fallback below instead.
  if (err instanceof Error) {
    const { statusCode } = err as Error & { statusCode?: unknown };
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599) {
      const mapped = codeForStatus(statusCode);
      // Test `err.message` rather than errorMessage(err): the latter degrades an empty message to
      // the error's NAME (a bare "Error"), which would shadow the catalog default. The catalog
      // sentence is the better thing to show a client than "Error".
      const message = err.message ? errorMessage(err) : CATALOG[mapped].message;
      return { status: statusCode, code: mapped, message };
    }
  }
  const code = codeForUnknown(err);
  const entry = CATALOG[code];
  // Prefer the real error message; fall back to the catalog default only when empty.
  const message = errorMessage(err) || entry.message;
  return { status: entry.httpStatus, code, message };
}

/**
 * Install the single central error handler. Emits a FLAT, back-compatible body:
 *   { error: <message>, code: <RP0001>, correlationId: <8-char req.id> }
 * `error` stays the message string (studio's errorDetail already reads body.error). Logs exactly
 * one line per failure — error level for 5xx, warn for 4xx — so the correlationId in the UI greps
 * straight to the server log.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerErrorHandler(app: FastifyInstance<any, any, any, any>): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const { status, code, message } = toErrorResponse(err);
    const correlationId = String(req.id);
    const details = err instanceof AppError ? err.details : undefined;
    // The originating library's own code (FST_ERR_VALIDATION, …) is deliberately withheld from the
    // response — it isn't catalog vocabulary — so log it. Without this, mapping a library error to
    // SY#### would DESTROY the diagnostic rather than translate it: a correlationId from a client's
    // 415 must still grep to a line naming the real Fastify code.
    const rawCode = err instanceof Error && !(err instanceof AppError)
      ? (err as Error & { code?: unknown }).code
      : undefined;
    const libCode = typeof rawCode === 'string' ? rawCode : undefined;
    const line = {
      code,
      correlationId,
      ...(libCode !== undefined ? { libCode } : {}),
      ...(details !== undefined ? { details } : {}),
      err,
    };
    if (status >= 500) req.log.error(line, message);
    else req.log.warn(line, message);
    void reply.code(status).send({ error: message, code, correlationId });
  });
}
