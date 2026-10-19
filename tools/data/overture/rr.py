# Seekable HTTP range reader so pyarrow can read remote parquet footers / row groups.
import io, requests
S = requests.Session()
class RangeFile(io.RawIOBase):
    def __init__(self, url, size=None):
        self.url, self.pos = url, 0
        self.size = size if size is not None else int(S.head(url, timeout=60).headers['Content-Length'])
        self.bytes_read = 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0: return b''
        for attempt in range(5):
            try:
                r = S.get(self.url, headers={'Range': f'bytes={self.pos}-{self.pos + n - 1}'}, timeout=120)
                r.raise_for_status(); b = r.content
                if len(b) == n: break
            except Exception as e:
                if attempt == 4: raise
        self.pos += len(b); self.bytes_read += len(b)
        return b
    def readinto(self, buf):
        b = self.read(len(buf)); buf[:len(b)] = b; return len(b)
BASE = 'https://overturemaps-us-west-2.s3.amazonaws.com/'
def list_keys(prefix):
    import re
    out, token = [], None
    while True:
        u = BASE + '?list-type=2&prefix=' + prefix + ('&continuation-token=' + requests.utils.quote(token) if token else '')
        t = S.get(u, timeout=60).text
        out += [(k, int(s)) for k, s in re.findall(r'<Key>([^<]*)</Key>.*?<Size>(\d+)</Size>', t)]
        m = re.search(r'<NextContinuationToken>([^<]*)', t)
        if not m: return out
        token = m.group(1)
