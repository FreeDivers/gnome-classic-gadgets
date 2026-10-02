// SPDX-License-Identifier: MIT
import {_, N_, format, formatDate, formatNumber, ngettext} from '../i18n.js';
// Pure parsing/mapping logic for the 东方财富 quote APIs (push2.eastmoney.com,
// searchapi.eastmoney.com): stock code normalisation, ulist/stock/suggest parsing,
// market sessions, forex lists and cross rates — see build/specs/data-apis.md §6–§7.
//
// NO GI IMPORTS ALLOWED in lib/logic/: this module is unit-tested under Node
// (tests/logic-finance-cn.test.js). Every parser accepts the raw response text
// (what Network.get passes) or an already-parsed object (what tests pass) and
// throws an Error with a translated message on anything unexpected.

const INVALID_INPUT = N_("Enter a valid stock symbol or name, such as 600519, 00700, AAPL or Kweichow Moutai");
const SECID = /^(\d{1,3})\.([A-Z0-9.\-]{1,12})$/i;
const CURRENCY = /^[A-Z]{3}$/;

/** Eastmoney market ids the gadgets accept (data-apis.md §6.5). */
export const MARKETS = Object.freeze({
    0: {get name() { return _("Shenzhen"); }, currency: 'CNY', zone: 'Asia/Shanghai'},
    1: {get name() { return _("Shanghai"); }, currency: 'CNY', zone: 'Asia/Shanghai'},
    100: {get name() { return _("Global index"); }, currency: '', zone: null},
    105: {get name() { return _("NASDAQ"); }, currency: 'USD', zone: 'America/New_York'},
    106: {get name() { return _("NYSE"); }, currency: 'USD', zone: 'America/New_York'},
    107: {get name() { return _("AMEX"); }, currency: 'USD', zone: 'America/New_York'},
    116: {get name() { return _("HKEX"); }, currency: 'HKD', zone: 'Asia/Hong_Kong'},
});
const ACCEPTED_MARKETS = new Set([0, 1, 105, 106, 107, 116]);
// Trading sessions in minutes of local time, Monday–Friday (data-apis.md §6.6).
const SESSIONS = Object.freeze({'Asia/Shanghai': [[570, 690], [780, 900]], 'Asia/Hong_Kong': [[570, 720], [780, 960]], 'America/New_York': [[570, 960]]});
const FIXED_OFFSETS = Object.freeze({'Asia/Shanghai': 8, 'Asia/Hong_Kong': 8, 'America/New_York': -5});

