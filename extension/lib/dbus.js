// SPDX-License-Identifier: MIT
import {_, format} from './i18n.js';
// Session-bus control interface (design.md §5), exported on GNOME Shell's own
// connection, so it is reachable under the well-known name org.gnome.Shell:
//
//   gdbus call --session --dest org.gnome.Shell \
//     --object-path /org/gnome/Shell/Extensions/ClassicGadgets \
//     --method org.gnome.Shell.Extensions.ClassicGadgets.ShowGallery
//
// Invalid input (unknown type, size or theme) throws, which GJS turns into a
// D-Bus error reply for the caller.
import Gio from 'gi://Gio';
import {GADGETS, SIZES, THEMES, sizeOf} from './core.js';

export const DBUS_PATH = '/org/gnome/Shell/Extensions/ClassicGadgets';
export const DBUS_INTERFACE = 'org.gnome.Shell.Extensions.ClassicGadgets';
const XML = `<node>
  <interface name="${DBUS_INTERFACE}">
    <method name="ShowGallery"/>
    <method name="GetNetworkStatus"><arg type="s" name="status" direction="out"/></method>
    <method name="GetDesktopMenuStatus"><arg type="s" name="status" direction="out"/></method>
    <method name="AddGadget"><arg type="s" name="type" direction="in"/></method>
    <method name="RemoveGadget"><arg type="s" name="type" direction="in"/></method>
    <method name="OpenOptions"><arg type="s" name="type" direction="in"/></method>
    <method name="SetSize"><arg type="s" name="type" direction="in"/><arg type="s" name="size" direction="in"/></method>
    <method name="SetTheme"><arg type="s" name="theme" direction="in"/></method>
    <method name="ListGadgets"><arg type="a(sbs)" name="gadgets" direction="out"/></method>
  </interface>
</node>`;

export class DBusService {
    constructor(host) {
        this.host = host;
        this.exported = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this.exported.export(Gio.DBus.session, DBUS_PATH);
    }
    checkType(type) {
        if (typeof type !== 'string' || !Object.hasOwn(GADGETS, type)) throw new Error(format(_("Unknown widget type: {type} (available: {types})"), {type: String(type), types: Object.keys(GADGETS).join(', ')}));
        return type;
    }
    GetNetworkStatus() { return JSON.stringify(this.host.sources?.status ?? {state: 'unavailable'}); }
    GetDesktopMenuStatus() { return JSON.stringify(this.host.desktopMenu?.status() ?? {state: 'unavailable'}); }
    ShowGallery() { this.host.showGallery(); }
    AddGadget(type) { this.host.enableGadget(this.checkType(type)); }
    RemoveGadget(type) { this.host.remove(this.checkType(type)); }
    OpenOptions(type) {
        const gadget = this.host.widgets.get(this.checkType(type));
        if (!gadget) throw new Error(format(_("Widget is not enabled: {type}"), {type: type}));
        this.host.openOptions(gadget);
    }
    SetSize(type, size) {
        this.checkType(type);
        if (!SIZES.includes(size)) throw new Error(format(_("Invalid size: {size} (small or large)"), {size: String(size)}));
        if (!GADGETS[type].large) throw new Error(format(_("{widget} has no large size"), {widget: GADGETS[type].name}));
        this.host.setSize(type, size);
    }
    SetTheme(theme) {
        if (!THEMES.includes(theme)) throw new Error(format(_("Invalid appearance: {theme} ({themes})"), {theme: String(theme), themes: THEMES.join(_(" or "))}));
        this.host.setTheme(theme);
    }
    ListGadgets() {
        const enabled = this.host.settings.get_strv('enabled-gadgets');
        return Object.keys(GADGETS).map(type => [type, enabled.includes(type), sizeOf(type, this.host.store.optionsFor(type))]);
    }
    destroy() {
        try { this.exported?.unexport(); } catch { /* Already gone with the connection. */ }
        this.exported = null; this.host = null;
    }
}
