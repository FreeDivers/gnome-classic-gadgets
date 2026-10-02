// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
import {currencyCode} from './finance-cn.js';
import {jsonObject} from './network-region.js';

const str = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function frankfurterUrl(base, quotes) {
    const b = currencyCode(base), targets = [...new Set(quotes.map(currencyCode))].filter(code => code !== b);
    if (!targets.length) return null;
    return `https://api.frankfurter.dev/v1/latest?base=${b}&symbols=${targets.join(',')}`;
}
export function parseFrankfurter(value, base, quotes) {
    const data = jsonObject(value, 'Frankfurter'), b = currencyCode(base);
    if (data.base !== b || data.amount !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(str(data.date)) || !data.rates || typeof data.rates !== 'object') throw new Error(_("Frankfurter returned an invalid exchange rate"));
    const time = Date.parse(`${data.date}T00:00:00Z`) / 1000;
    if (!Number.isFinite(time)) throw new Error(_("Invalid Frankfurter exchange rate date"));
    const rates = quotes.map(currencyCode).map(quote => {
        const rate = quote === b ? 1 : num(data.rates[quote]);
        if (rate === null || rate <= 0) throw new Error(format(_("Frankfurter does not support or did not return a {base}/{quote} rate"), {base: b, quote: quote}));
        return {quote, rate, time, date: data.date, source: quote === b ? _("Same currency") : _("ECB reference rate")};
    });
    if (!rates.length) throw new Error(_("Select a target currency"));
    return {rates, rate: rates[0].rate, date: data.date};
}
export function yahooInput(input) {
    const raw = String(input ?? '').normalize('NFKC').trim();
    if (!raw || raw.length > 64 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error(_("Enter a valid stock symbol"));
    let symbol = raw.toUpperCase(), m;
    if ((m = /^(0|1|105|106|107|116)\.([A-Z0-9.-]+)$/.exec(symbol))) {
        const [, market, code] = m;
        if (market === '0' || market === '1') symbol = `${code}.${market === '1' ? 'SS' : /^[489]/.test(code) ? 'BJ' : 'SZ'}`;
        else if (market === '116') symbol = `${Number(code).toString().padStart(4, '0')}.HK`;
        else symbol = code;
    }
    if (/^\d{6}$/.test(symbol)) symbol += /^[5679]/.test(symbol) ? '.SS' : /^[48]/.test(symbol) ? '.BJ' : '.SZ';
    if ((m = /^(SH|SS|SZ|BJ)(\d{6})$/.exec(symbol))) symbol = `${m[2]}.${m[1] === 'SH' ? 'SS' : m[1]}`;
    symbol = symbol.replace(/\.SH$/, '.SS').replace(/\.US$/, '');
    if ((m = /^(\d{1,5})(?:\.HK)?$/.exec(symbol))) symbol = `${Number(m[1]).toString().padStart(4, '0')}.HK`;
    if (/^BRK\.[AB]$/.test(symbol)) symbol = symbol.replace('.', '-');
    if (/^[A-Z0-9^][A-Z0-9.^=\-]{0,23}$/.test(symbol)) return {symbol};
    if (/^[\p{L}\p{N} .*-]{1,64}$/u.test(raw)) return {query: raw};
    throw new Error(_("Enter a valid stock symbol, such as AAPL, 600519.SS, 0700.HK or ^GSPC"));
}
export function yahooChartUrl(symbol, mirror = false) {
    const parsed = yahooInput(symbol);
    if (!parsed.symbol) throw new Error(_("Enter a stock symbol"));
    // With range=1d chartPreviousClose is the previous session, NOT the start of a multi-day range.
    return `https://query${mirror ? 2 : 1}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(parsed.symbol)}?interval=1d&range=1d`;
}
export function yahooSearchUrl(query) { return `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`; }
export function parseYahooSearch(value, query) {
    const data = jsonObject(value, _("Yahoo Finance search"));
    const rows = (Array.isArray(data.quotes) ? data.quotes : []).filter(row => row?.isYahooFinance !== false && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'FUTURE', 'CURRENCY'].includes(row?.quoteType));
    const row = rows.find(item => item.symbol === query || item.shortname === query || item.longname === query) ?? rows[0];
    if (!row || !yahooInput(row.symbol).symbol) throw new Error(_("Yahoo Finance could not find this security. Enter a stock symbol."));
    return yahooInput(row.symbol).symbol;
}
export function parseYahooChart(value) {
    const data = jsonObject(value, 'Yahoo Finance'), chart = data.chart;
    const meta = chart?.result?.[0]?.meta;
    if (chart?.error || !meta || !str(meta.symbol)) throw new Error(_("Yahoo Finance did not return a quote"));
    const price = num(meta.regularMarketPrice), time = num(meta.regularMarketTime);
    if (price === null || price < 0 || time === null || time <= 0) throw new Error(_("Invalid Yahoo Finance quote price or time"));
    const previous = num(meta.previousClose) ?? num(meta.chartPreviousClose);
    const change = previous !== null && previous > 0 ? (price / previous - 1) * 100 : null;
    const changePct = Number.isFinite(change) ? change : null;
    return {secid: '', code: str(meta.symbol), name: str(meta.shortName || meta.longName || meta.symbol), currency: str(meta.currency), price, changePct, time, timezone: str(meta.exchangeTimezoneName) || 'UTC',
        precision: Number.isInteger(meta.priceHint) ? Math.max(0, Math.min(6, meta.priceHint)) : 2, status: _("Quote snapshot (may be delayed)")};
}
