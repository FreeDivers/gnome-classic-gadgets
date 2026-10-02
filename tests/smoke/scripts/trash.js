// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export async function run(app,h) {
    const bin=app.widgets.get('trash');
    app.addGadgetAt('trash',1000,500);
    for(let i=0;i<60 && !bin.dropTarget.available;i++) await h.wait(150);
    h.check(bin.dropTarget.available,'GTK4 Wayland drop target mapped');
    await h.wait(350); bin.dropTarget.setGeometry(); await h.wait(200);
    const [bx,by]=bin.body.get_transformed_position(), [bw,bh]=bin.body.get_transformed_size();
    const frame=bin.dropTarget.window.get_frame_rect();
    h.check(frame.x===Math.round(bx)&&frame.y===Math.round(by)&&frame.width===Math.round(bw)&&frame.height===Math.round(bh),`drop surface aligned (${frame.x},${frame.y},${frame.width}x${frame.height})`);
    const paths=[`${h.out}/cg-trash-test-one.txt`,`${h.out}/cg-trash-test-中文 空格.txt`];
    for(const path of paths) GLib.file_set_contents(path,'only disposable test content\n');
    const process=Gio.Subprocess.new(['gjs','-m',`${GLib.getenv('CG_TEST_SOURCE')}/tests/trash-source.js`,...paths],Gio.SubprocessFlags.NONE);
    try {
        let source;
        for(let i=0;i<50&&!source;i++) { await h.wait(100); source=global.get_window_actors().map(a=>a.get_meta_window()).find(w=>w?.get_title()==='classic-gadgets-test-file-source'); }
        h.check(!!source,'real GTK drag source window created');
        for(let i=0;i<60 && (!source.get_compositor_private()?.mapped || source.get_frame_rect().width<100);i++) await h.wait(100);
        source.move_frame(false,250,200); source.activate(global.get_current_time()); await h.wait(500);
        const rect=source.get_frame_rect(), sx=rect.x+rect.width/2,sy=rect.y+rect.height/2;
        await h.motion(sx,sy); await h.wait(150); await h.motion(sx+1,sy+1);
        await h.button(1,h.Clutter.ButtonState.PRESSED); await h.wait(400); await h.motion(sx+10,sy+5); await h.motion(sx+25,sy+20); await h.wait(300);
        await h.motion(bx+bw/2,by+bh/2); await h.wait(500); await h.screenshot('during-file-drop.png');
        await h.button(1,h.Clutter.ButtonState.RELEASED);
        for(let i=0;i<80 && !bin.lastDrop;i++) await h.wait(100);
        h.check(bin.lastDrop?.trashed.length===2,`two external file drops actually trashed (${JSON.stringify(bin.lastDrop)})`);
        h.check(paths.every(path=>!Gio.File.new_for_path(path).query_exists(null)),'original files moved, not just a simulated counter');
        const trashDir=Gio.File.new_for_path(`${GLib.get_user_data_dir()}/Trash/files`);
        for(const path of paths) {
            const name=GLib.path_get_basename(path), file=trashDir.get_child(name);
            h.check(file.query_exists(null),`system trash contains ${name}`);
            const [,bytes]=file.load_contents(null); h.check(new TextDecoder().decode(bytes)==='only disposable test content\n','trashed content intact');
            Gio.File.new_for_uri(`trash:///${encodeURIComponent(name)}`).move(Gio.File.new_for_path(path),Gio.FileCopyFlags.NONE,null,null);
            h.check(Gio.File.new_for_path(path).query_exists(null),'file can be restored from system trash');
        }
        await bin.refresh(); h.check(bin.actor.reactive,'drop restores widget interactivity');
        await h.screenshot('trash-after-restore.png');
    } finally { process.force_exit(); for(const path of paths) { const file=Gio.File.new_for_path(path); if(file.query_exists(null)) file.delete(null); } }
    app.remove('trash'); await h.wait(1800);
    h.check(!global.window_group.get_children().some(actor=>actor.get_meta_window?.()?.get_title()==='classic-gadgets-trash'),'removal terminates and removes drop helper');
}
