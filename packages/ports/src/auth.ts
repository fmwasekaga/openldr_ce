import type { HealthResult } from './health';

export interface TokenClaims {
  sub: string;
  [claim: string]: unknown;
}

export interface AuthPort {
  healthCheck(): Promise<HealthResult>;
  /** Implemented in a later sub-project (users/auth). */
  verifyToken(token: string): Promise<TokenClaims>;
}
