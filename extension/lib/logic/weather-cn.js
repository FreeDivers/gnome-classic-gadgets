// SPDX-License-Identifier: MIT
import {N_, _, format} from '../i18n.js';
// Pure parsing/mapping logic for the China Meteorological Administration
// (weather.cma.cn) and 中国天气网 (wgeo.weather.com.cn / d1.weather.com.cn)
// services — see build/specs/data-apis.md §2–§5 and §10.
//
// NO GI IMPORTS ALLOWED in lib/logic/: this module is unit-tested under Node
// (tests/logic-weather-cn.test.js). Every parser accepts the raw response text
// (what Network.get passes) or an already-parsed object (what tests pass) and
// throws an Error with a Chinese message on anything unexpected. Parsers are
// defensive in the same way as core.js: missing optional fields become null or
// '', never NaN or undefined.

const STATION_ID = /^[0-9A-Za-z][0-9A-Za-z_-]{2,11}$/;
const CMA_DATE = /^\d{4}\/\d{2}\/\d{2}$/;
const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Request headers 中国天气网 insists on (design.md §1). The cache key stays the URL. */
export const CMA_HEADERS = Object.freeze({'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ClassicDesktopGadgets/2.1', Referer: 'https://weather.cma.cn/'});
export const WCC_HEADERS = Object.freeze({Referer: 'http://www.weather.com.cn/'});

