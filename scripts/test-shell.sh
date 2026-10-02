#!/usr/bin/env bash
# A completely separate bus, runtime, configuration and data directory.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# A stable UI language for visual assertions; test-i18n.sh overrides this.
export LC_ALL="${CG_TEST_LOCALE:-zh_CN.UTF-8}"
export LANG="$LC_ALL" LANGUAGE="${CG_TEST_LANGUAGE:-zh_CN}"
python3 "$ROOT/scripts/i18n.py" compile > /dev/null
mkdir -p "$ROOT/build"
exec 9>"$ROOT/build/shell.lock"
flock 9   # one headless shell at a time (shared with scripts/smoke-shell.sh)
python3 "$ROOT/scripts/make-fixtures.py"
python3 "$ROOT/scripts/import-original-assets.py" --check
RUN=$(mktemp -d "$ROOT/build/shell-test.XXXXXX")
mkdir -p "$RUN"/{data,config,cache,state,runtime,artifacts}
chmod 700 "$RUN/runtime"
UUID=classic-gadgets@qinyan.local
mkdir -p "$RUN/data/gnome-shell/extensions/$UUID" "$RUN/data/gnome-shell/extensions/classic-gadgets-test@local"
cp -a "$ROOT/extension/." "$RUN/data/gnome-shell/extensions/$UUID/"
cp -a "$ROOT/tests/driver/." "$RUN/data/gnome-shell/extensions/classic-gadgets-test@local/"
glib-compile-schemas --strict "$RUN/data/gnome-shell/extensions/$UUID/schemas"
printf '%s\n' "$RUN" > "$ROOT/build/last-shell-test"
echo "Isolated test directory: $RUN"
export CG_TEST_SOURCE="$ROOT" CG_TEST_OUTPUT="$RUN/artifacts"
export XDG_DATA_HOME="$RUN/data" XDG_CONFIG_HOME="$RUN/config" XDG_CACHE_HOME="$RUN/cache" XDG_STATE_HOME="$RUN/state" XDG_RUNTIME_DIR="$RUN/runtime"
export GSETTINGS_BACKEND=keyfile GNOME_SHELL_SESSION_MODE=user LIBGL_ALWAYS_SOFTWARE=1
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS SESSION_MANAGER
# This process never replaces the user's compositor.
if ! dbus-run-session -- bash "$ROOT/scripts/test-session.sh" > "$RUN/session.log" 2>&1; then
    tail -100 "$RUN/session.log"
    exit 1
fi
cat "$RUN/artifacts/result.json" 2>/dev/null || { tail -100 "$RUN/session.log"; exit 1; }
python3 - "$RUN/artifacts/result.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));sys.exit(0 if r['ok'] else 1)
PY
