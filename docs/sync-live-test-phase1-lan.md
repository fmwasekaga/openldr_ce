# Distributed Sync — Phase 1 Live Test (LAN, two real machines)

**Status:** runbook, not yet executed. Phase 1 of a two-phase plan; Phase 2 (WAN + network partition, central on the DigitalOcean droplet) follows once this passes.

## Why this test exists

Every sync acceptance harness to date runs on **one machine**. Only `pnpm sync:bundle:accept` drives real HTTP end-to-end; `pnpm sync:e2e` is two full instances but on **localhost**; the rest (`sync:accept`, `sync:pull:accept`, `sync:amend:accept`, …) deliberately shortcut the transport (`serve*` in-process, no Fastify/JWKS). **Nothing has ever synced two nodes over a real network** — which is the entire premise of the design (a lab running offline over intermittent, bandwidth-constrained links, reconciling opportunistically with a central).

**Phase 1 removes exactly one unknown at a time.** A LAN gives you two real machines, a real network hop, real Fastify, and real Keycloak — but a *stable, fast* link. So if something breaks here, it's a code or config bug, not the network. Phase 2 then adds the one variable Phase 1 held constant: a hostile WAN link you can pull the plug on.

## Topology

| Role | Machine | Runs | Reachability |
|---|---|---|---|
| **central** | Linux box | Postgres + **Keycloak** (realm `openldr`) + OpenLDR central | must be reachable from the lab on the LAN — note its LAN IP, e.g. `192.168.1.x` |
| **lab** | this laptop | its own Postgres + OpenLDR | initiates sync; can sit behind NAT (the lab is always the client — NAT-friendly by design) |

Both on the same LAN. The lab reaches central at `http://<linux-lan-ip>:<port>`.

## Step 0 — a coherent, certified build

1. **Push and certify first.** `main` is a clean fast-forward ahead of origin by the cursor-reporting slice; push it (`git push origin main`) so both nodes deploy the *same* commit. Do not test a build that only exists on the laptop.
2. **Deploy both nodes from that one build** — via the existing Docker installer / `openldr-{api,studio,web,gateway}` images built from the pushed `main`. (Deploy mechanics are the installer's concern; this runbook does not restate them.)
3. **Real Keycloak, not the dev bypass.** Do **NOT** set `AUTH_DEV_BYPASS=true` — the whole point is to exercise real client-credentials tokens with the `site_id` claim over the wire.

## ⚠️ The #1 LAN tripwire — read before you start

**Keycloak's issuer URL must be the address the LAB can reach, not `localhost`.** When central mints the lab's client, the token's `iss` claim is central's OIDC issuer. If that issuer is `http://localhost:8180/...`, a token minted on the Linux box will **fail validation when the lab presents it**, because "localhost" on the lab is the lab. Configure central's `OIDC_ISSUER_URL` to `http://<linux-lan-ip>:<kc-port>/realms/openldr` — the URL that resolves the same from *both* machines. This is the most common cross-machine sync failure and it will look like a mysterious 401.

Secondary tripwires: clock skew between the two machines (token `exp`); the Linux box's firewall (open the API + Keycloak ports on the LAN); and the single-port gateway routing (confirm `/api/sync/*` reaches the API through the gateway).

## The test — each step has an assertion

**1. Central up.** Verify central is healthy, the Keycloak realm loads, and `GET /api/settings/sync/status` (as a `lab_admin`) responds.

**2. Lab up.** Verify the lab is healthy on its own DB, and you can author a Patient + Observation locally (through Studio or the API).

**3. Enroll the lab — FROM central:**
```
openldr sync enroll lab-lan-1 --central-url http://<linux-lan-ip>:<port>
```
Capture the **one-time** output: `clientId`, `clientSecret`, `siteId`, `centralUrl`, `oidcIssuer`. **Assert:** `openldr sync list` on central shows `lab-lan-1` active.

**4. Configure sync on the lab.** In Studio → **Settings → General → Sync** (or the discrete `sync.*` app-settings keys): paste `centralUrl`, `oidcIssuer`, `clientId`, `clientSecret`; set **mode = bidirectional** and a **short interval (1 min)** so you're not waiting 15. **Assert:** `openldr sync status` on the lab shows `enabled`, the mode, and both directions present.

**5. Seed.** On the **lab**: author 2–3 Patients + several Observations (results). On **central**: author a form or dashboard (reference config) so the pull direction has something to deliver.

**6. Sync.** Wait for the interval, or force it: `openldr sync now` on the lab.

**7. ✅ PUSH (results up).** On central, the lab's Observations now exist in the canonical FHIR store at their **origin version + the lab's `site_id`**. **Assert** the count matches what the lab authored.

**8. ✅ PULL (config down).** On the lab, central's form/dashboard now exists, marked `managed_origin = 'central'`. **Assert** it's present and read-only to the lab.

**9. ✅ REPORTED CURSORS (this is the A1 slice, over a real network for the first time).** On central's DB:
```sql
select site_id, consumer, seq, reported_at from sync_site_cursors where site_id = 'lab-lan-1';
```
**Assert** rows exist for both `'sync-pull'` and `'sync-amend-pull'` with non-zero `seq` and a recent `reported_at`. This proves the HTTP route recorded the lab's position — the thing `sync:e2e` only ever showed on localhost.

**10. ✅ AMENDMENT round-trip (co-edit).** On central, amend one of the lab's results (`openldr sync amend --resource-type Observation --id <id> --status amended` or Settings → Sync). On the lab's next pull, **assert** the amendment lands: the result advances to v2 with a `Provenance`, keeping the lab's `site_id`.

**11. ✅ CATCH-UP DRAIN at scale (the drain slice, over real HTTP for the first time).** Seed **>500** Observations on the lab (the batch ceiling is 500), then run **one** sync interval. **Assert** *all* of them reach central in that single window — pre-drain this capped at 500/tick. This is the first real-wire proof of `createDrainWorker`.

**12. ✅ GZIP on the wire (the S7-B thing only real HTTP proves).** Watch central's request logs, or a proxy/`tcpdump`, and confirm a push/pull body over ~1 KB carries `content-encoding: gzip`. On localhost this was inferred; here you can see it.

**13. Health.** `openldr sync divergence list` and `openldr sync quarantine list` on both nodes — **assert both empty** (no same-version divergence, no poison-bulk quarantine).

## What to capture

For each step: the assertion result, timing, and any error. The single most valuable observation is **"did anything that passed on localhost fail on two real machines?"** — that is what Phase 1 exists to find. Snapshot `openldr sync status` before and after.

## Exit criteria → Phase 2

Push-up, pull-down, amendment round-trip, reported cursors, the >500 drain, and gzip all verified on the LAN, with divergence/quarantine clean. Then promote **central to the DigitalOcean droplet** (`104.236.254.103` / openldr.online) and re-run steps 3–13 across the real internet — this time with Keycloak TLS'd and reachable over WAN (the likely Phase-2 tripwire), and with the decisive addition: **pull the plug mid-drain, restore it, and confirm the lab converges** — the resumability the cursor already gives us, proven under a real partition.
