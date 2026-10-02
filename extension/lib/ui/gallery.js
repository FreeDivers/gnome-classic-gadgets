// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Shell controller for the real GTK4 shelf and its native desktop drop surfaces.
// Never imports Gtk/Adw into Shell. All requests arrive on a private child pipe,
// type-checked against GADGETS; a drag must originate in this exact gallery.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {GADGETS} from '../core.js';
import {FOLDERS} from '../gadget.js';
import {Scope, cancelError} from '../platform.js';
import {centerIn, pointInRect} from './ui-logic.js';

const TITLE = _("Add Widgets");
function desktop(window) { return window.get_window_type() === Meta.WindowType.DESKTOP || window.customJS_ding?._keepAtBottom || window.get_wm_class()?.toLowerCase() === 'com.rastersoft.ding'; }
export class Gallery {
    constructor(host) { this.host = host; this.visible = false; this.selected = 'clock'; this.waiters = []; }
    entries() {
        return Object.entries(GADGETS).map(([type, meta]) => {
            const resolve = (paths, fallback) => paths.map(path => this.host.theme.resolve(FOLDERS[type], path)).find(path => Gio.File.new_for_path(path).query_exists(null)) || fallback;
            const icon = resolve(['icon.png', 'images/icon.png']);
            const dragIcon = resolve(['drag.png', 'dragndrop.png', 'images/dragndrop.png'], icon);
            return {type, name: meta.name, subtitle: meta.subtitle, description: meta.description, author: meta.author, icon, dragIcon};
        });
    }
    show() {
        if (this.visible) { this.send({cmd: 'present'}); if (this.nativeWindow) Main.activateWindow(this.nativeWindow); return; }
        this.visible = true; this.ready = false; this.helperReady = false; this.exited = false; this.nativeWindow = null; this.positioned = false;
        this.scope = new Scope(); this.targets = new Map(); this.view = null; this.lastDrop = null; this.token = GLib.uuid_string_random();
        this.config = {entries: this.entries(), enabled: this.host.settings.get_strv('enabled-gadgets'), selected: this.selected, token: this.token,
            areas: this.host.workareas().map((area, id) => ({id, x: area.x, y: area.y, width: area.width, height: area.height}))};
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE});
        const argv = [GLib.find_program_in_path('gjs') || 'gjs', '-m', `${this.host.path}/helpers/gadget-gallery.js`];
        try {
            this.scope.connect(global.display, 'window-created', (_display, window) => {
                if (this.owns(window)) { this.adopt(window); this.scope.connect(window, 'notify::title', () => this.adopt(window)); }
            });
            this.scope.connect(global.window_manager, 'map', (_wm, actor) => this.adopt(actor.get_meta_window?.()));
            this.scope.connect(global.display, 'restacked', () => this.restackTargets());
            this.scope.connect(this.host.settings, 'changed::enabled-gadgets', () => this.send({cmd: 'enabled', enabled: this.host.settings.get_strv('enabled-gadgets')}));
            this.scope.connect(this.host.settings, 'changed::theme', () => this.send({cmd: 'entries', entries: this.entries()}));
            this.scope.connect(Main.sessionMode, 'updated', () => { if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) this.hide(); });
            this.scope.connect(Main.overview, 'showing', () => this.hide());
            this.scope.connect(Main.layoutManager, 'monitors-changed', () => this.hide());
            if (global.context.get_wayland_compositor?.()) {
                launcher.setenv('GDK_BACKEND', 'wayland', true);
                this.client = Meta.WaylandClient.new_subprocess(global.context, launcher, argv); this.process = this.client.get_subprocess();
            } else { this.client = null; this.process = launcher.spawnv(argv); }
            const process = this.process;
            const run = this.run = {process, exited: false, killTimer: 0};
            this.output = process.get_stdin_pipe(); this.input = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
            process.wait_async(null, (p, result) => {
                try { p.wait_finish(result); } catch { /* Already reaped. */ }
                run.exited = true;
                if (run.killTimer) { GLib.Source.remove(run.killTimer); run.killTimer = 0; }
                if (this.run !== run) return;
                this.exited = true;
                if (this.visible) { if (!this.ready) Main.notify(_("Cannot open the widget gallery"), _("The GTK4 window could not start. Check the logs.")); this.hide(); }
            });
            this.read(this.scope); this.send({cmd: 'init', config: this.config});
            this.scope.later(10000, () => { if (!this.ready) { Main.notify(_("Widget Gallery"), _("The GTK4 window timed out while starting. Try again.")); this.hide(); } });
        } catch (error) { console.error(_("Windows Vista/7 Widgets: widget gallery"), error); this.hide(); Main.notify(_("Cannot open the widget gallery"), error.message); }
    }
    get actor() { return this.nativeWindow?.get_compositor_private() ?? null; }
    owns(window) {
        if (!window || !this.process) return false;
        if (this.client) { try { return this.client.owns_window(window); } catch { return false; } }
        return window.get_pid() === Number(this.process.get_identifier());
    }
    adopt(window) {
        if (!this.visible || !this.owns(window)) return;
        const title = window.get_title(), prefix = `classic-gallery-drop:${this.token}:`;
        if (title?.startsWith(prefix)) {
            const id = Number(title.slice(prefix.length)); if (!this.config.areas.some(area => area.id === id)) return;
            if (!this.targets.has(id)) {
                this.targets.set(id, window);
                window.set_type(Meta.WindowType.DESKTOP); window.hide_from_window_list(); window.stick();
                this.scope.connect(window, 'unmanaging', () => { if (this.targets.get(id) === window) this.targets.delete(id); });
                this.scope.connect(window, 'size-changed', () => this.position());
                this.scope.connect(window, 'position-changed', () => this.position());
            }
        } else if (title === TITLE) this.nativeWindow = window;
        this.scope.later(60, () => this.position());
    }
    position() {
        if (!this.visible || this.positioning) return;
        this.positioning = true;
        try {
            for (const [id, window] of this.targets) {
                if (!window.get_compositor_private()?.mapped) continue;
                const area = this.config.areas[id], frame = window.get_frame_rect();
                if (frame.x !== area.x || frame.y !== area.y || frame.width !== area.width || frame.height !== area.height)
                    window.move_resize_frame(false, area.x, area.y, area.width, area.height);
            }
            const window = this.nativeWindow, frame = window?.get_frame_rect();
            if (frame?.width > 0 && window.get_compositor_private()?.mapped && !this.positioned) {
                const area = this.config.areas[Main.layoutManager.currentMonitor?.index ?? 0] || this.config.areas[0];
                const p = centerIn({width: frame.width, height: frame.height}, area); window.move_frame(false, Math.round(p.x), Math.round(p.y)); this.positioned = true;
            }
            this.restackTargets();
            if (!this.ready && this.helperReady && this.positioned && this.targets.size === this.config.areas.length) {
                this.ready = true; if (window) Main.activateWindow(window);
                for (const waiter of this.waiters) waiter.resolve(this); this.waiters = [];
            }
        } finally { this.positioning = false; }
    }
    restackTargets() {
        if (!this.visible || this.restacking) return;
        this.restacking = true;
        try {
            const children = global.window_group.get_children();
            for (const target of this.targets.values()) {
                const actor = target.get_compositor_private();
                if (!actor?.mapped) continue;
                const index = children.indexOf(actor);
                if (index < 0) continue;
                if (children.slice(index + 1).some(actor => { const other = actor.get_meta_window?.(); return other && !this.owns(other) && desktop(other); })) target.raise();
            }
        } finally { this.restacking = false; }
    }
    whenReady() {
        if (this.ready) return Promise.resolve(this);
        if (!this.visible) return Promise.reject(new Error(_("The widget gallery is closed")));
        return new Promise((resolve, reject) => this.waiters.push({resolve, reject}));
    }
    send(message) { if (this.output) { try { this.output.write_all(new TextEncoder().encode(`${JSON.stringify(message)}\n`), null); } catch (error) { if (this.visible) console.error(error); } } }
    read(scope) {
        this.input.read_line_async(GLib.PRIORITY_DEFAULT, scope.cancellable, (stream, result) => {
            let line;
            try { [line] = stream.read_line_finish_utf8(result); } catch (error) { if (scope.alive && !cancelError(error)) this.hide(); return; }
            if (!scope.alive) return;
            if (line === null) { this.hide(); return; }
            try { if (line.length > 1024 * 1024) throw new Error(_("The widget gallery message is too long")); this.receive(JSON.parse(line)); } catch (error) { console.error(error); }
            if (scope.alive) this.read(scope);
        });
    }
    receive(message) {
        if (!this.visible) return;
        if (message.event === 'ready' || message.event === 'target-ready') {
            if (message.event === 'ready') this.helperReady = true;
            for (const actor of global.window_group.get_children()) this.adopt(actor.get_meta_window?.()); this.position();
        } else if (message.event === 'view') { this.view = message; this.selected = message.selected; }
        else if (message.event === 'closed') this.hide();
        else if (message.event === 'error') { Main.notify(_("Widget Gallery"), message.message); this.hide(); }
        else if (message.event === 'drag-end') this.finishDrag();
        else if (Object.hasOwn(GADGETS, message.type)) {
            if (message.event === 'add') {
                this.host.enableGadget(message.type); this.host.settings.set_boolean('visible', true);
                this.send({cmd: 'notice', text: format(_("{widget} was added to the desktop"), {widget: GADGETS[message.type].name})});
            } else if (message.event === 'remove') this.host.remove(message.type);
            else if (message.event === 'drag-begin') this.beginDrag(message);
            else if (message.event === 'drop') this.drop(message);
        }
    }
    beginDrag(message) {
        this.finishDrag(); this.drag = {type: message.type, offsetX: message.offsetX, offsetY: message.offsetY};
        this.passThrough = [];
        const disable = actor => { if (actor.reactive) { this.passThrough.push(actor); actor.reactive = false; } for (const child of actor.get_children()) disable(child); };
        disable(this.host.layer); this.restackTargets();
    }
    drop(message) {
        if (this.drag?.type !== message.type || Main.overview.visible || Main.sessionMode.isLocked) return;
        const target = this.targets.get(message.area); if (!target) return;
        if (![message.x, message.y, message.width, message.height].every(Number.isFinite) || message.width <= 0 || message.height <= 0) return;
        if (message.x < 0 || message.x > message.width || message.y < 0 || message.y > message.height) return;
        const frame = target.get_frame_rect(), sx = frame.width / message.width, sy = frame.height / message.height;
        const x = frame.x + message.x * sx, y = frame.y + message.y * sy;
        if (!this.host.workareas().some(area => pointInRect(x, y, area))) return;
        this.host.addGadgetAt(message.type, x - 48 * sx, y - 40 * sy); this.host.settings.set_boolean('visible', true);
        this.lastDrop = {type: message.type, x, y};
        this.send({cmd: 'notice', text: format(_("{widget} was placed on the desktop"), {widget: GADGETS[message.type].name})});
    }
    finishDrag() {
        this.drag = null;
        for (const actor of this.passThrough || []) { try { actor.reactive = true; } catch { /* Gadget closed during a drag. */ } }
        this.passThrough = null;
    }
    hide() {
        if (!this.visible) return; this.visible = false; this.ready = false;
        this.finishDrag(); this.send({cmd: 'close'});
        try { this.output?.close(null); } catch { /* Child already gone. */ }
        this.output = null; this.scope.destroy();
        for (const waiter of this.waiters) waiter.reject(new Error(_("The widget gallery is closed"))); this.waiters = [];
        const run = this.run;
        if (run && !run.exited) run.killTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            run.killTimer = 0;
            if (!run.exited) run.process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        this.nativeWindow = null;
    }
    toggle() { if (this.visible) this.hide(); else this.show(); }
    destroy() { this.hide(); }
}
