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
