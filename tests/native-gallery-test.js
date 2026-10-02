// SPDX-License-Identifier: MIT
// Direct assertions against the exact production GTK4 widgets in a private bus.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const root=GLib.getenv('CG_GALLERY_EXTENSION'),out=GLib.getenv('CG_GALLERY_OUTPUT');
if(!root||!out||!GLib.getenv('CG_SMOKE_OUT'))throw new Error('Isolated gallery test only');
const loop=new GLib.MainLoop(null,false),checks=[],events=[];
const wait=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const read=path=>{const [,bytes]=GLib.file_get_contents(path);return new TextDecoder().decode(bytes);};
const check=(condition,name)=>{if(!condition)throw new Error(name);checks.push(name);};
let ui;
async function step(name,widget=null,double=false){
    let click=null;
    if(widget){const [ok,b]=widget.compute_bounds(ui.window);check(ok,`${name}: native control allocated`);click={x:b.get_x()+b.get_width()/2,y:b.get_y()+b.get_height()/2,double};}
    GLib.file_set_contents(`${out}/gallery-step.json`,JSON.stringify({name,click}));
    for(let i=0;i<100;i++){
        if(GLib.file_test(`${out}/gallery-ack`,GLib.FileTest.EXISTS)&&read(`${out}/gallery-ack`)===name)return;
        await wait(100);
    }
    throw new Error(`GTK checkpoint timed out: ${name}`);
}
(async()=>{
    const settings=new Gio.Settings({schema_id:'org.gnome.desktop.interface'}),old=settings.get_string('color-scheme');
    try{
        Adw.init();const {GalleryWindow}=await import(`file://${root}/helpers/gallery-window.js`);
        const config=JSON.parse(read(`${out}/gallery-config.json`));
        settings.set_string('color-scheme','prefer-light');ui=new GalleryWindow(config,message=>events.push(message));ui.present();await wait(450);
        check(ui.window instanceof Adw.Window&&ui.header instanceof Adw.HeaderBar,'gallery is a real GTK4/libadwaita window with a native header bar');
        check(ui.grid instanceof Gtk.FlowBox&&ui.search instanceof Gtk.SearchEntry,'catalogue uses native adaptive flow grid and GTK search');
        check(ui.addButton instanceof Gtk.Button&&ui.addButton.has_css_class('suggested-action'),'add button uses native system accent styling');
        check(!ui.styleManager.dark,'gallery opens in the system light appearance');
        check(ui.cells.size===12,'first native page contains twelve entries');
        await step('gtk-gallery-light');await step('gallery-next-click',ui.next);await wait(150);
        check(ui.page===1&&ui.cells.size===2,'real next-page click exposes the remaining two gadgets');
        await step('gallery-prev-click',ui.previous);await wait(150);check(ui.page===0&&ui.cells.size===12,'native previous-page click returns to page one');
        ui.search.text='CPU';await wait(100);check(ui.cells.size===1&&ui.cells.has('system'),'native search matches English and component metadata');
        ui.search.text='不存在的组件';await wait(100);check(ui.empty.visible&&!ui.addButton.sensitive,'empty search state disables add and uses native status page');
        ui.search.text='photos';await wait(100);
        await step('gallery-details-click',ui.detailsButton);check(ui.details.reveal_child&&ui.detailText.label.includes('轮播'),'native detail reveal shows selected component description');
        await step('gallery-add-click',ui.addButton);check(events.some(e=>e.event==='add'&&e.type==='photos'),'real native add button sends selected component');
        ui.receive({cmd:'enabled',enabled:['photos']});check(ui.removeButton.sensitive&&ui.cells.get('photos').status.label.includes('已添加'),'enabled feedback updates existing native cells');
        await step('gallery-remove-click',ui.removeButton);check(events.some(e=>e.event==='remove'&&e.type==='photos'),'real native remove button preserves intent semantics');
        const count=events.filter(e=>e.event==='add').length;
        await step('gallery-double-click',ui.cells.get('photos'),true);check(events.filter(e=>e.event==='add').length>count,'double-clicking a native tile adds its component');
        settings.set_string('color-scheme','prefer-dark');await wait(350);
        check(ui.styleManager.dark&&ui.selected==='photos'&&ui.search.text==='photos','open gallery follows dark mode without losing search or selection');
        await step('gtk-gallery-dark-details');
        ui.search.text='';ui.detailsButton.active=false;await wait(120);
        ui.window.set_default_size(440,500);await wait(250);await step('gtk-gallery-compact');
        const [,buttonBounds]=ui.addButton.compute_bounds(ui.window);
        check(buttonBounds.get_y()+buttonBounds.get_height()<=ui.window.get_height(),'compact gallery keeps native actions inside the window');
        const xs=[...ui.cells.values()].map(cell=>cell.get_allocation().x);check(new Set(xs).size<6,'GTK flow grid adapts to a narrow window');
        settings.set_string('color-scheme','prefer-light');await wait(250);check(!ui.styleManager.dark,'gallery returns to light without reopening');
        ui.destroy();ui=null;
        GLib.file_set_contents(`${out}/gtk-gallery-result.json`,JSON.stringify({ok:true,checks},null,2));
    }catch(error){console.error(error);GLib.file_set_contents(`${out}/gtk-gallery-result.json`,JSON.stringify({ok:false,error:String(error),checks},null,2));}
    finally{ui?.destroy();settings.set_string('color-scheme',old);loop.quit();}
})();loop.run();
