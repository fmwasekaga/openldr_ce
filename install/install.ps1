# OpenLDR CE one-line installer (Windows PowerShell).
#   irm https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.ps1 | iex
param(
  [string]$Dir = "./openldr",
  [string]$Version = "latest",
  [string]$ServerName = "localhost",
  [string]$Letsencrypt = "",
  [switch]$NoStart,
  [switch]$NoPull
)
$ErrorActionPreference = "Stop"
$RepoRaw = "https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main"
$Origin = "https://$ServerName"
if ($Letsencrypt) {
  Write-Host "! Let's Encrypt is only automated by the Linux installer (install.sh --letsencrypt)."
  Write-Host "  On Windows the cert is self-signed; for public TLS run install.sh on the server, or"
  Write-Host "  drop a real fullchain.pem + privkey.pem into $Dir/config/nginx/certs/ and restart."
}

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
Fetch "infra/keycloak/openldr-realm.json" "$Dir/config/keycloak/openldr-realm.json"
Fetch "scripts/init-target-db.sql" "$Dir/config/init-target-db.sql"

# Register this deploy's origin as a valid OIDC redirect so studio login works behind the gateway.
# The shipped realm lists localhost + dev URLs; a non-localhost host (or https://localhost) must be
# added or Keycloak rejects the /studio/auth/callback redirect. webOrigins is already "+".
$realmPath = "$Dir/config/keycloak/openldr-realm.json"
$realm = Get-Content $realmPath -Raw
if ($realm -notmatch [regex]::Escape("`"$Origin/*`"")) {
  $realm = $realm -replace '"redirectUris":\s*\[', "`"redirectUris`": [`"$Origin/*`", "
  Set-Content -Path $realmPath -Value $realm -Encoding ascii
  Write-Host "-> Registered $Origin/* as an OIDC redirect in the realm"
}

# 3. Secrets + cert (never overwrite an existing .env)
# Use a cryptographic RNG (Get-Random is a clock-seeded PRNG, unfit for secrets)
# and sample WITH replacement so characters can repeat.
function Rand {
  $bytes = New-Object 'System.Byte[]' 24
  $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
$envPath = "$Dir/.env"
if (-not (Test-Path $envPath)) {
  $pg = Rand; $kc = Rand; $s3k = Rand; $s3s = Rand
  $secretBytes = New-Object 'System.Byte[]' 32
  $rngKey = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rngKey.GetBytes($secretBytes) } finally { $rngKey.Dispose() }
  $secretsKey = [Convert]::ToBase64String($secretBytes)
  @"
OPENLDR_VERSION=$Version
SERVER_NAME=$ServerName
PUBLIC_ORIGIN=$Origin
GATEWAY_HTTP_PORT=80
GATEWAY_HTTPS_PORT=443
TLS_MODE=self-signed
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
OIDC_ISSUER_URL=$Origin/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=$Origin/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$kc
SECRETS_ENCRYPTION_KEY=$secretsKey
MIGRATE_ON_START=true
SEED_ON_START=true
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/fmwasekaga/openldr-ce-marketplace/main
"@ | Out-File -FilePath $envPath -Encoding ascii
  # Lock the secrets file down to the current user (drop inherited ACLs).
  icacls $envPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" *> $null
  Write-Host "-> Wrote $envPath (generated secrets)"
} else {
  Write-Host "-> Reusing existing $envPath"
}

$cert = "$Dir/config/nginx/certs/fullchain.pem"
if (-not (Test-Path $cert)) {
  if (Get-Command openssl -ErrorAction SilentlyContinue) {
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout "$Dir/config/nginx/certs/privkey.pem" -out $cert `
      -subj "/CN=$ServerName" -addext "subjectAltName=DNS:$ServerName,DNS:localhost,IP:127.0.0.1" 2>$null
    Write-Host "-> Generated self-signed cert"
  } else {
    Write-Host "! openssl not found — provide certs in $Dir/config/nginx/certs/"
  }
}

# 4. Start
if ($NoStart) { Write-Host "OK Scaffolded $Dir (-NoStart). Run: cd $Dir; docker compose up -d"; exit 0 }
Push-Location $Dir
try {
  # $ErrorActionPreference=Stop does NOT catch native exit codes, so check them
  # explicitly — otherwise a failed pull/up would still print the success banner.
  if (-not $NoPull) {
    docker compose pull
    if ($LASTEXITCODE -ne 0) { Die "docker compose pull failed (is the image published yet? see RELEASE.md)" }
  }
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }
} finally { Pop-Location }
Write-Host ""
Write-Host "OK OpenLDR is starting. Open $Origin"
$kcLine = (Select-String -Path $envPath -Pattern '^KEYCLOAK_ADMIN_PASSWORD=').Line
if ($kcLine) { Write-Host "   Keycloak admin password: $($kcLine -replace '^KEYCLOAK_ADMIN_PASSWORD=','')" }
Write-Host ""
Write-Host "   For a public domain, install with: -ServerName your.domain.com"
Write-Host "   For trusted TLS, drop fullchain.pem + privkey.pem into config/nginx/certs/"
Write-Host "   (the generated cert is self-signed) and re-run: docker compose up -d"
