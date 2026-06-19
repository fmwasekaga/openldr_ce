import { type Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export type ProfileExtras = Record<string, { value: string; fhirPath: string | null }>;
export interface UserProfile { userId: string; formSchemaId: string | null; formVersion: number | null; extras: ProfileExtras }
export interface UserProfileStore {
  get(userId: string): Promise<UserProfile | undefined>;
  list(userIds: string[]): Promise<Map<string, UserProfile>>;
  upsert(userId: string, input: { formSchemaId?: string | null; formVersion?: number | null; extras?: ProfileExtras }): Promise<void>;
}
interface Row { user_id: string; form_schema_id: string | null; form_version: number | null; extras: unknown }
const toProfile = (r: Row): UserProfile => ({
  userId: r.user_id, formSchemaId: r.form_schema_id, formVersion: r.form_version,
  extras: (r.extras as ProfileExtras | null) ?? {},
});
export function createUserProfileStore(db: Kysely<InternalSchema>): UserProfileStore {
  return {
    async get(userId) {
      const r = await db.selectFrom('user_profiles').select(['user_id', 'form_schema_id', 'form_version', 'extras']).where('user_id', '=', userId).executeTakeFirst();
      return r ? toProfile(r as unknown as Row) : undefined;
    },
    async list(userIds) {
      const map = new Map<string, UserProfile>();
      if (userIds.length === 0) return map;
      const rows = await db.selectFrom('user_profiles').select(['user_id', 'form_schema_id', 'form_version', 'extras']).where('user_id', 'in', userIds).execute();
      for (const r of rows) map.set((r as unknown as Row).user_id, toProfile(r as unknown as Row));
      return map;
    },
    async upsert(userId, input) {
      await db.insertInto('user_profiles')
        .values({ user_id: userId, form_schema_id: input.formSchemaId ?? null, form_version: input.formVersion ?? null, extras: JSON.stringify(input.extras ?? {}) as never, updated_at: new Date() })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ form_schema_id: input.formSchemaId ?? null, form_version: input.formVersion ?? null, extras: JSON.stringify(input.extras ?? {}) as never, updated_at: new Date() }))
        .execute();
    },
  };
}
