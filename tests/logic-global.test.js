// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openMeteoUrl, parseOpenMeteo, wmoToCma, geocodingUrl, parseGeocoding, reverseGeocodingUrl, parseReverseGeocoding,
    parseIpwhoLocation, parseIpapiLocation} from '../extension/lib/logic/weather-global.js';
import {frankfurterUrl, parseFrankfurter, yahooInput, yahooChartUrl, parseYahooChart, parseYahooSearch} from '../extension/lib/logic/finance-global.js';
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('Open-Meteo live-shaped response uses local weather time, Celsius, m/s, forecasts and the existing skin model', () => {
    const raw = fixture('open-meteo-weather'), data = parseOpenMeteo(raw, {city: 'London'});
    assert.equal(data.name, 'London'); assert.equal(data.station, ''); assert.ok(Number.isFinite(data.temperature));
    assert.equal(data.windSpeed, raw.current.wind_speed_10m); assert.equal(data.timezone, raw.utc_offset_seconds / 3600);
    assert.equal(data.timezoneName, 'Europe/London'); assert.equal(data.isDay, raw.current.is_day === 1);
    assert.equal(data.currentCode, wmoToCma(raw.current.weather_code)); assert.equal(data.days.length, 4);
    assert.equal(data.days[0].date, raw.daily.time[0]); assert.equal(data.days[0].high, raw.daily.temperature_2m_max[0]);
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) assert.ok(Number.isInteger(wmoToCma(code)));
    assert.equal(wmoToCma(3), 2); assert.equal(wmoToCma(95), 4); assert.equal(wmoToCma(999), null);
    const url = openMeteoUrl(0, 0); assert.match(url, /timezone=auto/); assert.match(url, /wind_speed_unit=ms/);
    for (const coordinates of [[91, 0], [0, 181], [NaN, 0], ['51', 0]]) assert.throws(() => openMeteoUrl(...coordinates));
    for (const invalid of [{}, {error: true}, {...raw, current: {}}, {...raw, daily: {time: []}}, {...raw, utc_offset_seconds: null}]) assert.throws(() => parseOpenMeteo(invalid));
});
test('global search keeps world coordinates and country disambiguation, never treats GeoNames IDs as CMA stations', () => {
    const rows = parseGeocoding(fixture('open-meteo-cities'));
    assert.ok(rows.length >= 2); assert.equal(rows[0].countryCode, 'GB'); assert.equal(rows[0].station, '');
    assert.ok(rows[0].latitude > 50); assert.match(rows[0].detail, /英国/);
    assert.deepEqual(parseGeocoding({generationtime_ms: 0.1}), []);
    assert.deepEqual(parseGeocoding({results: [{id: 1, name: 'bad', latitude: 99, longitude: 0}]}), []);
    assert.match(geocodingUrl('上海 & London'), /%26/); assert.throws(() => geocodingUrl(''));
    assert.equal(parseReverseGeocoding({address: {town: 'Oxford'}}), 'Oxford');
    assert.match(reverseGeocodingUrl(0, -1), /^https:\/\/nominatim.openstreetmap.org/);
    assert.throws(() => parseReverseGeocoding({error: 'unknown'}));
});
test('on-demand global IP location validates coordinates and strips personal/raw response fields', () => {
    const data = parseIpwhoLocation({success: true, country_code: 'GB', city: 'London', latitude: 51.5, longitude: -0.1, ip: '192.0.2.1', connection: {asn: 1}});
    assert.equal(data.name, 'London'); assert.equal(data.station, ''); assert.ok(!('ip' in data)); assert.ok(!('connection' in data));
    assert.equal(parseIpapiLocation({country_code: 'GB', latitude: 0, longitude: 0}).latitude, 0);
    assert.throws(() => parseIpwhoLocation({success: true, country_code: 'US', latitude: null, longitude: 0}));
});
test('Frankfurter validates requested pairs, keeps identical currencies at one, and never silently substitutes CNH for CNY', () => {
    const raw = fixture('frankfurter'), data = parseFrankfurter(raw, 'USD', ['USD', 'CNY', 'EUR', 'JPY']);
    assert.equal(data.rates[0].rate, 1); assert.equal(data.rates[1].rate, raw.rates.CNY); assert.equal(data.rates[1].source, 'ECB reference rate');
    assert.equal(data.date, raw.date); assert.equal(data.rates[1].date, raw.date); assert.ok(data.rates[1].time > 1e9);
    assert.equal(frankfurterUrl('USD', ['USD']), null);
    assert.equal(frankfurterUrl('usd', ['USD', 'CNY', 'CNY']), 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY');
    assert.throws(() => parseFrankfurter(raw, 'EUR', ['USD'])); assert.throws(() => parseFrankfurter(raw, 'USD', ['CNH']));
    for (const invalid of [{}, {...raw, amount: 100}, {...raw, rates: {CNY: '-'}}, {...raw, rates: {CNY: 0}}]) assert.throws(() => parseFrankfurter(invalid, 'USD', ['CNY']));
});
test('Yahoo symbol conversion preserves mainland/HK/US choices and also accepts global tickers', () => {
    for (const [input, expected] of [['600519', '600519.SS'], ['1.600519', '600519.SS'], ['sh600519', '600519.SS'], ['000001.SZ', '000001.SZ'], ['0.000001', '000001.SZ'],
        ['00700.HK', '0700.HK'], ['116.00700', '0700.HK'], ['700', '0700.HK'], ['105.AAPL', 'AAPL'], ['AAPL.US', 'AAPL'], ['BRK.B', 'BRK-B'], ['^GSPC', '^GSPC'], ['VOD.L', 'VOD.L'], ['EURUSD=X', 'EURUSD=X']]) {
        assert.deepEqual(yahooInput(input), {symbol: expected}); assert.match(yahooChartUrl(expected), /interval=1d&range=1d$/);
    }
    assert.deepEqual(yahooInput('贵州茅台'), {query: '贵州茅台'});
    assert.equal(parseYahooSearch({quotes: [{symbol: 'AAPL', quoteType: 'EQUITY', isYahooFinance: true}]}, 'Apple'), 'AAPL');
    for (const input of ['', '../x', 'https://evil.test', 'AAPL\ninjected']) assert.throws(() => yahooInput(input));
    assert.match(yahooChartUrl('^GSPC', true), /query2.finance.yahoo.com.*%5EGSPC/);
    assert.throws(() => parseYahooSearch({quotes: []}, 'unknown'));
});
test('Yahoo chart parser uses current regular price and the preceding session, never a fabricated quote', () => {
    const raw = fixture('yahoo-chart'), row = parseYahooChart(raw), meta = raw.chart.result[0].meta;
    assert.equal(row.code, 'AAPL'); assert.equal(row.timezone, 'America/New_York'); assert.equal(row.price, meta.regularMarketPrice); assert.equal(row.time, meta.regularMarketTime);
    assert.match(row.status, /may be delayed/); assert.ok(Number.isFinite(row.changePct));
    const only = meta => ({chart: {result: [{meta}], error: null}});
    assert.equal(parseYahooChart(only({symbol: 'X', regularMarketPrice: 110, regularMarketTime: 100, chartPreviousClose: 100})).changePct.toFixed(2), '10.00');
    assert.equal(parseYahooChart(only({symbol: 'X', regularMarketPrice: 110, regularMarketTime: 100})).changePct, null);
    for (const invalid of [{}, {chart: {error: {description: 'not found'}}}, only({symbol: 'X', regularMarketPrice: null, regularMarketTime: 100})]) assert.throws(() => parseYahooChart(invalid));
});
