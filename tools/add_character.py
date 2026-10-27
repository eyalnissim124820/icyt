"""Add a character to the game from a 5x3 sprite sheet on a magenta background.

    python3 tools/add_character.py SHEET KEY "Display Name" [--short NAME] [--sounds-from harold] [--height 52]

The sheet holds the 15 frames in the game's order (idle, walk x4, jump up /
peak / down, straight jump, idle 2, idle 3, scared, cartwheel, edge x2),
left to right, top to bottom. Each pose is cut out, scaled so a standing
frame is --height pixels tall (52 matches the original characters), keyed
to transparency and saved as assets/characters/KEY/001_BMP.png ... 015_BMP.png.
The character is then registered in assets/characters/index.json.

Requires Pillow.
"""
import argparse
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CHARS = os.path.join(ROOT, 'assets', 'characters')
SOUND_COUNT = 7  # jumplo, jumpmed, jumphi, pause, death, greeting, edge (bgmusic optional)


def magenta(r, g, b):
    return min(r, b) - g > 110


def runs(flags, min_len, max_gap):
    """Spans of True values, bridging gaps up to max_gap and dropping short spans."""
    spans, start, last = [], None, None
    for i, f in enumerate(flags):
        if f:
            if start is None:
                start = i
            elif i - last > max_gap + 1:
                spans.append((start, last + 1))
                start = i
            last = i
    if start is not None:
        spans.append((start, last + 1))
    return [s for s in spans if s[1] - s[0] >= min_len]


def cut_frames(sheet):
    w, h = sheet.size
    px = sheet.load()
    fg = [[not magenta(*px[x, y]) for x in range(w)] for y in range(h)]
    rows = runs([sum(r) > 2 for r in fg], 20, 6)
    if len(rows) != 3:
        sys.exit(f'expected 3 rows of frames, found {len(rows)}')
    boxes = []
    for y0, y1 in rows:
        cols = runs([sum(fg[y][x] for y in range(y0, y1)) > 1 for x in range(w)], 20, 6)
        if len(cols) != 5:
            sys.exit(f'expected 5 frames in the row at y={y0}, found {len(cols)}')
        for x0, x1 in cols:
            ys = [y for y in range(y0, y1) if any(fg[y][x0:x1])]
            boxes.append((x0, ys[0], x1, ys[-1] + 1))
    return boxes


def to_sprite(sheet, box, scale):
    crop = sheet.crop(box).convert('RGBA')
    px = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            r, g, b, _ = px[x, y]
            if magenta(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    # premultiplied resize so transparent magenta never bleeds into edges
    small = crop.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
            elif min(r, b) - g > 60:  # leftover pink fringe becomes outline
                px[x, y] = (0, 0, 0, 255)
            else:
                px[x, y] = (r, g, b, 255)
    bbox = small.getbbox()
    return small.crop(bbox) if bbox else small


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sheet')
    ap.add_argument('key', help='folder name, lowercase letters/digits')
    ap.add_argument('name', help='full name shown in menus')
    ap.add_argument('--short', help='short name for the options menu (defaults to name)')
    ap.add_argument('--sounds-from', default='harold', help='reuse the voice clips of this character')
    ap.add_argument('--height', type=int, default=52, help='height of a standing frame in pixels')
    args = ap.parse_args()

    sheet = Image.open(args.sheet).convert('RGB')
    boxes = cut_frames(sheet)
    idle_h = sorted(boxes[i][3] - boxes[i][1] for i in (0, 9, 10))[1]
    scale = args.height / idle_h

    out = os.path.join(CHARS, args.key)
    os.makedirs(out, exist_ok=True)
    frames = []
    for i, box in enumerate(boxes):
        name = f'{i + 1:03d}_BMP'
        sprite = to_sprite(sheet, box, scale)
        sprite.save(os.path.join(out, name + '.png'), optimize=True)
        frames.append([name, sprite.width, sprite.height])

    index_path = os.path.join(CHARS, 'index.json')
    index = json.load(open(index_path))
    source = index[args.sounds_from]
    sounds = [f'../{args.sounds_from}/{s}' for s in source['sounds'][:SOUND_COUNT]]
    index[args.key] = {'name': args.name, 'short': args.short or args.name, 'frames': frames, 'sounds': sounds}
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=1)
    print(f'added {args.key}: ' + ', '.join(f'{w}x{h}' for _, w, h in frames))


if __name__ == '__main__':
    main()
