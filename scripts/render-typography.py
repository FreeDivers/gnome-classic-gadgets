#!/usr/bin/env python3
"""Make a labelled atlas from real Shell screenshots (never redraw gadget text)."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, default=ROOT / 'build/smoke/typography')
parser.add_argument('--output', type=Path, default=ROOT / 'docs')
args = parser.parse_args()
report = json.loads((args.input / 'typography.json').read_text())
args.output.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
head = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
names = {'clock': 'Clock', 'calendar': 'Calendar', 'system': 'CPU / Memory', 'notes': 'Notes',
         'photos': 'Photos', 'timer': 'Timer', 'puzzle': 'Puzzle', 'weather': 'Weather', 'rss': 'RSS',
         'currency': 'Currency', 'stocks': 'Stocks', 'contacts': 'Contacts', 'trash': 'Recycle Bin', 'calculator': 'Calculator'}
def crop_from(capture, gadget):
    source = Image.open(args.input / capture['file'])
    x, y, w, h = (gadget[key] for key in ('x', 'y', 'width', 'height'))
    return source.crop((x, y, x + w, y + h)).convert('RGB')


for theme in ['classic', 'fluent']:
    for size in ['small', 'large']:
        compact = size == 'small'
        atlas = Image.new('RGB', (1540, 754 if compact else 1340), '#233d4d')
        draw = ImageDraw.Draw(atlas)
        caption = 'compact skins — 1.5x crops' if compact else 'expanded skins — native-size crops'
        draw.text((20, 12), f'{theme.title()} / {caption}', font=head, fill='#f1f5f8')
        captures = [c for c in report['captures'] if c['theme'] == theme and c['size'] == size]
        for group, capture in enumerate(captures):
            for i, gadget in enumerate(capture['gadgets']):
                crop = crop_from(capture, gadget)
                if compact:
                    x, y = 16 + i * 217, 55 + group * 342
                    crop = crop.resize((round(crop.width * 1.5), round(crop.height * 1.5)), Image.Resampling.LANCZOS)
                else:
                    x, y = 16 + i % 4 * 382, 55 + (group * 2 + i // 4) * 317
                draw.text((x, y), names[gadget['type']], font=font, fill='#d3dee8')
                atlas.paste(crop, (x, y + 23))
        atlas.save(args.output / f'typography-{theme}-{size}.png')
print(f'Wrote four source-crop atlases to {args.output}')
