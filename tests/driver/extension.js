import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Driver extends Extension {
    enable() {
        if (!GLib.getenv('CG_TEST_SOURCE')) return;
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            this.timer = 0;
            import(`file://${GLib.getenv('CG_TEST_SOURCE')}/tests/shell-test.js`).then(m => m.run()).catch(e => {
                console.error(e);
                GLib.file_set_contents(`${GLib.getenv('CG_TEST_OUTPUT')}/result.json`, JSON.stringify({ok: false, error: String(e), stack: e.stack}));
            });
            return GLib.SOURCE_REMOVE;
        });
    }
    disable() { if (this.timer) GLib.Source.remove(this.timer); this.timer = 0; }
}
