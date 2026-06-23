import { createHash } from 'node:crypto';
import { verifyBundle, type Bundle, type Capability } from '@openldr/marketplace';
import { fromQuestionnaire, type FormStore } from '@openldr/forms';
import type { MarketplaceInstallStore, MarketplaceInstallRow } from '@openldr/db';
import type { AuditEventInput } from '@openldr/audit';

interface Audit { record(e: AuditEventInput): Promise<unknown>; }

export interface FormInstallOptions {
  actor: { id?: string | null; name: string };
  approval?: { approvedBy: string; acknowledgedCapabilities: Capability[] };
  sourceRef?: string;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createFormArtifactInstaller(deps: { forms: FormStore; installStore: MarketplaceInstallStore; audit: Audit }) {
  const { forms, installStore, audit } = deps;

  async function publishedQuestionnaire(formId: string): Promise<unknown | null> {
    const versions = await forms.listVersions(formId);
    if (!versions.length) return null;
    const fv = await forms.getVersion(formId, versions[0].version);
    return fv ? fv.questionnaire : null;
  }

  async function install(bundle: Bundle, opts: FormInstallOptions): Promise<{ id: string; version: string; targetFormId: string }> {
    if (bundle.manifest.type !== 'form-template') throw new Error(`not a form-template: ${bundle.manifest.type}`);

    if (bundle.manifest.publisher) {
      const v = verifyBundle(bundle);
      if (!v.valid) throw new Error('bundle failed verification');
      // The signature only covers bundle.raw; reject any parsed manifest field that
      // diverges from the signed raw payload (tamper of the in-memory manifest).
      if (bundle.manifest.id !== bundle.raw.id || bundle.manifest.version !== bundle.raw.version) {
        throw new Error('manifest does not match signed payload');
      }
      const declared = JSON.stringify(bundle.manifest.capabilities ?? []);
      const acked = JSON.stringify(opts.approval?.acknowledgedCapabilities ?? null);
      if (!opts.approval || declared !== acked) throw new Error('install requires matching capability approval');
    }

    const questionnaire = JSON.parse(new TextDecoder().decode(bundle.wasm)) as unknown;
    const schema = fromQuestionnaire(questionnaire as never);
    const artifactId = bundle.manifest.id;
    const version = bundle.manifest.version;
    const s = schema as { name?: string; fhirResourceType?: string | null; fhirVersion?: string | null; fhirProfileUrl?: string | null; targetPages?: string[] };
    const name = s.name || artifactId;

    const existing = await installStore.get(artifactId);
    const formInput = {
      name, versionLabel: version, schema,
      fhirResourceType: s.fhirResourceType ?? null, fhirVersion: s.fhirVersion ?? null,
      fhirProfileUrl: s.fhirProfileUrl ?? null, targetPages: s.targetPages ?? null, status: 'draft',
    };
    let targetFormId: string;
    if (existing) {
      await forms.update(existing.targetFormId, formInput as never);
      await forms.publish(existing.targetFormId, { versionLabel: version, actorId: opts.actor.id ?? null });
      targetFormId = existing.targetFormId;
    } else {
      const created = await forms.create(formInput as never);
      await forms.publish(created.id, { versionLabel: version, actorId: opts.actor.id ?? null });
      targetFormId = created.id;
    }

    const published = await publishedQuestionnaire(targetFormId);
    const payloadSha256 = sha256Json(published);

    await installStore.upsert({
      artifactId, version, kind: 'form-template', targetFormId, payloadSha256,
      publisherName: bundle.manifest.publisher?.name ?? null, sourceRef: opts.sourceRef ?? null,
      installedBy: opts.actor.id ?? opts.actor.name,
    });

    await audit.record({
      actorType: 'user', actorId: opts.actor.id ?? null, actorName: opts.actor.name,
      action: 'marketplace.install', entityType: 'marketplace.artifact', entityId: `${artifactId}@${version}`,
      metadata: { type: 'form-template', targetFormId },
    });

    return { id: artifactId, version, targetFormId };
  }

  async function detach(artifactId: string, opts: { actor: { id?: string | null; name: string } }): Promise<void> {
    const row = await installStore.get(artifactId);
    if (!row) throw new Error('not installed');
    await installStore.remove(artifactId);
    await audit.record({
      actorType: 'user', actorId: opts.actor.id ?? null, actorName: opts.actor.name,
      action: 'marketplace.detach', entityType: 'marketplace.artifact', entityId: artifactId,
      metadata: { targetFormId: row.targetFormId },
    });
  }

  async function drift(row: MarketplaceInstallRow): Promise<{ drifted: boolean }> {
    try {
      const published = await publishedQuestionnaire(row.targetFormId);
      if (published === null) return { drifted: false };
      return { drifted: sha256Json(published) !== row.payloadSha256 };
    } catch {
      return { drifted: false };
    }
  }

  async function list(): Promise<(MarketplaceInstallRow & { drifted: boolean })[]> {
    const rows = await installStore.list();
    const out: (MarketplaceInstallRow & { drifted: boolean })[] = [];
    for (const r of rows) out.push({ ...r, drifted: (await drift(r)).drifted });
    return out;
  }

  return { install, detach, drift, list };
}

export type FormArtifactInstaller = ReturnType<typeof createFormArtifactInstaller>;