// --- small helpers ---------------------------------------------------------------------
function str(value) { return typeof value === 'string' ? value.trim() : ''; }
function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function int(value) { return Number.isInteger(value) ? value : null; }
function numText(value) { const text = String(value ?? '').trim(); const n = Number(text); return text !== '' && Number.isFinite(n) ? n : null; }
function intText(value) { const n = parseInt(String(value ?? ''), 10); return Number.isFinite(n) ? n : null; }
function levelOf(row) { return Number.isFinite(row?.level) ? row.level : 9; }
function wind(direction, scale) { return [str(direction), str(scale)].filter(Boolean).join(' '); }
function asObject(value, source) {
    let data = value;
    if (typeof value === 'string') {
        try { data = JSON.parse(value); } catch { throw new Error(format(_("{source} returned non-JSON content"), {source: source})); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(format(_("{source} returned non-JSON content"), {source: source}));
    return data;
}
/** CMA envelope `{msg, code, data}` → data (only code === 0 is a success). */
function cmaData(value) {
    const envelope = asObject(value, _("China Meteorological Administration"));
    if (envelope.code !== 0) throw new Error(format(_("CMA API error (code={code}, {error})"), {code: envelope.code ?? '?', error: str(envelope.msg) || _("Unknown error")}));
    return envelope.data;
}

// --- URLs -------------------------------------------------------------------------------
/** Hour bucket for the site's own cache-buster parameter: never put Date.now() into a cached URL (data-apis.md §0). */
export function hourBucket(now = Date.now()) { return Math.floor(now / 3600000); }
export function validStationId(id) {
    const value = str(id);
    if (!STATION_ID.test(value)) throw new Error(format(_("Invalid station ID: {id}"), {id: value || _("(empty)")}));
    return value;
}
export function searchQuery(query) {
    const value = str(query).slice(0, 30);
    if (!value) throw new Error(_("Enter a station name"));
    return value;
}
export const cmaUrls = Object.freeze({
    view: id => `https://weather.cma.cn/api/weather/view?stationid=${encodeURIComponent(validStationId(id))}`,
    now: id => `https://weather.cma.cn/api/now/${encodeURIComponent(validStationId(id))}`,
    search: query => `https://weather.cma.cn/api/autocomplete?q=${encodeURIComponent(searchQuery(query))}`,
    map: 'https://weather.cma.cn/api/map/weather/1',
});
export function wgeoUrl(now = Date.now()) { return `https://wgeo.weather.com.cn/ip/?_=${hourBucket(now)}`; }
export function wccCityUrl(id, kind = 'sk', now = Date.now()) {
    const city = str(id);
    if (!/^\d{9}$/.test(city)) throw new Error(format(_("Invalid weather.com.cn city ID: {id}"), {id: city || _("(empty)")}));
    const path = {sk: 'sk_2d', index: 'weather_index'}[kind];
    if (!path) throw new Error(format(_("Unknown weather.com.cn data type: {type}"), {type: kind}));
    return `https://d1.weather.com.cn/${path}/${city}.html?_=${hourBucket(now)}`;
}

// --- CMA view / now ---------------------------------------------------------------------
function parseLocation(location) {
    if (!location || typeof location !== 'object') throw new Error(_("Weather data is missing station information"));
    const id = str(location.id), name = str(location.name);
    if (!STATION_ID.test(id) || !name) throw new Error(_("Weather data is missing station information"));
    const latitude = num(location.latitude), longitude = num(location.longitude);
    return {
        station: id, name, path: str(location.path).split(/\s*,\s*/).filter(Boolean),
        latitude: latitude !== null && Math.abs(latitude) <= 90 ? latitude : null,
        longitude: longitude !== null && Math.abs(longitude) <= 180 ? longitude : null,
        timezone: num(location.timezone),
    };
}
function parseNow(now) {
    const temperature = num(now?.temperature);
    if (temperature === null || temperature < -90 || temperature > 60) throw new Error(_("Weather data is missing the current temperature"));
    return {
        temperature, feelsLike: num(now.feelst), humidity: num(now.humidity), pressure: num(now.pressure), precipitation: num(now.precipitation),
        windDirection: str(now.windDirection), windDirectionDegree: num(now.windDirectionDegree), windSpeed: num(now.windSpeed), windScale: str(now.windScale),
    };
}
function parseDay(day) {
    if (!day || typeof day !== 'object' || !CMA_DATE.test(str(day.date))) return null;
    return {
        date: str(day.date), high: num(day.high), low: num(day.low),
        dayCode: int(day.dayCode), dayText: str(day.dayText), nightCode: int(day.nightCode), nightText: str(day.nightText),
        dayWindDirection: str(day.dayWindDirection), dayWindScale: str(day.dayWindScale), nightWindDirection: str(day.nightWindDirection), nightWindScale: str(day.nightWindScale),
        dayWind: wind(day.dayWindDirection, day.dayWindScale), nightWind: wind(day.nightWindDirection, day.nightWindScale),
    };
}
/**
 * `view?stationid=` → {station, name, path[], latitude, longitude, timezone, temperature, feelsLike,
 * humidity, pressure, precipitation, windDirection, windDirectionDegree, windSpeed (m/s), windScale,
 * updated, jieQi, alarms, days[≤7]}. days[0] is today; the current condition is days[0].dayCode/
 * dayText by day and nightCode/nightText by night (`now` carries no condition code).
 */
export function parseCmaView(value) {
    const data = cmaData(value);
    if (!data || typeof data !== 'object') throw new Error(_("Weather data is missing station information"));
    const location = parseLocation(data.location);
    if (!Array.isArray(data.daily) || !data.daily.length) throw new Error(_("Weather data is missing the forecast"));
    const days = data.daily.map(parseDay).filter(Boolean).slice(0, 7);
    if (!days.length) throw new Error(_("Weather data is missing the forecast"));
    return {...location, ...parseNow(data.now), updated: str(data.lastUpdate), jieQi: str(data.jieQi), alarms: Array.isArray(data.alarm) ? data.alarm.length : 0, days};
}
/** `now/<id>` (optional endpoint) → the `now` part of parseCmaView without coordinates or forecast. */
export function parseCmaNow(value) {
    const data = cmaData(value);
    if (!data || typeof data !== 'object') throw new Error(_("Weather data is missing station information"));
    const {station, name, path} = parseLocation(data.location);
    return {station, name, path, ...parseNow(data.now), updated: str(data.lastUpdate), jieQi: str(data.jieQi)};
}
/** `autocomplete?q=` rows `"id|name|pinyin|country"` → [{id, name, pinyin, country}] (≤50, malformed rows dropped, [] is valid). */
export function parseCmaAutocomplete(value) {
    const data = cmaData(value);
    if (!Array.isArray(data)) throw new Error(_("Invalid station search results"));
    const rows = [];
    for (const row of data) {
        if (typeof row !== 'string') continue;
        const [id = '', name = '', pinyin = '', country = ''] = row.split('|').map(part => part.trim());
        if (!STATION_ID.test(id) || !name) continue;
        rows.push({id, name, pinyin, country});
        if (rows.length === 50) break;
    }
    return rows;
}
/** `map/weather/1` (318 KB, 2440 rows) → compact [{id, name, country, level, latitude, longitude, province}]. */
export function parseCmaMap(value, {minRows = 1000} = {}) {
    const data = cmaData(value);
    if (!Array.isArray(data?.city)) throw new Error(_("Invalid station list"));
    const rows = [];
    for (const row of data.city) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const id = str(row[0]), name = str(row[1]), latitude = num(row[4]), longitude = num(row[5]);
        if (!STATION_ID.test(id) || !name || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
        rows.push({id, name, country: str(row[2]) || '中国', level: int(row[3]) ?? 9, latitude, longitude, province: row.slice(15).map(str).find(code => /^A[A-Z]{2}$/.test(code)) ?? ''});
    }
    if (rows.length < minRows) throw new Error(_("Incomplete station list"));
    return rows;
}

// --- geography --------------------------------------------------------------------------
export function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/**
 * Closest station of a parseCmaMap() list → {...row, distanceKm}. Throws when the closest one is
 * farther than maxKm. Among stations within tieKm of the closest the smallest `level` wins, so
 * 北京 (level 0, 11.7 km) beats 朝阳 (level 3, 10.2 km) for the city centre.
 */
export function nearestStation(list, latitude, longitude, {maxKm = 300, tieKm = 3} = {}) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error(_("Invalid coordinates"));
    if (!Array.isArray(list) || !list.length) throw new Error(_("The station list is empty"));
    let nearest = null;
    const ranked = [];
    for (const row of list) {
        if (!Number.isFinite(row?.latitude) || !Number.isFinite(row?.longitude)) continue;
        const entry = {row, distanceKm: haversineKm(latitude, longitude, row.latitude, row.longitude)};
        ranked.push(entry);
        if (!nearest || entry.distanceKm < nearest.distanceKm) nearest = entry;
    }
    if (!nearest) throw new Error(_("The station list is empty"));
    if (nearest.distanceKm > maxKm) throw new Error(format(_("No CMA station nearby (nearest: {station}, {distance} km away). Search manually."), {station: nearest.row.name, distance: Math.round(nearest.distanceKm)}));
    const candidates = ranked.filter(entry => entry.distanceKm <= nearest.distanceKm + tieKm);
    candidates.sort((a, b) => (levelOf(a.row) - levelOf(b.row)) || (a.distanceKm - b.distanceKm));
    return {...candidates[0].row, distanceKm: candidates[0].distanceKm};
}

/** CMA map province code (`row[16]`) by Chinese province name / prefix (data-apis.md §2.5). */
export const PROVINCE_CODES = Object.freeze({
    安徽: 'AAH', 澳门: 'AAM', 北京: 'ABJ', 重庆: 'ACQ', 福建: 'AFJ', 广东: 'AGD', 甘肃: 'AGS', 广西: 'AGX', 贵州: 'AGZ', 河南: 'AHA', 湖北: 'AHB', 河北: 'AHE',
    海南: 'AHI', 黑龙江: 'AHL', 湖南: 'AHN', 吉林: 'AJL', 江苏: 'AJS', 江西: 'AJX', 辽宁: 'ALN', 内蒙古: 'ANM', 宁夏: 'ANX', 青海: 'AQH', 四川: 'ASC', 山东: 'ASD',
    上海: 'ASH', 陕西: 'ASN', 山西: 'ASX', 天津: 'ATJ', 台湾: 'ATW', 香港: 'AXG', 新疆: 'AXJ', 西藏: 'AXZ', 云南: 'AYN', 浙江: 'AZJ',
});
export function provinceCode(name) {
    const value = str(name);
    if (!value) return null;
    for (const [province, code] of Object.entries(PROVINCE_CODES)) if (value.startsWith(province)) return code;
    return null;
}
/** Map id → row for a parseCmaMap() list. */
export function stationIndex(map) { return new Map((Array.isArray(map) ? map : []).map(row => [row.id, row])); }
/**
 * IP chain step 2/3 (data-apis.md §5.2): autocomplete rows for `name` → the exact match; several
 * exact matches (朝阳) are disambiguated with the map (`province` name of the user, then smallest
 * level); otherwise the first row whose name starts with `name`; null when nothing fits.
 */
export function matchStation(rows, name, {province = '', map = null} = {}) {
    const target = str(name);
    if (!target || !Array.isArray(rows)) return null;
    const exact = rows.filter(row => str(row?.name) === target);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
        const index = map instanceof Map ? map : stationIndex(map);
        const code = provinceCode(province);
        const rank = row => { const detail = index.get(row.id); return [code && detail?.province === code ? 0 : 1, levelOf(detail)]; };
        return [...exact].sort((a, b) => { const [pa, la] = rank(a), [pb, lb] = rank(b); return (pa - pb) || (la - lb); })[0];
    }
    return rows.find(row => str(row?.name).startsWith(target)) ?? null;
}
/** Province-level fallback (municipalities: the map has no station named 上海) → most important station of that province or null. */
export function provinceFallback(map, province) {
    const code = provinceCode(province);
    if (!code || !Array.isArray(map)) return null;
    return map.filter(row => row.province === code && levelOf(row) <= 1).sort((a, b) => levelOf(a) - levelOf(b))[0] ?? null;
}

