// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_} from '../lib/i18n.js';
// Private pipe endpoint for ONE native component-options window. It cannot
// modify GSettings or run component actions itself: Shell validates all input.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import {OptionsWindow} from './options-window.js';

GLib.set_prgname('classic-gadgets-options');
GLib.set_application_name(_("Windows Vista/7 Widgets"));
Adw.init();
const loop = new GLib.MainLoop(null, false), cancellable = new Gio.Cancellable();
const input = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
const output = new GioUnix.OutputStream({fd: 1, close_fd: false});
let window = null, quitting = false;
function quit() { if (quitting) return; quitting = true; cancellable.cancel(); window?.destroy(); loop.quit(); }
function emit(message) {
    try { output.write_all(new TextEncoder().encode(`${JSON.stringify(message)}\n`), null); }
    catch { quit(); }
}
function read() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (stream, result) => {
        let text;
        try { [text] = stream.read_line_finish_utf8(result); }
        catch { quit(); return; }
        if (text === null || text.length > 1024 * 1024) { quit(); return; }
        try {
            const message = JSON.parse(text);
            if (message.cmd === 'init' && !window) {
                window = new OptionsWindow(message.config, emit); window.onDestroy = quit; window.present();
            } else if (message.cmd === 'close') { quit(); return; }
            else window?.receive(message);
        } catch (error) { emit({event: 'error', message: error.message}); quit(); return; }
        if (!quitting) read();
    });
}
for (const signal of [15, 2, 1]) GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => { quit(); return GLib.SOURCE_REMOVE; });
read(); loop.run();
