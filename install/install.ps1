# OpenLDR CE one-line installer (Windows PowerShell).
#   irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
# Flags (download the script first to pass these  -  see bottom of this file):
#   -Dir <path>        install dir (default ./openldr)
#   -Version <tag>      image tag (default latest)
#   -ServerName <host>  public hostname (default localhost)
#   -HttpPort <n>       gateway HTTP port (default 80)
#   -HttpsPort <n>      gateway HTTPS port (default 443)
#   -NoStart / -NoPull
param(
  [string]$Dir = "./openldr",
  [string]$Version = "latest",
  [string]$ServerName = "localhost",
  [string]$Letsencrypt = "",
  [int]$HttpPort = 80,
  [int]$HttpsPort = 443,
  [switch]$NoStart,
  [switch]$NoPull
)
$ErrorActionPreference = "Stop"
$RepoRaw = "https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main"
$envPath = "$Dir/.env"

# An existing .env (from a prior run in this dir) is never overwritten below, so its
# GATEWAY_*_PORT/SERVER_NAME are what will actually be used  -  adopt them instead of
# re-deriving from (possibly stale/different) CLI args, so everything we compute from
# here on (Origin, redirect registration, port-conflict check) matches reality.
$envExists = Test-Path $envPath
if ($envExists) {
  $existingEnv = Get-Content $envPath -Raw
  if ($existingEnv -match '(?m)^GATEWAY_HTTP_PORT=(\d+)')     { $HttpPort   = [int]$Matches[1] }
  if ($existingEnv -match '(?m)^GATEWAY_HTTPS_PORT=(\d+)')    { $HttpsPort  = [int]$Matches[1] }
  if ($existingEnv -match '(?m)^SERVER_NAME=(.+?)\s*$')       { $ServerName = $Matches[1].Trim() }
}
if ($HttpsPort -eq 443) { $Origin = "https://$ServerName" } else { $Origin = "https://${ServerName}:$HttpsPort" }

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

# Port-conflict detection  -  fail fast with remediation instead of a confusing failure
# deep inside `docker compose up`. Only for fresh installs: if .env already exists,
# $HttpPort/$HttpsPort above were adopted from it, so "in use" almost certainly means
# this same install's own (already running) stack, not a real conflict.
function Test-PortInUse([int]$Port) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
    $listener.Start()
    $listener.Stop()
    return $false
  } catch [System.Net.Sockets.SocketException] {
    return $true
  } catch {
    return $false
  }
}
if (-not $envExists) {
  foreach ($p in ($HttpPort, $HttpsPort | Select-Object -Unique)) {
    if (Test-PortInUse $p) {
      Die "Port $p is already in use by another process/service. Free it, or install to different ports, e.g.:`n    -HttpPort 8080 -HttpsPort 8443`n  (download install.ps1 and run it locally with those flags  -  the irm|iex one-liner can't take params)."
    }
  }
}

# 2. Scaffold
Write-Host "-> Scaffolding $Dir"
New-Item -ItemType Directory -Force -Path "$Dir/config/nginx/certs","$Dir/config/keycloak" | Out-Null
function Fetch($rel, $out) { Invoke-WebRequest -UseBasicParsing "$RepoRaw/$rel" -OutFile $out }
Fetch "deploy/install/docker-compose.yml" "$Dir/docker-compose.yml"
Fetch "infra/keycloak/openldr-realm.json" "$Dir/config/keycloak/openldr-realm.json"
Fetch "scripts/init-target-db.sql" "$Dir/config/init-target-db.sql"

