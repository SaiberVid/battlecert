"""Builds the CERT RAID sprites from the co-op shooter atlas.
usage: python3 tools/raid_assets.py <atlas.png> public/raid src/raid/manifest.json
The atlas has no transparency and no fixed grid, so each region below is cut out by colour distance
to the dark panel background, split into frames by the empty columns between them, and packed into
one sheet per entity (fixed cells, sprites bottom-centred) plus manifest.json.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
atlas = np.array(Image.open(SRC).convert('RGB')).astype(int)

def cutout(box, thr=34, keep=6, flood=False):
    x0, y0, x1, y1 = box
    a = atlas[y0:y1, x0:x1]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.abs(a - bg).max(axis=2)
    if flood:
        # background = near-bg pixels connected to the crop edge; dark sprite pixels enclosed by outlines stay
        near = dist <= thr
        lab, _ = ndimage.label(near)
        edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        sizes = ndimage.sum(near, lab, range(1, lab.max() + 1))
        big_dark = [i + 1 for i, sz in enumerate(sizes) if sz > 150]  # large enclosed bg-coloured gaps (between legs…)
        m = ~np.isin(lab, list(edge) + big_dark)
        m = ndimage.binary_opening(m, iterations=1)
    else:
        m = dist > thr
        m = ndimage.binary_closing(m, iterations=1)
    holes = ndimage.binary_fill_holes(m) & ~m  # fill only small holes (specks), not gaps such as between legs
    hl, hn = ndimage.label(holes)
    if hn:
        hs = ndimage.sum(holes, hl, range(1, hn + 1))
        m |= np.isin(hl, [i + 1 for i, s in enumerate(hs) if s < 60])
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        objs = ndimage.find_objects(lab)
        big = max(sizes)
        ok = []
        for i, (sz, sl) in enumerate(zip(sizes, objs)):
            h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            edge = sl[1].start == 0 or sl[1].stop == m.shape[1] or sl[0].stop == m.shape[0]
            if sz < keep or (h <= 4 and w > 12) or (w <= 6 and h > 16) or (edge and sz < 0.15 * big): continue
            ok.append(i + 1)
        m &= np.isin(lab, ok)
    rgba = np.zeros((*m.shape, 4), np.uint8)
    rgba[..., :3] = a.astype(np.uint8)
    rgba[..., 3] = np.where(m, 255, 0)
    return rgba

def split(rgba, n):
    """Splits a strip into n frames at the widest empty-column gaps."""
    cols = rgba[..., 3].max(axis=0) > 0
    runs, x = [], 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]: x += 1
            runs.append([s, x])
        else: x += 1
    while len(runs) > n:  # merge the narrowest run into its closest neighbour
        i = min(range(len(runs)), key=lambda k: runs[k][1] - runs[k][0])
        if i == 0: j = 1
        elif i == len(runs) - 1: j = i - 1
        else: j = i - 1 if runs[i][0] - runs[i - 1][1] <= runs[i + 1][0] - runs[i][1] else i + 1
        a, b = sorted([i, j]); runs[a] = [runs[a][0], runs[b][1]]; del runs[b]
    assert len(runs) == n, (len(runs), n)
    return [rgba[:, s:e] for s, e in runs]

def trim(f):
    al = f[..., 3]
    ys, xs = np.nonzero(al)
    return f[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def sheet(name, frames, pad=4):
    frames = [trim(f) for f in frames]
    cw = max(f.shape[1] for f in frames) + pad * 2
    ch = max(f.shape[0] for f in frames) + pad * 2
    img = Image.new('RGBA', (cw * len(frames), ch), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im = Image.fromarray(f, 'RGBA')
        img.paste(im, (i * cw + (cw - f.shape[1]) // 2, ch - pad - f.shape[0]), im)
    img.quantize(colors=200, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(OUT, name + '.png'), optimize=True)
    return {'w': cw, 'h': ch, 'n': len(frames)}

def cells(box, n): return split(cutout(box), n)

man = {}
HERO_POSES = ['idle1', 'idle2', 'idle3', 'idle4', 'run1', 'run2', 'run3', 'run4', 'aim', 'shoot1', 'shoot2', 'shoot3', 'stun', 'kneel', 'down', 'win']
for name, x in (('rex', 0), ('nova', 775)):
    fr = cells((165 + x, 14, 452 + x, 99), 4) + cells((462 + x, 14, 762 + x, 99), 4) \
       + cells((165 + x, 107, 452 + x, 224), 4) + cells((462 + x, 107, 762 + x, 224), 4)
    man[name] = {**sheet(name, fr), 'poses': HERO_POSES}

BOSS_POSES = ['spawn', 'appear', 'idle1', 'idle2', 'attack1', 'attack2', 'hurt', 'boom']
COLS = [234, 372, 507, 672, 838, 1030, 1205, 1372, 1530]
for name, (y0, y1) in (('gatling', (249, 410)), ('voraxia', (427, 586)), ('skyreaper', (603, 786))):
    fr = [cutout((COLS[i], y0, COLS[i + 1], y1), thr=14, flood=True) for i in range(8)]
    man[name] = {**sheet(name, fr), 'poses': BOSS_POSES}

fx = cells((748, 815, 1418, 955), 10) + [cutout((1418, 815, 1462, 955)), cutout((1462, 815, 1528, 955))]
man['fx'] = {**sheet('fx', fx, pad=2), 'poses': ['bullet', 'bullet2', 'orb', 'orb2', 'spark', 'boom1', 'boom2', 'smoke1', 'smoke2', 'smoke3', 'slash1', 'slash2']}
red = trim(cutout((22, 835, 68, 885))); blue = trim(cutout((22, 895, 68, 945)))
man['hearts'] = {**sheet('hearts', [red, blue], pad=1), 'poses': ['red', 'blue']}

def portrait(box, name, size=96):
    im = Image.fromarray(atlas[box[1]:box[3], box[0]:box[2]].astype(np.uint8), 'RGB').resize((size, size), Image.LANCZOS)
    return im
ports = [portrait(b, n) for b, n in (((12, 12, 146, 186), 'rex'), ((786, 12, 922, 186), 'nova'), ((14, 250, 216, 406), 'gatling'), ((14, 428, 218, 584), 'voraxia'), ((14, 604, 224, 780), 'skyreaper'))]
P = Image.new('RGB', (96 * len(ports), 96))
for i, p in enumerate(ports): P.paste(p, (i * 96, 0))
P.save(os.path.join(OUT, 'portraits.jpg'), quality=88)
man['portraits'] = {'w': 96, 'h': 96, 'order': ['rex', 'nova', 'gatling', 'voraxia', 'skyreaper']}
json.dump(man, open(sys.argv[3] if len(sys.argv) > 3 else os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print(json.dumps({k: {kk: v[kk] for kk in ('w', 'h') if kk in v} for k, v in man.items()}))
