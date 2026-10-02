// SPDX-License-Identifier: MIT
import {_, format} from './i18n.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {parseObject, optionsFor, httpsUrl, parseCpuStat, cpuPercent, parseMemory} from './core.js';

export class Scope {
    constructor() { this.alive = true; this.sources = new Set(); this.signals = []; this.cancellable = new Gio.Cancellable(); }
    connect(object, name, callback) {
        const id = object.connect(name, (...args) => { if (this.alive) return callback(...args); return undefined; });
        this.signals.push([object, id]);
        return id;
    }
    later(ms, callback, repeat = false) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (!this.alive) { this.sources.delete(id); return GLib.SOURCE_REMOVE; }
            try { callback(); } catch (error) { console.error(error); }
            if (!repeat) this.sources.delete(id);
            return repeat ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this.sources.add(id);
        return id;
    }
    cancelSource(id) { if (this.sources.delete(id)) GLib.Source.remove(id); }
    destroy() {
        if (!this.alive) return;
        this.alive = false;
        this.cancellable.cancel();
        for (const id of this.sources) GLib.Source.remove(id);
        this.sources.clear();
        for (const [object, id] of this.signals) {
            try { object.disconnect(id); } catch { /* An owned actor may already have been disposed. */ }
        }
        this.signals = [];
    }
}

export class Store {
    constructor(settings) { this.settings = settings; }
    get options() { return parseObject(this.settings.get_string('options')); }
    get layout() { return parseObject(this.settings.get_string('layout')); }
    optionsFor(type) { return optionsFor(type, this.options); }
    saveOptions(type, patch) {
        const options = this.options;
        options[type] = {...this.optionsFor(type), ...patch};
        this.settings.set_string('options', JSON.stringify(options));
    }
    savePosition(type, position) {
        this.settings.set_string('layout', JSON.stringify({...this.layout, [type]: position}));
    }
}

export function readFile(file, cancellable) {
    return new Promise((resolve, reject) => file.load_contents_async(cancellable, (f, result) => {
        try { const [, bytes] = f.load_contents_finish(result); resolve(new TextDecoder().decode(bytes)); } catch (e) { reject(e); }
    }));
}
export function enumerate(file, attributes, cancellable, limit = 500) {
    return new Promise((resolve, reject) => file.enumerate_children_async(attributes, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable, (f, res) => {
        let enumerator;
        try { enumerator = f.enumerate_children_finish(res); } catch (e) { reject(e); return; }
        const values = [];
        const close = () => enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (en, r) => { try { en.close_finish(r); } catch { /* Closing after cancellation is best effort. */ } });
        const next = () => enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (en, r) => {
            try {
                const batch = en.next_files_finish(r);
                values.push(...batch);
                if (batch.length && values.length < limit) next();
                else { close(); resolve(values.slice(0, limit)); }
            } catch (e) { close(); reject(e); }
        });
        next();
    }));
}
export function openUri(uri, onError = console.error) {
    Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, (_obj, result) => {
        try { Gio.AppInfo.launch_default_for_uri_finish(result); } catch (e) { onError(e); }
    });
}
export function cancelError(error) { return error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED); }

export class SystemSampler {
    constructor(scope, update) {
        this.scope = scope;
        this.update = update;
        this.previous = null;
        this.busy = false;
        this.sample();
        scope.later(2000, () => this.sample(), true);
    }
    async sample() {
        if (this.busy || !this.scope.alive) return;
        this.busy = true;
        try {
            const [stat, mem] = await Promise.all(['/proc/stat', '/proc/meminfo'].map(path => readFile(Gio.File.new_for_path(path), this.scope.cancellable)));
            if (!this.scope.alive) return;
            const current = parseCpuStat(stat);
            const cpu = cpuPercent(this.previous, current);
            this.previous = current;
            this.update({cpu, memory: parseMemory(mem)});
        } catch (e) { if (this.scope.alive && !cancelError(e)) this.update({error: e.message}); }
        finally { this.busy = false; }
    }
}

