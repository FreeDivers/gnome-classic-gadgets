// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import {styleText} from '../typography.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {clamp, finite} from '../core.js';
import {Gadget, place} from '../gadget.js';

export default class Notes extends Gadget {
    optionsSpec() {
        return [{type: 'picker', key: 'color', label: _("Note color"), values: ['yellow', 'blue', 'green', 'pink', 'purple', 'white'],
            names: [_("Yellow"), _("Blue"), _("Green"), _("Pink"), _("Purple"), _("White")], preview: color => this.asset(`images/sticky_${color}_docked.png`), previewSize: {h: 90}}];
    }
    build() {
        const dx = this.large ? 33 : 0, dy = this.large ? 55 : 0;
        this.background = this.picture(`images/sticky_yellow${this.large ? '' : '_docked'}.png`, 0, 0, this.width, this.height);
        const content = new St.BoxLayout({vertical: true, x_expand: true});
        this.entry = new St.Entry({text: '', style_class: 'og-note-entry', can_focus: true, x_expand: true, y_align: Clutter.ActorAlign.START});
        const text = this.entry.clutter_text; text.set_single_line_mode(false); text.set_activatable(false); text.set_line_wrap(true); text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR); text.set_max_length(8000);
        styleText(this.entry, {multiline: true, lineHeight: 1.18});
        const scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true});
        content.add_child(this.entry); scroll.set_child(content); place(this.body, scroll, 11, 12, this.width - 28, this.height - 56);
        this.well = this.picture('images/sticky_well.png', 27 + dx, 81 + dy, 76, 20);
        this.left = this.spriteButton('images/sticky_left_rest.png', 29 + dx, 83 + dy, 16, 16, _("Previous note"), () => this.changePage(-1));
        this.right = this.spriteButton('images/sticky_right_rest.png', 83 + dx, 83 + dy, 16, 16, _("Next note"), () => this.changePage(1));
        this.plus = this.spriteButton('images/sticky_plus_rest.png', 104 + dx, 83 + dy, 16, 16, _("New note"), () => this.addPage());
        this.remove = this.spriteButton('images/sticky_delete_rest.png', 8 + dx, 84 + dy, 16, 16, _("Delete note (click again to confirm)"), () => this.deletePage());
        this.status = this.text('', 46 + dx, 84 + dy, 37, 14, 'og-note-page og-numeric');
        this.controls = [this.well, this.left, this.right, this.plus, this.remove, this.status];
        this.scope.connect(text, 'text-changed', () => {
            if (this.settingText) return;
            this.dirty = true; this.scope.cancelSource(this.saveTimer); this.saveTimer = this.scope.later(350, () => this.flush());
        });
        this.refreshOptions(); this.hover(false);
    }
    refreshOptions() {
        const color = ['yellow', 'blue', 'green', 'pink', 'purple', 'white'].includes(this.options.color) ? this.options.color : 'yellow';
        this.setPicture(this.background, `images/sticky_${color}${this.large ? '' : '_docked'}.png`);
        this.pages = Array.isArray(this.options.pages) && this.options.pages.length ? this.options.pages.slice(0, 10).map(p => String(p).slice(0, 8000)) : [String(this.options.text || '').slice(0, 8000)];
        this.pageIndex = clamp(Math.trunc(finite(this.options.pageIndex)), 0, this.pages.length - 1);
        this.settingText = true; this.entry.set_text(this.pages[this.pageIndex]); this.settingText = false;
        this.updatePageControls();
    }
    updatePageControls() {
        this.status.text = `${this.pageIndex + 1}/${this.pages.length}`;
        this.setPicture(this.left, `images/sticky_left_${this.pageIndex ? 'rest' : 'disabled'}.png`);
        this.setPicture(this.right, `images/sticky_right_${this.pageIndex < this.pages.length - 1 ? 'rest' : 'disabled'}.png`);
        this.setPicture(this.plus, `images/sticky_plus_${this.pages.length < 10 ? 'rest' : 'disabled'}.png`);
    }
    flush() {
        if (!this.dirty) return; this.dirty = false;
        this.pages[this.pageIndex] = this.entry.get_text();
        this.save({text: this.entry.get_text(), pages: [...this.pages], pageIndex: this.pageIndex});
    }
    showPage() {
        this.settingText = true; this.entry.set_text(this.pages[this.pageIndex]); this.settingText = false;
        this.save({text: this.entry.get_text(), pages: [...this.pages], pageIndex: this.pageIndex}); this.updatePageControls();
    }
    changePage(delta) { this.flush(); this.pageIndex = clamp(this.pageIndex + delta, 0, this.pages.length - 1); this.showPage(); }
    addPage() { this.flush(); if (this.pages.length >= 10) return; this.pages.push(''); this.pageIndex = this.pages.length - 1; this.showPage(); }
    deletePage() {
        if (!this.deleteArmed && this.entry.get_text()) {
            this.deleteArmed = true; this.status.text = _("Delete?");
            this.scope.later(3000, () => { this.deleteArmed = false; this.updatePageControls(); }); return;
        }
        this.deleteArmed = false; this.flush(); this.pages.splice(this.pageIndex, 1); if (!this.pages.length) this.pages.push('');
        this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1); this.showPage();
    }
    beforeDestroy() { this.flush(); }
    hover(state) { for (const control of this.controls || []) control.visible = state; }
}
