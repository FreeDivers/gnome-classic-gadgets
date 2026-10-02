// SPDX-License-Identifier: MIT
// Shared by GNOME clients and the pure models. The runtime binds gettext;
// non-GNOME callers use the English source strings unless they supply a backend.
export const GETTEXT_DOMAIN = 'classic-gadgets';
const source = {
    gettext: message => message,
    ngettext: (singular, plural, count) => count === 1 ? singular : plural,
    pgettext: (_context, message) => message,
};
let translations = source;
let locale;
export function configureTranslations(backend = null, language = undefined) {
    translations = backend ?? source;
    locale = language;
}
export function gettext(message) { return translations.gettext(message); }
export {gettext as _};
export function ngettext(singular, plural, count) { return translations.ngettext(singular, plural, count); }
export function pgettext(context, message) { return translations.pgettext(context, message); }
// Mark deferred messages for xgettext without translating during module import.
export function N_(message) { return message; }
export function getLocale() { return locale; }
export function getLanguage() { return (locale ?? 'en').split('-')[0]; }
// Named placeholders can be reordered in translations. Values are substituted
// once, so braces, dollar signs and percent signs in user content stay literal.
export function format(message, values) {
    return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name) =>
        Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}
export function formatNumber(value, options = {}) { return Number(value).toLocaleString(locale, options); }
export function formatDate(date, options = {}) { return new Intl.DateTimeFormat(locale, options).format(date); }
