# Connectors

Connectors are saved, encrypted connections to external systems — databases, email servers, file servers, and plugin destinations — that workflow nodes use **by reference**. A workflow node never stores a password itself; it points at a connector by name, and the server supplies the credentials at run time.

## Outcome

You can list connectors, create database and email connectors, enter their configuration, save, edit, enable or disable, remove, and rotate credentials safely — and understand how workflow nodes pick them up.

![Connectors list with configured destinations](connectors-list.png)

## Where connectors live

Open **Settings → Connectors**. The list shows each connector's name, type, and enabled state. Use the add action to create one, or the row actions to edit, enable/disable, or remove.

## How workflows use connectors

A workflow **Database** node or **Send Email** node shows a **connector dropdown**, not credential fields. That dropdown is **filtered by type**:

- A **Postgres** node lists only Postgres connectors.
- A **Send Email (SMTP)** node lists only SMTP connectors.

So the order is always: **create the connector first**, then open the node and pick it. If a connector does not appear in a node's dropdown, it is either the wrong type or disabled.

## Security model

- Secret fields (passwords, tokens) are **encrypted at rest** with the server's encryption key and shown **masked**. You cannot read a secret back after saving.
- **Rotate** a credential by editing the connector, replacing the secret, and saving. Dependent workflows use the new value on their next run.
- **Disable** a connector to revoke its use everywhere without deleting it.
- Never paste secrets into names, notes, screenshots, or workflow labels.

## Before you begin

- You need administrator access (`lab_admin`).
- Know the address, port, database/mailbox, and credentials of the system you are connecting to.
- For email, have the sending account's SMTP details (or an App Password — see below).

## Database connectors (Postgres, MySQL / MariaDB, Microsoft SQL)

