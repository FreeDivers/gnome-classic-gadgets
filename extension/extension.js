// SPDX-License-Identifier: MIT
import './lib/i18n-runtime.js';
import {_, format} from './lib/i18n.js';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {GADGETS, SIZES, THEMES, THEME_NAMES, validTheme, sizeOf, enabledTypes, defaultLayout, fitPosition, clamp} from './lib/core.js';
import {Scope, Store, Network} from './lib/platform.js';
import {NetworkSources} from './lib/network-sources.js';
import {Theme} from './lib/theme.js';
import {createGadget, TOOLBAR_WIDTH} from './lib/original-widgets.js';
import {OptionsDialog} from './lib/ui/options-dialog.js';
import {Gallery} from './lib/ui/gallery.js';
import {ContextMenus} from './lib/ui/context-menu.js';
import {DBusService} from './lib/dbus.js';
import {DesktopMenuIntegration} from './lib/ui/desktop-menu.js';

// Stylesheets in these folders are loaded at enable time (lib/ui/ui.css, lib/gadgets/<type>.css).
const STYLESHEET_DIRS = ['lib/ui', 'lib/gadgets'];

export default class ClassicGadgets extends Extension {
    enable() {
        this.extension = this;
        this.scope = new Scope();
        this.settings = this.getSettings();
        this.store = new Store(this.settings);
        this.network = new Network();
        this.sources = new NetworkSources(this.network, this.scope, {previous: this.settings.get_string('last-network-region'),
            onDetected: region => this.settings.set_string('last-network-region', region)});
        const startupScope = this.scope;
        this.sources.ready.then(() => { if (startupScope.alive) this.syncMenu(); });
        this.theme = new Theme(this.path, this.settings.get_string('theme'));
        this.widgets = new Map();
        this.errors = [];
        this.stylesheets = [];
        this.loadStylesheets();
        this.layer = new St.Widget({name: 'classic-desktop-gadgets', layout_manager: new Clutter.FixedLayout(), reactive: false});
        global.window_group.add_child(this.layer);
        this.ui = {menus: new ContextMenus(this), gallery: new Gallery(this)};
        this.dialog = null;
        this.scope.connect(this.settings, 'changed::enabled-gadgets', () => { this.syncWidgets(); this.syncMenu(); });
        for (const key of ['scale', 'layout']) this.scope.connect(this.settings, `changed::${key}`, () => this.positionWidgets());
        this.scope.connect(this.settings, 'changed::options', () => { for (const widget of this.widgets.values()) widget.updateOptions(this.store.optionsFor(widget.type)); });
        this.scope.connect(this.settings, 'changed::visible', () => { this.syncVisibility(); this.syncMenu(); });
        this.scope.connect(this.settings, 'changed::locked', () => { this.finishDrag(); this.syncMenu(); });
        this.scope.connect(this.settings, 'changed::theme', () => this.applyTheme());
        this.scope.connect(global.display, 'restacked', () => this.restack());
        this.scope.connect(global.display, 'workareas-changed', () => this.positionWidgets());
        this.scope.connect(Main.layoutManager, 'monitors-changed', () => this.positionWidgets());
        this.scope.connect(Main.overview, 'showing', () => this.syncVisibility());
        this.scope.connect(Main.overview, 'hidden', () => this.syncVisibility());
        this.scope.connect(Main.sessionMode, 'updated', () => this.syncVisibility());
        this.scope.connect(global.stage, 'captured-event', (_actor, event) => {
            const type = event.type();
            if (type === Clutter.EventType.KEY_PRESS) {
                if (this.drag && event.get_key_symbol() === Clutter.KEY_Escape) { this.finishDrag(false); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }
            return type === Clutter.EventType.BUTTON_PRESS ? this.onStagePress(event) : Clutter.EVENT_PROPAGATE;
        });
        this.buildMenu();
        this.syncWidgets();
        this.syncVisibility();
        this.dbus = new DBusService(this);
        this.desktopMenu = new DesktopMenuIntegration(this);
    }
    workareas() {
        const workspace = global.workspace_manager.get_active_workspace();
        return Main.layoutManager.monitors.map(m => workspace.get_work_area_for_monitor(m.index));
    }
    // --- runtime stylesheets -------------------------------------------------------------
    loadStylesheets() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        for (const dir of STYLESHEET_DIRS) {
            const folder = Gio.File.new_for_path(`${this.path}/${dir}`);
            let enumerator;
            try { enumerator = folder.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null); } catch { continue; }
            const names = [];
            let info;
            while ((info = enumerator.next_file(null))) if (info.get_file_type() === Gio.FileType.REGULAR && info.get_name().endsWith('.css')) names.push(info.get_name());
            enumerator.close(null);
            for (const name of names.sort()) {
                const file = folder.get_child(name);
                try { theme.load_stylesheet(file); this.stylesheets.push(file); } catch (e) { console.error(format(_("Windows Vista/7 Widgets: failed to load stylesheet {directory}/{file}"), {directory: dir, file: name}), e); }
            }
        }
    }
    unloadStylesheets() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        for (const file of this.stylesheets ?? []) { try { theme.unload_stylesheet(file); } catch { /* Already unloaded with a theme reload. */ } }
        this.stylesheets = [];
    }
    // --- themes ---------------------------------------------------------------------------
    applyTheme() {
        const name = validTheme(this.settings.get_string('theme'));
        this.closeOptions();
        if (this.theme?.name === name) return;
        this.theme = new Theme(this.path, name);
        this.finishDrag();
        for (const [type, widget] of this.widgets) {
            try { widget.rebuild(); } catch (e) {
                this.errors.push(`${type}: ${e.message}`);
                console.error(`Windows Vista/7 Widgets: ${type}`, e);
                Main.notify(_("Windows Vista/7 Widgets"), format(_("Could not change the appearance of {widget}: {error}"), {widget: GADGETS[type].name, error: e.message}));
            }
        }
        this.syncMenu();
    }
    setTheme(name) { this.settings.set_string('theme', validTheme(name)); }
    // --- gadgets --------------------------------------------------------------------------
    syncWidgets() {
        const enabled = enabledTypes(this.settings.get_strv('enabled-gadgets'));
        for (const [type, widget] of this.widgets) {
            if (enabled.includes(type)) continue;
            if (this.drag?.widget === widget) this.finishDrag();
            if (this.dialog?.gadget === widget) this.closeOptions();
            this.widgets.delete(type);
            widget.destroy();
        }
        for (const type of enabled) {
            if (this.widgets.has(type)) continue;
            try {
                const widget = createGadget(this, type);
                this.widgets.set(type, widget); this.layer.add_child(widget.actor);
            } catch (e) {
                this.errors.push(`${type}: ${e.message}`);
                console.error(`Windows Vista/7 Widgets: ${type}`, e);
                Main.notify(_("Windows Vista/7 Widgets"), format(_("Could not load {widget}: {error}"), {widget: GADGETS[type].name, error: e.message}));
            }
        }
        this.positionWidgets(); this.restack();
    }
    enableGadget(type) {
        const current = this.settings.get_strv('enabled-gadgets');
        if (!current.includes(type)) this.settings.set_strv('enabled-gadgets', enabledTypes([...current, type]));
    }
    remove(type) { this.settings.set_strv('enabled-gadgets', this.settings.get_strv('enabled-gadgets').filter(value => value !== type)); }
    /** Enables `type` (or moves it when already on the desktop) so its top-left corner lands at the stage point, clamped to that monitor's work area. */
    addGadgetAt(type, stageX, stageY) {
        if (!Object.hasOwn(GADGETS, type)) throw new Error(format(_("Unknown widget: {type}"), {type: type}));
        const areas = this.workareas();
        let monitor = areas.findIndex(area => stageX >= area.x && stageX < area.x + area.width && stageY >= area.y && stageY < area.y + area.height);
        monitor = clamp(monitor, 0, Math.max(0, areas.length - 1));
        const area = areas[monitor] || {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
        const widget = this.widgets.get(type), meta = GADGETS[type];
        const dims = widget ? {width: widget.actor.width * clamp(Number(widget.options.scale) || 1, 0.5, 3), height: widget.actor.height * clamp(Number(widget.options.scale) || 1, 0.5, 3)} : (sizeOf(type, this.store.optionsFor(type)) === 'large' ? {width: meta.large.width + TOOLBAR_WIDTH, height: meta.large.height} : {width: meta.width + TOOLBAR_WIDTH, height: meta.height});
        const scale = widget ? widget.actor.get_scale()[0] : this.settings.get_double('scale');
        this.store.savePosition(type, {monitor, x: clamp(Math.round(stageX - area.x), 0, Math.max(0, area.width - dims.width * scale)), y: clamp(Math.round(stageY - area.y), 0, Math.max(0, area.height - dims.height * scale))});
        if (widget) this.positionWidgets(); else this.enableGadget(type);
    }
    setSize(type, size) {
        if (!Object.hasOwn(GADGETS, type)) throw new Error(format(_("Unknown widget: {type}"), {type: type}));
        if (!SIZES.includes(size)) throw new Error(format(_("Invalid size: {size}"), {size: size}));
        if (!GADGETS[type].large) return false;
        const widget = this.widgets.get(type);
        if (widget) widget.setSize(size); else this.store.saveOptions(type, {size});
        return true;
    }
    positionWidgets() {
        if (!this.layer || this.drag) return;
        this.layer.set_size(global.stage.width, global.stage.height);
        const areas = this.workareas();
        if (!areas.length) return;
        const scale = this.settings.get_double('scale');
        const defaults = defaultLayout([...this.widgets.keys()], areas[0], scale, Object.fromEntries([...this.widgets].map(([type, widget]) => [type, {width: widget.actor.width * clamp(Number(widget.options.scale) || 1, 0.5, 3), height: widget.actor.height * clamp(Number(widget.options.scale) || 1, 0.5, 3)}])));
        const layout = this.store.layout;
        let index = 0;
        for (const widget of this.widgets.values()) {
            // Also scale down very small displays so a gadget never becomes unreachable.
            const targetMonitor = clamp(Math.trunc(layout[widget.type]?.monitor || 0), 0, areas.length - 1);
            const targetArea = areas[targetMonitor];
            const ownScale = clamp(Number(widget.options.scale) || 1, 0.5, 3);
            const effectiveScale = Math.min(scale * ownScale, targetArea.width / widget.actor.width, targetArea.height / widget.actor.height);
            widget.actor.set_scale(effectiveScale, effectiveScale);
            const p = fitPosition(layout[widget.type] || defaults[widget.type], areas, widget.actor.width * effectiveScale, widget.actor.height * effectiveScale, index++);
            widget.actor.set_position(p.stageX, p.stageY);
        }
        this.restack();
    }
    restack() {
        if (!this.layer?.get_parent()) return;
        let anchor = Main.layoutManager._backgroundGroup;
        for (const child of global.window_group.get_children()) {
            const window = child.get_meta_window?.();
            if (!window) continue;
            const desktop = window.get_window_type() === Meta.WindowType.DESKTOP || window.customJS_ding?._keepAtBottom || window.get_wm_class()?.toLowerCase() === 'com.rastersoft.ding';
            if (desktop) anchor = child;
        }
        if (anchor?.get_parent() === global.window_group) global.window_group.set_child_above_sibling(this.layer, anchor);
        else global.window_group.set_child_below_sibling(this.layer, null);
    }
    syncVisibility() {
        if (!this.layer) return;
        const visible = this.settings.get_boolean('visible') && !Main.overview.visible && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        if (!visible) {
            this.finishDrag();
            const focus = global.stage.get_key_focus();
            if (focus && this.layer.contains(focus)) global.stage.set_key_focus(null);
        }
        this.layer.visible = visible;
    }
    // --- host UI delegations (lib/ui/*) ---------------------------------------------------
    openOptions(gadget) {
        this.closeOptions();
        this.dialog = new OptionsDialog(this, gadget);
        this.dialog.open();
    }
    closeOptions() { const dialog = this.dialog; this.dialog = null; dialog?.close(); }
    showGallery() { this.ui?.gallery.show(); }
    hideGallery() { this.ui?.gallery.hide(); }
    openContextMenu(gadget, x, y) { this.finishDrag(); this.ui?.menus.openGadgetMenu(gadget, x, y); }
    /** Returns true when the menu module showed a desktop menu (false with the phase-1 stub). */
    openDesktopMenu(x, y) { return !!this.ui?.menus.openDesktopMenu(x, y); }
    /**
     * Right-click on the bare desktop background (no DING desktop window in front) → desktop menu.
     * This runs in the stage's capture phase on purpose: GNOME Shell's own BackgroundMenu is a
     * Clutter.ClickGesture with recognize_on_press on every Meta.BackgroundActor, so the press never
     * bubbles up to a stage 'button-press-event', and event.get_source() is still null while
     * capturing — the target comes from global.stage.get_event_actor(). Stopping the event here is
     * what keeps the shell's 「更改背景…」 menu closed while ours is open; when no menu module handles
     * the click (stub) the event propagates and the shell's menu appears as before.
     */
    onStagePress(event) {
        if (!this.settings.get_boolean('desktop-menu')) return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== 3 || this.drag || Main.overview.visible || Main.sessionMode.isLocked) return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event), background = Main.layoutManager._backgroundGroup;
        if (target !== global.stage && !(background && target && background.contains(target))) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        return this.openDesktopMenu(x, y) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }
    // --- dragging -------------------------------------------------------------------------
    makeDraggable(widget, surface = widget.header) {
        const scope = widget.frameScope || widget.scope;
        scope.connect(surface, 'button-press-event', (_actor, event) => {
            if (event.get_button() !== 1 || this.settings.get_boolean('locked')) return Clutter.EVENT_PROPAGATE;
            let source = event.get_source();
            while (source && source !== surface) {
                if (source instanceof St.Button || source instanceof St.Entry || source instanceof St.ScrollView) return Clutter.EVENT_PROPAGATE;
                source = source.get_parent();
            }
            this.finishDrag();
            const [x, y] = event.get_coords();
            this.drag = {widget, surface, x, y, originalX: widget.actor.x, originalY: widget.actor.y, grab: global.stage.grab(surface)};
            widget.actor.add_style_class_name('og-dragging');
            return Clutter.EVENT_STOP;
        });
        scope.connect(surface, 'motion-event', (_actor, event) => {
            if (this.drag?.surface !== surface) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            widget.actor.set_position(this.drag.originalX + x - this.drag.x, this.drag.originalY + y - this.drag.y);
            return Clutter.EVENT_STOP;
        });
        scope.connect(surface, 'button-release-event', (_actor, event) => {
            if (event.get_button() !== 1 || this.drag?.surface !== surface) return Clutter.EVENT_PROPAGATE;
            this.finishDrag(); return Clutter.EVENT_STOP;
        });
    }
    /** Persists the actor's current top-left corner (work-area relative) when it differs from the stored layout. */
    savePositionOf(widget) {
        const areas = this.workareas();
        if (!areas.length) return;
        const [scale] = widget.actor.get_scale();
        const width = widget.actor.width * scale, height = widget.actor.height * scale;
        const cx = widget.actor.x + width / 2, cy = widget.actor.y + Math.min(height / 2, 40);
        let monitor = areas.findIndex(area => cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height);
        monitor = clamp(monitor, 0, areas.length - 1);
        const area = areas[monitor];
        const position = {monitor, x: clamp(Math.round(widget.actor.x - area.x), 0, Math.max(0, area.width - width)), y: clamp(Math.round(widget.actor.y - area.y), 0, Math.max(0, area.height - height))};
        const stored = this.store.layout[widget.type];
        if (!stored || stored.monitor !== position.monitor || stored.x !== position.x || stored.y !== position.y) this.store.savePosition(widget.type, position);
    }
    finishDrag(save = true) {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        drag.grab.dismiss();
        const widget = drag.widget;
        widget.actor.remove_style_class_name('og-dragging');
        if (!save) widget.actor.set_position(drag.originalX, drag.originalY);
        else this.savePositionOf(widget);
        this.positionWidgets();
    }
    // --- panel menu -----------------------------------------------------------------------
    buildMenu() {
        this.indicator = new PanelMenu.Button(0.0, _("Windows Vista/7 Widgets"));
        this.indicator.add_child(new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'}));
        this.indicator.accessible_name = _("Windows Vista/7 Widgets");
        Main.panel.addToStatusArea(this.uuid, this.indicator);
        this.syncMenu();
    }
    syncMenu() {
        if (!this.indicator) return;
        this.indicator.menu.removeAll();
        const heading = new PopupMenu.PopupMenuItem(_("Windows Vista/7 Widgets"), {reactive: false});
        this.indicator.menu.addMenuItem(heading);
        this.indicator.menu.addMenuItem(new PopupMenu.PopupMenuItem(this.sources.description, {reactive: false}));
        this.indicator.menu.addAction(_("Add Widgets…"), () => this.showGallery());
        const visible = new PopupMenu.PopupSwitchMenuItem(_("Show widgets"), this.settings.get_boolean('visible'));
        visible.connect('toggled', (_item, state) => this.settings.set_boolean('visible', state)); this.indicator.menu.addMenuItem(visible);
        const locked = new PopupMenu.PopupSwitchMenuItem(_("Lock positions"), this.settings.get_boolean('locked'));
        locked.connect('toggled', (_item, state) => this.settings.set_boolean('locked', state)); this.indicator.menu.addMenuItem(locked);
        const appearance = new PopupMenu.PopupSubMenuMenuItem(_("Appearance"));
        for (const name of THEMES) {
            const item = new PopupMenu.PopupMenuItem(THEME_NAMES[name]);
            item.setOrnament(this.theme.name === name ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this.setTheme(name));
            appearance.menu.addMenuItem(item);
        }
        this.indicator.menu.addMenuItem(appearance);
        this.indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const enabled = this.settings.get_strv('enabled-gadgets');
        const toggles = new PopupMenu.PopupSubMenuMenuItem(_("Add or remove widgets"));
        for (const [type, metadata] of Object.entries(GADGETS)) {
            const item = new PopupMenu.PopupSwitchMenuItem(metadata.name, enabled.includes(type));
            item.connect('toggled', (_item, state) => {
                const current = this.settings.get_strv('enabled-gadgets');
                this.settings.set_strv('enabled-gadgets', state ? enabledTypes([...current, type]) : current.filter(value => value !== type));
            });
            toggles.menu.addMenuItem(item);
        }
        this.indicator.menu.addMenuItem(toggles);
        this.indicator.menu.addAction(_("Arrange automatically"), () => this.settings.set_string('layout', '{}'));
        this.indicator.menu.addAction(_("Extension Settings…"), () => this.openPreferences());
    }
    disable() {
        this.desktopMenu?.destroy(); this.desktopMenu = null;
        this.finishDrag();
        this.closeOptions();
        this.ui?.gallery.destroy(); this.ui?.menus.destroy(); this.ui = null;
        this.dbus?.destroy(); this.dbus = null;
        this.scope?.destroy();
        if (this.widgets) for (const widget of this.widgets.values()) widget.destroy();
        this.widgets?.clear();
        this.network?.destroy();
        this.indicator?.destroy();
        this.layer?.destroy();
        this.unloadStylesheets();
        this.layer = null; this.indicator = null; this.settings = null; this.store = null; this.network = null; this.sources = null; this.scope = null; this.theme = null;
    }
}
