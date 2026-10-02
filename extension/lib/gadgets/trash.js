// SPDX-License-Identifier: MIT
import {_, format, ngettext} from '../i18n.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {formatBytes, clamp} from '../core.js';
import {enumerate, openUri, cancelError} from '../platform.js';
import {Gadget} from '../gadget.js';
import {TrashDropTarget} from '../trash-drop.js';
import {FloatingWindow, uiButton, uiLabel} from '../ui/window.js';

export default class Trash extends Gadget {
    optionsSpec() { return [
        ...(this.host.theme.name === 'fluent' ? [] : [{type: 'picker', key: 'view', label: _("Trash style"), values: [1, 2, 3, 4],
            names: [_("Style 1"), _("Style 2"), _("Style 3"), _("Style 4")], preview: view => this.asset(`View${view}/view${view}_settingsEmpty.png`), previewSize: {h: 95}}]),
        {type: 'button', label: _("Open system trash"), onClick: () => { this.openTrash(); return _("Files can be restored in the file manager"); }},
        {type: 'button', label: _("Empty Trash…"), onClick: () => { this.confirmEmpty(); return _("Confirm in the dialog that opens"); }},
    ]; }
    contextMenuItems() { return [{label: _("Open Trash"), action: () => this.openTrash()}, {label: _("Empty Trash…"), action: () => this.confirmEmpty()}]; }
    build() {
        this.fluent = this.host.theme.name === 'fluent'; this.hovered = false; this.dropHovered = false; this.itemCount = 0; this.bytes = 0; this.trashEntries = [];
        this.resize(130, this.fluent ? 67 : 90);
        this.background = this.picture(this.fluent ? 'images/docked.png' : `View${this.view}/view${this.view}_default.png`, 0, 0, this.width, this.height);
        if (this.fluent) this.bin = this.picture('images/000.png', 1, 5, 54, 54);
        this.count = this.text('', this.fluent ? 52 : 6, this.fluent ? 4 : 18, this.fluent ? 74 : 62, 17, 'og-trash-count og-numeric');
        this.status = this.text('', this.fluent ? 52 : 6, this.fluent ? 21 : 36, this.fluent ? 74 : 62, 17, 'og-trash-status og-numeric');
        const open = this.button('', this.fluent ? 1 : 73, 5, this.fluent ? 52 : 55, this.fluent ? 54 : 78, () => this.openTrash()); open.accessible_name = _("Open system trash");
        this.emptyButton = this.fluent ? this.spriteButton('images/emptybin.png', 104, 43, 14, 14, _("Empty trash (confirmation required)"), () => this.confirmEmpty()) : this.button(_("Empty…"), 8, 55, 60, 18, () => this.confirmEmpty(), 'og-trash-empty');
        if (this.fluent) {
            this.spriteButton('images/sync.png', 68, 42, 14, 14, _("Refresh trash"), () => this.refresh());
            this.spriteButton('images/settings.png', 85, 43, 14, 14, _("Trash Settings"), () => this.host.openOptions(this));
        }
        this.toolButton('view-refresh-symbolic', _("Refresh"), () => this.refresh());
        this.toolButton('i', _("File drop status"), () => Main.notify(_("Trash"), this.dropTarget?.statusText ?? _("Enabling file drops…")));
        this.busy = false; this.refresh(); this.scope.later(30000, () => this.refresh(), true);
        this.dropTarget = new TrashDropTarget(this.host, this); this.hover(false);
        try {
            this.monitor = Gio.File.new_for_uri('trash:///').monitor_directory(Gio.FileMonitorFlags.NONE, this.scope.cancellable);
            this.scope.connect(this.monitor, 'changed', () => this.refresh());
        } catch { /* Some GVFS backends cannot monitor; the timer and drop callback still refresh. */ }
    }
    get view() { return clamp(Math.trunc(Number(this.options.view) || 1), 1, 4); }
    openTrash() { openUri('trash:///', error => Main.notify(_("Cannot open the trash"), error.message)); }
    refreshOptions() { this.render(); }
    hover(state) { this.hovered = state; if (this.background) this.render(); }
    onDropHover(state) { this.dropHovered = state; this.render(); }
    onDropped(result) { this.lastDrop = result; this.refresh(); }
    render() {
        const active = this.hovered || this.dropHovered;
        if (this.fluent) {
            const file = !this.itemCount ? '000' : this.bytes > 1024 ** 3 ? '100' : this.bytes > 512 * 1024 ** 2 ? '070' : '030';
            this.setPicture(this.bin, `images/${file}.png`);
            this.count.text = this.itemCount ? formatBytes(this.bytes) : _("Empty"); this.status.text = format(ngettext("{count} item", "{count} items", this.itemCount), {count: this.itemCount});
            this.setPicture(this.emptyButton, `images/emptybin${this.itemCount ? '' : '_disabled'}.png`);
        } else {
            this.setPicture(this.background, `View${this.view}/view${this.view}_${active ? 'hover' : 'default'}${this.itemCount ? '_full' : ''}.png`);
            this.count.text = this.itemCount ? formatBytes(this.bytes) : _("Empty"); this.status.text = format(ngettext("{count} item", "{count} items", this.itemCount), {count: this.itemCount});
        }
        this.count.visible = this.status.visible = this.emptyButton.visible = this.fluent || active;
        this.emptyButton.reactive = this.itemCount > 0;
        this.actor.accessible_name = format(ngettext("Trash: {count} item. Drop files here, or click to open and restore files.", "Trash: {count} items. Drop files here, or click to open and restore files.", this.itemCount), {count: this.itemCount});
    }
    async refresh() {
        if (this.busy) { this.refreshAgain = true; return; } this.busy = true;
        const scope = this.scope;
        try {
            const files = await enumerate(Gio.File.new_for_uri('trash:///'), 'standard::name,standard::size', scope.cancellable, 10000);
            if (!scope.alive) return;
            this.trashEntries = files.map(info => Gio.File.new_for_uri('trash:///').get_child(info.get_name()));
            this.itemCount = files.length; this.bytes = files.reduce((sum, info) => sum + info.get_size(), 0); this.render();
        } catch (e) { if (scope.alive && !cancelError(e)) { this.status.text = _("Service unavailable"); this.actor.accessible_name = format(_("Trash: {error}"), {error: e.message}); } }
        finally { if (scope.alive) { this.busy = false; if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); } } }
    }
    confirmEmpty() {
        if (this.confirmWindow || !this.trashEntries.length) return;
        // Snapshot only: files trashed after the prompt was opened aren't deleted.
        const files = [...this.trashEntries];
        const close = () => { this.confirmWindow?.destroy(); this.confirmWindow = null; };
        const window = this.confirmWindow = new FloatingWindow(this.host, _("Empty the trash?"), 365, close);
        const warning = uiLabel(format(ngettext("This {count} item will be permanently deleted and cannot be recovered.\nCancel to keep it.", "These {count} items will be permanently deleted and cannot be recovered.\nCancel to keep them.", files.length), {count: files.length})); warning.clutter_text.set_line_wrap(true);
        window.content.add_child(warning); window.content.add_child(uiButton(_("Cancel"), close));
        window.content.add_child(uiButton(_("Delete Permanently"), async () => {
            close(); let deleted = 0, failed = 0;
            for (const file of files) {
                if (!this.scope.alive) break;
                try {
                    await new Promise((resolve, reject) => file.delete_async(GLib.PRIORITY_DEFAULT, this.scope.cancellable, (f, result) => { try { f.delete_finish(result); resolve(); } catch (e) { reject(e); } }));
                    deleted++;
                } catch { failed++; }
            }
            if (this.scope.alive) { await this.refresh(); Main.notify(_("Trash"), format(ngettext("Permanently deleted {count} item{failures}", "Permanently deleted {count} items{failures}", deleted), {count: deleted, failures: failed ? format(ngettext("; {count} item could not be deleted", "; {count} items could not be deleted", failed), {count: failed}) : ''})); }
        }, {style_class: 'cg-button cg-primary'})); window.position();
    }
    beforeDestroy() { this.confirmWindow?.destroy(); this.confirmWindow = null; this.monitor?.cancel(); this.monitor = null; this.dropTarget?.destroy(); this.dropTarget = null; }
}
