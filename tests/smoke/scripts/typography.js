// SPDX-License-Identifier: MIT
// Deterministic typography specimen, not a live data-source test. Captures every
// gadget at its real logical size in each skin and inspects actual Pango layouts.
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';

export async function run(app, h) {
    const {GADGETS, SOLVED} = await import(`file://${app.path}/lib/core.js`);
    const {parseCmaView} = await import(`file://${app.path}/lib/logic/weather-cn.js`);
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('fixtures').get_child('cma-view.json');
    const weather = parseCmaView(new TextDecoder().decode(file.load_contents(null)[1]));
    Object.assign(weather, {name: '上海 · 徐家汇', temperature: -12, humidity: 86, windSpeed: 3.2});
    const rateData = {rates: [{quote: 'CNY', rate: 6.7743, source: '中间价', time: 1789089300}, {quote: 'EUR', rate: .86266, source: '参考价', time: 1789089300}], date: '2026-09-11'};
    const quotes = [
        {name: '贵州茅台', code: '600519', secid: '1.600519', price: 1275.16, precision: 2, changePct: -.78, time: 1789110000},
        {name: 'Apple Inc.', code: 'AAPL', secid: '105.AAPL', price: 332.27, precision: 2, changePct: 1.75, time: 1789156800},
        {name: '腾讯控股', code: '0700.HK', secid: '116.00700', price: 428.4, precision: 2, changePct: -.66, time: 1789114080},
    ];
    const feed = [
        {title: '科技早报：让桌面上的每一行文字更清晰', url: 'https://example.test/a'},
        {title: 'A calmer desktop — good type, better focus', url: 'https://example.test/b'},
        {title: '明天的天气与今天的小计划', url: 'https://example.test/c'},
    ];
    await app.sources.ready;
    const result = value => Promise.resolve({value, saved: 1789296000000, stale: false});
    app.sources.weather = () => result(weather);
    app.sources.currency = () => result(rateData);
    app.sources.stocks = () => result(quotes);
    app.sources.feed = () => result(feed);
    app.settings.set_strv('enabled-gadgets', []);
    app.settings.set_string('options', JSON.stringify({
        clock: {face: 'trad', name: '上海 · Home'},
        notes: {text: '今天的小计划\n读书 Read & relax\n下午 3:30 去散步', pages: []},
        photos: {directory: '', paused: true},
        calculator: {color: 'Grey'},
        timer: {duration: 3599, remaining: 754, running: false},
        puzzle: {image: 1, moves: 123, tiles: [...SOLVED.slice(0, 14), 0, 15]},
        stocks: {symbols: ['600519', 'AAPL', '0700.HK']},
        currency: {base: 'USD', quotes: ['CNY', 'EUR'], amount: 1234.56},
        contacts: {people: [{name: '张晓明', phone: '+86 138 0013 8000', email: 'xiaoming@example.com'}, {name: 'Alex Johnson', phone: '+44 20 7946 0123', email: 'alex@example.org'}]},
    }));
    app.settings.set_strv('enabled-gadgets', Object.keys(GADGETS));
    const report = {specimen: 'deterministic bilingual data, not a live network check', captures: [], layouts: [], stress: []};
    const groups = [
        ['clock', 'calendar', 'system', 'notes', 'photos', 'timer', 'puzzle'],
        ['weather', 'rss', 'currency', 'stocks', 'contacts', 'trash', 'calculator'],
    ];
    const collect = (widget, theme, size) => {
        const record = (actor, text) => {
            const value = text.get_text();
            if (!value || actor.width <= 0 || actor.height <= 0) return;
            const layout = text.get_layout(), [ink, logical] = layout.get_pixel_extents();
            const node = actor.get_theme_node(), font = node.get_font();
            const color = c => [c.red, c.green, c.blue, c.alpha];
            report.layouts.push({theme, size, type: widget.type, css: actor.style_class, text: value, font: font.to_string(),
                box: {x: actor.x, y: actor.y, width: actor.width, height: actor.height}, textBox: {x: text.x, y: text.y, width: text.width, height: text.height},
                ink: {x: ink.x, y: ink.y, width: ink.width, height: ink.height}, logical: {x: logical.x, y: logical.y, width: logical.width, height: logical.height},
                foreground: color(node.get_foreground_color()), textColor: color(text.get_color()), attributes: text.get_attributes()?.to_string() ?? '',
                ellipsized: layout.is_ellipsized(), unknownGlyphs: layout.get_unknown_glyphs_count(), lines: layout.get_line_count(), alignment: text.get_line_alignment(),
                entry: actor instanceof St.Entry, button: actor instanceof St.Button});
        };
        const visit = actor => {
            if (!actor.visible) return;
            if (actor.clutter_text) record(actor, actor.clutter_text);
            else if (actor instanceof Clutter.Text) {
                const parent = actor.get_parent();
                // St.Button uses ClutterText directly, unlike St.Label/Entry.
                // Include key legends and footer actions without counting a
                // Label's internal text twice.
                if (parent instanceof St.Widget && parent.clutter_text !== actor) record(parent, actor);
            }
            for (const child of actor.get_children()) visit(child);
        };
        visit(widget.body);
    };
    for (const theme of ['classic', 'fluent']) {
        app.setTheme(theme);
        const clock = app.widgets.get('clock'); clock.tick = () => {}; clock.showTime(10, 8, 36);
        for (const size of ['small', 'large']) {
            for (const widget of app.widgets.values()) if (widget.tools.size) widget.setSize(size);
            await h.wait(350);
            const calc = app.widgets.get('calculator'); calc.entry.set_text('1234.56 × 7'); calc.result.text = '8641.92';
            const meter = app.widgets.get('system'); meter.sampler.update = () => {}; meter.cpuText.text = '100%'; meter.memText.text = '68%';
            const notes = app.widgets.get('notes'); notes.hover(true);
            const trash = app.widgets.get('trash');
            for (let i = 0; i < 100 && trash.busy; i++) await h.wait(30);
            trash.refresh = () => {}; trash.bytes = 125 * 1024 ** 2; trash.itemCount = 12; trash.render(); trash.hover(true);
            for (let group = 0; group < groups.length; group++) {
                const types = groups[group];
                for (const [type, widget] of app.widgets) widget.actor.visible = types.includes(type);
                for (let i = 0; i < types.length; i++) {
                    const widget = app.widgets.get(types[i]);
                    widget.actor.set_scale(1, 1); widget.actor.set_position(50 + i % 4 * 385, 80 + Math.floor(i / 4) * 410);
                }
                await h.wait(180);
                for (const type of types) collect(app.widgets.get(type), theme, size);
                const name = `${theme}-${size}-${group}.png`;
                await h.screenshot(name);
                report.captures.push({file: name, theme, size, gadgets: types.map(type => {
                    const widget = app.widgets.get(type);
                    return {type, x: widget.actor.x, y: widget.actor.y, width: widget.width, height: widget.height};
                })});
            }
            h.check(!app.errors.length, `${theme}/${size}: all fourteen gadget skins build and render`);
            const layouts = report.layouts.filter(row => row.theme === theme && row.size === size);
            h.check(layouts.filter(row => row.type === 'calculator' && row.button).length === 28, `${theme}/${size}: all 24 calculator keys and four memory keys are measured`);
            h.check(layouts.every(row => row.unknownGlyphs === 0), `${theme}/${size}: bilingual text, digits and calculator symbols have no missing glyphs`);
            const clipped = layouts.filter(row => !row.entry && row.ink.y + row.ink.height > row.box.height + 1);
            h.check(!clipped.length, `${theme}/${size}: label ink fits allocated height (${clipped.map(row => row.type + ':' + row.text).join(', ')})`);
            h.check(layouts.filter(row => !row.entry).every(row => !row.ellipsized), `${theme}/${size}: representative names, numbers and dates are fully visible`);
            h.check(layouts.every(row => !/Segoe|Calibri|Constantia|Verdana|Times New Roman/.test(row.font)), `${theme}/${size}: no missing Windows font aliases`);
            h.check(layouts.every(row => /foreground /.test(row.attributes)), `${theme}/${size}: typography preserves the skin's Pango text colours`);
            h.check(layouts.filter(row => row.css?.includes('og-numeric')).every(row => /tnum=1/.test(row.attributes)), `${theme}/${size}: numeric fields retain tabular digits after style changes`);
            const noteLayout = layouts.find(row => row.type === 'notes' && row.entry);
            h.check(noteLayout.font.includes(theme === 'classic' ? 'Noto Serif' : 'Ubuntu Sans') && /line-height 1.18/.test(noteLayout.attributes), `${theme}/${size}: notes use skin-appropriate reading type and line spacing`);
            const headlines = layouts.filter(row => row.css?.includes('og-feed-title'));
            h.check(headlines.length === feed.length && headlines.every(row => row.alignment === Pango.Alignment.LEFT && /line-height 1.16/.test(row.attributes)), `${theme}/${size}: all RSS headlines stay left aligned with readable line rhythm`);
            h.check(app.widgets.get('calendar').bigDay.get_theme_node().get_foreground_color().red > 240, `${theme}/${size}: calendar day contrasts with its coloured paper`);
            const hint = layouts.find(row => row.css === 'hint-text' && row.type === 'contacts');
            h.check(hint && hint.foreground.slice(0, 3).every(channel => channel < 150), `${theme}/${size}: contact search hint is readable dark ink on light paper`);
            const contacts = app.widgets.get('contacts');
            h.check(contacts.status.y + contacts.status.height <= (size === 'large' ? 167 : 155), `${theme}/${size}: contact status stays on the paper, not its shadow`);
            h.check(calc.result.y + calc.result.height <= (size === 'large' ? 85 : 43) && calc.result.y >= calc.entry.y + calc.entry.height - 1, `${theme}/${size}: calculator expression and result fit separate screen rows`);
            const widths = ['111111', '888888', '000000'].map(value => {
                const text = app.widgets.get('stocks').price.clutter_text;
                const layout = text.create_pango_layout(value);
                // Use St's borrowed font descriptor. Clutter 18 incorrectly
                // annotates Text.get_font_description() as transfer-full.
                layout.set_font_description(app.widgets.get('stocks').price.get_theme_node().get_font()); layout.set_attributes(text.get_attributes());
                return layout.get_pixel_size()[0];
            });
            h.check(Math.max(...widths) - Math.min(...widths) <= 1, `${theme}/${size}: changing digits does not shift numeric columns`);

            // Stress a long result, then a short one: bounded fitting must reset
            // and must NOT strip St's white/dark foreground attributes.
            calc.actor.show();
            calc.result.text = '123456789012345'; await h.wait(120);
            let attributes = calc.result.clutter_text.get_attributes().to_string();
            const scale = Number(/scale ([0-9.]+)/.exec(attributes)?.[1]);
            h.check(scale > 0 && scale < 1 && /foreground /.test(attributes) && !calc.result.clutter_text.get_layout().is_ellipsized(), `${theme}/${size}: long numeric results shrink to fit without losing colour`);
            h.check(calc.result.text === '123456789012345' && calc.result.accessible_name === calc.result.text, `${theme}/${size}: fitting never rounds, abbreviates or loses the full reading`);
            report.stress.push({theme, size, value: calc.result.text, attributes});
            calc.result.text = '7'; await h.wait(100);
            h.check(/scale 1.000000/.test(calc.result.clutter_text.get_attributes().to_string()), `${theme}/${size}: short values return to the normal type size`);
            calc.result.text = '8641.92';
            // A long city is intentionally ellipsized, with its full text intact.
            const city = app.widgets.get('weather').city, previousCity = city.text;
            city.text = '中华人民共和国特别长的城市名称 · A very long city';
            await h.wait(100);
            h.check(city.clutter_text.get_layout().is_ellipsized() && city.text.endsWith('city'), `${theme}/${size}: long names ellipsize rather than spilling into adjacent fields`);
            city.text = previousCity;
            // Styles change during normal usage (e.g. red/green quotes). Check
            // that subsequent asynchronous fitting preserves their new colour.
            const price = app.widgets.get('stocks').price;
            price.set_style('color: #75d599;'); price.text = '123456.78'; await h.wait(100);
            const green = price.clutter_text.get_attributes().to_string();
            h.check(/foreground /.test(green) && !green.includes('#000000000000'), `${theme}/${size}: a restyled numeric label keeps its foreground during fitting`);
            price.set_style(null); app.widgets.get('stocks').render(quotes);
            if (size === 'small') {
                for (const zoom of [0.75, 1.5]) {
                    calc.save({scale: zoom}); app.positionWidgets(); await h.wait(80);
                    h.check(Math.abs(calc.actor.scale_x - zoom * app.settings.get_double('scale')) < .001, `${theme}: typography follows ${zoom}× gadget scaling`);
                    const [ink] = calc.result.clutter_text.get_layout().get_pixel_extents();
                    h.check(ink.y + ink.height <= calc.result.height + 1, `${theme}/${zoom}×: the result stays inside its screen`);
                }
                calc.save({scale: 1}); app.positionWidgets();
            }
        }
    }
    for (const theme of ['classic', 'fluent']) {
        app.setTheme(theme); const clock = app.widgets.get('clock');
        for (const face of clock.availableFaces()) {
            clock.save({face}); clock.refreshOptions(); await h.wait(30);
            const colour = clock.caption.get_theme_node().get_foreground_color();
            const light = ['cronometer', 'diner', 'modern', 'monitor'].includes(face) || (theme === 'fluent' && face === 'system');
            h.check(light ? colour.red > 220 : colour.red < 100, `${theme}/${face}: clock inscription matches the dial contrast`);
        }
    }
    const ownedScopes = [...app.widgets.values()].map(widget => widget.scope);
    app.settings.set_strv('enabled-gadgets', []);
    await h.wait(100);
    h.check(ownedScopes.every(scope => !scope.alive && scope.sources.size === 0), 'removing gadgets cancels queued text fitting and all owned timers');
    GLib.file_set_contents(`${h.out}/typography.json`, JSON.stringify(report, null, 2));
    h.check(report.layouts.length > 200, 'actual Pango layouts captured across both skins and sizes');
    for (const widget of app.widgets.values()) widget.actor.show();
}
