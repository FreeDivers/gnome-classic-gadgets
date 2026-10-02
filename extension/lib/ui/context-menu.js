// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {GADGETS} from '../core.js';
import {OPACITY_LEVELS} from './ui-logic.js';

export class ContextMenus {
    constructor(host) { this.host = host; }
    create(x, y) {
        this.close();
        this.anchor = new St.Widget({x, y, width: 1, height: 1, reactive: true}); Main.uiGroup.add_child(this.anchor);
        this.menu = new PopupMenu.PopupMenu(this.anchor, 0, St.Side.TOP); Main.uiGroup.add_child(this.menu.actor); this.menu.actor.hide();
        this.manager = new PopupMenu.PopupMenuManager(this.anchor); this.manager.addMenu(this.menu);
        return this.menu;
    }
    common(menu) {
        menu.addAction(_("Add Widgets…"), () => this.host.showGallery());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }
    positionActions(menu) {
        const locked = new PopupMenu.PopupSwitchMenuItem(_("Lock positions"), this.host.settings.get_boolean('locked'));
        locked.connect('toggled', (_item, state) => this.host.settings.set_boolean('locked', state)); menu.addMenuItem(locked);
        menu.addAction(_("Arrange automatically"), () => this.host.settings.set_string('layout', '{}'));
    }
    openGadgetMenu(gadget, x, y) {
        const menu = this.create(x, y); this.common(menu);
        if (GADGETS[gadget.type].large) for (const [size, name] of [['small', _("Small")], ['large', _("Large")]]) {
            const item = new PopupMenu.PopupMenuItem(name); item.setOrnament(gadget.size === size ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => gadget.setSize(size)); menu.addMenuItem(item);
        }
        const opacity = new PopupMenu.PopupSubMenuMenuItem(_("Opacity"));
        for (const value of OPACITY_LEVELS) {
            const item = new PopupMenu.PopupMenuItem(`${value}%`); item.setOrnament((gadget.options.opacity ?? 100) === value ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => gadget.save({opacity: value})); opacity.menu.addMenuItem(item);
        }
        menu.addMenuItem(opacity); menu.addAction(_("Settings…"), () => this.host.openOptions(gadget));
        for (const item of gadget.contextMenuItems()) menu.addAction(item.label, () => item.action());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem()); this.positionActions(menu);
        menu.addAction(_("Close Widget"), () => this.host.remove(gadget.type)); menu.open(true);
    }
    openDesktopMenu(x, y) {
        const menu = this.create(x, y); this.common(menu);
        const visible = new PopupMenu.PopupSwitchMenuItem(_("Show widgets"), this.host.settings.get_boolean('visible'));
        visible.connect('toggled', (_item, state) => this.host.settings.set_boolean('visible', state)); menu.addMenuItem(visible);
        this.positionActions(menu); menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addSettingsAction(_("Change Background…"), 'gnome-background-panel.desktop');
        menu.addSettingsAction(_("Display Settings…"), 'gnome-display-panel.desktop');
        menu.addSettingsAction(_("System Settings…"), 'org.gnome.Settings.desktop'); menu.open(true); return true;
    }
    close() { this.menu?.destroy(); this.menu = null; this.anchor?.destroy(); this.anchor = null; this.manager = null; }
    destroy() { this.close(); this.host = null; }
}
