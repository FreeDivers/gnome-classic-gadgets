// SPDX-License-Identifier: MIT
// Font hinting rounds individual glyph advances, so width does not scale
// linearly. Measure candidates instead of multiplying a one-shot width ratio.
export function readableTextScale(measure, available, minimum = 0.7) {
    if (!Number.isFinite(available) || available <= 0) return 1;
    const floor = Math.min(1, Math.max(0.01, Number.isFinite(minimum) ? minimum : 0.7));
    if (measure(1) <= available) return 1;
    if (measure(floor) >= available) return floor;
    let low = floor, high = 1;
    for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (measure(mid) <= available) low = mid;
        else high = mid;
    }
    return Math.max(floor, Math.floor(low * 1024) / 1024);
}
