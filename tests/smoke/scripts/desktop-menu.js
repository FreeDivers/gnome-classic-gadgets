// SPDX-License-Identifier: MIT
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
export async function run(app,h) {
    const windows = () => global.window_group.get_children().map(a=>a.get_meta_window?.()).filter(Boolean);
    const record=Main.extensionManager.lookup('ding@rastersoft.com'),ding=record?.stateObj;
    h.check(record?.path===GLib.getenv('CG_TEST_DING_SOURCE'),'Ubuntu loads SYSTEM DING, ignoring the obsolete per-user override');
    h.check(Main.sessionMode.currentMode==='ubuntu','test uses the real Ubuntu session mode');
    for(let i=0;i<100 && app.desktopMenu.state!=='ready';i++)await h.wait(100);
    h.check(app.desktopMenu.state==='ready',`runtime desktop menu integration ready (${app.desktopMenu.error||app.desktopMenu.state})`);
    for(let i=0;i<80&&!windows().some(w=>w.get_window_type()===Meta.WindowType.DESKTOP);i++)await h.wait(100);
    h.check(windows().some(w=>w.get_window_type()===Meta.WindowType.DESKTOP),'DING desktop window actually mapped');
    const pid=ding.data.currentProcess.subprocess.get_identifier();
    const [,args]=GLib.file_get_contents(`/proc/${pid}/cmdline`);
    h.check(new TextDecoder().decode(args).includes(app.desktopMenu.root+'/app/ding.js'),'running DING process uses verified patched private code, not just installed files');
    // A pre-existing GTK client binds wl_pointer after the new virtual seat device.
    await h.motion(480,350); await h.wait(150);
    await h.click(500,350,3);await h.wait(250);await h.screenshot('ding-context-menu.png');
    h.check(!app.ui.menus.menu?.isOpen,'DING original context menu is preserved');
    // Item heights depend on the locale/font. Select the inserted second item
    // in the real GTK menu instead of relying on English pixel coordinates.
    await h.key(h.Clutter.KEY_Home); await h.key(h.Clutter.KEY_Down); await h.key(h.Clutter.KEY_Return); await h.wait(350);
    h.check(app.ui.gallery.visible,'actual desktop menu activation invokes ShowGallery');
    const gallery=app.ui.gallery;await gallery.whenReady();await h.wait(250);
    h.check(gallery.nativeWindow?.get_title()===(GLib.getenv('CG_TEST_LANGUAGE')?.startsWith('en') ? 'Add Widgets' : '添加小组件'),'desktop entry opens a real GTK4 gallery');
    await h.chord([h.Clutter.KEY_Control_L,h.Clutter.KEY_f]);await h.type('puzzle');await h.wait(250);
    const f=gallery.nativeWindow.get_frame_rect(),sx=f.x+80,sy=f.y+174;
    await h.motion(sx,sy);await h.button(1,h.Clutter.ButtonState.PRESSED);await h.motion(sx+20,sy+15);await h.wait(350);await h.motion(sx+30,sy+20);
    await h.motion(250,180);await h.wait(350);await h.button(1,h.Clutter.ButtonState.RELEASED);
    for(let i=0;i<50&&!gallery.lastDrop;i++)await h.wait(100);
    h.check(app.widgets.has('puzzle')&&app.store.layout.puzzle.x<300,'GTK gallery drag works on the actual Ubuntu DING desktop');
    await h.screenshot('ding-gallery-drop.png');gallery.hide();await h.wait(300);
    const status=JSON.parse(app.dbus.GetDesktopMenuStatus());
    h.check(status.state==='ready'&&status.source===record.path&&!!status.pid,'diagnostics describe the actual loaded desktop and process');
    app.settings.set_boolean('desktop-menu',false);await h.wait(1200);
    h.check(app.desktopMenu.state==='disabled','desktop menu opt-out restores system behaviour');
    app.settings.set_boolean('desktop-menu',true);
    for(let i=0;i<60&&app.desktopMenu.state!=='ready';i++)await h.wait(100);
    h.check(app.desktopMenu.state==='ready','desktop menu integration can be re-enabled at runtime');await h.wait(700);
    const original=app.desktopMenu.original;app.disable();await h.wait(1300);
    h.check(ding.launchDesktop===original&&ding.data.isEnabled,'disabling gadgets restores DING launcher without disabling desktop icons');
    const restoredPid=ding.data.currentProcess.subprocess.get_identifier();
    const [,restoredArgs]=GLib.file_get_contents(`/proc/${restoredPid}/cmdline`);
    h.check(new TextDecoder().decode(restoredArgs).includes(record.path+'/app/ding.js'),'DING returns to its unmodified system executable on disable');
    app.enable();await h.wait(500);
}
