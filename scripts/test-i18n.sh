#!/usr/bin/env bash
# Isolated GNOME/GTK tests for both the Simplified Chinese catalog and fallback.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
TYPES=clock,calendar,system,notes,weather,photos,calculator,timer,puzzle,rss,currency,stocks,contacts,trash
for language in zh_CN en; do
    locale=C.UTF-8; [ "$language" != zh_CN ] || locale=zh_CN.UTF-8
    CG_TEST_LANGUAGE="$language" CG_TEST_LOCALE="$locale" bash scripts/smoke-shell.sh "$TYPES" \
        --script tests/smoke/scripts/i18n.js --out "build/smoke/i18n-$language"
    CG_TEST_LANGUAGE="$language" CG_TEST_LOCALE="$locale" bash scripts/smoke-shell.sh clock --ding \
        --script tests/smoke/scripts/desktop-menu.js --out "build/smoke/i18n-ding-$language"
done
