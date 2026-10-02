// SPDX-License-Identifier: MIT
import {_, format} from './i18n.js';
/**
 * Gadget base class and St helpers — the contract every lib/gadgets/<type>.js
 * module is written against (design.md §3). Read this file completely before
 * writing a gadget; the host (extension.js) and the UI modules (lib/ui/*) only
 * ever talk to a gadget through the members documented here.
 *
 * ## Lifecycle
 *
 *   createGadget(host, type)  →  new X(host, type)  →  init()  →  build()
 *   options change            →  updateOptions(options) → refreshOptions() (or rebuild() when `size` changed)
 *   size / theme change       →  rebuild()  (tears the body down and calls build() again)
 *   removal / disable         →  destroy()
 *
 * - `constructor(host, type)`: creates the frame only (actor, body, toolbar). Never
 *   override it; put everything into `build()`.
 * - `build()` (subclass MUST implement): create every child of `this.body` for the
 *   current `this.large` / `this.options` / `this.host.theme`. It is called again on
 *   every `rebuild()`, so it must not rely on state left by a previous build (see
 *   `this.scope` below). Do not call `build()` yourself.
 * - `rebuild()`: `beforeDestroy?.()` → destroy `this.scope` (timers, signals, the
 *   cancellable) and create a fresh one → destroy every child of `this.body` and every
 *   toolbar button added after the base ones → reset `size`, `width`, `height` from
 *   `GADGETS[type]` (small) or `GADGETS[type].large` → `build()` → `hover?.(false)` →
 *   `host.positionWidgets()`. The actor keeps its top-left corner (clamped to the work
 *   area). The host calls it when the theme changes; `save({size})` / `setSize()` call
 *   it when the size changes.
 * - `destroy()`: `beforeDestroy?.()`, destroys both scopes and the actor.
 *
 * ## Fields
 *
 *   host       the extension instance: host.store, host.network, host.theme, host.settings,
 *              host.openOptions(gadget), host.openContextMenu(gadget, x, y), host.remove(type),
 *              host.setSize(type, size), host.positionWidgets(), host.workareas(), host.notify?
 *   type       'clock' | 'calendar' | … (key of GADGETS)
 *   options    current options ({...DEFAULT_OPTIONS[type], ...stored}); read-only — change
 *              it with save(patch)
 *   scope      Scope for everything created in build(): `this.scope.later(ms, cb, repeat)`,
 *              `this.scope.connect(obj, signal, cb)`, `this.scope.cancellable`. It is destroyed
 *              and replaced on every rebuild()/destroy(), which is what makes rebuild() leak-free.
 *   frameScope Scope owned by the base class for the toolbar/hover/drag/context-menu wiring
 *              (lives as long as the gadget). Subclasses normally do not need it.
 *   actor      the whole gadget (body + hover toolbar); positioned by the host
 *   body       the original skin area (the drag surface); all skin children go here
 *   header     alias of body (kept for older code)
 *   toolbar    St.BoxLayout on the right, shown on hover; base order (top→bottom): close,
 *              size (only if GADGETS[type].large exists), options, drag handle. Add extra
 *              buttons from build() with `this.toolButton(text|iconName, name, cb)`; they are
 *              removed automatically on rebuild().
 *   size       'small' | 'large' (from options.size; always 'small' without a `large` definition)
 *   large      boolean, size === 'large'
 *   width/height  current logical size of body (docked skin, or GADGETS[type].large)
 *
 * ## Methods
 *
 *   asset(path, folder = this.type)   absolute path for a skin file; `folder` is a type key
 *                                     (FOLDERS[type]) or a folder name ('Clock'). Resolves to
 *                                     assets/fluent/… when the fluent theme is active and the
 *                                     file was imported, else assets/original/….
 *   picture(path, x, y, w, h, parent = this.body, folder = this.type)   St.Widget with the image
 *   setPicture(actor, path, folder)   swap the image of a picture()/spriteButton() actor (the
 *                                     actor's current width/height define background-size)
 *   text(text, x, y, w, h, style = '', parent = this.body)   St.Label (og-label + style)
 *   button(text, x, y, w, h, callback, style = '')           St.Button (og-action + style)
 *   spriteButton(path, x, y, w, h, name, callback)           St.Button drawn with a skin image
 *   toolButton(iconOrText, name, callback)                   extra hover-toolbar button
 *   resize(w, h)               change body/actor size (e.g. calculator history view) and re-layout
 *   setSize('small'|'large')   save + rebuild (no-op without a `large` definition)
 *   save(patch)                merge into options, persist through host.store; if `size`
 *                              changed this rebuilds immediately
 *   updateOptions(options)     host calls this when GSettings change externally
 *
 * ## Optional hooks (implement in the subclass as needed)
 *
 *   hover(state)          pointer entered/left the gadget — show/hide skin controls
 *   refreshOptions()      options changed. Default: rebuild() if `options.size` changed since the
 *                         last build, else nothing. Overrides need not care about the size:
 *                         save(patch) and updateOptions() already rebuild on a size change before
 *                         (instead of) calling refreshOptions(). The options dialog calls it after
 *                         save(patch).
 *   beforeDestroy()       called right before the body is torn down (destroy() and rebuild())
 *   optionsSpec()         rows for the native GTK options window; default [] still offers scaling
 *                         and the size row when GADGETS[type].large exists. Supported types:
 *                         entry (optional number/multiline/format/parse/validate), combo,
 *                         picker (values/names/preview), switch, search, button, text.
 *                         Optional group/advanced/sensitiveWhen describe native layout.
 *                         Callbacks stay in Shell; the GTK process receives only data.
 *   contextMenuItems()    [{label, callback}] appended after 「设置…」 in the right-click menu
 *
 * ## Themes
 *
 * `this.host.theme.name` is 'classic' or 'fluent'; `this.host.theme.has(folderName, relPath)`
 * tells whether a fluent replacement exists. Skin paths do not change between themes; only
 * layout differences documented in fluent.md need code.
 *
 * All text goes through label()/text(); fonts are set in CSS. Every timer/signal goes through
 * `this.scope`; every request through `this.host.network.get(url, parser, scope, maxAge, force,
 * {headers})`. Chinese UI strings; no eval.
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {GADGETS, SIZES, sizeOf, clamp, finite} from './core.js';
import {Scope} from './platform.js';
import {styleText, fitLabel} from './typography.js';

export const TOOLBAR_WIDTH = 22;
/** Gadget type → original folder name (assets/<theme>/<Folder>.Gadget). */
export const FOLDERS = Object.freeze({clock: 'Clock', calendar: 'Calendar', system: 'CPU', notes: 'Notes', weather: 'Weather', photos: 'SlideShow', calculator: 'Calculator', timer: 'Timer', puzzle: 'PicturePuzzle', rss: 'RSSFeeds', currency: 'Currency', stocks: 'Stocks', contacts: 'Contacts', trash: 'RecycleBin'});
export function folderOf(folder) { return FOLDERS[folder] ?? folder; }

