# Requirements

OpenLDR ships as a set of **Linux** container images and runs anywhere Docker with the
Compose plugin is available.

## Software

- **Docker** 24+ with the Compose plugin (`docker compose`).
- **OpenSSL** (for the self-signed certificate the installer generates). Present by
  default on Linux and macOS.
- **curl** (Linux/macOS) or PowerShell 5+ (Windows) to run the one-line installer.

## Hardware

- **4 GB RAM** free (8 GB recommended once terminology and dashboards are loaded).
- **~5 GB disk** for images and volumes; allow **20 GB+** for a working lab with
  terminology, uploads, and analytics data.
- 2 CPU cores minimum.

## Platforms

- **Linux** — the primary target. Any modern distribution with Docker Engine.
- **macOS** — via Docker Desktop.
- **Windows** — Windows 10/11 with Docker Desktop, or **Windows Server via WSL2**.

> **Windows Server:** Docker Desktop is **not** supported on Windows Server, and the
> native Docker engine only runs Windows containers. The supported path is **Docker CE
> inside a WSL2 Ubuntu distro**, which needs Windows Server **2022 (fully patched)** or
> **2025**. Server 2019 cannot run the modern WSL2 stack. See
> [Windows Server (WSL2)](/docs/windows-server) for the full procedure.

## Network

- A public **domain name** pointing at the host, plus inbound **TCP 80 and 443**, if
  you want a trusted (Let's Encrypt) certificate. Without these the installer falls back
  to a self-signed certificate, which is fine for a local or lab install.
