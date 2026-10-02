// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Coarse network-region detection only. Never retain the IP or raw response.
// A locale, UI language or time zone is NOT evidence of the user's location.
export const REGION_NAMES = Object.freeze({get mainland() { return _("Mainland China"); }, get global() { return _("Outside mainland China"); }});
export const IPIP_URL = 'https://myip.ipip.net/json';
export const IPWHO_URL = 'https://ipwho.is/';
export const IPAPI_URL = 'https://ipapi.co/json/';
export const REGION_TIMEOUT_MS = 4000;

export function jsonObject(value, source) {
    let data = value;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { throw new Error(format(_("{source} returned non-JSON content"), {source: source})); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(format(_("{source} returned invalid data"), {source: source}));
    return data;
}
const text = value => typeof value === 'string' ? value.trim() : '';
// Some IP services report country=CN with a separate HK/MO/TW region.
function outsideMainland(value) {
    const s = text(value).toLowerCase().replace(/[\s_.-]/g, '');
    if (s === 'hk' || /^(?:hongkong|(?:中国|中國)?香港)/u.test(s)) return 'HK';
    if (s === 'mo' || /^(?:macao|macau|(?:中国|中國)?澳门|(?:中国|中國)?澳門)/u.test(s)) return 'MO';
    if (s === 'tw' || /^(?:taiwan|(?:中国|中國)?台湾|(?:中国|中國)?臺灣)/u.test(s)) return 'TW';
    return null;
}
const COUNTRY_CODES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
export function regionForCountry(country, subdivision = '') {
    const code = text(country).toUpperCase();
    // ZZ/XX are commonly returned for unknown/reserved addresses, not countries.
    if (!COUNTRY_CODES.has(code)) throw new Error(_("The location service did not return a valid country or region"));
    const special = outsideMainland(subdivision);
    const countryCode = code === 'CN' && special ? special : code;
    return {region: countryCode === 'CN' ? 'mainland' : 'global', countryCode};
}
export function parseIpipRegion(value) {
    const data = jsonObject(value, 'IPIP');
    const location = data.data?.location;
    if (data.ret !== 'ok' || !Array.isArray(location)) throw new Error(_("IPIP location lookup failed"));
    const country = text(location[0]), province = text(location[1]);
    if (!country || /未知|保留|局域网|本机|内网|未分配|unknown|reserved|private|iana|^[\d.]+$/i.test(country)) throw new Error(_("IPIP did not return a country or region"));
    const special = [country, province, ...location.slice(2, 4)].map(outsideMainland).find(Boolean);
    if (special) return regionForCountry(special);
    if (/^(?:中国(?:大陆|内地)?|中國(?:大陸|內地)?|中华人民共和国|中華人民共和國|china(?: mainland)?|mainland china|people's republic of china|cn)$/i.test(country)) return regionForCountry('CN');
    // The IPIP country field is a country name, usually Chinese, not an ISO code.
    if (!/^[\p{L}\p{M} .()（）'-]{2,80}$/u.test(country)) throw new Error(_("Invalid IPIP country or region"));
    return /^[a-z]{2}$/i.test(country) ? regionForCountry(country) : {region: 'global', countryCode: null};
}
export function parseIpwhoRegion(value) {
    const data = jsonObject(value, 'ipwho.is');
    if (data.success !== true) throw new Error(_("ipwho.is location lookup failed"));
    return regionForCountry(data.country_code, data.region);
}
export function parseIpapiRegion(value) {
    const data = jsonObject(value, 'ipapi.co');
    if (data.error) throw new Error(_("ipapi.co location lookup failed"));
    return regionForCountry(data.country_code, data.region);
}
export const REGION_PROBES = Object.freeze([
    {url: IPIP_URL, parse: parseIpipRegion, name: 'IPIP'},
    {url: IPWHO_URL, parse: parseIpwhoRegion, name: 'ipwho.is'},
    {url: IPAPI_URL, parse: parseIpapiRegion, name: 'ipapi.co'},
]);
export function ownerAlive(owner) { return owner?.alive === true && !owner.cancellable?.is_cancelled?.(); }
export function requireAlive(owner) { if (!ownerAlive(owner)) throw new Error(_("Request cancelled")); }

export async function detectNetworkRegion(network, owner, previous = '') {
    for (const probe of REGION_PROBES) {
        if (!ownerAlive(owner)) return {state: 'cancelled'};
        try {
            const result = await network.get(probe.url, probe.parse, owner, 0, true, {cache: false, timeoutMs: REGION_TIMEOUT_MS});
            if (!ownerAlive(owner)) return {state: 'cancelled'};
            return {...result.value, state: 'detected', source: probe.name};
        } catch { /* A failed/limited service is unknown, never evidence of being abroad. */ }
    }
    if (!ownerAlive(owner)) return {state: 'cancelled'};
    return {region: Object.hasOwn(REGION_NAMES, previous) ? previous : 'mainland', countryCode: null, state: 'fallback',
        source: Object.hasOwn(REGION_NAMES, previous) ? _("Detection failed; using the last result") : _("Detection failed")};
}
export function regionStatus(status) {
    if (status.state === 'detecting') return _("Detecting network region…");
    if (status.state === 'cancelled') return _("Region detection cancelled");
    const name = REGION_NAMES[status.region];
    return status.state === 'detected' ? format(_("Network region: {region} · Approximate IP location{country}"), {region: name, country: status.countryCode ? format(_(' ({value})'), {value: status.countryCode}) : ''}) : format(_("Network region: {region} · {source}"), {region: name, source: status.source});
}
