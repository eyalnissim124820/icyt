import sys, struct, os, json

def lzss(data):
    N, F, TH = 4096, 18, 2
    buf = bytearray(N); r = N - F; out = bytearray(); i = 0; flags = 0
    n = len(data)
    while True:
        flags >>= 1
        if not (flags & 0x100):
            if i >= n: break
            flags = data[i] | 0xFF00; i += 1
        if flags & 1:
            if i >= n: break
            c = data[i]; i += 1
            out.append(c); buf[r] = c; r = (r + 1) & (N - 1)
        else:
            if i + 1 >= n: break
            a = data[i]; b = data[i+1]; i += 2
            a |= (b & 0xF0) << 4; l = (b & 0x0F) + TH
            for k in range(l + 1):
                c = buf[(a + k) & (N - 1)]
                out.append(c); buf[r] = c; r = (r + 1) & (N - 1)
    return bytes(out)

def mask(pw, new=True):
    m = 0
    for i, ch in enumerate(pw): m ^= ord(ch) << ((i & 3) * 8)
    pos = 0
    for i in range(4):
        m ^= ord(pw[pos]) << (24 - i * 8); pos += 1
        if pos >= len(pw): pos = 0
    if new: m ^= 42
    return m & 0xFFFFFFFF

def openpack(path, pw=''):
    raw = open(path, 'rb').read()
    hdr = struct.unpack('>I', raw[:4])[0]
    body = bytearray(raw[4:])
    if pw:
        hdr ^= 0x45450d3a
        k = pw.encode(); L = len(k); off = 4 % L
        for j in range(len(body)): body[j] ^= k[(j + off) % L]
    if hdr == 0x736C6821: return lzss(bytes(body))
    if hdr == 0x736C682E: return bytes(body)
    raise SystemExit('bad magic %08x' % hdr)

def be32(d, o): return struct.unpack('>i', d[o:o+4])[0]

def parse(d, o, count):
    objs = []
    for _ in range(count):
        props = {}
        while True:
            t = d[o:o+4].decode('latin1'); o += 4
            if t == 'prop':
                pt = d[o:o+4].decode('latin1'); sz = be32(d, o+4)
                props[pt] = d[o+8:o+8+sz].decode('latin1'); o += 8 + sz
                continue
            s1 = be32(d, o); s2 = be32(d, o+4); o += 8
            data = d[o:o+s1]; o += s1
            if s2 < 0: data = lzss(data)  # individually compressed
            obj = {'type': t, 'props': props, 'data': data}
            if t == 'FILE':
                obj['children'], _ = parse(data, 4, be32(data, 0))
            objs.append(obj)
            break
    return objs, o

def load(path, pw=''):
    d = openpack(path, pw)
    assert d[:4] == b'ALL.', d[:8]
    objs, _ = parse(d, 8, be32(d, 4))
    return objs

def walk(objs, depth=0):
    for ob in objs:
        print('  ' * depth + ob['type'], ob['props'].get('NAME'), len(ob['data']), {k: v for k, v in ob['props'].items() if k not in ('NAME', 'DATE', 'ORIG')})
        if 'children' in ob: walk(ob['children'], depth + 1)

if __name__ == '__main__':
    walk(load(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ''))
