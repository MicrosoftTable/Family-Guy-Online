#!/usr/bin/env python3
"""Builds demo/manifest.json from the dump: which meshes to draw, which are collision, and the texture each uses."""
import json, os, re, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
mesh = sorted(f for f in os.listdir(f'{root}/Mesh') if f.endswith('.obj') and '#' not in f)
tex = {}
for f in sorted(os.listdir(f'{root}/Texture2D')):
    base = re.sub(r' #\d+', '', f[:-4])
    if base not in tex or ' #' not in f: tex[base] = f
ZONES = set(sys.argv[1:] or ['B2','C2','D3','E3','B3','C3','D2','D4','C4','B4','E2','E4'])
out = {'render': [], 'ground': [], 'wall': []}
for f in mesh:
    m = re.match(r'^([A-Z]\d)_(.+)_geo\.obj$', f)
    if not m or m[1] not in ZONES: continue
    zone, name = m.groups()
    path = f'Mesh/{f}'
    name = re.sub(r'^mayorStand_', 'mayorStand_', name)
    if 'collisionGround' in name: out['ground'].append(path); continue
    if name.startswith('collisionGround'): out['ground'].append(path); continue
    if 'collision' in name: out['wall'].append(path); continue
    if 'shadow' in name or name.startswith(('collection', 'collectables')): continue
    t = None
    if name.startswith('colourPalette'): t = 'colourPaletteSuburbs_col'
    else:
        name = name.replace('Suburbs','').replace('mayorStand_','')
        stem = re.sub(r'\d+$', '', name)
        alias = {'delorian': 'delorean', 'dirtBike': 'peterDirtBike'}.get(name, name)
        for c in (name + '_col', name + '_dtl', alias + '_col', stem + '_col', stem + '01_col', 'prp_' + name + '_col', name.replace('detail','detail') + '_dtl'):
            if c in tex: t = c; break
        else: t = 'colourPaletteSuburbs_col'
    out['render'].append({'mesh': path, 'tex': f'Texture2D/{tex[t]}' if t in tex else None, 'name': f'{zone}_{name}'})
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'manifest.json'), 'w'), indent=0)
r = out['render']; print(len(r), 'render', len(out['ground']), 'ground', len(out['wall']), 'wall;', sum(1 for x in r if not x['tex']), 'untextured')
print('untextured:', sorted({x['name'].split('_',1)[1] for x in r if not x['tex']}))
