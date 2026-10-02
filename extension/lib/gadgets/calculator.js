// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import {calculate} from '../core.js';
import {Gadget, place} from '../gadget.js';
import {styleText} from '../typography.js';

export default class Calculator extends Gadget {
    optionsSpec() { return [{type: 'combo', key: 'color', label: _("Color"), default: 'Yellow', values: ['Yellow', 'Grey', 'Pink'], names: [_("Yellow"), _("Gray"), _("Pink")]}]; }
    refreshOptions() { const text = this.entry.get_text(); const result = this.result.text; this.rebuild(); this.entry.set_text(text); this.result.text = result; }
    build() {
        const large = this.large, color = ['Yellow', 'Grey', 'Pink'].includes(this.options.color) ? this.options.color : 'Yellow';
        this.picture(`images/Background${large ? '' : 'Docked'}${color}.png`, 0, 0, this.width, this.height);
        this.picture(`images/${large ? 'ScreenMin' : 'ScreenDocked'}.png`, large ? 21 : 7, large ? 23 : 8, large ? 200 : 116, large ? 93 : 57);
        this.picture(`images/${large ? 'ltr_BtnDefault' : 'ltr_BtnDockedDefault'}.png`, large ? 21 : 7, large ? 125 : 69, large ? 200 : 116, large ? 118 : 70);
        this.entry = new St.Entry({text: '', style_class: 'og-calc-entry', can_focus: true}); place(this.body, this.entry, large ? 30 : 12, large ? 29 : 12, large ? 181 : 104, large ? 22 : 14);
        styleText(this.entry, {numeric: true});
        this.result = this.text('0', large ? 30 : 12, large ? 52 : 25, large ? 181 : 104, large ? 30 : 18, 'og-calc-result og-numeric');
        this.scope.connect(this.entry.clutter_text, 'activate', () => this.evaluate());
        const memory = [['C', () => this.press('C')], ['M+', () => { try { this.memory = (this.memory || 0) + calculate(this.entry.get_text() || this.result.text); } catch { this.result.text = _("Error"); } }], ['MR', () => this.entry.set_text(String(this.memory || 0))], ['MC', () => { this.memory = 0; }]];
        memory.forEach(([text, callback], i) => this.button(text, (large ? 22 : 8) + i * (large ? 49 : 28), large ? 91 : 48, large ? 48 : 27, large ? 20 : 15, callback, 'og-calc-memory'));
        const keys = [['7', '8', '9', '÷', '√', '⌫'], ['4', '5', '6', '×', '(', ')'], ['1', '2', '3', '−', '1/x', '^'], ['0', '.', '%', '+', '±', '=']];
        keys.forEach((row, r) => row.forEach((key, c) => this.button(key, (large ? 21 : 7) + c * (large ? 33.3 : 19.3), (large ? 126 : 70) + r * (large ? 29 : 17), large ? 33.3 : 19.3, large ? 29 : 17, () => this.press(key), `og-calc-key${key === '1/x' ? ' og-calc-wide' : /^[0-9.]$/.test(key) ? '' : ' og-calc-operator'}`)));
    }
    press(key) {
        const current = this.entry.get_text();
        if (key === 'C') { this.entry.set_text(''); this.result.text = '0'; }
        else if (key === '⌫') this.entry.set_text(current.slice(0, -1));
        else if (key === '=') this.evaluate();
        else if (key === '√') this.entry.set_text(`sqrt(${current || '0'})`);
        else if (key === '1/x') this.entry.set_text(`1/(${current || '0'})`);
        else if (key === '±') this.entry.set_text(current.startsWith('-') ? current.slice(1) : `-${current}`);
        else this.entry.set_text((current + key).slice(0, 512));
    }
    evaluate() { try { this.result.text = String(calculate(this.entry.get_text())); } catch (e) { this.result.text = e.message; } }
}
