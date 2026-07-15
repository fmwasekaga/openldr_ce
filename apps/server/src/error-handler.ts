import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, CATALOG, codeForUnknown, errorMessage } from '@openldr/core';

export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
}

/**
 * Classify any thrown value into { status, code, message }. AppErrors carry their own code +
 * status; everything else is mapped to a SY#### fallback (ZodError→400, conn-refused→503,
 * else 500) while preserving the REAL error message so "500" is never opaque.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message };
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
    const line = { code, correlationId, ...(details !== undefined ? { details } : {}), err };
    if (status >= 500) req.log.error(line, message);
    else req.log.warn(line, message);
    void reply.code(status).send({ error: message, code, correlationId });
  });
}
