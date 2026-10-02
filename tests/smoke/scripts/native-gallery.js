// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export async function run(app,h) {
    const settings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'}),old=settings.get_string('color-scheme');
    const gallery=app.ui.gallery;
    const search=async text=>{await h.chord([h.Clutter.KEY_Control_L,h.Clutter.KEY_f]);await h.chord([h.Clutter.KEY_Control_L,h.Clutter.KEY_a]);await h.type(text);await h.wait(200);};
    const dragBegin=async()=>{
        const f=gallery.nativeWindow.get_frame_rect(),sx=f.x+80,sy=f.y+174;
        await h.motion(sx,sy);await h.button(1,h.Clutter.ButtonState.PRESSED);await h.motion(sx+20,sy+15);await h.wait(300);await h.motion(sx+30,sy+20);await h.wait(150);
        h.check(!!gallery.drag,'native GTK drag actually starts');
    };
    try {
        settings.set_string('color-scheme','prefer-light');app.showGallery();await gallery.whenReady();await h.wait(350);
        h.check(gallery.nativeWindow?.get_title()==='添加小组件','add gadget opens the actual GTK4 gallery window');
        h.check(gallery.view.types.length===12,'native gallery displays first page of fourteen widgets');
        const process=gallery.process;app.showGallery();h.check(gallery.process===process,'repeated ShowGallery reuses the existing native window');
        await h.screenshot('gallery-light.png');
        settings.set_string('color-scheme','prefer-dark');await h.wait(350);await h.screenshot('gallery-dark.png');
        h.check(gallery.visible&&gallery.ready,'open gallery survives live system colour-scheme switch');
        await search('photos');h.check(gallery.view.types.length===1&&gallery.view.types[0]==='photos','real GTK search filters gadget catalogue');
        await h.key(h.Clutter.KEY_Return);await h.wait(250);h.check(app.widgets.has('photos'),'keyboard activation from native search adds a gadget');
        await dragBegin();await h.motion(250,180);await h.wait(250);await h.screenshot('gallery-drag.png');await h.button(1,h.Clutter.ButtonState.RELEASED);
        for(let i=0;i<40&&!gallery.lastDrop;i++)await h.wait(100);
        h.check(gallery.lastDrop?.type==='photos'&&app.store.layout.photos.x<300,'real GTK drag moves gadget to requested desktop coordinates');
        await h.wait(200);
        const layout=JSON.stringify(app.store.layout.photos);gallery.lastDrop=null;
        await dragBegin();await h.motion(300,170);await h.key(h.Clutter.KEY_Escape);await h.button(1,h.Clutter.ButtonState.RELEASED);await h.wait(350);
        h.check(!gallery.lastDrop&&JSON.stringify(app.store.layout.photos)===layout,'Esc cancels a native drag without moving the widget');
        h.check(gallery.visible,'Esc during a drag does not close the gallery');
        const targetActor=global.stage.get_actor_at_pos(h.Clutter.PickMode.REACTIVE,300,900);
        h.check(!targetActor?.toString().includes('MetaSurfaceActorWayland'),'native desktop drop windows do not swallow background clicks while idle');
        const config=gallery.config;gallery.hide();await h.wait(1600);
        h.check(process.get_if_exited(),'closing gallery exits its GTK process');
        h.check(!global.window_group.get_children().some(a=>a.get_meta_window?.()?.get_title()?.startsWith('classic-gallery-drop:')),'closing gallery cleans up desktop drop surfaces');
        GLib.file_set_contents(`${h.out}/gallery-config.json`,JSON.stringify(config));
        for(const name of ['gtk-gallery-result.json','gallery-step.json','gallery-ack']){const f=Gio.File.new_for_path(`${h.out}/${name}`);if(f.query_exists(null))f.delete(null);}
        const launcher=new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});launcher.setenv('CG_GALLERY_EXTENSION',app.path,true);launcher.setenv('CG_GALLERY_OUTPUT',h.out,true);
        const gtk=launcher.spawnv(['gjs','-m',`${GLib.getenv('CG_TEST_SOURCE')}/tests/native-gallery-test.js`]);
        let last='';const resultFile=`${h.out}/gtk-gallery-result.json`;
        for(let i=0;i<400&&!GLib.file_test(resultFile,GLib.FileTest.EXISTS);i++){
            if(GLib.file_test(`${h.out}/gallery-step.json`,GLib.FileTest.EXISTS)){
                const [,bytes]=GLib.file_get_contents(`${h.out}/gallery-step.json`),step=JSON.parse(new TextDecoder().decode(bytes));
                if(step.name!==last){
                    await h.wait(120);await h.screenshot(`${step.name}.png`);
                    if(step.click){const w=global.window_group.get_children().map(a=>a.get_meta_window?.()).find(w=>w?.get_title()==='添加小组件');const f=w.get_frame_rect();
                        await h.click(f.x+step.click.x,f.y+step.click.y);if(step.click.double)await h.click(f.x+step.click.x,f.y+step.click.y);}
                    GLib.file_set_contents(`${h.out}/gallery-ack`,step.name);last=step.name;
                }
            }await h.wait(90);
        }
        if(!GLib.file_test(resultFile,GLib.FileTest.EXISTS)){gtk.force_exit();throw new Error('Native GTK gallery assertions timed out');}
        await new Promise(resolve=>gtk.wait_async(null,(p,r)=>{p.wait_finish(r);resolve();}));
        const [,bytes]=GLib.file_get_contents(resultFile),result=JSON.parse(new TextDecoder().decode(bytes));h.check(result.ok,result.error||'native GTK gallery widget tests');
        for(const check of result.checks)h.check(true,check);
        app.showGallery();await gallery.whenReady();const previous=gallery.run;app.hideGallery();app.showGallery();await gallery.whenReady();await h.wait(1600);
        h.check(gallery.ready&&previous.exited,'rapid close/reopen never lets an old cleanup kill the new gallery');
        app.hideGallery();
    } finally {app.hideGallery();settings.set_string('color-scheme',old);}
}
