// SPDX-License-Identifier: MIT
import './lib/i18n-runtime.js';
import {_, format, ngettext} from './lib/i18n.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {GADGETS, THEMES, THEME_NAMES, enabledTypes, parseObject, optionsFor, validContacts, httpsUrl} from './lib/core.js';

export default class Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(720, 760);
        window.set_title(_("Windows Vista/7 Widgets Settings"));
        window.search_enabled = true;
        const settings = this.getSettings();
        const options = type => optionsFor(type, parseObject(settings.get_string('options')));
        const save = (type, patch) => {
            const all = parseObject(settings.get_string('options'));
            all[type] = {...optionsFor(type, all), ...patch};
            settings.set_string('options', JSON.stringify(all));
        };
        const page = (title, icon) => { const p = new Adw.PreferencesPage({title, icon_name: icon}); window.add(p); return p; };
        const group = (p, title, description = '') => { const g = new Adw.PreferencesGroup({title, description}); p.add(g); return g; };
        const notify = title => window.add_toast(new Adw.Toast({title, timeout: 4}));
        const entry = (g, type, key, title, {number = false, min = -Infinity, max = Infinity, validate = null} = {}) => {
            const row = new Adw.EntryRow({title, text: String(options(type)[key]), show_apply_button: true});
            row.connect('apply', () => {
                const raw = row.get_text().trim();
                const value = number ? Number(raw) : raw;
                try {
                    if (number && (!raw || !Number.isFinite(value) || value < min || value > max)) throw new Error(format(_("Enter a number from {min} to {max}"), {min: min, max: max}));
                    if (validate) validate(value);
                    save(type, {[key]: value}); row.remove_css_class('error'); notify(_("Saved"));
                } catch (e) { row.add_css_class('error'); notify(e.message); }
            });
            g.add(row); return row;
        };
        const toggle = (g, type, key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle, active: !!options(type)[key]});
            row.connect('notify::active', () => save(type, {[key]: row.active})); g.add(row); return row;
        };
        const combo = (g, type, key, title, values, names) => {
            const row = new Adw.ComboRow({title, model: Gtk.StringList.new(names), selected: Math.max(0, values.indexOf(options(type)[key]))});
            row.connect('notify::selected', () => { if (row.selected < values.length) save(type, {[key]: values[row.selected]}); });
            g.add(row);
        };
        const general = page(_("Desktop"), 'preferences-desktop-display-symbolic');
        const behavior = group(general, _("Display and positions"), _("Drag an empty area of a widget to move it."));
        for (const [key, title, subtitle] of [['visible', _("Show desktop widgets"), _("Hide automatically in the overview and on the lock screen")], ['locked', _("Lock positions"), _("Buttons and content remain usable when positions are locked")], ['desktop-menu', _("Desktop context menu"), _("Show “Add Widgets…” in the active DING menu")]]) {
            const row = new Adw.SwitchRow({title, subtitle}); settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT); behavior.add(row);
        }
        const scale = new Adw.SpinRow({title: _("Scale"), subtitle: _("Each widget's position is saved separately"), adjustment: new Gtk.Adjustment({lower: 0.65, upper: 1.6, step_increment: 0.05, page_increment: 0.1}), digits: 2});
        settings.bind('scale', scale, 'value', Gio.SettingsBindFlags.DEFAULT); behavior.add(scale);
        const reset = new Adw.ActionRow({title: _("Rearrange widgets")});
        const resetButton = new Gtk.Button({label: _("Arrange automatically"), valign: Gtk.Align.CENTER});
        resetButton.connect('clicked', () => { settings.set_string('layout', '{}'); notify(_("Positions reset")); }); reset.add_suffix(resetButton); behavior.add(reset);
        const themeRow = new Adw.ComboRow({title: _("Appearance"), model: Gtk.StringList.new(THEMES.map(name => THEME_NAMES[name])), selected: Math.max(0, THEMES.indexOf(settings.get_string('theme')))});
        let themeUpdating = false;
        themeRow.connect('notify::selected', () => { if (!themeUpdating && themeRow.selected < THEMES.length) settings.set_string('theme', THEMES[themeRow.selected]); });
        const themeSignal = settings.connect('changed::theme', () => { themeUpdating = true; themeRow.selected = Math.max(0, THEMES.indexOf(settings.get_string('theme'))); themeUpdating = false; });
        behavior.add(themeRow);
        const gallery = group(general, _("Widget Gallery"));
        gallery.add(new Adw.ActionRow({title: _("Widget Gallery"), subtitle: _("Choose “Add Widgets…” from the top bar or desktop context menu.")}));
        const galleryRows = new Map(); let updating = false;
        for (const [type, metadata] of Object.entries(GADGETS)) {
            const row = new Adw.SwitchRow({title: metadata.name, active: settings.get_strv('enabled-gadgets').includes(type)});
            row.connect('notify::active', () => {
                if (updating) return;
                const enabled = settings.get_strv('enabled-gadgets');
                settings.set_strv('enabled-gadgets', row.active ? enabledTypes([...enabled, type]) : enabled.filter(v => v !== type));
            });
            gallery.add(row); galleryRows.set(type, row);
        }
        const gallerySignal = settings.connect('changed::enabled-gadgets', () => {
            updating = true; const enabled = settings.get_strv('enabled-gadgets');
            for (const [type, row] of galleryRows) row.active = enabled.includes(type);
            updating = false;
        });
        window.connect('close-request', () => { settings.disconnect(gallerySignal); settings.disconnect(themeSignal); return false; });

        const offline = page(_("Local Widgets"), 'preferences-desktop-theme-symbolic');
        const clock = group(offline, _("Clock"));
        combo(clock, 'clock', 'face', _("Clock face"), ['trad', 'system', 'cronometer', 'diner', 'flower', 'modern', 'square', 'novelty'], [_("Traditional"), _("System"), _("Chronometer"), _("Blue neon"), _("Flower"), _("Modern red"), _("Square"), _("Kitten")]);
        toggle(clock, 'clock', 'seconds', _("Show second hand"));
        entry(clock, 'clock', 'name', _("Clock name (optional)"));
        entry(clock, 'clock', 'timezone', _("Time zone (blank for system default)"), {validate: value => { if (value && !GLib.TimeZone.new_identifier(value)) throw new Error(_("Enter a valid time zone, such as Asia/Shanghai or Europe/London")); }});
        const calendar = group(offline, _("Calendar")); toggle(calendar, 'calendar', 'mondayFirst', _("Start the week on Monday")); toggle(calendar, 'calendar', 'expanded', _("Expand the month view"));
        const notes = group(offline, _("Notes"), _("Edit directly on the desktop. Up to 8000 characters."));
        combo(notes, 'notes', 'color', _("Paper color"), ['yellow', 'blue', 'green', 'pink', 'purple', 'white'], [_("Yellow"), _("Blue"), _("Green"), _("Pink"), _("Purple"), _("White")]);
        const photos = group(offline, _("Slide Show"), _("Supports PNG, JPEG and WebP. Each up to 20 MiB."));
        const folderRow = new Adw.ActionRow({title: _("Pictures folder"), subtitle: options('photos').directory || _("Not selected")});
        const choose = new Gtk.Button({label: _("Choose…"), valign: Gtk.Align.CENTER});
        choose.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _("Choose a slide show folder")});
            dialog.select_folder(window, null, (d, result) => {
                try {
                    const folder = d.select_folder_finish(result), path = folder.get_path();
                    if (!path) { notify(_("Choose a local folder")); return; }
                    save('photos', {directory: path}); folderRow.subtitle = path;
                } catch { /* Closing the chooser is not an error. */ }
            });
        });
        folderRow.add_suffix(choose); photos.add(folderRow);
        entry(photos, 'photos', 'interval', _("Slide interval (seconds)"), {number: true, min: 5, max: 3600});
        const timer = group(offline, _("Timer"), _("Click the digits or scroll to adjust the duration. Click the bottom to start or pause."));
        entry(timer, 'timer', 'duration', _("Default duration (seconds, applied on reset)"), {number: true, min: 1, max: 3599});
        const arithmetic = group(offline, _("Calculator and Picture Puzzle"));

        const online = page(_("Online Data"), 'network-wireless-symbolic');
        const region = group(online, _("Automatic data sources"), _("Chooses data sources from the IP location when enabled. Proxies may affect detection."));
        region.add(new Adw.ActionRow({title: _("Detect only when enabled"), subtitle: _("Only the last successful source group is saved, not the IP address. The weather city, securities and currencies are not changed.")}));
        const weather = group(online, _("Weather · CMA / Open-Meteo"), _("Updates every 10 minutes."));
        entry(weather, 'weather', 'station', _("Station ID"), {validate: value => { if (value && !/^[0-9A-Za-z][0-9A-Za-z_-]{2,11}$/.test(value)) throw new Error(_("Invalid station ID. Search for a city in Weather Settings.")); }});
        toggle(weather, 'weather', 'cityAuto', _("Show place name automatically"));
        entry(weather, 'weather', 'city', _("Custom place name"));
        entry(weather, 'weather', 'latitude', _("Latitude"), {number: true, min: -90, max: 90});
        entry(weather, 'weather', 'longitude', _("Longitude"), {number: true, min: -180, max: 180});
        toggle(weather, 'weather', 'fahrenheit', _("Use Fahrenheit (°F)"));
        const feeds = group(online, 'RSS / Atom', _("Updates every 15 minutes."));
        const autoFeed = toggle(feeds, 'rss', 'autoSource', _("Choose feed automatically"));
        const feedUrl = entry(feeds, 'rss', 'url', _("Custom feed URL"), {validate: httpsUrl});
        feedUrl.sensitive = !autoFeed.active;
        autoFeed.connect('notify::active', () => { feedUrl.sensitive = !autoFeed.active; });
        const currency = group(online, _("Currency · Eastmoney / Frankfurter"), _("Checks reference rates hourly."));
        const code = value => { if (!/^[A-Za-z]{3}$/.test(value)) throw new Error(_("Enter a three-letter currency code, such as USD, CNY or EUR")); };
        entry(currency, 'currency', 'base', _("Base currency"), {validate: code});
        entry(currency, 'currency', 'quote', _("Target currency"), {validate: code});
        const stocks = group(online, _("Stocks · Eastmoney / Yahoo Finance"), _("Updates quote snapshots every 10 minutes; data may be delayed."));
        entry(stocks, 'stocks', 'symbol', _("Stock symbol"), {validate: value => { if (!/^[A-Za-z0-9.^=-]{1,24}$/.test(value)) throw new Error(_("Invalid stock symbol")); }});

        const peoplePage = page(_("Contacts"), 'x-office-address-book-symbolic');
        const peopleGroup = group(peoplePage, _("Local contacts"), _("One per line: name | phone | email. Phone and email may be blank. Up to 100 contacts."));
        const editor = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 12, bottom_margin: 12, left_margin: 12, right_margin: 12, monospace: true});
        editor.buffer.set_text(validContacts(options('contacts').people).map(p => `${p.name} | ${p.phone} | ${p.email}`).join('\n'), -1);
        const scroll = new Gtk.ScrolledWindow({height_request: 320, child: editor, hexpand: true, vexpand: true});
        peopleGroup.add(scroll);
        const actions = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, margin_top: 12});
        const savePeople = new Gtk.Button({label: _("Save contacts"), css_classes: ['suggested-action']});
        savePeople.connect('clicked', () => {
            const buffer = editor.buffer, text = buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false);
            const rows = text.split('\n').filter(line => line.trim());
            if (rows.length > 100) { notify(_("Up to 100 contacts can be saved")); return; }
            const people = [];
            for (const row of rows) {
                const fields = row.split('|').map(x => x.trim());
                if (fields.length > 3 || !fields[0]) { notify(_("Use the format “name | phone | email”")); return; }
                if (fields[0].length > 80 || (fields[1] || '').length > 60 || (fields[2] || '').length > 200) { notify(_("The name, phone number or email is too long")); return; }
                people.push({name: fields[0], phone: fields[1] || '', email: fields[2] || ''});
            }
            save('contacts', {people}); notify(format(ngettext("Saved {count} contact", "Saved {count} contacts", people.length), {count: people.length}));
        });
        actions.append(savePeople); peopleGroup.add(actions);
        const about = group(peoplePage, _("Data storage and removal"), _("Notes, contacts and layout are stored in GSettings. Network caches are in ~/.cache/classic-desktop-gadgets. Uninstalling keeps personal content by default. Export a backup before clearing it."));
    }
}
