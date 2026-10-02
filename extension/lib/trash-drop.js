// SPDX-License-Identifier: MIT
import {_, format, ngettext} from './i18n.js';
/**
 * TrashDropTarget — manages the transparent GTK4 helper window that acts as the real Wayland
 * drop target under the recycle-bin gadget (design.md §7, helpers/trash-drop-target.js).
 *
 * GNOME Shell cannot receive file drops from Wayland clients; only a real client window can.
 * The helper is spawned with Meta.WaylandClient.new_subprocess, its window is turned into a
 * sticky DESKTOP-type window hidden from window lists, raised above DING's desktop window and
 * pinned to the gadget body's stage rectangle. During an external drag (Main.xdndHandler
 * 'drag-begin') every reactive actor of the gadget is made non-reactive so the drop falls
 * through to the helper; reactivity is restored when the drag leaves the helper or is dropped.
 *
 * Usage in the trash gadget:
 *   build()          { this.dropTarget = new TrashDropTarget(this.host, this); }
 *   beforeDestroy()  { this.dropTarget?.destroy(); this.dropTarget = null; }
 *   onDropHover(state)                 optional: a file drag hovers the bin → show view<N>_hover(_full).png
 *   onDropped({trashed, failed, skipped})  optional: refresh the item count (the host already notified)
 *   onDropState(state, text)           optional: 'starting' | 'ready' | 'restarting' | 'stopped' | 'unsupported'
 *   this.dropTarget.setGeometry()      call after resize()/moves if you do not rely on the automatic
 *                                      notify::allocation / scale-x / mapped tracking
 *   this.dropTarget.statusText         Chinese sentence for the `i` notification
 *   this.dropTarget.available          true while the helper window is mapped and ready
 *
 * Helper protocol (stdout, one JSON per line): {"event":"ready"} · {"event":"hover","state":bool} ·
 * {"event":"drop","trashed":[names],"failed":[{name,error}],"skipped":n} · {"event":"error","message"}.
 * Commands (stdin): {"cmd":"resize","width","height"} · {"cmd":"visible","state"} · {"cmd":"quit"}.
 *
 * Restart policy: a helper that exits is restarted after 5 s, at most 3 times (the counter resets
 * after 60 s of uptime); a helper that does not map within 10 s is killed and counts as a failure.
 * destroy() closes stdin, sends SIGTERM and force_exit()s the process if it is still alive 1.5 s later.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Scope, cancelError} from './platform.js';

export const HELPER_TITLE = 'classic-gadgets-trash';
const HELPER_PATH = 'helpers/trash-drop-target.js';
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 5000;
const STARTUP_TIMEOUT_MS = 10000;
const STABLE_AFTER_MS = 60000;
const DRAG_GRACE_MS = 400;
const KILL_GRACE_MS = 1500;
const LOG = 'Windows Vista/7 Widgets: trash drop helper';

/** Meta.is_wayland_compositor is gone from Meta-18; the context tells whether a Wayland compositor runs. */
export function isWayland() {
    try {
        if (typeof Meta.is_wayland_compositor === 'function') return Meta.is_wayland_compositor();
        if (typeof global.context?.get_wayland_compositor === 'function') return global.context.get_wayland_compositor() !== null;
    } catch { /* fall through */ }
    return false;
}
export function findGjs() { return GLib.find_program_in_path('gjs'); }
/** Chinese reason why file drops cannot work in this session, or null when they can. */
export function unsupportedReason() {
    if (!isWayland()) return _("Dropping files into the trash is not supported in X11 sessions");
    if (typeof Meta.WaylandClient?.new_subprocess !== 'function') return _("This GNOME Shell version does not support dropping files into the trash");
    if (!findGjs()) return _("gjs was not found; file drops cannot be enabled");
    return null;
}
export function isSupported() { return unsupportedReason() === null; }

