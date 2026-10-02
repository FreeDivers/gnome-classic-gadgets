// Runs only in the isolated Wayland session; never opens a window on the real desktop.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/gnome-shell-dbus-interfaces.gresource'));
const root = GLib.getenv('CG_TEST_SOURCE'), out = GLib.getenv('CG_TEST_OUTPUT');
// Prefer the copy installed in the isolated session (its schemas/ was just compiled); fall back to the source tree.
const extensionDir = GLib.getenv('CG_TEST_EXTENSION') || `${root}/extension`;
const loop = new GLib.MainLoop(null, false);
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const checks = [];
function assert(condition, message) { if (!condition) throw new Error(message); checks.push(message); print(`PREFS PASS: ${message}`); }
function descendants(rootWidget) {
    const all = [];
    const walk = widget => { all.push(widget); for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) walk(child); };
    walk(rootWidget); return all;
}
(async () => {
    let window;
    try {
        Adw.init();
        const {default: Prefs} = await import(`file://${extensionDir}/prefs.js`);
        const [, bytes] = Gio.File.new_for_path(`${extensionDir}/metadata.json`).load_contents(null);
        const metadata = {...JSON.parse(new TextDecoder().decode(bytes)), path: extensionDir, dir: Gio.File.new_for_path(extensionDir)};
        const prefs = new Prefs(metadata);
        window = new Adw.PreferencesWindow();
        prefs.fillPreferencesWindow(window);
        window.present();
        await wait(900);
        const widgets = descendants(window);
        const pages = widgets.filter(w => w instanceof Adw.PreferencesPage && ['桌面', '本地小组件', '网络数据', '联系人'].includes(w.title));
        print('Preferences pages: ' + widgets.filter(w => w instanceof Adw.PreferencesPage).map(w => w.title).join(', '));
        assert(pages.length === 4, 'all four settings pages render');
        const rows = widgets.filter(w => w instanceof Adw.PreferencesRow);
        const find = title => rows.find(w => w.title === title);
        const settings = prefs.getSettings();
        const face = find('表盘'); face.selected = 2;
        assert(JSON.parse(settings.get_string('options')).clock.face === 'cronometer', 'clock face selector persists');
        const zone = find('时区（留空跟随系统）'); zone.text = 'Europe/London'; zone.emit('apply');
        assert(JSON.parse(settings.get_string('options')).clock.timezone === 'Europe/London', 'valid timezone applies');
        zone.text = 'Invalid/Zone'; zone.emit('apply');
        assert(JSON.parse(settings.get_string('options')).clock.timezone === 'Europe/London', 'invalid timezone rejected');
        zone.text = ''; zone.emit('apply');
        const latitude = find('纬度'); latitude.text = '100'; latitude.emit('apply');
        assert(JSON.parse(settings.get_string('options')).weather?.latitude !== 100, 'out-of-range latitude rejected');
        const editor = widgets.find(w => w instanceof Gtk.TextView);
        assert(!!editor, 'contacts editor exists');
        editor.buffer.set_text('测试偏好 | 123456 | person@example.com', -1);
        const save = widgets.find(w => w instanceof Gtk.Button && w.label === '保存联系人'); save.emit('clicked');
        assert(JSON.parse(settings.get_string('options')).contacts.people[0].name === '测试偏好', 'contacts edited and saved through preferences');
        const scale = find('缩放比例'); scale.value = 1.15;
        assert(Math.abs(settings.get_double('scale') - 1.15) < 0.001, 'scale binding writes GSettings');
        scale.value = 1; face.selected = 0;
        const weather = rows.find(w => w instanceof Adw.SwitchRow && w.title === '天气');
        weather.active = true; assert(settings.get_strv('enabled-gadgets').includes('weather'), 'gallery toggle enables gadget');
        weather.active = false;
        window.set_visible_page(pages[0]);
        GLib.file_set_contents(`${out}/prefs-ready`, 'ready');
        // Shell test takes a screenshot and verifies stacking while this is open.
        for (let i = 0; i < 80 && !GLib.file_test(`${out}/prefs-captured`, GLib.FileTest.EXISTS); i++) await wait(100);
        window.close(); window = null;
        GLib.file_set_contents(`${out}/prefs-result.json`, JSON.stringify({ok: true, checks}, null, 2));
    } catch (error) {
        console.error(error);
        GLib.file_set_contents(`${out}/prefs-result.json`, JSON.stringify({ok: false, error: String(error), stack: error.stack, checks}, null, 2));
        window?.destroy();
    } finally { loop.quit(); }
})();
loop.run();
