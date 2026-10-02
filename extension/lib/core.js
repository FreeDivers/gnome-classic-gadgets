// SPDX-License-Identifier: MIT
import {_, format, formatNumber} from './i18n.js';
// Pure, independently written models shared by GJS and the Node test suite.
// width/height: original docked ("small") skin size. large: original undocked
// size where the gadget has one (phase 2 may vary the actual height, e.g. the
// calculator history view or the number of stock rows).
const AUTHOR = 'Microsoft Corporation';
export const GADGETS = Object.freeze({
    clock: {get name() { return _("Clock"); }, subtitle: 'ANALOG CLOCK', icon: 'preferences-system-time-symbolic', width: 130, height: 130, author: AUTHOR, get description() { return _("An analog clock."); }},
    calendar: {get name() { return _("Calendar"); }, subtitle: 'CALENDAR', icon: 'x-office-calendar-symbolic', width: 130, height: 141, large: {width: 130, height: 264}, author: AUTHOR, get description() { return _("Show today's date."); }},
    system: {get name() { return _("CPU / Memory"); }, subtitle: 'SYSTEM METER', icon: 'utilities-system-monitor-symbolic', width: 130, height: 101, large: {width: 198, height: 159}, author: AUTHOR, get description() { return _("Show CPU and memory usage."); }},
    notes: {get name() { return _("Notes"); }, subtitle: 'STICKY NOTES', icon: 'accessories-text-editor-symbolic', width: 130, height: 121, large: {width: 197, height: 177}, author: AUTHOR, get description() { return _("Write notes."); }},
    weather: {get name() { return _("Weather"); }, subtitle: 'WEATHER', icon: 'weather-few-clouds-symbolic', width: 130, height: 67, large: {width: 264, height: 194}, author: AUTHOR, get description() { return _("View the current weather in the selected city."); }},
    photos: {get name() { return _("Slide Show"); }, subtitle: 'SLIDE SHOW', icon: 'folder-pictures-symbolic', width: 130, height: 100, large: {width: 360, height: 280}, author: AUTHOR, get description() { return _("Cycle through pictures in a local folder."); }},
    calculator: {get name() { return _("Calculator"); }, subtitle: 'CALCULATOR', icon: 'accessories-calculator-symbolic', width: 130, height: 153, large: {width: 242, height: 271}, author: AUTHOR, get description() { return _("A desktop calculator with memory keys."); }},
    timer: {get name() { return _("Timer"); }, subtitle: 'COUNTDOWN', icon: 'alarm-symbolic', width: 90, height: 111, large: {width: 130, height: 165}, author: AUTHOR, get description() { return _("An egg-shaped countdown timer."); }},
    puzzle: {get name() { return _("Picture Puzzle"); }, subtitle: 'PICTURE PUZZLE', icon: 'applications-games-symbolic', width: 130, height: 138, author: AUTHOR, get description() { return _("A 4×4 sliding puzzle."); }},
    rss: {get name() { return _("RSS Feeds"); }, subtitle: 'FEED HEADLINES', icon: 'application-rss+xml-symbolic', width: 130, height: 173, large: {width: 296, height: 232}, author: AUTHOR, get description() { return _("Show the latest headlines from an RSS or Atom feed."); }},
    currency: {get name() { return _("Currency Converter"); }, subtitle: 'EXCHANGE RATES', icon: 'accessories-calculator-symbolic', width: 130, height: 83, large: {width: 254, height: 171}, author: AUTHOR, get description() { return _("Convert currencies using reference exchange rates."); }},
    stocks: {get name() { return _("Stocks"); }, subtitle: 'MARKET SNAPSHOT', icon: 'view-statistics-symbolic', width: 130, height: 142, large: {width: 323, height: 153}, author: AUTHOR, get description() { return _("Show price snapshots for multiple securities."); }},
    contacts: {get name() { return _("Contacts"); }, subtitle: 'CONTACTS', icon: 'x-office-address-book-symbolic', width: 130, height: 166, large: {width: 309, height: 198}, author: AUTHOR, get description() { return _("Save and search local contacts."); }},
    trash: {get name() { return _("Trash"); }, subtitle: 'RECYCLE BIN', icon: 'user-trash-symbolic', width: 130, height: 90, author: AUTHOR, get description() { return _("Show the status of the trash."); }},
});
export const DEFAULT_ENABLED = ['clock', 'calendar', 'system', 'notes'];
export const DEFAULT_OPTIONS = Object.freeze({
    clock: {face: 'trad', timezone: '', name: '', seconds: true},
    calendar: {mondayFirst: true, expanded: false, size: 'small'},
    system: {size: 'small'},
    notes: {text: '', color: 'yellow', pages: [], pageIndex: 0, size: 'small'},
    // Saved location data, not interface text. Do not translate or migrate this name.
    weather: {city: '上海', station: '58367', coordinateStation: '58367', cityAuto: true, latitude: 31.23, longitude: 121.47, fahrenheit: false, size: 'small'},
    photos: {directory: '', interval: 30, paused: false, size: 'small'},
    calculator: {size: 'small'},
    timer: {duration: 300, remaining: 300, deadline: 0, running: false, size: 'small'},
    puzzle: {image: 1, tiles: [], moves: 0},
    rss: {url: 'https://www.ithome.com/rss/', autoSource: true, count: 8, size: 'small'},
    currency: {base: 'USD', quote: 'CNY', amount: 100, size: 'small'},
    stocks: {symbol: '600519', symbols: [], size: 'small'},
    contacts: {people: [], size: 'small'},
    trash: {view: 1},
});
export const SIZES = ['small', 'large'];
export const THEMES = ['classic', 'fluent'];
export const THEME_NAMES = Object.freeze({get classic() { return _("Classic (Windows Vista / 7 originals)"); }, get fluent() { return _('Fluent (Rectify11)'); }});
export function validTheme(name) { return THEMES.includes(name) ? name : 'classic'; }
export function sizeOf(type, options = {}) { return GADGETS[type]?.large && options.size === 'large' ? 'large' : 'small'; }

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function finite(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function parseObject(text, fallback = {}) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch {
        return fallback;
    }
}
// One-way upgrades of stored option shapes from earlier versions.
const MIGRATIONS = {
    weather: stored => !Object.hasOwn(stored, 'station') && (Object.hasOwn(stored, 'latitude') || Object.hasOwn(stored, 'longitude')) ? {...stored, station: ''} : stored,
    // Legacy IT之家 was the built-in default; other saved URLs are user choices.
    // Do not rewrite a saved BBC/custom feed to IT之家 as the old migration did.
    rss: stored => Object.hasOwn(stored, 'autoSource') ? stored : {...stored, autoSource: !stored.url || stored.url === DEFAULT_OPTIONS.rss.url},
    // 2.0 stored only `expanded`; since 2.1 `size` is canonical and `expanded` mirrors it.
    calendar: stored => !Object.hasOwn(stored, 'size') && stored.expanded ? {...stored, size: 'large'} : stored,
};
export function optionsFor(type, options = {}) {
    const candidate = options[type];
    const stored = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
    return {...DEFAULT_OPTIONS[type], ...(MIGRATIONS[type] ? MIGRATIONS[type](stored) : stored)};
}
export function enabledTypes(values) {
    return [...new Set(values.filter(type => Object.hasOwn(GADGETS, type)))];
}