export class TrashDropTarget {
    constructor(host, gadget) {
        this.host = host; this.gadget = gadget;
        this.scope = new Scope();
        this.windowScope = null;
        this.window = null; this.client = null; this.subprocess = null; this.stdin = null; this.stdout = null;
        this.state = 'starting'; this.reason = null; this.ready = false; this.stopping = false;
        this.restarts = 0; this.launchToken = 0; this.launchedAt = 0;
        this.passThrough = null; this.hovering = false; this.visibleSent = null;
        this.size = {width: 0, height: 0};
        this.syncPending = 0; this.restoreTimer = 0; this.startupTimer = 0; this.stableTimer = 0; this.mapId = 0;
        const reason = unsupportedReason();
        if (reason) { this.setState('unsupported', reason); return; }
        this.scope.connect(global.display, 'window-created', (_display, window) => this.onWindowCreated(window));
        this.mapId = global.window_manager.connect_after('map', (_wm, actor) => this.onMap(actor));
        this.scope.connect(global.display, 'restacked', () => this.keepAboveDesktop());
        if (Main.xdndHandler) {
            this.scope.connect(Main.xdndHandler, 'drag-begin', () => this.onExternalDragBegin());
            this.scope.connect(Main.xdndHandler, 'drag-end', () => this.onExternalDragEnd());
        }
        for (const signal of ['notify::allocation', 'notify::scale-x', 'notify::scale-y', 'notify::mapped']) this.scope.connect(gadget.actor, signal, () => this.scheduleSync());
        this.scope.connect(gadget.body, 'notify::allocation', () => this.scheduleSync());
        if (host.settings) this.scope.connect(host.settings, 'changed::visible', () => this.syncVisibility());
        if (Main.layoutManager._startingUp) this.scope.connect(Main.layoutManager, 'startup-complete', () => this.spawn());
        else this.spawn();
    }
    get available() { return this.state === 'ready' && !!this.window; }
    get statusText() {
        if (this.state === 'ready') return this.window ? _("Drop files onto the trash icon") : _("Preparing file drops…");
        if (this.state === 'starting') return _("Enabling file drops…");
        return this.reason ?? '';
    }
    setState(state, reason) {
        this.state = state; this.reason = reason;
        this.callGadget('onDropState', state, this.statusText);
    }
    callGadget(hook, ...args) {
        const fn = this.gadget?.[hook];
        if (typeof fn !== 'function') return;
        try { fn.apply(this.gadget, args); } catch (e) { console.error(format(_("{prefix}: {hook} callback failed"), {prefix: LOG, hook: hook}), e); }
    }

