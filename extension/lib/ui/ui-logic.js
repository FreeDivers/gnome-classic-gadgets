// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Pure helpers shared by lib/ui/* (no GI or Shell imports, so tests/ui.test.js can
// import this file under Node): gallery paging/filtering, dialog placement, number
// validation, option patch computation and the opacity table of the context menu.
import {clamp} from '../core.js';

export const PAGE_SIZE = 12;
export const OPACITY_LEVELS = [100, 80, 60, 40, 20];

export function normalizeQuery(query) { return String(query ?? '').trim().toLowerCase(); }
/** Filters [{type, name, subtitle}] by name / subtitle / type (case-insensitive substring). */
export function filterGadgets(entries, query) {
    const needle = normalizeQuery(query);
    if (!needle) return [...entries];
    return entries.filter(entry => [entry.name, entry.subtitle, entry.type].some(value => String(value ?? '').toLowerCase().includes(needle)));
}
export function pageCount(total, pageSize = PAGE_SIZE) { return Math.max(1, Math.ceil(Math.max(0, total) / pageSize)); }
export function clampPage(page, total, pageSize = PAGE_SIZE) {
    const index = Number.isFinite(page) ? Math.trunc(page) : 0;
    return clamp(index, 0, pageCount(total, pageSize) - 1);
}
export function pageItems(items, page, pageSize = PAGE_SIZE) {
    const index = clampPage(page, items.length, pageSize);
    return items.slice(index * pageSize, (index + 1) * pageSize);
}
export function pageLabel(page, total, pageSize = PAGE_SIZE) { return format(_("Page {page} of {total}"), {page: clampPage(page, total, pageSize) + 1, total: pageCount(total, pageSize)}); }

export function pointInRect(x, y, rect) { return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height; }
/** Keeps a {x, y, width, height} rectangle inside `area` (top-left aligned when it is larger). */
export function clampToArea(rect, area) {
    return {
        x: clamp(rect.x, area.x, Math.max(area.x, area.x + area.width - rect.width)),
        y: clamp(rect.y, area.y, Math.max(area.y, area.y + area.height - rect.height)),
    };
}
export function centerIn(size, area) {
    return clampToArea({x: area.x + (area.width - size.width) / 2, y: area.y + (area.height - size.height) / 2, ...size}, area);
}
/** host-ui.md §4: right of the gadget (gap px), else left of it, else centred in the work area; always inside `area`. */
export function placeDialog(gadget, size, area, gap = 8) {
    let x = gadget.x + gadget.width + gap;
    if (x + size.width > area.x + area.width) x = gadget.x - gap - size.width;
    if (x < area.x) x = area.x + (area.width - size.width) / 2;
    return clampToArea({x, y: gadget.y, width: size.width, height: size.height}, area);
}
/** Scales width×height down (never up) to fit into maxWidth×maxHeight, keeping the aspect ratio. */
export function fitSize(width, height, maxWidth, maxHeight) {
    if (!(width > 0) || !(height > 0)) return {width: Math.max(1, maxWidth), height: Math.max(1, maxHeight)};
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

function rangeText(min, max) {
    if (Number.isFinite(min) && Number.isFinite(max)) return format(_("Enter a number from {min} to {max}"), {min: min, max: max});
    if (Number.isFinite(min)) return format(_("Enter a number no smaller than {min}"), {min: min});
    if (Number.isFinite(max)) return format(_("Enter a number no greater than {max}"), {max: max});
    return _("Enter a number");
}
/** Validates the text of a numeric entry: {value} or {error} (Chinese message for the row). */
export function parseNumber(text, {min = -Infinity, max = Infinity, integer = false} = {}) {
    const source = String(text ?? '').trim();
    if (!source) return {error: _("Enter a number")};
    const value = Number(source);
    if (!Number.isFinite(value)) return {error: _("Enter a number")};
    if (integer && !Number.isInteger(value)) return {error: _("Enter a whole number")};
    if (value < min || value > max) return {error: rangeText(min, max)};
    return {value};
}
/** Keys of `values` whose JSON differs from `initial` — the patch handed to gadget.save(). */
export function changedKeys(initial, values) {
    const patch = {};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (JSON.stringify(value) !== JSON.stringify(initial[key])) patch[key] = value;
    }
    return patch;
}
export function opacityToAlpha(percent) {
    const value = Number(percent);
    return Math.round(255 * clamp(Number.isFinite(value) ? value : 100, 20, 100) / 100);
}
/** Index of `value` in `values`, or 0 when it is not a valid choice. */
export function choiceIndex(values, value) {
    const index = values.findIndex(candidate => candidate === value || String(candidate) === String(value));
    return index < 0 ? 0 : index;
}
/** True when two clicks on the same target are close enough in time to be a double-click. */
export function isDoubleClick(previous, current, threshold = 400) {
    return !!previous && previous.target === current.target && current.time - previous.time >= 0 && current.time - previous.time <= threshold;
}
