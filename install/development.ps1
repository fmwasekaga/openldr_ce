# OpenLDR CE developer bootstrap (Windows PowerShell): clone + install + services + DB.
# For running from SOURCE while the published images aren't available yet.
#   irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/development.ps1 | iex
# Flags:
#   -Dir <path>     where to clone (default ./openldr_ce)
#   -Branch <name>  branch to clone (default main)
#   -Seed           also load WHONET sample data (needs the wasm build toolchain)
#   -ResetDb        force a db reset even on an existing setup (DESTRUCTIVE)
#   -NoServices     just clone + install; skip Docker + DB
param(
  [string]$Dir = "./openldr_ce",
  [string]$Branch = "main",
  [switch]$Seed,
  [switch]$ResetDb,
  [switch]$NoServices
)
$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/fmwasekaga/openldr_ce.git"

function Die($m) { Write-Error "X $m"; exit 1 }

# 1. Preflight
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git is not installed." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js >=20 is not installed. See https://nodejs.org/" }
$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Die "Node.js >=20 required (found $(node -v))." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) { Write-Host "-> Enabling pnpm via corepack"; corepack enable *> $null }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Die "pnpm not found. See https://pnpm.io/installation (or run: corepack enable)." }
}
if (-not $NoServices) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed (needed for backing services). Use -NoServices to skip." }
  docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose plugin not found. Update Docker Desktop." }
  docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker daemon is not running. Start Docker Desktop and retry." }
}

# 2. Clone (or reuse an existing checkout)
if ((Test-Path package.json) -and ((node -p "require('./package.json').name") -eq 'openldr')) {
  Write-Host "-> Running inside an existing openldr checkout - skipping clone"
  $repoDir = (Get-Location).Path
} elseif (Test-Path "$Dir/.git") {
  Write-Host "-> Reusing existing clone at $Dir"
  $repoDir = $Dir
} else {
  Write-Host "-> Cloning $RepoUrl ($Branch) into $Dir"
  git clone --branch $Branch $RepoUrl $Dir
  if ($LASTEXITCODE -ne 0) { Die "git clone failed" }
  $repoDir = $Dir
}
Set-Location $repoDir

# 3. Install workspace dependencies
Write-Host "-> pnpm install"
pnpm install
if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }

# 4. .env - dev bypass so the app is usable without configuring Keycloak SSO.
#    .env.example already sets NODE_ENV=development; we only add AUTH_DEV_BYPASS.
$freshEnv = $false
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Add-Content -Path .env -Value "`n# --- added by development.ps1: no-login dev mode (remove to use real Keycloak) ---`nAUTH_DEV_BYPASS=true"
  $freshEnv = $true
  Write-Host "-> Wrote .env (dev bypass enabled - loads as a dev admin)"
} else {
  Write-Host "-> Reusing existing .env"
}

if ($NoServices) {
  Write-Host "-> Skipping Docker services + DB (-NoServices)"
} else {
  # 5. Backing services (dev docker-compose.yml: postgres, minio, keycloak)
  Write-Host "-> Starting backing services (postgres, minio, keycloak)"
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }

  # 6. DB init - only on a fresh setup so a re-run never wipes data; -ResetDb forces it.
  if ($freshEnv -or $ResetDb) {
    Write-Host "-> Waiting for Postgres to be ready..."
    for ($i = 0; $i -lt 30; $i++) {
      docker compose exec -T postgres pg_isready -U openldr *> $null
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep 2
    }
    Write-Host "-> Resetting the database (pnpm openldr db reset)"
    pnpm openldr db reset
    if ($LASTEXITCODE -ne 0) { Die "db reset failed" }
    if ($Seed) {
      Write-Host "-> Seeding WHONET sample data (pnpm e2e:seed)"
      pnpm e2e:seed
      if ($LASTEXITCODE -ne 0) { Die "seed failed" }
    }
  } else {
    Write-Host "-> Skipping db reset (existing setup; pass -ResetDb to wipe & re-init)"
  }
}

# 7. Next steps
Write-Host ""
Write-Host "OK Dev environment ready in $repoDir"
Write-Host "Start the app in two terminals:"
Write-Host "  1) pnpm -C apps/server dev      # API on http://localhost:3000"
Write-Host "  2) pnpm -C apps/studio dev      # Studio UI on http://localhost:5173 (proxies /api)"
Write-Host "Backing services: Postgres :5433, MinIO :9010/:9011, Keycloak :8180"
Write-Host "Auth: AUTH_DEV_BYPASS is on (loads as a dev admin). Edit .env to use real Keycloak."
