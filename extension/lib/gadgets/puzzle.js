// SPDX-License-Identifier: MIT
import {_, format, ngettext} from '../i18n.js';
// Ubuntu host adapter only. All visual skins are imported, untouched historical
// Windows Gadget resources; see assets/original-assets.json.
import {clamp, finite, validPuzzle, solvablePuzzle, solvedPuzzle, moveTile, shufflePuzzle} from '../core.js';
import {Gadget, place, action, surface} from '../gadget.js';

export const PUZZLE_IMAGES = Array.from({length: 11}, (_, i) => i + 1);
export default class Puzzle extends Gadget {
    optionsSpec() {
        return [{type: 'picker', key: 'image', label: _("Choose a puzzle"), values: PUZZLE_IMAGES,
            names: PUZZLE_IMAGES.map(n => format(_("Original picture {number}"), {number: n})), preview: n => this.asset(`Images/${n}.png`), previewSize: {w: 108, h: 108}}];
    }
    build() {
        this.picture('Images/background.png', 0, 0, 130, 138);
        this.grid = surface(108, 108); place(this.body, this.grid, 11, 12, 108, 108);
        this.spriteButton('Images/shuffle_up.png', 108, 120, 16, 16, _("Shuffle puzzle"), () => this.shuffle());
        this.spriteButton('Images/hint_up.png', 7, 120, 16, 16, _("View completed picture"), () => { this.preview.visible = !this.preview.visible; });
        this.preview = this.picture('Images/1.png', 11, 12, 108, 108); this.preview.visible = false;
        this.status = this.text('', 25, 120, 80, 16, 'og-puzzle-status og-numeric');
        if (!validPuzzle(this.options.tiles) || !solvablePuzzle(this.options.tiles)) this.save({tiles: shufflePuzzle(), moves: 0}); this.render();
    }
    refreshOptions() { if (!validPuzzle(this.options.tiles) || !solvablePuzzle(this.options.tiles)) this.save({tiles: shufflePuzzle(), moves: 0}); this.render(); }
    shuffle() { this.save({tiles: shufflePuzzle(), moves: 0}); this.preview.visible = false; this.render(); }
    move(index) { const tiles = moveTile(this.options.tiles, index); if (!tiles) return false; this.save({tiles, moves: finite(this.options.moves) + 1}); this.render(); return true; }
    render() {
        this.grid.destroy_all_children();
        const imageNumber = clamp(Math.trunc(finite(this.options.image, 1)), 1, 11);
        this.setPicture(this.preview, `Images/${imageNumber}.png`);
        this.options.tiles.forEach((value, index) => {
            const tile = action('', () => this.move(index), {style_class: 'og-puzzle-tile', accessible_name: value ? format(_("Puzzle tile {number}"), {number: value}) : _("Empty space"), clip_to_allocation: true});
            place(this.grid, tile, index % 4 * 27, Math.floor(index / 4) * 27, 27, 27);
            if (!value) { tile.reactive = false; return; }
            const container = surface(27, 27, {clip_to_allocation: true}); tile.set_child(container);
            this.picture(`Images/${imageNumber}.png`, -((value - 1) % 4) * 27, -Math.floor((value - 1) / 4) * 27, 108, 108, container);
        });
        this.status.text = solvedPuzzle(this.options.tiles) ? _("Solved!") : format(ngettext("{count} move", "{count} moves", this.options.moves), {count: this.options.moves});
    }
}
