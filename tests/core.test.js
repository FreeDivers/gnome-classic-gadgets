import test from 'node:test';
import assert from 'node:assert/strict';
import {GADGETS, DEFAULT_ENABLED, enabledTypes, optionsFor, parseObject, monthGrid, shiftMonth, parseCpuStat, cpuPercent, parseMemory, formatBytes, fitPosition, defaultLayout, calculate, countdown, timerAction, formatDuration, SOLVED, validPuzzle, solvablePuzzle, solvedPuzzle, moveTile, shufflePuzzle, httpsUrl, decodeEntities, plainText, parseFeed, weatherDescription, parseWeather, parseRate, parseStock, validContacts} from '../extension/lib/core.js';

test('14 Windows Vista/7 widgets, safe defaults, unique valid enabled types', () => {
    assert.equal(Object.keys(GADGETS).length, 14);
    assert.deepEqual(DEFAULT_ENABLED, ['clock', 'calendar', 'system', 'notes']);
    assert.deepEqual(enabledTypes(['clock', 'bad', 'clock', 'timer']), ['clock', 'timer']);
    assert.equal(optionsFor('clock', {clock: {face: 'sage'}}).seconds, true);
    for (const bad of ['null', '[]', '{', '5']) assert.deepEqual(parseObject(bad), {});
});
test('calendar handles leap February and six-week months', () => {
    const leap = monthGrid(2024, 1);
    assert.equal(leap.length, 42);
    assert.equal(leap.filter(d => d.current).length, 29);
    assert.equal(leap[0].day, 29);
    assert.equal(monthGrid(2026, 1).filter(d => d.current).length, 28);
    assert.equal(monthGrid(2026, 7).filter(d => d.current).length, 31);
    assert.equal(monthGrid(2026, 2, false)[0].day, 1);
    assert.deepEqual(shiftMonth(2026, 11, 1), {year: 2027, month: 0});
    assert.deepEqual(shiftMonth(2026, 0, -1), {year: 2025, month: 11});
});
test('CPU sampling excludes double-counted guest ticks', () => {
    const p = parseCpuStat('cpu  100 10 50 800 30 5 3 2 20 5\ncpu0 50 0');
    assert.deepEqual(p, {total: 1000, idle: 830});
    assert.equal(cpuPercent(p, {total: 1100, idle: 900}), 30.000000000000004);
    assert.equal(cpuPercent(null, p), null);
    assert.equal(cpuPercent(p, p), null);
    assert.equal(cpuPercent(p, {total: 1, idle: 0}), null);
    assert.throws(() => parseCpuStat('cpu0 1 2 3 4'));
    assert.throws(() => parseCpuStat('cpu 1 nope 3 4'));
});
test('Linux memory uses MemAvailable, not just MemFree', () => {
    const mem = parseMemory('MemTotal: 1000 kB\nMemFree: 20 kB\nMemAvailable: 400 kB\nCached: 300 kB');
    assert.equal(mem.percent, 60); assert.equal(mem.used, 600 * 1024);
    assert.equal(parseMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nCached: 200 kB\nBuffers: 100 kB').percent, 60);
    assert.equal(parseMemory('MemTotal: 1000 kB\nMemAvailable: 2000 kB').used, 0);
    assert.throws(() => parseMemory('MemTotal: 0 kB'));
    assert.equal(formatBytes(1024 ** 3), '1.0 GiB');
    assert.equal(formatBytes(NaN), '—');
});
test('layout clamps missing monitor and offscreen positions', () => {
    const areas = [{x: 0, y: 32, width: 1600, height: 1000}, {x: 1600, y: 0, width: 800, height: 600}];
    assert.deepEqual(fitPosition({monitor: 1, x: 900, y: -50}, areas, 220, 245), {monitor: 1, x: 580, y: 0, stageX: 2180, stageY: 0});
    assert.equal(fitPosition({monitor: 99, x: NaN, y: Infinity}, [areas[0]], 220, 245).monitor, 0);
    const layout = defaultLayout(DEFAULT_ENABLED, areas[0]);
    assert.ok(layout.clock.x >= 0 && layout.notes.y >= 0);
    assert.ok(fitPosition({x: 99, y: 99}, [{x: 0, y: 0, width: 100, height: 100}], 220, 245).x === 0);
});
for (const [expression, result] of [['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4], ['2^-2', 0.25], ['50%', 0.5], ['200*15%', 30], ['sqrt(81)+abs(-2)', 11], ['sin(pi/2)', 1], ['log(100)+ln(e)', 3], ['3×4−6÷2', 9], ['1e3 + .5', 1000.5], ['-0', 0]]) {
    test(`calculator: ${expression}`, () => assert.equal(calculate(expression), result));
}
for (const expression of ['1/0', 'sqrt(-1)', '1+', 'alert(1)', 'process.exit()', '2(3)', '1;2', '1e999', '', '('.repeat(50) + '1' + ')'.repeat(50)]) {
    test(`calculator rejects unsafe/invalid: ${expression.slice(0, 30)}`, () => assert.throws(() => calculate(expression)));
}
test('timer start, pause, resume, reset and sleep recovery use deadline', () => {
    const state = {duration: 60, remaining: 60, running: false, deadline: 0};
    const running = timerAction(state, 'start', 1000);
    assert.equal(running.deadline, 61000);
    assert.equal(countdown(running, 2000), 59);
    const paused = timerAction(running, 'pause', 22000);
    assert.equal(countdown(paused, 99000), 39);
    assert.equal(countdown(timerAction(paused, 'start', 100000), 101000), 38);
    assert.equal(countdown(running, 61001), 0);
    assert.equal(countdown(timerAction(running, 'reset')), 60);
    assert.equal(formatDuration(3661), '1:01:01');
});
test('puzzle shuffles are valid, solvable, non-trivial; moves are adjacent only', () => {
    assert.ok(validPuzzle([...SOLVED])); assert.ok(solvedPuzzle([...SOLVED])); assert.ok(solvablePuzzle([...SOLVED]));
    assert.equal(moveTile([...SOLVED], 0), null);
    const one = moveTile([...SOLVED], 14); assert.equal(one[14], 0);
    assert.ok(solvedPuzzle(moveTile(one, 15)));
    const impossible = [...SOLVED]; [impossible[0], impossible[1]] = [impossible[1], impossible[0]];
    assert.equal(solvablePuzzle(impossible), false);
    for (let seed = 1; seed <= 100; seed++) {
        let x = seed;
        const tiles = shufflePuzzle(() => { x = (1664525 * x + 1013904223) >>> 0; return x / 2 ** 32; });
        assert.ok(validPuzzle(tiles) && solvablePuzzle(tiles) && !solvedPuzzle(tiles));
    }
});
test('network URLs require HTTPS and reject credentials and control characters', () => {
    assert.equal(httpsUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
    for (const url of ['http://example.com', 'file:///tmp/a', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://examp\\le.com', 'https://x.com/\nx']) assert.throws(() => httpsUrl(url));
});
test('RSS and Atom titles become plain text; non-HTTPS links skipped', () => {
    assert.equal(decodeEntities('&#x1F30D; &amp; &#65;'), '🌍 & A');
    assert.equal(plainText('<![CDATA[Hello <b>world</b>]]>'), 'Hello world');
    const rss = '<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://example.com/a</link></item><item><title>unsafe</title><link>javascript:alert(1)</link></item></channel></rss>';
    assert.deepEqual(parseFeed(rss), [{title: 'A & B', url: 'https://example.com/a'}]);
    const atom = '<feed><entry><title>Test</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/a?a=1&amp;b=2"/></entry></feed>';
    assert.deepEqual(parseFeed(atom), [{title: 'Test', url: 'https://example.com/a?a=1&b=2'}]);
    assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'));
    assert.throws(() => parseFeed('<rss/>'));
});
test('weather, rates, and market parsers reject missing/invalid values', () => {
    assert.equal(parseWeather({current: {temperature_2m: 21, weather_code: 0}, daily: {time: ['2026-09-08'], temperature_2m_min: [18], temperature_2m_max: [25]}}).days[0].high, 25);
    assert.throws(() => parseWeather({current: {temperature_2m: '21'}}));
    assert.equal(weatherDescription(95)[0], 'Thunderstorms');
    assert.equal(weatherDescription(999)[0], 'Unknown weather');
    assert.equal(parseRate({base: 'USD', date: '2026-09-08', rates: {CNY: 6.7}}, 'USD', 'CNY').rate, 6.7);
    assert.throws(() => parseRate({base: 'USD', rates: {CNY: -1}}, 'USD', 'CNY'));
    assert.equal(parseStock('Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-09-08,15:00,220,230,219,225,100').close, 225);
    assert.throws(() => parseStock('Symbol,Date,Time,Open,High,Low,Close\nN/D,N/D,N/D,N/D,N/D,N/D,N/D'));
});
test('contacts reject malformed entries and bound the data volume', () => {
    assert.deepEqual(validContacts([{name: '小北', phone: '123'}, null, {}, 3]), [{name: '小北', phone: '123', email: ''}]);
    assert.equal(validContacts(Array.from({length: 200}, () => ({name: 'a'}))).length, 100);
});
