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
    if (err.cause instanceof Error && err.cause.message && err.cause.message !== err.message) {
      return `${base}: ${err.cause.message}`;
    }
    return base;
  }
  return String(err);
}
