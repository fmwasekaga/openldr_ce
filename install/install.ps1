# OpenLDR CE one-line installer (Windows PowerShell).
#   irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
# Flags (download the script first to pass these  -  see bottom of this file):
#   -Dir <path>        install dir (default ./openldr)
#   -Version <tag>      image tag (default latest)
#   -ServerName <host>  public hostname (default localhost)
#   -HttpPort <n>       gateway HTTP port (default 80)
#   -HttpsPort <n>      gateway HTTPS port (default 443)
#   -NoStart / -NoPull
#   -TargetDb postgres|mssql|mysql (default postgres  -  selects the external analytics/target DB)
#   -MssqlDemo (spin up a bundled MSSQL container for evaluation; implies -TargetDb mssql)
#   -MssqlHost/-MssqlPort/-MssqlDatabase/-MssqlUser/-MssqlPassword (BYO MSSQL connection  -
#     required when -TargetDb mssql without -MssqlDemo; keep the password free of '#', spaces,
#     or quote characters  -  they confuse Docker Compose's .env reader)
#   -MssqlEncrypt true|false (default false), -MssqlTrustCert true|false (default true)
#   -MysqlDemo (spin up a bundled MySQL container for evaluation; implies -TargetDb mysql)
#   -MysqlHost/-MysqlPort/-MysqlDatabase/-MysqlUser/-MysqlPassword (BYO MySQL connection  -
#     required when -TargetDb mysql without -MysqlDemo; keep the password free of '#', spaces,
#     or quote characters  -  they confuse Docker Compose's .env reader)
#   -MysqlSsl true|false (default false)
param(
  [string]$Dir = "./openldr",
  [string]$Version = "latest",
  [string]$ServerName = "localhost",
  [string]$Letsencrypt = "",
  [int]$HttpPort = 80,
  [int]$HttpsPort = 443,
  [switch]$NoStart,
  [switch]$NoPull,
  [ValidateSet('postgres','mssql','mysql')]
  [string]$TargetDb = 'postgres',
  [switch]$MssqlDemo,
  [string]$MssqlHost = '',
  [string]$MssqlPort = '1433',
  [string]$MssqlDatabase = 'openldr_target',
  [string]$MssqlUser = '',
  [string]$MssqlPassword = '',
  [ValidateSet('true','false')]
  [string]$MssqlEncrypt = 'false',
  [ValidateSet('true','false')]
  [string]$MssqlTrustCert = 'true',
  [switch]$MysqlDemo,
  [string]$MysqlHost = '',
  [string]$MysqlPort = '3306',
  [string]$MysqlDatabase = 'openldr_target',
  [string]$MysqlUser = '',
  [string]$MysqlPassword = '',
  [ValidateSet('true','false')]
  [string]$MysqlSsl = 'false'
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
  if ($existingEnv -match '(?m)^TARGET_STORE_ADAPTER=(.+?)\s*$') {
    $existingAdapter = $Matches[1].Trim()
    if ($existingAdapter -eq 'mssql') {
      $TargetDb = 'mssql'
      if ($existingEnv -match '(?m)^MSSQL_HOST=(.+?)\s*$') {
        $existingMssqlHost = $Matches[1].Trim()
        $MssqlHost = $existingMssqlHost
        # host 'mssql' is the managed-demo signature -> re-enable the overlay on re-runs
        if ($existingMssqlHost -eq 'mssql') { $MssqlDemo = $true }
      }
    }
    if ($existingAdapter -eq 'mysql') {
      $TargetDb = 'mysql'
      if ($existingEnv -match '(?m)^MYSQL_HOST=(.+?)\s*$') {
        $existingMysqlHost = $Matches[1].Trim()
        $MysqlHost = $existingMysqlHost
        # host 'mysql' is the managed-demo signature -> re-enable the overlay on re-runs
        if ($existingMysqlHost -eq 'mysql') { $MysqlDemo = $true }
      }
    }
  }
}
if ($HttpsPort -eq 443) { $Origin = "https://$ServerName" } else { $Origin = "https://${ServerName}:$HttpsPort" }

if ($MssqlDemo) { $TargetDb = 'mssql' }
if ($MysqlDemo) { $TargetDb = 'mysql' }

# Managed-demo MSSQL: point the app at the bundled 'mssql' compose service and (below) generate a
# policy-compliant SA password. Developer/Express editions are NOT licensed for production  -  this
# container is for evaluation only.
if ($MssqlDemo) {
  $MssqlHost = 'mssql'
  $MssqlPort = '1433'
  $MssqlDatabase = 'openldr_target'
  $MssqlUser = 'sa'
  $MssqlEncrypt = 'false'
  $MssqlTrustCert = 'true'
}

