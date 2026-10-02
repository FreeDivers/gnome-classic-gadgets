// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
// Lightweight, non-modal Shell window. Unlike extension preferences, this never
// starts a second application or takes focus away from the user's desktop.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Scope} from '../platform.js';
import {centerIn, clampToArea} from './ui-logic.js';

export function uiButton(text, callback, props = {}) {
    const button = new St.Button({label: text, can_focus: true, style_class: 'cg-button', ...props});
    button.connect('clicked', callback);
    return button;
}
export function uiLabel(text, style = '') { return new St.Label({text, style_class: `cg-label ${style}`}); }
export function focusEntry(entry) {
    entry.reactive = true; entry.clutter_text.reactive = true;
    entry.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 1) entry.clutter_text.grab_key_focus();
        return Clutter.EVENT_PROPAGATE;
    });
    return entry;
}
export class FloatingWindow {
    constructor(host, title, width, onClose) {
        this.host = host; this.scope = new Scope(); this.onClose = onClose;
        this.actor = new St.BoxLayout({vertical: true, reactive: true, can_focus: true,
            width, style_class: `cg-window ${host.theme.name === 'fluent' ? 'cg-fluent' : ''}`, accessible_name: title});
        this.header = new St.BoxLayout({style_class: 'cg-window-header', reactive: true});
        this.header.add_child(uiLabel(title, 'cg-title'));
        this.header.add_child(new St.Widget({x_expand: true}));
        this.closeButton = uiButton('×', () => this.onClose(), {style_class: 'cg-close', accessible_name: _("Close window")});
        this.header.add_child(this.closeButton); this.actor.add_child(this.header);
        this.content = new St.BoxLayout({vertical: true, style_class: 'cg-window-content'});
        this.actor.add_child(this.content);
        this.scope.connect(this.header, 'button-press-event', (_actor, event) => {
            if (event.get_button() !== 1 || this.closeButton.contains(event.get_source())) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this.drag = {x, y, ax: this.actor.x, ay: this.actor.y, grab: global.stage.grab(this.header)};
            return Clutter.EVENT_STOP;
        });
        this.scope.connect(this.header, 'motion-event', (_actor, event) => {
            if (!this.drag) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const p = clampToArea({x: this.drag.ax + x - this.drag.x, y: this.drag.ay + y - this.drag.y,
                width: this.actor.width, height: this.actor.height}, this.area());
            this.actor.set_position(p.x, p.y); return Clutter.EVENT_STOP;
        });
        this.scope.connect(this.header, 'button-release-event', () => {
            if (!this.drag) return Clutter.EVENT_PROPAGATE;
            this.drag.grab.dismiss(); this.drag = null; return Clutter.EVENT_STOP;
        });
        this.scope.connect(this.actor, 'key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
            this.onClose(); return Clutter.EVENT_STOP;
        });
        this.scope.connect(Main.overview, 'showing', () => this.onClose());
        this.scope.connect(Main.sessionMode, 'updated', () => { if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) this.onClose(); });
        this.scope.connect(Main.layoutManager, 'monitors-changed', () => this.position());
        Main.layoutManager.addChrome(this.actor, {trackFullscreen: true});
    }
    area() { return this.host.workareas()[Main.layoutManager.currentMonitor?.index ?? 0] ?? this.host.workareas()[0]; }
    position(point = null) {
        const area = this.area(); if (!area) return;
        const size = {width: this.actor.width, height: this.actor.get_preferred_height(this.actor.width)[1]};
        const scale = Math.min(1, area.width / size.width, area.height / size.height);
        this.actor.set_scale(scale, scale);
        const rect = {...size, width: size.width * scale, height: size.height * scale};
        const p = point ? clampToArea({...point, ...rect}, area) : centerIn(rect, area);
        this.actor.set_position(Math.round(p.x), Math.round(p.y));
    }
    destroy() {
        if (!this.scope.alive) return;
        this.drag?.grab.dismiss(); this.drag = null;
        const focus = global.stage.get_key_focus();
        if (focus && this.actor.contains(focus)) global.stage.set_key_focus(null);
        this.scope.destroy(); Main.layoutManager.removeChrome(this.actor); this.actor.destroy();
    }
}
