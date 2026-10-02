// SPDX-License-Identifier: MIT
import {_, getLocale} from '../i18n.js';
import St from 'gi://St';
import {styleText} from '../typography.js';
import {finite} from '../core.js';
import {place} from '../gadget.js';
import {NetworkGadget} from './network-gadget.js';
import {currencyCode, quoteTimeLabel} from '../logic/finance-cn.js';

export default class Currency extends NetworkGadget {
    quotes() { return (Array.isArray(this.options.quotes) && this.options.quotes.length ? this.options.quotes : [this.options.quote || 'CNY']).slice(0, 3).map(currencyCode); }
    optionsSpec() {
        return [{type: 'entry', key: 'base', label: _("Base currency"), parse: currencyCode},
            {type: 'entry', key: 'quotes', label: _("Target currencies (up to 3)"), default: this.quotes(), format: value => Array.isArray(value) ? value.join(', ') : String(value ?? ''),
                parse: value => { const codes = String(value).split(/[,，\s]+/).filter(Boolean).map(currencyCode); if (!codes.length || codes.length > 3) throw new Error(_("Enter 1–3 currency codes, such as CNY, EUR, JPY")); return [...new Set(codes)]; }},
            {type: 'entry', key: 'amount', label: _("Amount to convert"), number: {min: 0, max: 1e12}},
            {type: 'text', label: _("Automatically chooses Eastmoney or Frankfurter / ECB reference rates. Unsupported currencies show an error. CNY and CNH are not interchangeable.")}];
    }
    refreshOptions() { this.rebuild(); }
    build() {
        const quotes = this.quotes(), large = this.large;
        if (large) this.resize(254, 171 + (quotes.length - 1) * 55);
        this.picture(`images/${large ? `base-undocked-${quotes.length + 1}` : 'base-docked'}.png`, 0, 0, this.width, this.height);
        const base = currencyCode(this.options.base);
        this.baseLabel = this.text(base, large ? 32 : 9, large ? 16 : 9, large ? 170 : 41, 21, 'og-currency-code og-numeric');
        this.amount = new St.Entry({text: String(this.options.amount), style_class: 'og-currency-input', can_focus: true});
        place(this.body, this.amount, large ? 32 : 51, large ? 40 : 9, large ? 180 : 72, 21);
        styleText(this.amount, {numeric: true});
        this.results = [];
        (large ? quotes : quotes.slice(0, 1)).forEach((quote, i) => {
            const label = this.text(quote, large ? 32 : 9, large ? 70 + i * 55 : 36, large ? 170 : 41, 21, 'og-currency-code og-numeric');
            const value = this.text('—', large ? 32 : 51, large ? 94 + i * 55 : 36, large ? 180 : 72, 21, 'og-currency-result og-numeric');
            this.results.push({label, value});
        });
        this.quoteLabel = this.results[0].label; this.result = this.results[0].value;
        this.rate = this.text('', large ? 20 : 6, this.height - (large ? 44 : 20), large ? 194 : 116, 16, 'og-currency-date');
        this.scope.connect(this.amount.clutter_text, 'activate', () => {
            const value = Number(this.amount.get_text());
            if (!Number.isFinite(value) || value < 0 || value > 1e12) { this.rate.text = _("Invalid amount"); return; }
            this.save({amount: value}); if (this.data) this.render(this.data);
        });
        this.startNetwork(3600);
    }
    async fetchData(scope, force) { return this.host.sources.currency(this.options, scope, force); }

    render(data) {
        this.results.forEach((row, i) => { row.value.text = (finite(Number(this.options.amount), 100) * data.rates[i].rate).toLocaleString(getLocale(), {maximumFractionDigits: this.large ? 5 : 2}); });
        this.rate.text = `${data.rates[0].source} ${data.date}`;
        this.sourceDetail = data.rates.map(row => `${this.options.base}/${row.quote} = ${row.rate} · ${row.source} · ${row.date ?? quoteTimeLabel(row.time)}`).join('\n');
    }
    showFailure(text) { if (text) this.rate.text = text; }
}
