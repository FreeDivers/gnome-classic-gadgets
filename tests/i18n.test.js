// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_, ngettext, pgettext, format, formatNumber, formatDate, configureTranslations} from '../extension/lib/i18n.js';
import {GADGETS, formatBytes} from '../extension/lib/core.js';
import {formatRate, quoteTimeLabel} from '../extension/lib/logic/finance-cn.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args, env = {}) => execFileSync(command, args, {cwd: root, env: {...process.env, ...env}, encoding: 'utf8'});
const probe = (locale, language) => JSON.parse(run('gjs', ['-m', 'tests/i18n-probe.js', join(root, 'extension')], {LC_ALL: locale, LANG: locale, LANGUAGE: language}));

test('pure modules use English without GI and defer translations until access', () => {
    configureTranslations();
    assert.equal(GADGETS.clock.name, 'Clock');
    const backend = {gettext: s => `translated:${s}`, ngettext: (s, p, n) => `translated:${n === 1 ? s : p}`, pgettext: (context, s) => `${context}:${s}`};
    try {
        configureTranslations(backend, 'zh-CN');
        assert.equal(GADGETS.clock.name, 'translated:Clock');
        assert.equal(_('Settings'), 'translated:Settings');
        assert.equal(ngettext('item', 'items', 2), 'translated:items');
        assert.equal(pgettext('verb', 'Open'), 'verb:Open');
    } finally { configureTranslations(); }
    assert.equal(GADGETS.clock.name, 'Clock');
    assert.equal(ngettext('item', 'items', 0), 'items');
    assert.equal(ngettext('item', 'items', 1), 'item');
});

test('named placeholders reorder safely and do not reinterpret user content', () => {
    const name = '小北 {count} $& 100% <b>name</b>';
    assert.equal(format('{count}: {name}', {name, count: 2}), `2: ${name}`);
    assert.equal(format('{name} / {name}', {name}), `${name} / ${name}`);
    assert.equal(format('{missing}', {}), '{missing}');
    assert.equal(format('{constructor}', {}), '{constructor}');
});

test('GNU gettext loads Simplified Chinese in standalone GJS and lazy pure models', () => {
    const result = probe('zh_CN.UTF-8', 'zh_CN');
    assert.equal(result.before, 'Weather');
    assert.equal(result.brand, 'Windows Vista/7 小组件');
    assert.equal(result.settingsTitle, 'Windows Vista/7 小组件设置');
    assert.equal(result.enablePrompt, '请先启用 Windows Vista/7 小组件扩展');
    assert.equal(result.locale, 'zh-CN');
    assert.equal(result.weather, '天气'); assert.equal(result.locate, '定位当前位置');
    assert.equal(result.provider, '中国气象局'); assert.equal(result.region, '中国大陆');
    assert.equal(result.clear, '晴'); assert.equal(result.thunder, '雷雨'); assert.equal(result.moon, '满月');
    assert.equal(result.invalidNumber, '请输入数字');
    assert.equal(result.invalidStock, '请输入有效证券代码或名称，如 600519、00700、AAPL、贵州茅台');
    assert.equal(result.invalidSuggestion, result.invalidStock);
    assert.deepEqual(result.items, ['0 个项目', '1 个项目', '2 个项目']);
    assert.equal(result.weekday, '星期日');
    assert.deepEqual(result.chineseSearch, ['weather']); assert.deepEqual(result.englishSearch, ['weather']);
    assert.match(result.geocoding, /language=zh/); assert.match(result.geocoding, /%E4%B8%8A%E6%B5%B7/);
    assert.equal(result.savedUnchanged, true);
    assert.equal(result.userText, '我的便笺 {count} $& <b>hello</b>');
    assert.equal(result.missing, 'Message without a translation'); assert.equal(result.context, 'Open');
});

test('English and unavailable translations fall back without Chinese UI fragments', () => {
    for (const [locale, language] of [['C.UTF-8', 'en'], ['zh_CN.UTF-8', 'fr'], ['C', 'zh_CN'], ['C.UTF-8', 'zh_CN']]) {
        const result = probe(locale, language);
        assert.equal(result.weather, 'Weather'); assert.equal(result.locate, 'Find my location');
        assert.equal(result.brand, 'Windows Vista/7 Widgets');
        assert.equal(result.settingsTitle, 'Windows Vista/7 Widgets Settings');
        assert.equal(result.enablePrompt, 'Enable Windows Vista/7 Widgets first');
        assert.equal(result.provider, 'China Meteorological Administration'); assert.equal(result.region, 'Mainland China');
        assert.equal(result.clear, 'Clear'); assert.equal(result.thunder, 'Thunderstorms');
        assert.equal(result.invalidNumber, 'Enter a number');
        assert.equal(result.invalidStock, 'Enter a valid stock symbol or name, such as 600519, 00700, AAPL or Kweichow Moutai');
        assert.equal(result.invalidSuggestion, result.invalidStock);
        assert.deepEqual(result.items, ['0 items', '1 item', '2 items']);
        assert.ok(result.allNames.every(name => !/\p{Script=Han}/u.test(name)));
        assert.equal(result.savedUnchanged, true);
        assert.deepEqual(result.englishSearch, ['weather']);
        if (locale.startsWith('C')) assert.equal(result.locale, 'en');
    }
});

