import type { HealthResult } from './health';

export interface TokenClaims {
  sub: string;
  [claim: string]: unknown;
}

export interface DirectoryUser {
  id: string;                 // provider subject id
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];            // realm roles, provider defaults filtered out
  createdAt: string | null;   // ISO
}
export interface DirectoryCreateInput {
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enabled?: boolean;
  roles?: string[];
  password?: string;
  temporaryPassword?: boolean;
}
export interface DirectoryUpdateInput {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enabled?: boolean;
}
export interface DirectoryPort {
  list(opts?: { search?: string; max?: number }): Promise<DirectoryUser[]>;
  get(id: string): Promise<DirectoryUser | null>;
  create(input: DirectoryCreateInput): Promise<DirectoryUser>;
  update(id: string, patch: DirectoryUpdateInput): Promise<void>;
  setRoles(id: string, roles: string[]): Promise<void>;
}

/**
 * Thin Keycloak REST primitives for managing confidential sync clients.
 * These are intentionally low-level — existence/idempotency logic lives in the
 * enrollment orchestrator that composes them into enroll/rotate/revoke.
 */
export interface SyncClientPort {
  findUuidByClientId(clientId: string): Promise<string | null>;
  createConfidentialClient(clientId: string): Promise<string>;   // returns the new client UUID
  addSiteIdMapper(uuid: string, siteId: string): Promise<void>;
  addAudienceMapper(uuid: string, audience: string): Promise<void>;
  getClientSecret(uuid: string): Promise<string>;
  regenerateClientSecret(uuid: string): Promise<string>;
  deleteClient(uuid: string): Promise<void>;
}

export interface AuthPort {
  healthCheck(): Promise<HealthResult>;
  verifyToken(token: string): Promise<TokenClaims>;
  /** Set a user's password at the provider. `temporary` forces a change at next login. */
  resetPassword(userId: string, password: string, temporary: boolean): Promise<void>;
  /** Trigger the provider's password-reset email flow for the user. */
  sendPasswordResetEmail(userId: string): Promise<void>;
  /** Terminate all of the user's provider sessions. */
  forceLogout(userId: string): Promise<void>;
  directory: DirectoryPort;
  clients: SyncClientPort;
}

/** Thrown by AuthPort admin methods when the provider admin client is not configured. */
export class IdentityAdminNotConfiguredError extends Error {
  constructor() {
    super('identity provider admin client is not configured');
    this.name = 'IdentityAdminNotConfiguredError';
  }
}
