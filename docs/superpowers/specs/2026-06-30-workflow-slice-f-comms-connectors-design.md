# Slice F — Communication Connectors (Email + SFTP) Design

**Date:** 2026-06-30
**Status:** Design / spec
**Relates to:** [Slice D — connector foundation](2026-06-30-workflow-connector-foundation-design.md), [Slice E — db connectors](2026-06-30-workflow-slice-e-db-connectors-design.md)

## Purpose

Add the communication connectors on the existing connector foundation: outbound **email** (`send-email` SMTP, `gmail`, `outlook`) unified through `nodemailer`, and **file transfer** (`ftp`) via SFTP reusing the Slice-C binary channel. No data-model/migration change — new connector `type` values only.

**Decisions locked during brainstorming:** all four nodes; email unified via nodemailer (gmail/outlook use nodemailer's OAuth2 transport — no Gmail/Graph SDK); **bring-your-own OAuth refresh token** (connector stores client id/secret/refresh token; no in-app consent flow); FTP = SFTP with download/upload/list/delete/rename.

## What already exists (reused)

- Connector model: nullable `plugin_id` + `type`; `connector-store`; XOR invariant. New types are just new `type` strings.
- `WorkflowServices` optional service pattern (`runConnectorSql`/`Mongo`/`Redis`); add `runConnectorEmail?` + `runConnectorSftp?`.
- `connectors:<type>` options resolver — generic, no change.
- Slice-C binary services on `WorkflowServices`: `readBinary?(objectKey)→Uint8Array`, `writeBinary?({bytes,fileName,contentType})→BinaryRef` — the FTP node handler reuses these for download/upload.
- `connector-test.ts` `testConnector(type, config)` — extend with email + sftp probes.
- Connectors UI: category (`plugin` vs the host/type category) + `HOST_TYPES` + per-type `CONNECTOR_TYPE_FIELDS` + i18n.
- AES-256-GCM secrets; audit `configKeys` only; `redact` on errors.

## Architecture

### 1. Email — `send-email` / `gmail` / `outlook` (unified via nodemailer)

- **Dep:** `nodemailer` + dev `@types/nodemailer` (in `packages/bootstrap`).
- **Connector types & config:**
  - `smtp`: `{ host, port, user, password, secure }` (secure: 'true'/'false').
  - `gmail`: `{ user, clientId, clientSecret, refreshToken }`.
  - `outlook`: `{ user, clientId, clientSecret, refreshToken, tenant }` (tenant default `common`).
  - All may carry an optional `from` (defaults to `user`).
- **`createEmailTransport(type, config)`** (`packages/bootstrap/src/connector-email.ts`) → a nodemailer `Transporter`:
  - smtp: `nodemailer.createTransport({ host, port: validatePort(port,587), secure: config.secure === 'true', auth: { user, pass: password } })`.
  - gmail: `createTransport({ service: 'gmail', auth: { type: 'OAuth2', user, clientId, clientSecret, refreshToken } })`.
  - outlook: `createTransport({ host: 'smtp.office365.com', port: 587, secure: false, auth: { type: 'OAuth2', user, clientId, clientSecret, refreshToken, accessUrl: 'https://login.microsoftonline.com/' + (tenant || 'common') + '/oauth2/v2.0/token' } })`.
  - Factory injectable for tests.
- **Service** `runConnectorEmail?({ connectorId, to, subject, body, html?, cc? }): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>` (`connector-email-service.ts`): resolve connector (type ∈ {smtp,gmail,outlook}; else throw), decrypt, `createEmailTransport`, `transport.sendMail({ from: config.from || config.user, to, cc, subject, ...(html ? { html: body } : { text: body }) })`, return `{ messageId, accepted, rejected }`, `transport.close()` in finally.
- **Node handler `email.ts`** registered for **all three ids** (`send-email`, `gmail`, `outlook`): guard `runConnectorEmail`; `connectorId` + `to` + `subject` required; `to`/`cc`/`subject`/`body` template-resolved; `html` boolean; call service; return `[{ json: { messageId, accepted, rejected } }]` (spread the first input item's json if present). Descriptors differ only by `optionsSource: 'connectors:smtp' | 'connectors:gmail' | 'connectors:outlook'`. Config fields: `connectorId` (select, required), `to` (text, required), `subject` (text, required), `body` (text), `cc` (text), `html` (boolean).

### 2. FTP — `ftp` (SFTP via ssh2-sftp-client)

- **Dep:** `ssh2-sftp-client` (in `packages/bootstrap`).
- **Connector type `sftp`**, config `{ host, port, user, password }`.
- **`runConnectorSftp?({ connectorId, operation, remotePath, toPath?, bytes? }): Promise<{ bytes?: Uint8Array; fileName?: string; entries?: { name: string; size: number; type: string }[]; ok?: boolean }>`** (`connector-sftp-service.ts`): resolve (type === 'sftp'), decrypt, `new SftpClient(); await client.connect({ host, port: validatePort(port,22), username: user, password })`, then by `operation`:
  - `download`: `await client.get(remotePath)` → Buffer → `{ bytes, fileName: basename(remotePath) }`.
  - `upload`: `await client.put(Buffer.from(bytes), remotePath)` → `{ ok: true }`.
  - `list`: `await client.list(remotePath)` → `{ entries: rows.map(r => ({ name: r.name, size: r.size, type: r.type })) }`.
  - `delete`: `await client.delete(remotePath)` → `{ ok: true }`.
  - `rename`: `await client.rename(remotePath, toPath)` → `{ ok: true }`.
  Always `await client.end()` in finally. Client factory injectable for tests.
- **Node handler `ftp.ts`**: guard `runConnectorSftp`; `connectorId` + `remotePath` required; `operation` default `download`; `binaryField` default `file`. The handler orchestrates binary via the Slice-C services:
  - `download`: call service → `writeBinary({ bytes, fileName, contentType: 'application/octet-stream' })` → `[{ json: { fileName }, binary: { [binaryField]: ref } }]` (requires `ctx.services.writeBinary`).
  - `upload`: read `input[0].binary[binaryField]` (throw if absent) → `ctx.services.readBinary(objectKey)` → bytes → service `upload` → `[{ json: { ok: true, remotePath } }]` (requires `readBinary`).
  - `list`: service → `entries` → `rowsToItems(entries)`.
  - `delete`: service → `[{ json: { ok: true, remotePath } }]`.
  - `rename`: read `toPath` config (required for rename) → service → `[{ json: { ok: true, from: remotePath, to: toPath } }]`.
  Descriptor `optionsSource: 'connectors:sftp'`; config: `connectorId` (select, required), `operation` (select: download/upload/list/delete/rename), `remotePath` (text, required), `toPath` (text, for rename), `binaryField` (text).

### 3. Connector test probe (extend)

`testConnector(type, config, deps?)` (`connector-test.ts`): add branches —
- `smtp`/`gmail`/`outlook` → `await createEmailTransport(type, config).verify()` (nodemailer verifies connection + auth), then no explicit close needed (verify manages it; call `.close()` defensively).
- `sftp` → connect + `await client.list('.')` (or just connect) then `client.end()`.
Injectable `email`/`sftp` factories in `ConnectorTestDeps` for unit tests. Route `/:id/test` already calls `testConnector(connector.type, config)` — no route change needed.

### 4. Connectors UI

- Relabel the non-plugin category from "Database" to a generic **"Host"** (i18n `category` value); it already drives a `type` picker.
- `HOST_TYPES` gains: `smtp` ("SMTP Email"), `gmail` ("Gmail"), `outlook` ("Microsoft Outlook"), `sftp` ("SFTP").
- `CONNECTOR_TYPE_FIELDS` gains:
  - `smtp`: host, port, user, password, secure(bool).
  - `gmail`: user, clientId, clientSecret(password), refreshToken(password).
  - `outlook`: user, clientId, clientSecret(password), refreshToken(password), tenant.
  - `sftp`: host, port, user, password.
- New i18n keys (en/fr/pt): `fieldSecure`, `fieldClientId`, `fieldClientSecret`, `fieldRefreshToken`, `fieldTenant` (+ relabel `categoryDatabase`→`categoryHost` or add `categoryHost`).
- Create payload `{ name, type, config }` unchanged. The "required to create" rule (min `host` for db/sftp) generalizes: for email types require `user` instead of `host` (gmail/outlook have no host field). Use: require the FIRST field in the type's schema to be non-empty on create.

### 5. Components & boundaries

| Unit | Responsibility | New? |
|---|---|---|
| `connector-email.ts` `createEmailTransport` | type→nodemailer Transporter | new |
| `connector-email-service.ts` `createConnectorEmailRunner` | resolve+sendMail+close | new |
| `connector-sftp-service.ts` `createConnectorSftpRunner` | resolve+sftp op+end | new |
| `runConnectorEmail`/`runConnectorSftp` on WorkflowServices | engine-facing | new (optional) |
| `email.ts` handler (3 node ids) | template + send | new |
| `ftp.ts` handler | sftp + binary via readBinary/writeBinary | new |
| `connector-test.ts` (extend) | email verify / sftp probe | edit |
| descriptors (4) + constants | builder config + enable | edit |
| Connectors UI (host types + fields) | create email/sftp connectors | edit |

## Error handling

- Services guard connector (enabled + correct type) → clear errors; send/transfer failures propagate as node errors (runner records). Handlers guard the optional service. FTP upload with no input file → clear "no file on input item" error; rename without `toPath` → clear error. Secrets (passwords, client secrets, refresh tokens) never logged; `/test` errors `redact`ed; audit `configKeys` only. Email `to`/`cc` accept comma-separated lists (nodemailer handles).

## Testing strategy

- `createEmailTransport`: unit — smtp/gmail/outlook produce a transport (injected nodemailer factory asserts the config shape, esp. gmail OAuth2 + outlook accessUrl); unsupported type throws.
- `createConnectorEmailRunner`: unit with injected transport — sendMail called with from/to/subject/html-vs-text; close in finally; type guard.
- `createConnectorSftpRunner`: unit with injected client — each op (download/upload/list/delete/rename) calls the right method, `end()` in finally even on throw, type guard.
- `email` handler: fake service — template resolution of to/subject/body, html flag, guards (connector/to/subject/services).
- `ftp` handler: fake service + fake readBinary/writeBinary — download writes a BinaryRef, upload reads the input file, list→items, delete/rename shapes, guards (incl. rename requires toPath).
- `testConnector`: extend the existing unit to assert email `verify()` and sftp probe per type.
- Connectors UI: component test — selecting Gmail renders clientId/clientSecret/refreshToken; SFTP renders host/port/user/password; create payload type. i18n parity for new keys.
- **Live SMTP/Gmail/Outlook/SFTP deferred** to the accept script (with the deferred db probes).

## Out of scope / deferred

- Plain (non-SFTP) FTP; SSH key auth (password only); email attachments (send text/html only — sending a workflow file as an attachment is a future enhancement); in-app OAuth consent flow; Gmail/Graph SDK paths; IMAP `email-trigger` (a listener trigger — separate slice). Connection pooling (ephemeral per op). Live e2e in the unit gate.

## Non-goals

- No data-model/migration change. No second connectors UI. No DHIS2 plugin-path change.

## Cross-package gate reminder

New optional `WorkflowServices` methods + bootstrap services are consumed by `apps/server`. The gate MUST `tsc` `packages/workflows`, `packages/bootstrap`, `apps/server`, AND `apps/web`.