// Bounded, cancelable HTTPS requests; remote data never becomes executable markup.
export class Network {
    constructor() {
        this.session = new Soup.Session({timeout: 20, user_agent: 'Mozilla/5.0 (X11; Linux x86_64) ClassicDesktopGadgets/2.1'});
        this.scope = new Scope();
        this.cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'classic-desktop-gadgets']);
        GLib.mkdir_with_parents(this.cacheDir, 0o700);
    }
    cacheFile(url) {
        const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        return Gio.File.new_for_path(GLib.build_filenamev([this.cacheDir, `${key}.json`]));
    }
    async request(url, cancellable, redirects = 0, headers = {}) {
        httpsUrl(url);
        const message = Soup.Message.new('GET', url);
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        const requestHeaders = message.get_request_headers();
        for (const [name, value] of Object.entries(headers)) {
            // A header is plain request metadata: no CR/LF injection, no empty names.
            if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[\r\n\x00]/.test(String(value))) throw new Error(format(_("Invalid request header: {header}"), {header: name}));
            requestHeaders.replace(name, String(value));
        }
        const stream = await new Promise((resolve, reject) => this.session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, r) => {
            try { resolve(s.send_finish(r)); } catch (e) { reject(e); }
        }));
        try {
            const status = message.get_status();
            if ([301, 302, 303, 307, 308].includes(status)) {
                if (redirects >= 4) throw new Error(_("Too many redirects"));
                const location = message.get_response_headers().get_one('Location');
                const target = GLib.Uri.resolve_relative(url, location || '', GLib.UriFlags.NONE);
                return await this.request(httpsUrl(target), cancellable, redirects + 1, headers);
            }
            if (status !== 200) throw new Error(format(_("Service temporarily unavailable (HTTP {status})"), {status: status}));
            const chunks = [];
            let size = 0;
            while (true) {
                const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(32768, GLib.PRIORITY_DEFAULT, cancellable, (s, r) => {
                    try { resolve(s.read_bytes_finish(r)); } catch (e) { reject(e); }
                }));
                const array = bytes.get_data();
                if (!array.length) break;
                size += array.length;
                if (size > 2 * 1024 * 1024) throw new Error(_("The response exceeds the 2 MiB limit"));
                chunks.push(array);
            }
            // GJS TextDecoder has no streaming mode. Decode once after the bounded
            // byte stream is assembled, preserving UTF-8 sequences across chunks.
            const combined = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
            return new TextDecoder().decode(combined);
        } finally {
            stream.close_async(GLib.PRIORITY_DEFAULT, null, (s, r) => { try { s.close_finish(r); } catch { /* Closed on cancellation. */ } });
        }
    }
    // headers: extra request headers (e.g. {Referer: '…'}); the cache key stays the URL only.
    async get(url, parser, owner, maxAge = 600, force = false, {headers = {}, cache = true, timeoutMs = 25000} = {}) {
        const file = cache ? this.cacheFile(url) : null;
        let cached = null;
        try {
            if (!file) throw new Error(_("This request is not cached on disk"));
            const text = await readFile(file, owner.cancellable);
            if (text.length < 2 * 1024 * 1024) {
                const data = JSON.parse(text);
                if (Number.isFinite(data.saved) && typeof data.text === 'string') cached = {value: parser(data.text), saved: data.saved};
            }
        } catch { /* No valid previous cache. */ }
        if (!owner.alive || owner.cancellable.is_cancelled() || !this.scope.alive) throw new Error(_("Request cancelled"));
        if (!force && cached && Date.now() - cached.saved < maxAge * 1000) return {...cached, stale: false};
        const requestScope = new Scope();
        const cancelOwner = owner.cancellable.connect(() => requestScope.cancellable.cancel());
        const cancelNetwork = this.scope.cancellable.connect(() => requestScope.cancellable.cancel());
        const deadline = Number.isFinite(timeoutMs) ? Math.max(100, Math.min(25000, timeoutMs)) : 25000;
        requestScope.later(deadline, () => requestScope.cancellable.cancel());
        try {
            const text = await this.request(url, requestScope.cancellable, 0, headers);
            const value = parser(text);
            const saved = Date.now();
            if (file && owner.alive && this.scope.alive) {
                const bytes = new TextEncoder().encode(JSON.stringify({saved, text}));
                file.replace_contents_bytes_async(new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, this.scope.cancellable, (f, r) => { try { f.replace_contents_finish(r); } catch { /* Caching must not break a live result. */ } });
            }
            return {value, saved, stale: false};
        } catch (e) {
            if (owner.alive && this.scope.alive && cached) return {...cached, stale: true, error: e.message};
            throw e;
        } finally {
            owner.cancellable.disconnect(cancelOwner);
            this.scope.cancellable.disconnect(cancelNetwork);
            requestScope.destroy();
        }
    }
    destroy() { this.scope.destroy(); this.session.abort(); }
}
