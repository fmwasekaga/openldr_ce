import type { ZodTypeAny } from 'zod';

const schemas = new Map<string, ZodTypeAny>();

export function registerResource(type: string, schema: ZodTypeAny): void {
  schemas.set(type, schema);
}

export function getResourceSchema(type: string): ZodTypeAny | undefined {
  return schemas.get(type);
}

export function listResourceTypes(): string[] {
  return [...schemas.keys()].sort();
}