// --- small helpers ---------------------------------------------------------------------
function str(value) { return typeof value === 'string' ? value.trim() : ''; }
function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function int(value) { return Number.isInteger(value) ? value : null; }
function clampInt(value, min, max, fallback) { const n = int(value); return n === null ? fallback : Math.min(max, Math.max(min, n)); }
function asciiWidth(text) { return text.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' '); }
function parseJson(value, error) {
    let data = value;
    if (typeof value === 'string') {
        try { data = JSON.parse(value); } catch { throw new Error(error); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(error);
    return data;
}
/** push2 envelope `{rc, data}`; a body without a numeric `rc` is not from push2. */
function pushEnvelope(value) {
    const json = parseJson(value, _("Eastmoney returned invalid data"));
    if (!Number.isInteger(json.rc)) throw new Error(_("Eastmoney returned invalid data"));
    return json;
}

// --- user input → secid (data-apis.md §6.4) -----------------------------------------------
/**
 * '600519' → {secid: '1.600519', query: '600519'}; 'sz000001' / '000001.SZ' → '0.000001';
 * '700' / '0700.HK' / '00700' → '116.00700'; '105.AAPL' passes through; 'AAPL' / 'AAPL.US' →
 * {query: 'AAPL', markets: [105, 106, 107]} (resolve with suggestUrl + pickSuggest); Chinese names
 * → {query}. Full-width characters are folded to ASCII; anything else (spaces, symbols other than
 * `.` `-` `*`, more than 24 characters) throws 无效代码….
 */
export function normalizeStockInput(input) {
    const raw = asciiWidth(String(input ?? '')).trim();
    if (!raw || raw.length > 24 || !/^[\p{L}\p{N}.\-*]+$/u.test(raw)) throw new Error(_(INVALID_INPUT));
    const s = raw.toUpperCase();
    let m;
    if (/^\d{6}$/.test(s)) return {secid: `${/^[5679]/.test(s) ? 1 : 0}.${s}`, query: s};
    if ((m = /^(SH|SS|SZ|BJ)(\d{6})$/.exec(s))) return {secid: `${m[1] === 'SZ' || m[1] === 'BJ' ? 0 : 1}.${m[2]}`, query: m[2]};
    if ((m = /^(\d{6})\.(SS|SH|SZ|BJ)$/.exec(s))) return {secid: `${m[2] === 'SZ' || m[2] === 'BJ' ? 0 : 1}.${m[1]}`, query: m[1]};
    if ((m = /^(\d{1,5})(?:\.HK)?$/.exec(s))) { const code = m[1].padStart(5, '0'); return {secid: `116.${code}`, query: code}; }
    if ((m = SECID.exec(s)) && Object.hasOwn(MARKETS, Number(m[1]))) return {secid: `${Number(m[1])}.${m[2]}`, query: m[2], market: Number(m[1])};
    const ticker = s.replace(/\.US$/, '');
    if (/^[A-Z][A-Z.\-]{0,9}$/.test(ticker)) return {query: ticker, markets: [105, 106, 107]};
    return {query: raw};
}
/** Market preference for a suggest lookup, by input shape: 6 digits → 沪A then 深A; ≤5 digits → 港股; Latin → US. */
export function preferredMarkets(input) {
    const s = asciiWidth(String(input ?? '')).trim().toUpperCase();
    if (/^\d{6}$/.test(s)) return [1, 0];
    if (/^\d{1,5}$/.test(s)) return [116];
    if (/^[A-Z][A-Z.\-]{0,9}$/.test(s)) return [105, 106, 107];
    return [];
}
export function validSecid(secid) {
    const m = SECID.exec(String(secid ?? '').trim());
    if (!m) throw new Error(format(_("Invalid stock symbol: {symbol}"), {symbol: String(secid ?? '').slice(0, 24) || _("(empty)")}));
    return `${Number(m[1])}.${m[2].toUpperCase()}`;
}

// --- URLs -------------------------------------------------------------------------------
export function suggestUrl(query) {
    const q = asciiWidth(String(query ?? '')).trim().slice(0, 24);
    if (!q) throw new Error(_(INVALID_INPUT));
    return `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&type=14&count=5`;
}
/** Batch quote URL (fltt=2 → decimal values). At most `limit` distinct secids. */
export function ulistUrl(secids, {limit = 10} = {}) {
    const list = [...new Set((Array.isArray(secids) ? secids : [secids]).map(validSecid))];
    if (!list.length) throw new Error(_("No stock symbols to look up"));
    if (list.length > limit) throw new Error(format(ngettext("Look up at most {count} security at a time", "Look up at most {count} securities at a time", limit), {count: limit}));
    return `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124,f152&secids=${list.join(',')}`;
}
/** Single quote URL (scaled integers, see parseStockGet). */
export function stockUrl(secid) {
    return `https://push2.eastmoney.com/api/qt/stock/get?invt=2&secid=${validSecid(secid)}&fields=f43,f44,f45,f46,f57,f58,f59,f60,f86,f107,f116,f169,f170,f171`;
}
/** The three forex lists: 119 international crosses, 120 CNY 中间价, 133 offshore CNH (pz=300 → complete lists). */
export function forexUrls() {
    const url = market => `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=300&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:${market}&fields=f2,f3,f4,f12,f13,f14,f18,f124`;
    return {119: url(119), 120: url(120), 133: url(133)};
}

// --- suggest --------------------------------------------------------------------------------
function suggestRow(row) {
    if (!row || typeof row !== 'object') return null;
    const secid = str(row.QuoteID), code = str(row.Code), name = str(row.Name);
    const m = SECID.exec(secid);
    if (!m || !code || !name) return null;
    const mkt = str(row.MktNum);
    const market = mkt !== '' && Number.isFinite(Number(mkt)) ? Number(mkt) : Number(m[1]);
    return {secid: `${Number(m[1])}.${m[2]}`, code, name, market, type: str(row.SecurityTypeName), pinyin: str(row.PinYin)};
}
/**
 * Best suggest row for `input` → {secid, code, name, market, type, pinyin}: exact code matches
 * first, ordered by preferredMarkets(input) then by accepted markets; otherwise the first row of an
 * accepted market (0/1/105/106/107/116); other markets (韩股, funds…) only when nothing else exists.
 */
export function pickSuggest(value, input) {
    const json = parseJson(value, _("Eastmoney returned invalid data"));
    const table = json.QuotationCodeTable;
    if (!table || typeof table !== 'object') throw new Error(_("Eastmoney returned invalid data"));
    if (Number(table.Status) !== 0) throw new Error(format(_("Stock search service error ({error})"), {error: str(table.Message) || String(table.Status)}));
    const rows = (Array.isArray(table.Data) ? table.Data : []).map(suggestRow).filter(Boolean);
    if (!rows.length) throw new Error(format(_("No matching security found: {symbol}"), {symbol: str(input) || _("(empty)")}));
    const needle = asciiWidth(str(input)).toUpperCase();
    const prefer = preferredMarkets(needle);
    const rank = row => { const index = prefer.indexOf(row.market); return index >= 0 ? index : prefer.length + (ACCEPTED_MARKETS.has(row.market) ? 0 : 1); };
    const exact = rows.filter(row => row.code.toUpperCase() === needle);
    const pool = (exact.length ? exact : rows).map((row, index) => ({row, index, rank: rank(row)}));
    pool.sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
    return pool[0].row;
}

// --- quotes -----------------------------------------------------------------------------------
/** ulist.np (fltt=2) → [{secid, code, market, name, price, change, changePct, high, low, open, previousClose, time (unix s), precision, currency, status}]. */
export function parseUlist(value) {
    const json = pushEnvelope(value);
    const diff = json.data?.diff;
    if (!Array.isArray(diff) || !diff.length) throw new Error(_("No quote data"));
    const rows = [];
    for (const row of diff) {
        if (!row || typeof row !== 'object') continue;
        const code = str(row.f12), market = int(row.f13);
        if (!code || market === null) continue;
        const price = num(row.f2);
        const valid = price !== null && price > 0;
        rows.push({
            secid: `${market}.${code}`, code, market, name: str(row.f14) || code, price: valid ? price : null,
            change: num(row.f4), changePct: num(row.f3), high: num(row.f15), low: num(row.f16), open: num(row.f17), previousClose: num(row.f18),
            time: int(row.f124), precision: clampInt(row.f152, 0, 6, 2), currency: MARKETS[market]?.currency ?? '', status: valid ? null : _("Suspended / no price"),
        });
    }
    if (!rows.length) throw new Error(_("No quote data"));
    return rows;
}
/** stock/get (scaled integers: ÷10^f59, percentages ÷100) → one quote. */
export function parseStockGet(value) {
    const json = pushEnvelope(value);
    const data = json.data;
    if (json.rc !== 0 || !data || typeof data !== 'object') throw new Error(_("No quote for this symbol"));
    const decimals = clampInt(data.f59, 0, 6, 2), scale = 10 ** decimals;
    const raw = num(data.f43);
    if (raw === null || raw <= 0) throw new Error(_("The quote has no latest price"));
    const scaled = v => { const n = num(v); return n === null ? null : n / scale; };
    const pct = v => { const n = num(v); return n === null ? null : n / 100; };
    const code = str(data.f57), market = int(data.f107);
    const price = raw / scale, previousClose = scaled(data.f60);
    return {
        secid: market !== null && code ? `${market}.${code}` : null, code, market, name: str(data.f58) || code, price,
        change: scaled(data.f169) ?? (previousClose !== null ? price - previousClose : null),
        changePct: pct(data.f170) ?? (previousClose ? (price - previousClose) / previousClose * 100 : null),
        amplitudePct: pct(data.f171), high: scaled(data.f44), low: scaled(data.f45), open: scaled(data.f46), previousClose,
        time: int(data.f86), marketCap: num(data.f116), decimals, currency: MARKETS[market]?.currency ?? '',
    };
}
function localParts(ms, zone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'}).formatToParts(new Date(ms));
        const get = type => parts.find(part => part.type === type)?.value ?? '';
        return {date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))};
    } catch {
        const local = new Date(ms + (FIXED_OFFSETS[zone] ?? 8) * 3600000);
        return {date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: local.getUTCDay()};
    }
}
/**
 * {open, label: '交易中' | '休市', currency}: open when `now` (ms) falls into a weekday session of the
 * secid's market and the quote (`quoteTime`, unix seconds) is from the same local day — a quote left
 * on the previous trading day means a holiday. push2 has no status field, so this is derived locally.
 */
