// SPDX-License-Identifier: MIT
export async function run(app, h) {
    const api = await import(`file://${app.path}/lib/location.js`);
    const {Scope} = await import(`file://${app.path}/lib/platform.js`);
    const scope = new Scope();
    try {
        await app.sources.ready;
        const mainland = app.sources.mainland, query = mainland ? '南昌' : 'London';
        const expected = row => mainland ? row.id === '58606' : row.countryCode === 'GB';
        const found = await api.searchStations(app, scope, query);
        h.check(found.some(expected), 'live city search uses the selected regional provider');
        const coordinates = await api.stationFromCoordinates(app, scope, ...(mainland ? [28.61, 115.91] : [51.5, -0.12]));
        h.check(!!coordinates.name && (mainland ? !!coordinates.station : coordinates.station === ''), 'manual coordinates resolve through the selected region, without inventing a station ID');
        const located = await api.locate(app, scope, {timeoutMs: 400});
        h.check(!!located.name && Number.isFinite(located.latitude) && (mainland ? !!located.station : located.station === ''), 'location chain resolves user city without typed coordinates');
        const weather = app.widgets.get('weather');
        app.openOptions(weather); const dialog = app.dialog; await dialog.whenReady();
        await h.chord([h.Clutter.KEY_Control_L, h.Clutter.KEY_f]); await h.type(mainland ? 'nanchang' : 'London');
        const id = dialog.rows.get('_citySearch').field.id;
        for (let i = 0; i < 100 && !dialog.requests.get(id)?.items?.some(expected); i++) await h.wait(100);
        h.check(dialog.requests.get(id)?.items?.some(expected), 'native search entry sends real keyboard queries and receives regional city results');
        await h.wait(300); await h.key(h.Clutter.KEY_Down); await h.key(h.Clutter.KEY_Return); await h.wait(200);
        h.check(dialog.values.cityAuto && (mainland ? dialog.values.station === '58606' : dialog.values.station === '' && Number.isFinite(dialog.values.latitude)), 'selecting a search result fills the region-appropriate location fields');
        await h.screenshot('weather-location-options.png'); dialog.apply();
        for (let i = 0; i < 100 && weather.busy; i++) await h.wait(100);
        h.check(mainland ? weather.data?.station === '58606' && weather.city.text === '南昌' : weather.data?.station === '' && weather.city.text === dialog.values.city, 'selected city live weather and automatic address are rendered');
        weather.setSize('large');
        for (let i = 0; i < 100 && weather.busy; i++) await h.wait(100);
        h.check(weather.forecasts.length === 3 && weather.forecasts.every(day => /\d/.test(day.temperatures.text)), 'native large weather displays three real forecasts');
        await h.screenshot('weather-large.png');
        weather.save({cityAuto: false, city: '我的天气'}); weather.refreshOptions();
        for (let i = 0; i < 100 && weather.busy; i++) await h.wait(100);
        h.check(weather.city.text === '我的天气', 'custom city label overrides automatic address without changing the provider');
    } finally { scope.destroy(); app.closeOptions(); }
}