export function monthGrid(year, month, mondayFirst = true) {
    // Use noon and local calendar operations, not UTC dates (DST-safe).
    const first = new Date(year, month, 1, 12);
    const offset = (first.getDay() + (mondayFirst ? 6 : 0)) % 7;
    return Array.from({length: 42}, (_, i) => {
        const date = new Date(year, month, i - offset + 1, 12);
        return {year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), current: date.getMonth() === month};
    });
}
export function shiftMonth(year, month, delta) {
    const d = new Date(year, month + delta, 1, 12);
    return {year: d.getFullYear(), month: d.getMonth()};
}
export function parseCpuStat(text) {
    const line = text.split('\n').find(value => /^cpu\s/.test(value));
    if (!line) throw new Error(_("The cpu line is missing from /proc/stat"));
    const values = line.trim().split(/\s+/).slice(1).map(Number);
    if (values.length < 4 || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error(_("Invalid CPU counters"));
    // guest and guest_nice are already included in user and nice; do NOT add twice.
    return {total: values.slice(0, 8).reduce((a, b) => a + b, 0), idle: values[3] + (values[4] || 0)};
}
export function cpuPercent(previous, current) {
    if (!previous || !current) return null;
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total <= 0 || idle < 0 || idle > total) return null;
    return clamp((1 - idle / total) * 100, 0, 100);
}
export function parseMemory(text) {
    const fields = {};
    for (const match of text.matchAll(/^(\w+):\s+(\d+)\s*kB/gm)) fields[match[1]] = Number(match[2]);
    const total = fields.MemTotal;
    if (!Number.isFinite(total) || total <= 0) throw new Error(_("Invalid total memory"));
    const available = clamp(fields.MemAvailable ?? ((fields.MemFree || 0) + (fields.Buffers || 0) + (fields.Cached || 0)), 0, total);
    return {total: total * 1024, used: (total - available) * 1024, percent: (1 - available / total) * 100};
}
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024 ** 3) return `${formatNumber(Math.round(bytes / 1024 ** 2))} MiB`;
    return `${formatNumber(bytes / 1024 ** 3, {minimumFractionDigits: 1, maximumFractionDigits: 1})} GiB`;
}
export function fitPosition(saved, workareas, width, height, index = 0) {
    const monitor = clamp(Math.trunc(finite(saved?.monitor, 0)), 0, Math.max(0, workareas.length - 1));
    const area = workareas[monitor] || {x: 0, y: 0, width: 1920, height: 1080};
    const maxX = Math.max(0, area.width - width);
    const maxY = Math.max(0, area.height - height);
    const defaultX = maxX - 28 - Math.floor(index / Math.max(1, Math.floor(area.height / (height + 16)))) * (width + 18);
    const defaultY = 22 + (index * (height + 16)) % Math.max(height + 16, area.height - height);
    const x = clamp(finite(saved?.x, defaultX), 0, maxX);
    const y = clamp(finite(saved?.y, defaultY), 0, maxY);
    return {monitor, x, y, stageX: area.x + x, stageY: area.y + y};
}
export function defaultLayout(types, workarea, scale = 1, dimensions = {}) {
    const result = {};
    const size = type => dimensions[type] || {width: GADGETS[type].width + 22, height: GADGETS[type].height};
    const columnWidth = Math.max(152, ...types.map(type => size(type).width)) * scale;
    let right = workarea.width - 12, y = 18;
    for (const type of types) {
        const width = size(type).width * scale, height = size(type).height * scale;
        if (y > 18 && y + height > workarea.height - 12) { right -= columnWidth + 10; y = 18; }
        result[type] = {monitor: 0, x: Math.max(0, right - width), y: Math.max(0, y)};
        y += height + 14;
    }
    return result;
}

