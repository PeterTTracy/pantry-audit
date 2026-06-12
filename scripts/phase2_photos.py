"""Phase 2 — backfill the Visual Ingredient Book's embedded "image in cell"
photos into the pantry-audit cloud, attached to each item's photo library.

  Dry run (default): resolve every photo cell -> product, print match stats.
  Apply:  APPLY=1 BOOK_PATH=... python scripts/phase2_photos.py

Idempotent: each photo gets a deterministic Storage path
({unit}/{sku}/wb-{col}.png), so re-running (e.g. on an updated workbook)
upserts the same slots and adds new ones, and never touches user-captured
photos (those use uuid paths + source upload/camera).
"""
import os, re, json, zipfile, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

BOOK = os.environ['BOOK_PATH']
APPLY = os.environ.get('APPLY') == '1'
SUPA = 'https://kagfnnzaboxghfegingr.supabase.co'
KEY = 'sb_publishable_9imHsUszxPHpiPZO0aLg-w_oenENnjF'
BUCKET = 'label-photos'

z = zipfile.ZipFile(BOOK)
def read(n): return z.read(n).decode('utf-8', 'replace')

SHEETS = {'Baker':'sheet1','Forbes':'sheet2','Masseh':'sheet3','Next':'sheet4',
          'Simmons':'sheet5','Vassar':'sheet6','Orphans':'sheet7'}

# ---- vm (1-based) -> media file (the resolver validated in phase2_resolve) --
meta = read('xl/metadata.xml')
fm = meta.split('<futureMetadata name="XLRICHVALUE"',1)[1].split('</futureMetadata>',1)[0]
future_rvb = [int(m) for m in re.findall(r'<xlrd:rvb i="(\d+)"/>', fm)]
vm_section = meta.split('<valueMetadata',1)[1].split('</valueMetadata>',1)[0]
vm_v = [int(m) for m in re.findall(r'<rc[^>]*\bv="(\d+)"', vm_section)]
rd = read('xl/richData/rdrichvalue.xml')
rv_localimg = [int(re.search(r'<v>(\d+)</v>', r).group(1)) for r in re.findall(r'<rv[^>]*>(.*?)</rv>', rd)]
rel_rids = re.findall(r'<rel r:id="(rId\d+)"/>', read('xl/richData/richValueRel.xml'))
rid_media = {m.group(1): m.group(2).replace('../','xl/')
             for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', read('xl/richData/_rels/richValueRel.xml.rels'))}
def vm_media(vm): return rid_media[rel_rids[rv_localimg[future_rvb[vm_v[vm-1]]]]]

# ---- shared strings + per-sheet cell values --------------------------------
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    sx = read('xl/sharedStrings.xml')
    # each <si> ... </si>; concat all <t> text inside
    for si in re.findall(r'<si>(.*?)</si>', sx, re.S):
        ss.append(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))

def unescape(s):
    return (s.replace('&amp;','&').replace('&lt;','<').replace('&gt;','>')
             .replace('&quot;','"').replace('&apos;',"'"))

def col_to_idx(col):
    n = 0
    for ch in col: n = n*26 + (ord(ch)-64)
    return n-1

CELL = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', re.S)
def parse_sheet(sx):
    """rows: {rownum: {col_letter: text_value}}; also vm cells list."""
    xml = read(f'xl/worksheets/{sx}.xml')
    rows = {}
    for col, row, attrs, inner in CELL.findall(xml):
        if inner is None or '<v>' not in inner: continue
        t = re.search(r'\bt="([^"]+)"', attrs)
        v = re.search(r'<v>(.*?)</v>', inner, re.S)
        if not v: continue
        val = v.group(1)
        if t and t.group(1) == 's':
            val = ss[int(val)]
        elif t and t.group(1) == 'e':
            continue  # error cell (the #VALUE! image placeholders) — no text value
        rows.setdefault(int(row), {})[col] = unescape(val).strip()
    vmcells = [(c, int(r), int(vm)) for c, r, vm in re.findall(r'<c r="([A-Z]+)(\d+)"[^>]*\bvm="(\d+)"', xml)]
    return rows, vmcells

# ---- SKU derivation — must match scripts/migrate.mjs exactly ----------------
def norm_gtin(v):
    d = re.sub(r'\D', '', str(v or ''))
    if not d: return None
    if 8 < len(d) < 13: return d.zfill(13)
    return d
def sku_for(distNum, customer, gtin, mfgNum, seq, desc):
    if distNum: return distNum
    if customer: return f'C:{customer}'
    if gtin: return f'G:{gtin}'
    if mfgNum: return f'M:{mfgNum}'
    if seq: return f'SEQ-{seq}'
    return f'DESC-{desc}'[:60]

def safe(s):
    s = re.sub(r'[^a-zA-Z0-9._-]+', '_', str(s or ''))
    return s.strip('_') or 'x'