    // --- helper process --------------------------------------------------------------------
    spawn() {
        if (!this.scope?.alive || this.subprocess || this.stopping) return;
        const token = ++this.launchToken;
        const rect = this.bodyRect() ?? {width: Math.max(1, Math.round(this.gadget.width || 130)), height: Math.max(1, Math.round(this.gadget.height || 90))};
        this.size = {width: rect.width, height: rect.height};
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE});
        launcher.set_cwd(GLib.get_home_dir());
        launcher.setenv('GDK_BACKEND', 'wayland', true);
        launcher.setenv('GSK_RENDERER', 'cairo', true);
        launcher.setenv('GTK_A11Y', 'none', true);
        launcher.setenv('NO_AT_BRIDGE', '1', true);
        const argv = [findGjs() ?? 'gjs', '-m', GLib.build_filenamev([this.host.path, HELPER_PATH]), '--title', HELPER_TITLE, '--width', String(rect.width), '--height', String(rect.height)];
        try {
            this.client = Meta.WaylandClient.new_subprocess(global.context, launcher, argv);
            this.subprocess = this.client.get_subprocess();
        } catch (e) {
            this.client = null; this.subprocess = null;
            console.error(format(_("{prefix}: failed to start"), {prefix: LOG}), e);
            this.setState('stopped', format(_("Cannot enable file drops: {error}"), {error: e.message}));
            return;
        }
        this.launchedAt = GLib.get_monotonic_time();
        this.ready = false; this.visibleSent = null;
        this.stdin = this.subprocess.get_stdin_pipe();
        this.stdout = new Gio.DataInputStream({base_stream: this.subprocess.get_stdout_pipe()});
        this.setState('starting', null);
        this.readLines(this.stdout, token);
        this.subprocess.wait_async(null, (proc, result) => this.onExit(proc, result, token));
        this.startupTimer = this.scope.later(STARTUP_TIMEOUT_MS, () => {
            this.startupTimer = 0;
            if (this.launchToken === token && !this.ready && this.subprocess) { console.warn(format(ngettext("{prefix}: not ready after {count} second; terminating", "{prefix}: not ready after {count} seconds; terminating", STARTUP_TIMEOUT_MS / 1000), {prefix: LOG, count: STARTUP_TIMEOUT_MS / 1000})); this.subprocess.force_exit(); }
        });
        this.stableTimer = this.scope.later(STABLE_AFTER_MS, () => { this.stableTimer = 0; if (this.launchToken === token) this.restarts = 0; });
    }
    readLines(stream, token) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this.scope.cancellable, (source, result) => {
            if (!this.scope?.alive || this.launchToken !== token) return;
            let line = null;
            try { [line] = source.read_line_finish_utf8(result); } catch (e) { if (!cancelError(e)) console.warn(format(_("{prefix}: failed to read output"), {prefix: LOG}), e); return; }
            if (line === null) return; // EOF — wait_async reports the exit
            this.handleLine(line);
            this.readLines(stream, token);
        });
    }
    /** One protocol line from the helper (exposed for tests). */
    handleLine(line) {
        const text = String(line).trim();
        if (!text) return;
        let event;
        try { event = JSON.parse(text); } catch { console.log(`${LOG}: ${text}`); return; }
        switch (event?.event) {
        case 'ready': this.helperSize = event; this.onReady(); break;
        case 'hover': this.onHover(Boolean(event.state)); break;
        case 'drop': this.onDrop(event); break;
        case 'error': console.warn(`${LOG}: ${event.message}`); break;
        case 'resized': this.helperSize = event; break;
        case 'pong': break;
        default: console.log(`${LOG}: ${text}`);
        }
    }
    send(command) {
        if (!this.stdin) return false;
        try { this.stdin.write_all(new TextEncoder().encode(`${JSON.stringify(command)}\n`), null); return true; } catch (e) { console.warn(format(_("{prefix}: failed to send command"), {prefix: LOG}), e); return false; }
    }
    onReady() {
        this.ready = true;
        if (this.startupTimer) { this.scope.cancelSource(this.startupTimer); this.startupTimer = 0; }
        this.setState('ready', null);
        this.syncVisibility();
        this.scheduleSync();
    }
    onExit(proc, result, token) {
        try { proc.wait_finish(result); } catch { /* reaped elsewhere */ }
        if (!this.scope?.alive || this.launchToken !== token) return;
        const status = proc.get_if_exited() ? format(_("Exit code {code}"), {code: proc.get_exit_status()}) : format(_("Signal {signal}"), {signal: proc.get_if_signaled() ? proc.get_term_sig() : '?'});
        this.subprocess = null; this.client = null; this.stdin = null; this.stdout = null; this.ready = false;
        this.windowScope?.destroy(); this.windowScope = null; this.window = null;
        if (this.startupTimer) { this.scope.cancelSource(this.startupTimer); this.startupTimer = 0; }
        if (this.stableTimer) { this.scope.cancelSource(this.stableTimer); this.stableTimer = 0; }
        this.restoreReactive();
        if (this.hovering) this.onHover(false);
        if (this.stopping) return;
        if (this.restarts >= MAX_RESTARTS) {
            console.warn(format(ngettext("{prefix}: exited {count} time in a row ({status}); no more restarts", "{prefix}: exited {count} times in a row ({status}); no more restarts", MAX_RESTARTS), {prefix: LOG, count: MAX_RESTARTS, status: status}));
            this.setState('stopped', format(_("The file drop service exited repeatedly ({status}) and was disabled. Add the trash widget again to retry."), {status: status}));
            return;
        }
        this.restarts++;
        console.warn(format(ngettext("{prefix}: exited ({status}); restarting in {count} second ({attempt}/{limit})", "{prefix}: exited ({status}); restarting in {count} seconds ({attempt}/{limit})", RESTART_DELAY_MS / 1000), {prefix: LOG, status: status, count: RESTART_DELAY_MS / 1000, attempt: this.restarts, limit: MAX_RESTARTS}));
        this.setState('restarting', format(ngettext("The file drop service exited; retrying in {count} second ({attempt}/{limit})", "The file drop service exited; retrying in {count} seconds ({attempt}/{limit})", RESTART_DELAY_MS / 1000), {count: RESTART_DELAY_MS / 1000, attempt: this.restarts, limit: MAX_RESTARTS}));
        this.scope.later(RESTART_DELAY_MS, () => this.spawn());
    }

    // --- the helper window -----------------------------------------------------------------
    ownsWindow(window) {
        if (!this.client || !window) return false;
        try { return this.client.owns_window(window); } catch { return false; } // X11 windows throw
    }
    onWindowCreated(window) { if (this.ownsWindow(window)) this.adoptWindow(window, false); }
    onMap(actor) {
        const window = actor?.get_meta_window?.() ?? actor?.meta_window;
        if (window && this.ownsWindow(window)) this.adoptWindow(window, true);
    }
    adoptWindow(window, mapped) {
        if (!this.scope?.alive) return;
        if (this.window !== window) {
            this.windowScope?.destroy();
            this.window = window;
            const scope = this.windowScope = new Scope();
            scope.connect(window, 'unmanaged', () => { if (this.window === window) { this.window = null; this.windowScope = null; scope.destroy(); } });
            scope.connect(window, 'position-changed', () => this.scheduleSync());
            scope.connect(window, 'size-changed', () => this.scheduleSync());
            scope.connect(window, 'notify::above', () => { if (window.above) window.unmake_above(); });
            scope.connect(window, 'notify::minimized', () => { if (window.minimized) window.unminimize(); });
        }
        try {
            if (window.get_window_type() !== Meta.WindowType.DESKTOP) window.set_type?.(Meta.WindowType.DESKTOP);
            window.hide_from_window_list?.();
            if (!window.is_on_all_workspaces()) window.stick();
        } catch (e) { console.warn(format(_("{prefix}: window setup failed"), {prefix: LOG}), e); }
        if (!mapped) return;
        this.keepAboveDesktop();
        this.setGeometry();
        this.dropFocus(window);
        if (this.ready) this.setState('ready', null);
    }
    /** Another DESKTOP-type window (DING) stacked above ours would swallow the drops. */
    keepAboveDesktop() {
        const window = this.window;
        if (!window) return;
        const children = global.window_group.get_children();
        const index = children.indexOf(window.get_compositor_private?.());
        if (index < 0) return;
        const covered = children.slice(index + 1).some(child => { const other = child.get_meta_window?.(); return other && other !== window && other.get_window_type() === Meta.WindowType.DESKTOP; });
        if (covered) { try { window.raise(); } catch (e) { console.warn(format(_("{prefix}: cannot raise window"), {prefix: LOG}), e); } }
    }
    /** A DESKTOP window set before its first show never takes focus; if it did anyway, hand it back. */
    dropFocus(window) {
        if (global.display.focus_window !== window) return;
        const workspace = global.workspace_manager.get_active_workspace();
        const candidate = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace).find(other => other !== window && !other.minimized && other.get_window_type() !== Meta.WindowType.DESKTOP);
        if (candidate) Main.activateWindow(candidate);
    }
    bodyRect() {
        const body = this.gadget?.body;
        if (!body || !body.mapped) return null;
        const [x, y] = body.get_transformed_position();
        const [w, h] = body.get_transformed_size();
        const width = Math.round(w), height = Math.round(h);
        if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
        return {x: Math.round(x), y: Math.round(y), width, height};
    }

    scheduleSync() {
        if (!this.scope?.alive || this.syncPending) return;
        this.syncPending = this.scope.later(0, () => { this.syncPending = 0; this.setGeometry(); });
    }
    /** Pins the helper window to the gadget body's stage rectangle (scale included); safe to call any time. */
    setGeometry() {
        if (!this.scope?.alive) return;
        const rect = this.bodyRect();
        if (!rect) return;
        if (rect.width !== this.size.width || rect.height !== this.size.height) {
            this.size = {width: rect.width, height: rect.height};
            this.send({cmd: 'resize', width: rect.width, height: rect.height});
        }
        const window = this.window;
        if (!window) return;
        const frame = window.get_frame_rect();
        if (frame.x === rect.x && frame.y === rect.y && frame.width === rect.width && frame.height === rect.height) return;
        try { window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height); } catch (e) { console.warn(format(_("{prefix}: cannot move window"), {prefix: LOG}), e); }
    }
    syncVisibility() {
        if (!this.ready || !this.stdin) return;
        const visible = this.host?.settings?.get_boolean?.('visible') ?? true;
        if (visible === this.visibleSent) return;
        this.visibleSent = visible;
        this.send({cmd: 'visible', state: visible});
    }

    // --- external drags ---------------------------------------------------------------------
    onExternalDragBegin() {
        this.cancelRestore();
        if (this.passThrough || !this.window || !this.gadget?.actor) return;
        const saved = [];
        const walk = actor => {
            if (actor.reactive) { saved.push(actor); actor.reactive = false; }
            for (const child of actor.get_children()) walk(child);
        };
        walk(this.gadget.actor);
        this.passThrough = saved;
    }
    onExternalDragEnd() {
        if (!this.passThrough) return;
        // The drag left the stage: onto our helper (a hover event follows immediately) or elsewhere.
        this.cancelRestore();
        this.restoreTimer = this.scope.later(DRAG_GRACE_MS, () => { this.restoreTimer = 0; if (!this.hovering) this.restoreReactive(); });
    }
    cancelRestore() { if (this.restoreTimer && this.scope) { this.scope.cancelSource(this.restoreTimer); this.restoreTimer = 0; } }
    restoreReactive() {
        this.cancelRestore();
        const saved = this.passThrough;
        this.passThrough = null;
        if (!saved) return;
        for (const actor of saved) { try { actor.reactive = true; } catch { /* destroyed during the drag */ } }
    }
    onHover(state) {
        if (state === this.hovering) return;
        this.hovering = state;
        if (state) this.cancelRestore(); else this.restoreReactive();
        this.callGadget('onDropHover', state);
    }
    onDrop(event) {
        const trashed = Array.isArray(event.trashed) ? event.trashed.map(String) : [];
        const failed = Array.isArray(event.failed) ? event.failed.filter(item => item && typeof item === 'object').map(item => ({name: String(item.name ?? ''), error: String(item.error ?? '')})) : [];
        const skipped = Number.isInteger(event.skipped) && event.skipped > 0 ? event.skipped : 0;
        if (this.hovering) this.onHover(false); else this.restoreReactive();
        const result = {trashed, failed, skipped};
        this.callGadget('onDropped', result);
        const parts = [];
        if (trashed.length) parts.push(format(ngettext("Moved {count} item to the trash", "Moved {count} items to the trash", trashed.length), {count: trashed.length}));
        if (failed.length) parts.push(format(ngettext("Could not move {count} item ({name}: {error})", "Could not move {count} items ({name}: {error})", failed.length), {count: failed.length, name: failed[0].name, error: failed[0].error}));
        if (skipped) parts.push(format(ngettext("Skipped {count} non-local item", "Skipped {count} non-local items", skipped), {count: skipped}));
        Main.notify(_("Trash"), parts.length ? parts.join('\n') : _("No items can be moved to the trash"));
    }

    destroy() {
        if (!this.scope) return;
        this.stopping = true;
        this.launchToken++;
        this.restoreReactive();
        if (this.hovering) { this.hovering = false; this.callGadget('onDropHover', false); }
        if (this.mapId) { global.window_manager.disconnect(this.mapId); this.mapId = 0; }
        this.windowScope?.destroy(); this.windowScope = null;
        this.scope.destroy(); this.scope = null;
        const subprocess = this.subprocess, stdin = this.stdin;
        this.subprocess = null; this.client = null; this.stdin = null; this.stdout = null; this.window = null;
        if (subprocess) terminate(subprocess, stdin);
        this.host = null; this.gadget = null;
    }
}

/** Graceful stop: stdin EOF + SIGTERM, then force_exit() when the helper is still alive after the grace period. */
function terminate(subprocess, stdin) {
    let exited = false;
    subprocess.wait_async(null, (proc, result) => { exited = true; try { proc.wait_finish(result); } catch { /* already reaped */ } });
    try { stdin?.close(null); } catch { /* already closed */ }
    try { subprocess.send_signal(15); } catch { /* already gone */ }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, KILL_GRACE_MS, () => {
        if (!exited) { try { subprocess.force_exit(); } catch { /* already gone */ } }
        return GLib.SOURCE_REMOVE;
    });
}
