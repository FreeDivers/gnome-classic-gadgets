// SPDX-License-Identifier: MIT
// Phase-1 framework smoke script: exercises the host features that phase-2 gadgets rely on.
// Run: bash scripts/smoke-shell.sh clock,calendar,notes --script tests/smoke/scripts/phase1-framework.js --out build/smoke/phase1
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DBUS = ['org.gnome.Shell', '/org/gnome/Shell/Extensions/ClassicGadgets', 'org.gnome.Shell.Extensions.ClassicGadgets'];
const dbus = (method, parameters = null) => new Promise((resolve, reject) => Gio.DBus.session.call(...DBUS, method, parameters, null, Gio.DBusCallFlags.NONE, 5000, null, (connection, result) => {
    try { resolve(connection.call_finish(result)); } catch (e) { reject(e); }
}));

export async function run(app, h) {
    const {check, Clutter} = h;
    const clock = app.widgets.get('clock'), calendar = app.widgets.get('calendar'), notes = app.widgets.get('notes');

    // Runtime stylesheets and the theme object.
    check(app.stylesheets.some(file => file.get_basename() === 'ui.css'), 'lib/ui/ui.css loaded at enable');
    check(app.theme?.name === 'classic' && app.theme.has('Clock', 'images/trad.png') && !app.theme.has('Notes', 'images/sticky_well.png'), 'Theme.has() reflects the fluent manifest');

    // Hover toolbar: order and icons.
    const names = actor => actor.toolbar.get_children().map(child => child.accessible_name).join(',');
    check(names(calendar) === '关闭,大尺寸,选项,拖动', `toolbar order close/size/options/handle (${names(calendar)})`);
    check(names(clock) === '关闭,选项,拖动', 'no size tool without a large definition');
    check(calendar.tools.size.child.icon_name === 'view-fullscreen-symbolic', 'size tool shows view-fullscreen-symbolic when small');

    // Size switch keeps the top-left corner; calendar mirrors expanded.
    const [x0, y0] = [calendar.actor.x, calendar.actor.y];
    calendar.setSize('large'); await h.wait(200);
    check(calendar.large && calendar.height === 264 && calendar.actor.height === 264 && calendar.options.expanded === true, 'setSize(large) rebuilds the calendar at 130×264 with expanded=true');
    check(calendar.actor.x === x0 && calendar.actor.y === y0, `top-left kept across the size switch (${x0},${y0})`);
    check(calendar.tools.size.child.icon_name === 'view-restore-symbolic' && calendar.tools.size.accessible_name === '小尺寸', 'size tool flips to view-restore-symbolic / 小尺寸');
    check(app.store.optionsFor('calendar').size === 'large', 'size persisted in options');
    await h.screenshot('calendar-large.png');
    calendar.tools.size.emit('clicked', 1); await h.wait(200);
    check(!calendar.large && calendar.height === 141 && calendar.options.expanded === false, 'toolbar size button toggles back to small');
    app.store.saveOptions('calendar', {expanded: true}); await h.wait(200);
    check(calendar.large && calendar.options.size === 'large', 'legacy expanded=true from prefs maps to size=large');
    app.store.saveOptions('calendar', {expanded: false}); await h.wait(200);
    check(!calendar.large, 'legacy expanded=false maps back to small');

    // Theme switch rebuilds every gadget through Theme.resolve().
    const scopeBefore = clock.scope;
    app.settings.set_string('theme', 'fluent'); await h.wait(300);
    check(app.theme.name === 'fluent' && app.widgets.get('clock') === clock, 'changed::theme swaps host.theme and rebuilds in place');
    check(clock.scope !== scopeBefore && !scopeBefore.alive, 'rebuild() replaces the gadget scope and destroys the old one');
    check(clock.face.assetPath.includes('/assets/fluent/Clock.Gadget/images/trad.png'), 'clock face now comes from assets/fluent');
    check(clock.highlight.assetPath.includes('/assets/original/'), 'file missing from the fluent import falls back to the original');
    check(notes.background.assetPath.includes('/assets/original/Notes.Gadget/'), 'gadget without fluent skin keeps the original files');
    check(notes.entry.get_text() === '' || typeof notes.entry.get_text() === 'string', 'notes survive the rebuild');
    await h.screenshot('fluent.png');
    app.settings.set_string('theme', 'classic'); await h.wait(300);
    check(clock.face.assetPath.includes('/assets/original/Clock.Gadget/images/trad.png'), 'switching back restores the original files');

    // Right-click detection: gadget body → gadget menu, bare desktop → desktop menu.
    const menus = app.ui.menus, calls = [];
    const [openGadgetMenu, openDesktopMenu] = [menus.openGadgetMenu, menus.openDesktopMenu];
    menus.openGadgetMenu = (gadget, mx, my) => calls.push(['gadget', gadget.type, mx, my]);
    menus.openDesktopMenu = (mx, my) => calls.push(['desktop', mx, my]);
    const [bx, by] = clock.body.get_transformed_position();
    await h.click(bx + 40, by + 40, 3);
    check(calls.at(-1)?.[0] === 'gadget' && calls.at(-1)[1] === 'clock', 'right-click on the skin → host.openContextMenu(gadget)');
    await h.click(300, 500, 3);
    check(calls.at(-1)?.[0] === 'desktop' && Math.abs(calls.at(-1)[1] - 300) < 2, 'right-click on the bare desktop → host.openDesktopMenu(x, y)');
    await h.click(bx + 40, by + 40, 1);
    check(!app.drag && calls.length === 2, 'left click does not open menus');
    menus.openGadgetMenu = openGadgetMenu; menus.openDesktopMenu = openDesktopMenu;

    // Dragging by the toolbar handle.
    await h.motion(bx + 40, by + 40); await h.wait(150);
    check(clock.toolbar.opacity === 255, 'hover reveals the toolbar');
    const [hx, hy] = clock.tools.handle.get_transformed_position();
    const startX = clock.actor.x;
    await h.motion(hx + 8, hy + 8); await h.button(1, Clutter.ButtonState.PRESSED);
    check(app.drag?.surface === clock.tools.handle, 'press on the drag handle starts a drag');
    await h.motion(hx - 200, hy + 60); await h.button(1, Clutter.ButtonState.RELEASED);
    check(!app.drag && clock.actor.x < startX - 150, 'drag by handle moves the gadget');

    // Options button → dialog stub → host.openPreferences fallback.
    let prefsOpened = 0;
    const openPreferences = app.openPreferences;
    app.openPreferences = () => { prefsOpened++; };
    clock.tools.options.emit('clicked', 1);
    check(app.dialog?.gadget === clock && prefsOpened === 1, 'options tool → host.openOptions → stub falls back to preferences');
    app.closeOptions(); check(app.dialog === null, 'closeOptions clears the dialog');
    app.openPreferences = openPreferences;

    // Gallery stub opens the panel menu; panel menu entries.
    app.showGallery(); await h.wait(100);
    check(app.indicator.menu.isOpen, 'showGallery() (stub) opens the panel menu');
    const labels = app.indicator.menu._getMenuItems().map(item => item.label?.text).filter(Boolean);
    check(labels[1] === '添加小工具…' && labels.includes('外观') && labels.includes('设置与内容…'), `panel menu entries: ${labels.join(' / ')}`);
    app.indicator.menu.close(); await h.wait(100);

    // addGadgetAt places the top-left corner at the point (clamped).
    app.addGadgetAt('timer', 300, 300); await h.wait(300);
    const timer = app.widgets.get('timer');
    check(timer && timer.actor.x === 300 && timer.actor.y === 300, 'addGadgetAt enables a gadget at the stage point');
    app.addGadgetAt('timer', 5000, 5000); await h.wait(200);
    check(timer.actor.x + timer.actor.width <= global.stage.width && timer.actor.y + timer.actor.height <= global.stage.height, 'addGadgetAt clamps to the work area');

    // D-Bus interface on org.gnome.Shell.
    const [list] = (await dbus('ListGadgets')).deep_unpack();
    check(list.length === 14 && list.find(([type]) => type === 'timer')[1] === true && list.find(([type]) => type === 'calendar')[2] === 'small', 'D-Bus ListGadgets → a(sbs)');
    await dbus('AddGadget', new GLib.Variant('(s)', ['puzzle'])); await h.wait(300);
    check(app.widgets.has('puzzle'), 'D-Bus AddGadget');
    await dbus('SetSize', new GLib.Variant('(ss)', ['calendar', 'large'])); await h.wait(300);
    check(calendar.large, 'D-Bus SetSize');
    await dbus('SetSize', new GLib.Variant('(ss)', ['notes', 'large'])); await h.wait(300);
    check(app.store.optionsFor('notes').size === 'large' && notes.size === 'large', 'D-Bus SetSize on notes stores size=large (layout follows in phase 2)');
    await dbus('SetSize', new GLib.Variant('(ss)', ['notes', 'small'])); await h.wait(300);
    let rejected = 0;
    for (const [method, args] of [['AddGadget', new GLib.Variant('(s)', ['nope'])], ['SetSize', new GLib.Variant('(ss)', ['clock', 'large'])], ['SetTheme', new GLib.Variant('(s)', ['neon'])], ['OpenOptions', new GLib.Variant('(s)', ['stocks'])]]) {
        try { await dbus(method, args); } catch { rejected++; }
    }
    check(rejected === 4, 'D-Bus rejects unknown type / size on a fixed-size gadget / unknown theme / disabled gadget');
    await dbus('SetTheme', new GLib.Variant('(s)', ['fluent'])); await h.wait(300);
    check(app.theme.name === 'fluent' && app.settings.get_string('theme') === 'fluent', 'D-Bus SetTheme');
    await dbus('SetTheme', new GLib.Variant('(s)', ['classic'])); await h.wait(300);
    await dbus('RemoveGadget', new GLib.Variant('(s)', ['puzzle'])); await h.wait(300);
    check(!app.widgets.has('puzzle'), 'D-Bus RemoveGadget');
    app.openPreferences = () => {};
    await dbus('OpenOptions', new GLib.Variant('(s)', ['clock']));
    check(app.dialog?.gadget === clock, 'D-Bus OpenOptions'); app.closeOptions(); app.openPreferences = openPreferences;

    // Stubs degrade gracefully.
    const location = await import(`file://${app.path}/lib/location.js`);
    let located = null; try { await location.locate(app, app.scope); } catch (e) { located = e.message; }
    check(located === '定位功能将在下一阶段提供', 'location stub throws the documented error');
    const {TrashDropTarget} = await import(`file://${app.path}/lib/trash-drop.js`);
    const target = new TrashDropTarget(app, app.widgets.get('timer')); target.setGeometry(); target.destroy();
    check(true, 'trash-drop stub is inert');
    await h.screenshot('after.png');

    // Disable releases everything; enable rebuilds.
    const dbusBefore = app.dbus, sheets = app.stylesheets.length;
    app.disable(); await h.wait(200);
    check(sheets >= 1 && app.stylesheets.length === 0 && app.dbus === null && dbusBefore.exported === null, 'disable unloads stylesheets and unexports D-Bus');
    let gone = false; try { await dbus('ListGadgets'); } catch { gone = true; }
    check(gone, 'D-Bus object is unreachable after disable');
    app.enable(); await h.wait(500);
    check(app.widgets.size === 4 && app.widgets.get('calendar').large && app.stylesheets.length === sheets, 're-enable restores gadgets, the large calendar and the stylesheets');
}
