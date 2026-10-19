# Place-name index for search, sharded by the first character of the normalised name.
import gzip, pickle, json, zlib, struct, math, collections, unicodedata, os, base64, sys
D = './'
B = set(json.load(open(D + 'data/cells.json'))) | set(json.load(open(D + 'data/cells_tierA.json')))
r = pickle.load(gzip.open('places.pkl.gz'))
SPECIAL = str.maketrans({'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'þ': 'th', 'ð': 'd', 'ħ': 'h'})
def norm(s):
    s = unicodedata.normalize('NFD', s.lower().translate(SPECIAL))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in s).split())
def shard(k):
    c = k[0]
    if 'a' <= c <= 'z': return c
    if c.isdigit(): return '0'
    cp = ord(c)
    if cp < 0x3000: return 'u%02x' % (cp >> 8)
    return 'w%02x' % (cp >> 12)
KIND = {('locality', 'city'): 0, ('locality', 'town'): 1, ('locality', 'village'): 2, ('locality', 'hamlet'): 3, ('locality', None): 4, ('localadmin', None): 5, ('macrohood', None): 6, ('neighborhood', None): 7}
countries = sorted({x[4] for x in r['rows'] if x[4]}); cidx = {c: i for i, c in enumerate(countries)}
regs = sorted({x[5] for x in r['rows'] if x[5]}); ridx = {c: i + 1 for i, c in enumerate(regs)}
ents = []
for nm, en, la, lo, cc, rg, sub, cls, pop, prom in r['rows']:
    k = KIND.get((sub, cls))
    if k is None: continue
    if k == 3 and f'{math.floor(la)},{math.floor(lo)}' not in B: continue        # hamlets only along eclipse paths
    if k == 7 and not (pop or prom >= 14): continue                              # notable neighbourhoods only
    if k == 4 and not (pop or prom): continue
    for name, alias in ((nm, 0), (en, 1)):
        if not name: continue
        key = norm(name)
        if not key: continue
        ents.append((key, name, la, lo, cidx.get(cc, len(countries)), ridx.get(rg, 0), k | (0x80 if alias else 0), pop or 0))
print('entries', len(ents), collections.Counter(e[6] & 0x7f for e in ents))
sh = collections.defaultdict(list)
for e in ents: sh[shard(e[0])].append(e)
out = D + 'dist/places/'; os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(out + f)
tot = 0; man = {}
def vi(o, u):
    while u >= 0x80: o.append((u & 0x7f) | 0x80); u >>= 7
    o.append(u)
for s, L in sh.items():
    L.sort(key=lambda e: (e[0], -e[7]))
    names = bytearray(); prev = b''
    for e in L:
        b = e[1].encode(); p = 0
        while p < min(len(b), len(prev), 255) and b[p] == prev[p]: p += 1
        names.append(p); vi(names, len(b) - p); names += b[p:]; prev = b
    lat = bytearray(); lon = bytearray(); cc = bytearray(); rg = bytearray(); kd = bytearray(); pp = bytearray()
    for e in L:
        a = int(round((e[2] + 90) * 1e4)); o = int(round((e[3] + 180) * 1e4))
        lat += a.to_bytes(3, 'little'); lon += o.to_bytes(3, 'little'); vi(cc, e[4]); vi(rg, e[5]); kd.append(e[6]); vi(pp, min(e[7] // 100, 10**6))
    body = struct.pack('<I', len(L))
    for blk in (names, lat, lon, cc, rg, kd, pp): body += struct.pack('<I', len(blk)) + blk
    z = zlib.compress(bytes(body), 9); b64 = base64.b64encode(z)
    open(out + s + '.txt', 'wb').write(b64); tot += len(b64); man[s] = len(L)
json.dump({'countries': countries, 'regions': [r['regions'].get(x, x) for x in regs], 'cnames': [r['countries'].get(c, c) for c in countries], 'shards': man}, open(D + 'data/places_manifest.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('shards', len(sh), 'total base64 MB', round(tot / 1e6, 1), 'largest', sorted(((round(os.path.getsize(out + s + '.txt') / 1e6, 2), s) for s in sh), reverse=True)[:6])
print('manifest KB', os.path.getsize(D + 'data/places_manifest.json') / 1e3)