// --- 中国天气网 ---------------------------------------------------------------------------
/** `wgeo …/ip/` → {ip, id, addr: [省, 市, 区], province, city, district}. The 9-digit id is 中国天气网's own city id, not a CMA station. */
export function parseWgeo(text) {
    if (typeof text !== 'string' || text.length > 2048 || text.includes('<')) throw new Error(_("The IP location service returned unexpected content"));
    const ip = /var\s+ip\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? '';
    const id = /var\s+id\s*=\s*"(\d{9})"/.exec(text)?.[1];
    const addrMatch = /var\s+addr\s*=\s*"([^"]*)"/.exec(text);
    if (!id || !addrMatch) throw new Error(_("Cannot read the city from the IP location result"));
    if (addrMatch[1].includes('�')) throw new Error(_("Invalid encoding in the response"));
    const addr = addrMatch[1].split(/[,，]/).map(part => part.trim());
    while (addr.length < 3) addr.push('');
    const [province, city, district] = addr;
    if (!province && !city && !district) throw new Error(_("IP location did not return a city. Search for a station manually."));
    return {ip, id, addr: addr.slice(0, 3), province, city: city || province, district};
}
/** Extracts `var <name> = {…};` from a d1.weather.com.cn script with brace matching (the objects nest). */
function extractVar(text, name) {
    if (typeof text !== 'string') throw new Error(_("Invalid weather.com.cn data format"));
    if (text.length > 65536) throw new Error(_("The weather.com.cn response is too large"));
    const match = new RegExp(`var\\s+${name}\\s*=\\s*`).exec(text);
    if (!match) throw new Error(format(_("The weather.com.cn response is missing {field}"), {field: name}));
    const start = match.index + match[0].length;
    if (text[start] !== '{') throw new Error(_("Invalid weather.com.cn data format"));
    let depth = 0, inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch { throw new Error(_("Invalid weather.com.cn data format")); }
        }
    }
    throw new Error(_("Invalid weather.com.cn data format"));
}
/** `d00` / `n0` → {night, code} or null. */
export function parseWccCode(value) {
    const match = /^([dn])(\d{1,3})$/.exec(str(value));
    return match ? {night: match[1] === 'n', code: Number(match[2])} : null;
}
function liveFrom(data) {
    if (!data || typeof data !== 'object') throw new Error(_("Invalid weather.com.cn data format"));
    const temperature = numText(data.temp);
    if (temperature === null) throw new Error(_("The weather.com.cn observation is missing the temperature"));
    if (str(data.cityname).includes('�') || str(data.weather).includes('�')) throw new Error(_("Invalid encoding in the response"));
    const code = parseWccCode(data.weathercode);
    return {
        cityId: str(data.city), name: str(data.cityname), pinyin: str(data.nameen), temperature, temperatureF: numText(data.tempf),
        windDirection: str(data.WD), windCompass: str(data.wde), windScale: str(data.WS), windSpeedKmh: intText(data.wse),
        humidity: intText(data.SD), pressure: numText(data.qy), visibilityKm: intText(data.njd), rain: numText(data.rain), rain24h: numText(data.rain24h),
        aqi: numText(data.aqi), pm25: numText(data.aqi_pm25), text: str(data.weather), textEn: str(data.weathere),
        code: code?.code ?? null, night: code?.night ?? null, time: str(data.time), date: str(data.date),
    };
}
/** `sk_2d/<id>.html` live observation (has a real current condition code, which CMA lacks). */
export function parseWccSk(text) { return liveFrom(extractVar(text, 'dataSK')); }
/** `weather_index/<id>.html` bundle → {city, today, live, days, indices, alarms}. */
export function parseWccIndex(text) {
    const cityDZ = extractVar(text, 'cityDZ'), fc = extractVar(text, 'fc');
    const optional = (name, pick) => { try { return pick(extractVar(text, name)); } catch { return null; } };
    const alarms = optional('alarmDZ', alarm => (Array.isArray(alarm?.w) ? alarm.w : [])) ?? [];
    const live = optional('dataSK', liveFrom);
    const indices = optional('dataZS', zs => parseIndices(zs?.zs)) ?? {};
    const days = (Array.isArray(fc?.f) ? fc.f : []).filter(day => day && typeof day === 'object').map(day => ({
        date: str(day.fi), label: str(day.fj), dayCode: intText(day.fa), nightCode: intText(day.fb), high: numText(day.fc), low: numText(day.fd),
        dayWind: wind(day.fe, day.fg), nightWind: wind(day.ff, day.fh),
    }));
    if (!days.length) throw new Error(_("The weather.com.cn response is missing the forecast"));
    const info = cityDZ?.weatherinfo && typeof cityDZ.weatherinfo === 'object' ? cityDZ.weatherinfo : {};
    const dayCode = parseWccCode(info.weathercode), nightCode = parseWccCode(info.weathercoden);
    return {
        city: str(info.city),
        today: {dayCode: dayCode?.code ?? days[0].dayCode, nightCode: nightCode?.code ?? days[0].nightCode, high: days[0].high, low: days[0].low, text: str(info.weather), wind: wind(info.wd, info.ws), issued: str(info.fctime)},
        live, days, indices, alarms,
    };
}
function parseIndices(zs) {
    const result = {};
    if (!zs || typeof zs !== 'object') return result;
    for (const [key, value] of Object.entries(zs)) {
        const match = /^([a-z]{2})_name$/.exec(key);
        if (match && typeof value === 'string') result[match[1]] = {name: value, hint: str(zs[`${match[1]}_hint`]), desc: str(zs[`${match[1]}_des_s`])};
    }
    return result;
}

