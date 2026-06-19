import type { HealthResult } from './health';

export interface TokenClaims {
  sub: string;
  [claim: string]: unknown;
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
}

/** Thrown by AuthPort admin methods when the provider admin client is not configured. */
export class IdentityAdminNotConfiguredError extends Error {
  constructor() {
    super('identity provider admin client is not configured');
    this.name = 'IdentityAdminNotConfiguredError';
  }
}
