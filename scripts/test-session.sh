#!/usr/bin/env bash
set -euo pipefail
# CG_TEST_EXTENSIONS / CG_TEST_TIMEOUT let scripts/smoke-shell.sh reuse this session with its own driver.
gsettings set org.gnome.shell enabled-extensions "${CG_TEST_EXTENSIONS:-['classic-gadgets@qinyan.local', 'classic-gadgets-test@local']}"
gsettings set org.gnome.shell disable-user-extensions false
if [ -n "${CG_TEST_DING_SOURCE:-}" ]; then
    gsettings set org.gnome.shell disabled-extensions "['ubuntu-dock@ubuntu.com', 'ubuntu-appindicators@ubuntu.com', 'tiling-assistant@ubuntu.com', 'snapd-prompting@canonical.com', 'snapd-search-provider@canonical.com', 'web-search-provider@ubuntu.com']"
fi
gsettings set org.gnome.shell start-in-overview false
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.desktop.background picture-uri ''
gsettings set org.gnome.desktop.background picture-uri-dark ''
gsettings set org.gnome.desktop.background primary-color '#233d4d'
gsettings set org.gnome.desktop.background color-shading-type 'solid'
gnome-shell --wayland --headless --virtual-monitor=1600x1100 --no-x11 &
SHELL_PID=$!
cleanup() { kill -TERM "$SHELL_PID" 2>/dev/null || true; wait "$SHELL_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for _ in $(seq 1 "${CG_TEST_TIMEOUT:-75}"); do
    if [ -f "$CG_TEST_OUTPUT/result.json" ]; then sleep 1; exit 0; fi
    if ! kill -0 "$SHELL_PID" 2>/dev/null; then
        wait "$SHELL_PID" || true
        # The smoke driver ends the session itself right after writing its result.
        [ -f "$CG_TEST_OUTPUT/result.json" ] && exit 0
        exit 1
    fi
    sleep 1
done
echo 'Isolated shell test timed out' >&2
exit 1
