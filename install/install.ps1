# OpenLDR CE one-line installer (Windows PowerShell).
#   irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.ps1 | iex
param(
  [string]$Dir = "./openldr",
  [string]$Version = "latest",
  [switch]$NoStart,
  [switch]$NoPull
)
$ErrorActionPreference = "Stop"
$RepoRaw = "https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main"

function Die($m) { Write-Error "X $m"; exit 1 }

# 1. Preflight
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed. See https://docs.docker.com/get-docker/" }
docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose plugin not found. Update Docker Desktop." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker daemon is not running. Start Docker Desktop and retry." }

# 2. Scaffold
Write-Host "-> Scaffolding $Dir"
New-Item -ItemType Directory -Force -Path "$Dir/config/nginx/certs","$Dir/config/keycloak" | Out-Null
function Fetch($rel, $out) { Invoke-WebRequest -UseBasicParsing "$RepoRaw/$rel" -OutFile $out }
Fetch "deploy/install/docker-compose.yml" "$Dir/docker-compose.yml"
Fetch "deploy/nginx/openldr.conf.template" "$Dir/config/nginx/openldr.conf.template"
Fetch "infra/keycloak/openldr-realm.json" "$Dir/config/keycloak/openldr-realm.json"
Fetch "scripts/init-target-db.sql" "$Dir/config/init-target-db.sql"

# 3. Secrets + cert (never overwrite an existing .env)
function Rand { -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }) }
$envPath = "$Dir/.env"
if (-not (Test-Path $envPath)) {
  $pg = Rand; $kc = Rand; $s3k = Rand; $s3s = Rand
  @"
OPENLDR_VERSION=$Version
SERVER_NAME=localhost
PORT=3000
NODE_ENV=production
INTERNAL_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr
TARGET_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr_target
POSTGRES_PASSWORD=$pg
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$s3k
S3_SECRET_ACCESS_KEY=$s3s
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=http://host.docker.internal:8180/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$kc
"@ | Out-File -FilePath $envPath -Encoding ascii
  Write-Host "-> Wrote $envPath (generated secrets)"
} else {
  Write-Host "-> Reusing existing $envPath"
}

$cert = "$Dir/config/nginx/certs/fullchain.pem"
if (-not (Test-Path $cert)) {
  if (Get-Command openssl -ErrorAction SilentlyContinue) {
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout "$Dir/config/nginx/certs/privkey.pem" -out $cert `
      -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>$null
    Write-Host "-> Generated self-signed cert"
  } else {
    Write-Host "! openssl not found — provide certs in $Dir/config/nginx/certs/"
  }
}

# 4. Start
if ($NoStart) { Write-Host "OK Scaffolded $Dir (-NoStart). Run: cd $Dir; docker compose up -d"; exit 0 }
Push-Location $Dir
if (-not $NoPull) { docker compose pull }
docker compose up -d
Pop-Location
Write-Host ""
Write-Host "OK OpenLDR is starting. Open https://localhost"