# Managed-demo MySQL: point the app at the bundled 'mysql' compose service and (below) generate a
# root password. For evaluation only.
if ($MysqlDemo) {
  $MysqlHost = 'mysql'
  $MysqlPort = '3306'
  $MysqlDatabase = 'openldr_target'
  $MysqlUser = 'root'
  $MysqlSsl = 'false'
}

# BYO MSSQL: require connection details before writing .env / starting the stack.
# Fresh install only  -  on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if ((-not $envExists) -and ($TargetDb -eq 'mssql') -and (-not $MssqlDemo)) {
  if ([string]::IsNullOrEmpty($MssqlHost) -or [string]::IsNullOrEmpty($MssqlUser) -or [string]::IsNullOrEmpty($MssqlPassword)) {
    Write-Error "X -TargetDb mssql (BYO) requires -MssqlHost, -MssqlUser, and -MssqlPassword. The target database '$MssqlDatabase' must already exist on your SQL Server."
    exit 2
  }
}

# BYO MySQL: require connection details before writing .env / starting the stack.
# Fresh install only  -  on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if ((-not $envExists) -and ($TargetDb -eq 'mysql') -and (-not $MysqlDemo)) {
  if ([string]::IsNullOrEmpty($MysqlHost) -or [string]::IsNullOrEmpty($MysqlUser) -or [string]::IsNullOrEmpty($MysqlPassword)) {
    Write-Error "X -TargetDb mysql (BYO) requires -MysqlHost, -MysqlUser, and -MysqlPassword. The target database '$MysqlDatabase' must already exist on your MySQL/MariaDB server."
    exit 2
  }
}

if ($Letsencrypt) {
  Write-Host "! Let's Encrypt is only automated by the Linux installer (install.sh --letsencrypt)."
  Write-Host "  On Windows the cert is self-signed; for public TLS run install.sh on the server, or"
  Write-Host "  drop a real fullchain.pem + privkey.pem into $Dir/config/nginx/certs/ and restart."
}

function Die($m) { Write-Error "X $m"; exit 1 }

# Run a native process with stdout/stderr redirected to temp files, then echo them as plain
# text. Because the child writes to FILES rather than PowerShell's streams, its stderr/progress
# (Docker Compose's "... Pulling/Creating") can never be turned into a NativeCommandError
# record  -  so a successful install's console AND Start-Transcript output stay clean under
# Windows PowerShell 5.1 (a bare `& docker ...`, even with 2>&1, still logs those records).
# Success is decided strictly from the process exit code.
function Invoke-NativeProcessChecked([string]$FilePath, [string[]]$ArgumentList, [string]$ErrorMessage, [string]$WorkingDirectory = (Get-Location).Path) {
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
      -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    Get-Content -LiteralPath $outFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    Get-Content -LiteralPath $errFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    if ($p.ExitCode -ne 0) { Die "$ErrorMessage (exit $($p.ExitCode))" }
  } finally {
    Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

# 1. Preflight
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed. See https://docs.docker.com/get-docker/" }
docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose plugin not found. Update Docker Desktop." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker daemon is not running. Start Docker Desktop and retry." }

# Port-conflict detection  -  fail fast with remediation instead of a confusing failure
# deep inside `docker compose up`. Only for fresh installs: if .env already exists,
# $HttpPort/$HttpsPort above were adopted from it, so "in use" almost certainly means
# this same install's own (already running) stack, not a real conflict.
function Test-PortInUse([int]$Port) {
  # Get-NetTCPConnection catches listeners that Docker Desktop / the WSL relay publish
  # on :: and 0.0.0.0 that a fresh TcpListener bind on 0.0.0.0 can miss (a second
  # default-port install would otherwise scaffold instead of detecting the conflict).
  # Fall back to TcpListener only where the cmdlet is unavailable.
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { return $true }
    return $false
  }
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
if ($MssqlDemo) {
  Fetch "deploy/install/docker-compose.mssql.yml" "$Dir/docker-compose.mssql.yml"
  Fetch "scripts/init-target-db-mssql.sql" "$Dir/config/init-target-db-mssql.sql"
}
if ($MysqlDemo) {
  Fetch "deploy/install/docker-compose.mysql.yml" "$Dir/docker-compose.mysql.yml"
  Fetch "scripts/init-target-db-mysql.sql" "$Dir/config/init-target-db-mysql.sql"
}

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

