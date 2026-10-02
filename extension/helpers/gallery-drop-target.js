// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_, format} from '../lib/i18n.js';
// GTK4 receivers for the shelf's custom MIME only. These native client surfaces
// sit above desktop icon windows but below applications. Their INPUT REGION IS
// EMPTY unless the user is currently dragging one of this shelf's own entries.
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Cairo from 'cairo';
import {GALLERY_MIME} from './gallery-window.js';

export class GalleryDropTarget {
    constructor(area, config, emit) {
        this.area = area; this.config = config; this.emit = emit; this.active = false;
        this.window = new Gtk.Window({title: `classic-gallery-drop:${config.token}:${area.id}`, decorated: false, resizable: true,
            focusable: false, default_width: Math.round(area.width), default_height: Math.round(area.height), css_classes: ['classic-gallery-target']});
        // Fully transparent GTK surfaces get an empty xdg geometry on Mutter 50.
        // A single alpha step retains valid geometry; input is still explicitly empty at rest.
        this.css = new Gtk.CssProvider();
        this.css.load_from_string('window.classic-gallery-target { background: rgba(0,0,0,0.004); box-shadow: none; border: none; border-radius: 0; }');
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), this.css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this.box = new Gtk.Box({hexpand: true, vexpand: true}); this.window.set_child(this.box);
        this.drop = Gtk.DropTargetAsync.new(Gdk.ContentFormats.new([GALLERY_MIME]), Gdk.DragAction.COPY);
        this.drop.connect('accept', (_target, drop) => this.active && drop.get_formats().contain_mime_type(GALLERY_MIME));
        this.drop.connect('drag-enter', () => this.active ? Gdk.DragAction.COPY : 0);
        this.drop.connect('drag-motion', () => this.active ? Gdk.DragAction.COPY : 0);
        this.drop.connect('drop', (_target, drop, x, y) => {
            if (!this.active) return false;
            const geometry = {x, y, width: this.window.get_width(), height: this.window.get_height()};
            drop.read_async([GALLERY_MIME], GLib.PRIORITY_DEFAULT, null, async (d, result) => {
                let stream;
                try {
                    [stream] = d.read_finish(result);
                    const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (s, r) => {
                        try { resolve(s.read_bytes_finish(r)); } catch (error) { reject(error); }
                    }));
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    if (data.token !== config.token || !config.entries.some(entry => entry.type === data.type)) throw new Error(_("The dragged item is not from this widget gallery"));
                    emit({event: 'drop', type: data.type, area: area.id, ...geometry}); d.finish(Gdk.DragAction.COPY);
                } catch (error) { emit({event: 'notice', text: format(_("Cannot place widget: {error}"), {error: error.message})}); d.finish(0); }
                finally { try { stream?.close(null); } catch { /* Stream closed by client. */ } }
            });
            return true;
        }); this.box.add_controller(this.drop);
        this.window.connect('realize', () => {
            this.window.get_surface().connect('layout', () => this.syncInput()); this.syncInput();
        });
        this.window.connect('map', () => { this.syncInput(); emit({event: 'target-ready', area: area.id}); });
        this.window.present();
    }
    syncInput() {
        const surface = this.window.get_surface();
        if (surface) {
            surface.set_input_region(this.active ? null : new Cairo.Region());
            this.box.queue_draw(); surface.queue_render();
        }
    }
    setActive(active) { this.active = active; this.syncInput(); }
    destroy() { this.active = false; this.syncInput(); this.window.destroy(); Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(), this.css); }
}
