#!/usr/bin/env bash
# Isolated GJS network lifecycle/cache checks plus real GNOME provider-routing tests.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$ROOT/build/network"
CACHE=$(mktemp -d "$ROOT/build/network/cache.XXXXXX")
trap 'rm -rf -- "$CACHE"' EXIT
XDG_CACHE_HOME="$CACHE" gjs -m "$ROOT/tests/network-platform-test.js" | tee "$ROOT/build/network/platform.json"
bash "$ROOT/scripts/smoke-shell.sh" clock --script "$ROOT/tests/smoke/scripts/network-region.js" --out "$ROOT/build/smoke/network-region"
