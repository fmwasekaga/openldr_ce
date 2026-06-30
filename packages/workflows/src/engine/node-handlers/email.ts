import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Send an email via a connector (smtp/gmail/outlook). to/cc/subject/body are templated. */
export const emailHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorEmail) throw new Error('Email node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Email node: a connector is required');
  const to = resolveTemplate(String(config.to ?? ''), ctx, input);
  if (!to) throw new Error('Email node: a recipient (to) is required');
  const subject = resolveTemplate(String(config.subject ?? ''), ctx, input);
  if (!subject) throw new Error('Email node: a subject is required');
  const body = resolveTemplate(String(config.body ?? ''), ctx, input);
  const cc = config.cc ? resolveTemplate(String(config.cc), ctx, input) : undefined;
  const html = Boolean(config.html);
  const result = await ctx.services.runConnectorEmail({ connectorId, to, subject, body, html, cc });
  return [{ json: { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected } }];
};
