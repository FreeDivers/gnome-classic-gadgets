#!/usr/bin/env bash
# Requirement-specific, real isolated GNOME/Wayland tests. Nothing runs in the user's Shell.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
python3 tests/test_desktop_menu.py
bash scripts/smoke-shell.sh clock --script tests/smoke/scripts/native-gallery.js --out build/smoke/native-gallery
bash scripts/smoke-shell.sh weather --script tests/smoke/scripts/native-options.js --out build/smoke/native-options
bash scripts/smoke-shell.sh clock,puzzle,system,notes --script tests/smoke/scripts/ui.js --out build/smoke/ui
bash scripts/smoke-shell.sh weather --size large --script tests/smoke/scripts/location.js --out build/smoke/location
bash scripts/smoke-shell.sh clock,calendar,system,notes,weather,photos,calculator,timer,puzzle,rss,currency,stocks,contacts,trash --size large --script tests/smoke/scripts/all-sizes.js --out build/smoke/all-sizes
bash scripts/smoke-shell.sh trash --script tests/smoke/scripts/trash.js --out build/smoke/trash
bash scripts/smoke-shell.sh trash --theme fluent --script tests/smoke/scripts/trash.js --out build/smoke/trash-fluent
bash scripts/smoke-shell.sh clock --ding --script tests/smoke/scripts/desktop-menu.js --out build/smoke/desktop-menu
bash scripts/smoke-shell.sh trash --ding --theme fluent --options '{"trash":{"scale":1.4}}' --script tests/smoke/scripts/trash.js --out build/smoke/trash-ding-scaled
