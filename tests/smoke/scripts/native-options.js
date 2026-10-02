// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export async function run(app, h) {
    const settings = new Gio.Settings({schema_id:'org.gnome.desktop.interface'});
    const originalScheme = settings.get_string('color-scheme');
    const gadget = app.widgets.get('weather');
    const center = actor => { const [x,y] = actor.get_transformed_position(), [w,height] = actor.get_transformed_size(); return [x+w/2,y+height/2]; };
    let prefs = 0; const openPreferences = app.openPreferences; app.openPreferences = () => prefs++;
    try {
        settings.set_string('color-scheme','prefer-light');
        await h.motion(...center(gadget.actor)); await h.click(...center(gadget.tools.options));
        const dialog = app.dialog; await dialog.whenReady(); await h.wait(400);
        h.check(dialog.isOpen && dialog.nativeWindow && prefs === 0,'gear opens one native GTK component window, not extension preferences');
        h.check(dialog.nativeWindow.get_title() === '天气设置','native window uses the component title');
        await h.screenshot('native-options-light.png');
        dialog.set('city','尚未保存'); dialog.set('cityAuto',false); await h.wait(100);
        settings.set_string('color-scheme','prefer-dark'); await h.wait(600);
        h.check(dialog.isOpen && dialog.values.city === '尚未保存','system dark-mode switch keeps the window and draft');
        await h.screenshot('native-options-dark.png');
        dialog.close(); await h.wait(300);
        h.check(gadget.options.city !== '尚未保存','native cancel preserves saved options');
        app.openOptions(gadget); await app.dialog.whenReady();
        const next=app.dialog; next.set('cityAuto',false);next.set('city','GTK 保存测试');
        const frame=next.nativeWindow.get_frame_rect();
        await h.click(frame.x+frame.width-65,frame.y+frame.height-32);await h.wait(500);
        h.check(!next.isOpen && gadget.options.city==='GTK 保存测试','real GTK confirm button validates and saves the current component');
        app.store.saveOptions('weather',{city:'上海',cityAuto:true});
        const config=dialog.config;
        config.title='天气设置';
        const optionsPath=`${h.out}/native-options-config.json`;
        GLib.file_set_contents(optionsPath,JSON.stringify(config));
        const launcher = new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.NONE});
        launcher.setenv('CG_OPTIONS_EXTENSION',app.path,true);
        launcher.setenv('CG_OPTIONS_CONFIG',optionsPath,true);
        launcher.setenv('CG_OPTIONS_OUTPUT',h.out,true);
        for(const name of ['native-options-result.json','native-options-step.json','native-options-ack']) {
            const file=Gio.File.new_for_path(`${h.out}/${name}`); if(file.query_exists(null)) file.delete(null);
        }
        const process = launcher.spawnv(['gjs','-m',`${GLib.getenv('CG_TEST_SOURCE')}/tests/native-options-test.js`]);
        const resultPath=`${h.out}/native-options-result.json`;
        let last='';
        for(let i=0;i<300&&!GLib.file_test(resultPath,GLib.FileTest.EXISTS);i++) {
            const stepPath=`${h.out}/native-options-step.json`;
            if(GLib.file_test(stepPath,GLib.FileTest.EXISTS)) {
                const [,bytes]=GLib.file_get_contents(stepPath),step=JSON.parse(new TextDecoder().decode(bytes));
                if(step.name!==last) {
                    await h.wait(180);await h.screenshot(`${step.name}.png`);
                    if(step.click) {
                        const window=global.window_group.get_children().map(a=>a.get_meta_window?.()).find(w=>w?.get_title()==='天气设置');
                        const frame=window.get_frame_rect();await h.click(frame.x+step.click.x,frame.y+step.click.y);
                    }
                    GLib.file_set_contents(`${h.out}/native-options-ack`,step.name);last=step.name;
                }
            }
            await h.wait(100);
        }
        await new Promise(resolve=>process.wait_async(null,(p,r)=>{p.wait_finish(r);resolve();}));
        const [,bytes]=GLib.file_get_contents(resultPath),result=JSON.parse(new TextDecoder().decode(bytes));
        h.check(result.ok,`GTK controls and appearance checks: ${result.error || result.checks.length+' passed'}`);
        for(const check of result.checks) h.check(true,check);
    } finally { app.closeOptions();app.openPreferences=openPreferences;settings.set_string('color-scheme',originalScheme); }
}