Use these for the SQL nodes — source extracts, report queries, and any node that reads or writes an external database. In the type dropdown the MySQL option is labelled **MySQL / MariaDB** and serves both engines. (For non-SQL stores, **MongoDB** and **Redis** connectors are also available — see [Other connector types](#other-connector-types).)

**Postgres / MySQL / MariaDB fields**

| Field | Notes |
| --- | --- |
| Host | Address of the database server (see the host/port note below). |
| Port | Postgres `5432`, MySQL `3306`. |
| Database | The database (schema) name. |
| User | Database user. |
| Password | Database password (masked). |
| SSL | Turn on if the server requires TLS. |

**Microsoft SQL fields**

| Field | Notes |
| --- | --- |
| Host | Address of the SQL Server. |
| Port | Usually `1433`. |
| Database | Database name. |
| User / Password | SQL login. |
| Encrypt | Turn on to require TLS (recommended). |
| Trust server certificate | Turn on for self-signed certificates in test environments. |

**Host/port are from the server's point of view.** The address must be reachable **by the OpenLDR server process**, not your laptop:

- If OpenLDR runs directly on a machine, use the address and published port you would use there (e.g. `localhost` and `5433`).
- If OpenLDR runs inside Docker Compose, use the database **service name** and its **internal** port (e.g. `postgres` and `5432`).

**The connector's type sets the SQL dialect.** The Database node's label (Postgres vs Microsoft SQL) is cosmetic — the actual dialect comes from the connector you attach. Always pick a connector whose type matches your real database.

## Email connectors (SMTP, Gmail, Outlook)

Use these for the **Send Email** node.

- **SMTP** — the general-purpose, recommended option. Works with any SMTP provider, **including Gmail** (via an App Password), Outlook/Office 365, and relays such as smtp2go or Mailtrap.
- **Gmail / Outlook (OAuth2)** — only if you already have a Google Cloud or Microsoft Entra OAuth app (client ID, client secret, refresh token). This is more setup than most people need; prefer the SMTP option for Gmail.

**SMTP fields**

| Field | Notes |
| --- | --- |
| Host | The mail server, e.g. `smtp.gmail.com`. |
| Port | `587` for STARTTLS (Secure off) or `465` for SSL (Secure on). |
| User | The sending account / login. |
| Password | The account password — **or an App Password** for Gmail. |
| Secure | Off for port 587, On for port 465. |

The sender address is the connector's **User**. The recipient is set later on the Send Email node's **To** field.

### Send from Gmail (SMTP + App Password)

Gmail will **reject your normal password** over SMTP once 2‑Step Verification is on — you will see `534-5.7.9 Application-specific password required`. The fix is an **App Password**: a 16‑character, single‑purpose password Gmail generates for one app. It bypasses the 2‑factor prompt for that app only, leaves your real password protected, and can be revoked at any time.

1. Turn on **2‑Step Verification** at `myaccount.google.com` → Security. (App Passwords require it.)
2. Go to `myaccount.google.com/apppasswords`, name it (e.g. `OpenLDR`), and **Create**. Copy the 16‑character code (shown like `abcd efgh ijkl mnop`).
3. **Settings → Connectors → New**, type **SMTP Email**:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.gmail.com` |
   | Port | `587` |
   | User | `you@gmail.com` |
   | Password | *the 16‑character App Password* |
   | Secure | Off |

4. Save, then pick this connector in the Send Email node.

If the App Passwords page says it is unavailable, 2‑Step Verification is not fully on, or (for Google Workspace accounts) an administrator has disabled App Passwords — in that case use a relay such as **Mailtrap** (captures mail for testing) or **smtp2go**.

**Common SMTP providers**

| Provider | Host | Port | Secure |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 587 | Off (App Password) |
| Outlook / Office 365 | `smtp.office365.com` | 587 | Off |
| smtp2go | `mail.smtp2go.com` | 2525 or 587 | Off |
| Mailtrap (testing) | `sandbox.smtp.mailtrap.io` | 587 | Off |

## Other connector types

- **IMAP Email** — for the *Email Trigger* node, which starts a workflow when new mail arrives (host, port, user, password, TLS).
- **SFTP** — for file-transfer nodes (host, port, user, password).
- **MongoDB** — for reading or writing a MongoDB collection from a workflow node (connection URI and database).
- **Redis** — for a Redis key/value store (host, port, password, database index).
- **Plugin destinations** — connectors powered by an installed plugin (e.g. a DHIS2 sink). Select the plugin, then complete its configuration fields.

## Steps (create any connector)

1. Open **Settings → Connectors**.
2. Choose the add action.
3. Pick the connector **type** (Postgres, SMTP Email, …).
4. Enter a clear **name** you will recognise in node dropdowns.
5. Complete the type-specific fields; fill secret fields only with the intended values.
6. Choose whether the connector starts enabled.
7. **Save**.
8. Open the workflow node that needs it and select the connector from its dropdown.

![Connector form with type, name, configuration, enabled state, and save](connector-form.png)

## Expected result

The connector appears in the list and becomes selectable in every compatible workflow node.

## Troubleshooting

- **`534-5.7.9 Application-specific password required` (Gmail):** create and use an App Password (see above), not your login password.
- **Invalid login / authentication failed:** wrong user or password/App Password; re-enter the secret.
- **Connection refused or timeout:** wrong host/port, or the database/mail server is not reachable **from the OpenLDR server** (check Docker service names vs `localhost`).
- **TLS/SSL error:** toggle SSL/Secure/Encrypt to match the server's requirement (587 → Secure off, 465 → Secure on).
- **Connector missing from a node's dropdown:** its type does not match the node, or it is disabled.
- **A workflow cannot use the connector:** confirm it is enabled and your role can use it.

## Advanced web usage

Rotate credentials by editing the connector, replacing secret values, saving, and testing before dependent workflows run again. Keep one connector per real destination so rotation and disabling have a clear, single effect.

## Related guides

- [Workflows](/docs/workflows)
- [Scheduled reports with workflows](/docs/report-pipeline)
- [Settings](/docs/settings)
- [Marketplace](/docs/marketplace)
