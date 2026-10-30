"""Builds the CERT KUMITE game assets from the raw AI art.
usage: python3 tools/kumite_assets.py <raw_art_dir> public/kumite
Input: NN_name.png sprite sheets (4x3 grid, 11 poses, transparent), portraits.png (5x2),
fx.png (4x2), stage_platform.png, stage_background.png.
Output: one optimized sheet per fighter, fx/platform/portraits, background JPEG and manifest.json.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SCALE = 0.5  # 360 px cells → 180 px

POSES = ['idle1', 'idle2', 'walk1', 'walk2', 'quick', 'strong', 'special', 'air', 'hurt', 'ko', 'win']
NAMES = {
    'taekwondo': ('Haru', '#38d6ff'), 'brawler': ('Kenji', '#ff8a2a'), 'karateka': ('Sora', '#3d7bff'),
    'kungfu': ('Mei', '#ffc83d'), 'capoeira': ('Zaya', '#9be22d'), 'cyber': ('Vexa', '#ff3fa4'),
    'sumo': ('Gonzo', '#f2f2f2'), 'punk': ('Riot', '#7dff3a'), 'mecha': ('Unit-09', '#ff9b2a'), 'luchador': ('El Fénix', '#ffb800'),
}

def clean(img: Image.Image, keep_small=60) -> Image.Image:
    """Hard alpha (no soft halos) and drop isolated specks."""
    a = np.array(img.convert('RGBA'))
    solid = a[..., 3] >= 128
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        small = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s < keep_small])
        solid &= ~small
    a[..., 3] = np.where(solid, 255, 0)
    a[~solid, :3] = 0
    return Image.fromarray(a, 'RGBA')

def save_png8(img: Image.Image, path: str, colors=160):
    """Palette PNG with transparency: a fraction of the size of RGBA, same look for pixel art."""
    q = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(path, optimize=True)

def down(img: Image.Image, s: float) -> Image.Image:
    w, h = round(img.width * s), round(img.height * s)
    # premultiply to avoid dark fringes when shrinking
    a = np.array(img.convert('RGBA')).astype(np.float32)
    a[..., :3] *= a[..., 3:4] / 255
    small = np.array(Image.fromarray(a.astype(np.uint8), 'RGBA').resize((w, h), Image.LANCZOS)).astype(np.float32)
    al = small[..., 3:4]
    small[..., :3] = np.where(al > 0, small[..., :3] * 255 / np.maximum(al, 1), 0)
    small[..., 3] = np.where(small[..., 3] >= 110, 255, 0)
    return Image.fromarray(np.clip(small, 0, 255).astype(np.uint8), 'RGBA')

manifest = {'poses': POSES, 'cell': None, 'fighters': []}
for f in sorted(glob.glob(os.path.join(RAW, '[0-9][0-9]_*.png'))):
    key = os.path.basename(f)[3:-4]
    sheet = Image.open(f).convert('RGBA')
    cw, ch = sheet.width // 4, sheet.height // 3
    cells = []
    for i in range(11):
        c = sheet.crop(((i % 4) * cw, (i // 4) * ch, (i % 4 + 1) * cw, (i // 4 + 1) * ch))
        cells.append(clean(c))
    # anchor = feet of the idle pose (centre of its lowest band), shared by every pose
    m = np.array(cells[0])[..., 3] > 0
    ys, xs = np.nonzero(m)
    base = ys.max()
    band = xs[ys >= base - int((base - ys.min()) * 0.12)]
    foot_x = float(np.median(band))
    height = base - ys.min()
    out = Image.new('RGBA', (cw * 11, ch), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        out.alpha_composite(c, (i * cw, 0))
    small = down(out, SCALE)
    save_png8(small, os.path.join(OUT, f'{key}.png'))
    name, color = NAMES.get(key, (key.title(), '#ffffff'))
    manifest['cell'] = [round(cw * SCALE), round(ch * SCALE)]
    manifest['fighters'].append({'id': key, 'num': int(os.path.basename(f)[:2]), 'name': name, 'color': color, 'foot': [round(foot_x * SCALE, 1), round(base * SCALE, 1)], 'height': round(height * SCALE)})
    print(key, small.size, os.path.getsize(os.path.join(OUT, f'{key}.png')) // 1024, 'KB')

# portraits: 5x2 grid, numbered 01..10
p = Image.open(os.path.join(RAW, 'portraits.png')).convert('RGBA')
pw, ph = p.width // 5, p.height // 2
strip = Image.new('RGBA', (160 * 10, 160))
for i in range(10):
    c = p.crop(((i % 5) * pw, (i // 5) * ph, (i % 5 + 1) * pw, (i // 5 + 1) * ph)).resize((160, 160), Image.LANCZOS)
    strip.paste(c, (i * 160, 0))
strip.convert('RGB').save(os.path.join(OUT, 'portraits.jpg'), quality=88)
manifest['portrait'] = 160

fx = clean(Image.open(os.path.join(RAW, 'fx.png')), keep_small=4)
save_png8(down(fx, 0.4), os.path.join(OUT, 'fx.png'), 96)
manifest['fx'] = {'cell': [round(fx.width / 4 * 0.4), round(fx.height / 2 * 0.4)], 'names': ['spark', 'bigspark', 'clash', 'dust', 'dizzy', 'flame', 'fall', 'win']}

plat = clean(Image.open(os.path.join(RAW, 'stage_platform.png')), keep_small=20)
pl = down(plat, 0.5)
save_png8(pl, os.path.join(OUT, 'platform.png'), 128)
# top surface: first row where the platform spans most of its width
a = np.array(pl)[..., 3] > 0
rows = a.sum(1)
top = int(np.argmax(rows > pl.width * 0.6))
manifest['platform'] = {'size': list(pl.size), 'top': top}

bg = Image.open(os.path.join(RAW, 'stage_background.png')).convert('RGB').resize((1280, 720), Image.LANCZOS)
bg.save(os.path.join(OUT, 'background.jpg'), quality=80, optimize=True, progressive=True)
manifest['floor'] = manifest['platform']['top'] + 22  # where the feet stand on the platform top (platform px)
# the app imports the manifest at build time; images are loaded on demand from public/
json.dump(manifest, open(os.path.join(os.path.dirname(__file__), '..', 'src', 'kumite', 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in manifest.items() if k != 'fighters'}))