export function countdown(state, now = Date.now()) {
    return state.running ? Math.max(0, Math.ceil((finite(state.deadline) - now) / 1000)) : Math.max(0, Math.round(finite(state.remaining, finite(state.duration, 300))));
}
export function timerAction(state, action, now = Date.now()) {
    const duration = clamp(Math.round(finite(state.duration, 300)), 1, 86400);
    const remaining = countdown(state, now);
    if (action === 'start') return {...state, duration, running: true, remaining: remaining || duration, deadline: now + (remaining || duration) * 1000};
    if (action === 'pause') return {...state, duration, running: false, remaining, deadline: 0};
    if (action === 'reset') return {...state, duration, running: false, remaining: duration, deadline: 0};
    if (action === 'finish') return {...state, duration, running: false, remaining: 0, deadline: 0};
    return state;
}
export function formatDuration(seconds) {
    const total = clamp(Math.round(finite(seconds)), 0, 86400);
    const m = String(Math.floor(total / 60) % 60).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return total >= 3600 ? `${Math.floor(total / 3600)}:${m}:${s}` : `${m}:${s}`;
}

export const SOLVED = Object.freeze(Array.from({length: 16}, (_, i) => (i + 1) % 16));
export function validPuzzle(tiles) {
    return Array.isArray(tiles) && tiles.length === 16 && new Set(tiles).size === 16 && tiles.every(n => Number.isInteger(n) && n >= 0 && n < 16);
}
export function solvedPuzzle(tiles) {
    return validPuzzle(tiles) && tiles.every((tile, i) => tile === SOLVED[i]);
}
export function solvablePuzzle(tiles) {
    if (!validPuzzle(tiles)) return false;
    let inversions = 0;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) if (tiles[i] && tiles[j] && tiles[i] > tiles[j]) inversions++;
    const blankRowFromBottom = 4 - Math.floor(tiles.indexOf(0) / 4);
    return (inversions + blankRowFromBottom) % 2 === 1;
}
export function moveTile(tiles, index) {
    if (!validPuzzle(tiles) || index < 0 || index >= 16) return null;
    const empty = tiles.indexOf(0);
    if (Math.abs(Math.floor(index / 4) - Math.floor(empty / 4)) + Math.abs(index % 4 - empty % 4) !== 1) return null;
    const result = [...tiles];
    [result[index], result[empty]] = [result[empty], result[index]];
    return result;
}
export function shufflePuzzle(random = Math.random, steps = 180) {
    let tiles = [...SOLVED];
    let previous = -1;
    for (let i = 0; i < steps; i++) {
        const empty = tiles.indexOf(0);
        const neighbors = [empty - 4, empty + 4, empty - 1, empty + 1].filter(index => index !== previous && moveTile(tiles, index));
        const index = neighbors[Math.min(neighbors.length - 1, Math.floor(clamp(random(), 0, 1) * neighbors.length))];
        previous = empty;
        tiles = moveTile(tiles, index);
    }
    return solvedPuzzle(tiles) ? moveTile(tiles, 14) : tiles;
}