export function marketStatus(secid, quoteTime, now = Date.now()) {
    const market = Number(String(secid ?? '').split('.')[0]);
    const info = MARKETS[market];
    const closed = {open: false, label: _("Market closed"), currency: info?.currency ?? ''};
    if (!info?.zone || !Number.isFinite(quoteTime) || !Number.isFinite(now)) return closed;
    const local = localParts(now, info.zone);
    if (local.weekday < 1 || local.weekday > 5) return closed;
    if (!SESSIONS[info.zone].some(([start, end]) => local.minutes >= start && local.minutes < end)) return closed;
    if (localParts(quoteTime * 1000, info.zone).date !== local.date) return closed;
    return {open: true, label: _("Trading"), currency: info.currency};
}
/** Compact local time in the market's zone; older quotes also show a localized date. */
export function quoteTimeLabel(seconds, now = Date.now(), zone = 'Asia/Shanghai') {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const quote = localParts(seconds * 1000, zone), today = localParts(now, zone);
    const sameDay = quote.date === today.date;
    // localParts already applies the exchange zone (and the existing fallback
    // for unknown provider zones). Format that wall-clock time without shifting it again.
    const localDate = new Date(`${quote.date}T00:00:00Z`);
    localDate.setUTCMinutes(quote.minutes);
    const time = formatDate(localDate, {
        timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        ...(sameDay ? {} : {month: '2-digit', day: '2-digit'}),
    });
    return `${time}${!sameDay && now - seconds * 1000 > 3 * 86400000 ? _(" (non-trading day)") : ''}`;
}

