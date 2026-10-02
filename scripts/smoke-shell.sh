#!/usr/bin/env bash
# Headless smoke run: start an isolated GNOME Shell session (own bus, XDG dirs and keyfile
# GSettings) with only the given gadgets enabled, screenshot the desktop after 4 s, dump the
# gadget geometry and optionally run a driver script. Serialized through build/shell.lock.
#
# Usage: bash scripts/smoke-shell.sh <type>[,<type>...] [--size small|large] [--theme classic|fluent]
#            [--script <JS module path>] [--out <dir>] [--options '<json patch merged into options>']
#   --options '{"clock":{"face":"diner"},"weather":{"city":"南昌"}}' is merged per type on top of
#   {"size": <--size>}; keys for types that are not listed are stored as given.
# Output (default --out build/smoke/<types joined by +>-<size>-<theme>): desktop.png, state.json
#   ([{type, x, y, width, height, size, assets: [originalAsset of every descendant]}]),
#   result.json ({ok, error?, checks}), session.log, plus files saved by the script.
# Script contract: `export async function run(app, h)` — app = the extension instance,
#   h = {wait(ms), screenshot(name|path), motion(x,y), button(n,state), click(x,y,n=1), key(keyval),
#        scroll(x,y,direction), check(condition, name), out, checks, Clutter}.
# Exit status: 0 when result.json says ok, 1 otherwise. One run takes about 15–30 s (limit 60 s).
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }
# A stable UI language for visual assertions; test-i18n.sh overrides this.
export LC_ALL="${CG_TEST_LOCALE:-zh_CN.UTF-8}"
export LANG="$LC_ALL" LANGUAGE="${CG_TEST_LANGUAGE:-zh_CN}"
python3 "$ROOT/scripts/i18n.py" compile > /dev/null
TYPES=""; SIZE=small; THEME=classic; SCRIPT=""; OUT=""; OPTIONS="{}"; DING=false
while [ $# -gt 0 ]; do
    case "$1" in
        --ding) DING=true; shift;;
        --size) SIZE=${2:-}; shift 2;;
        --theme) THEME=${2:-}; shift 2;;
        --script) SCRIPT=${2:-}; shift 2;;
        --out) OUT=${2:-}; shift 2;;
        --options) OPTIONS=${2:-}; shift 2;;
        -h|--help) usage; exit 0;;
        -*) echo "smoke-shell: unknown option $1" >&2; usage >&2; exit 2;;
        *) if [ -z "$TYPES" ]; then TYPES=$1; else echo "smoke-shell: unexpected argument $1" >&2; exit 2; fi; shift;;
    esac
done
[ -n "$TYPES" ] || { usage >&2; exit 2; }
case "$SIZE" in small|large) ;; *) echo "smoke-shell: --size must be small or large" >&2; exit 2;; esac
case "$THEME" in classic|fluent) ;; *) echo "smoke-shell: --theme must be classic or fluent" >&2; exit 2;; esac
if [ -n "$SCRIPT" ]; then
    [ -f "$SCRIPT" ] || { echo "smoke-shell: script not found: $SCRIPT" >&2; exit 2; }
    SCRIPT=$(realpath "$SCRIPT")
fi
[ -n "$OUT" ] || OUT="$ROOT/build/smoke/${TYPES//,/+}-$SIZE-$THEME"
mkdir -p "$OUT" "$ROOT/build"
OUT=$(realpath "$OUT")
rm -f "$OUT/result.json" "$OUT/state.json" "$OUT/desktop.png" "$OUT/failure.png"

exec 9>"$ROOT/build/shell.lock"
flock 9   # one headless shell at a time (shared with scripts/test-shell.sh)
START=$(date +%s)
python3 "$ROOT/scripts/import-original-assets.py" --check > /dev/null

RUN=$(mktemp -d "$ROOT/build/smoke-run.XXXXXX")
trap 'rm -rf "$RUN"' EXIT
mkdir -p "$RUN"/{data,config/glib-2.0/settings,cache,state,runtime}
chmod 700 "$RUN/runtime"
UUID=classic-gadgets@FreeDivers.github.io
DRIVER=classic-gadgets-smoke@local
mkdir -p "$RUN/data/gnome-shell/extensions/$UUID" "$RUN/data/gnome-shell/extensions/$DRIVER"
cp -a "$ROOT/extension/." "$RUN/data/gnome-shell/extensions/$UUID/"
cp -a "$ROOT/tests/smoke/driver/." "$RUN/data/gnome-shell/extensions/$DRIVER/"
glib-compile-schemas --strict "$RUN/data/gnome-shell/extensions/$UUID/schemas"
python3 - "$RUN/data/gnome-shell/extensions/$UUID" "$OUT/source-sha256.json" <<'PYHASH'
from pathlib import Path
import hashlib, json, sys
root = Path(sys.argv[1])
files = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(root.rglob('*')) if path.is_file()}
Path(sys.argv[2]).write_text(json.dumps(files, sort_keys=True, indent=2) + '\n')
PYHASH