// A small arithmetic parser: no eval, Function constructor, shell, or remote code.
export function calculate(expression) {
    const source = String(expression).trim().replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-').replaceAll('π', 'pi');
    if (!source || source.length > 512) throw new Error(_("Enter an expression (up to 512 characters)"));
    const tokens = [];
    let position = 0;
    while (position < source.length) {
        const rest = source.slice(position);
        const match = /^(\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-z]+|[()+\-*/^%])/i.exec(rest);
        if (!match) throw new Error(format(_("Unsupported character: {character}"), {character: rest[0]}));
        if (!/^\s/.test(match[0])) tokens.push(match[0].toLowerCase());
        position += match[0].length;
    }
    let i = 0;
    const functions = {sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10};
    const priorities = {'+': 10, '-': 10, '*': 20, '/': 20, '^': 30};
    function parse(minimum = 0, depth = 0) {
        if (depth > 40) throw new Error(_("Too many nested parentheses"));
        const token = tokens[i++];
        let left;
        if (token === '+' || token === '-') left = (token === '-' ? -1 : 1) * parse(25, depth + 1);
        else if (token === '(') {
            left = parse(0, depth + 1);
            if (tokens[i++] !== ')') throw new Error(_("Missing closing parenthesis"));
        } else if (token === 'pi') left = Math.PI;
        else if (token === 'e') left = Math.E;
        else if (Object.hasOwn(functions, token)) {
            if (tokens[i++] !== '(') throw new Error(_("Functions require parentheses"));
            left = functions[token](parse(0, depth + 1));
            if (tokens[i++] !== ')') throw new Error(_("Missing closing parenthesis"));
        } else if (token && /^(\d|\.)/.test(token)) left = Number(token);
        else throw new Error(_("Incomplete expression"));
        while (i < tokens.length) {
            const op = tokens[i];
            if (op === '%') { i++; left /= 100; continue; }
            const precedence = priorities[op];
            if (precedence === undefined || precedence < minimum) break;
            i++;
            const right = parse(precedence + (op === '^' ? 0 : 1), depth + 1);
            if (op === '+') left += right;
            else if (op === '-') left -= right;
            else if (op === '*') left *= right;
            else if (op === '/') {
                if (right === 0) throw new Error(_("Cannot divide by zero"));
                left /= right;
            } else left **= right;
        }
        if (!Number.isFinite(left)) throw new Error(_("The result is out of range or not a real number"));
        return left;
    }
    const result = parse();
    if (i !== tokens.length) throw new Error(_("Check the parentheses and operators"));
    return Object.is(result, -0) ? 0 : Number(result.toPrecision(12));
}

