// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export async function run(app, h) {
    const chinese = GLib.getenv('CG_TEST_LANGUAGE') === 'zh_CN';
    const {GADGETS} = await import(`file://${app.path}/lib/core.js`);
    const {_, formatDate, formatNumber} = await import(`file://${app.path}/lib/i18n.js`);
    h.check(_('Find my location') === (chinese ? '定位当前位置' : 'Find my location'), 'Shell binds the requested gettext catalog');
    const labels = app.indicator.menu._getMenuItems().map(item => item.label?.text).filter(Boolean);
    const product = chinese ? 'Windows Vista/7 小组件' : 'Windows Vista/7 Widgets';
    h.check(app.metadata.name === 'Windows Vista/7 小组件', 'loaded extension metadata uses the requested product name');
    h.check(labels[0] === product, 'top bar heading uses the product name');
    h.check(app.indicator.accessible_name === product, 'top bar accessibility name uses the product name');
    h.check(labels.includes(chinese ? '添加小组件…' : 'Add Widgets…'), 'top bar menu is translated');
    h.check(labels.includes(chinese ? '扩展设置…' : 'Extension Settings…'), 'top bar settings entry is translated');
    const names = Object.values(GADGETS).map(info => info.name);
    h.check(names.length === 14 && (chinese ? names.includes('天气') : names.every(name => !/\p{Script=Han}/u.test(name))), 'all fourteen catalog names use the selected language');
    const weather = app.widgets.get('weather');
    const specs = weather.optionsSpec();
    h.check(specs.some(field => field.label === (chinese ? '定位当前位置' : 'Find my location')), 'weather action labels are translated');
    for (const [type, widget] of app.widgets) {
        h.check(widget.tools.options.accessible_name === (chinese ? '设置' : 'Settings'), `${type}: toolbar accessibility text is translated`);
        if (!chinese) h.check(widget.optionsSpec().every(field => !/\p{Script=Han}/u.test(`${field.label ?? ''}${field.hint ?? ''}`)), `${type}: English option labels have no hard-coded Chinese`);
    }
    // Run the real refresh path with deterministic data; do not make a network
    // request or alter the user's widget options just to exercise cached text.
    const {NetworkGadget} = await import(`file://${app.path}/lib/gadgets/network-gadget.js`);
    const saved = Date.parse('2026-01-04T12:34:00Z');
    const sample = {
        type: 'stocks', scope: {alive: true}, networkStatus: {text: ''}, actor: {},
        host: {sources: {status: {state: 'ready'}, description: 'Test region',
            wait: async () => {}, source: () => ({name: 'Test provider', url: 'https://example.org'})}},
        render: () => {}, fetchData: async () => ({value: [], saved, stale: true}),
    };
    const time = formatDate(new Date(saved), {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    try {
        await NetworkGadget.prototype.refresh.call(sample);
        h.check(sample.networkStatus.text.includes(chinese ? `更新失败；显示 ${time} 的缓存数据` : `Update failed; showing cached data from ${time}`), 'cached-data message retains the localized save time');
        sample.fetchData = async () => ({value: [], saved, stale: false});
        await NetworkGadget.prototype.refresh.call(sample);
        h.check(sample.networkStatus.text.includes(time), 'successful refresh uses a localized timestamp');
    } finally { sample.requestScope?.destroy(); }
    const stocks = app.widgets.get('stocks');
    stocks.render([{name: 'Test stock', price: 1234.5, precision: 2, changePct: 12.34,
        time: saved / 1000, secid: '1.600519', code: '600519', status: 'Test status'}]);
    h.check(stocks.rows[0].price.text === formatNumber(1234.5, {minimumFractionDigits: 2, maximumFractionDigits: 2}), 'stock prices use locale-aware number formatting');
    h.check(stocks.rows[0].change.text.startsWith(formatNumber(0.1234, {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'})), 'stock percentage changes use locale-aware number formatting');
    const content = () => JSON.stringify({notes: app.widgets.get('notes').options.text, contacts: app.widgets.get('contacts').options.people});
    const original = content();
    app.openOptions(weather); await app.dialog.whenReady();
    h.check(app.dialog.nativeWindow.get_title() === (chinese ? '天气设置' : 'Weather Settings'), 'real options subprocess has a localized window title');
    const options = app.dialog.config; app.closeOptions(); await h.wait(300);
    app.showGallery(); await app.ui.gallery.whenReady();
    h.check(app.ui.gallery.nativeWindow.get_title() === (chinese ? '添加小组件' : 'Add Widgets'), 'real gallery subprocess has a localized window title');
    const gallery = app.ui.gallery.config; app.ui.gallery.hide(); await h.wait(500);
    h.check(content() === original, 'opening translated UI does not rewrite notes or contacts');
    GLib.file_set_contents(`${h.out}/i18n-config.json`, JSON.stringify({options, gallery}));
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
    launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
    launcher.setenv('CG_I18N_EXTENSION', app.path, true); launcher.setenv('CG_I18N_OUTPUT', h.out, true);
    for (const name of ['i18n-stage', 'i18n-ack', 'i18n-windows-result.json']) {
        const f = Gio.File.new_for_path(`${h.out}/${name}`); if (f.query_exists(null)) f.delete(null);
    }
    const process = launcher.spawnv(['gjs', '-m', `${GLib.getenv('CG_TEST_SOURCE')}/tests/i18n-windows-test.js`]);
    const resultFile = `${h.out}/i18n-windows-result.json`;
    let last = '';
    try {
        for (let i = 0; i < 400 && !GLib.file_test(resultFile, GLib.FileTest.EXISTS); i++) {
            if (GLib.file_test(`${h.out}/i18n-stage`, GLib.FileTest.EXISTS)) {
                const [, bytes] = GLib.file_get_contents(`${h.out}/i18n-stage`), stage = new TextDecoder().decode(bytes);
                if (stage !== last) {await h.wait(200); await h.screenshot(`${stage}.png`); GLib.file_set_contents(`${h.out}/i18n-ack`, stage); last = stage;}
            }
            await h.wait(100);
        }
        h.check(GLib.file_test(resultFile, GLib.FileTest.EXISTS), 'standalone translated UI checks finish');
        const [, bytes] = GLib.file_get_contents(resultFile), result = JSON.parse(new TextDecoder().decode(bytes));
        h.check(result.ok, `GTK i18n checks: ${result.error ?? 'passed'}`);
        for (const check of result.checks) h.check(true, check);
    } finally {process.force_exit();}
}
