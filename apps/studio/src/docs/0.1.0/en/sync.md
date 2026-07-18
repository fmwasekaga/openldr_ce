# Distributed Sync

Distributed sync links many labs to one **central** OpenLDR server over intermittent, low-bandwidth links. Each lab runs a full OpenLDR CE instance, works offline, and reconciles opportunistically whenever a connection is available. Lab-owned operational data (patients, requests, results, specimens, reports) flows **up** to central, which keeps a read-only mirror; central-owned reference configuration (forms, dashboards, reports, allowlisted settings) and terminology flows **down** to every lab, which treats it as read-only. Every record carries the `site_id` of the lab that produced it.

## Outcome

On a **central** server you can enroll a lab — minting its Keycloak client and one-time secret — then list, rotate, or revoke sites. On a **lab** server you can paste those credentials into the Sync card, choose a direction, watch live per-direction status, and trigger a sync on demand.

## How it flows

- **Up (lab → central):** operational FHIR the lab owns — patients, lab requests, lab results, specimens, diagnostic reports. Central stores a mirror it never edits; the lab remains the source of truth.
- **Down (central → lab):** reference configuration central owns — forms, dashboards, report definitions, allowlisted settings — plus terminology (code systems and concept maps). Labs consume these read-only.
- **Site stamping:** central scopes and de-duplicates by the originating `site_id`, so two labs never collide even when they create records with the same local identifiers.

## Before you begin

- You need administrator access (`lab_admin`) on both the central and the lab server.
- **Central** performs enrollment and holds the read-only mirror. **Labs** connect to central and push their own data.
- Enrollment mints Keycloak clients, so the central Keycloak realm must grant the admin service account the `manage-clients` and `view-clients` roles. The realm export shipped with OpenLDR already includes them. A Keycloak container first started **before** distributed sync was added needs its realm re-imported (or those two client roles added by hand) — otherwise minting a client fails.
- Use HTTPS for the central URL in production: the client secret is transmitted once at enrollment and lab tokens travel on every sync.

## On central — enroll a lab

Enrollment creates a confidential Keycloak client (`sync-<siteId>`) with a `site_id` token mapper, generates its secret, and records a registry row. The secret is shown **once** and is never retrievable afterwards — if it is lost, rotate.

### Using the Sites page

![Enroll a site dialog with Site ID, Name, and Central URL](sync-enroll-site.png)

1. Open **Settings → Sites** (admin-only). Sites is a Settings page, not a top-level sidebar item.
2. Choose **Enroll site** and fill in:

   | Field | Notes |
   | --- | --- |
   | Site ID | Stable identifier for the lab, e.g. `lab-ndola-01`. Lowercase letters, digits, and hyphens; 1–63 characters, not starting with a hyphen. Reused as the Keycloak client id and the registry key. |
   | Name | Optional human-readable label. |
   | Central URL | The public base URL the lab will reach this central server on, e.g. `https://central.example.org`. Required. |

3. **Enroll**. A one-time dialog reveals the values the lab operator needs: **client id**, **client secret**, **OIDC issuer**, and **central URL**. Copy them somewhere safe (each has a copy button) and hand them to the lab before closing — the secret is not shown again.

The site appears in the table with an **active** badge. From its row menu you can **Rotate** (issue a new secret) or **Revoke** (delete the client and mark the row revoked).

### Using the CLI

Run these on the central server:

```
openldr sync enroll lab-ndola-01 --name "Ndola Central Hospital" --central-url https://central.example.org
openldr sync list
openldr sync rotate lab-ndola-01
openldr sync revoke lab-ndola-01
```

`sync enroll` prints the client id, client secret, site id, central URL, and OIDC issuer once, with a warning that the secret will not be shown again. `--central-url` is required. `sync list` shows enrolled sites and their status but never a secret. `sync rotate` prints a new secret once; `sync revoke` deletes the client and marks the row revoked, and is safe to re-run. Add `--json` to any of them for machine-readable output.

## On a lab — connect to central

The lab operator takes the five values from enrollment — **client id**, **client secret**, **site id**, **central URL**, **OIDC issuer** — and enters them into the Sync card.

![Distributed Sync card under Settings → General, with the live status panel](sync-settings-card.png)

1. Open **Settings → General** and find the **Distributed Sync** card (admin-only).
2. Fill in the fields:

   | Field | Notes |
   | --- | --- |
   | Enabled | Master switch. Off keeps the workers dormant. |
   | Mode | **Push** (send operational data up only), **Pull** (receive reference config + terminology down only), or **Bidirectional** (both). |
   | Central URL | The central server's base URL from enrollment, e.g. `https://central.example.org`. |
   | Site ID | This lab's site id, e.g. `lab-ndola-01`. |
   | OIDC issuer | The realm issuer from enrollment, e.g. `https://central.example.org/auth/realms/openldr`. |
   | Client ID | The minted client, `sync-<siteId>`. |
   | Client secret | The one-time secret from enrollment. Write-only and masked — leave it blank when editing other fields to keep the stored value. |
   | Interval (minutes) | How often to sync, 1–1440. Defaults to 15. |

3. **Save**. When **Enabled** is on, the central URL, site id, OIDC issuer, and client id are all required.

### Read the status panel

Below the form, a live panel (polled every few seconds) shows:

- An **on/off** badge for the whole engine.
- A **push** line and a **pull** line, each reading `running` or `idle`, the last synced sequence, and the last-synced time — or `not started` when that direction is disabled by the mode.
- **Pending** — the count of local changes still waiting to push up.

Use **Sync now** to trigger a pass immediately instead of waiting for the interval. It reports back whether a pass was triggered (and does nothing if sync is disabled).

### Using the CLI

On the lab server you can drive the same config and status from the command line:

```
openldr settings sync show
openldr settings sync set mode bidirectional
openldr sync status
openldr sync now
```

`settings sync set <field> <value>` writes any one field: `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret`, or `intervalMinutes`. `sync status` prints the live workers, cursors, and pending backlog; `sync now` triggers a pass and fails if sync is disabled.

## Expected result

Central shows the lab as **active** on the Sites page. On the lab, the status panel shows the enabled engine with a push and/or pull line advancing, and **Pending** trending toward zero as backlog clears. Central's mirror gains the lab's records (stamped with its site id); the lab receives central's forms, dashboards, reports, and terminology.

## Troubleshooting

- **Sync stays off / nothing happens:** confirm **Enabled** is on and the mode matches what you expect. Re-check the central URL, site id, OIDC issuer, and client id; if the secret was ever blanked, re-enter it (a blank field keeps the previous value, so a genuinely wrong secret needs a fresh paste).
- **`403`/`503` when enrolling a site (central):** the admin service account lacks `manage-clients`/`view-clients`, or Keycloak admin is not configured. Re-import the central realm (or add those client roles) and confirm the admin credentials, then retry.
- **Lost client secret:** it is unrecoverable by design. **Rotate** the site (Sites page row menu, or `openldr sync rotate <siteId>`) to issue a new one, and paste it into the lab's Sync card.
- **Lab tokens rejected at central:** the site was revoked, or the client id / OIDC issuer on the lab does not match what central minted. Confirm the site is active in `openldr sync list` and that the issuer URL points at the central realm.
- **A revoked lab needs to return:** re-enroll the same site id on central; it reactivates the registry row and issues a new secret.

## Related guides

- [Settings](/docs/settings)
- [Users and Roles](/docs/users)
- [Environment Variables](/docs/environment)