export function label(text = '', style = '', props = {}) {
    const actor = new St.Label({text: String(text), style_class: `og-label ${style}`, ...props});
    actor.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    return styleText(actor, {numeric: style.split(/\s+/).includes('og-numeric')});
}
export function place(parent, actor, x, y, w, h) {
    actor.set_position(x, y);
    if (w !== undefined) actor.width = w;
    if (h !== undefined) actor.height = h;
    parent.add_child(actor); return actor;
}
export function action(text, callback, props = {}) {
    const actor = new St.Button({label: text, can_focus: true, style_class: 'og-action', ...props});
    actor.connect('clicked', callback); return actor;
}
export function surface(w, h, props = {}) { return new St.Widget({layout_manager: new Clutter.FixedLayout(), width: w, height: h, ...props}); }

export class Gadget {
    constructor(host, type) {
        this.host = host; this.type = type; this.options = host.store.optionsFor(type);
        this.frameScope = new Scope(); this.scope = new Scope();
        this.size = sizeOf(type, this.options);
        const dims = this.dimensions(); this.width = dims.width; this.height = dims.height;
        this.actor = surface(this.width + TOOLBAR_WIDTH, this.height, {style_class: `og-gadget og-${type}`, reactive: true, track_hover: true, accessible_name: GADGETS[type].name});
        this.body = surface(this.width, this.height, {style_class: 'og-body', reactive: true});
        this.header = this.body; // the original skin itself is the drag surface
        this.actor.add_child(this.body);
        this.toolbar = new St.BoxLayout({vertical: true, style_class: 'og-toolbar', opacity: 0});
        place(this.actor, this.toolbar, this.width + 1, 0, 20);
        this.tools = {close: this.toolButton('window-close-symbolic', _("Close"), () => host.remove(type))};
        if (GADGETS[type].large) this.tools.size = this.toolButton('view-fullscreen-symbolic', _("Large"), () => this.setSize(this.large ? 'small' : 'large'));
        this.tools.options = this.toolButton('emblem-system-symbolic', _("Settings"), () => host.openOptions(this));
        this.tools.handle = new St.Bin({child: new St.Icon({icon_name: 'list-drag-handle-symbolic', icon_size: 12}), style_class: 'og-tool og-drag-handle', reactive: true, track_hover: true, accessible_name: _("Drag")});
        this.toolbar.add_child(this.tools.handle);
        this.baseTools = this.toolbar.get_n_children();
        this.syncSizeTool();
        this.frameScope.connect(this.actor, 'notify::hover', () => { this.toolbar.opacity = this.actor.hover ? 255 : 0; this.hover?.(this.actor.hover); });
        for (const actor of [this.body, this.toolbar]) {
            this.frameScope.connect(actor, 'button-press-event', (_actor, event) => {
                if (event.get_button() !== 3) return Clutter.EVENT_PROPAGATE;
                const [x, y] = event.get_coords();
                host.openContextMenu(this, x, y); return Clutter.EVENT_STOP;
            });
        }
        host.makeDraggable(this); host.makeDraggable(this, this.tools.handle);
    }
    get large() { return this.size === 'large'; }
    /** Logical body size for the current `size`. */
    dimensions() { const meta = GADGETS[this.type]; return this.size === 'large' && meta.large ? {width: meta.large.width, height: meta.large.height} : {width: meta.width, height: meta.height}; }
    toolButton(icon, name, callback) {
        const symbolic = /^[a-z0-9-]+-symbolic$/.test(icon);
        const button = new St.Button({accessible_name: name, can_focus: true, style_class: 'og-tool', ...(symbolic ? {child: new St.Icon({icon_name: icon, icon_size: 12})} : {label: icon})});
        button.connect('clicked', callback); this.toolbar.add_child(button); return button;
    }
    syncSizeTool() {
        const tool = this.tools.size; if (!tool) return;
        tool.child.icon_name = this.large ? 'view-restore-symbolic' : 'view-fullscreen-symbolic';
        tool.accessible_name = this.large ? _("Small") : _("Large");
    }
    styleBody() { this.body.set_style_class_name(`og-body ${this.large ? 'og-large' : ''} ${this.host.theme.name === 'fluent' ? 'og-fluent' : ''}`); }
    init() { this.styleBody(); this.build(); this.wireEntries(); this.applyOpacity(); return this; }
    build() { throw new Error(format(_("{type}: build() is not implemented"), {type: this.type})); }
    wireEntries() {
        const wire = actor => {
            if (actor instanceof St.Entry) {
                // An empty ClutterText has no glyph pick region on GNOME 50.
                // St.Entry's padding still receives the click; focus its text
                // explicitly, without eating cursor/selection events on glyphs.
                actor.reactive = true;
                actor.clutter_text.reactive = true;
                this.scope.connect(actor, 'button-press-event', (entry, event) => {
                    if (event.get_button() === 1) entry.clutter_text.grab_key_focus();
                    return Clutter.EVENT_PROPAGATE;
                });
            }
            for (const child of actor.get_children()) wire(child);
        };
        wire(this.body);
    }
    rebuild() {
        const host = this.host;
        if (host.drag?.widget === this) host.finishDrag();
        host.savePositionOf?.(this); // keep the top-left corner across the size change
        const focus = global.stage.get_key_focus(); if (focus && this.body.contains(focus)) global.stage.set_key_focus(null);
        this.beforeDestroy?.();
        this.requestScope?.destroy(); this.requestScope = null;
        this.scope.destroy(); this.scope = new Scope();
        for (const extra of this.toolbar.get_children().slice(this.baseTools)) extra.destroy();
        this.body.destroy_all_children();
        this.size = sizeOf(this.type, this.options);
        const dims = this.dimensions(); this.resize(dims.width, dims.height);
        this.syncSizeTool(); this.styleBody();
        this.build(); this.wireEntries();
        this.hover?.(false);
        host.positionWidgets();
    }
    setSize(size) {
        if (!GADGETS[this.type].large || !SIZES.includes(size)) return;
        if (size !== this.options.size) this.save({size}); else this.applySize();
    }
    /** Rebuilds when the stored size differs from the built one; returns true if it did. */
    applySize() {
        if (sizeOf(this.type, this.options) === this.size) return false;
        this.rebuild(); return true;
    }
    applyOpacity() { this.actor.opacity = Math.round(255 * clamp(finite(Number(this.options.opacity), 100), 20, 100) / 100); }
    asset(path, folder = this.type) { return this.host.theme.resolve(folderOf(folder), path); }
    picture(path, x = 0, y = 0, w = this.width, h = this.height, parent = this.body, folder = this.type) {
        const actor = new St.Widget({style_class: 'og-image', width: w, height: h});
        this.setPicture(actor, path, folder); return place(parent, actor, x, y, w, h);
    }
    setPicture(actor, path, folder = this.type) {
        const filePath = this.asset(path, folder);
        this.host.validatedAssets ??= new Set();
        if (!this.host.validatedAssets.has(filePath)) {
            if (!Gio.File.new_for_path(filePath).query_exists(null)) throw new Error(format(_("Missing asset: {path}"), {path: filePath}));
            this.host.validatedAssets.add(filePath);
        }
        actor.originalAsset = `${folderOf(folder)}.Gadget/${path}`;
        actor.assetPath = filePath;
        actor.set_style(`background-image: url("${GLib.filename_to_uri(filePath, null)}"); background-size: ${actor.width}px ${actor.height}px;`);
    }
    text(text, x, y, w, h, style = '', parent = this.body) {
        const actor = place(parent, label(text, style), x, y, w, h);
        if (style.split(/\s+/).includes('og-numeric')) fitLabel(this.scope, actor, {numeric: true, minimum: style.includes('og-meter-value') ? 9 : 10});
        return actor;
    }
    button(text, x, y, w, h, callback, style = '') { return place(this.body, action(text, callback, {style_class: `og-action ${style}`}), x, y, w, h); }
    spriteButton(path, x, y, w, h, name, callback) {
        const button = action('', callback, {accessible_name: name, style_class: 'og-sprite-button'});
        place(this.body, button, x, y, w, h); this.setPicture(button, path); return button;
    }
    resize(w, h) {
        this.width = w; this.height = h; this.body.set_size(w, h); this.actor.set_size(w + TOOLBAR_WIDTH, h); this.toolbar.x = w + 1;
        this.host.positionWidgets();
    }
    save(patch) {
        this.options = {...this.options, ...patch}; this.host.store.saveOptions(this.type, patch);
        if (Object.hasOwn(patch, 'opacity')) this.applyOpacity();
        this.applySize();
    }
    updateOptions(options) {
        if (JSON.stringify(options) === JSON.stringify(this.options)) return;
        this.options = options; this.applyOpacity();
        if (!this.applySize()) this.refreshOptions?.();
    }
    /** Default: rebuild when `options.size` changed since the last build (see applySize); otherwise nothing. */
    refreshOptions() { this.applySize(); }
    optionsSpec() { return []; }
    contextMenuItems() { return []; }
    destroy() {
        const focus = global.stage.get_key_focus(); if (focus && this.actor.contains(focus)) global.stage.set_key_focus(null);
        this.beforeDestroy?.(); this.requestScope?.destroy(); this.scope.destroy(); this.frameScope.destroy(); this.actor.destroy();
    }
}
