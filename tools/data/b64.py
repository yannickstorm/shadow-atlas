# Artifacts serve only web media types, so each binary bundle also ships as base64 text (<name>.txt).
import os, sys, base64
root = sys.argv[1] if len(sys.argv) > 1 else 'dist/terrain'
n = 0
for layer in sorted(os.listdir(root)):
    d = os.path.join(root, layer)
    for f in sorted(os.listdir(d)):
        if not f.endswith('.bin'): continue
        with open(os.path.join(d, f), 'rb') as fh: data = fh.read()
        with open(os.path.join(d, f[:-4] + '.txt'), 'w') as fh: fh.write(base64.b64encode(data).decode('ascii'))
        n += 1
print('wrote', n)