# Pin the openldr-admin service-account secret in the realm import to a per-install value. The
# committed realm ships a well-known dev secret ("openldr-admin-dev-secret") that a real deployment
# must not use; without a matching KEYCLOAK_ADMIN_CLIENT_SECRET in .env the server's identity-admin
# actions (Distributed Sync site enrollment, password reset, force sign-out) fail with a 503. Generate
# one -- reusing the existing .env value on a re-run so the on-disk import stays consistent with what
# the app authenticates with -- substitute it into the realm import, and write it to .env below.
$kcAdminSecret = $null
if ($envExists) {
  $existingKcLine = (Select-String -Path $envPath -Pattern '^KEYCLOAK_ADMIN_CLIENT_SECRET=').Line
  if ($existingKcLine) { $kcAdminSecret = $existingKcLine -replace '^KEYCLOAK_ADMIN_CLIENT_SECRET=', '' }
}
if (-not $kcAdminSecret) { $kcAdminSecret = Rand }
$realmSecretContent = (Get-Content $realmPath -Raw) -replace 'openldr-admin-dev-secret', $kcAdminSecret
Set-Content -Path $realmPath -Value $realmSecretContent -Encoding ascii

if (-not $envExists) {
  $pg = Rand; $kc = Rand; $s3k = Rand; $s3s = Rand
  if ($MssqlDemo -and [string]::IsNullOrEmpty($MssqlPassword)) { $MssqlPassword = "$(Rand)Aa1!" }
  if ($MysqlDemo -and [string]::IsNullOrEmpty($MysqlPassword)) { $MysqlPassword = "$(Rand)Aa1" }
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

  if ($TargetDb -eq 'mssql') {
    $targetDbEnvBlock = @"
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=$MssqlHost
MSSQL_PORT=$MssqlPort
MSSQL_DATABASE=$MssqlDatabase
MSSQL_USER=$MssqlUser
MSSQL_PASSWORD=$MssqlPassword
MSSQL_ENCRYPT=$MssqlEncrypt
MSSQL_TRUST_SERVER_CERT=$MssqlTrustCert
"@
  } elseif ($TargetDb -eq 'mysql') {
    $targetDbEnvBlock = @"
TARGET_STORE_ADAPTER=mysql
MYSQL_HOST=$MysqlHost
MYSQL_PORT=$MysqlPort
MYSQL_DATABASE=$MysqlDatabase
MYSQL_USER=$MysqlUser
MYSQL_PASSWORD=$MysqlPassword
MYSQL_SSL=$MysqlSsl
"@
  } else {
    $targetDbEnvBlock = @"
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr_target
"@
  }

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
# One reverse-proxy hop (the gateway) fronts the app: trust its X-Forwarded-For so req.ip and the
# auth.failed audit record the real client, not the gateway's container IP.
TRUST_PROXY=1
INTERNAL_DATABASE_URL=postgres://openldr:$pg@postgres:5432/openldr
$targetDbEnvBlock
POSTGRES_PASSWORD=$pg
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$s3k
S3_SECRET_ACCESS_KEY=$s3s
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=$Origin/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=$Origin/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$kc
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=$kcAdminSecret
TLS_CERT_PATH=/etc/openldr/tls-cert.pem
SECRETS_ENCRYPTION_KEY=$secretsKey
MIGRATE_ON_START=true
SEED_ON_START=true
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main
"@ | Out-File -FilePath $envPath -Encoding ascii
  # Lock the secrets file down to the current user (drop inherited ACLs). Grant Modify
  # (M) rather than just (R,W) so the same user can later delete the install dir during
  # cleanup  -  (R,W) omits the Delete right and makes `Remove-Item` fail on .env.
  icacls $envPath /inheritance:r /grant:r "$($env:USERNAME):(M)" *> $null
  Write-Host "-> Wrote $envPath (generated secrets, compose project '$projectName')"
} else {
  Write-Host "-> Reusing existing $envPath"
}

