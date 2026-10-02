// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
export async function run(app, h) {
    const people=[{name:'保留联系人',phone:'12345',email:'test@example.com'}];
    app.store.saveOptions('contacts',{people});
    app.openOptions(app.widgets.get('contacts')); await app.dialog.whenReady(); app.dialog.apply();
    h.check(JSON.stringify(app.widgets.get('contacts').options.people)===JSON.stringify(people),'unchanged formatted contact entries round-trip without data loss');
    for (const type of ['weather','rss','currency','stocks']) {
        const gadget = app.widgets.get(type);
        for (let i=0; i<120 && gadget.busy; i++) await h.wait(250);
        h.check(!!gadget.data, `${type}: live mainland data (${gadget.networkStatus.text})`);
    }
    h.check(app.widgets.get('weather').city.text !== '' && app.widgets.get('weather').city.text !== '上海', 'weather derives automatic station address label');
    for (const theme of ['classic','fluent']) {
        app.setTheme(theme); await h.wait(500);
        for (const size of ['small','large']) {
            for (const widget of app.widgets.values()) if (widget.tools.size) widget.setSize(size);
            await h.wait(500);
            h.check(!app.errors.length, `${theme}/${size} builds without missing assets`);
            for (const widget of app.widgets.values()) {
                h.check(widget.body.width === widget.width && widget.body.height === widget.height, `${theme}/${size}/${widget.type} coherent body dimensions`);
                app.openOptions(widget); await app.dialog.whenReady(); h.check(app.dialog.rows.size > 0 && app.dialog.nativeWindow, `${widget.type} has native per-widget options`); app.closeOptions();
            }
            app.settings.set_string('layout', '{}'); await h.wait(1400);
            await h.screenshot(`${theme}-${size}.png`);
        }
    }
    const trash=app.widgets.get('trash');
    for (let i=0; i<60 && !trash.dropTarget.available; i++) await h.wait(250);
    h.check(trash.dropTarget.available, 'real Wayland trash drop target is mapped');
    h.check(trash.dropTarget.window.get_frame_rect().width === Math.round(trash.body.get_transformed_size()[0]), 'trash helper geometry matches widget');
    app.setTheme('classic');
}
