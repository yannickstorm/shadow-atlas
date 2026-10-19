# Bundle per-cell street blobs (data/st/<layer>/<la>_<lo>.bin) into base64 text bundles + manifest.
import os, struct, json, math, collections, base64
B = './'
LAYERS = [('sm', 20), ('sd', 5)]
man = {'q': 20000, 'layers': []}; tot = 0; files = 0
for name, blk in LAYERS:
    groups = collections.defaultdict(list)
    for f in os.listdir(B + 'data/st/' + name):
        la, lo = map(int, f[:-4].split('_'))
        bl = math.floor(la / blk) * blk; bo = math.floor(lo / blk) * blk
        nm = ('N' if bl >= 0 else 'S') + str(abs(bl)).zfill(2) + ('E' if bo >= 0 else 'W') + str(abs(bo)).zfill(3)
        groups[nm].append((la, lo, open(B + 'data/st/' + name + '/' + f, 'rb').read()))
    d = B + 'dist/streets/' + name + '/'; os.makedirs(d, exist_ok=True)
    for f in os.listdir(d): os.remove(d + f)
    def write(nm, cells):
        global tot, files
        hdr = b'SAT1' + struct.pack('<HBBH', 0, 0, 0, len(cells))
        off = len(hdr) + 12 * len(cells); idx = b''; body = b''
        for la, lo, data in cells: idx += struct.pack('<hhII', la, lo, off + len(body), len(data)); body += data
        b64 = base64.b64encode(hdr + idx + body); open(d + nm + '.txt', 'wb').write(b64); tot += len(b64); files += 1
    split = []
    for nm, cells in groups.items():
        # dense blocks are split into quarters (suffix ne/nw/se/sw) so one download stays small
        if sum(len(c[2]) for c in cells) * 4 / 3 > 1.8e6 and blk >= 4:
            h = blk / 2; split.append(nm); q = collections.defaultdict(list)
            for la, lo, data in cells:
                bl = math.floor(la / blk) * blk; bo = math.floor(lo / blk) * blk
                q[('n' if la - bl >= h else 's') + ('e' if lo - bo >= h else 'w')].append((la, lo, data))
            for k, cs in q.items(): write(nm + k, cs)
        else: write(nm, cells)
    man['layers'].append({'name': name, 'block': blk, 'files': sorted(f[:-4] for f in os.listdir(d)), 'split': sorted(split), 'cells': sorted((la + 90) * 360 + (lo + 180) for cs in groups.values() for la, lo, _ in cs)})
    print(name, len(groups), 'files', 'largest MB', max(os.path.getsize(d + f) for f in os.listdir(d)) / 1e6)
json.dump(man, open(B + 'data/streets_manifest.json', 'w'), separators=(',', ':'))
print('files', files, 'total b64 MB', round(tot / 1e6, 1))
