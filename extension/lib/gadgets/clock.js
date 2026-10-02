// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import GLib from 'gi://GLib';
import {Gadget} from '../gadget.js';

export const CLOCK_FACES = ['trad', 'system', 'cronometer', 'diner', 'flower', 'modern', 'square', 'novelty'];

export default class Clock extends Gadget {
    availableFaces() { return this.host.theme.name === 'fluent' ? [...CLOCK_FACES, 'monitor'] : CLOCK_FACES; }
    optionsSpec() {
        return [
            {type: 'picker', key: 'face', label: _("Clock face"), values: this.availableFaces(),
                names: [_("Traditional"), _("System"), _("Chronometer"), _("Blue neon"), _("Flower"), _("Modern red"), _("Square"), _("Kitten"), _("Monitor")], preview: face => this.asset(`images/${face}.png`), previewSize: {h: 100}},
            {type: 'entry', key: 'name', label: _("Clock name")},
            {type: 'entry', key: 'timezone', label: _("Time zone"), hint: _("For example, Asia/Shanghai. Leave blank to use the system time zone."), validate: value => { if (value && !GLib.TimeZone.new_identifier(value)) throw new Error(_("Invalid time zone")); }},
            {type: 'switch', key: 'seconds', label: _("Show second hand")},
        ];
    }
    build() {
        this.face = this.picture('images/trad.png', 0, 0, 130, 130);
        this.hour = this.picture('images/trad_h.png', 57, -1, 13, 129);
        this.minute = this.picture('images/trad_m.png', 57, -1, 13, 129);
        this.second = this.picture('images/trad_s.png', 57, -1, 13, 129);
        this.dot = this.picture('images/trad_dot.png', 57, -1, 13, 129);
        this.highlight = this.picture('images/trad_highlights.png', 3, 3, 124, 124);
        for (const hand of [this.hour, this.minute, this.second]) hand.set_pivot_point(0.5, 0.5);
        this.caption = this.text('', 25, 73, 80, 14, 'og-clock-name');
        this.refreshOptions(); this.scope.later(1000, () => this.tick(), true);
    }
    refreshOptions() {
        const theme = this.availableFaces().includes(this.options.face) ? this.options.face : 'trad';
        const positions = {trad: [57, -1], system: [58, 0], cronometer: [57, -1], diner: [58, -1], flower: [59, 0], modern: [58, -1], square: [57, -1], novelty: [59, 46]};
        const [x, y] = positions[theme] ?? [57, -1], w = theme === 'novelty' ? 7 : 13, h = theme === 'novelty' ? 81 : 129;
        this.face.set_position(theme === 'novelty' && this.host.theme.name === 'classic' ? 6 : 0, 0);
        const faceSize = theme === 'square' && this.host.theme.name === 'fluent' ? 129 : 130;
        this.face.set_size(theme === 'novelty' && this.host.theme.name === 'classic' ? 118 : faceSize, faceSize);
        this.setPicture(this.face, `images/${theme}.png`);
        for (const [actor, part] of [[this.hour, 'h'], [this.minute, 'm'], [this.second, 's'], [this.dot, 'dot']]) {
            actor.set_position(x, y); actor.set_size(w, h); this.setPicture(actor, `images/${theme}_${part}.png`);
        }
        const highlights = this.host.theme.name === 'classic' && ['trad', 'system', 'cronometer', 'square'].includes(theme);
        this.highlight.visible = highlights;
        if (highlights) this.setPicture(this.highlight, `images/${theme}_highlights.png`);
        this.second.visible = this.options.seconds !== false;
        this.zone = this.options.timezone ? GLib.TimeZone.new_identifier(String(this.options.timezone)) : null;
        this.caption.text = String(this.options.name || '').slice(0, 30);
        this.caption.y = theme === 'novelty' ? 91 : 73;
        this.caption.set_style_class_name(`og-label og-clock-name${['system', 'cronometer', 'modern', 'square', 'monitor'].includes(theme) ? ' og-clock-sans' : ''}${(['cronometer', 'diner', 'modern', 'monitor'].includes(theme) || (theme === 'system' && this.host.theme.name === 'fluent')) ? ' og-clock-light' : ''}`);
        this.tick();
    }
    showTime(hour, minute, second) {
        this.time = {hour, minute, second};
        this.hour.rotation_angle_z = ((hour % 12) + minute / 60 + second / 3600) * 30;
        this.minute.rotation_angle_z = (minute + second / 60) * 6;
        this.second.rotation_angle_z = second * 6;
    }
    tick() { let time = GLib.DateTime.new_now_local(); if (this.zone) time = time.to_timezone(this.zone); this.showTime(time.get_hour(), time.get_minute(), time.get_second()); }
}
