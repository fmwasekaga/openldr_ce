declare module 'mailparser' {
  import type { Readable } from 'stream';

  export interface AddressObject {
    value: Array<{ name?: string; address?: string }>;
    text: string;
  }

  export interface AttachmentCommon {
    filename?: string;
    contentType: string;
    content: Buffer;
    size: number;
    contentId?: string;
    contentDisposition?: string;
  }

  export interface HeaderLine {
    key: string;
    line: string;
  }

  export interface ParsedMail {
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    bcc?: AddressObject;
    subject?: string;
    date?: Date;
    text?: string;
    textAsHtml?: string;
    html?: string | false;
    headerLines: HeaderLine[];
    attachments: AttachmentCommon[];
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
  }

  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    maxHtmlLengthToParse?: number;
    skipImageLinks?: boolean;
    keepCidLinks?: boolean;
  }

  export function simpleParser(
    source: Buffer | Readable | string,
    options?: SimpleParserOptions
  ): Promise<ParsedMail>;
}
