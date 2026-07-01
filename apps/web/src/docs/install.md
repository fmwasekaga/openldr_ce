# Install

Run the one-line installer:

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.ps1 | iex
```

The installer creates an `openldr/` directory, generates secrets, pulls the
images, and starts the stack. When it finishes it prints the URL and the
generated admin credentials.

## Install from source (for development)

While the published images aren't available yet, run OpenLDR from source with
the developer bootstrap. It clones the repo, installs dependencies, starts the
backing services, initializes the database, and prints how to launch the dev
servers.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/development.ps1 | iex
```

Requires git, Node.js 20+, pnpm (or Corepack), and Docker. Then start the app in
two terminals: `pnpm -C apps/server dev` and `pnpm -C apps/studio dev` (Studio UI
on http://localhost:5173).

