// SPDX-License-Identifier: MIT
// No Shell or display required. Load the pure models before binding gettext
// to catch messages accidentally translated once at module-import time.
import Gio from 'gi://Gio';
const root = Gio.File.new_for_path(ARGV[0]).get_uri();
const {GADGETS, DEFAULT_OPTIONS, optionsFor, weatherDescription} = await import(`${root}/lib/core.js`);
const {SOURCE_PROFILES} = await import(`${root}/lib/network-sources.js`);
const {REGION_NAMES} = await import(`${root}/lib/logic/network-region.js`);
const {cmaCodeText, MOON_PHASE_NAMES} = await import(`${root}/lib/logic/weather-cn.js`);
const {parseNumber} = await import(`${root}/lib/ui/ui-logic.js`);
const {geocodingUrl} = await import(`${root}/lib/logic/weather-global.js`);
const {normalizeStockInput, suggestUrl} = await import(`${root}/lib/logic/finance-cn.js`);
const errorMessage = fn => { try { fn(); return null; } catch (error) { return error.message; } };
const before = GADGETS.weather.name;
const saved = JSON.stringify(DEFAULT_OPTIONS);
await import(`${root}/lib/i18n-runtime.js`);
const {_, ngettext, pgettext, format, formatDate, getLocale, getLanguage} = await import(`${root}/lib/i18n.js`);
const {filterGadgets} = await import(`${root}/lib/ui/ui-logic.js`);
const entries = Object.entries(GADGETS).map(([type, data]) => ({type, ...data}));
print(JSON.stringify({
    before, locale: getLocale(), language: getLanguage(),
    brand: _('Windows Vista/7 Widgets'), settingsTitle: _('Windows Vista/7 Widgets Settings'),
    enablePrompt: _('Enable Windows Vista/7 Widgets first'),
    weather: GADGETS.weather.name, locate: _('Find my location'),
    allNames: entries.map(entry => entry.name), provider: SOURCE_PROFILES.mainland.weather.name,
    region: REGION_NAMES.mainland, clear: cmaCodeText(0), thunder: weatherDescription(95)[0], moon: MOON_PHASE_NAMES.full,
    invalidNumber: parseNumber('bad').error,
    invalidStock: errorMessage(() => normalizeStockInput('')),
    invalidSuggestion: errorMessage(() => suggestUrl('')),
    items: [0, 1, 2].map(count => format(ngettext('{count} item', '{count} items', count), {count})),
    missing: _('Message without a translation'), context: pgettext('no-such-context', 'Open'),
    weekday: formatDate(new Date('2026-01-04T12:00:00Z'), {weekday: 'long', timeZone: 'UTC'}),
    chineseSearch: filterGadgets(entries, '天气').map(entry => entry.type),
    englishSearch: filterGadgets(entries, 'WEATHER').map(entry => entry.type),
    geocoding: geocodingUrl('上海'), savedUnchanged: JSON.stringify(DEFAULT_OPTIONS) === saved,
    userText: optionsFor('notes', {notes: {text: '我的便笺 {count} $& <b>hello</b>'}}).text,
}));
