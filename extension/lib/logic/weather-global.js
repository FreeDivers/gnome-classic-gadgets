// SPDX-License-Identifier: MIT
import {_, getLanguage} from '../i18n.js';
// Open-Meteo data is normalized to the existing weather skin's data model.
import {weatherDescription} from '../core.js';
import {jsonObject, parseIpwhoRegion, parseIpapiRegion} from './network-region.js';

const str = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function coordinates(latitude, longitude) {
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error(_("Invalid latitude or longitude"));
    return {latitude, longitude};
}
export function coordinateLabel(latitude, longitude) { return `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`; }
export function openMeteoUrl(latitude, longitude) {
    coordinates(latitude, longitude);
    return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto&wind_speed_unit=ms`;
}
export function geocodingUrl(query) {
    const name = str(query).slice(0, 80);
    if (!name) throw new Error(_("Enter a city name"));
    return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=${getLanguage()}&format=json`;
}
// WMO codes are NOT CMA codes. Translate before using original CMA artwork.
export function wmoToCma(code) {
    if (!Number.isInteger(code)) throw new Error(_("Invalid Open-Meteo weather code"));
    const codes = {0: 0, 1: 1, 2: 1, 3: 2, 45: 18, 48: 18, 51: 7, 53: 7, 55: 7, 56: 19, 57: 19,
        61: 7, 63: 8, 65: 9, 66: 19, 67: 19, 71: 14, 73: 15, 75: 16, 77: 13, 80: 3, 81: 3, 82: 3, 85: 13, 86: 13, 95: 4, 96: 5, 99: 5};
    return codes[code] ?? null;
}
export function parseOpenMeteo(value, location = {}) {
    const data = jsonObject(value, 'Open-Meteo'), current = data.current, daily = data.daily;
    if (data.error) throw new Error(_("Open-Meteo cannot currently provide weather for this location"));
    const temperature = num(current?.temperature_2m);
    if (temperature === null || temperature < -100 || temperature > 65 || ![0, 1].includes(current?.is_day)) throw new Error(_("Open-Meteo is missing the current weather"));
    const currentCode = wmoToCma(current.weather_code);
    if (!Array.isArray(daily?.time)) throw new Error(_("Open-Meteo is missing the forecast"));
    const days = daily.time.slice(0, 7).map((date, i) => {
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(_("Invalid Open-Meteo forecast date"));
        const code = daily.weather_code?.[i], cmaCode = wmoToCma(code);
        return {date, high: num(daily.temperature_2m_max?.[i]), low: num(daily.temperature_2m_min?.[i]),
            dayCode: cmaCode, nightCode: cmaCode, dayText: weatherDescription(code)[0], nightText: weatherDescription(code)[0]};
    });
    if (!days.length) throw new Error(_("Open-Meteo is missing the forecast"));
    const {latitude, longitude} = coordinates(data.latitude, data.longitude);
    const offset = num(data.utc_offset_seconds);
    if (offset === null || Math.abs(offset) > 14 * 3600 || !str(current.time)) throw new Error(_("Invalid Open-Meteo weather time zone or time"));
    return {station: '', name: str(location.city || location.name) || coordinateLabel(latitude, longitude), path: [], latitude, longitude,
        timezone: offset / 3600, timezoneName: str(data.timezone), temperature, humidity: num(current.relative_humidity_2m), windSpeed: num(current.wind_speed_10m),
        updated: str(current.time), currentCode, currentText: weatherDescription(current.weather_code)[0], isDay: current.is_day === 1, days};
}
export function parseGeocoding(value) {
    const data = jsonObject(value, _("Open-Meteo city search"));
    if (data.error || (data.results !== undefined && !Array.isArray(data.results))) throw new Error(_("The city search service returned invalid data"));
    return (data.results ?? []).flatMap(row => {
        if (!Number.isInteger(row?.id) || !str(row.name)) return [];
        try { coordinates(row.latitude, row.longitude); } catch { return []; }
        const country = str(row.country), admin = str(row.admin1);
        return [{id: String(row.id), station: '', name: str(row.name), latitude: row.latitude, longitude: row.longitude,
            country, countryCode: str(row.country_code), timezoneName: str(row.timezone), detail: [country, admin, row.id].filter(Boolean).join(' · ')}];
    }).slice(0, 10);
}
export function reverseGeocodingUrl(latitude, longitude) {
    coordinates(latitude, longitude);
    return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=${getLanguage()}`;
}
export function parseReverseGeocoding(value) {
    const data = jsonObject(value, 'OpenStreetMap'), address = data.address;
    const name = str(address?.city || address?.town || address?.village || address?.municipality || address?.county || address?.state);
    if (data.error || !name) throw new Error(_("No city found near these coordinates"));
    return name;
}
function ipLocation(data) {
    const {latitude, longitude} = coordinates(data.latitude, data.longitude);
    return {station: '', name: str(data.city || data.region) || coordinateLabel(latitude, longitude), latitude, longitude,
        method: _("Approximate IP location (may be the network exit city)")};
}
export function parseIpwhoLocation(value) {
    const data = jsonObject(value, 'ipwho.is'); parseIpwhoRegion(data);
    return ipLocation(data);
}
export function parseIpapiLocation(value) {
    const data = jsonObject(value, 'ipapi.co'); parseIpapiRegion(data);
    return ipLocation(data);
}