// --- weather codes → text / original art / backdrop / forecast icon (data-apis.md §4) ---------
// code → [中文, art, day backdrop, day icon, night icon]. Rows marked in the spec as observed or
// standard; unknown codes fall back to the server text, no art, BLUE and the blank icon 44.
const CODES = new Map([
    [0, [N_("Clear"), 'sun', 'BLUE', 32, 31]], [1, [N_("Partly cloudy"), 'partly-cloudy', 'BLUE', 30, 29]], [2, [N_("Overcast"), 'cloudy', 'GRAY', 26, 26]],
    [3, [N_("Showers"), 'few-showers', 'GRAY', 39, 45]], [4, [N_("Thundershowers"), 'thunderstorm', 'GRAY', 38, 47]], [5, [N_("Thundershowers with hail"), 'hail', 'GRAY', 17, 17]],
    [6, [N_("Sleet"), 'snow', 'GRAY', 5, 5]], [7, [N_("Light rain"), 'rainy', 'GRAY', 9, 9]], [8, [N_("Moderate rain"), 'rainy', 'GRAY', 11, 11]], [9, [N_("Heavy rain"), 'rainy', 'GRAY', 12, 12]],
    [10, [N_("Rainstorm"), 'rainy', 'GRAY', 40, 40]], [11, [N_("Severe rainstorm"), 'rainy', 'GRAY', 40, 40]], [12, [N_("Extreme rainstorm"), 'rainy', 'GRAY', 40, 40]],
    [13, [N_("Snow showers"), 'snow', 'GRAY', 41, 43]], [14, [N_("Light snow"), 'snow', 'GRAY', 13, 13]], [15, [N_("Moderate snow"), 'snow', 'GRAY', 14, 14]], [16, [N_("Heavy snow"), 'snow', 'GRAY', 16, 16]],
    [17, [N_("Blizzard"), 'snow', 'GRAY', 42, 42]], [18, [N_("Fog"), 'foggy', 'GRAY', 20, 20]], [19, [N_("Freezing rain"), 'hail', 'GRAY', 10, 10]], [20, [N_("Sandstorm"), 'windy', 'BLUE', 24, 24]],
    [21, [N_("Light to moderate rain"), 'rainy', 'GRAY', 11, 11]], [22, [N_("Moderate to heavy rain"), 'rainy', 'GRAY', 12, 12]], [23, [N_("Heavy rain to rainstorm"), 'rainy', 'GRAY', 40, 40]],
    [24, [N_("Rainstorm to severe rainstorm"), 'rainy', 'GRAY', 40, 40]], [25, [N_("Severe to extreme rainstorm"), 'rainy', 'GRAY', 40, 40]], [26, [N_("Light to moderate snow"), 'snow', 'GRAY', 14, 14]],
    [27, [N_("Moderate to heavy snow"), 'snow', 'GRAY', 16, 16]], [28, [N_("Heavy snow to blizzard"), 'snow', 'GRAY', 42, 42]], [29, [N_("Floating dust"), 'foggy', 'GRAY', 19, 19]], [30, [N_("Blowing sand"), 'foggy', 'GRAY', 19, 19]],
    [31, [N_("Severe sandstorm"), 'windy', 'BLUE', 24, 24]], [32, [N_("Dense fog"), 'foggy', 'GRAY', 20, 20]], [33, [N_("Tornado"), 'thunderstorm', 'GRAY', 3, 3]],
    [49, [N_("Very dense fog"), 'foggy', 'GRAY', 20, 20]], [53, [N_("Haze"), 'foggy', 'GRAY', 21, 21]], [54, [N_("Moderate haze"), 'foggy', 'GRAY', 21, 21]], [55, [N_("Heavy haze"), 'foggy', 'GRAY', 21, 21]],
    [56, [N_("Severe haze"), 'foggy', 'GRAY', 21, 21]], [57, [N_("Heavy fog"), 'foggy', 'GRAY', 20, 20]], [58, [N_("Extremely dense fog"), 'foggy', 'GRAY', 20, 20]],
    [301, [N_("Rain"), 'rainy', 'GRAY', 12, 12]], [302, [N_("Snow"), 'snow', 'GRAY', 16, 16]],
]);
const UNKNOWN_ICON = 44;
function codeEntry(code) { return CODES.get(typeof code === 'string' ? Number(code) : code) ?? null; }
/** Chinese text for a CMA/中国天气网 code ('未知' when unknown); prefer the server's dayText/nightText when present. */
export function cmaCodeText(code) { const message = codeEntry(code)?.[0]; return message ? _(message) : _("Unknown"); }
/**
 * {art, backdrop, moon}: `art` is the lower-case name for images/docked_<art>.png / undocked_<art>.png
 * (null → hide the layer; also null for clear nights, where only the moon is shown); `backdrop` is
 * 'BLUE' | 'GRAY' | 'BLACK' (BLACK at night); `moon` is true only at night with sun / partly-cloudy.
 */
