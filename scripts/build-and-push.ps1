#!/usr/bin/env pwsh
# Build and push the OpenLDR CE images to Docker Hub (Windows).
#   ./scripts/build-and-push.ps1 [-Registry fmwasekaga] [-Tag latest] [-Platform linux/amd64] [-NoPush] [-DryRun]
param(
  [string]$Registry = "fmwasekaga",
  [string]$Tag = "latest",
  [string]$Platform = "linux/amd64",
  [switch]$NoPush,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path package.json) -or -not (Test-Path apps)) { throw "run from the repo root" }
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$Out = if ($NoPush) { "--load" } else { "--push" }

function Build-One($name, $dockerfile, $context) {
  Write-Host "--- $name ---"
  $args = @("buildx","build","--platform",$Platform,
            "-t","$Registry/$name`:$Tag","-t","$Registry/$name`:$Version",
            "-f",$dockerfile,$Out,$context)
  Write-Host "+ docker $($args -join ' ')"
  if (-not $DryRun) { & docker @args }
}

Write-Host "Registry=$Registry Tag=$Tag(+$Version) Platform=$Platform NoPush=$NoPush DryRun=$DryRun"
Build-One "openldr-api"     "apps/server/Dockerfile" "."
Build-One "openldr-studio"  "apps/studio/Dockerfile" "."
Build-One "openldr-web"     "apps/web/Dockerfile"    "."
Build-One "openldr-gateway" "deploy/nginx/Dockerfile" "deploy/nginx"
Write-Host "Done. Images: $Registry/openldr-{api,studio,web,gateway}:{$Tag,$Version}"
