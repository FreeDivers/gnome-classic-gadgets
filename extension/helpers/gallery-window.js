// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_} from '../lib/i18n.js';
// The actual native GTK4/libadwaita gadget shelf. The companion Shell controller
// validates actions and owns layout; this client only displays and emits intent.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {filterGadgets, pageItems, clampPage, pageCount} from '../lib/ui/ui-logic.js';

export const GALLERY_MIME = 'application/x-classic-desktop-gadget';
export const GALLERY_TITLE = _("Add Widgets");
const margins = (widget, n) => { for (const side of ['top', 'bottom', 'start', 'end']) widget[`margin_${side}`] = n; return widget; };
export class GalleryWindow {
    constructor(config, emit) {
        this.config = config; this.emit = emit; this.entries = config.entries; this.enabled = new Set(config.enabled);
        this.selected = config.selected || this.entries[0]?.type; this.page = 0; this.cells = new Map(); this.alive = true;
        this.styleManager = Adw.StyleManager.get_default();
        this.interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const sync = () => {
            const scheme = this.interfaceSettings.get_string('color-scheme');
            this.styleManager.set_color_scheme(scheme === 'prefer-dark' ? Adw.ColorScheme.FORCE_DARK : scheme === 'prefer-light' ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.DEFAULT);
        };
        this.appearanceSignal = this.interfaceSettings.connect('changed::color-scheme', sync); sync();
        this.window = new Adw.Window({title: GALLERY_TITLE, default_width: 780, default_height: 565, resizable: true});
        this.toolbar = new Adw.ToolbarView();
        this.header = new Adw.HeaderBar({title_widget: new Adw.WindowTitle({title: GALLERY_TITLE, subtitle: _("Desktop Widget Gallery")})});
        this.toolbar.add_top_bar(this.header);
        const content = margins(new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18}), 20);
        const controls = new Gtk.Box({spacing: 12});
        const paging = new Gtk.Box({css_classes: ['linked']});
        this.previous = new Gtk.Button({icon_name: 'go-previous-symbolic', tooltip_text: _("Previous page")});
        this.next = new Gtk.Button({icon_name: 'go-next-symbolic', tooltip_text: _("Next page")});
        paging.append(this.previous); paging.append(this.next); controls.append(paging);
        this.pageLabel = new Gtk.Label({css_classes: ['dim-label']}); controls.append(this.pageLabel);
        this.search = new Gtk.SearchEntry({placeholder_text: _("Search widgets"), hexpand: true}); controls.append(this.search);
        content.append(controls);
        this.grid = new Gtk.FlowBox({homogeneous: true, min_children_per_line: 2, max_children_per_line: 6,
            selection_mode: Gtk.SelectionMode.SINGLE, activate_on_single_click: false, row_spacing: 8, column_spacing: 8,
            valign: Gtk.Align.START});
        this.scroller = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true, child: this.grid, min_content_height: 170});
        this.empty = new Adw.StatusPage({title: _("No widgets found"), description: _("Search by name or English keyword"), icon_name: 'system-search-symbolic', visible: false, vexpand: true});
        content.append(this.scroller); content.append(this.empty);
        this.toolbar.set_content(content);
        const footer = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_top: 12, margin_bottom: 18, margin_start: 20, margin_end: 20});
        const actions = new Gtk.Box({spacing: 10});
        this.detailsButton = new Gtk.ToggleButton({label: _("Details"), css_classes: ['flat']}); actions.append(this.detailsButton);
        actions.append(new Gtk.Box({hexpand: true}));
        this.removeButton = new Gtk.Button({label: _("Remove"), tooltip_text: _("Remove from the desktop and keep its content")});
        this.addButton = new Gtk.Button({label: _("Add to Desktop"), css_classes: ['suggested-action']});
        actions.append(this.removeButton); actions.append(this.addButton); footer.append(actions);
        this.details = new Gtk.Revealer({transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN});
        const info = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        this.detailTitle = new Gtk.Label({xalign: 0, css_classes: ['heading']});
        this.detailText = new Gtk.Label({xalign: 0, wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR, css_classes: ['dim-label']});
        info.append(this.detailTitle); info.append(this.detailText); this.details.child = info; footer.append(this.details);
        footer.append(new Gtk.Label({label: _("Drag an icon to the desktop or double-click to add it. Drag an existing widget to move it."), xalign: 0,
            wrap: true, css_classes: ['dim-label', 'caption']}));
        this.toolbar.add_bottom_bar(footer); this.toolbar.set_bottom_bar_style(Adw.ToolbarStyle.RAISED_BORDER);
        this.toastOverlay = new Adw.ToastOverlay({child: this.toolbar}); this.window.set_content(this.toastOverlay);
        // Spacing only: all colours, focus, selection and hover styles remain native.
        this.css = new Gtk.CssProvider(); this.css.load_from_string('.classic-gallery-cell { padding: 12px 6px; border-radius: 12px; }');
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), this.css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this.previous.connect('clicked', () => { this.page--; this.render(); });
        this.next.connect('clicked', () => { this.page++; this.render(); });
        this.search.connect('notify::text', () => { this.page = 0; this.render(); });
        this.search.connect('activate', () => this.addSelected());
        this.addButton.connect('clicked', () => this.addSelected());
        this.removeButton.connect('clicked', () => { if (this.selected) this.emit({event: 'remove', type: this.selected}); });
        this.detailsButton.connect('toggled', () => { this.details.reveal_child = this.detailsButton.active; });
        this.grid.connect('selected-children-changed', () => {
            if (this.rendering) return;
            const child = this.grid.get_selected_children()[0]; if (child) { this.selected = child.gadgetType; this.updateSelection(); this.report(); }
        });
        this.grid.connect('child-activated', (_grid, child) => { this.selected = child.gadgetType; this.addSelected(); });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, key, _code, modifiers) => {
            if (key === Gdk.KEY_Escape) { if (!this.dragging) this.close(); return !this.dragging; }
            if ((modifiers & Gdk.ModifierType.CONTROL_MASK) && [Gdk.KEY_f, Gdk.KEY_F].includes(key)) { this.search.grab_focus(); return true; }
            return false;
        }); this.window.add_controller(keys);
        this.window.connect('close-request', () => { this.close(); return true; });
        this.window.connect('map', () => this.emit({event: 'ready'}));
        this.render();
    }
    image(path, size) {
        return new Gtk.Image({gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}), pixel_size: size,
            width_request: size, height_request: size, halign: Gtk.Align.CENTER});
    }
    cell(entry) {
        const child = new Gtk.FlowBoxChild({focusable: true, css_classes: ['classic-gallery-cell'], width_request: 108});
        child.gadgetType = entry.type;
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 7, valign: Gtk.Align.CENTER});
        const picture = this.image(entry.icon, 64); picture.update_property([Gtk.AccessibleProperty.LABEL], [entry.name]);
        box.append(picture); box.append(new Gtk.Label({label: entry.name, ellipsize: Pango.EllipsizeMode.END, max_width_chars: 11}));
        child.status = new Gtk.Label({label: this.enabled.has(entry.type) ? _("✓ Added") : ' ', css_classes: ['dim-label', 'caption']});
        box.append(child.status); child.child = box;
        const source = new Gtk.DragSource({actions: Gdk.DragAction.COPY});
        source.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        source.connect('prepare', () => {
            this.selected = entry.type; this.grid.select_child(child); this.updateSelection();
            const payload = {token: this.config.token, type: entry.type};
            return Gdk.ContentProvider.new_for_bytes(GALLERY_MIME, new GLib.Bytes(new TextEncoder().encode(JSON.stringify(payload))));
        });
        source.connect('drag-begin', (_source, drag) => {
            this.dragging = true; this.activeSource = source;
            // Let GtkDragSource own the native drag icon and its frame clock.
            // Manually parenting a Gtk.DragIcon widget can outlive its surface
            // when the shelf closes immediately after a successful drop.
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(entry.dragIcon || entry.icon, 96, 96, true);
            source.set_icon(Gdk.Texture.new_for_pixbuf(pixbuf), 48, 40);
            this.onDrag?.(true, entry.type);
            this.emit({event: 'drag-begin', type: entry.type, offsetX: 48, offsetY: 40});
        });
        source.connect('drag-cancel', (_source, _drag, reason) => { this.emit({event: 'drag-cancel', reason}); return false; });
        source.connect('drag-end', () => {
            this.dragging = false; this.activeSource = null; this.onDrag?.(false); this.emit({event: 'drag-end'});
            if (this.closePending) { this.closePending = false; GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { this.destroy(); return GLib.SOURCE_REMOVE; }); }
            if (this.pendingEntries) { this.entries = this.pendingEntries; this.pendingEntries = null; this.render(); }
        });
        child.add_controller(source); child.dragSource = source;
        return child;
    }
    render() {
        if (!this.alive || this.dragging) return;
        const items = filterGadgets(this.entries, this.search.text); this.page = clampPage(this.page, items.length);
        this.pageLabel.label = `${this.page + 1} / ${pageCount(items.length)}`;
        this.previous.sensitive = this.page > 0; this.next.sensitive = this.page + 1 < pageCount(items.length);
        this.rendering = true;
        for (let child = this.grid.get_first_child(); child;) { const next = child.get_next_sibling(); this.grid.remove(child); child = next; }
        this.cells.clear();
        const visible = pageItems(items, this.page);
        if (!visible.some(entry => entry.type === this.selected)) this.selected = visible[0]?.type ?? null;
        for (const entry of visible) { const cell = this.cell(entry); this.grid.append(cell); this.cells.set(entry.type, cell); }
        if (this.selected) this.grid.select_child(this.cells.get(this.selected));
        this.scroller.visible = items.length > 0; this.empty.visible = items.length === 0;
        this.rendering = false; this.updateSelection(); this.report();
    }
    updateSelection() {
        const item = this.entries.find(entry => entry.type === this.selected);
        this.addButton.sensitive = !!item; this.removeButton.sensitive = !!item && this.enabled.has(item.type);
        this.detailTitle.label = item?.name || _("Select a widget");
        this.detailText.label = item ? `${item.description}\n${item.author}` : '';
        for (const [type, cell] of this.cells) cell.status.label = this.enabled.has(type) ? _("✓ Added") : ' ';
    }
    report() { this.emit({event: 'view', selected: this.selected, query: this.search.text, page: this.page, types: [...this.cells.keys()]}); }
    addSelected() { if (this.selected) this.emit({event: 'add', type: this.selected}); }
    receive(message) {
        if (!this.alive) return;
        if (message.cmd === 'enabled') { this.enabled = new Set(message.enabled); this.updateSelection(); }
        else if (message.cmd === 'entries') {
            if (this.dragging) this.pendingEntries = message.entries;
            else { this.entries = message.entries; this.render(); }
        } else if (message.cmd === 'present') this.window.present();
        else if (message.cmd === 'notice') this.toastOverlay.add_toast(new Adw.Toast({title: message.text}));
        else if (message.cmd === 'close') this.destroy();
    }
    present() { this.window.present(); }
    close() { if (this.alive) { this.emit({event: 'closed'}); this.destroy(); } }
    destroy() {
        if (!this.alive) return;
        if (this.dragging && this.activeSource) { this.closePending = true; this.activeSource.drag_cancel(); return; }
        this.alive = false;
        this.onDrag?.(false); this.interfaceSettings.disconnect(this.appearanceSignal);
        Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(), this.css);
        this.window.destroy(); this.onDestroy?.();
    }
}
