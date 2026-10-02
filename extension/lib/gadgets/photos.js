// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {clamp, finite} from '../core.js';
import {enumerate, openUri, cancelError} from '../platform.js';
import {Gadget, place, action, surface} from '../gadget.js';

export default class Photos extends Gadget {
    optionsSpec() {
        return [
            {type: 'entry', key: 'directory', label: _("Pictures folder"), hint: _("Absolute path"), validate: path => { if (path && !GLib.path_is_absolute(path)) throw new Error(_("Enter the folder's absolute path")); }},
            {type: 'entry', key: 'interval', label: _("Slide interval (seconds)"), number: {min: 5, max: 3600, integer: true}},
            {type: 'switch', key: 'paused', label: _("Pause slide show")},
        ];
    }
    build() {
        this.background = this.picture(`images/${this.large ? 'on_desktop' : 'in_sidebar'}/slideshow_glass_frame.png`, 0, 0, this.width, this.height);
        this.image = new St.Bin({width: this.large ? 320 : 120, height: this.large ? 240 : 90, clip_to_allocation: true}); place(this.body, this.image, this.large ? 17 : 4, this.large ? 16 : 5, this.large ? 320 : 120, this.large ? 240 : 90);
        this.controls = surface(112, 23); place(this.body, this.controls, this.large ? 119 : 7, this.large ? 220 : 68, 112, 23); this.controls.visible = false;
        this.picture('images/in_sidebar/bg_sidebar.png', 0, 0, 112, 23, this.controls);
        const add = (file, x, callback, name) => {
            const control = place(this.controls, action('', callback, {accessible_name: name, style_class: 'og-photo-control'}), x, 3, 20, 17);
            this.setPicture(control, `images/${file}_rest.png`); return control;
        };
        add('prev', 4, () => this.next(-1), _("Previous picture"));
        this.pause = add('pause', 29, () => { this.save({paused: !this.options.paused}); this.setPicture(this.pause, `images/${this.options.paused ? 'play' : 'pause'}_rest.png`); }, _("Pause or play"));
        add('next', 54, () => this.next(1), _("Next picture"));
        add('reveal', 84, () => {
            const file = this.files[this.index] || Gio.File.new_for_path(this.asset('images/Garden.jpg'));
            openUri(file.get_uri());
        }, _("View current picture"));
        this.caption = this.text('', 0, 0, 0, 0); this.caption.visible = false;
        this.files = []; this.index = 0; this.lastAdvance = 0; this.refreshOptions();
        this.scope.later(1000, () => { if (!this.options.paused && Date.now() - this.lastAdvance >= clamp(finite(this.options.interval, 30), 5, 3600) * 1000) this.next(1); }, true);
    }
    hover(state) { if (this.controls) this.controls.visible = state; }
    async refreshOptions() {
        const generation = this.generation = (this.generation || 0) + 1;
        this.setPicture(this.pause, `images/${this.options.paused ? 'play' : 'pause'}_rest.png`); this.files = [];
        const path = String(this.options.directory || '');
        if (!path) { this.show(); return; }
        try {
            if (!GLib.path_is_absolute(path)) throw new Error(_("Enter the absolute path of a local pictures folder"));
            const folder = Gio.File.new_for_path(path);
            const infos = await enumerate(folder, 'standard::name,standard::type,standard::size', this.scope.cancellable, 2000);
            if (!this.scope.alive || generation !== this.generation) return;
            this.files = infos.filter(i => i.get_file_type() === Gio.FileType.REGULAR && /\.(png|jpe?g|webp)$/i.test(i.get_name()) && i.get_size() < 20 * 1024 * 1024).sort((a, b) => a.get_name().localeCompare(b.get_name())).map(i => folder.get_child(i.get_name()));
            this.index = 0; this.show();
        } catch (e) { if (this.scope.alive && !cancelError(e)) { this.show(); this.caption.text = e.message; this.actor.accessible_name = format(_("Slide show: {detail}"), {detail: e.message}); } }
    }
    next(delta) { if (this.files.length) this.index = (this.index + delta + this.files.length) % this.files.length; this.show(); }
    show() {
        const file = this.files[this.index] || Gio.File.new_for_path(this.asset('images/Garden.jpg'));
        const previous = this.image.get_child(); if (previous) { this.image.set_child(null); previous.destroy(); }
        const actor = St.TextureCache.get_default().load_file_async(file, this.large ? 320 : 120, this.large ? 240 : 90, St.ThemeContext.get_for_stage(global.stage).scale_factor, 1);
        this.image.set_child(actor); this.caption.text = file.get_basename();
        this.lastAdvance = Date.now(); this.actor.accessible_name = format(_("Slide show: {detail}"), {detail: this.caption.text});
    }
}
