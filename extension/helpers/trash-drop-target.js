#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: MIT
import '../lib/i18n-runtime.js';
import {_, format} from '../lib/i18n.js';
// Transparent GTK4 drop target that the Windows Vista/7 Widgets extension parks under the recycle-bin
// gadget on Wayland (design.md §7). It is a plain gjs program, started by lib/trash-drop.js via
// Meta.WaylandClient.new_subprocess so the shell can identify its window:
//
//   gjs -m helpers/trash-drop-target.js --title classic-gadgets-trash --width 130 --height 90
//
// Protocol — one JSON object per line, flushed:
//   stdout → {"event":"ready","width":W,"height":H}     the window is mapped
//            {"event":"hover","state":true|false}        a file drag entered / left the window
//            {"event":"drop","trashed":[basenames],"failed":[{"name","error"}],"skipped":n}
//            {"event":"resized","width":W,"height":H}    the surface changed size
//            {"event":"error","message":"…"}              a non-fatal problem (bad command…)
//   stdin  ← {"cmd":"resize","width":W,"height":H}      new logical size
//            {"cmd":"visible","state":true|false}        hide/show the window
//            {"cmd":"quit"}                               exit
// The process exits on SIGTERM / SIGINT / SIGHUP, on stdin EOF (the extension went away) and on
// "quit". It uses a near-transparent background (one alpha step, see below) and its only child is an
// empty box sized to the requested logical size. Files are moved to the trash with
// Gio.File.trash_async (≤ 500 items per drop; non-native and trash:// items are skipped).
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {programArgs, exit} from 'system';

const MAX_ITEMS = 500;
// A fully transparent GTK4 surface reports a 0×0 xdg window geometry on Mutter 50.
// One alpha step keeps a real input surface; it sits UNDER the gadget artwork.
const CSS = 'window, window.background, .background { background: transparent; background-color: rgba(0,0,0,0.004); box-shadow: none; border: none; outline: none; }';

function size(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 8192) throw new Error(format(_("Invalid dimensions: {size}"), {size: value}));
    return n;
}
function parseArgs(argv) {
    const options = {title: 'classic-gadgets-trash', width: 130, height: 90};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i], value = argv[i + 1];
        if (key === '--title' && value !== undefined) { options.title = value; i++; }
        else if ((key === '--width' || key === '--height') && value !== undefined) { options[key.slice(2)] = size(value); i++; }
        else if (key === '--help' || key === '-h') { printerr(_("Usage: gjs -m trash-drop-target.js --title <title> --width <width> --height <height>")); exit(0); }
        else throw new Error(format(_("Unknown argument: {argument}"), {argument: key}));
    }
    return options;
}

const stdout = new GioUnix.OutputStream({fd: 1, close_fd: false});
const encoder = new TextEncoder();
function emit(event) {
    try { stdout.write_all(encoder.encode(`${JSON.stringify(event)}\n`), null); } catch { /* the extension is gone; stdin EOF ends the process */ }
}

let options;
try { options = parseArgs(programArgs); } catch (e) { printerr(e.message); exit(2); }

GLib.set_prgname('classic-gadgets-trash');
GLib.set_application_name(_("Windows Vista/7 Widgets"));
Gtk.init();
const provider = new Gtk.CssProvider();
if (typeof provider.load_from_string === 'function') provider.load_from_string(CSS); else provider.load_from_data(CSS, -1);
Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);

const window = new Gtk.Window({title: options.title, decorated: false, resizable: false, focus_visible: false, default_width: options.width, default_height: options.height});
const surface = new Gtk.Box({can_focus: false, focusable: false});
surface.set_size_request(options.width, options.height);
window.set_child(surface);

const loop = new GLib.MainLoop(null, false);
let quitting = false;
function quit() {
    if (quitting) return;
    quitting = true;
    try { window.destroy(); } catch { /* already gone */ }
    loop.quit();
}

