// SPDX-License-Identifier: MIT
// The startup decision is controlled for the international branch only; ALL
// weather/rate/stock/feed/search/IP-city payloads below are real HTTPS responses.
import GLib from 'gi://GLib';
export async function run(app, h) {
    const {Network, Scope} = await import(`file://${app.path}/lib/platform.js`);
    const {IPIP_URL} = await import(`file://${app.path}/lib/logic/network-region.js`);
    await app.sources.ready;
    h.check(app.sources.status.state === 'detected', 'unmodified startup successfully detects a coarse network region using a real IP service');
    const actualStartup = {...app.sources.status};
    h.check(app.settings.get_string('last-network-region') === actualStartup.region, 'real startup saves only its selected provider group');
    const originalGet = Network.prototype.get, settings = app.settings, requests = [], scope = new Scope();
    const waitForData = async () => {
        for (let i = 0; i < 700 && [...app.widgets.values()].some(widget => widget.busy); i++) await h.wait(100);
        for (const type of ['weather', 'currency', 'stocks', 'rss']) {
            const widget = app.widgets.get(type);
            h.check(!!widget.data && !widget.networkStatus.text.includes('更新失败'), `${type}: live international data parsed and rendered (${widget.networkStatus.text})`);
        }
    };
    app.disable();
    Network.prototype.get = async function (url, parser, owner, ...args) {
        requests.push(url);
        if (url === IPIP_URL) return {value: parser(JSON.stringify({ret: 'ok', data: {location: ['美国', '', '', '']}})), saved: Date.now(), stale: false};
        return originalGet.call(this, url, parser, owner, ...args);
    };
    try {
        settings.set_strv('enabled-gadgets', ['weather', 'currency', 'stocks', 'rss']);
        settings.set_string('options', JSON.stringify({
            weather: {size: 'large', station: '', coordinateStation: '', city: 'London', latitude: 51.50853, longitude: -0.12574},
            currency: {size: 'large', base: 'USD', quotes: ['CNY', 'EUR', 'JPY'], amount: 100},
            stocks: {size: 'large', symbols: ['AAPL', '600519', '00700.HK']}, rss: {size: 'large', autoSource: true},
        }));
        app.enable(); await waitForData();
        h.check(app.sources.status.region === 'global', 'controlled outside-mainland startup chooses the global profile');
        h.check(app.widgets.get('weather').data.timezoneName === 'Europe/London', 'live weather uses the selected city time zone, not a hard-coded China time zone');
        const stockCodes = app.widgets.get('stocks').data.map(row => row.code);
        h.check(['AAPL', '600519.SS', '0700.HK'].every(code => stockCodes.includes(code)), 'existing US, mainland and Hong Kong symbols all have real Yahoo quotes');
        h.check(app.widgets.get('currency').data.rates.length === 3, 'real Frankfurter conversion covers CNY, EUR and JPY');
        await h.screenshot('global-live-desktop.png');

        const weather = app.widgets.get('weather'); app.openOptions(weather); const dialog = app.dialog; await dialog.whenReady();
        const search = dialog.specs.find(spec => spec.type === 'search');
        const results = await search.provider('London', dialog.scope);
        const london = results.find(row => row.countryCode === 'GB');
        h.check(!!london && Number.isFinite(london.latitude) && london.station === '', 'live worldwide city search returns geographic coordinates, not a CMA station ID');
        search.onPick(london, dialog);
        h.check(dialog.values.station === '' && dialog.values.latitude === london.latitude, 'native weather options accept a global search result with an empty CMA station');
        await h.screenshot('global-live-options.png'); dialog.apply();
        await waitForData();
        h.check(settings.get_string('options').includes(london.name), 'global city selection validates and persists through the real GTK options dialog');
        const located = await app.sources.locateByIp(scope);
        h.check(!!located.name && Number.isFinite(located.latitude) && located.station === '' && !('ip' in located), 'real international IP-city lookup strips the IP and does not seek a Chinese weather station');
        const coordinate = await app.sources.locationFromCoordinates(scope, 51.5, -0.12);
        h.check(coordinate.station === '' && coordinate.latitude === 51.5, 'global manual coordinates are usable with a city label or safe coordinate fallback');
        h.check(requests.filter(url => url !== IPIP_URL).every(url => !/weather.cma.cn|weather.com.cn|eastmoney.com|ithome.com/.test(url)), 'international live requests do not leak back to mainland data providers');
        h.check(app.errors.length === 0, 'live international widgets and native options have no construction/render errors');
        GLib.file_set_contents(`${h.out}/providers.json`, JSON.stringify({actualStartup, internationalBranch: 'controlled country response; real service data',
            providers: Object.fromEntries([...app.widgets].map(([type, widget]) => [type, {name: widget.provider, hasData: !!widget.data, status: widget.networkStatus.text}])),
            hosts: [...new Set(requests.map(url => /^https:\/\/([^/]+)/.exec(url)?.[1]))]}, null, 2));
    } finally { scope.destroy(); app.disable(); Network.prototype.get = originalGet; }
}
