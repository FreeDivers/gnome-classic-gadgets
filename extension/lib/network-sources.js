// SPDX-License-Identifier: MIT
import {_} from './i18n.js';
// Shared, per-enable provider selection. Pure JS with an injected Network/owner,
// so routing, startup ordering and cancellation can be tested without GNOME.
import {httpsUrl, parseFeed} from './core.js';
import {detectNetworkRegion, regionStatus, requireAlive, ownerAlive, IPWHO_URL, IPAPI_URL} from './logic/network-region.js';
import {cmaUrls, CMA_HEADERS, WCC_HEADERS, wgeoUrl, parseWgeo, parseCmaAutocomplete, parseCmaMap, parseCmaView,
    nearestStation, matchStation, provinceFallback, autoLabel} from './logic/weather-cn.js';
import {forexUrls, parseForexList, buildRateTable, crossRate, currencyCode, quoteTimeLabel,
    normalizeStockInput, suggestUrl, pickSuggest, ulistUrl, parseUlist} from './logic/finance-cn.js';
import {coordinates, coordinateLabel, openMeteoUrl, parseOpenMeteo, geocodingUrl, parseGeocoding,
    reverseGeocodingUrl, parseReverseGeocoding, parseIpwhoLocation, parseIpapiLocation} from './logic/weather-global.js';
import {frankfurterUrl, parseFrankfurter, yahooInput, yahooChartUrl, parseYahooChart, yahooSearchUrl, parseYahooSearch} from './logic/finance-global.js';