# Register this deploy's origin as a valid OIDC redirect so studio login works behind the gateway.
# The shipped realm lists localhost + dev URLs; a non-localhost host (or a non-default port) must be
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
if (-not $envExists) {
  $pg = Rand; $kc = Rand; $s3k = Rand; $s3s = Rand
  $secretBytes = New-Object 'System.Byte[]' 32
  $rngKey = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rngKey.GetBytes($secretBytes) } finally { $rngKey.Dispose() }
  $secretsKey = [Convert]::ToBase64String($secretBytes)

  # COMPOSE_PROJECT_NAME: Compose's own default (the install dir's leaf name) collides
  # whenever two installs share a leaf dir name (e.g. two "./openldr" installs from
  # different parent paths on the same Docker host). Derive a name that is stable for
  # THIS install dir but unique across install dirs: leaf name + a short hash of the
  # resolved absolute path.
  # Resolve-Path (not Join-Path+GetFullPath) so this works whether $Dir is relative
  # or already absolute  -  the dir exists on disk by now (created in step 2 above).
  $resolvedDir = (Resolve-Path -LiteralPath $Dir).Path
  $leaf = (Split-Path -Leaf $resolvedDir).ToLower() -replace '[^a-z0-9_-]', '-'
  $leaf = $leaf.Trim('-')
  if ([string]::IsNullOrWhiteSpace($leaf)) { $leaf = "openldr" }
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try { $hashBytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($resolvedDir.ToLower())) } finally { $md5.Dispose() }
  $hashHex = -join ($hashBytes[0..3] | ForEach-Object { $_.ToString("x2") })
  $projectName = "$leaf-$hashHex"

  @"
OPENLDR_VERSION=$Version
SERVER_NAME=$ServerName
PUBLIC_ORIGIN=$Origin
GATEWAY_HTTP_PORT=$HttpPort
GATEWAY_HTTPS_PORT=$HttpsPort
COMPOSE_PROJECT_NAME=$projectName
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
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main
"@ | Out-File -FilePath $envPath -Encoding ascii
  # Lock the secrets file down to the current user (drop inherited ACLs).
  icacls $envPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" *> $null
  Write-Host "-> Wrote $envPath (generated secrets, compose project '$projectName')"
} else {
  Write-Host "-> Reusing existing $envPath"
}

$certDir = "$Dir/config/nginx/certs"
$cert = "$certDir/fullchain.pem"
$key = "$certDir/privkey.pem"
if (-not (Test-Path $cert)) {
  if (Get-Command openssl -ErrorAction SilentlyContinue) {
    # OpenSSL writes its progress dots/status to stderr. Under Windows PowerShell 5.1,
    # a native command writing to stderr becomes a terminating NativeCommandError when
    # $ErrorActionPreference = "Stop" is in effect (as it is for this whole script)  - 
    # even though the cert files are produced successfully. Temporarily relax it around
    # just this call, capture stderr into a variable instead of losing it, and decide
    # success from $LASTEXITCODE + whether both output files actually exist.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $opensslOutput = & openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout $key -out $cert `
      -subj "/CN=$ServerName" -addext "subjectAltName=DNS:$ServerName,DNS:localhost,IP:127.0.0.1" 2>&1
    $opensslExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($opensslExit -eq 0 -or ((Test-Path $cert) -and (Test-Path $key))) {
      Write-Host "-> Generated self-signed cert"
    } else {
      Write-Host "! openssl failed (exit $opensslExit) and no cert was produced:"
      $opensslOutput | ForEach-Object { Write-Host "    $_" }
      Write-Host "! Provide certs manually in $certDir/ (fullchain.pem + privkey.pem)."
    }
  } else {
    Write-Host "! openssl not found on PATH  -  provide certs in $certDir/ (fullchain.pem + privkey.pem)."
    Write-Host "  (Git for Windows bundles openssl; or install it separately and re-run.)"
  }
}

# 4. Start
if ($NoStart) { Write-Host "OK Scaffolded $Dir (-NoStart). Run: cd $Dir; docker compose up -d"; exit 0 }
Push-Location $Dir
try {
  # $ErrorActionPreference=Stop does NOT catch native exit codes, so check them
  # explicitly  -  otherwise a failed pull/up would still print the success banner.
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
if ($HttpPort -ne 80 -or $HttpsPort -ne 443) { Write-Host "   Gateway ports: HTTP $HttpPort / HTTPS $HttpsPort" }
Write-Host ""
Write-Host "   For a public domain, install with: -ServerName your.domain.com"
Write-Host "   For non-default ports, install with: -HttpPort 8080 -HttpsPort 8443"
Write-Host "   For trusted TLS, drop fullchain.pem + privkey.pem into config/nginx/certs/"
Write-Host "   (the generated cert is self-signed) and re-run: docker compose up -d"
