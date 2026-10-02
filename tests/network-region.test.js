// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {regionForCountry, parseIpipRegion, parseIpwhoRegion, parseIpapiRegion, detectNetworkRegion,
    IPIP_URL, IPWHO_URL, IPAPI_URL, REGION_TIMEOUT_MS, regionStatus} from '../extension/lib/logic/network-region.js';

const owner = () => ({alive: true, cancellable: {is_cancelled: () => false}});
const ipip = (...location) => ({ret: 'ok', data: {ip: '192.0.2.1', location}});
test('CN alone uses mainland sources; HK, MO, TW and every other country use global sources', () => {
    assert.equal(regionForCountry(' cn ').region, 'mainland');
    for (const code of ['HK', 'MO', 'TW', 'US', 'GB', 'JP', 'SG', 'AU', 'DE']) assert.equal(regionForCountry(code).region, 'global');
    for (const [name, code] of [['Hong Kong SAR', 'HK'], ['香港特别行政区', 'HK'], ['Macao', 'MO'], ['Macau', 'MO'], ['澳門', 'MO'], ['Taiwan', 'TW'], ['台湾省', 'TW'], ['臺灣', 'TW']]) {
        assert.deepEqual(regionForCountry('CN', name), {region: 'global', countryCode: code});
    }
    assert.equal(regionForCountry('CN', '内蒙古').region, 'mainland');
    for (const bad of ['', 'ZZ', 'XX', 'QQ', 'EU', 'China', null, [], '../CN']) assert.throws(() => regionForCountry(bad));
});
test('domestically reachable IPIP parses coarse region without retaining an IP or address', () => {
    assert.deepEqual(parseIpipRegion(ipip('中国', '江西', '南昌', '', '联通')), {region: 'mainland', countryCode: 'CN'});
    for (const where of ['香港', '澳门', '台湾']) {
        assert.equal(parseIpipRegion(ipip('中国', where)).region, 'global');
        assert.equal(parseIpipRegion(ipip(where)).region, 'global');
        assert.equal(parseIpipRegion(ipip(`中国${where}`)).region, 'global');
    }
    assert.deepEqual(parseIpipRegion(ipip('美国', '加利福尼亚')), {region: 'global', countryCode: null});
    assert.deepEqual(parseIpipRegion(ipip('Russia', 'Moscow')), {region: 'global', countryCode: null});
    for (const data of [ipip(''), ipip('未知'), ipip('保留地址'), ipip('Unknown'), ipip('ZZ'), ipip('192.0.2.1'), {ret: 'err'}, {}, '<html>error</html>']) assert.throws(() => parseIpipRegion(data));
});
test('international country parsers validate error envelopes and separate HK/MO/TW subdivisions', () => {
    assert.equal(parseIpwhoRegion({success: true, country_code: 'CN', region: '上海'}).region, 'mainland');
    assert.equal(parseIpapiRegion({country_code: 'CN', region: 'Hong Kong'}).region, 'global');
    for (const data of [{success: false, country_code: 'CN'}, {success: true}, {success: true, country_code: 'ZZ'}]) assert.throws(() => parseIpwhoRegion(data));
    for (const data of [{error: true, country_code: 'US'}, {}, '[]']) assert.throws(() => parseIpapiRegion(data));
});
test('startup tries bounded, uncached HTTPS probes in order; first valid result wins', async () => {
    const calls = [];
    const network = {async get(url, parser, scope, maxAge, force, options) {
        calls.push({url, scope, maxAge, force, options});
        if (url === IPIP_URL) throw new Error('timeout');
        return {value: parser({success: true, country_code: 'US'})};
    }};
    const scope = owner(), result = await detectNetworkRegion(network, scope, 'mainland');
    assert.equal(result.region, 'global'); assert.equal(result.state, 'detected');
    assert.deepEqual(calls.map(call => call.url), [IPIP_URL, IPWHO_URL]);
    for (const call of calls) {
        assert.equal(call.scope, scope); assert.equal(call.maxAge, 0); assert.equal(call.force, true);
        assert.deepEqual(call.options, {cache: false, timeoutMs: REGION_TIMEOUT_MS}); assert.ok(call.url.startsWith('https://'));
    }
    assert.ok(!JSON.stringify(result).includes('ip:'));
});
test('malformed/limited replies trigger the next detector, not a guessed international region', async () => {
    const calls = [], network = {async get(url, parser) {
        calls.push(url);
        return {value: parser(url === IPIP_URL ? {} : url === IPWHO_URL ? {success: false} : {country_code: 'TW'})};
    }};
    assert.equal((await detectNetworkRegion(network, owner())).countryCode, 'TW');
    assert.deepEqual(calls, [IPIP_URL, IPWHO_URL, IPAPI_URL]);
});
test('offline startup retains only a valid last-successful choice; first failure preserves old mainland behavior', async () => {
    const network = {async get() { throw new Error('offline'); }};
    for (const [previous, expected] of [['global', 'global'], ['mainland', 'mainland'], ['', 'mainland'], ['garbage', 'mainland']]) {
        const status = await detectNetworkRegion(network, owner(), previous);
        assert.equal(status.state, 'fallback'); assert.equal(status.region, expected); assert.equal(status.countryCode, null);
        assert.match(regionStatus(status), /Detection failed/);
    }
});
test('disable during detection stops the fallback chain and cannot publish a location', async () => {
    const scope = owner(), calls = [];
    const network = {async get(url) { calls.push(url); scope.alive = false; throw new Error('cancelled'); }};
    assert.deepEqual(await detectNetworkRegion(network, scope, 'global'), {state: 'cancelled'});
    assert.deepEqual(calls, [IPIP_URL]);
    assert.deepEqual(await detectNetworkRegion(network, scope), {state: 'cancelled'});
    assert.equal(calls.length, 1);
});
