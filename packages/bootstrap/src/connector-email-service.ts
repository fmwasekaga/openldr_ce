import type { Transporter } from 'nodemailer';
import { createEmailTransport } from './connector-email';

const EMAIL_TYPES = new Set(['smtp', 'gmail', 'outlook']);

export interface ConnectorEmailDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  makeTransport?: (type: string, config: Record<string, string>) => Transporter;
}

export function createConnectorEmailRunner(deps: ConnectorEmailDeps) {
  const make = deps.makeTransport ?? ((type, config) => createEmailTransport(type, config));
  return async ({ connectorId, to, subject, body, html, cc }: { connectorId: string; to: string; subject: string; body: string; html?: boolean; cc?: string }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type || !EMAIL_TYPES.has(c.type)) throw new Error(`connector ${connectorId} is not an email connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const transport = make(c.type, config);
    try {
      const info = await transport.sendMail({ from: config.from || config.user, to, ...(cc ? { cc } : {}), subject, ...(html ? { html: body } : { text: body }) });
      return { messageId: String(info.messageId ?? ''), accepted: (info.accepted ?? []) as string[], rejected: (info.rejected ?? []) as string[] };
    } finally {
      transport.close();
    }
  };
}
