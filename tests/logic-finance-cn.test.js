// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeStockInput, pickSuggest, ulistUrl, parseUlist, parseForexList, buildRateTable, crossRate, forexUrls, currencyCode, marketStatus} from '../extension/lib/logic/finance-cn.js';
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url)));

test('mainland finance responses normalize real prices, timestamps, CNY rates', () => {
    const stocks = parseUlist(fixture('eastmoney-quotes'));
    assert.equal(stocks[0].code, '600519'); assert.ok(stocks[0].price > 100); assert.ok(stocks[0].time > 1e9);
    const forex = parseForexList(fixture('forex-cny')); const table = buildRateTable(forex);
    const usd = crossRate(table, 'USD', 'CNY'); assert.ok(usd.rate > 5 && usd.rate < 10); assert.equal(usd.source, 'Central parity');
    assert.ok(Math.abs(crossRate(table, 'CNY', 'USD').rate * usd.rate - 1) < 1e-8);
    const jpy = forex.find(row => row.code === 'JPYCNYC'); assert.ok(jpy?.per100);
    assert.ok(crossRate(table,'JPY','CNY').rate < .1); assert.ok(crossRate(table,'EUR','JPY').rate > 100);
    assert.throws(() => crossRate(table,'USD','XYZ'));
    assert.throws(() => parseUlist({rc:0,data:{diff:[]}}));
    assert.throws(() => parseForexList({data:{diff:[{f12:'USDCNYC',f2:'-'}]}}));
});
test('symbol validation and URL creation use only free mainland-hosted services', () => {
    for (const input of ['600519','600519.SS','00700.HK','AAPL','1.600519']) assert.ok(normalizeStockInput(input));
    assert.equal(normalizeStockInput('600519').secid, '1.600519');
    for (const bad of ['','<script>','http://evil.test','a\nb']) assert.throws(() => normalizeStockInput(bad));
    assert.ok(ulistUrl(['1.600519']).startsWith('https://push2.eastmoney.com/'));
    assert.throws(() => ulistUrl(['../evil']));
    for (const url of Object.values(forexUrls())) assert.ok(url.startsWith('https://push2.eastmoney.com/'));
    assert.equal(currencyCode(' usd '),'USD'); assert.throws(() => currencyCode('bad code'));
    assert.throws(() => pickSuggest({QuotationCodeTable:{Status:0,Data:[]}},'doesnotexist'));
    assert.equal(marketStatus('1.600519', null, Date.parse('2026-09-12T12:00:00+08:00')).label,'Market closed');
});
