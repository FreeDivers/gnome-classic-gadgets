// SPDX-License-Identifier: MIT
// Exercise the ACTUAL extension enable/disable + native gadgets with controlled
// country responses. Only this isolated test process replaces Network.get.
import Gio from 'gi://Gio';
export async function run(app, h) {
    const {Network} = await import(`file://${app.path}/lib/platform.js`);
    const {IPIP_URL, IPWHO_URL, IPAPI_URL} = await import(`file://${app.path}/lib/logic/network-region.js`);
    const {SOURCE_PROFILES} = await import(`file://${app.path}/lib/network-sources.js`);
    const fixtures = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('fixtures');
    const fixture = name => new TextDecoder().decode(fixtures.get_child(`${name}.json`).load_contents(null)[1]);
    const originalGet = Network.prototype.get, settings = app.settings;
    const types = ['clock', 'weather', 'currency', 'stocks', 'rss'];
    let run;
    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
    const isProbe = url => [IPIP_URL, IPWHO_URL, IPAPI_URL].includes(url);
    const waitForData = async () => {
        for (let i = 0; i < 80 && [...app.widgets.values()].some(widget => widget.busy); i++) await h.wait(50);
        for (const type of ['weather', 'currency', 'stocks', 'rss']) h.check(!!app.widgets.get(type)?.data, `${run.country || 'offline'}: ${type} renders actual normalized provider response`);
    };
    const reset = (country, {pending = false, offline = false, previous = '', custom = false, onlyClock = false} = {}) => {
        app.disable();
        settings.set_strv('enabled-gadgets', onlyClock ? ['clock'] : types);
        settings.set_string('last-network-region', previous);
        settings.set_string('options', JSON.stringify({weather: {size: 'large'}, currency: {size: 'large'}, stocks: {size: 'large'}, rss: custom ? {url: 'https://example.org/custom-feed', size: 'large'} : {size: 'large'}}));
        run = {country, offline, calls: [], gate: pending ? deferred() : null};
        app.enable(); return run;
    };
    app.disable();
    Network.prototype.get = async function (url, parser, scope, maxAge, force, options) {
        const current = run; current.calls.push({url, maxAge, force, options});
        if (url === IPIP_URL && current.gate) await current.gate.promise;
        if (!scope.alive) throw new Error('cancelled');
        if (isProbe(url) && current.offline) throw new Error('fixture offline');
        let raw;
        if (url === IPIP_URL) raw = {ret: 'ok', data: {location: [current.country, '', '', ''], ip: '192.0.2.44'}};
        else if (url.includes('weather.cma.cn/api/weather/view')) raw = fixture('cma-view');
        else if (url.includes('push2.eastmoney.com/api/qt/ulist')) raw = fixture('eastmoney-quotes');
        else if (url.includes('push2.eastmoney.com/')) raw = fixture('forex-cny');
        else if (url.includes('geocoding-api.open-meteo.com/')) raw = fixture('open-meteo-cities');
        else if (url.includes('api.open-meteo.com/v1/forecast')) raw = fixture('open-meteo-weather');
        else if (url.includes('api.frankfurter.dev/')) raw = fixture('frankfurter');
        else if (url.includes('.finance.yahoo.com/v8/finance/chart')) raw = fixture('yahoo-chart');
        else if (/rss|custom-feed/.test(url)) raw = '<rss><channel><item><title>Network region test</title><link>https://example.org/news</link></item></channel></rss>';
        else throw new Error(`Unexpected fixture request: ${url}`);
        return {value: parser(typeof raw === 'string' ? raw : JSON.stringify(raw)), saved: Date.now(), stale: current.offline && !isProbe(url)};
    };
    try {
        for (const country of ['中国', '美国', '香港', '澳门', '台湾']) {
            const current = reset(country, {pending: true});
            await h.wait(30);
            h.check(app.widgets.size === types.length && !!app.widgets.get('clock').hour, `${country}: offline/native widgets appear while the country probe is pending`);
            h.check(app.sources.status.state === 'detecting' && current.calls.length === 1 && current.calls[0].url === IPIP_URL, `${country}: no regional data requested before startup detection finishes`);
            h.check(current.calls[0].options.cache === false && current.calls[0].options.timeoutMs === 4000, `${country}: startup probe is uncached and bounded`);
            current.gate.resolve(); await waitForData();
            const region = country === '中国' ? 'mainland' : 'global', expected = SOURCE_PROFILES[region];
            h.check(app.sources.status.region === region && settings.get_string('last-network-region') === region, `${country}: selected and saved the correct provider group`);
            for (const type of ['weather', 'currency', 'stocks', 'rss']) {
                const widget = app.widgets.get(type);
                h.check(widget.provider === expected[type].name && widget.networkStatus.text.includes(expected[type].name), `${country}: ${type} displays its actual source`);
            }
            const dataUrls = current.calls.filter(c => !isProbe(c.url)).map(c => c.url);
            h.check(dataUrls.every(url => region === 'mainland' ? /weather.cma.cn|eastmoney.com|ithome.com/.test(url) : !/weather.cma.cn|eastmoney.com|ithome.com/.test(url)), `${country}: every data request stays in its selected region`);
            h.check(app.widgets.get('weather').attribution.text.includes(expected.weather.name), `${country}: weather attribution is not hard-coded to CMA`);
            const count = current.calls.filter(c => isProbe(c.url)).length;
            await app.widgets.get('rss').refresh(true);
            h.check(current.calls.filter(c => isProbe(c.url)).length === count, `${country}: refresh does not repeatedly track location`);
        }
        const statusText = await new Promise((resolve, reject) => Gio.DBus.session.call('org.gnome.Shell', '/org/gnome/Shell/Extensions/ClassicGadgets',
            'org.gnome.Shell.Extensions.ClassicGadgets', 'GetNetworkStatus', null, null, Gio.DBusCallFlags.NONE, 3000, null,
            (bus, result) => { try { resolve(bus.call_finish(result).deep_unpack()[0]); } catch (error) { reject(error); } }));
        const publicStatus = JSON.parse(statusText);
        h.check(publicStatus.region === 'global' && !('ip' in publicStatus) && !('latitude' in publicStatus), 'D-Bus exposes the actual current region without an IP or precise coordinates');
        await h.screenshot('global-fixture.png');
        for (const country of ['中国', '美国']) {
            reset(country, {custom: true}); await waitForData();
            h.check(run.calls.some(c => c.url === 'https://example.org/custom-feed') && app.widgets.get('rss').provider === '自定义 RSS / Atom', `${country}: custom RSS remains unchanged`);
        }
        for (const previous of ['global', 'mainland', '']) {
            reset('', {offline: true, previous}); await waitForData();
            h.check(app.sources.status.state === 'fallback' && app.sources.status.region === (previous || 'mainland'), `offline with last=${previous || 'none'}: correct conservative fallback`);
            h.check(settings.get_string('last-network-region') === previous, 'a failed probe never overwrites the last successful choice');
            h.check(app.widgets.get('weather').networkStatus.text.includes('检测失败') && app.widgets.get('weather').networkStatus.text.includes('缓存数据'), 'fallback and stale data are visible to users');
        }
        const old = reset('中国', {pending: true}), oldSources = app.sources, oldScope = app.scope;
        await h.wait(30);
        reset('美国'); await waitForData(); old.gate.resolve(); await h.wait(60);
        h.check(!oldScope.alive && oldSources.status.state === 'cancelled', 'disable cancels a pending location probe');
        h.check(old.calls.length === 1 && app.sources.status.region === 'global' && settings.get_string('last-network-region') === 'global', 'late result from a disabled generation cannot fetch or replace the new selection');
        reset('美国', {onlyClock: true}); await app.sources.ready;
        h.check(app.widgets.size === 1 && run.calls.length === 1, 'startup detects region even when no network widget is enabled');
        settings.set_strv('enabled-gadgets', types); await waitForData();
        h.check(app.widgets.get('weather').provider === 'Open-Meteo' && run.calls.filter(c => isProbe(c.url)).length === 1, 'widgets enabled later reuse the startup decision without a new probe');
        h.check(app.errors.length === 0, 'no native gadget construction/render errors across region and lifecycle changes');
    } finally {
        app.disable(); Network.prototype.get = originalGet;
    }
}