// --- drag and drop --------------------------------------------------------------------------
const target = Gtk.DropTarget.new(Gdk.FileList.$gtype, Gdk.DragAction.COPY | Gdk.DragAction.MOVE);
target.set_gtypes([Gdk.FileList.$gtype, GObject.TYPE_STRING]);
let hovering = false;
function setHover(state) {
    if (hovering === state) return;
    hovering = state;
    emit({event: 'hover', state});
}
function filesOf(value) {
    if (value instanceof Gdk.FileList || typeof value?.get_files === 'function') return value.get_files();
    if (typeof value === 'string') {
        // text/uri-list fallback: one URI per line, `#` lines are comments.
        return value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(uri => Gio.File.new_for_uri(uri));
    }
    return [];
}
function trash(file) {
    return new Promise((resolve, reject) => file.trash_async(GLib.PRIORITY_DEFAULT, null, (f, result) => {
        try { f.trash_finish(result); resolve(); } catch (e) { reject(e); }
    }));
}
async function handleDrop(value) {
    const files = filesOf(value);
    const trashed = [], failed = [];
    let skipped = Math.max(0, files.length - MAX_ITEMS);
    for (const file of files.slice(0, MAX_ITEMS)) {
        if (!file.is_native() || file.get_uri_scheme() === 'trash') { skipped++; continue; }
        const name = file.get_basename() ?? file.get_uri();
        try { await trash(file); trashed.push(name); } catch (e) { failed.push({name, error: e.message}); }
    }
    emit({event: 'drop', trashed, failed, skipped});
}
target.connect('accept', (_target, drop) => {
    const formats = drop.get_formats();
    return formats.contain_gtype(Gdk.FileList.$gtype) || formats.contain_mime_type('text/uri-list');
});
// COPY is reported back to the source so that no source deletes anything itself: the helper moves
// the dropped files to the trash on its own.
target.connect('enter', () => { setHover(true); return Gdk.DragAction.COPY; });
target.connect('motion', () => Gdk.DragAction.COPY);
target.connect('leave', () => setHover(false));
target.connect('drop', (_target, value) => {
    setHover(false);
    handleDrop(value).catch(e => emit({event: 'error', message: format(_("Could not move to trash: {error}"), {error: e.message})}));
    return true;
});
window.add_controller(target);

// --- commands from the extension -----------------------------------------------------------
function handleCommand(line) {
    let command;
    try { command = JSON.parse(line); } catch { emit({event: 'error', message: format(_("Cannot parse command: {command}"), {command: line.slice(0, 80)})}); return; }
    try {
        switch (command?.cmd) {
        case 'resize': {
            const width = size(command.width), height = size(command.height);
            surface.set_size_request(width, height);
            window.set_default_size(width, height);
            break;
        }
        case 'visible':
            window.set_visible(Boolean(command.state));
            break;
        case 'ping':
            emit({event: 'pong'});
            break;
        case 'quit':
            quit();
            break;
        default:
            emit({event: 'error', message: format(_("Unknown command: {command}"), {command: String(command?.cmd)})});
        }
    } catch (e) { emit({event: 'error', message: e.message}); }
}
const stdin = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
function readCommands() {
    stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
        let line = null;
        try { [line] = stream.read_line_finish_utf8(result); } catch { quit(); return; }
        if (line === null) { quit(); return; } // EOF: the extension closed our stdin or died
        const text = line.trim();
        if (text) handleCommand(text);
        readCommands();
    });
}

// --- lifecycle -----------------------------------------------------------------------------
for (const signal of [15, 2, 1]) GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => { quit(); return GLib.SOURCE_REMOVE; });
let lastSize = null;
window.connect('realize', () => {
    window.get_surface()?.connect('layout', (_surface, width, height) => {
        const key = `${width}x${height}`;
        if (key === lastSize) return;
        lastSize = key;
        if (window.get_mapped()) emit({event: 'resized', width, height});
    });
});
window.connect('map', () => emit({event: 'ready', width: window.get_width(), height: window.get_height()}));
window.connect('close-request', () => { quit(); return true; });
window.set_visible(true);
readCommands();
loop.run();
exit(0);
