// SPDX-License-Identifier: MIT
// Run only inside scripts/test-i18n.sh's isolated Wayland session.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const root = GLib.getenv('CG_I18N_EXTENSION'), out = GLib.getenv('CG_I18N_OUTPUT');
const chinese = GLib.getenv('CG_TEST_LANGUAGE') === 'zh_CN';
const checks = [];
const loop = new GLib.MainLoop(null, false);
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const read = path => {const [,bytes] = GLib.file_get_contents(path); return new TextDecoder().decode(bytes);};
function check(condition, message) {if (!condition) throw new Error(message); checks.push(message);}
function allWidgets(widget) {
    const list = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) list.push(...allWidgets(child));
    return list;
}
async function capture(name) {
    GLib.file_set_contents(`${out}/i18n-stage`, name);
    for (let i = 0; i < 100; i++) {
        if (GLib.file_test(`${out}/i18n-ack`, GLib.FileTest.EXISTS) && read(`${out}/i18n-ack`) === name) return;
        await wait(100);
    }
    throw new Error(`Screenshot acknowledgement timed out: ${name}`);
}
(async () => {
    let options, gallery, prefs;
    try {
        Adw.init();
        const {OptionsWindow} = await import(`file://${root}/helpers/options-window.js`);
        const {GalleryWindow} = await import(`file://${root}/helpers/gallery-window.js`);
        const config = JSON.parse(read(`${out}/i18n-config.json`));
        options = new OptionsWindow(config.options, () => {}); options.present(); await wait(300);
        check(options.cancelButton.label === (chinese ? '取消' : 'Cancel'), 'standalone options helper translates Cancel');
        check(options.okButton.label === (chinese ? '确定' : 'OK'), 'standalone options helper translates OK');
        check(options.rows.get('cityAuto').row.title === (chinese ? '自动显示地名' : 'Show place name automatically'), 'Shell option labels arrive in the helper unchanged');
        check(options.rows.get('station').row.title === (chinese ? '气象站编号（可留空）' : 'Station ID (optional)'), 'advanced option labels use the active language');
        options.receive({cmd: 'set', key: 'city', value: '我的城市 {value} $&'});
        options.receive({cmd: 'set', key: 'cityAuto', value: false});
        check(options.rows.get('city').control.text === '我的城市 {value} $&', 'user-entered city text is not translated or interpolated');
        await capture('options-i18n'); options.destroy(); options = null;

        gallery = new GalleryWindow(config.gallery, () => {}); gallery.present(); await wait(300);
        check(gallery.addButton.label === (chinese ? '添加到桌面' : 'Add to Desktop'), 'standalone gallery translates Add to Desktop');
        check(gallery.removeButton.label === (chinese ? '移除' : 'Remove'), 'standalone gallery translates Remove');
        check(gallery.empty.title === (chinese ? '没有找到小组件' : 'No widgets found'), 'gallery empty-state copy is translated');
        check(gallery.previous.tooltip_text === (chinese ? '上一页' : 'Previous page'), 'gallery tooltips use the active language');
        await capture('gallery-i18n'); gallery.destroy(); gallery = null;

        Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
        Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/gnome-shell-dbus-interfaces.gresource'));
        const {default: Prefs} = await import(`file://${root}/prefs.js`);
        const metadata = {...JSON.parse(read(`${root}/metadata.json`)), path: root, dir: Gio.File.new_for_path(root)};
        const controller = new Prefs(metadata); prefs = new Adw.PreferencesWindow(); controller.fillPreferencesWindow(prefs);
        prefs.present(); await wait(350);
        const widgets = allWidgets(prefs);
        const pages = widgets.filter(w => w instanceof Adw.PreferencesPage);
        const expected = chinese ? ['桌面', '本地小组件', '网络数据', '联系人'] : ['Desktop', 'Local Widgets', 'Online Data', 'Contacts'];
        check(expected.every(title => pages.some(page => page.title === title)), 'all four preferences pages are translated');
        check(prefs.title === (chinese ? 'Windows Vista/7 小组件设置' : 'Windows Vista/7 Widgets Settings'), 'preferences window title is translated');
        const rows = widgets.filter(w => w instanceof Adw.PreferencesRow);
        check(rows.some(row => row.title === (chinese ? '桌面右键菜单' : 'Desktop context menu')), 'preferences row labels are translated');
        check(widgets.some(w => w instanceof Gtk.Button && w.label === (chinese ? '保存联系人' : 'Save contacts')), 'preferences action buttons are translated');
        const online = pages.find(page => page.title === expected[2]); prefs.set_visible_page(online); await wait(200);
        await capture('preferences-i18n'); prefs.close(); prefs = null;
        GLib.file_set_contents(`${out}/i18n-windows-result.json`, JSON.stringify({ok: true, checks}));
    } catch (error) {
        GLib.file_set_contents(`${out}/i18n-windows-result.json`, JSON.stringify({ok: false, checks, error: String(error), stack: error.stack}));
    } finally {options?.destroy(); gallery?.destroy(); prefs?.destroy(); loop.quit();}
})();
loop.run();
