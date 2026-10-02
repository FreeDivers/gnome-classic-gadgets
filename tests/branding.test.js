// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const oldBrand = /Classic\s+(?:Desktop\s+)?(?:Gadgets|Widgets)|经典(?:桌面)?(?:小组件|小工具)/i;

test('extension metadata uses the public UUID while retaining settings and service identifiers', () => {
    const metadata = JSON.parse(read('extension/metadata.json'));
    assert.equal(metadata.name, 'Windows Vista/7 小组件');
    assert.match(metadata.description, /^Windows Vista\/7 小组件/);
    assert.equal(metadata.uuid, 'classic-gadgets@FreeDivers.github.io');
    assert.equal(metadata['settings-schema'], 'org.gnome.shell.extensions.classic-gadgets');
    assert.equal(metadata['gettext-domain'], 'classic-gadgets');
    assert.match(read('extension/lib/dbus.js'), /org\.gnome\.Shell\.Extensions\.ClassicGadgets/);
});

test('installers and Shell test launchers use the public extension UUID', () => {
    const {uuid} = JSON.parse(read('extension/metadata.json'));
    for (const file of [
        'scripts/install.py', 'scripts/uninstall.py', 'scripts/test-install.py',
        'scripts/test-shell.sh', 'scripts/smoke-shell.sh', 'scripts/test-session.sh',
        'scripts/publish-test-evidence.py', 'tests/shell-test.js', 'tests/smoke/driver/extension.js',
    ]) {
        assert.ok(read(file).includes(uuid), file);
        if (file !== 'scripts/install.py') assert.doesNotMatch(read(file), /classic-gadgets@qinyan\.local/, file);
    }
});

test('runtime text and gettext catalogs no longer use the old product names', () => {
    function checkDirectory(directory) {
        for (const entry of readdirSync(join(root, directory), {withFileTypes: true})) {
            if (['assets', 'locale', '__pycache__'].includes(entry.name)) continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) checkDirectory(path);
            else if (/\.(js|py|json)$/.test(entry.name)) assert.doesNotMatch(read(path), oldBrand, path);
        }
    }
    checkDirectory('extension');
    for (const path of ['po/zh_CN.po', 'po/classic-gadgets.pot', 'README.md']) assert.doesNotMatch(read(path), oldBrand, path);
});

test('all native helper application names use the same translated product name', () => {
    for (const file of ['gadget-options.js', 'gadget-gallery.js', 'trash-drop-target.js']) {
        assert.match(read(`extension/helpers/${file}`), /GLib\.set_application_name\(_\("Windows Vista\/7 Widgets"\)\)/, file);
    }
});
