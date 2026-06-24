import { z } from 'zod';

/**
 * Fine-grained, parameterized capability declarations a plugin requests.
 * Declaration only — runtime enforcement is SP-2. Each member documents
 * where it will be enforced:
 *  - read-input.formats : advisory (SP-1)
 *  - emit-fhir.resourceTypes : host-side at persist (SP-2)
 *  - net-egress.allowedHosts : Extism allowed_hosts at runner config (SP-2)
 *  - data-scope : host-side read filtering (SP-2; no current plugin reads the store)
 */
export const capabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read-input'), formats: z.array(z.string().min(1)).default([]) }),
  z.object({ kind: z.literal('emit-fhir'), resourceTypes: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('net-egress'), allowedHosts: z.array(z.string().min(1)).default([]) }),
  z.object({ kind: z.literal('data-scope'), resourceTypes: z.array(z.string().min(1)).default([]), fields: z.array(z.string().min(1)).default([]) }),
  // Host-service gates (broker-enforced; presence-only, no params). The broker maps each
  // plugin-UI host operation to one of these and refuses calls whose grant lacks it.
  z.object({ kind: z.literal('host:reports') }),
  z.object({ kind: z.literal('host:connectors') }),
  z.object({ kind: z.literal('host:schedule') }),
  z.object({ kind: z.literal('host:fhir') }),
]);

export type Capability = z.infer<typeof capabilitySchema>;

export function parseCapabilities(raw: unknown): Capability[] {
  return z.array(capabilitySchema).parse(raw);
}
