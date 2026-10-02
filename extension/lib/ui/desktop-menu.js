// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Ubuntu 50 ignores a user-local DING with the session extension's UUID. Keep
// the loaded system extension and its desktop/window management, but direct its
// own launcher to a private, verified copy with one additional native menu row.
// No /usr/share writes, no compositor restart, no changes to enabled extensions.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Scope, cancelError} from '../platform.js';

const UUID = 'ding@rastersoft.com';
export class DesktopMenuIntegration {
    constructor(host) {
        this.host = host; this.scope = new Scope(); this.state = 'waiting';
        this.scope.connect(Main.extensionManager, 'extension-state-changed', (_manager, extension) => {
            if (extension.uuid === UUID) this.sync();
        });
        this.scope.connect(host.settings, 'changed::desktop-menu', () => this.sync());
        this.scope.connect(Main.layoutManager, 'startup-complete', () => this.scope.later(0, () => this.sync()));
        this.scope.later(0, () => this.sync());
    }
    async sync() {
        if (!this.scope.alive) return;
        if (!this.host.settings.get_boolean('desktop-menu')) { this.detach(true); this.state = 'disabled'; return; }
        const ding = Main.extensionManager.lookup(UUID)?.stateObj;
        if (!ding?.data?.isEnabled) { if (this.ding && ding !== this.ding) this.detach(false); return; }
        if (ding === this.ding || this.preparing === ding) return;
        this.detach(false);
        if (typeof ding.launchDesktop !== 'function' || typeof ding.killCurrentProcess !== 'function' || typeof ding.doRelaunch !== 'function') {
            this.state = 'unsupported'; return;
        }
        this.preparing = ding; this.state = 'preparing';
        const source = ding.path;
        let process;
        try {
            process = Gio.Subprocess.new([GLib.find_program_in_path('python3') || 'python3',
                `${this.host.path}/helpers/desktop-menu-prepare.py`, '--source', source],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this.preparation = process;
            const [stdout, stderr] = await new Promise((resolve, reject) => process.communicate_utf8_async(null, this.scope.cancellable, (p, result) => {
                try { const [, out, err] = p.communicate_utf8_finish(result); resolve([out, err]); } catch (error) { reject(error); }
            }));
            if (!this.scope.alive || !this.host.settings.get_boolean('desktop-menu') || !ding.data.isEnabled || Main.extensionManager.lookup(UUID)?.stateObj !== ding) return;
            if (!process.get_successful()) throw new Error(stderr.trim() || _("Cannot prepare the DING desktop menu"));
            const record = JSON.parse(stdout);
            if (record.source !== source || !Gio.File.new_for_path(`${record.root}/app/ding.js`).query_exists(null)) throw new Error(_("DING menu copy verification failed"));
            const original = ding.launchDesktop;
            const wrapper = function (...args) {
                // launchDesktop uses this.path synchronously to build argv. All
                // of DING's state, callbacks and lifecycle stay on its real instance.
                const own = Object.getOwnPropertyDescriptor(this, 'path');
                Object.defineProperty(this, 'path', {value: record.root, configurable: true});
                try { return original.apply(this, args); }
                finally { if (own) Object.defineProperty(this, 'path', own); else delete this.path; }
            };
            this.ding = ding; this.original = original; this.wrapper = wrapper; this.root = record.root; this.source = source;
            ding.launchDesktop = wrapper;
            // Restart only DING's own disposable icon window, never the Shell or
            // any file-manager window. DING reconnects to its existing settings.
            ding.killCurrentProcess(); ding.doRelaunch(1);
            this.state = 'ready';
        } catch (error) {
            if (this.scope.alive && !cancelError(error)) {
                this.state = 'error'; this.error = error.message;
                console.error(_("Windows Vista/7 Widgets: desktop menu integration failed"), error);
                Main.notify(_("Windows Vista/7 Widgets"), format(_("Cannot add the desktop menu entry: {error}. You can add widgets from the top bar."), {error: error.message}));
            }
        } finally {
            if (this.preparing === ding) this.preparing = null;
            if (this.preparation === process) this.preparation = null;
        }
    }
    status() {
        const process = this.ding?.data?.currentProcess?.subprocess;
        return {state: this.state, source: this.source || null, privateCopy: this.root || null,
            pid: process?.get_identifier() || null, error: this.error || null};
    }
    detach(relaunch) {
        const ding = this.ding;
        if (ding && this.wrapper && ding.launchDesktop === this.wrapper) {
            ding.launchDesktop = this.original;
            if (relaunch && ding.data.isEnabled) { ding.killCurrentProcess(); ding.doRelaunch(1); }
        }
        this.ding = this.wrapper = this.original = null;
    }
    destroy() {
        this.scope.destroy(); this.preparation?.force_exit(); this.preparation = null;
        this.detach(true); this.state = 'stopped';
    }
}
