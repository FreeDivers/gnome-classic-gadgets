// SPDX-License-Identifier: MIT
// Runs only in the isolated compositor. Tests the exact production GTK renderer
// via public GTK widgets and real pointer checkpoints, with no test API in it.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const path=GLib.getenv('CG_OPTIONS_EXTENSION'),out=GLib.getenv('CG_OPTIONS_OUTPUT');
if(!path||!out||!GLib.getenv('CG_SMOKE_OUT'))throw new Error('Private test session only');
const loop=new GLib.MainLoop(null,false),checks=[];
const wait=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
function check(value,name){if(!value)throw new Error(name);checks.push(name);}
function jsonFile(path){const [,bytes]=GLib.file_get_contents(path);return JSON.parse(new TextDecoder().decode(bytes));}
let ui;
async function step(name,click=null){
    GLib.file_set_contents(`${out}/native-options-step.json`,JSON.stringify({name,click}));
    for(let i=0;i<100;i++) {
        if(GLib.file_test(`${out}/native-options-ack`,GLib.FileTest.EXISTS)) {
            const [,bytes]=GLib.file_get_contents(`${out}/native-options-ack`);if(new TextDecoder().decode(bytes)===name)return;
        }
        await wait(100);
    }
    throw new Error('Screenshot checkpoint timed out: '+name);
}
(async()=>{
    const settings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'}),old=settings.get_string('color-scheme');
    try{
        Adw.init();const {OptionsWindow}=await import(`file://${path}/helpers/options-window.js`);
        const config=jsonFile(GLib.getenv('CG_OPTIONS_CONFIG')),messages=[];
        settings.set_string('color-scheme','prefer-light');
        ui=new OptionsWindow(config,event=>messages.push(event));ui.present();await wait(500);
        check(ui.window instanceof Adw.Window,'settings is an actual libadwaita window');
        check(ui.rows.get('size').control instanceof Adw.ComboRow,'size uses a native combo row');
        check(ui.rows.get('scale').control instanceof Adw.SpinRow,'scale uses a native spin row');
        check(ui.rows.get('cityAuto').control instanceof Adw.SwitchRow,'boolean settings use a native switch');
        check(ui.rows.get('_citySearch').control instanceof Gtk.SearchEntry,'city lookup uses a native search entry');
        check(ui.rows.get('city').control instanceof Adw.EntryRow,'city label uses a native entry row');
        check(!ui.styleManager.dark,'light mode uses libadwaita light appearance');
        check(ui.okButton.has_css_class('suggested-action'),'confirm button uses the system suggested-action style');
        check(ui.expanders.size===1&&![...ui.expanders.values()][0].expanded,'manual station and coordinates are collapsed initially');
        check(!ui.rows.get('city').row.sensitive,'automatic labels disable the custom city entry');
        await step('gtk-light');
        const switchRow=ui.rows.get('cityAuto').row;const [valid,bounds]=switchRow.compute_bounds(ui.window);
        check(valid,'native switch has an allocated click target');
        await step('gtk-switch-click',{x:bounds.get_x()+bounds.get_width()-32,y:bounds.get_y()+bounds.get_height()/2});await wait(150);
        check(ui.rows.get('cityAuto').control.active===false,'real pointer input toggles the native switch');
        ui.rows.get('size').control.selected=1;ui.rows.get('scale').control.value=1.25;
        ui.rows.get('cityAuto').control.active=false;ui.rows.get('city').control.text='未保存的城市';
        check(ui.rows.get('city').row.sensitive,'native switch enables the custom-label entry');
        const before=ui.snapshot();settings.set_string('color-scheme','prefer-dark');await wait(400);
        check(ui.styleManager.dark,'open window follows system dark mode live');
        check(JSON.stringify(ui.snapshot())===JSON.stringify(before),'theme changes preserve all draft values');
        await step('gtk-dark');
        const search=ui.rows.get('_citySearch');search.control.text='测试';await wait(350);
        ui.receive({cmd:'results',id:search.field.id,request:search.searchId,items:[{name:'南昌',detail:'中国 · 58606'},{name:'<b>未解析的文本</b>',detail:'界面不得渲染服务返回的标记'}]});
        check(search.results.get_first_child() instanceof Adw.ActionRow,'search results use native themed list rows');
        check(!search.results.get_first_child().use_markup,'remote search results never enable markup');
        ui.receive({cmd:'results',id:search.field.id,request:search.searchId-1,items:[{name:'过期结果'}]});
        check(search.results.get_first_child().title==='南昌','out-of-order search replies do not replace newer results');
        await step('gtk-dark-search');
        ui.receive({cmd:'error',key:'station',message:'气象站编号：请输入有效编号'});await wait(200);
        check(ui.rows.get('station').row.has_css_class('error')&&ui.errorLabel.visible,'validation errors use native error styling');
        check([...ui.expanders.values()][0].expanded,'errors reveal fields in the advanced expander');
        check(ui.okButton.sensitive,'a failed validation keeps confirm usable');
        await step('gtk-dark-validation');
        settings.set_string('color-scheme','prefer-light');await wait(300);
        check(!ui.styleManager.dark,'dark-to-light changes also apply without reopening');
        ui.destroy();ui=null;
        const pickerConfig={title:'天气设置',height:570,fields:[
            {id:'0',type:'picker',key:'image',label:'图片拼图',values:Array.from({length:11},(_,i)=>i+1),value:1,
                previews:Array.from({length:11},(_,i)=>`${path}/assets/original/PicturePuzzle.Gadget/Images/${i+1}.png`),previewSize:{w:130,h:130}},
            {id:'1',type:'entry',key:'people',label:'联系人',multiline:true,value:'名字 | 123 | test@example.com'},
        ]};
        ui=new OptionsWindow(pickerConfig,event=>messages.push(event));ui.present();await wait(400);
        check(ui.rows.get('people').control instanceof Gtk.TextView,'multiline settings use a native text view');
        const picker=ui.rows.get('image');const [,nextBounds]=picker.next.compute_bounds(ui.window);
        await step('gtk-picker-click',{x:nextBounds.get_x()+nextBounds.get_width()/2,y:nextBounds.get_y()+nextBounds.get_height()/2});await wait(180);
        check(ui.values.image===2&&picker.preview.file.get_basename()==='2.png','native image picker changes previews with real pointer input');
        ui.rows.get('people').control.buffer.set_text('中文姓名 | 456 | me@example.com\n第二行 | 789 |',-1);
        check(ui.snapshot().people.includes('\n第二行'),'multiline editing keeps line breaks and Unicode');
        settings.set_string('color-scheme','prefer-dark');await wait(250);await step('gtk-dark-picker');
        check(ui.styleManager.dark&&ui.rows.get('people').control.has_css_class('view'),'multiline input inherits the native dark text-view style');
        ui.window.set_default_size(380,420);await wait(300);await step('gtk-compact');
        const [,okBounds]=ui.okButton.compute_bounds(ui.window);
        check(okBounds.get_y()>=0&&okBounds.get_y()+okBounds.get_height()<=ui.window.get_height(),'small native windows keep confirmation actions visible');
        ui.destroy();ui=null;
        GLib.file_set_contents(`${out}/native-options-result.json`,JSON.stringify({ok:true,checks},null,2));
    }catch(error){console.error(error);GLib.file_set_contents(`${out}/native-options-result.json`,JSON.stringify({ok:false,error:String(error),checks},null,2));}
    finally{ui?.destroy();settings.set_string('color-scheme',old);loop.quit();}
})();loop.run();
