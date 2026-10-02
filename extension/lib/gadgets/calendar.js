// SPDX-License-Identifier: MIT
import {_, formatDate, formatNumber} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import {monthGrid, shiftMonth} from '../core.js';
import {Gadget, label, place, action, surface} from '../gadget.js';

// `size` ('small' | 'large') is canonical since 2.1; `expanded` (2.0, also written by
// prefs.js) mirrors it: size === 'large' ⇔ expanded. The left-bottom flip button toggles both.
export default class Calendar extends Gadget {
    optionsSpec() { return [{type: 'switch', key: 'mondayFirst', label: _("Start the week on Monday")}]; }
    build() {
        const now = new Date(); this.year = now.getFullYear(); this.month = now.getMonth();
        this.background = this.picture('images/calendar_single_orange.png', 0, 0, 130, 141);
        this.bigDay = this.text('', 5, 40, 120, 65, 'og-calendar-day og-numeric');
        this.weekday = this.text('', 5, 22, 120, 20, 'og-calendar-weekday');
        this.todayMonth = this.text('', 5, 108, 120, 20, 'og-calendar-month');
        this.monthView = surface(123, 123); place(this.body, this.monthView, 4, 7, 123, 123);
        this.monthLabel = place(this.monthView, label('', 'og-calendar-heading'), 19, 6, 85, 18);
        const previous = action('‹', () => this.navigate(-1), {style_class: 'og-calendar-arrow'}); place(this.monthView, previous, 1, 3, 17, 20);
        const next = action('›', () => this.navigate(1), {style_class: 'og-calendar-arrow'}); place(this.monthView, next, 104, 3, 17, 20);
        this.grid = surface(119, 95); place(this.monthView, this.grid, 2, 25, 119, 95);
        this.flip = this.button('', 1, 114, 25, 25, () => this.setSize(this.large ? 'small' : 'large'));
        this.flip.accessible_name = _("Expand or collapse the calendar");
        this.body.set_child_above_sibling(this.monthView, this.flip);
        this.render(); this.scope.later(30000, () => { if (this.todayKey !== new Date().toDateString()) this.render(); }, true);
    }
    get expanded() { return this.large; }
    navigate(delta) { const next = shiftMonth(this.year, this.month, delta); this.year = next.year; this.month = next.month; this.render(); }
    save(patch) { super.save(Object.hasOwn(patch, 'size') ? {expanded: patch.size === 'large', ...patch} : patch); }
    refreshOptions() {
        const expanded = !!this.options.expanded;
        if (expanded !== this.large) this.save({size: expanded ? 'large' : 'small', expanded}); // `expanded` toggled on its own (prefs.js, 2.0 clients)
        else this.render();
    }
    render() {
        const now = new Date(), expanded = this.large;
        this.todayKey = now.toDateString(); this.resize(130, expanded ? 264 : 141);
        this.background.set_size(130, this.height); this.setPicture(this.background, expanded ? 'images/calendar_double_orange.png' : 'images/calendar_single_orange.png');
        const offset = expanded ? 123 : 0;
        this.bigDay.y = 40 + offset; this.weekday.y = 22 + offset; this.todayMonth.y = 108 + offset;
        this.flip.set_position(1, 114 + offset); this.flip.set_size(25, 25);
        this.bigDay.text = formatNumber(now.getDate()); this.weekday.text = formatDate(now, {weekday: 'long'});
        this.todayMonth.text = formatDate(now, {year: 'numeric', month: 'short'});
        this.monthView.visible = expanded; this.monthLabel.text = formatDate(new Date(this.year, this.month, 1), {year: 'numeric', month: 'short'});
        this.grid.destroy_all_children();
        const headings = Array.from({length: 7}, (_day, i) => formatDate(new Date(2026, 0, 4 + i + (this.options.mondayFirst ? 1 : 0)), {weekday: 'narrow'}));
        [...headings].forEach((day, i) => place(this.grid, label(day, 'og-calendar-dow'), i * 17, 0, 17, 13));
        monthGrid(this.year, this.month, this.options.mondayFirst).forEach((date, i) => {
            const today = date.year === now.getFullYear() && date.month === now.getMonth() && date.day === now.getDate();
            place(this.grid, label(formatNumber(date.day), `og-numeric og-calendar-cell${date.current ? '' : ' og-calendar-dim'}${today ? ' og-calendar-today' : ''}`), i % 7 * 17, 14 + Math.floor(i / 7) * 13, 17, 13);
        });
    }
}
