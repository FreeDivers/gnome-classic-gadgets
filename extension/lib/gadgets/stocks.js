// SPDX-License-Identifier: MIT
import {_, format, formatNumber} from '../i18n.js';
import {NetworkGadget} from './network-gadget.js';
import {marketStatus, quoteTimeLabel} from '../logic/finance-cn.js';

export default class Stocks extends NetworkGadget {
    symbols() { return (Array.isArray(this.options.symbols) && this.options.symbols.length ? this.options.symbols : [this.options.symbol || '600519']).slice(0, 10); }
    optionsSpec() { return [
        {type: 'entry', key: 'symbols', label: _("Stock symbols (one per line, up to 10)"), multiline: true, default: this.symbols(),
            format: value => Array.isArray(value) ? value.join('\n') : String(value ?? ''), parse: value => {
                const symbols = String(value).split(/[,，\s]+/).filter(Boolean); if (!symbols.length || symbols.length > 10) throw new Error(_("Enter 1–10 stock symbols"));
                symbols.forEach(symbol => this.host.sources.validateStock(symbol)); return [...new Set(symbols)];
            }, hint: _("For example, 600519, 000001.SZ, 00700.HK or AAPL. Eastmoney codes such as 1.600519 are also supported.")},
        {type: 'text', label: _("Automatically chooses Eastmoney or Yahoo Finance. Quotes may be delayed.")}]; }
    refreshOptions() { this.rebuild(); }
    build() {
        const count = this.large ? Math.max(3, Math.min(5, this.symbols().length)) : Math.max(1, Math.min(3, this.symbols().length));
        this.resize(this.large ? 323 : 130, this.large ? 153 + (count - 3) * 33 : 76 + (count - 1) * 33);
        this.picture(`images/${this.large ? `stocks_undocked_0_0_${count}` : `stocks_docked_${count}`}.png`, 0, 0, this.width, this.height);
        this.rows = [];
        for (let i = 0; i < count; i++) {
            const y = (this.large ? 22 : 11) + i * 33;
            const row = {symbol: this.text('', this.large ? 20 : 10, y, this.large ? 120 : 53, this.large ? 21 : 17, 'og-stock-symbol'),
                price: this.text('—', this.large ? 142 : 65, y, this.large ? 76 : 55, this.large ? 21 : 17, 'og-stock-price og-numeric'),
                change: this.text('', this.large ? 224 : 10, this.large ? y : y + 17, this.large ? 76 : 110, this.large ? 18 : 15, 'og-stock-caption og-stock-change og-numeric'),
                state: this.large ? this.text('', 224, y + 18, 76, 13, 'og-stock-state') : null};
            this.rows.push(row);
        }
        this.symbol = this.rows[0].symbol; this.price = this.rows[0].price; this.change = this.rows[0].change;
        this.errorText = this.text(_("Updating…"), this.large ? 20 : 8, this.height - (this.large ? 38 : 26), this.width - (this.large ? 112 : 16), 14, 'og-stock-caption');
        this.details = this.text('', 0, 0, 0, 0); this.details.visible = false;
        this.page = 0;
        if (this.symbols().length > count) this.toolButton('view-more-symbolic', _("Next group of quotes"), () => { this.page = (this.page + 1) % Math.ceil(this.symbols().length / count); if (this.data) this.render(this.data); });
        this.startNetwork(600);
    }
    async fetchData(scope, force) { return this.host.sources.stocks(this.symbols(), scope, force); }
    render(data) {
        const rows = data.slice(this.page * this.rows.length, (this.page + 1) * this.rows.length);
        this.rows.forEach((row, i) => {
            const quote = rows[i];
            row.symbol.text = quote?.name ?? ''; row.price.text = quote ? (Number.isFinite(quote.price) ? formatNumber(quote.price, {minimumFractionDigits: quote.precision, maximumFractionDigits: quote.precision}) : '—') : '';
            const status = quote ? quote.status ?? marketStatus(quote.secid, quote.time).label : '';
            const shortStatus = status === _("Quote snapshot (may be delayed)") ? _("Delayed quote") : status;
            row.change.text = quote ? `${quote.changePct === null ? '—' : formatNumber(quote.changePct / 100, {style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'})}${this.large ? '' : ` · ${shortStatus}`}` : '';
            if (row.state) { row.state.text = shortStatus; row.state.accessible_name = status; }
            row.change.set_style(`color: ${quote?.changePct > 0 ? '#ef7770' : quote?.changePct < 0 ? '#75d599' : '#dedede'};`);
        });
        this.details.text = rows.length ? quoteTimeLabel(rows[0].time, Date.now(), rows[0].timezone || 'Asia/Shanghai') : '';
        this.errorText.text = this.details.text;
        this.sourceDetail = data.map(row => format(_('{name} ({code}) · {time}{zone} · {status}'), {name: row.name, code: row.code, time: quoteTimeLabel(row.time, Date.now(), row.timezone || 'Asia/Shanghai'), zone: row.timezone ? format(_(' ({value})'), {value: row.timezone}) : '', status: row.status ?? marketStatus(row.secid, row.time).label})).join('\n');
    }
    showFailure(text) { if (text) this.errorText.text = text; }
}
