# Getting started

## 1. Install

If you have not installed yet, run the one-line installer on a host with Docker. It
generates every secret, brings the stack up on `https://localhost` with a self-signed
certificate, and prints the URL and admin credentials. Full options are on the
[Install](/docs/install) page.

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Sign in

After installing, open the printed URL in your browser and sign in with the
generated admin credentials. From there you can install plugins, build
workflows, configure connectors, and [load your first data](/docs/load-data).

To stop or start the stack later, run `docker compose down` / `docker compose up -d`
from inside the `openldr/` directory the installer created.

## Going further

- [Development](/docs/development) — run OpenLDR from source with hot reload.
- [Command-line interface (CLI)](/docs/cli) — the `openldr` operator command line.
- [Environment variables](/docs/environment) — configure a deployment.
