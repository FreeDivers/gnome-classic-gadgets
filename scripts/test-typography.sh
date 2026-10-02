#!/usr/bin/env bash
# Real GNOME/Pango typography checks, deterministic bilingual content, no edits
# to the user's font configuration or running desktop.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OUT="$ROOT/build/smoke/typography"
bash "$ROOT/scripts/smoke-shell.sh" clock --script "$ROOT/tests/smoke/scripts/typography.js" --out "$OUT"
# A saved result is not a pass if the compositor subsequently aborts or St
# rejected a font declaration. Existing headless input-focus warnings are not
# font parsing failures and remain in the log for inspection.
if grep -E "Couldn't parse|JS ERROR|Windows Vista/7 (Widgets:|小组件：)|invalid pointer|invalid size|core dumped|Segmentation fault" "$OUT/session.log"; then
    echo 'Typography verification failed: inspect the native session log.' >&2
    exit 1
fi
python3 - "$OUT" <<'PY'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
report = json.loads((out / 'typography.json').read_text())
result = json.loads((out / 'result.json').read_text())
assert result['ok'] and len(report['captures']) == 8
assert all(row['unknownGlyphs'] == 0 for row in report['layouts'])
print(f"PASS: {len(result['checks'])} native assertions, {len(report['layouts'])} actual Pango layouts, 8 all-gadget screenshots")
PY
