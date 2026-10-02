// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_, format} from '../lib/i18n.js';
// Actual GTK4/libadwaita per-gadget window. Never imported by GNOME Shell.
// No hard-coded light/dark palette: native rows, buttons, popovers, text views
// and error states inherit the system's appearance and accessibility settings.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {choiceIndex} from '../lib/ui/ui-logic.js';

function label(text, classes = []) {
    return new Gtk.Label({label: text || '', wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR, xalign: 0, css_classes: classes});
}
function margins(widget, size) {
    for (const edge of ['top', 'bottom', 'start', 'end']) widget[`margin_${edge}`] = size;
    return widget;
}
export class OptionsWindow {
    constructor(config, emit) {
        this.config = config; this.emit = emit; this.rows = new Map(); this.values = {};
        this.groups = new Map(); this.expanders = new Map(); this.alive = true; this.updating = false;
        this.styleManager = Adw.StyleManager.get_default();
        this.interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const syncAppearance = () => {
            const scheme = this.interfaceSettings.get_string('color-scheme');
            this.styleManager.set_color_scheme(scheme === 'prefer-dark' ? Adw.ColorScheme.FORCE_DARK : scheme === 'prefer-light' ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.DEFAULT);
        };
        this.appearanceSignal = this.interfaceSettings.connect('changed::color-scheme', syncAppearance);
        syncAppearance();
        this.window = new Adw.Window({title: config.title, default_width: 480,
            default_height: config.height ?? 650, resizable: true});
        this.toolbar = new Adw.ToolbarView();
        const header = new Adw.HeaderBar({title_widget: new Adw.WindowTitle({title: config.title})});
        this.toolbar.add_top_bar(header);
        this.content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 24,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24});
        this.clamp = new Adw.Clamp({maximum_size: 560, tightening_threshold: 460, child: this.content});
        this.scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.AUTOMATIC, child: this.clamp, vexpand: true});
        this.toolbar.set_content(this.scroll);
        for (const field of [...config.fields.filter(f => !f.advanced), ...config.fields.filter(f => f.advanced)]) this.addField(field);
        this.updateSensitivity();

        this.errorLabel = label('', ['error']); this.errorLabel.visible = false;
        const footerContent = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin_top: 12, margin_bottom: 12, margin_start: 18, margin_end: 18});
        footerContent.append(this.errorLabel);
        const buttons = new Gtk.Box({spacing: 12, halign: Gtk.Align.END});
        this.cancelButton = new Gtk.Button({label: _("Cancel"), width_request: 88});
        this.okButton = new Gtk.Button({label: _("OK"), width_request: 88, css_classes: ['suggested-action']});
        this.cancelButton.connect('clicked', () => this.requestClose());
        this.okButton.connect('clicked', () => { this.okButton.sensitive = false; this.emit({event: 'apply', values: this.snapshot()}); });
        buttons.append(this.cancelButton); buttons.append(this.okButton); footerContent.append(buttons);
        this.toolbar.add_bottom_bar(footerContent);
        this.toolbar.set_bottom_bar_style(Adw.ToolbarStyle.RAISED_BORDER);
        this.toasts = new Adw.ToastOverlay({child: this.toolbar}); this.window.set_content(this.toasts);
        this.window.set_default_widget(this.okButton);
        this.window.connect('close-request', () => { this.requestClose(); return true; });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, key, _code, modifiers) => {
            if ((modifiers & Gdk.ModifierType.CONTROL_MASK) && (key === Gdk.KEY_f || key === Gdk.KEY_F)) {
                const search = [...this.rows.values()].find(row => row.field.type === 'search');
                if (search) { search.control.grab_focus(); return true; }
            }
            if (key !== Gdk.KEY_Escape) return false;
            this.requestClose(); return true;
        });
        this.window.add_controller(keys);
        this.window.connect('map', () => this.emit({event: 'ready'}));
    }
    container(field) {
        const name = field.group || _("Widget Settings");
        if (!this.groups.has(name)) {
            const group = new Adw.PreferencesGroup({title: name});
            this.groups.set(name, group); this.content.append(group);
        }
        const group = this.groups.get(name);
        if (!field.advanced) return {add: widget => group.add(widget), group};
        const key = `${name}/${field.advanced}`;
        if (!this.expanders.has(key)) {
            const expander = new Adw.ExpanderRow({title: field.advanced, subtitle: _("Station ID and fallback coordinates"), use_markup: false});
            this.expanders.set(key, expander); group.add(expander);
        }
        const expander = this.expanders.get(key);
        return {add: widget => expander.add_row(widget), group, expander};
    }
    addField(field) {
        const container = this.container(field);
        const state = {field, container, searchId: 0, searchTimer: 0, actionId: 0};
        this.rows.set(field.key || field.id, state);
        if (field.key) this.values[field.key] = field.value;
        const change = value => {
            if (this.updating || !this.alive) return;
            this.values[field.key] = value; this.emit({event: 'change', key: field.key, value});
            state.row?.remove_css_class('error'); this.updateSensitivity();
        };
        if (field.type === 'text') {
            const old = container.group.description;
            container.group.description = [old, field.label].filter(Boolean).join('\n');
            return;
        }
        if (field.type === 'combo') {
            const row = new Adw.ComboRow({title: field.label || _("Options"), subtitle: field.hint || '', use_markup: false,
                model: Gtk.StringList.new((field.names ?? field.values).map(String)), selected: choiceIndex(field.values, field.value)});
            row.connect('notify::selected', () => change(field.values[row.selected]));
            state.row = state.control = row;
        } else if (field.type === 'switch') {
            const row = new Adw.SwitchRow({title: field.label, subtitle: field.hint || '', active: !!field.value, use_markup: false});
            row.connect('notify::active', () => change(row.active)); state.row = state.control = row;
        } else if (field.type === 'entry' && field.number) {
            const n = field.number;
            const adjustment = new Gtk.Adjustment({lower: n.min ?? -1e12, upper: n.max ?? 1e12,
                step_increment: n.step ?? (n.integer ? 1 : 0.05), page_increment: n.integer ? 10 : .25,
                value: Number(field.value) || 0});
            const row = new Adw.SpinRow({title: field.label, subtitle: field.hint || '', adjustment,
                digits: n.integer ? 0 : (n.digits ?? 2), numeric: true, use_markup: false});
            row.connect('notify::value', () => change(row.value)); state.row = state.control = row;
        } else if (field.type === 'entry' && field.multiline) {
            const box = margins(new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10}), 14);
            box.append(label(field.label));
            const view = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 10, bottom_margin: 10, left_margin: 10, right_margin: 10});
            view.buffer.set_text(String(field.value ?? ''), -1);
            const scroller = new Gtk.ScrolledWindow({min_content_height: 110, max_content_height: 220,
                propagate_natural_height: true, hscrollbar_policy: Gtk.PolicyType.NEVER, child: view, css_classes: ['frame']});
            box.append(scroller);
            if (field.hint) box.append(label(field.hint, ['dim-label', 'caption']));
            state.row = new Adw.PreferencesRow({child: box}); state.control = view;
            view.buffer.connect('changed', () => change(this.textValue(view)));
        } else if (field.type === 'entry') {
            const row = new Adw.EntryRow({title: field.label, text: String(field.value ?? ''), activates_default: true, use_markup: false});
            if (field.hint) row.tooltip_text = field.hint;
            row.connect('notify::text', () => change(row.text)); state.row = state.control = row;
        } else if (field.type === 'search') {
            const box = margins(new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10}), 12);
            const entry = new Gtk.SearchEntry({placeholder_text: field.placeholder || field.label, hexpand: true, tooltip_text: field.label});
            entry.text = String(field.value ?? ''); box.append(entry);
            state.row = new Adw.PreferencesRow({child: box}); state.control = entry;
            state.results = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, visible: false, css_classes: ['boxed-list']});
            box.append(state.results);
            entry.connect('notify::text', () => { change(entry.text); if (!this.updating) this.scheduleSearch(state); });
            entry.connect('activate', () => this.scheduleSearch(state, 0));
            const keys = new Gtk.EventControllerKey();
            keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            keys.connect('key-pressed', (_controller, key) => {
                if (key === Gdk.KEY_Return || key === Gdk.KEY_KP_Enter) { this.scheduleSearch(state, 0); return true; }
                const first = state.results.get_first_child();
                if (key === Gdk.KEY_Down && first?.activatable) { first.grab_focus(); return true; }
                return false;
            }); entry.add_controller(keys);
        } else if (field.type === 'picker') {
            const box = margins(new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10}), 16);
            box.append(label(field.label || _("Choose a style")));
            const line = new Gtk.Box({spacing: 20, halign: Gtk.Align.CENTER});
            state.previous = new Gtk.Button({icon_name: 'go-previous-symbolic', valign: Gtk.Align.CENTER, css_classes: ['circular'], tooltip_text: _("Previous style")});
            state.next = new Gtk.Button({icon_name: 'go-next-symbolic', valign: Gtk.Align.CENTER, css_classes: ['circular'], tooltip_text: _("Next style")});
            state.preview = new Gtk.Picture({alternative_text: format(_("{style} preview"), {style: field.label || _("Style")}), width_request: field.previewSize?.w ?? 130, height_request: field.previewSize?.h ?? 110, can_shrink: true, content_fit: Gtk.ContentFit.CONTAIN});
            line.append(state.previous); line.append(state.preview); line.append(state.next); box.append(line);
            state.caption = new Gtk.Label({css_classes: ['dim-label']}); box.append(state.caption);
            state.row = new Adw.PreferencesRow({child: box});
            const step = delta => { const index = (choiceIndex(field.values, this.values[field.key]) + delta + field.values.length) % field.values.length;
                change(field.values[index]); this.refreshPicker(state); };
            state.previous.connect('clicked', () => step(-1)); state.next.connect('clicked', () => step(1));
            this.refreshPicker(state);
        } else if (field.type === 'button') {
            const row = new Adw.ActionRow({title: field.label, subtitle: field.hint || '', use_markup: false, activatable: true});
            state.spinner = new Gtk.Spinner({visible: false, valign: Gtk.Align.CENTER}); row.add_suffix(state.spinner);
            state.control = new Gtk.Button({icon_name: field.icon || 'go-next-symbolic', valign: Gtk.Align.CENTER,
                tooltip_text: field.label, css_classes: ['flat']}); row.add_suffix(state.control);
            if (field.danger) row.add_css_class('error');
            const invoke = () => {
                if (state.busy) return;
                state.busy = true; this.actionStatus(state, field.progress || _("Working…"), true);
                this.emit({event: 'action', id: field.id, request: ++state.actionId, values: this.snapshot()});
            };
            row.connect('activated', invoke); state.control.connect('clicked', invoke); state.row = row;
        } else throw new Error(format(_("Unknown widget option type: {type}"), {type: field.type}));
        container.add(state.row);
    }
    textValue(view) { const b = view.buffer; return b.get_text(b.get_start_iter(), b.get_end_iter(), false); }
    refreshPicker(state) {
        const f = state.field, index = choiceIndex(f.values, this.values[f.key]);
        if (f.previews?.[index]) state.preview.set_file(Gio.File.new_for_path(f.previews[index]));
        state.caption.label = `${f.names?.[index] ?? f.values[index]}  ·  ${index + 1} / ${f.values.length}`;
    }
    snapshot() {
        for (const state of this.rows.values()) {
            if (state.control instanceof Adw.SpinRow) { state.control.update(); this.values[state.field.key] = state.control.value; }
        }
        return {...this.values};
    }
    set(key, value) {
        const state = this.rows.get(key); this.values[key] = value;
        if (!state) return;
        this.updating = true;
        const {field, control} = state;
        if (field.type === 'switch') control.active = !!value;
        else if (field.type === 'combo') control.selected = choiceIndex(field.values, value);
        else if (field.type === 'picker') this.refreshPicker(state);
        else if (control instanceof Adw.SpinRow) control.value = Number(value);
        else if (control instanceof Gtk.TextView) control.buffer.set_text(String(value ?? ''), -1);
        else control.text = String(value ?? '');
        this.updating = false; this.updateSensitivity();
    }
    updateSensitivity() {
        for (const state of this.rows.values()) {
            const condition = state.field.sensitiveWhen;
            if (condition) state.row.sensitive = this.values[condition.key] === condition.equals;
        }
    }
    clearResults(state) {
        for (let child = state.results.get_first_child(); child;) { const next = child.get_next_sibling(); state.results.remove(child); child = next; }
    }
    scheduleSearch(state, delay = 300) {
        if (state.searchTimer) GLib.Source.remove(state.searchTimer);
        state.searchTimer = 0; this.clearResults(state);
        const query = state.control.text.trim(), request = ++state.searchId;
        state.results.visible = !!query;
        if (!query) { this.emit({event: 'search', id: state.field.id, query: '', request}); return; }
        state.results.append(new Adw.ActionRow({title: _("Searching…"), use_markup: false}));
        state.searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            state.searchTimer = 0; this.emit({event: 'search', id: state.field.id, query, request}); return GLib.SOURCE_REMOVE;
        });
    }
    searchResults(state, message) {
        if (message.request !== state.searchId) return;
        this.clearResults(state);
        if (message.error || !message.items?.length) {
            state.results.append(new Adw.ActionRow({title: message.error ? _("Search failed") : _("No cities found"), subtitle: message.error || _("Search by city name or pinyin"), use_markup: false}));
            return;
        }
        message.items.slice(0, 6).forEach((item, index) => {
            const row = new Adw.ActionRow({title: item.name, subtitle: item.detail || '', activatable: true, focusable: true, receives_default: true, use_markup: false});
            row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
            const pick = () => {
                this.emit({event: 'pick', id: state.field.id, request: message.request, index});
                this.clearResults(state); state.results.visible = false;
                state.control.grab_focus();
            };
            row.connect('activated', pick);
            // The window's suggested/default button must not consume Return
            // while a search result has focus. Return selects the city only.
            const keys = new Gtk.EventControllerKey();
            keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            keys.connect('key-pressed', (_controller, key) => {
                if (![Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_space].includes(key)) return false;
                pick(); return true;
            }); row.add_controller(keys);
            state.results.append(row);
        });
    }
    actionStatus(state, text, busy = false) {
        state.busy = busy; state.spinner.visible = busy; state.spinner.spinning = busy;
        state.control.sensitive = !busy; state.row.activatable = !busy; state.row.subtitle = text;
    }
    reveal(state) {
        if (this.focusTimer) GLib.Source.remove(this.focusTimer);
        let attempts = 0;
        this.focusTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            if (!this.alive) { this.focusTimer = 0; return GLib.SOURCE_REMOVE; }
            if ((!state.row.get_mapped() || state.row.get_height() <= 0) && ++attempts < 8) return GLib.SOURCE_CONTINUE;
            state.control?.grab_focus();
            const [valid, bounds] = state.row.compute_bounds(this.clamp);
            if (valid) {
                const adjustment = this.scroll.vadjustment;
                adjustment.value = Math.max(adjustment.lower, Math.min(bounds.get_y() - 12, adjustment.upper - adjustment.page_size));
            }
            this.focusTimer = 0; return GLib.SOURCE_REMOVE;
        });
    }
    receive(message) {
        if (!this.alive) return;
        if (message.cmd === 'set') this.set(message.key, message.value);
        else if (message.cmd === 'results') {
            const state = [...this.rows.values()].find(row => row.field.id === message.id);
            if (state) this.searchResults(state, message);
        } else if (message.cmd === 'action-result') {
            const state = [...this.rows.values()].find(row => row.field.id === message.id);
            if (state && state.actionId === message.request) this.actionStatus(state, message.text);
        } else if (message.cmd === 'error') {
            this.okButton.sensitive = true; this.errorLabel.label = message.message; this.errorLabel.visible = true;
            const row = this.rows.get(message.key);
            if (row) { if (row.container.expander) row.container.expander.expanded = true; row.row.add_css_class('error'); this.reveal(row); }
        } else if (message.cmd === 'close') this.destroy();
    }
    present() { this.window.present(); }
    requestClose() { if (this.alive) { this.emit({event: 'closed'}); this.destroy(); } }
    destroy() {
        if (!this.alive) return; this.alive = false;
        for (const state of this.rows.values()) if (state.searchTimer) { GLib.Source.remove(state.searchTimer); state.searchTimer = 0; }
        if (this.focusTimer) { GLib.Source.remove(this.focusTimer); this.focusTimer = 0; }
        this.interfaceSettings.disconnect(this.appearanceSignal); this.window.destroy(); this.onDestroy?.();
    }
}
