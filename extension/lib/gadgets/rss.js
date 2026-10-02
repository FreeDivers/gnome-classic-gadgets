// SPDX-License-Identifier: MIT
import {_} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {styleText} from '../typography.js';
import Pango from 'gi://Pango';
import {httpsUrl} from '../core.js';
import {openUri} from '../platform.js';
import {label, place} from '../gadget.js';
import {NetworkGadget} from './network-gadget.js';

export default class Feed extends NetworkGadget {
    optionsSpec() { return [{type: 'switch', key: 'autoSource', label: _("Choose feed automatically"), hint: _("Selects a feed using the network location.")},
        {type: 'entry', key: 'url', label: _("Custom RSS / Atom URL"), sensitiveWhen: {key: 'autoSource', equals: false}, validate: httpsUrl, hint: _("This HTTPS URL is used when automatic feed selection is off")},
        {type: 'entry', key: 'count', label: _("Number of entries"), default: 8, number: {min: 1, max: 20, integer: true}}]; }
    build() {
        this.picture(`images/rssBackBlue_${this.large ? 'Undocked' : 'docked'}.png`, 0, 0, this.width, this.height);
        this.heading = this.text(_("RSS Feeds"), this.large ? 20 : 11, this.large ? 15 : 10, this.width - (this.large ? 40 : 24), 19, 'og-feed-heading');
        this.items = new St.BoxLayout({vertical: true, style_class: 'og-feed-list'});
        const scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true}); scroll.set_child(this.items); place(this.body, scroll, this.large ? 20 : 7, this.large ? 44 : 33, this.width - (this.large ? 40 : 14), this.height - (this.large ? 90 : 63));
        this.errorText = this.text(_("Loading…"), this.large ? 20 : 10, 64, this.width - 40, 38, 'og-feed-message'); this.errorText.clutter_text.set_line_wrap(true);
        this.button(_("Open feed"), (this.width - 100) / 2, this.height - (this.large ? 42 : 34), 100, 18, () => this.host.sources.ready.then(() => { if (this.scope.alive) openUri(this.host.sources.feedUrl(this.options)); }), 'og-feed-all');
        this.startNetwork(900);
    }
    async fetchData(scope, force) { return this.host.sources.feed(this.options, scope, force); }
    showFailure(text) { this.errorText.text = text; this.errorText.visible = !!text; }
    render(items) {
        this.heading.text = this.provider;
        this.items.destroy_all_children(); this.errorText.visible = false;
        for (const item of items.slice(0, this.options.count || 8)) {
            const title = label(item.title, 'og-feed-title', {x_expand: true, x_align: Clutter.ActorAlign.FILL});
            styleText(title, {multiline: true, lineHeight: 1.16}); title.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE); title.clutter_text.set_line_wrap(true); title.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            const link = new St.Button({child: title, can_focus: true, style_class: 'og-feed-link', x_expand: true, x_align: Clutter.ActorAlign.FILL}); link.connect('clicked', () => openUri(item.url)); this.items.add_child(link);
        }
    }
}