# ---- build the full (product, image) mapping -------------------------------
mapping = []          # {unit, sku, desc, col, label, media, path}
unmatched = []        # (unit, row, sku) with photos but parse couldn't form a usable row
per_sheet = {}
for unit, sx in SHEETS.items():
    rows, vmcells = parse_sheet(sx)
    header = rows.get(1, {})
    hdr_lower = {c: v.strip().lower() for c, v in header.items()}
    def find_col(name):
        for c, v in hdr_lower.items():
            if v == name: return c
        return None
    col = {k: find_col(n) for k, n in {
        'desc':'item description','dist':'dist #','gtin':'gtin','mfg':'mfg #',
        'cust':'customer #','seq':'seq'}.items()}
    photos_here = 0
    rows_with_photo = set()
    seen = set()  # (sku, media) dedupe so one image isn't attached twice to a product
    for pcol, prow, vm in vmcells:
        if prow == 1: continue
        r = rows.get(prow, {})
        get = lambda k: r.get(col[k], '') if col[k] else ''
        desc = get('desc')
        if not desc:
            unmatched.append((unit, prow, None)); continue
        gtin = norm_gtin(r.get(col['gtin'], '')) if col['gtin'] else None
        sku = sku_for(get('dist'), get('cust'), gtin, get('mfg'), get('seq'), desc)
        media = vm_media(vm)
        if (sku, media) in seen: continue
        seen.add((sku, media))
        label = header.get(pcol, pcol)
        path = f"{safe(unit)}/{safe(sku)}/wb-{pcol}.png"
        mapping.append({'unit':unit,'sku':sku,'desc':desc,'col':pcol,'label':label,'media':media,'path':path})
        photos_here += 1
        rows_with_photo.add(prow)
    per_sheet[unit] = {'photos':photos_here, 'products':len(rows_with_photo)}

# ---- fetch cloud product ids: (unit, sku) -> id ----------------------------
def api_get(path):
    req = urllib.request.Request(f'{SUPA}/rest/v1/{path}',
        headers={'apikey':KEY,'Authorization':f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

idmap = {}
frm = 0
while True:
    chunk = api_get(f'products?select=id,unit_name,distributor_sku&order=id&offset={frm}&limit=1000')
    for p in chunk: idmap[(p['unit_name'], p['distributor_sku'])] = p['id']
    if len(chunk) < 1000: break
    frm += 1000

matched = [m for m in mapping if (m['unit'], m['sku']) in idmap]
nomatch = [m for m in mapping if (m['unit'], m['sku']) not in idmap]

print('\nUNIT       photo-cells  products-with-photos')
for u in SHEETS:
    print(f"  {u:8}  {per_sheet[u]['photos']:5}        {per_sheet[u]['products']:4}")
total_bytes = sum(z.getinfo(m['media']).file_size for m in matched)
print('-'*48)
print(f"mapping rows: {len(mapping)} | matched to a cloud product: {len(matched)} | UNMATCHED sku: {len(nomatch)}")
print(f"rows skipped (no Item Description): {len(unmatched)}")
print(f"distinct products getting photos: {len(set((m['unit'],m['sku']) for m in matched))}")
print(f"total image bytes to upload: {total_bytes/1e6:.1f} MB")
if nomatch[:5]:
    print('sample UNMATCHED:', [(m['unit'], m['sku'], m['desc'][:24]) for m in nomatch[:5]])

if not APPLY:
    print('\nDRY RUN — nothing uploaded. Re-run with APPLY=1 to backfill.')
    raise SystemExit(0)

# ---- APPLY: upload images (concurrent) + upsert photo rows ------------------
def upload(m):
    data = z.read(m['media'])
    req = urllib.request.Request(f'{SUPA}/storage/v1/object/{BUCKET}/{m["path"]}', data=data, method='POST',
        headers={'apikey':KEY,'Authorization':f'Bearer {KEY}','Content-Type':'image/png','x-upsert':'true'})
    try:
        urllib.request.urlopen(req, timeout=120).read(); return (m, None)
    except urllib.error.HTTPError as e:
        return (m, f'{e.code} {e.read().decode()[:120]}')

print(f'\nUploading {len(matched)} images...')
ok_rows, fails = [], []
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(upload, m): m for m in matched}
    done = 0
    for f in as_completed(futs):
        m, err = f.result(); done += 1
        if err: fails.append((m['path'], err))
        else:
            ok_rows.append({'product_id': idmap[(m['unit'], m['sku'])], 'file_name': m['label'],
                            'storage_path': m['path'], 'content_type':'image/png',
                            'source':'workbook', 'sort': col_to_idx(m['col'])})
        if done % 100 == 0: print(f'  {done}/{len(matched)}')
print(f'uploaded ok: {len(ok_rows)} | failed: {len(fails)}')
if fails[:5]: print('sample failures:', fails[:5])

print('Upserting photo rows...')
def upsert(rows):
    body = json.dumps(rows).encode()
    req = urllib.request.Request(f'{SUPA}/rest/v1/photos?on_conflict=storage_path', data=body, method='POST',
        headers={'apikey':KEY,'Authorization':f'Bearer {KEY}','Content-Type':'application/json',
                 'Prefer':'resolution=merge-duplicates'})
    urllib.request.urlopen(req, timeout=120).read()
for i in range(0, len(ok_rows), 500):
    upsert(ok_rows[i:i+500])

cnt = api_get('photos?select=id')
print(f'\nDone. cloud photos rows now: {len(cnt)}')
