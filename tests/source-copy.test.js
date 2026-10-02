// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('network settings describe sources without repeated geographic comparisons', () => {
    for (const name of ['prefs.js', 'lib/gadgets/weather.js', 'lib/gadgets/currency.js', 'lib/gadgets/stocks.js', 'lib/gadgets/rss.js', 'lib/network-sources.js']) {
        const text = readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
        assert.doesNotMatch(text, /mainland China|outside China|domestic services|global services/i, name);
    }
});

test('shortened preferences and neutral source hints have compiled Chinese translations', () => {
    const program = `import gettext
translation = gettext.translation('classic-gadgets', localedir='extension/locale', languages=['zh_CN'])
expected = {
    'Automatic data sources': '自动选择数据源',
    'Chooses data sources from the IP location when enabled. Proxies may affect detection.': '启用时根据 IP 位置选择数据源，代理可能影响判断。',
    'Updates every 10 minutes.': '每 10 分钟更新。',
    'Updates every 15 minutes.': '每 15 分钟更新。',
    'Checks reference rates hourly.': '每小时检查参考汇率。',
    'Selects a feed using the network location.': '根据网络位置选择订阅源。',
    'Search for a city or enter coordinates.': '请搜索城市或填写经纬度。',
    'Edit directly on the desktop. Up to 8000 characters.': '直接在桌面编辑。最多 8000 个字符。',
    'Supports PNG, JPEG and WebP. Each up to 20 MiB.': '支持 PNG、JPEG、WebP。每张不超过 20 MiB。',
}
for message, chinese in expected.items():
    assert translation.gettext(message) == chinese, message
`;
    assert.doesNotThrow(() => execFileSync('python3', ['-c', program], {cwd: root}));
});
