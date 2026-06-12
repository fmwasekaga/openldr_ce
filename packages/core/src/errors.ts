export class OpenLdrError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends OpenLdrError {}
export class AdapterError extends OpenLdrError {}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const base = err.message || err.name || 'Error';

    // AggregateError (and any Error exposing an `.errors` array, e.g. from
    // undici / the AWS SDK on a refused connection) carries the actionable
    // detail in `.errors[]`, not `.message` or `.cause`. Surface the first
    // inner error message that isn't empty.
    const inner = innerErrorMessage(err);
    if (inner && inner !== err.message) {
      return `${base}: ${inner}`;
    }

    if (err.cause instanceof Error && err.cause.message && err.cause.message !== err.message) {
      return `${base}: ${err.cause.message}`;
    }
    return base;
  }
  return String(err);
}

/** First non-empty message from an Error's `.errors` array, if it has one. */
function innerErrorMessage(err: Error): string | undefined {
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return undefined;
  }
  for (const inner of errors) {
    if (inner instanceof Error && inner.message) {
      return inner.message;
    }
  }
  return undefined;
}