$certDir = "$Dir/config/nginx/certs"
$cert = "$certDir/fullchain.pem"
$key = "$certDir/privkey.pem"
if (-not (Test-Path $cert)) {
  # Docker is a verified prereq (preflight above), so a cert can always be produced:
  # use local openssl when present, otherwise a throwaway alpine/openssl container  -
  # this keeps the install zero-prereq on a machine that only has Docker.
  # Both openssl and docker write progress to stderr, which becomes a terminating
  # NativeCommandError under $ErrorActionPreference='Stop'; relax it around the call and
  # decide success from whether both cert files actually appear.
  $certDirAbs = (Resolve-Path -LiteralPath $certDir).Path
  $subj = "/CN=$ServerName"
  $san  = "subjectAltName=DNS:$ServerName,DNS:localhost,IP:127.0.0.1"
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if (Get-Command openssl -ErrorAction SilentlyContinue) {
      Write-Host "-> Generating self-signed cert (openssl)"
      $certOutput = & openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
        -keyout $key -out $cert -subj $subj -addext $san 2>&1
    } else {
      Write-Host "-> openssl not on PATH; generating cert via Docker (alpine/openssl)"
      $mount = $certDirAbs -replace '\\', '/'
      $certOutput = & docker run --rm -v "${mount}:/certs" alpine/openssl `
        req -x509 -newkey rsa:2048 -nodes -days 825 `
        -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj $subj -addext $san 2>&1
    }
  } finally { $ErrorActionPreference = $prevEAP }
  if ((Test-Path $cert) -and (Test-Path $key)) {
    Write-Host "-> Generated self-signed cert"
  } else {
    Write-Host "! Could not generate a self-signed cert automatically:"
    $certOutput | ForEach-Object { Write-Host "    $_" }
    Write-Host "! Provide certs in $certDir/ (fullchain.pem + privkey.pem) and re-run,"
    Write-Host "  or install openssl / ensure Docker is running."
  }
}

# 4. Start
if ($NoStart) { Write-Host "OK Scaffolded $Dir (-NoStart). Run: cd $Dir; docker compose up -d"; exit 0 }
Push-Location $Dir
try {
  # Run compose via Invoke-NativeProcessChecked (Start-Process + redirected files) so Docker's
  # stderr progress never becomes a NativeCommandError record on a successful install. Output is
  # buffered until each step finishes, so print a heads-up first ($PWD is $Dir under Push-Location).
  $ComposeFiles = @("-f", "docker-compose.yml")
  if ($MssqlDemo) { $ComposeFiles += @("-f", "docker-compose.mssql.yml") }
  if ($MysqlDemo) { $ComposeFiles += @("-f", "docker-compose.mysql.yml") }
  if (-not $NoPull) {
    Write-Host "-> Pulling images (first run can take a few minutes)..."
    Invoke-NativeProcessChecked "docker" (@("compose") + $ComposeFiles + @("pull")) "docker compose pull failed (are the images published + public? see RELEASE.md)"
  }
  Write-Host "-> Starting the stack..."
  Invoke-NativeProcessChecked "docker" (@("compose") + $ComposeFiles + @("up", "-d")) "docker compose up failed"
} finally { Pop-Location }
Write-Host ""
Write-Host "OK OpenLDR is starting. Open $Origin"
$kcLine = (Select-String -Path $envPath -Pattern '^KEYCLOAK_ADMIN_PASSWORD=').Line
if ($kcLine) { Write-Host "   Keycloak admin password: $($kcLine -replace '^KEYCLOAK_ADMIN_PASSWORD=','')" }
if ($MssqlDemo) {
  $mssqlLine = (Select-String -Path $envPath -Pattern '^MSSQL_PASSWORD=').Line
  if ($mssqlLine) { Write-Host "   MSSQL (demo) SA password: $($mssqlLine -replace '^MSSQL_PASSWORD=','')" }
  Write-Host "   ! The demo SQL Server container is for evaluation only -- not licensed for production."
}
if ($MysqlDemo) {
  $mysqlLine = (Select-String -Path $envPath -Pattern '^MYSQL_PASSWORD=').Line
  if ($mysqlLine) { Write-Host "   MySQL (demo) root password: $($mysqlLine -replace '^MYSQL_PASSWORD=','')" }
}
if ($HttpPort -ne 80 -or $HttpsPort -ne 443) { Write-Host "   Gateway ports: HTTP $HttpPort / HTTPS $HttpsPort" }
Write-Host "   Distributed Sync: identity-admin client provisioned (unique secret in .env) -- site enrollment is ready."
Write-Host ""
Write-Host "   For a public domain, install with: -ServerName your.domain.com"
Write-Host "   For non-default ports, install with: -HttpPort 8080 -HttpsPort 8443"
Write-Host "   For trusted TLS, drop fullchain.pem + privkey.pem into config/nginx/certs/"
Write-Host "   (the generated cert is self-signed) and re-run: docker compose up -d"
