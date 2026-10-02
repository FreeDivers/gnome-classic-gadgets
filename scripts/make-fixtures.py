#!/usr/bin/env python3
"""Generate original raster test images with the standard library, no downloads."""
from pathlib import Path
import struct
import zlib
ROOT = Path(__file__).resolve().parent.parent
folder = ROOT / 'build' / 'test-photos'
folder.mkdir(parents=True, exist_ok=True)
def chunk(name, data):
    return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))
for index, sky in enumerate([(113, 158, 171), (168, 153, 114)], 1):
    width, height = 400, 280
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            color = sky
            if (x - 255) ** 2 + (y - 55) ** 2 < 35 ** 2:
                color = (239, 221, 176)
            if y > 70 + abs(x - 150) * 0.7:
                color = (53, 85, 99)
            raw.extend(color)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    (folder / f'{index}.png').write_bytes(png)
