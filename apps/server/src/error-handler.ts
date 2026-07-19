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
  // codeForStatus). A bogus statusCode (0, 200, NaN, 404.5) is rejected here and falls through to
  // the fallback below: the range comparison already excludes NaN/Infinity, and the integer check
  // excludes a fractional status, which Node would otherwise silently TRUNCATE (404.5 → 404) while
  // codeForStatus derived its code from the untruncated value — a 404 body claiming SY0400.
  if (err instanceof Error) {
    const { statusCode } = err as Error & { statusCode?: unknown };
    if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
      const mapped = codeForStatus(statusCode);
      // Test `err.message` rather than errorMessage(err): the latter degrades an empty message to
      // the error's NAME (a bare "Error"), which would shadow the catalog default. The catalog
      // sentence is the better thing to show a client than "Error".
      const message = err.message ? errorMessage(err) : CATALOG[mapped].message;
      return { status: statusCode, code: mapped, message };
    }
  }
  // NOTE the precedence: the statusCode branch above runs BEFORE these heuristics, so an explicit
  // self-declared status beats codeForUnknown's message-regex guesswork. That is deliberate — a
  // caller stating its own status is stronger evidence than a regex — but it means an error that
  // BOTH carries a statusCode and reads as a connection failure resolves by status, losing the
  // retryable SY0503 hint. Nothing throws that shape today (node/undici/pg conn errors carry `code`,
  // not `statusCode`); if something ever does, reorder rather than widen the regex.
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
export function registerErrorHandler(app: FastifyInstance<any, any, any, any>): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const { status, code, message } = toErrorResponse(err);
    const correlationId = String(req.id);
    const details = err instanceof AppError ? err.details : undefined;
    // Only a whitelisted, safe-by-default field reaches the wire: the FHIR OperationOutcome, and
    // only when present. The rest of an AppError's `details` (e.g. RP0004's zod flatten()) stays
    // log-only — no arbitrary blob is ever exposed to clients.
    const outcome =
      err instanceof AppError && err.details && typeof err.details === 'object'
        ? (err.details as { outcome?: unknown }).outcome
        : undefined;
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
    void reply.code(status).send({
      error: message,
      code,
      correlationId,
      ...(outcome !== undefined ? { outcome } : {}),
    });
  });
}
