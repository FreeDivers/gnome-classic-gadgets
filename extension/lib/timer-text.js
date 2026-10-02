// SPDX-License-Identifier: MIT
// Text-path replacement for the original VML timer numerals only. The metal
// body and mask remain the byte-identical Windows timer PNGs.
import Cairo from 'cairo';

export function paintTimerNumerals(area, seconds, silhouette) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    cr.scale(w / 90, h / 111);
    cr.pushGroup();
    const ring = (value, radius, cx, cy, size, family, step, separator) => {
        cr.selectFontFace(family, Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(size);
        cr.setSourceRGBA(0, 0, 0, 0.86);
        const center = Math.floor(value / step) * step;
        const fraction = value / step - Math.floor(value / step);
        const strings = [-2, -1, 0, 1, 2].map(i => `${String((center + i * step + 60) % 60).padStart(2, '0')}${separator}`);
        const segment = cr.textExtents(`00${separator}`).xAdvance;
        let offset = -2 * segment - cr.textExtents('00').xAdvance / 2 - fraction * segment;
        for (const character of strings.join('')) {
            const advance = cr.textExtents(character).xAdvance;
            const angle = (offset + advance / 2) / radius;
            cr.save();
            cr.translate(cx + Math.sin(angle) * radius, cy + Math.cos(angle) * radius);
            cr.rotate(-angle);
            cr.moveTo(-advance / 2, 0);
            cr.showText(character);
            cr.restore();
            offset += advance;
        }
    };
    // The original docked VML ellipses: seconds 180x180 at (-48,-152),
    // minutes 260x260 at (-90,-200). Their lower arcs form the two bands.
    ring(seconds % 60, 90, 42, -62, 10.67, 'DejaVu Serif', 5, '...');
    ring(seconds / 60, 130, 40, -70, 20.5, 'DejaVu Sans', 5, ' • ');
    cr.popGroupToSource();
    cr.maskSurface(silhouette, 0, 0);
    cr.$dispose();
}
