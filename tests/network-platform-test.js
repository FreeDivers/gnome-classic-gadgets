// SPDX-License-Identifier: MIT
// Real GJS/Gio cancellation and cache behavior, without external HTTP traffic.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import {Network, Scope} from '../extension/lib/platform.js';
import {parseIpwhoRegion} from '../extension/lib/logic/network-region.js';
const checks = [], loop = new GLib.MainLoop(null, false);
const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
async function rejects(promise, name) { let rejected = false; try { await promise; } catch { rejected = true; } check(rejected, name); }
async function run() {
    const network = new Network(), owner = new Scope();
    let cacheLookups = 0, requests = 0;
    const originalCacheFile = network.cacheFile.bind(network);
    network.cacheFile = url => { cacheLookups++; return originalCacheFile(url); };
    try {
        network.request = (_url, cancellable) => new Promise((_resolve, reject) => {
            requests++; cancellable.connect(() => reject(new Error('cancelled by deadline')));
        });
        const start = GLib.get_monotonic_time();
        await rejects(network.get('https://example.test/location', JSON.parse, owner, 0, true, {cache: false, timeoutMs: 120}), 'short startup deadlines cancel real Gio.Cancellable requests');
        const elapsed = (GLib.get_monotonic_time() - start) / 1000;
        check(elapsed >= 100 && elapsed < 3000, 'per-request timeout is honored without waiting for Soup session timeout');
        network.request = async () => JSON.stringify({success: true, country_code: 'US', ip: '192.0.2.55', city: 'private test city'});
        const region = await network.get('https://example.test/location', parseIpwhoRegion, owner, 0, true, {cache: false});
        check(region.value.region === 'global' && !('ip' in region.value), 'location parser exposes only coarse routing information');
        check(cacheLookups === 0, 'uncached geolocation never opens or writes a disk cache file');
        check(!originalCacheFile('https://example.test/location').query_exists(null), 'raw IP response is absent from disk');

        network.request = async () => '{"temperature":21}';
        const mainlandUrl = 'https://example.test/mainland/weather', globalUrl = 'https://example.test/global/weather';
        await network.get(mainlandUrl, JSON.parse, owner, 0, true);
        for (let i = 0; i < 30 && !originalCacheFile(mainlandUrl).query_exists(null); i++) await wait(20);
        check(originalCacheFile(mainlandUrl).query_exists(null), 'ordinary service data still persists to the private cache');
        network.request = async () => { throw new Error('offline'); };
        const cached = await network.get(mainlandUrl, JSON.parse, owner, 0, true);
        check(cached.stale && cached.value.temperature === 21, 'offline refresh retains real parsed data and marks it stale');
        await rejects(network.get(globalUrl, JSON.parse, owner, 0, true), 'a global provider cannot accidentally use a mainland provider cache');

        const a = new Scope(), b = new Scope(), pending = new Map();
        network.request = (url, cancellable) => new Promise((resolve, reject) => {
            requests++; pending.set(url, {resolve, reject});
            cancellable.connect(() => reject(new Error('cancelled by owner')));
        });
        const requestA = network.get('https://example.test/a', JSON.parse, a, 0, true, {cache: false});
        const requestB = network.get('https://example.test/b', JSON.parse, b, 0, true, {cache: false});
        a.destroy();
        await rejects(requestA, 'removing one widget cancels its active request');
        pending.get('https://example.test/b').resolve('{"ok":true}');
        check((await requestB).value.ok && b.alive, 'another widget request is not cancelled');
        const count = requests;
        await rejects(network.get('https://example.test/dead', JSON.parse, a, 0, true, {cache: false}), 'a previously cancelled owner cannot initiate another request');
        check(requests === count, 'cancelled owner never reaches the HTTP transport');
        const requestC = network.get('https://example.test/c', JSON.parse, b, 0, true, {cache: false});
        network.destroy();
        await rejects(requestC, 'extension disable cancels all outstanding network requests');
        b.destroy();
    } finally { owner.destroy(); network.destroy(); }
}
let status = 0;
run().then(() => print(JSON.stringify({ok: true, checks}, null, 2))).catch(error => { status = 1; print(JSON.stringify({ok: false, error: String(error), stack: error.stack, checks}, null, 2)); }).finally(() => loop.quit());
loop.run(); System.exit(status);
