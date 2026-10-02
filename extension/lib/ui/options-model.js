// SPDX-License-Identifier: MIT
import {_, format} from '../i18n.js';
// Toolkit-independent draft/validation model. Functions (validation, search,
// actions) remain in Shell; only serializable presentation data crosses the pipe.
import {changedKeys, parseNumber} from './ui-logic.js';

export function displayValue(spec, value) {
    if (spec.type === 'entry' || spec.type === 'search')
        return spec.format ? spec.format(value) : String(value ?? '');
    return value;
}
export function prepareOptions(specs, initial) {
    const values = {...initial};
    const fields = specs.map((spec, index) => {
        if (spec.key && spec.default !== undefined && (values[spec.key] === undefined || (Array.isArray(values[spec.key]) && !values[spec.key].length && Array.isArray(spec.default)))) values[spec.key] = spec.default;
        if (spec.key && ['combo', 'picker'].includes(spec.type) && !spec.values.includes(values[spec.key])) values[spec.key] = spec.values[0];
        const field = {id: String(index)};
        for (const key of ['type', 'key', 'label', 'hint', 'placeholder', 'group', 'advanced', 'number', 'multiline', 'values', 'names', 'previewSize', 'sensitiveWhen', 'icon', 'progress', 'danger'])
            if (spec[key] !== undefined) field[key] = spec[key];
        if (spec.key) field.value = displayValue(spec, values[spec.key]);
        if (spec.preview) field.previews = spec.values.map(value => spec.preview(value));
        return field;
    });
    return {fields, values};
}
export function validateDraft(specs, initial, raw) {
    const values = {};
    for (const spec of specs) {
        if (!spec.key || spec.type === 'search') continue;
        try {
            let value = Object.hasOwn(raw, spec.key) ? raw[spec.key] : displayValue(spec, initial[spec.key] ?? spec.default);
            if (spec.type === 'entry') {
                if (spec.number) {
                    const result = parseNumber(value, spec.number);
                    if (result.error) throw new Error(result.error);
                    value = result.value;
                }
                if (spec.parse) value = spec.parse(value);
            } else if (spec.type === 'switch') {
                if (typeof value !== 'boolean') throw new Error(_("Invalid switch value"));
            } else if (spec.type === 'combo' || spec.type === 'picker') {
                if (!spec.values.includes(value)) throw new Error(_("Select an option from the list"));
            }
            spec.validate?.(value);
            values[spec.key] = value;
        } catch (cause) {
            const error = new Error(format(_('{field}: {error}'), {field: spec.label || spec.key, error: cause.message}));
            error.key = spec.key; throw error;
        }
    }
    return changedKeys(initial, values);
}
