// SPDX-License-Identifier: MIT
// Smoke driver — installed only in the isolated headless session started by
// scripts/smoke-shell.sh (uuid classic-gadgets-smoke@local). 4 s after enable it
// screenshots the desktop, dumps every gadget's geometry to state.json, runs the
// optional script (`export async function run(app, h)`), writes result.json and ends
// the session. Never runs on the real desktop (no CG_SMOKE_OUT → does nothing).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'classic-gadgets@FreeDivers.github.io';
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));

async function screenshot(path) {
    const output = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot(false, output, (s, result) => { try { s.screenshot_finish(result); resolve(); } catch (e) { reject(e); } }));
    output.close(null);
}
function assetsOf(actor) {
    const list = [];
    const walk = a => { if (a.originalAsset) list.push(a.originalAsset); for (const child of a.get_children()) walk(child); };
    walk(actor); return list;
}
function helpers(out, checks) {
    const seat = global.stage.get_context().get_backend().get_default_seat();
    // Create the seat pointer before any Wayland client maps. Creating it in
    // the first motion races wl_seat.capabilities/get_pointer: the first click
    // reaches Clutter but the client has not bound wl_pointer yet.
    let pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE), keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const getPointer = () => pointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const getKeyboard = () => keyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const motion = async (x, y) => { getPointer().notify_absolute_motion(GLib.get_monotonic_time(), x, y); await wait(90); };
    const button = async (n, state) => { getPointer().notify_button(GLib.get_monotonic_time(), n, state); await wait(90); };
    const click = async (x, y, n = 1) => { await motion(x, y); await button(n, Clutter.ButtonState.PRESSED); await button(n, Clutter.ButtonState.RELEASED); };
    const key = async keyval => {
        const device = getKeyboard();
        device.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        device.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await wait(120);
    };
    const chord = async keys => {
        const device=getKeyboard();
        for(const key of keys) device.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.PRESSED);
        await wait(60);
        for(const key of [...keys].reverse()) device.notify_keyval(GLib.get_monotonic_time(),key,Clutter.KeyState.RELEASED);
        await wait(150);
    };
    const type = async text => { for(const char of text) await key(char.codePointAt(0)); };
    const scroll = async (x, y, direction) => { await motion(x, y); getPointer().notify_discrete_scroll(GLib.get_monotonic_time(), direction, Clutter.ScrollSource.WHEEL); await wait(90); };
    const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); console.log(`CG SMOKE PASS: ${name}`); };
    return {wait, screenshot: name => screenshot(name.startsWith('/') ? name : `${out}/${name}`), motion, button, click, key, chord, type, scroll, check, out, checks, Clutter};
}

export default class SmokeDriver extends Extension {
    enable() {
        const out = GLib.getenv('CG_SMOKE_OUT');
        if (!out) return;
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => { this.timer = 0; this.run(out).catch(e => console.error(e)); return GLib.SOURCE_REMOVE; });
    }
    disable() { if (this.timer) GLib.Source.remove(this.timer); this.timer = 0; }
    async run(out) {
        const checks = [];
        let ok = false, error = null;
        try {
            Main.overview.hide(); await wait(300);
            const record = Main.extensionManager.lookup(UUID);
            const app = record?.stateObj;
            if (!app?.widgets) throw new Error(`extension not enabled: ${record?.error || JSON.stringify(record?.errors ?? null)}`);
            if (app.errors?.length) throw new Error(`gadget errors: ${app.errors.join('; ')}`);
            for (const type of (GLib.getenv('CG_SMOKE_TYPES') || '').split(',').filter(Boolean)) if (!app.widgets.has(type)) throw new Error(`${type}: not instantiated`);
            await screenshot(`${out}/desktop.png`);
            const state = [...app.widgets].map(([type, widget]) => ({type, x: widget.actor.x, y: widget.actor.y, width: widget.actor.width, height: widget.actor.height, bodyWidth: widget.width, bodyHeight: widget.height, size: widget.size, theme: app.theme?.name, assets: assetsOf(widget.actor)}));
            GLib.file_set_contents(`${out}/state.json`, JSON.stringify(state, null, 2));
            const script = GLib.getenv('CG_SMOKE_SCRIPT');
            if (script) {
                const module = await import(`file://${script}`);
                await module.run(app, helpers(out, checks));
            }
            ok = true;
        } catch (e) {
            console.error(e); error = `${e}`;
            try { await screenshot(`${out}/failure.png`); } catch (s) { console.error(s); }
        }
        GLib.file_set_contents(`${out}/result.json`, JSON.stringify({ok, ...(error ? {error} : {}), checks}, null, 2));
        await wait(200);
        try { global.context.terminate(); } catch (e) { console.error(e); Meta.exit(Meta.ExitCode.SUCCESS); }
    }
}
