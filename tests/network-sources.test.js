// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NetworkSources, SOURCE_PROFILES} from '../extension/lib/network-sources.js';
import {optionsFor} from '../extension/lib/core.js';
import {IPIP_URL, IPWHO_URL, IPAPI_URL} from '../extension/lib/logic/network-region.js';
const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const owner = () => ({alive: true, cancellable: {is_cancelled: () => false}});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const isProbe = url => [IPIP_URL, IPWHO_URL, IPAPI_URL].includes(url);
const rss = '<rss><channel><item><title>Test headline</title><link>https://example.org/news</link></item></channel></rss>';
function response(url) {
    if (url.includes('weather.cma.cn/api/weather/view')) return fixture('cma-view');
    if (url.includes('weather.cma.cn/api/autocomplete')) return {code: 0, data: ['58367|上海|Shanghai|中国']};
    if (url.includes('weather.cma.cn/api/map/weather')) return {code: 0, data: {city: Array.from({length: 1000}, () => ['58367', '上海', '中国', 0, 31.2, 121.4])}};
    if (url.includes('wgeo.weather.com.cn')) return 'var ip="192.0.2.1";var id="101020100";var addr="上海,上海,上海";';
    if (url.includes('push2.eastmoney.com/api/qt/ulist')) return fixture('eastmoney-quotes');
    if (url.includes('push2.eastmoney.com/')) return fixture('forex-cny');
    if (url.includes('api.open-meteo.com/v1/forecast')) return fixture('open-meteo-weather');
    if (url.includes('geocoding-api.open-meteo.com/')) return fixture('open-meteo-cities');
    if (url.includes('nominatim.openstreetmap.org')) return {address: {city: 'London'}};
    if (url.includes('api.frankfurter.dev/')) return fixture('frankfurter');
    if (url.includes('.finance.yahoo.com/v8/finance/chart')) return fixture('yahoo-chart');
    if (url.includes('.finance.yahoo.com/v1/finance/search')) return {quotes: [{symbol: 'AAPL', quoteType: 'EQUITY'}]};
    if (url === IPWHO_URL || url === IPAPI_URL) return {success: true, country_code: 'GB', city: 'London', latitude: 51.5, longitude: -0.1, ip: '192.0.2.1'};
    if (/rss|example.org\/feed/.test(url)) return rss;
    throw new Error(`Unexpected URL ${url}`);
}
function mockNetwork(country = '中国', {gate = null, offline = false} = {}) {
    const calls = [];
    return {calls, async get(url, parser, scope, maxAge, force, options) {
        calls.push({url, maxAge, force, options, scope});
        if (url === IPIP_URL && gate) await gate.promise;
        let raw;
        if (isProbe(url) && offline) throw new Error('offline');
        if (url === IPIP_URL) raw = {ret: 'ok', data: {location: [country, '', '', ''], ip: '192.0.2.1'}};
        else raw = response(url);
        if (!scope.alive) throw new Error('cancelled');
        return {value: parser(typeof raw === 'string' ? raw : JSON.stringify(raw)), saved: 1789280000000, stale: false};
    }};
}
const weatherOptions = () => optionsFor('weather', {weather: {station: '', city: 'London', latitude: 51.5, longitude: -0.1}});

