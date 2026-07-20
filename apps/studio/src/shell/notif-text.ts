import type { TFunction } from 'i18next';
import type { Notification } from '@/api';

/**
 * Resolves a notification's display title from `notifications.triggers.<type>`,
 * falling back to the server-supplied `n.title` for unknown/future types.
 */
export function notifTitle(n: Notification, t: TFunction): string {
  return t(`notifications.triggers.${n.type}`, { defaultValue: n.title });
}

/**
 * Resolves a notification's display body from `notifications.body.<type>`,
 * interpolated with `n.metadata`. Falls back to the server-supplied `n.body`
 * when there's no localized template for the type (or it resolves empty).
 */
export function notifBody(n: Notification, t: TFunction): string | null {
  const key = `notifications.body.${n.type}`;
  const resolved = t(key, { ...(n.metadata ?? {}), defaultValue: '' });
  return resolved || n.body;
}
