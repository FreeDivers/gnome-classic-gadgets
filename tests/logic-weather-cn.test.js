// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCmaView, parseCmaAutocomplete, parseCmaMap, parseWgeo, cmaUrls, cmaArt, cmaIcon, autoLabel, nearestStation, matchStation, provinceFallback, isNightNow, moonPhase} from '../extension/lib/logic/weather-cn.js';
const view = JSON.parse(fs.readFileSync(new URL('./fixtures/cma-view.json', import.meta.url)));

test('CMA live-response fixture parses temperature, forecast and automatic city label', () => {
    const result = parseCmaView(view); assert.equal(result.station, '58367');
    assert.ok(Number.isFinite(result.temperature)); assert.ok(result.days.length >= 3);
    assert.equal(autoLabel(result), '徐家汇'); assert.equal(autoLabel({path: '中国, 江西, 南昌', name: '南昌'}), '南昌');
    assert.throws(() => parseCmaView({code: 403, msg: 'forbidden'}));
    const missing = structuredClone(view); missing.data.now.temperature = null; assert.throws(() => parseCmaView(missing));
    const noForecast = structuredClone(view); noForecast.data.daily = []; assert.throws(() => parseCmaView(noForecast));
    assert.throws(() => cmaUrls.view('../foo'));
});
test('weather search, IP lookup and nearest station need no user-entered coordinates', () => {
    const rows = parseCmaAutocomplete({code: 0, data: ['58606|南昌|Nanchang|中国', 'broken', '54433|朝阳|Chaoyang|中国']});
    assert.equal(rows.length, 2);
    const ip = parseWgeo('var ip="192.0.2.1";var id="101240101";var addr="江西,南昌,东湖";');
    assert.equal(ip.city, '南昌'); assert.throws(() => parseWgeo('<html>403</html>'));
    assert.equal(matchStation(rows, '南昌').id, '58606');
    const map = [{id: '58606', name: '南昌', latitude: 28.6, longitude: 115.9, level: 0, province: 'AJX'},
        {id: 'A', name: '远方', latitude: 39.9, longitude: 116.4, level: 3, province: 'ABJ'}];
    assert.equal(nearestStation(map, 28.61, 115.91).id, '58606');
    assert.throws(() => nearestStation(map, -80, -120));
    assert.equal(provinceFallback(map, '江西').id, '58606');
    const raw = ['58606','南昌','中国',0,28.6,115.9,28,'晴',0,'东风','微风',22,'晴',0,'东风','微风','AJX','360401'];
    assert.equal(parseCmaMap({code: 0, data: {city: [raw]}}, {minRows: 1})[0].province, 'AJX');
    assert.throws(() => parseCmaMap({code: 0, data: {city: []}}));
});
test('CMA conditions map only to shipped original art/icons in both sizes', () => {
    for (let code = 0; code <= 99; code++) for (const night of [false, true]) {
        const art = cmaArt(code, night);
        for (const mode of ['docked','undocked']) if (art.art) assert.ok(fs.existsSync(new URL(`../extension/assets/original/Weather.Gadget/images/${mode}_${art.art}.png`, import.meta.url)));
        assert.ok(fs.existsSync(new URL(`../extension/assets/original/Weather.Gadget/images/${cmaIcon(code, night)}.png`, import.meta.url)));
        assert.equal(art.backdrop === 'BLACK', night);
    }
    for (let day = 1; day <= 31; day++) assert.ok(fs.existsSync(new URL(`../extension/assets/original/Weather.Gadget/images/docked_moon-${moonPhase(new Date(2026, 8, day))}.png`, import.meta.url)));
    const location={latitude:31.2,longitude:121.4,timezone:8};
    assert.equal(isNightNow(new Date('2026-09-10T12:00:00+08:00'),location),false);
    assert.equal(isNightNow(new Date('2026-09-10T00:00:00+08:00'),location),true);
});