// --- forex ------------------------------------------------------------------------------------
/** clist rows → [{code, name, market, price, previousClose, change, changePct, time, per100}] (per100: `100日元…` rows quote 100 JPY). */
export function parseForexList(value) {
    const json = parseJson(value, _("Invalid exchange rate list"));
    const diff = json.data?.diff;
    if (!Array.isArray(diff)) throw new Error(_("Invalid exchange rate list"));
    const rows = [];
    for (const row of diff) {
        if (!row || typeof row !== 'object') continue;
        const code = str(row.f12).toUpperCase(), price = num(row.f2), name = str(row.f14);
        if (!/^[A-Z]{6,7}$/.test(code) || price === null || price <= 0) continue;
        rows.push({code, name, market: int(row.f13), price, previousClose: num(row.f18), change: num(row.f4), changePct: num(row.f3), time: int(row.f124), per100: name.startsWith('100')});
    }
    if (!rows.length) throw new Error(_("Invalid exchange rate list"));
    return rows;
}
/** Merges parseForexList() results (any nesting) into a Map keyed by the raw code; `strict` also runs validateRateTable(). */
export function buildRateTable(lists, {strict = false} = {}) {
    const table = new Map();
    for (const row of (Array.isArray(lists) ? lists : [lists]).flat(2)) {
        if (!row || typeof row !== 'object' || typeof row.code !== 'string') continue;
        const existing = table.get(row.code);
        if (!existing || (row.time ?? 0) >= (existing.time ?? 0)) table.set(row.code, {...row});
    }
    if (!table.size) throw new Error(_("Invalid exchange rate list"));
    if (strict) validateRateTable(table);
    return table;
}
/** Throws 汇率列表不完整 unless the anchors USDCNYC (120), USDHKD and EURUSD (119) are present. */
export function validateRateTable(table) {
    if (!(table instanceof Map) || !table.has('USDCNYC') || !table.has('USDHKD') || !table.has('EURUSD')) throw new Error(_("Incomplete exchange rate list"));
    return table;
}
export function currencyCode(value) {
    const code = String(value ?? '').trim().toUpperCase();
    if (!CURRENCY.test(code)) throw new Error(format(_("Unsupported currency: {code}"), {code: code.slice(0, 10) || _("(empty)")}));
    return code;
}
/** Every 3-letter code that appears in the table (CNY counts as known when offshore CNH rows exist). */
export function knownCurrencies(table) {
    const known = new Set();
    for (const code of table.keys()) { known.add(code.slice(0, 3)); known.add(code.slice(3, 6)); }
    if (known.has('CNH')) known.add('CNY');
    return known;
}
function entryRate(table, code, inverse = false) {
    const entry = table.get(code);
    if (!entry) return null;
    const unit = entry.price / (entry.per100 ? 100 : 1);
    return {rate: inverse ? 1 / unit : unit, via: code, time: entry.time ?? null, price: entry.price};
}
// When both directions are quoted prefer the row whose price ≥ 1: 4-dp quotes lose precision when small numbers are inverted.
function prefer(direct, inverse) {
    if (direct && inverse) return direct.price >= 1 || inverse.price < 1 ? direct : inverse;
    return direct ?? inverse;
}
function withSource(match, source) { return match ? {rate: match.rate, via: match.via, source, time: match.time} : null; }
function lookup(table, base, quote) {
    if (base === quote) return {rate: 1, via: base, source: _("Same currency"), time: null};
    if (base === 'CNH' || quote === 'CNH') return withSource(prefer(entryRate(table, base + quote), entryRate(table, quote + base, true)), _("Offshore"));
    if (base === 'CNY' || quote === 'CNY') {
        const parity = prefer(entryRate(table, `${base}${quote}C`), entryRate(table, `${quote}${base}C`, true));
        if (parity) return withSource(parity, _("Central parity"));
        const b = base === 'CNY' ? 'CNH' : base, q = quote === 'CNY' ? 'CNH' : quote;
        return withSource(prefer(entryRate(table, b + q), entryRate(table, q + b, true)), _("Offshore"));
    }
    return withSource(prefer(entryRate(table, base + quote), entryRate(table, quote + base, true)), _("International"));
}
function olderTime(a, b) { if (a === null || a === undefined) return b ?? null; if (b === null || b === undefined) return a; return Math.min(a, b); }
/**
 * {rate, via, source, time}: direct pair (or its inverse), else a USD / CNY / EUR / HKD pivot
 * (`via: 'A*B'`, `time`: the older row). CNY pairs use the 120 中间价 ('中间价'), falling back to
 * offshore CNH ('离岸'); an explicit CNH uses 133 only; everything else the 119 crosses ('国际').
 * Currencies missing from every list throw 没有 B/Q 的汇率数据（不支持的货币：X）.
 */
