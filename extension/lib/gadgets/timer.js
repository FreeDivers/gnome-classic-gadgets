// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {clamp, countdown, timerAction, formatDuration} from '../core.js';
import {paintTimerNumerals} from '../timer-text.js';
import {Gadget, place} from '../gadget.js';

export default class Timer extends Gadget {
    optionsSpec() { return [{type: 'entry', key: 'duration', label: _("Default duration (seconds)"), number: {min: 1, max: 3599, integer: true}},
        {type: 'button', label: _("Reset timer"), onClick: () => { this.action('reset'); return _("Reset"); }}]; }
    build() {
        const mode = this.large ? 'large' : 'small', sx = this.width / 90, sy = this.height / 111;
        this.picture(`assets/images/timer_${mode}_bg.png`, 0, 0, this.width, this.height);
        this.silhouette = Cairo.ImageSurface.createFromPNG(this.asset('assets/images/timer_small_bg.png'));
        this.numerals = new St.DrawingArea({width: this.width, height: this.height}); place(this.body, this.numerals, 0, 0, this.width, this.height);
        this.scope.connect(this.numerals, 'repaint', () => paintTimerNumerals(this.numerals, countdown(this.options), this.silhouette));
        this.picture(`assets/images/timer_${mode}_mask.png`, 0, 0, this.width, this.height);
        const secondZone = this.button('', 12 * sx, 16 * sy, 64 * sx, 20 * sy, () => this.adjust(5)); secondZone.accessible_name = _("Add five seconds");
        const minuteZone = this.button('', 8 * sx, 41 * sy, 71 * sx, 32 * sy, () => this.adjust(60)); minuteZone.accessible_name = _("Add one minute");
        this.start = this.button('', 16 * sx, 78 * sy, 58 * sx, 19 * sy, () => this.action(this.options.running ? 'pause' : 'start')); this.start.accessible_name = _("Start or pause");
        this.scope.connect(minuteZone, 'scroll-event', (_a, event) => { this.adjust(event.get_scroll_direction() === Clutter.ScrollDirection.UP ? 60 : -60); return Clutter.EVENT_STOP; });
        this.scope.connect(secondZone, 'scroll-event', (_a, event) => { this.adjust(event.get_scroll_direction() === Clutter.ScrollDirection.UP ? 5 : -5); return Clutter.EVENT_STOP; });
        this.display = this.text('', 0, 0, 0, 0); this.display.visible = false;
        this.status = this.text('', 0, 0, 0, 0); this.status.visible = false;
        this.tick(); this.scope.later(1000, () => this.tick(), true);
    }
    beforeDestroy() { this.silhouette = null; }
    adjust(delta) { const seconds = clamp(countdown(this.options) + delta, 0, 3599); this.save({remaining: seconds, duration: seconds || 1, running: false, deadline: 0}); this.tick(); }
    action(actionName) { this.save(timerAction(this.options, actionName)); this.tick(); }
    refreshOptions() { this.tick(); }
    tick() {
        const remaining = countdown(this.options); this.display.text = formatDuration(remaining);
        this.numerals.queue_repaint();
        this.actor.accessible_name = format(_("Timer {time}; click the digits or scroll to adjust the duration, and click the bottom to start or pause"), {time: this.display.text});
        if (this.options.running && remaining === 0) { this.save(timerAction(this.options, 'finish')); Main.notify(_("Timer"), _("Time is up.")); }
    }
}
