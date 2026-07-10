# Install

The one-line installer scaffolds an `openldr/` directory, generates secrets, pulls the
images, and starts the stack. When it finishes it prints the URL and the generated
admin credentials.

## Quick start (local / self-signed)

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

This brings the stack up on `https://localhost` with a self-signed certificate — your
browser will warn once; accept it to continue.

## Public domain + trusted TLS (Let's Encrypt)

To serve a real domain with a browser-trusted certificate in one shot, pass your
hostname and an email. The installer brings the stack up, requests a Let's Encrypt
certificate over HTTP-01, installs it into the gateway, and wires up **automatic
renewal** (a cron job that renews and reloads the gateway).

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Point `your.domain.com` at the host and open inbound **TCP 80 and 443** first —
Let's Encrypt validates over port 80. If issuance fails, the stack stays up on the
self-signed certificate; re-run the same command once DNS and ports are ready.

> **Tip:** add `--staging` the first time to use the Let's Encrypt staging CA. It
> avoids the production rate limits while you confirm DNS and firewall are correct,
> then re-run without `--staging` for the real certificate.

> Let's Encrypt issuance and auto-renewal are Linux-only. On Windows the installer
> configures a self-signed certificate; front it with your own reverse proxy or
> certificate if you need trusted TLS.

## Installer flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--dir <path>` | `./openldr` | Directory to scaffold the stack into. |
| `--version <tag>` | `latest` | Image tag to pull and run. |
| `--server-name <host>` | `localhost` | Public hostname/domain for this deployment. |
| `--letsencrypt <email>` | — | Issue a trusted Let's Encrypt certificate for `--server-name`. |
| `--staging` | off | Use the Let's Encrypt staging CA (testing; avoids rate limits). |
| `--no-start` | off | Scaffold and configure only; don't start the stack. |
| `--no-pull` | off | Skip pulling images (use what's already local). |

After it finishes, manage the stack from inside the `openldr/` directory:

```
docker compose ps            # status
docker compose logs -f       # follow logs
docker compose down          # stop
docker compose up -d         # start
```

See [Environment variables](/docs/environment) for the values in the generated `.env`,
or [Windows Server (WSL2)](/docs/windows-server) to deploy on Windows Server.

## Install from source (for development)

Run OpenLDR from source with the developer bootstrap. It clones the repo, installs
dependencies, starts the backing services, initializes the database, and prints how to
launch the dev servers.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Requires git, Node.js 20+, pnpm (or Corepack), and Docker. Then start the app in two
terminals: `pnpm -C apps/server dev` and `pnpm -C apps/studio dev` (Studio UI on
http://localhost:5173).
