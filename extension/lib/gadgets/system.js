// SPDX-License-Identifier: MIT
import {_, format, formatNumber} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import {formatBytes} from '../core.js';
import {SystemSampler} from '../platform.js';
import {Gadget} from '../gadget.js';

export default class System extends Gadget {
    build() {
        const large = this.large, suffix = large ? '_lrg' : '';
        this.face = this.picture(`images/back${suffix}.png`, 0, 0, this.width, this.height);
        this.cpuHand = this.picture(`images/dial${suffix}.png`, large ? 63 : 38, large ? 34 : 22, large ? 10 : 8, large ? 98 : 72);
        const fluentLarge = large && this.host.theme.name === 'fluent';
        this.memHand = this.picture(fluentLarge ? 'images/dial_sml.png' : `images/dial${suffix}_sml.png`, large ? 137 : 92, large ? 16 : 8, large ? 10 : 8, large ? 70 : 50);
        for (const actor of [this.cpuHand, this.memHand]) actor.set_pivot_point(0.5, 0.5);
        this.picture(`images/dialdot${suffix}.png`, 0, 0, this.width, large ? 150 : 101);
        this.cpuText = this.text('…', large ? 51 : 27, large ? 104 : 73, large ? 40 : 31, large ? 20 : 15, 'og-meter-value og-numeric');
        this.memText = this.text('…', large ? 126 : 81, large ? 69 : 40, large ? 40 : 30, large ? 20 : 15, 'og-meter-value og-numeric');
        this.picture(`images/glass${suffix}.png`, 0, 0, this.width, large ? 159 : 103);
        this.values = {cpu: null, memory: {percent: 0}};
        this.status = this.text('', 0, 0, 0, 0); this.status.visible = false;
        this.sampler = new SystemSampler(this.scope, values => {
            if (values.error) { this.status.text = values.error; return; }
            this.values = values; this.cpuHand.rotation_angle_z = (values.cpu || 0) * 2.5 - 125; this.memHand.rotation_angle_z = values.memory.percent * 2.5 - 125;
            this.cpuText.text = values.cpu === null ? '…' : formatNumber(values.cpu / 100, {style: 'percent', maximumFractionDigits: 0}); this.memText.text = formatNumber(values.memory.percent / 100, {style: 'percent', maximumFractionDigits: 0});
            this.actor.accessible_name = format(_("CPU {cpu}; memory {used} / {total}"), {cpu: this.cpuText.text, used: formatBytes(values.memory.used), total: formatBytes(values.memory.total)});
        });
    }
}
