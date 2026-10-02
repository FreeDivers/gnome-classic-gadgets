import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {GADGETS, DEFAULT_ENABLED, SOLVED, validPuzzle, solvablePuzzle} from '../extension/lib/core.js';
const UUID = 'classic-gadgets@qinyan.local';
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
export async function screenshot(path) {
    const output = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot(false, output, (s, result) => { try { s.screenshot_finish(result); resolve(); } catch (e) { reject(e); } }));
    output.close(null);
}
export async function run() {
    const output = GLib.getenv('CG_TEST_OUTPUT');
    const checks = [], providers = {};
    const assert = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); console.log(`CG TEST PASS: ${name}`); };
    try {
        Main.overview.hide();
        await wait(500);
        const record = Main.extensionManager.lookup(UUID);
        assert(!!record, 'extension registered');
        const app = record.stateObj;
        assert(!!app?.widgets, `extension enabled: ${JSON.stringify(record.errors)}`);
        assert(app.widgets.size === 4, `four default desktop gadgets: ${app.errors.join('; ')}`);
        assert(app.layer.get_parent() === global.window_group, 'native desktop layer, not a floating app window');
        assert(app.layer.visible, 'desktop gadgets visible outside overview');
        await wait(2200);
        assert(app.widgets.get('system').values.cpu !== null, 'live Linux CPU deltas sampled');
        assert(app.widgets.get('system').values.memory.total > 0, 'live Linux memory sampled');
        for (const [type, widget] of app.widgets) {
            assert(widget.width === GADGETS[type].width && widget.height === (type === 'stocks' ? 76 : GADGETS[type].height), `${type}: original logical dimensions`);
            assert(widget.actor.get_theme_node().get_background_color().alpha === 0, `${type}: no invented card background`);
            assert(widget.toolbar.opacity === 0, `${type}: no permanent title bar or controls`);
        }
        assert(app.widgets.get('clock').face.originalAsset === 'Clock.Gadget/images/trad.png', 'clock uses untouched original traditional face');
        assert(app.widgets.get('clock').hour.originalAsset === 'Clock.Gadget/images/trad_h.png', 'clock uses original hand graphics, not Cairo replacements');
        await screenshot(`${output}/desktop-default.png`);

        // Actual Clutter input, not direct method calls, verifies actor picking and grabs.
        const seat = global.stage.get_context().get_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const motion = async (x, y) => { pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y); await wait(90); };
        const press = async state => { pointer.notify_button(GLib.get_monotonic_time(), 1, state); await wait(90); };
        const clock = app.widgets.get('clock');
        const oldX = clock.actor.x, oldY = clock.actor.y;
        const [hx, hy] = clock.header.get_transformed_position();
        await motion(hx + 40, hy + 10); await press(Clutter.ButtonState.PRESSED);
        assert(!!app.drag, 'pointer drag starts on original skin');
        await motion(hx - 160, hy + 40); await press(Clutter.ButtonState.RELEASED);
        assert(!app.drag && clock.actor.x < oldX - 100 && clock.actor.y > oldY, 'pointer drag moves and releases desktop gadget');
        assert(Number.isFinite(app.store.layout.clock.x), 'dragged position persisted');
        app.settings.set_boolean('locked', true);
        const [lx, ly] = clock.header.get_transformed_position();
        await motion(lx + 40, ly + 10); await press(Clutter.ButtonState.PRESSED);
        assert(!app.drag, 'position lock prevents dragging');
        await press(Clutter.ButtonState.RELEASED);
        app.settings.set_boolean('locked', false);
        app.settings.set_string('layout', '{}');
        app.settings.set_double('scale', 1.25); await wait(200);
        assert(clock.actor.scale_x === 1.25, 'scale setting applied to native actors');
        app.settings.set_double('scale', 1);
        app.settings.set_boolean('visible', false); assert(!app.layer.visible, 'visibility toggle hides layer');
        app.settings.set_boolean('visible', true);
        Main.overview.show(); await wait(300); assert(!app.layer.visible, 'overview hides private gadget content');
        Main.overview.hide(); await wait(300); assert(app.layer.visible, 'overview exit restores layer');

        const notes = app.widgets.get('notes');
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        notes.entry.set_text('');
        const [ex, ey] = notes.entry.get_transformed_position();
        await motion(ex + 9, ey + 8); await press(Clutter.ButtonState.PRESSED); await press(Clutter.ButtonState.RELEASED);
        assert(!app.drag && global.stage.get_key_focus() === notes.entry.clutter_text, 'clicking note text focuses editing instead of dragging');
        for (const key of [Clutter.KEY_a, Clutter.KEY_Return, Clutter.KEY_b]) {
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
            await wait(120);
        }
        assert(notes.entry.get_text() === 'a\nb', 'real keyboard input including newline reaches the desktop note');
        global.stage.set_key_focus(null);
        notes.entry.set_text('隔离测试便笺\n第二行'); await wait(500);
        assert(app.store.optionsFor('notes').text === '隔离测试便笺\n第二行', 'multiline notes auto-save');
        notes.addPage(); notes.entry.set_text('第二张便笺'); await wait(500);
        notes.changePage(-1); assert(notes.entry.get_text() === '隔离测试便笺\n第二行', 'original note page buttons preserve independent text');
        assert(notes.pages.length === 2, 'multiple original sticky notes persisted');

        app.settings.set_strv('enabled-gadgets', Object.keys(GADGETS)); await wait(800);
        assert(app.widgets.size === 14, `all 14 Windows Vista/7 widgets instantiate: ${app.errors.join('; ')}`);
        assert(app.errors.length === 0, 'no gadget construction errors');
        const calc = app.widgets.get('calculator');
        calc.entry.set_text('(2+3)*sqrt(81)'); calc.entry.clutter_text.emit('activate');
        assert(calc.result.text === '45', 'calculator activation computes safely');
        calc.entry.set_text('1/0'); calc.evaluate(); assert(calc.result.text.includes('零'), 'calculator handles invalid math');
        calc.entry.set_text('2026-2006'); calc.evaluate();
        const calendar = app.widgets.get('calendar'), oldMonth = calendar.month;
        calendar.navigate(1); assert(calendar.month === (oldMonth + 1) % 12, 'calendar month navigation works');
        calendar.navigate(-1);
        const timer = app.widgets.get('timer');
        timer.save({duration: 30, remaining: 30, running: false, deadline: 0}); timer.action('start');
        await wait(1200); timer.action('pause');
        assert(!timer.options.running && timer.options.remaining < 30, 'timer starts, counts down, pauses');
        timer.action('reset'); assert(timer.display.text === '00:30', 'timer resets');
        const puzzle = app.widgets.get('puzzle');
        assert(validPuzzle(puzzle.options.tiles) && solvablePuzzle(puzzle.options.tiles), 'puzzle shuffle remains solvable in UI');
        puzzle.save({tiles: [...SOLVED], moves: 0}); puzzle.render(); puzzle.move(14); puzzle.move(15);
        assert(puzzle.status.text.includes('完成'), 'picture tile moves update solved state');
        puzzle.shuffle();
        const contacts = app.widgets.get('contacts');
        app.store.saveOptions('contacts', {people: [{name: '测试联系人', phone: '12345', email: 'test@example.com'}]});
        contacts.search.set_text('测试');
        assert(contacts.items.get_n_children() === 1 && contacts.status.text.includes('1 位'), 'local contacts save and filter');

        // Exercise image decoding with generated fixture images (no user photos).
        const photos = app.widgets.get('photos');
        app.store.saveOptions('photos', {directory: `${GLib.getenv('CG_TEST_SOURCE')}/build/test-photos`, interval: 5, paused: false});
        await wait(800);
        assert(photos.files.length === 2, 'slideshow enumerates local image fixtures');
        const photoIndex = photos.index; photos.next(1); assert(photos.index !== photoIndex, 'slideshow manual navigation');
        // The real slideshow samples the deadline once a second. Do not assume
        // it will hit an exact 5.2-second sleep boundary on a busy compositor.
        const manualAdvance = photos.lastAdvance;
        const deadline = Date.now() + 7500;
        while (photos.lastAdvance === manualAdvance && Date.now() < deadline) await wait(100);
        assert(photos.lastAdvance > manualAdvance && photos.index === photoIndex, 'slideshow automatic interval');
        await wait(1500);
        for (const type of ['weather', 'currency', 'rss', 'stocks']) {
            const widget = app.widgets.get(type);
            for (let i = 0; i < 30 && widget.busy; i++) await wait(500);
            providers[type] = {hasData: !!widget.data, status: widget.networkStatus.text};
            assert(!!widget.data, `${type}: real service data parsed and rendered (${widget.networkStatus.text})`);
        }
        app.store.saveOptions('photos', {directory: '', paused: true});
        await wait(300);
        assert(photos.background.originalAsset === 'SlideShow.Gadget/images/in_sidebar/slideshow_glass_frame.png', 'slideshow uses original glass frame, not a bare image');
        assert(photos.caption.text === 'Garden.jpg', 'original sample photo restored from before placeholder replacement');
        await motion(10, 300); await wait(200);
        for (const [type, widget] of app.widgets) {
            assert(widget.width === GADGETS[type].width && widget.height === (type === 'stocks' ? 76 : GADGETS[type].height), `${type}: gallery retains original skin size`);
        }
        await screenshot(`${output}/desktop-all.png`);
        GLib.file_set_contents(`${output}/ui-state.json`, JSON.stringify([...app.widgets].map(([type, widget]) => ({type, x: widget.actor.x, y: widget.actor.y, width: widget.actor.width, height: widget.actor.height, bodyHeight: widget.body.height})), null, 2));
        for (const face of ['trad', 'system', 'cronometer', 'diner', 'flower', 'modern', 'square', 'novelty']) {
            app.store.saveOptions('clock', {face}); await wait(80);
            assert(clock.face.originalAsset === `Clock.Gadget/images/${face}.png`, `original clock theme: ${face}`);
        }
        app.store.saveOptions('clock', {face: 'trad'});
        const cal = app.widgets.get('calendar');
        app.store.saveOptions('calendar', {expanded: true}); await wait(180);
        assert(cal.height === 264 && cal.monthView.visible, 'calendar expands to original double-page skin');
        await screenshot(`${output}/calendar-expanded.png`);
        app.store.saveOptions('calendar', {expanded: false});
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.setenv('WAYLAND_DISPLAY', GLib.getenv('WAYLAND_DISPLAY'), true);
        launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
        launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
        // The installed copy carries the freshly compiled schema; the source tree's gschemas.compiled is a build artifact.
        launcher.setenv('CG_TEST_EXTENSION', app.path, true);
        const prefsProcess = launcher.spawnv(['gjs', '-m', `${GLib.getenv('CG_TEST_SOURCE')}/tests/prefs-test.js`]);
        for (let i = 0; i < 100 && !GLib.file_test(`${output}/prefs-ready`, GLib.FileTest.EXISTS) && !GLib.file_test(`${output}/prefs-result.json`, GLib.FileTest.EXISTS); i++) await wait(100);
        if (GLib.file_test(`${output}/prefs-ready`, GLib.FileTest.EXISTS)) {
            await wait(300);
            const nativeWindow = global.get_window_actors().find(actor => actor.get_meta_window()?.get_title()?.includes('Windows Vista/7 小组件'));
            assert(!!nativeWindow, 'preferences opens as a native GTK window');
            const children = global.window_group.get_children();
            assert(children.indexOf(app.layer) < children.indexOf(nativeWindow), 'gadgets stay below normal application windows');
            await screenshot(`${output}/preferences.png`);
            GLib.file_set_contents(`${output}/prefs-captured`, 'yes');
        }
        await new Promise((resolve, reject) => prefsProcess.wait_async(null, (p, r) => { try { p.wait_finish(r); resolve(); } catch (e) { reject(e); } }));
        const [, prefsBytes] = Gio.File.new_for_path(`${output}/prefs-result.json`).load_contents(null);
        const prefsResult = JSON.parse(new TextDecoder().decode(prefsBytes));
        assert(prefsResult.ok, `preferences UI integration: ${prefsResult.error || prefsResult.checks.length + ' checks'}`);
        app.settings.set_strv('enabled-gadgets', Object.keys(GADGETS));
        await wait(200);
        // Persistence survives complete disable / enable, and old timers/signals are freed.
        const oldLayer = app.layer, oldScopes = [...app.widgets.values()].map(w => w.scope), oldNetwork = app.network;
        app.disable(); await wait(150);
        assert(!global.window_group.get_children().includes(oldLayer), 'disable removes the desktop layer');
        assert(oldScopes.every(scope => !scope.alive && scope.sources.size === 0 && scope.signals.length === 0), 'disable cleans every widget timer and signal');
        assert(!oldNetwork.scope.alive, 'disable cancels networking');
        app.enable(); await wait(500);
        assert(app.widgets.size === 14, 're-enable reconstructs every gadget');
        assert(app.widgets.get('notes').entry.get_text() === '隔离测试便笺\n第二行', 'notes survive disable and re-enable');
        app.settings.set_strv('enabled-gadgets', DEFAULT_ENABLED); await wait(150);
        assert(app.widgets.size === 4, 'removing gadgets destroys their actors');
        GLib.file_set_contents(`${output}/result.json`, JSON.stringify({ok: true, checks, providers}, null, 2));
    } catch (e) {
        console.error(e);
        try { await screenshot(`${output}/failure.png`); } catch (s) { console.error(s); }
        GLib.file_set_contents(`${output}/result.json`, JSON.stringify({ok: false, error: String(e), stack: e.stack, checks, providers}, null, 2));
    }
}
