// SPDX-License-Identifier: MIT
import {_, format, formatDate} from '../i18n.js';
// All network gadgets wait on ONE per-enable region decision. Offline gadgets
// are built immediately; cancelling a widget while it waits never starts a fetch.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {GADGETS} from '../core.js';
import {Scope} from '../platform.js';
import {Gadget} from '../gadget.js';

export class NetworkGadget extends Gadget {
    startNetwork(interval) {
        this.provider = _("Checking data sources"); this.providerUri = null;
        this.requestScope?.destroy(); this.requestScope = null; this.busy = false;
        this.networkStatus = this.text(this.host.sources.description, 0, 0, 0, 0); this.networkStatus.visible = false;
        this.toolButton('↻', _("Refresh online data"), () => this.refresh(true));
        this.toolButton('i', _("Data source and update time"), () => Main.notify(`${GADGETS[this.type].name} · ${this.provider}`, this.networkStatus.text));
        this.scope.later(interval * 1000, () => this.refresh(), true); this.refresh();
    }
    refreshOptions() { this.refresh(true); }
    async refresh(force = false) {
        if (this.busy && !force) return;
        this.requestScope?.destroy();
        const scope = this.requestScope = new Scope(); this.busy = true;
        this.networkStatus.text = this.host.sources.status.state === 'detecting' ? this.host.sources.description : _("Updating…");
        try {
            await this.host.sources.wait(scope);
            if (!this.scope.alive) return;
            const source = this.host.sources.source(this.type, this.options);
            this.provider = source.name; this.providerUri = source.url; this.sourceDetail = '';
            const result = await this.fetchData(scope, force);
            if (!scope.alive || !this.scope.alive) return;
            this.data = result.value; this.render(result.value);
            const time = formatDate(new Date(result.saved), {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
            this.networkStatus.text = `${this.provider} · ${result.stale ? format(_("Update failed; showing cached data from {time}"), {time}) : format(_("Updated {time}"), {time})}\n${this.host.sources.description}${this.sourceDetail ? `\n${this.sourceDetail}` : ''}`;
            this.showFailure?.(result.stale ? _("Cached data") : '');
            this.actor.accessible_name = format(_('{widget}; {details}'), {widget: GADGETS[this.type].name, details: this.networkStatus.text});
        } catch (e) {
            if (scope.alive && this.scope.alive) { this.networkStatus.text = format(_("{provider} · Update failed: {error}\n{region}"), {provider: this.provider, error: e.message, region: this.host.sources.description}); this.showFailure?.(_("Cannot connect to the service")); }
        } finally { if (scope === this.requestScope) this.busy = false; }
    }
}
export default NetworkGadget;
