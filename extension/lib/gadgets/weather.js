// SPDX-License-Identifier: MIT
import {_, format, formatDate, formatNumber} from '../i18n.js';
import {NetworkGadget} from './network-gadget.js';
import {cmaUrls, cmaArt, cmaIcon, isNightNow, moonPhase, autoLabel} from '../logic/weather-cn.js';
import {locate, searchStations, stationFromCoordinates} from '../location.js';

export default class Weather extends NetworkGadget {
    optionsSpec() {
        const select = (location, dialog) => {
            dialog.set('station', location.station ?? location.id ?? ''); dialog.set('city', location.name);
            dialog.set('coordinateStation', Number.isFinite(location.latitude) ? (location.station ?? location.id ?? '') : '');
            if (Number.isFinite(location.latitude)) dialog.set('latitude', location.latitude);
            if (Number.isFinite(location.longitude)) dialog.set('longitude', location.longitude);
            dialog.set('cityAuto', true); dialog.set('locationMethod', location.method ?? _("Manual station selection"));
        };
        return [
            {type: 'search', key: '_citySearch', group: _("Location"), label: _("Search cities or districts"), placeholder: _("For example, Shanghai, Beijing or London"),
                provider: (query, scope) => searchStations(this.host, scope, query),
                onPick: (item, dialog) => select(item, dialog)},
            {type: 'button', group: _("Location"), icon: 'find-location-symbolic', label: _("Find my location"), progress: _("Finding location…"),
                onClick: async dialog => { const result = await locate(this.host, dialog.scope); select(result, dialog); return format(_("Found {location} ({method}). Check the location, then click OK."), {location: result.name, method: result.method}); }},
            {type: 'text', group: _("Location"), label: _("IP location can be inaccurate. Search for a city to correct it.")},
            {type: 'entry', key: 'station', group: _("Location"), advanced: _("Manual location"), label: _("Station ID (optional)"), hint: _("Only used by the CMA source. Other sources use latitude and longitude."), validate: id => { if (id) cmaUrls.view(id); }},
            {type: 'switch', key: 'cityAuto', group: _("Location"), label: _("Show place name automatically")},
            {type: 'entry', key: 'city', group: _("Location"), sensitiveWhen: {key: 'cityAuto', equals: false}, label: _("Custom place name")},
            {type: 'switch', key: 'fahrenheit', group: _("Temperature"), label: _("Use Fahrenheit (°F)")},
            {type: 'entry', key: 'latitude', group: _("Location"), advanced: _("Manual location"), label: _("Latitude"), number: {min: -90, max: 90}},
            {type: 'entry', key: 'longitude', group: _("Location"), advanced: _("Manual location"), label: _("Longitude"), number: {min: -180, max: 180}},
            {type: 'button', group: _("Location"), advanced: _("Manual location"), icon: 'mark-location-symbolic', label: _("Use these coordinates"), hint: _("Selects the nearest station when using station-based weather data"), onClick: async dialog => {
                const result = await stationFromCoordinates(this.host, dialog.scope, Number(dialog.values.latitude), Number(dialog.values.longitude));
                select({...result, method: _("Manual coordinates")}, dialog); return format(_("Selected {location}"), {location: result.name});
            }},
        ];
    }
    build() {
        const large = this.large;
        this.background = this.picture(`images/${large ? 'BLUE' : 'BLUEDOCKED'}-base.png`, 0, 0, this.width, this.height);
        this.moon = this.picture(`images/${large ? 'undocked' : 'docked'}_moon-full.png`, 0, 0, this.width, this.height); this.moon.visible = false;
        this.visual = this.picture(`images/${large ? 'undocked' : 'docked'}_sun.png`, 0, 0, this.width, this.height);
        this.highlights = [1, 2].map(n => this.picture(`images/${large ? 'BLUE' : 'BLUEDOCKED'}-highlight-0${n}.png`, large ? 13 : 3, large ? 13 : 3, large ? 230 : 123, large ? 160 : 60));
        this.temperature = this.text('—°', large ? 145 : 54, large ? 4 : 0, large ? 95 : 70, large ? 46 : 34, 'og-weather-temperature og-numeric');
        this.city = this.text(String(this.options.city || ''), large ? 18 : 6, large ? 76 : 34, large ? 222 : 116, large ? 22 : 17, 'og-weather-city');
        this.errorText = this.text(_("Updating…"), large ? 18 : 6, large ? 156 : 50, large ? 222 : 116, large ? 17 : 13, 'og-weather-error');
        this.details = this.text('', large ? 32 : 0, large ? 43 : 0, large ? 207 : 0, large ? 17 : 0, 'og-weather-condition'); this.details.visible = large;
        this.highLow = this.text('', 124, 61, 116, 17, 'og-weather-condition og-numeric'); this.highLow.visible = large;
        this.forecasts = [];
        if (large) for (let i = 0; i < 3; i++) {
            const x = 18 + i * 77;
            this.forecasts.push({day: this.text('—', x, 99, 71, 19, 'og-weather-forecast-day'),
                icon: this.picture('images/44.png', x + 26, 118, 42, 34),
                temperatures: this.text('—', x, 118, 32, 16, 'og-weather-forecast og-numeric'),
                low: this.text('—', x, 134, 32, 16, 'og-weather-forecast og-numeric')});
        }
        if (large) {
            for (const x of [89, 166]) this.picture('images/divider-vertical.png', x, 108, 2, 44);
            this.picture('images/divider-horizontal.png', 14, 154, 228, 2);
            this.attribution = this.text(_("Checking data sources…"), 18, 156, 224, 17, 'og-weather-attribution');
        } else this.attribution = null;
        this.startNetwork(600);
    }
    async fetchData(scope, force) {
        const result = await this.host.sources.weather(this.options, scope, force);
        if (scope.alive && Object.entries(result.optionPatch ?? {}).some(([key, value]) => this.options[key] !== value)) this.save(result.optionPatch);
        return result;
    }
    showFailure(text) { this.errorText.text = text; if (this.attribution) this.attribution.visible = !text; }
    temperatureText(value) { return Number.isFinite(value) ? `${formatNumber(Math.round(this.options.fahrenheit ? value * 9 / 5 + 32 : value))}°` : '—'; }
    render(data) {
        this.city.text = this.options.cityAuto !== false ? autoLabel(data) : String(this.options.city || autoLabel(data));
        this.temperature.text = this.temperatureText(data.temperature);
        const today = data.days[0], night = typeof data.isDay === 'boolean' ? !data.isDay : isNightNow(new Date(), data);
        const code = Object.hasOwn(data, 'currentCode') ? data.currentCode : night ? today.nightCode : today.dayCode;
        if (this.attribution) this.attribution.text = format(_("Data source: {provider}"), {provider: this.provider});
        const art = cmaArt(code, night), mode = this.large ? 'undocked' : 'docked', backdrop = `${art.backdrop}${this.large ? '' : 'DOCKED'}`;
        this.setPicture(this.background, `images/${backdrop}-base.png`);
        this.highlights.forEach((image, n) => this.setPicture(image, `images/${backdrop}-highlight-0${n + 1}.png`));
        this.visual.visible = !!art.art; if (art.art) this.setPicture(this.visual, `images/${mode}_${art.art}.png`);
        this.moon.visible = art.moon; if (art.moon) this.setPicture(this.moon, `images/${mode}_moon-${moonPhase(new Date())}.png`);
        this.details.text = data.currentText || (night ? today.nightText : today.dayText) || _("Weather");
        this.highLow.text = `${this.temperatureText(today.high)} / ${this.temperatureText(today.low)}`;
        const color = night ? '#f0f0f0' : '#111111';
        for (const label of [this.temperature, this.city, this.details, this.highLow, this.errorText]) label.set_style(`color: ${color};`);
        this.forecasts.forEach((column, i) => {
            const forecast = data.days[i + 1] ?? data.days[i] ?? data.days[data.days.length - 1];
            const date = new Date(`${forecast.date.replaceAll('/', '-')}T12:00:00Z`);
            column.day.text = formatDate(date, {weekday: 'short', timeZone: 'UTC'});
            column.temperatures.text = this.temperatureText(forecast.high); column.low.text = this.temperatureText(forecast.low);
            this.setPicture(column.icon, `images/${cmaIcon(forecast.dayCode)}.png`);
            const dim = art.backdrop === 'BLUE' ? '#cce8ff' : art.backdrop === 'GRAY' ? '#e1e5e9' : '#e0e0e0';
            column.day.set_style(`color: ${dim};`); column.low.set_style(`color: ${dim};`); column.temperatures.set_style('color: #fbfbfb;');
            this.attribution?.set_style(`color: ${dim};`);
        });
        this.sourceDetail = format(_("Location {location}{station} · Updated {time}{zone}\nHumidity {humidity}% · Wind {wind} m/s"), {location: data.name, station: data.station ? format(_(' ({value})'), {value: data.station}) : '', time: data.updated, zone: data.timezoneName ? format(_(' ({value})'), {value: data.timezoneName}) : '', humidity: Number.isFinite(data.humidity) ? formatNumber(data.humidity) : '—', wind: Number.isFinite(data.windSpeed) ? formatNumber(data.windSpeed) : '—'});
    }
}