export function cmaArt(code, isNight = false) {
    const entry = codeEntry(code);
    const art = entry?.[1] ?? null;
    return {art: isNight && art === 'sun' ? null : art, backdrop: isNight ? 'BLACK' : entry?.[2] ?? 'BLUE', moon: Boolean(isNight) && (art === 'sun' || art === 'partly-cloudy')};
}
/** Forecast icon number for images/<n>.png (42×34); 44 is the fully transparent "not available" icon. */
export function cmaIcon(code, isNight = false) {
    const entry = codeEntry(code);
    return entry ? (isNight ? entry[4] : entry[3]) : UNKNOWN_ICON;
}

// --- sun, night, moon (data-apis.md §4.6–§4.7) ----------------------------------------------
function jdToDate(jd) { return new Date((jd - 2440587.5) * 86400000); }
function mod360(value) { return ((value % 360) + 360) % 360; }
/**
 * Sunrise / sunset (Date objects, UTC-based) of the station's local calendar day that contains
 * `date`, from the NOAA-simplified sunrise equation (±3 min). null for polar day/night or bad input.
 */
export function sunTimes(date, latitude, longitude, timezoneHours = 8) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    const tz = Number.isFinite(timezoneHours) ? timezoneHours : 8;
    const local = new Date(date.getTime() + tz * 3600000);
    const midnightJd = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 86400000 + 2440587.5;
    const n = Math.ceil(midnightJd - 2451545 + 0.0008);
    const jStar = n - longitude / 360;
    const m = mod360(357.5291 + 0.98560028 * jStar);
    const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
    const lambda = mod360(m + c + 180 + 102.9372);
    const transit = 2451545 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
    const declination = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));
    const phi = latitude * RAD;
    const cosOmega = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
    if (!(cosOmega >= -1 && cosOmega <= 1)) return null;
    const omega = Math.acos(cosOmega) / RAD;
    return {sunrise: jdToDate(transit - omega / 360), sunset: jdToDate(transit + omega / 360)};
}
/**
 * Night = before sunrise or after sunset of the station's local day when `location` has
 * latitude/longitude (timezone defaults to UTC+8); without coordinates (or in polar regions) the
 * original gadget's 06:30–18:30 defaults apply, in the location's time zone or the machine's.
 */