test('all four data requests wait for a single startup decision, with no provisional mainland fetch', async () => {
    const gate = deferred(), network = mockNetwork('美国', {gate}), scope = owner(), saved = [];
    const sources = new NetworkSources(network, scope, {onDetected: region => saved.push(region)});
    const jobs = [sources.weather(weatherOptions(), scope), sources.currency(optionsFor('currency'), scope), sources.stocks(['AAPL'], scope), sources.feed(optionsFor('rss'), scope)];
    await Promise.resolve();
    assert.equal(sources.status.state, 'detecting'); assert.deepEqual(network.calls.map(c => c.url), [IPIP_URL]);
    gate.resolve(); const results = await Promise.all(jobs);
    assert.equal(results.length, 4); assert.deepEqual(saved, ['global']);
    assert.ok(network.calls.every(call => !/cma.cn|eastmoney|ithome/.test(call.url)));
    assert.equal(network.calls.filter(call => isProbe(call.url)).length, 1);
});
test('mainland routes weather, finance, RSS, search, station lookup and IP location to existing services', async () => {
    const network = mockNetwork(), scope = owner(), sources = new NetworkSources(network, scope);
    await sources.ready;
    assert.equal(sources.status.region, 'mainland');
    const weather = await sources.weather(optionsFor('weather'), scope, true);
    assert.ok(weather.value.temperature > -90); assert.equal(weather.optionPatch.coordinateStation, weather.value.station);
    assert.ok((await sources.currency(optionsFor('currency'), scope)).value.rate > 5);
    assert.equal((await sources.stocks(['600519'], scope)).value[0].code, '600519');
    assert.equal((await sources.feed(optionsFor('rss'), scope)).value[0].title, 'Test headline');
    assert.equal((await sources.searchLocations(scope, '上海'))[0].id, '58367');
    assert.ok((await sources.stationDetails(scope, '58367')).station);
    assert.ok((await sources.locationFromCoordinates(scope, 31.2, 121.4)).station);
    assert.ok((await sources.locateByIp(scope)).station);
    assert.ok(network.calls.filter(c => !isProbe(c.url)).every(c => /weather.cma.cn|weather.com.cn|eastmoney.com|ithome.com/.test(c.url)));
    const liveWeather = network.calls.find(c => c.url.includes('/api/weather/view'));
    assert.equal(liveWeather.options.headers.Referer, 'https://weather.cma.cn/'); assert.equal(liveWeather.force, true);
    assert.equal(network.calls.find(c => c.url.includes('wgeo.')).options.cache, false);
});
for (const country of ['美国', '香港', '澳门', '台湾']) test(`${country}: global providers fetch and normalize data while preserving user choices`, async () => {
    const network = mockNetwork(country), scope = owner(), sources = new NetworkSources(network, scope);
    await sources.ready; assert.equal(sources.mainland, false);
    const weather = await sources.weather(weatherOptions(), scope);
    assert.equal(weather.value.name, 'London'); assert.ok(Number.isFinite(weather.value.temperature));
    const currency = await sources.currency(optionsFor('currency'), scope);
    assert.equal(currency.value.rates[0].quote, 'CNY'); assert.equal(currency.value.rates[0].source, 'ECB reference rate');
    await sources.stocks(['600519', '00700.HK', '105.AAPL', 'Apple Inc'], scope);
    const urls = network.calls.map(call => call.url);
    assert.ok(urls.some(url => url.includes('/chart/600519.SS'))); assert.ok(urls.some(url => url.includes('/chart/0700.HK')));
    assert.ok(urls.some(url => url.includes('/chart/AAPL'))); assert.ok(urls.some(url => url.includes('/finance/search')));
    await sources.feed(optionsFor('rss'), scope); assert.equal(network.calls.at(-1).url, SOURCE_PROFILES.global.rss.url);
    assert.ok(network.calls.filter(c => !isProbe(c.url)).every(c => !/cma.cn|weather.com.cn|eastmoney|ithome/.test(c.url)));
});
test('world search, coordinate naming and IP fallback never contact a mainland weather source', async () => {
    const network = mockNetwork('美国'), scope = owner(), sources = new NetworkSources(network, scope);
    assert.equal((await sources.searchLocations(scope, 'London'))[0].countryCode, 'GB');
    const coordinates = await sources.locationFromCoordinates(scope, 51.5, -0.1);
    assert.deepEqual([coordinates.station, coordinates.name, coordinates.latitude], ['', 'London', 51.5]);
    const location = await sources.locateByIp(scope); assert.equal(location.name, 'London'); assert.ok(!('ip' in location));
    assert.equal(network.calls.at(-1).options.cache, false); assert.equal(network.calls.at(-1).force, true);
    await assert.rejects(sources.stationDetails(scope, '58367'), /Search for a city or enter coordinates/);
    assert.ok(network.calls.every(c => !/weather.cma.cn|weather.com.cn/.test(c.url)));
});
test('reverse geocoder failure still permits explicit coordinates instead of guessing a Chinese station', async () => {
    const network = mockNetwork('美国'), get = network.get.bind(network);
    network.get = (...args) => args[0].includes('nominatim') ? Promise.reject(new Error('offline')) : get(...args);
    const scope = owner(), sources = new NetworkSources(network, scope);
    const location = await sources.locationFromCoordinates(scope, 0, 0);
    assert.equal(location.name, '0.00°, 0.00°'); assert.equal(location.latitude, 0); assert.equal(location.station, '');
});
test('legacy CMA selection is resolved through the world geocoder, not stale Shanghai coordinates', async () => {
    const network = mockNetwork('美国'), get = network.get.bind(network);
    network.get = (url, parser, ...args) => url.includes('geocoding-api') ? Promise.resolve({value: parser({results: [{id: 1, name: '南昌', country: '中国', country_code: 'CN', latitude: 28.68, longitude: 115.85}]}), saved: Date.now()}) : get(url, parser, ...args);
    const scope = owner(), sources = new NetworkSources(network, scope);
    const old = optionsFor('weather', {weather: {station: '58606', city: '南昌'}});
    const result = await sources.weather(old, scope);
    assert.equal(result.optionPatch.latitude, 28.68); assert.equal(result.optionPatch.coordinateStation, '58606');
    assert.ok(network.calls.some(c => c.url.includes('latitude=28.68&longitude=115.85')));
    assert.equal(old.latitude, 31.23); // caller decides when to save; no mutation
});
test('default RSS follows region; saved custom URLs (including BBC) are not rewritten', async () => {
    for (const country of ['中国', '美国']) {
        const scope = owner(), sources = new NetworkSources(mockNetwork(country), scope); await sources.ready;
        for (const url of ['https://example.org/feed', SOURCE_PROFILES.global.rss.url]) {
            const options = optionsFor('rss', {rss: {url}});
            assert.equal(options.url, url); assert.equal(options.autoSource, false); assert.equal(sources.feedUrl(options), url);
            assert.equal((await sources.feed(options, scope)).value.length, 1);
        }
        assert.equal(optionsFor('rss', {rss: {url: SOURCE_PROFILES.mainland.rss.url, size: 'large'}}).autoSource, true);
        assert.equal(sources.feedUrl({autoSource: false, url: SOURCE_PROFILES.mainland.rss.url}), SOURCE_PROFILES.mainland.rss.url);
    }
});
test('refresh does not geolocate again; re-enable re-detects even with a different saved last region', async () => {
    const network = mockNetwork('美国'), scope = owner(), sources = new NetworkSources(network, scope, {previous: 'mainland'});
    await sources.ready; await sources.feed(optionsFor('rss'), scope); await sources.feed(optionsFor('rss'), scope, true);
    assert.equal(network.calls.filter(c => isProbe(c.url)).length, 1); assert.equal(network.calls.at(-1).force, true);
    const next = new NetworkSources(mockNetwork('中国'), owner(), {previous: 'global'}); await next.ready;
    assert.equal(next.status.region, 'mainland');
});
test('failed detection can still load the chosen regional offline cache, and never saves a guessed choice', async () => {
    const scope = owner(), network = mockNetwork('中国', {offline: true}), saved = [];
    const sources = new NetworkSources(network, scope, {previous: 'global', onDetected: value => saved.push(value)});
    await sources.ready; assert.equal(sources.status.region, 'global'); assert.equal(sources.status.state, 'fallback');
    assert.deepEqual(saved, []); await sources.feed(optionsFor('rss'), scope);
    assert.equal(network.calls.at(-1).url, SOURCE_PROFILES.global.rss.url);
});
test('destroyed widgets or extension cannot fetch after a delayed startup result, nor overwrite last region', async () => {
    const gate = deferred(), network = mockNetwork('美国', {gate}), scope = owner(), widget = owner(), saved = [];
    const sources = new NetworkSources(network, scope, {onDetected: value => saved.push(value)});
    const pending = sources.feed(optionsFor('rss'), widget); widget.alive = false;
    gate.resolve(); await assert.rejects(pending, /cancelled/); assert.equal(network.calls.length, 1);
    const gate2 = deferred(), network2 = mockNetwork('美国', {gate: gate2}), scope2 = owner();
    const old = new NetworkSources(network2, scope2, {onDetected: value => saved.push(value)});
    scope2.alive = false; gate2.resolve(); await old.ready;
    assert.equal(old.status.state, 'cancelled'); assert.equal(network2.calls.length, 1); assert.deepEqual(saved, ['global']);
});
test('same-currency global conversion is exact and does not make an unnecessary rate request', async () => {
    const network = mockNetwork('美国'), scope = owner(), sources = new NetworkSources(network, scope);
    const result = await sources.currency({base: 'USD', quotes: ['USD']}, scope);
    assert.equal(result.value.rate, 1); assert.equal(network.calls.length, 1);
});

