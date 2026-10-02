// SPDX-License-Identifier: MIT
// Theme: resolves a gadget's skin file to assets/fluent (Rectify11) when the
// fluent theme is active and the manifest lists the file, else assets/original.
import GLib from 'gi://GLib';
import {validTheme} from './core.js';

export class Theme {
    constructor(extensionPath, name = 'classic') {
        this.path = extensionPath;
        this.name = validTheme(name);
        this.fluentFiles = null; // lazily loaded Set of "<Folder>.Gadget/<relative path>"
    }
    get fluent() {
        if (!this.fluentFiles) {
            this.fluentFiles = new Set();
            try {
                const [ok, bytes] = GLib.file_get_contents(`${this.path}/assets/fluent-assets.json`);
                if (ok) for (const record of JSON.parse(new TextDecoder().decode(bytes)).files || []) this.fluentFiles.add(record.path);
            } catch { /* No fluent import: every lookup falls back to the original skins. */ }
        }
        return this.fluentFiles;
    }
    /** True when a Rectify11 replacement for this original file has been imported. */
    has(folderName, relPath) { return this.fluent.has(`${folderName}.Gadget/${relPath}`); }
    /** Absolute path of the skin file to draw for the active theme. */
    resolve(folderName, relPath) {
        const source = this.name === 'fluent' && this.has(folderName, relPath) ? 'fluent' : 'original';
        return `${this.path}/assets/${source}/${folderName}.Gadget/${relPath}`;
    }
}
