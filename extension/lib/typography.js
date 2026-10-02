// SPDX-License-Identifier: MIT
// CSS owns the typeface, hierarchy and colour. Preserve St's Pango attributes
// (including foreground/alpha) when adding digit shaping, line rhythm or fitting.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {readableTextScale} from './logic/typography.js';

const policies = new WeakMap();
export function textAttributes({numeric = false, lineHeight = 1, scale = 1} = {}, base = null) {
    const attrs = base?.copy() ?? new Pango.AttrList();
    if (numeric) attrs.change(Pango.attr_font_features_new('tnum=1,lnum=1'));
    if (lineHeight !== 1) attrs.change(Pango.attr_line_height_new(lineHeight));
    attrs.change(Pango.attr_scale_new(scale));
    return attrs;
}
function applyAttributes(actor) {
    const text = actor.clutter_text, existing = text.get_attributes();
    const attrs = textAttributes(policies.get(actor), existing);
    if (existing?.to_string() !== attrs.to_string()) text.set_attributes(attrs);
}
export function styleText(actor, {numeric = false, multiline = false, lineHeight = 1} = {}) {
    const text = actor.clutter_text;
    if (!policies.has(actor)) {
        policies.set(actor, {});
        // St reconstructs the attributes on every style change. Run afterwards;
        // this actor-owned signal disappears with the label/entry on rebuild.
        actor.connect_after('style-changed', () => applyAttributes(actor));
    }
    Object.assign(policies.get(actor), {numeric, lineHeight});
    applyAttributes(actor);
    if (numeric) {
        text.set_text_direction(Clutter.TextDirection.LTR);
        text.set_single_line_mode(true);
    }
    if (multiline) {
        text.set_single_line_mode(false);
        text.set_line_wrap(true);
        text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        text.set_ellipsize(Pango.EllipsizeMode.NONE);
        text.set_line_alignment(Pango.Alignment.LEFT);
        text.y_align = Clutter.ActorAlign.START;
    } else text.y_align = Clutter.ActorAlign.CENTER;
    return actor;
}
// Shrink only unusually long readings, with a readable minimum. Never replace
// the full value with a rounded/abbreviated one; ellipsis is the last resort.
export function fitLabel(scope, actor, {minimum = 10, numeric = false} = {}) {
    let queued = 0;
    if (!policies.has(actor)) styleText(actor, {numeric});
    const fit = () => {
        queued = 0;
        const text = actor.clutter_text;
        if (!scope.alive || actor.width <= 0 || !text.get_text()) return;
        const font = actor.get_theme_node().get_font();
        const layout = text.create_pango_layout(text.get_text());
        layout.set_font_description(font);
        layout.set_attributes(textAttributes({numeric}));
        layout.set_single_paragraph_mode(true);
        // ClutterText may allocate only its current natural width. Fitting to
        // that width creates a shrinking feedback loop when the text changes.
        const box = new Clutter.ActorBox({x1: 0, y1: 0, x2: actor.width, y2: actor.height});
        const content = actor.get_theme_node().get_content_box(box);
        const width = content.x2 - content.x1;
        const fontSize = font.get_size() / Pango.SCALE * (font.get_size_is_absolute() ? 1 : 96 / 72);
        const scale = readableTextScale(candidate => {
            layout.set_attributes(textAttributes({numeric, scale: candidate}));
            const [ink, logical] = layout.get_pixel_extents();
            return Math.max(logical.width, ink.x + ink.width);
        }, width - 1, minimum / fontSize);
        policies.get(actor).scale = scale;
        applyAttributes(actor);
        actor.accessible_name = text.get_text();
    };
    const queue = () => { if (!queued) queued = scope.later(0, fit); };
    scope.connect(actor.clutter_text, 'text-changed', queue);
    scope.connect(actor, 'notify::width', queue);
    scope.connect(actor, 'style-changed', queue);
    queue();
    return actor;
}
