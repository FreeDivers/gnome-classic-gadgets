// SPDX-License-Identifier: MIT
import {_, format, ngettext} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {styleText} from '../typography.js';
import {validContacts} from '../core.js';
import {Gadget, label, place, action} from '../gadget.js';

export default class Contacts extends Gadget {
    optionsSpec() { return [{type: 'entry', key: 'people', label: _("Contacts (one per line: name | phone | email)"), multiline: true,
        format: value => Array.isArray(value) ? value.map(p => [p.name, p.phone, p.email].join(' | ')).join('\n') : String(value ?? ''),
        parse: value => validContacts(String(value).split('\n').filter(line => line.trim()).map(line => { const [name, phone = '', email = ''] = line.split('|').map(part => part.trim()); return {name, phone, email}; }))}]; }
    build() {
        this.picture(`images/${this.large ? 'ltr-desk' : 'ltr-dock'}.png`, 0, 0, this.width, this.height);
        this.search = new St.Entry({hint_text: _("Search contacts"), style_class: 'og-contact-search', can_focus: true}); place(this.body, this.search, this.large ? 26 : 12, this.large ? 22 : 12, this.large ? 116 : 103, 19);
        this.items = new St.BoxLayout({vertical: true});
        const scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true}); scroll.set_child(this.items); place(this.body, scroll, this.large ? 28 : 12, this.large ? 47 : 37, this.large ? 113 : 103, 97);
        this.status = this.text('', this.large ? 28 : 12, this.large ? 147 : 136, this.large ? 113 : 103, 17, 'og-contact-status');
        this.detail = this.text(_("Select a contact\nto view their phone and email"), 165, 48, 120, 112, 'og-contact-detail'); styleText(this.detail, {multiline: true, lineHeight: 1.15}); this.detail.visible = this.large;
        this.scope.connect(this.search.clutter_text, 'text-changed', () => this.render()); this.render();
    }
    refreshOptions() { this.render(); }
    render() {
        this.items.destroy_all_children(); const query = this.search.get_text().toLowerCase();
        const people = validContacts(this.options.people).filter(p => `${p.name} ${p.phone} ${p.email}`.toLowerCase().includes(query));
        if (!people.length) {
            this.items.add_child(label(_("No contacts"), 'og-contact-empty'));
            this.items.add_child(action(_("Add…"), () => this.host.openOptions(this), {style_class: 'og-contact-action'}));
        }
        for (const person of people) {
            const entry = new St.BoxLayout({vertical: true}); entry.add_child(label(person.name, 'og-contact-name', {x_expand: true, x_align: Clutter.ActorAlign.FILL})); entry.add_child(label(person.phone || person.email, 'og-contact-detail', {x_expand: true, x_align: Clutter.ActorAlign.FILL}));
            const row = new St.Button({child: entry, can_focus: true, style_class: 'og-contact-row', x_expand: true, accessible_name: format(_("{name}; click to copy contact details"), {name: person.name})});
            row.connect('clicked', () => { St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, [person.name, person.phone, person.email].filter(Boolean).join('\n')); this.status.text = _("Copied to clipboard"); this.detail.text = [person.name, person.phone, person.email].filter(Boolean).join('\n\n'); }); this.items.add_child(row);
        }
        this.status.text = format(ngettext("{count} contact", "{count} contacts", people.length), {count: people.length});
    }
}
