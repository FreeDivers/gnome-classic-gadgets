// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Shell-side controller for one GTK4/libadwaita component-options window.
// Gtk must NEVER be imported into GNOME Shell. A small GJS client owns the
// native UI; this controller alone validates drafts, searches and gadget actions.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {GADGETS} from '../core.js';
import {Scope, cancelError} from '../platform.js';
import {prepareOptions, displayValue, validateDraft} from './options-model.js';
import {placeDialog} from './ui-logic.js';

export class OptionsDialog {
    constructor(host, gadget) {
        this.host = host; this.gadget = gadget;
        this.initial = JSON.parse(JSON.stringify(gadget.options));
        this.scope = new Scope(); this.isOpen = false; this.ready = false;
        this.rows = new Map(); this.requests = new Map(); this.extraValues = {};
        this.waiters = []; this.exited = false;
    }
    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.specs = [];
        if (GADGETS[this.gadget.type].large) this.specs.push({type: 'combo', key: 'size', label: _("Size"), group: _("Appearance"), values: ['small', 'large'], names: [_("Small"), _("Large")]});
        this.specs.push({type: 'entry', key: 'scale', label: _("Scale"), group: _("Appearance"), number: {min: 0.5, max: 3, step: .05}, default: 1, hint: _("Adjusts the current size on top of the global scale")});
        this.specs.push(...this.gadget.optionsSpec());
        const {fields, values} = prepareOptions(this.specs, this.initial);
        this.values = values; this.raw = {};
        fields.forEach((field, i) => {
            if (field.key) { this.raw[field.key] = field.value; this.rows.set(field.key, {spec: this.specs[i], field}); }
        });
        this.config = {title: format(_("{widget} Settings"), {widget: GADGETS[this.gadget.type].name}), fields,
            height: Math.max(340, Math.min(680, (this.host.workareas()[0]?.height ?? 760) - 80))};
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE});
        const argv = [GLib.find_program_in_path('gjs') || 'gjs', '-m', `${this.host.path}/helpers/gadget-options.js`];
        try {
            this.scope.connect(global.display, 'window-created', (_display, window) => this.adoptWindow(window));
            this.scope.connect(global.window_manager, 'map', (_wm, actor) => this.adoptWindow(actor.get_meta_window?.()));
            this.scope.connect(Main.sessionMode, 'updated', () => { if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) this.close(); });
            if (global.context.get_wayland_compositor?.() && typeof Meta.WaylandClient?.new_subprocess === 'function') {
                launcher.setenv('GDK_BACKEND', 'wayland', true);
                this.client = Meta.WaylandClient.new_subprocess(global.context, launcher, argv);
                this.process = this.client.get_subprocess();
            } else this.process = launcher.spawnv(argv);
            this.output = this.process.get_stdin_pipe();
            this.input = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()});
            this.process.wait_async(null, (process, result) => {
                try { process.wait_finish(result); } catch { /* Process is already gone. */ }
                this.exited = true;
                if (this.killTimer) { GLib.Source.remove(this.killTimer); this.killTimer = 0; }
                if (this.isOpen) {
                    if (!this.ready) Main.notify(_("Cannot open widget settings"), _("Cannot start the settings window. Check that GTK4 and libadwaita are installed."));
                    this.close();
                }
            });
            this.read(); this.send({cmd: 'init', config: this.config});
            this.scope.later(10000, () => { if (!this.ready) { Main.notify(_("Cannot open widget settings"), _("The settings window timed out while starting. Try again.")); this.close(); } });
        } catch (error) {
            this.close(); Main.notify(_("Cannot open widget settings"), error.message); console.error(error);
        }
    }
    get actor() { return this.nativeWindow?.get_compositor_private() ?? null; }
    owns(window) {
        if (!window) return false;
        if (this.client) { try { return this.client.owns_window(window); } catch { return false; } }
        return this.process && window.get_pid() === Number(this.process.get_identifier());
    }
    adoptWindow(window) {
        if (!this.isOpen || !this.owns(window)) return;
        this.nativeWindow = window;
        this.scope.later(100, () => this.position());
    }
    position() {
        const window = this.nativeWindow; if (!window || !this.isOpen) return;
        const frame = window.get_frame_rect(); if (frame.width <= 0 || frame.height <= 0) return;
        const [x, y] = this.gadget.actor.get_transformed_position(), [width, height] = this.gadget.actor.get_transformed_size();
        const areas = this.host.workareas(), area = areas.find(a => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) ?? areas[0];
        if (area && !this.positioned) {
            const p = placeDialog({x, y, width, height}, frame, area);
            window.move_frame(false, Math.round(p.x), Math.round(p.y)); this.positioned = true;
        }
        if (this.helperReady && !this.ready) {
            this.ready = true;
            for (const waiter of this.waiters) waiter.resolve(this);
            this.waiters = [];
        }
    }
    whenReady() {
        if (this.ready) return Promise.resolve(this);
        if (!this.isOpen) return Promise.reject(new Error(_("Widget settings are closed")));
        return new Promise((resolve, reject) => this.waiters.push({resolve, reject}));
    }
    send(message) {
        if (!this.output) return;
        try { this.output.write_all(new TextEncoder().encode(`${JSON.stringify(message)}\n`), null); }
        catch (error) { if (this.isOpen && !cancelError(error)) console.error(_("The connection to widget settings was interrupted"), error); }
    }
    read() {
        this.input.read_line_async(GLib.PRIORITY_DEFAULT, this.scope.cancellable, (stream, result) => {
            let line;
            try { [line] = stream.read_line_finish_utf8(result); }
            catch (error) { if (!cancelError(error)) this.close(); return; }
            if (!this.scope.alive) return;
            if (line === null) { this.close(); return; }
            try {
                if (line.length > 1024 * 1024) throw new Error(_("The settings message is too long"));
                this.receive(JSON.parse(line));
            } catch (error) { console.error(_("Failed to process the widget settings message"), error); }
            if (this.scope.alive) this.read();
        });
    }
    acceptRaw(values) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) return;
        for (const [key, value] of Object.entries(values)) if (this.rows.has(key)) {
            this.raw[key] = value; this.values[key] = value;
        }
    }
    receive(message) {
        if (!this.isOpen) return;
        if (message.event === 'ready') {
            this.helperReady = true;
            for (const actor of global.window_group.get_children()) this.adoptWindow(actor.get_meta_window?.());
            this.position();
        } else if (message.event === 'closed') this.close();
        else if (message.event === 'change') this.acceptRaw({[message.key]: message.value});
        else if (message.event === 'apply') this.apply(message.values);
        else if (message.event === 'search') this.search(message);
        else if (message.event === 'pick') {
            const spec = this.specs[Number(message.id)], result = this.requests.get(message.id);
            if (spec?.type === 'search' && result?.request === message.request && result.items?.[message.index]) spec.onPick(result.items[message.index], this);
        } else if (message.event === 'action') this.action(message);
        else if (message.event === 'error') { Main.notify(_("Widget Settings"), message.message); this.close(); }
    }
    set(key, value) {
        if (!this.isOpen) return;
        this.values[key] = value;
        const row = this.rows.get(key);
        if (!row) { this.extraValues[key] = value; return; }
        this.raw[key] = displayValue(row.spec, value);
        this.send({cmd: 'set', key, value: this.raw[key]});
    }
    async search(message) {
        const spec = this.specs[Number(message.id)]; if (spec?.type !== 'search') return;
        this.requests.get(message.id)?.scope.destroy();
        const scope = new Scope(), record = {scope, request: message.request, items: []};
        this.requests.set(message.id, record);
        if (!String(message.query || '').trim()) return;
        try {
            record.items = await spec.provider(String(message.query).slice(0, 100), scope);
            if (!scope.alive || !this.isOpen) return;
            this.send({cmd: 'results', id: message.id, request: message.request,
                items: record.items.slice(0, 6).map(item => ({name: String(item.name), detail: String(item.detail || '')}))});
        } catch (error) { if (scope.alive && this.isOpen) this.send({cmd: 'results', id: message.id, request: message.request, error: error.message}); }
    }
    async action(message) {
        const spec = this.specs[Number(message.id)]; if (spec?.type !== 'button') return;
        this.acceptRaw(message.values);
        const finish = text => { if (this.isOpen) this.send({cmd: 'action-result', id: message.id, request: message.request, text}); };
        try { finish(await spec.onClick(this) || _("Done. Click OK to save.")); }
        catch (error) { finish(error.message); }
    }
    apply(raw = this.raw) {
        if (!this.isOpen) return false;
        try {
            const patch = {...validateDraft(this.specs, this.initial, raw), ...this.extraValues};
            this.gadget.validateOptions?.({...this.gadget.options, ...patch});
            const rebuilds = patch.size !== undefined && patch.size !== this.gadget.size;
            this.gadget.save(patch);
            if (!rebuilds) this.gadget.refreshOptions();
            this.host.positionWidgets(); this.close(); return true;
        } catch (error) {
            this.lastError = error.message;
            this.send({cmd: 'error', message: error.message, key: error.key}); return false;
        }
    }
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.send({cmd: 'close'});
        try { this.output?.close(null); } catch { /* Closed with client exit. */ }
        this.output = null;
        for (const request of this.requests.values()) request.scope.destroy();
        this.requests.clear(); this.scope.destroy();
        for (const waiter of this.waiters) waiter.reject(new Error(_("Widget settings are closed")));
        this.waiters = [];
        if (this.process && !this.exited) this.killTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this.killTimer = 0; if (!this.exited) this.process.force_exit(); return GLib.SOURCE_REMOVE;
        });
        if (this.host.dialog === this) this.host.dialog = null;
    }
}