# Seed our GSettings through the keyfile backend; GLib prints the GVariant text so quoting is exact.
python3 - "$RUN/config/glib-2.0/settings/keyfile" "$TYPES" "$SIZE" "$THEME" "$OPTIONS" <<'PY'
import json, sys
from gi.repository import GLib
keyfile, types, size, theme, patch = sys.argv[1], sys.argv[2].split(','), sys.argv[3], sys.argv[4], json.loads(sys.argv[5])
if not isinstance(patch, dict):
    raise SystemExit('--options must be a JSON object keyed by gadget type')
options = {}
for gadget_type in types:
    extra = patch.pop(gadget_type, None)
    options[gadget_type] = {'size': size, **(extra if isinstance(extra, dict) else {})}
options.update(patch)
text = lambda value: GLib.Variant('s', value).print_(False)
with open(keyfile, 'w', encoding='utf-8') as handle:
    handle.write('[org/gnome/shell/extensions/classic-gadgets]\n')
    handle.write('enabled-gadgets=' + GLib.Variant('as', types).print_(False) + '\n')
    handle.write('options=' + text(json.dumps(options, ensure_ascii=False)) + '\n')
    handle.write('theme=' + text(theme) + '\n')
PY

export CG_TEST_SOURCE="$ROOT" CG_TEST_OUTPUT="$OUT" CG_TEST_EXTENSIONS="['$UUID', '$DRIVER']" CG_TEST_TIMEOUT="${CG_TEST_TIMEOUT:-100}"
export CG_SMOKE_OUT="$OUT" CG_SMOKE_SCRIPT="$SCRIPT" CG_SMOKE_TYPES="$TYPES" CG_SMOKE_SIZE="$SIZE" CG_SMOKE_THEME="$THEME"
export XDG_DATA_HOME="$RUN/data" XDG_CONFIG_HOME="$RUN/config" XDG_CACHE_HOME="$RUN/cache" XDG_STATE_HOME="$RUN/state" XDG_RUNTIME_DIR="$RUN/runtime"
export GSETTINGS_BACKEND=keyfile GNOME_SHELL_SESSION_MODE=user LIBGL_ALWAYS_SOFTWARE=1
if $DING; then
    # Exercise Ubuntu's actual mode-extension selection rule. DING must be a
    # SYSTEM extension, not the user copy which Ubuntu deliberately ignores.
    # Isolate its executable path too: DING kills old processes matching its own
    # path on startup, so NEVER run the real /usr/share executable in a test.
    SYSTEM="$RUN/system-data"
    mkdir -p "$SYSTEM/gnome-shell/extensions/ding@rastersoft.com" "$RUN/desktop"
    cp -a /usr/share/gnome-shell/extensions/ding@rastersoft.com/. "$SYSTEM/gnome-shell/extensions/ding@rastersoft.com/"
    mkdir -p "$RUN/data/gnome-shell/extensions/ding@rastersoft.com"
    cp "$SYSTEM/gnome-shell/extensions/ding@rastersoft.com/metadata.json" "$RUN/data/gnome-shell/extensions/ding@rastersoft.com/metadata.json"
    printf '%s\n' "throw new Error('Ubuntu must ignore this obsolete per-user DING override');" > "$RUN/data/gnome-shell/extensions/ding@rastersoft.com/extension.js"
    printf 'XDG_DESKTOP_DIR="%s"\n' "$RUN/desktop" > "$RUN/config/user-dirs.dirs"
    export XDG_DATA_DIRS="$SYSTEM:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
    export XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=ubuntu
    export CG_TEST_DING_SOURCE="$SYSTEM/gnome-shell/extensions/ding@rastersoft.com"
    export CG_TEST_EXTENSIONS="['ding@rastersoft.com', '$UUID', '$DRIVER']"
fi
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS SESSION_MANAGER
# This process never replaces the user's compositor; the session dies with its private bus.
dbus-run-session -- bash "$ROOT/scripts/test-session.sh" > "$OUT/session.log" 2>&1 || true
cp "$RUN/config/glib-2.0/settings/keyfile" "$OUT/settings.keyfile" 2>/dev/null || true

if [ ! -f "$OUT/result.json" ]; then
    echo "smoke-shell: no result.json after $(( $(date +%s) - START )) s — see $OUT/session.log" >&2
    grep -E "JS ERROR|Error|error" "$OUT/session.log" | tail -30 >&2 || true
    exit 1
fi
python3 - "$OUT/result.json" "$OUT" "$(( $(date +%s) - START ))" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
print(f"smoke-shell: {'OK' if result.get('ok') else 'FAILED'} in {sys.argv[3]} s -> {sys.argv[2]}/desktop.png")
for check in result.get('checks', []):
    print(f'  PASS {check}')
if not result.get('ok'):
    print(f"  FAIL {result.get('error')}")
    sys.exit(1)
PY