test('known station-coordinate association preserves an explicitly selected point', async () => {
    const network = mockNetwork(), scope = owner(), sources = new NetworkSources(network, scope);
    const station = JSON.parse(fixture('cma-view')).data.location.id;
    const result = await sources.weather({...optionsFor('weather'), station, coordinateStation: station, latitude: 31.2345, longitude: 121.4567}, scope);
    assert.ok(!Object.hasOwn(result.optionPatch, 'latitude'));
    assert.ok(!Object.hasOwn(result.optionPatch, 'longitude'));
});
test('Yahoo endpoint fallback stays international and propagates cached/stale status', async () => {
    const network = mockNetwork('美国'), get = network.get.bind(network), attempts = [];
    network.get = async (...args) => {
        attempts.push(args[0]);
        if (args[0].includes('query1.finance')) throw new Error('rate limited');
        const result = await get(...args);
        return args[0].includes('query2.finance') ? {...result, stale: true} : result;
    };
    const scope = owner(), sources = new NetworkSources(network, scope);
    const result = await sources.stocks(['AAPL'], scope, true);
    assert.equal(result.stale, true); assert.equal(result.value[0].code, 'AAPL');
    assert.ok(attempts.some(url => url.includes('query2.finance')));
    assert.ok(attempts.every(url => !url.includes('eastmoney')));
});
