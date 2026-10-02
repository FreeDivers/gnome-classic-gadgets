// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readableTextScale} from '../extension/lib/logic/typography.js';

test('ordinary readings retain their full size and are measured only once', () => {
    let calls = 0;
    assert.equal(readableTextScale(scale => { calls++; return 50 * scale; }, 100, .7), 1);
    assert.equal(calls, 1);
});
test('hinted glyph widths are fitted by measurement, not an inaccurate linear ratio', () => {
    const measure = scale => Math.round(8 * scale) * 15;
    const scale = readableTextScale(measure, 103, 10 / 14);
    assert.ok(measure(scale) <= 103);
    assert.ok(scale >= 10 / 14 && scale < 1);
    assert.ok(measure(103 / measure(1)) > 103, 'one-shot scaling would still truncate');
});
test('extreme values stop shrinking at the readable minimum', () => {
    assert.equal(readableTextScale(scale => 1000 * scale, 50, .75), .75);
    assert.equal(readableTextScale(scale => 200 * scale, 50, 1), 1);
});
test('larger slots reset fitting; hidden/unallocated slots do not choose zero size', () => {
    assert.ok(readableTextScale(scale => 130 * scale, 100) < 1);
    assert.equal(readableTextScale(scale => 130 * scale, 200), 1);
    for (const width of [0, -1, NaN, Infinity]) assert.equal(readableTextScale(() => 100, width), 1);
});
