// SPDX-License-Identifier: MIT
import {_, format} from './i18n.js';
// City lookup remains on demand. The separate startup probe selects data sources
// without asking GeoClue for a fix or changing the user's weather city.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Scope} from './platform.js';
export async function searchStations(host, scope, query) { return host.sources.searchLocations(scope, query); }
export async function stationDetails(host, scope, id) { return host.sources.stationDetails(scope, id); }
export async function stationFromCoordinates(host, scope, latitude, longitude) { return host.sources.locationFromCoordinates(scope, latitude, longitude); }
function busCall(bus, path, iface, method, parameters, scope, timeout = 5000) {
    return new Promise((resolve, reject) => bus.call('org.freedesktop.GeoClue2', path, iface, method, parameters, null,
        Gio.DBusCallFlags.NONE, timeout, scope?.cancellable ?? null, (connection, result) => {
            try { resolve(connection.call_finish(result).deep_unpack()); } catch (e) { reject(e); }
        }));
}
export async function systemLocation(owner, timeoutMs = 6000) {
    const scope = new Scope(), bus = Gio.DBus.system;
    const cancel = owner.cancellable.connect(() => scope.cancellable.cancel());
    scope.later(timeoutMs, () => scope.cancellable.cancel());
    let path = null, subscription = 0;
    try {
        [path] = await busCall(bus, '/org/freedesktop/GeoClue2/Manager', 'org.freedesktop.GeoClue2.Manager', 'GetClient', null, scope);
        for (const [key, value] of [['DesktopId', new GLib.Variant('s', 'classic-gadgets')], ['RequestedAccuracyLevel', new GLib.Variant('u', 4)]])
            await busCall(bus, path, 'org.freedesktop.DBus.Properties', 'Set', new GLib.Variant('(ssv)', ['org.freedesktop.GeoClue2.Client', key, value]), scope);
        return await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (value, error) => { if (settled) return; settled = true; if (error) reject(error); else resolve(value); };
            scope.cancellable.connect(() => finish(null, new Error(_("System location timed out or was cancelled"))));
            const read = async location => {
                if (!location || location === '/' || settled) return;
                try {
                    const [props] = await busCall(bus, location, 'org.freedesktop.DBus.Properties', 'GetAll', new GLib.Variant('(s)', ['org.freedesktop.GeoClue2.Location']), scope);
                    const latitude = props.Latitude?.deep_unpack(), longitude = props.Longitude?.deep_unpack();
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(_("The system did not provide a valid location"));
                    finish({latitude, longitude});
                } catch (e) { finish(null, e); }
            };
            subscription = bus.signal_subscribe('org.freedesktop.GeoClue2', 'org.freedesktop.GeoClue2.Client', 'LocationUpdated', path, null, Gio.DBusSignalFlags.NONE,
                (_bus, _sender, _path, _iface, _signal, params) => read(params.deep_unpack()[1]));
            (async () => {
                try {
                    await busCall(bus, path, 'org.freedesktop.GeoClue2.Client', 'Start', null, scope);
                    const [value] = await busCall(bus, path, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', ['org.freedesktop.GeoClue2.Client', 'Location']), scope);
                    read(value.deep_unpack());
                } catch (e) { finish(null, e); }
            })();
        });
    } finally {
        if (subscription) bus.signal_unsubscribe(subscription);
        owner.cancellable.disconnect(cancel); scope.destroy();
        // Cleanup is independent of the cancelled request. Never leave a GeoClue
        // client tracking the user after closing the options window.
        if (path) {
            busCall(bus, path, 'org.freedesktop.GeoClue2.Client', 'Stop', null, null, 1500).catch(() => {});
            busCall(bus, '/org/freedesktop/GeoClue2/Manager', 'org.freedesktop.GeoClue2.Manager', 'DeleteClient', new GLib.Variant('(o)', [path]), null, 1500).catch(() => {});
        }
    }
}
export async function locateByIp(host, scope) { return host.sources.locateByIp(scope); }
export async function locate(host, scope, {timeoutMs = 6000} = {}) {
    await host.sources.wait(scope);
    try {
        const {latitude, longitude} = await systemLocation(scope, timeoutMs);
        return await stationFromCoordinates(host, scope, latitude, longitude);
    } catch (e) {
        if (!scope.alive || scope.cancellable.is_cancelled()) throw new Error(_("Location request cancelled"));
        try { return await locateByIp(host, scope); }
        catch (ipError) { throw new Error(format(_("Location failed: {error}. You can search for a city without entering coordinates."), {error: ipError.message})); }
    }
}
