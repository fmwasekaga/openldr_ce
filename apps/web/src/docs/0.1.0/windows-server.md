# Windows Server (WSL2)

OpenLDR ships **Linux** container images. Windows Server cannot run them natively — the
native Docker engine only runs Windows containers, and **Docker Desktop is not
supported on Windows Server**. The supported path is **Docker CE running inside a WSL2
Ubuntu distro**.

## Supported versions

| Windows Server | WSL2 + systemd | Notes |
| --- | --- | --- |
| **2025** | ✅ Works off the shelf | A single `wsl --install`. |
| **2022** | ✅ After patching | Patch off RTM `20348.0` to a current cumulative, reboot, then `wsl --update`. |
| **2019** | ❌ Not viable | The modern packaged WSL / systemd will not install. |

**Success signals** inside the distro: `uname -r` ends in `-microsoft-standard-WSL2`
(not `4.4.0`), and `ps -p 1 -o comm=` prints `systemd`.

## 1. Install WSL2

In an **admin PowerShell** on the server (2022 patched, or 2025):

```powershell
wsl.exe --install     # enables components, installs the WSL2 kernel + Ubuntu
```

Reboot when prompted. On the first Ubuntu launch, create a UNIX username and password.

**On Server 2022**, if this errors with `WSL_E_OS_NOT_SUPPORTED` or `wsl --update` just
prints a link, the build is too old. Patch Windows to a current cumulative, reboot, and
re-run. Check the build with:

```powershell
[System.Environment]::OSVersion.Version    # RTM 10.0.20348.0 is too old; want 20348.2xxx+
```

## 2. Enable systemd (required before Docker)

Inside the Ubuntu (WSL2) shell:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then from PowerShell run `wsl --shutdown`, wait ~10 seconds, and reopen Ubuntu. Verify:

```bash
uname -r            # ...-microsoft-standard-WSL2
ps -p 1 -o comm=    # systemd
```

## 3. Install Docker CE

Inside Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
# The script prints "WSL DETECTED: use Docker Desktop" and pauses — ignore it.
# Docker Desktop is NOT supported on Windows Server; Docker CE in the distro is correct.
sudo usermod -aG docker $USER
exec su -l $USER                     # reload group membership

sudo systemctl enable --now docker   # persistent because systemd is on
docker info --format '{{.OSType}}'   # must print: linux
docker compose version               # v2 plugin ships with the script
```

> Work under your Linux home (`~`), **never** under `/mnt/c/...` — the Windows bridge is
> slow and hurts Docker badly.

## 4. Install OpenLDR

Now you are on a real Linux Docker host — run the standard one-line installer.

**Local / self-signed:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Public domain + trusted TLS:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

See [Install](/docs/install) for all installer flags. Verify the stack is up:

```bash
docker compose ps            # all Up / healthy
curl -I http://localhost/    # app responds on the server itself
```

## Reaching OpenLDR from other machines

WSL2 forwards only the guest's **loopback** into the distro, so `localhost` works on the
server itself but the server's LAN address does not reach the stack by default. Two
options:

- **Mirrored networking** (simplest, needs a recent WSL): add `networkingMode=mirrored`
  under `[wsl2]` in `%USERPROFILE%\.wslconfig`, then `wsl --shutdown`. Some 2022 builds
  fall back to NAT and report "mirrored mode not supported" — use the port proxy below
  instead.
- **Port proxy** — in admin PowerShell, forward the gateway ports (80/443) from the
  server to the WSL2 IP:
  ```powershell
  $wslip = (wsl hostname -I).Trim().Split(' ')[0]
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 `
    connectport=443 connectaddress=$wslip
  New-NetFirewallRule -DisplayName "OpenLDR 443" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 443 -Profile Any
  ```

> **The WSL2 IP changes on restart.** Re-run the port-proxy command after any
> `wsl --shutdown` or reboot — ideally from a logon scheduled task — or the proxy points
> at a dead address.
