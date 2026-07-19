import os from 'node:os';
import type { AuditActor } from '@openldr/bootstrap';

let override: string | undefined;

/** Set by the program's preAction hook from --actor. */
export function setActorOverride(name: string | undefined): void {
  override = name && name.trim() ? name.trim() : undefined;
}

/** The audit actor for a CLI invocation: actor_type 'cli', name = --actor override or the OS user. */
export function cliActor(): AuditActor {
  let name = override;
  if (!name) {
    try {
      name = os.userInfo().username;
    } catch {
      name = undefined;
    }
  }
  return { actorType: 'cli', actorId: null, actorName: name || 'cli' };
}