export const SOURCE_PROFILES = Object.freeze({
    mainland: Object.freeze({
        weather: {get name() { return _("China Meteorological Administration"); }, url: 'https://weather.cma.cn/'},
        currency: {get name() { return _("Eastmoney · Reference exchange rates"); }, url: 'https://quote.eastmoney.com/center/wh.html'},
        stocks: {get name() { return _("Eastmoney"); }, url: 'https://quote.eastmoney.com/'},
        rss: {get name() { return _("IT Home · RSS"); }, url: 'https://www.ithome.com/rss/'},
    }),
    global: Object.freeze({
        weather: {name: 'Open-Meteo', url: 'https://open-meteo.com/'},
        currency: {get name() { return _("Frankfurter · ECB reference rates"); }, url: 'https://frankfurter.dev/'},
        stocks: {name: 'Yahoo Finance', url: 'https://finance.yahoo.com/'},
        rss: {name: 'BBC News · RSS', url: 'https://feeds.bbci.co.uk/news/world/rss.xml'},
    }),
});
export class NetworkSources {
    constructor(network, owner, {previous = '', onDetected = null} = {}) {
        this.network = network; this.owner = owner;
        this.status = {state: 'detecting'};
        // A fresh probe runs on EVERY enable, even when a last-successful choice exists.
        this.ready = detectNetworkRegion(network, owner, previous).then(status => {
            this.status = status;
            if (status.state === 'detected' && ownerAlive(owner)) {
                try { onDetected?.(status.region); } catch { /* Saving a fallback choice must not break a live selection. */ }
            }
            return status;
        });
    }
    get mainland() { return this.status.region !== 'global'; }
    get description() { return regionStatus(this.status); }
    async wait(scope) { await this.ready; requireAlive(this.owner); requireAlive(scope); }
    source(type, options = {}) {
        if (type === 'rss' && options.autoSource === false) return {name: _("Custom RSS / Atom"), url: httpsUrl(options.url)};
        return SOURCE_PROFILES[this.mainland ? 'mainland' : 'global'][type];
    }
    feedUrl(options) { return this.source('rss', options).url; }
    async feed(options, scope, force = false) {
        await this.wait(scope);
        return this.network.get(this.feedUrl(options), parseFeed, scope, 900, force);
    }
    async weather(options, scope, force = false) {
        await this.wait(scope);
        if (this.mainland) {
            const station = options.station || (await this.locationFromCoordinates(scope, Number(options.latitude), Number(options.longitude))).station;
            const result = await this.network.get(cmaUrls.view(station), parseCmaView, scope, 600, force, {headers: CMA_HEADERS});
            const data = result.value;
            const optionPatch = {station: data.station, coordinateStation: data.station};
            if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude) &&
                (options.coordinateStation !== data.station || !Number.isFinite(options.latitude) || !Number.isFinite(options.longitude)))
                Object.assign(optionPatch, {latitude: data.latitude, longitude: data.longitude});
            if (!options.station && options.cityAuto !== false) optionPatch.city = autoLabel(data);
            return {...result, optionPatch};
        }
        let location = options, optionPatch = {};
        // Older versions saved a CMA station but left the original Shanghai
        // coordinates behind. Resolve its city through the GLOBAL geocoder,
        // rather than silently showing Shanghai weather with another city's label.
        if (options.station && options.coordinateStation !== options.station) {
            const rows = await this.searchLocations(scope, options.city);
            const row = (/^5\d{4}$/.test(options.station) ? rows.find(item => item.countryCode === 'CN') : rows[0]);
            if (!row) throw new Error(_("No matching city found for this station. Search again or enter coordinates in Weather Settings."));
            optionPatch = {latitude: row.latitude, longitude: row.longitude, coordinateStation: options.station};
            location = {...options, ...optionPatch};
        }
        const result = await this.network.get(openMeteoUrl(Number(location.latitude), Number(location.longitude)), text => parseOpenMeteo(text, location), scope, 600, force);
        return {...result, optionPatch};
    }
    async currency(options, scope, force = false) {
        await this.wait(scope);
        const base = currencyCode(options.base), quotes = (Array.isArray(options.quotes) && options.quotes.length ? options.quotes : [options.quote || 'CNY']).slice(0, 3).map(currencyCode);
        if (!this.mainland) {
            const url = frankfurterUrl(base, quotes);
            if (!url) {
                const rates = quotes.map(quote => ({quote, rate: 1, time: null, source: _("Same currency")}));
                return {value: {rates, rate: 1, date: _("No exchange rate needed")}, saved: Date.now(), stale: false};
            }
            return this.network.get(url, text => parseFrankfurter(text, base, quotes), scope, 3600, force);
        }
        const urls = forexUrls(), currencies = [base, ...quotes];
        const order = currencies.includes('CNH') ? [133, 119, 120] : currencies.includes('CNY') ? [120, 119, 133] : [119, 120, 133];
        const results = []; let lastError;
        for (const market of order) {
            requireAlive(scope);
            try {
                results.push(await this.network.get(urls[market], parseForexList, scope, 3600, force));
                const table = buildRateTable(results.map(result => result.value));
                const rates = quotes.map(quote => ({quote, ...crossRate(table, base, quote)}));
                return {value: {rates, rate: rates[0].rate, date: quoteTimeLabel(rates[0].time)}, saved: Math.min(...results.map(result => result.saved)), stale: results.some(result => result.stale)};
            } catch (e) { lastError = e; requireAlive(scope); }
        }
        throw lastError;
    }
    validateStock(input) { return this.mainland ? normalizeStockInput(input) : yahooInput(input); }
    async stocks(symbols, scope, force = false) {
        await this.wait(scope);
        if (this.mainland) {
            const resolutions = await Promise.all(symbols.map(async input => {
                const parsed = normalizeStockInput(input); if (parsed.secid) return parsed.secid;
                return (await this.network.get(suggestUrl(parsed.query), text => pickSuggest(text, input), scope, 86400, false)).value.secid;
            }));
            requireAlive(scope);
            return this.network.get(ulistUrl(resolutions), parseUlist, scope, 600, force);
        }
        const results = [];
        // Bounded list, sequential requests: avoid a burst of ten Yahoo connections.
        for (const input of symbols.slice(0, 10)) {
            requireAlive(scope);
            const parsed = yahooInput(input);
            const symbol = parsed.symbol ?? (await this.network.get(yahooSearchUrl(parsed.query), text => parseYahooSearch(text, parsed.query), scope, 86400, false)).value;
            let result;
            try { result = await this.network.get(yahooChartUrl(symbol), parseYahooChart, scope, 600, force); }
            catch { requireAlive(scope); result = await this.network.get(yahooChartUrl(symbol, true), parseYahooChart, scope, 600, force); }
            results.push(result);
        }
        if (!results.length) throw new Error(_("Select a stock symbol"));
        return {value: results.map(result => result.value), saved: Math.min(...results.map(result => result.saved)), stale: results.some(result => result.stale)};
    }
    async stationMap(scope) {
        await this.wait(scope);
        if (!this.mainland) throw new Error(_("The current weather source does not provide a station list"));
        return (await this.network.get(cmaUrls.map, parseCmaMap, scope, 86400, false, {headers: CMA_HEADERS})).value;
    }
    async searchLocations(scope, query) {
        await this.wait(scope);
        if (!this.mainland) return (await this.network.get(geocodingUrl(query), parseGeocoding, scope, 86400)).value;
        const result = await this.network.get(cmaUrls.search(query), parseCmaAutocomplete, scope, 86400, false, {headers: CMA_HEADERS});
        return result.value.map(row => ({...row, detail: `${row.country} · ${row.id}`}));
    }
    async stationDetails(scope, id) {
        await this.wait(scope);
        if (!this.mainland) throw new Error(_("Search for a city or enter coordinates."));
        const data = (await this.network.get(cmaUrls.view(id), parseCmaView, scope, 600, false, {headers: CMA_HEADERS})).value;
        return {...data, name: autoLabel(data)};
    }
    async locationFromCoordinates(scope, latitude, longitude) {
        await this.wait(scope); coordinates(latitude, longitude);
        if (!this.mainland) {
            let name;
            try { name = (await this.network.get(reverseGeocodingUrl(latitude, longitude), parseReverseGeocoding, scope, 86400)).value; }
            catch { requireAlive(scope); name = coordinateLabel(latitude, longitude); }
            return {station: '', name, latitude, longitude, method: _("System location or coordinates")};
        }
        const station = nearestStation(await this.stationMap(scope), latitude, longitude);
        const detail = await this.stationDetails(scope, station.id);
        return {...detail, latitude, longitude, method: _("System location"), distanceKm: station.distanceKm};
    }
    async locateByIp(scope) {
        await this.wait(scope);
        if (!this.mainland) {
            for (const [url, parser] of [[IPWHO_URL, parseIpwhoLocation], [IPAPI_URL, parseIpapiLocation]]) {
                requireAlive(scope);
                try { return (await this.network.get(url, parser, scope, 0, true, {cache: false, timeoutMs: 6000})).value; }
                catch (e) { requireAlive(scope); if (url === IPAPI_URL) throw e; }
            }
        }
        const ip = (await this.network.get(wgeoUrl(), parseWgeo, scope, 0, true, {headers: WCC_HEADERS, cache: false})).value;
        const map = await this.stationMap(scope);
        let selected = null;
        for (const name of [...new Set([ip.district, ip.city, ip.province].filter(Boolean))]) {
            const query = name.replace(/(特别行政区|自治区|省|市|区|县)$/u, '');
            const rows = await this.searchLocations(scope, query || name);
            selected = matchStation(rows, query || name, {province: ip.province, map});
            if (selected) break;
        }
        selected ??= provinceFallback(map, ip.province);
        if (!selected) throw new Error(_("No station matches the IP location. Search for a city."));
        const detail = await this.stationDetails(scope, selected.id);
        return {...detail, method: _("Approximate IP location (may be the network exit city)")};
    }
}
