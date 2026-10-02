// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {GADGETS, optionsFor, sizeOf, validTheme, DEFAULT_OPTIONS} from '../extension/lib/core.js';
import {filterGadgets, pageItems, pageCount, clampPage, placeDialog, changedKeys, parseNumber, isDoubleClick, opacityToAlpha} from '../extension/lib/ui/ui-logic.js';

test('gallery contains all fourteen gadgets, with two pages and case-insensitive English fallback search', () => {
    const entries = Object.entries(GADGETS).map(([type, data]) => ({type, ...data}));
    assert.equal(pageCount(entries.length), 2); assert.equal(pageItems(entries, 1).length, 2);
    assert.equal(clampPage(999, entries.length), 1);
    assert.deepEqual(filterGadgets(entries, 'weather').map(e => e.type), ['weather']);
    assert.deepEqual(filterGadgets(entries, 'WEATHER').map(e => e.type), ['weather']);
    assert.equal(filterGadgets(entries, 'does not exist').length, 0);
});
test('options only commit edited keys, never overwrite concurrently changed runtime state', () => {
    const initial = {image: 1, moves: 18, tiles: [1, 2, 0]};
    assert.deepEqual(changedKeys(initial, {...initial, image: 11}), {image: 11});
    assert.deepEqual(changedKeys(initial, JSON.parse(JSON.stringify(initial))), {});
    assert.equal(parseNumber('1.25', {min: .5, max: 3}).value, 1.25);
    for (const input of ['', 'no', '-1', 'Infinity', '4']) assert.ok(parseNumber(input, {min: .5, max: 3}).error);
    assert.ok(parseNumber('2.5', {integer: true}).error);
});
test('options window is kept inside work area and tries either side of widget', () => {
    const area = {x: 0, y: 30, width: 1000, height: 700}, size = {width: 400, height: 300};
    assert.deepEqual(placeDialog({x: 20, y: 30, width: 130, height: 90}, size, area), {x: 158, y: 30});
    assert.deepEqual(placeDialog({x: 800, y: 600, width: 130, height: 90}, size, area), {x: 392, y: 430});
    assert.equal(opacityToAlpha(20), 51);
    assert.equal(isDoubleClick({target: 'a', time: 100}, {target: 'a', time: 300}), true);
    assert.equal(isDoubleClick({target: 'a', time: 100}, {target: 'b', time: 300}), false);
});
test('native size definitions, theme safety and settings migration', () => {
    assert.deepEqual(GADGETS.weather.large, {width: 264, height: 194});
    for (const [type, data] of Object.entries(GADGETS)) assert.equal(sizeOf(type, {size: 'large'}), data.large ? 'large' : 'small');
    assert.equal(validTheme('../../evil'), 'classic');
    assert.equal(optionsFor('calendar', {calendar: {expanded: true}}).size, 'large');
    assert.equal(optionsFor('rss', {rss: {url: 'https://feeds.bbci.co.uk/news/world/rss.xml'}}).url, 'https://feeds.bbci.co.uk/news/world/rss.xml');
    assert.equal(optionsFor('rss', {rss: {url: 'https://feeds.bbci.co.uk/news/world/rss.xml'}}).autoSource, false);
    assert.equal(optionsFor('rss').autoSource, true);
    assert.equal(optionsFor('rss', {rss: {url: 'https://example.cn/feed'}}).url, 'https://example.cn/feed');
    assert.ok(DEFAULT_OPTIONS.rss.url.startsWith('https://www.ithome.com/'));
});
