// SPDX-License-Identifier: MIT
// This module is also imported by standalone GTK clients, which do not have
// an Extension instance. Bind only our domain; never change the process domain.
import Gettext from 'gettext';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {GETTEXT_DOMAIN, configureTranslations} from './i18n.js';

export function initTranslations() {
    const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
    Gettext.bindtextdomain(GETTEXT_DOMAIN, root.get_child('locale').get_path());
    const messagesLocale = Gettext.setlocale(Gettext.LocaleCategory.MESSAGES, null);
    const language = ['C', 'POSIX'].includes(messagesLocale.split('.')[0]) ? null :
        GLib.get_language_names().find(name => !['C', 'POSIX'].includes(name.split('.')[0]));
    let locale = language?.split('.')[0].split('@')[0].replaceAll('_', '-') ?? 'en';
    try { locale = Intl.getCanonicalLocales(locale)[0]; } catch { locale = 'en'; }
    configureTranslations(Gettext.domain(GETTEXT_DOMAIN), locale);
}
initTranslations();
