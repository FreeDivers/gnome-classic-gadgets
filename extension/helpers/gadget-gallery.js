// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_} from '../lib/i18n.js';
// One private GTK4 gallery process, communicating only through inherited pipes.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import {GalleryWindow} from './gallery-window.js';
import {GalleryDropTarget} from './gallery-drop-target.js';

GLib.set_prgname('classic-gadgets-gallery'); GLib.set_application_name(_("Windows Vista/7 Widgets")); Adw.init();
const loop = new GLib.MainLoop(null, false), cancellable = new Gio.Cancellable();
const input = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
const output = new GioUnix.OutputStream({fd: 1, close_fd: false});
let gallery = null, targets = [], quitting = false;
function finish() {
    for (const target of targets) target.destroy(); targets = [];
    // Let GTK release native/DND surfaces before stopping its main context.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
}
function quit() {
    if (quitting) return; quitting = true; cancellable.cancel();
    for (const target of targets) target.setActive(false);
    if (gallery?.alive) { gallery.onDestroy = finish; gallery.destroy(); } else finish();
}
function emit(message) { try { output.write_all(new TextEncoder().encode(`${JSON.stringify(message)}\n`), null); } catch { quit(); } }
function read() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (stream, result) => {
        let text;
        try { [text] = stream.read_line_finish_utf8(result); } catch { quit(); return; }
        if (text === null || text.length > 1024 * 1024) { quit(); return; }
        try {
            const message = JSON.parse(text);
            if (message.cmd === 'init' && !gallery) {
                const config = message.config;
                gallery = new GalleryWindow(config, emit); gallery.onDestroy = quit;
                targets = config.areas.map(area => new GalleryDropTarget(area, config, emit));
                gallery.onDrag = active => { for (const target of targets) target.setActive(active); };
                gallery.present();
            } else if (message.cmd === 'close') { quit(); return; }
            else gallery?.receive(message);
        } catch (error) { emit({event: 'error', message: error.message}); quit(); return; }
        if (!quitting) read();
    });
}
for (const signal of [15, 2, 1]) GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => { quit(); return GLib.SOURCE_REMOVE; });
read(); loop.run();