test('editing only the PO file changes GJS text; a missing MO safely falls back', () => {
    const temp = mkdtempSync(join(tmpdir(), 'classic-gadgets-i18n-'));
    try {
        mkdirSync(join(temp, 'lib'));
        for (const name of ['i18n.js', 'i18n-runtime.js']) copyFileSync(join(root, 'extension/lib', name), join(temp, 'lib', name));
        const script = join(temp, 'probe.js');
        writeFileSync(script, "import './lib/i18n-runtime.js'; import {_} from './lib/i18n.js'; print(_('Find my location'));\n");
        const environment = {LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN'};
        assert.equal(run('gjs', ['-m', script], environment).trim(), 'Find my location');
        const source = readFileSync(join(root, 'po/zh_CN.po'), 'utf8');
        assert.ok(source.includes('msgstr "定位当前位置"'));
        const changed = source.replace('msgstr "定位当前位置"', 'msgstr "查找我的位置（测试）"');
        const po = join(temp, 'zh_CN.po'); writeFileSync(po, changed);
        const folder = join(temp, 'locale/zh_CN/LC_MESSAGES'); mkdirSync(folder, {recursive: true});
        run('msgfmt', ['--check', '-o', join(folder, 'classic-gadgets.mo'), po]);
        assert.equal(run('gjs', ['-m', script], environment).trim(), '查找我的位置（测试）');
    } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('catalogs are complete and compiled MO matches the current PO', () => {
    assert.match(run('python3', ['scripts/i18n.py', 'check']), /PASS:/);
    const temp = mkdtempSync(join(tmpdir(), 'classic-gadgets-mo-'));
    try {
        const mo = join(temp, 'catalog.mo');
        run('msgfmt', ['--check', '-o', mo, 'po/zh_CN.po']);
        assert.deepEqual(readFileSync(mo), readFileSync(join(root, 'extension/locale/zh_CN/LC_MESSAGES/classic-gadgets.mo')));
    } finally { rmSync(temp, {recursive: true, force: true}); }
});

// A locale with comma decimals catches accidental use of toFixed/system defaults;
// this does not claim that a German message catalog is bundled.
test('display numbers and dates use the configured locale, not protocol formatting', () => {
    try {
        configureTranslations(null, 'de-DE');
        assert.equal(formatNumber(1234.5), '1.234,5');
        assert.equal(formatBytes(1.5 * 1024 ** 3), '1,5 GiB');
        assert.equal(formatRate(1234.5678), '1.234,568');
        assert.equal(formatRate(0.000012345678), '0,0000123457');
        assert.equal(formatRate(NaN), '—');
        assert.equal(formatNumber(0.1234, {style: 'percent', minimumFractionDigits: 2, signDisplay: 'always'}), '+12,34 %');
        assert.equal(formatDate(new Date('2026-01-04T23:00:00Z'), {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'}), '04.01.2026');
        configureTranslations(null, 'en-US');
        assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GiB');
        assert.equal(formatRate(0.000012345678), '0.0000123457');
    } finally { configureTranslations(); }
});

test('localized quote timestamps retain the market time zone and stale-date hint', () => {
    const seconds = Date.parse('2026-01-04T23:00:00Z') / 1000;
    try {
        configureTranslations(null, 'de-DE');
        // It is already January 5 in Shanghai, even though the UTC day is January 4.
        assert.equal(quoteTimeLabel(seconds, Date.parse('2026-01-05T02:00:00Z'), 'Asia/Shanghai'), '07:00');
        const older = quoteTimeLabel(seconds, Date.parse('2026-01-10T02:00:00Z'), 'Asia/Shanghai');
        assert.match(older, /^05\.01\./);
        assert.match(older, /07:00 \(non-trading day\)$/);
        assert.equal(quoteTimeLabel(NaN), '—');
        assert.equal(quoteTimeLabel(seconds, Date.parse('2026-01-05T02:00:00Z'), 'Unknown/ProviderZone'), '07:00');
        configureTranslations(null, 'en-US');
        assert.match(quoteTimeLabel(seconds, Date.parse('2026-01-10T02:00:00Z'), 'Asia/Shanghai'), /^01\/05/);
    } finally { configureTranslations(); }
});