export function crossRate(table, base, quote) {
    const b = currencyCode(base), q = currencyCode(quote);
    if (!(table instanceof Map) || !table.size) throw new Error(_("Invalid exchange rate list"));
    const known = knownCurrencies(table);
    for (const code of [b, q]) if (!known.has(code)) throw new Error(format(_("No exchange rate for {base}/{quote} (unsupported currency: {code})"), {base: b, quote: q, code: code}));
    const direct = lookup(table, b, q);
    if (direct) return direct;
    for (const pivot of ['USD', 'CNY', 'EUR', 'HKD']) {
        if (pivot === b || pivot === q) continue;
        const first = lookup(table, b, pivot), second = lookup(table, pivot, q);
        if (first && second) return {rate: first.rate * second.rate, via: `${first.via}*${second.via}`, source: first.source === second.source ? first.source : `${first.source}·${second.source}`, time: olderTime(first.time, second.time)};
    }
    throw new Error(format(_("No exchange rate for {base}/{quote}"), {base: b, quote: q}));
}
/** Display helper: 3 (docked) or 5 (undocked) fraction digits; rates below 0.01 keep 6 significant digits. */
export function formatRate(rate, maxFractionDigits = 3) {
    if (!Number.isFinite(rate)) return '—';
    if (rate !== 0 && Math.abs(rate) < 0.01) return formatNumber(rate, {maximumSignificantDigits: 6});
    return formatNumber(rate, {maximumFractionDigits: maxFractionDigits});
}
