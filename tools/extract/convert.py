# Converts the original Icy Tower datafiles to web assets (PNG / OGG / MP3 / JSON).
import sys, os, struct, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
import alldat
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]

def bmp16(data):
    b, w, h = struct.unpack('>hhh', data[:6])
    if b in (24, 32):
        raw = data[6:6 + w * h * 3]
        im = Image.new('RGBA', (w, h))
        im.putdata([(0, 0, 0, 0) if raw[i:i+3] == b'\xff\x00\xff' else (raw[i], raw[i+1], raw[i+2], 255) for i in range(0, len(raw), 3)])
        return im
    assert b in (15, 16), b
    px = struct.unpack('<%dH' % (w * h), data[6:6 + w * h * 2])
    im = Image.new('RGBA', (w, h))
    out = []
    for c in px:
        if c == 0xF81F: out.append((255, 0, 255, 0)); continue
        r = (c >> 11) & 31; g = (c >> 5) & 63; bb = c & 31
        out.append(((r * 255 + 15) // 31, (g * 255 + 31) // 63, (bb * 255 + 15) // 31, 255))
    im.putdata(out)
    return im

def palette(data):
    return [tuple(min(255, data[i * 4 + k] * 255 // 63) for k in range(3)) for i in range(256)]

def font(data, pal):
    o = 0
    ftype, nr = struct.unpack('>hh', data[:4]); o = 4
    assert ftype == 0
    glyphs = []
    for _ in range(nr):
        mono = data[o]; begin, end = struct.unpack('>ii', data[o+1:o+9]); o += 9
        for ch in range(begin, end + 1):
            w, h = struct.unpack('>hh', data[o:o+4]); o += 4
            im = Image.new('RGBA', (max(w, 1), max(h, 1)), (0, 0, 0, 0))
            if mono:
                stride = (w + 7) // 8
                for y in range(h):
                    for x in range(w):
                        if data[o + y * stride + x // 8] & (0x80 >> (x % 8)):
                            im.putpixel((x, y), (255, 255, 255, 255))
                o += stride * h
            else:
                for y in range(h):
                    for x in range(w):
                        c = data[o + y * w + x]
                        if c: im.putpixel((x, y), pal[c] + (255,))
                o += w * h
            glyphs.append((ch, w, h, im))
    assert o == len(data), (o, len(data))
    # pack into an atlas row-wise
    W = 512; x = y = rowh = 0; meta = {}
    for ch, w, h, im in glyphs:
        if x + w > W: x = 0; y += rowh + 1; rowh = 0
        meta[ch] = [x, y, w, h]; x += w + 1; rowh = max(rowh, h)
    atlas = Image.new('RGBA', (W, y + rowh + 1), (0, 0, 0, 0))
    for ch, w, h, im in glyphs:
        if w and h: atlas.paste(im, tuple(meta[ch][:2]))
    return atlas, {'mono': bool(glyphs and data[4]), 'height': max(g[2] for g in glyphs), 'glyphs': meta}

def audio(data, base):
    open(base + '.ogg', 'wb').write(data)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', base + '.ogg', '-codec:a', 'libmp3lame', '-q:a', '4', base + '.mp3'], check=True)

def mk(p): os.makedirs(p, exist_ok=True); return p

gfx = mk(f'{DST}/gfx'); fonts = mk(f'{DST}/fonts'); sfx = mk(f'{DST}/sfx')
objs = alldat.load(f'{SRC}/data/data.dat', 'CHEESE')
pal = palette(objs[0]['data'])
for ob in objs:
    name = ob['props'].get('NAME', '')
    if ob['type'] == 'BMP ': bmp16(ob['data']).save(f'{gfx}/{name}.png', optimize=True)
    elif ob['type'] == 'FONT':
        atlas, meta = font(ob['data'], pal)
        atlas.save(f'{fonts}/{name}.png', optimize=True)
        json.dump(meta, open(f'{fonts}/{name}.json', 'w'))
for ob in alldat.load(f'{SRC}/data/sfx15.dat', 'CHEESE'):
    if ob['type'] == 'OGG ': audio(ob['data'], f'{sfx}/{ob["props"]["NAME"]}')

chars = {'harold': 'harold_the_homeboy/harold.dat', 'dave': 'disco_dave/dave.dat', 'jane': 'jungle_jane/jane.dat', 'wendy': 'wild_wendy/wendy.dat'}
index = {}
for key, path in chars.items():
    d = mk(f'{DST}/characters/{key}')
    frames, sounds = [], []
    for ob in alldat.load(f'{SRC}/characters/{path}'):
        name = ob['props'].get('NAME', '')
        if ob['type'] == 'BMP ':
            im = bmp16(ob['data']); im.save(f'{d}/{name}.png', optimize=True); frames.append([name, im.width, im.height])
        elif ob['type'] in ('OGG ', 'SAMP', 'DATA'):
            if ob['type'] == 'OGG ': audio(ob['data'], f'{d}/{name}'); sounds.append(name)
            else: print('skip', key, ob['type'], name)
    index[key] = {'frames': frames, 'sounds': sounds}
json.dump(index, open(f'{DST}/characters/index.json', 'w'), indent=1)
print('done')