export function httpsUrl(value) {
    const url = String(value || '').trim();
    if (url.length > 4096 || /[\s\\\x00-\x1f]/.test(url) || !/^https:\/\/[^/?#@]+(?:[/?#]|$)/i.test(url)) throw new Error(_("Use an HTTPS URL without a username or password"));
    return url;
}
export function decodeEntities(value) {
    return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, key) => {
        if (key[0] === '#') {
            const point = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
            return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '�';
        }
        return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}[key.toLowerCase()];
    });
}
export function plainText(value, limit = 180) {
    return decodeEntities(String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function parseFeed(xml) {
    if (typeof xml !== 'string' || xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(_("The feed is too large or contains unsupported XML declarations"));
    const entries = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)];
    const results = [];
    for (const [, , entry] of entries.slice(0, 100)) {
        const title = plainText(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(entry)?.[1] || _("Untitled"));
        let link = '';
        for (const match of entry.matchAll(/<link\b([^>]*)(?:>([\s\S]*?)<\/link\s*>|\s*\/?>)/gi)) {
            const attrs = match[1];
            const rel = /\brel\s*=\s*['"]([^'"]+)['"]/i.exec(attrs)?.[1];
            if (rel && rel !== 'alternate') continue;
            const href = /\bhref\s*=\s*['"]([^'"]+)['"]/i.exec(attrs)?.[1];
            const candidate = decodeEntities(href || plainText(match[2] || '', 4096));
            try { link = httpsUrl(candidate); break; } catch { /* Ignore unsafe links. */ }
        }
        if (link) results.push({title, url: link});
        if (results.length === 8) break;
    }
    if (!results.length) throw new Error(_("The feed contains no displayable entries with HTTPS links"));
    return results;
}
export function weatherDescription(code) {
    if (code === 0) return [_("Clear"), 'weather-clear-symbolic'];
    if ([1, 2].includes(code)) return [_("Partly cloudy"), 'weather-few-clouds-symbolic'];
    if (code === 3) return [_("Overcast"), 'weather-overcast-symbolic'];
    if ([45, 48].includes(code)) return [_("Fog"), 'weather-fog-symbolic'];
    if ([51, 53, 55, 56, 57].includes(code)) return [_("Light rain"), 'weather-showers-scattered-symbolic'];
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return [_("Rain"), 'weather-showers-symbolic'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return [_("Snow"), 'weather-snow-symbolic'];
    if ([95, 96, 99].includes(code)) return [_("Thunderstorms"), 'weather-storm-symbolic'];
    return [_("Unknown weather"), 'weather-severe-alert-symbolic'];
}
export function parseWeather(data) {
    const c = data?.current;
    if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.weather_code)) throw new Error(_("The weather service returned invalid data"));
    return {temperature: c.temperature_2m, code: c.weather_code, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, time: String(c.time || ''), days: (data.daily?.time || []).slice(0, 3).map((date, i) => ({date, high: data.daily.temperature_2m_max?.[i], low: data.daily.temperature_2m_min?.[i]}))};
}
export function parseRate(data, base, quote) {
    const rate = data?.rates?.[quote];
    if (data?.base !== base || !Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data?.date)) throw new Error(_("The exchange rate service did not return this currency pair"));
    return {rate, date: data.date};
}
export function parseStock(csv) {
    const lines = String(csv).trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error(_("No quote data"));
    const cols = lines[1].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
    const [symbol, date, time, open, high, low, close] = cols;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![open, high, low, close].every(value => value !== '' && Number.isFinite(Number(value)) && Number(value) > 0)) throw new Error(_("No quote found for this security. Use a Stooq symbol, such as aapl.us."));
    return {symbol, date, time, open: +open, high: +high, low: +low, close: +close};
}
export function validContacts(people) {
    if (!Array.isArray(people)) return [];
    return people.slice(0, 100).filter(p => p && typeof p === 'object').map(p => ({name: String(p.name || '').slice(0, 80), phone: String(p.phone || '').slice(0, 60), email: String(p.email || '').slice(0, 200)})).filter(p => p.name);
}
