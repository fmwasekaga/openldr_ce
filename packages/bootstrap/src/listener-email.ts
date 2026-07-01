/// <reference path="./mailparser.d.ts" />
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { BinaryRef } from '@openldr/workflows';
import type { ListenerDriver, ListenerHandle, ListenerSpec, OnFire } from './workflow-listeners';

export function clampPollSeconds(raw: number | undefined, min: number): number {
  const n = Number.isFinite(raw) ? Math.floor(raw as number) : 60;
  return Math.max(min, n > 0 ? n : 60);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    if (Buffer.isBuffer(c)) {
      chunks.push(c);
    } else if (typeof c === 'string') {
      chunks.push(Buffer.from(c));
    } else {
      chunks.push(Buffer.from(c as Uint8Array));
    }
  }
  return Buffer.concat(chunks);
}

export interface PollOnceArgs {
  client: ImapFlow;
  parser: typeof simpleParser;
  folder: string;
  markSeen: boolean;
  maxPerPoll: number;
  maxBytes: number;
  onFire: OnFire;
  writeBinary: (input: { bytes: Uint8Array; fileName: string; contentType: string }) => Promise<BinaryRef>;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

/** One poll cycle: caller must have connected. Searches UNSEEN, fires per message, marks seen after onFire. */
export async function pollOnce(args: PollOnceArgs): Promise<void> {
  const lock = await args.client.getMailboxLock(args.folder);
  try {
    const result = await args.client.search({ seen: false }, { uid: true });
    const uids: number[] = result === false ? [] : result;
    for (const uid of uids.slice(0, args.maxPerPoll)) {
      const dl = await args.client.download(uid, undefined, { uid: true });
      const raw = await streamToBuffer(dl.content);
      const mail = await args.parser(raw);
      const files: Record<string, BinaryRef> = {};
      const attachmentsMeta: Array<{ field: string; fileName: string; contentType: string; byteSize: number }> = [];
      let i = 0;
      for (const att of mail.attachments ?? []) {
        const bytes = att.content as Buffer;
        if (bytes.byteLength > args.maxBytes) {
          args.logger.warn({ fileName: att.filename }, 'email attachment exceeds size cap; skipped');
          continue;
        }
        const field = `attachment_${i++}`;
        const ref = await args.writeBinary({
          bytes,
          fileName: att.filename ?? field,
          contentType: att.contentType ?? 'application/octet-stream',
        });
        files[field] = ref;
        attachmentsMeta.push({
          field,
          fileName: (ref as { fileName?: string }).fileName ?? att.filename ?? field,
          contentType: ref.contentType,
          byteSize: ref.byteSize,
        });
      }
      const htmlVal = mail.html;
      const input = {
        from: mail.from?.text ?? '',
        to: mail.to?.text ?? '',
        subject: mail.subject ?? '',
        date: mail.date?.toISOString() ?? '',
        text: mail.text ?? '',
        html: htmlVal !== false && htmlVal != null ? htmlVal : '',
        headers: mail.headerLines ?? [],
        attachments: attachmentsMeta,
      };
      await args.onFire(input, files);
      if (args.markSeen) {
        await args.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    }
  } finally {
    lock.release();
  }
}

export interface EmailDriverDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  writeBinary: PollOnceArgs['writeBinary'];
  logger: PollOnceArgs['logger'];
  cfg: { WORKFLOW_EMAIL_POLL_MIN_SECONDS: number; WORKFLOW_EMAIL_MAX_PER_POLL: number; WORKFLOW_FILE_MAX_BYTES: number };
  makeClient?: (config: Record<string, string>) => ImapFlow;
}

export function createEmailListenerDriver(deps: EmailDriverDeps): ListenerDriver {
  const make =
    deps.makeClient ??
    ((config) =>
      new ImapFlow({
        host: config.host ?? 'localhost',
        port: Number(config.port ?? 993),
        secure: config.tls !== 'false',
        auth: { user: config.user ?? '', pass: config.password ?? '' },
        logger: false,
      }));

  return {
    async start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle> {
      const connectorId = String(spec.config.connectorId ?? '');
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`Email trigger: connector ${connectorId} not found or disabled`);
      if (c.type !== 'imap') throw new Error(`Email trigger: connector ${connectorId} is not an imap connector`);
      const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      const folder = String(spec.config.folder ?? 'INBOX') || 'INBOX';
      const markSeen = spec.config.markSeen !== false;
      const pollMs =
        clampPollSeconds(
          spec.config.pollSeconds as number | undefined,
          deps.cfg.WORKFLOW_EMAIL_POLL_MIN_SECONDS,
        ) * 1000;

      let stopped = false;
      let polling = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const schedule = (): void => {
        if (!stopped && !timer) timer = setTimeout(() => { timer = null; void tick(); }, pollMs);
      };

      const tick = async (): Promise<void> => {
        if (stopped || polling) { schedule(); return; }
        polling = true;
        const client = make(config);
        try {
          await client.connect();
          await pollOnce({
            client,
            parser: simpleParser,
            folder,
            markSeen,
            maxPerPoll: deps.cfg.WORKFLOW_EMAIL_MAX_PER_POLL,
            maxBytes: deps.cfg.WORKFLOW_FILE_MAX_BYTES,
            onFire,
            writeBinary: deps.writeBinary,
            logger: deps.logger,
          });
        } catch (err) {
          deps.logger.warn({ err, workflowId: spec.workflowId }, 'email poll failed');
        } finally {
          await client.logout().catch(() => {});
          polling = false;
          schedule();
        }
      };

      timer = setTimeout(() => { timer = null; void tick(); }, 0);
      return {
        async stop() {
          stopped = true;
          if (timer) { clearTimeout(timer); timer = null; }
        },
      };
    },
  };
}
