#!/usr/bin/env bash
# Build and push the OpenLDR CE images to GHCR (GitHub Container Registry).
#   ./scripts/build-and-push.sh                      # ghcr.io/open-laboratory-data-repository/*, :latest + :<version>, push
#   ./scripts/build-and-push.sh --registry myorg
#   ./scripts/build-and-push.sh --tag rc1
#   ./scripts/build-and-push.sh --platform linux/amd64,linux/arm64
#   ./scripts/build-and-push.sh --no-push            # build + load locally, don't push
#   ./scripts/build-and-push.sh --dry-run             # print commands only
# Must be run from the repo root.
set -euo pipefail

REGISTRY="${DOCKER_REGISTRY:-ghcr.io/open-laboratory-data-repository}"
TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
DRY_RUN=false
PUSH=true

while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --tag)      TAG="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --no-push)  PUSH=false; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    -h|--help)  echo "Usage: $0 [--registry <org>] [--tag <tag>] [--platform <p>] [--no-push] [--dry-run]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ -f package.json ] && [ -d apps ] || { echo "ERROR: run from the repo root" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

OUT="--push"
[ "$PUSH" = true ] || OUT="--load"

run() { echo "+ $*"; [ "$DRY_RUN" = true ] || "$@"; }

# name -> "dockerfile context" (context defaults to repo root '.')
build_one() {
  name="$1"; dockerfile="$2"; context="$3"
  echo "--- $name ---"
  run docker buildx build --platform "$PLATFORM" \
    -t "$REGISTRY/$name:$TAG" -t "$REGISTRY/$name:$VERSION" \
    -f "$dockerfile" $OUT "$context"
}

echo "Registry=$REGISTRY  Tag=$TAG(+$VERSION)  Platform=$PLATFORM  Push=$PUSH  DryRun=$DRY_RUN"
build_one openldr-api     apps/server/Dockerfile .
build_one openldr-studio  apps/studio/Dockerfile .
build_one openldr-web     apps/web/Dockerfile    .
build_one openldr-gateway  deploy/nginx/Dockerfile     deploy/nginx
build_one openldr-keycloak deploy/keycloak/Dockerfile  deploy/keycloak
echo "Done. Images: $REGISTRY/openldr-{api,studio,web,gateway,keycloak}:{$TAG,$VERSION}"