export function isNightNow(date = new Date(), location = null) {
    const latitude = num(location?.latitude), longitude = num(location?.longitude), timezone = num(location?.timezone);
    if (latitude !== null && longitude !== null) {
        const times = sunTimes(date, latitude, longitude, timezone ?? 8);
        if (times) return date.getTime() < times.sunrise.getTime() || date.getTime() > times.sunset.getTime();
    }
    let minutes;
    if (timezone !== null) { const local = new Date(date.getTime() + timezone * 3600000); minutes = local.getUTCHours() * 60 + local.getUTCMinutes(); }
    else minutes = date.getHours() * 60 + date.getMinutes();
    return minutes < 6 * 60 + 30 || minutes >= 18 * 60 + 30;
}
export const MOON_PHASES = Object.freeze(['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent']);
export const MOON_PHASE_NAMES = Object.freeze({get 'new'() { return _("New moon"); }, get 'waxing-crescent'() { return _("Waxing crescent"); }, get 'first-quarter'() { return _("First quarter"); }, get 'waxing-gibbous'() { return _("Waxing gibbous"); }, get 'full'() { return _("Full moon"); }, get 'waning-gibbous'() { return _("Waning gibbous"); }, get 'last-quarter'() { return _("Last quarter"); }, get 'waning-crescent'() { return _("Waning crescent"); }});
const MOON_BINS = [1.8456618033125, 5.5369854099375, 9.2283090165625, 12.9196326231875, 16.6109562298125, 20.3022798364375, 23.9936034430625, 27.6849270496875];
/** Moon phase name for images/<mode>_moon-<phase>.png — the original computePhaseOfMoon (date-only, local calendar date), lower-cased. */
export function moonPhase(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'full';
    const year = date.getFullYear(), month = date.getMonth() + 1, day = date.getDate();
    const yy = year - Math.trunc((12 - month) / 10);
    let mm = month + 9; if (mm >= 12) mm -= 12;
    const k1 = Math.trunc(365.25 * (yy + 4712));
    const k2 = Math.trunc(30.6 * mm + 0.5);
    const k3 = Math.trunc(Math.trunc(yy / 100 + 49) * 0.75) - 38;
    let j = k1 + k2 + day + 59;
    if (j > 2299160) j -= k3;
    let v = (j - 2451550.1) / 29.530588853;
    v -= Math.trunc(v);
    if (v < 0) v += 1;
    const age = v * 29.53;
    if (age > MOON_BINS[7] || age <= MOON_BINS[0]) return 'new';
    for (let i = 1; i < MOON_BINS.length; i++) if (age <= MOON_BINS[i]) return MOON_PHASES[i];
    return 'full';
}

// --- labels ---------------------------------------------------------------------------------
/**
 * Automatic address label (design.md §8): the last segment of `path` (「南昌」), or `name` when it
 * differs from that segment; with fewer than 2 path segments the name; never empty (station id).
 * Accepts a parseCmaView() result or a raw `data.location` object.
 */
export function autoLabel(view) {
    const location = view?.location && typeof view.location === 'object' ? view.location : view;
    const name = str(location?.name);
    const rawPath = location?.path;
    const path = Array.isArray(rawPath) ? rawPath.map(str).filter(Boolean) : str(rawPath).split(/\s*,\s*/).filter(Boolean);
    const last = path.length >= 2 ? path[path.length - 1] : '';
    if (name && last && name !== last) return name;
    return last || name || str(location?.station ?? location?.id) || _("Unknown location");
}
