#!/usr/bin/env python3
# =====================================================================
# bake-hand.py — hand.glb  ->  hand-pose.bin
#
# hand.glb is a 10 MB skinned mesh whose weight is almost entirely three
# baked textures (jpeg base colour, png AO/roughness, png normal). sea.js
# renders the hand as procedural marble and uses none of them, and it wants
# a still monument rather than an animated rig — so the textures, the
# skeleton and the animation are all dead weight on a landing page.
#
# This bakes the bind pose down to raw posed geometry: ~48 KB instead of
# 10 MB, no GLTFLoader dependency (none is vendored in this project), and
# no skinning to plumb through the custom shader.
#
# Run from the project root:
#     python tools/bake-hand.py
#     python tools/bake-hand.py --subdiv 1     # if fingers read faceted
#
# ---------------------------------------------------------------------
# Model: "Hand animation test"
# Author: mason_roman's helloneighborfangamingmodelworks
#         https://sketchfab.com/hello15fan
# Source: https://sketchfab.com/3d-models/hand-animation-test-8980c1c3168e49e7871d78295de948d1
# Licence: CC-BY-4.0  —  http://creativecommons.org/licenses/by/4.0/
#          Attribution is required wherever this ships.
# =====================================================================

import argparse
import json
import math
import os
import struct
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'hand.glb')
DST = os.path.join(ROOT, 'hand-pose.bin')

# What the source model measured when this script was written. The bake is
# checked against these so a swapped or re-exported hand.glb fails loudly
# here rather than showing up as a mysteriously wrong statue in the sea.
EXPECT = {'verts': 1414, 'tris': 2248, 'height': 236.4672}

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

COMPONENT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
             5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ------------------------------------------------------------------ glb
def read_glb(path):
    with open(path, 'rb') as f:
        magic, version, _ = struct.unpack('<III', f.read(12))
        if magic != GLB_MAGIC:
            raise SystemExit('not a .glb: bad magic in %s' % path)
        if version != 2:
            raise SystemExit('expected glTF 2.0, got version %d' % version)

        js, binary = None, None
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            length, kind = struct.unpack('<II', head)
            data = f.read(length)
            if kind == CHUNK_JSON:
                js = json.loads(data.decode('utf-8'))
            elif kind == CHUNK_BIN:
                binary = data

    if js is None or binary is None:
        raise SystemExit('glb is missing its JSON or BIN chunk')
    return js, binary


def accessor(gltf, blob, index):
    """Read one accessor into a list of tuples. Honours byteStride, which
    Sketchfab exports use for the interleaved vertex attributes."""
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    fmt, size = COMPONENT[acc['componentType']]
    n = NCOMP[acc['type']]
    base = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride') or size * n
    unpack = struct.Struct('<' + fmt * n).unpack_from
    return [unpack(blob, base + i * stride) for i in range(acc['count'])]


# --------------------------------------------------------------- matrix
# glTF matrices are column-major 16-floats, and so is everything here.
IDENTITY = [1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0]


def mat_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = (a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                              a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3])
    return out


def node_matrix(node):
    if 'matrix' in node:
        return list(node['matrix'])
    tx, ty, tz = node.get('translation', (0.0, 0.0, 0.0))
    x, y, z, w = node.get('rotation', (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get('scale', (1.0, 1.0, 1.0))
    m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0.0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0.0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0.0,
         0.0, 0.0, 0.0, 1.0]
    for col, s in enumerate((sx, sy, sz)):
        for r in range(3):
            m[col * 4 + r] *= s
    m[12], m[13], m[14] = tx, ty, tz
    return m


def transform_point(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def transform_dir(m3, v):
    x, y, z = v
    return (m3[0] * x + m3[3] * y + m3[6] * z,
            m3[1] * x + m3[4] * y + m3[7] * z,
            m3[2] * x + m3[5] * y + m3[8] * z)


def normal_matrix(m):
    """Inverse-transpose of the upper 3x3, as a column-major 9-float.

    The skin matrices in this model are rigid plus a uniform scale of 10, so
    the rotation alone would do — but doing it properly costs twenty lines and
    keeps the script correct if the model is ever re-exported with non-uniform
    scale anywhere in the joint chain."""
    a = (m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10])
    c = (a[4] * a[8] - a[5] * a[7], a[5] * a[6] - a[3] * a[8], a[3] * a[7] - a[4] * a[6],
         a[2] * a[7] - a[1] * a[8], a[0] * a[8] - a[2] * a[6], a[1] * a[6] - a[0] * a[7],
         a[1] * a[5] - a[2] * a[4], a[2] * a[3] - a[0] * a[5], a[0] * a[4] - a[1] * a[3])
    det = a[0] * c[0] + a[1] * c[1] + a[2] * c[2]
    if abs(det) < 1e-12:
        return (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    inv = 1.0 / det
    # c is already the cofactor matrix laid out as adjugate-transpose, which
    # for our purposes is exactly inverse-transpose once scaled by 1/det.
    return tuple(v * inv for v in c)


def normalise(v):
    x, y, z = v
    n = math.sqrt(x * x + y * y + z * z)
    if n < 1e-12:
        return (0.0, 1.0, 0.0)
    return (x / n, y / n, z / n)


# ---------------------------------------------------------------- skin
def bake_pose(gltf, blob):
    """Apply the bind pose to the single skinned primitive, returning
    (positions, normals, indices) in world space."""
    mesh_nodes = [i for i, n in enumerate(gltf['nodes']) if 'mesh' in n]
    if len(mesh_nodes) != 1:
        raise SystemExit('expected exactly one mesh node, found %d' % len(mesh_nodes))

    world = {}

    def walk(index, parent):
        node = gltf['nodes'][index]
        m = mat_mul(parent, node_matrix(node))
        world[index] = m
        for child in node.get('children', ()):
            walk(child, m)

    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(root, IDENTITY)

    node = gltf['nodes'][mesh_nodes[0]]
    prim = gltf['meshes'][node['mesh']]['primitives'][0]
    if prim.get('mode', 4) != 4:
        raise SystemExit('primitive is not TRIANGLES')

    attrs = prim['attributes']
    pos = accessor(gltf, blob, attrs['POSITION'])
    nrm = accessor(gltf, blob, attrs['NORMAL'])
    idx = [i[0] for i in accessor(gltf, blob, prim['indices'])]

    if 'skin' in node:
        skin = gltf['skins'][node['skin']]
        joints = skin['joints']
        ibm = accessor(gltf, blob, skin['inverseBindMatrices'])
        jnt = accessor(gltf, blob, attrs['JOINTS_0'])
        wgt = accessor(gltf, blob, attrs['WEIGHTS_0'])

        skin_m = [mat_mul(world[joints[k]], list(ibm[k])) for k in range(len(joints))]
        skin_n = [normal_matrix(m) for m in skin_m]

        out_p, out_n = [], []
        for v in range(len(pos)):
            px = py = pz = nx = ny = nz = 0.0
            for k in range(4):
                w = wgt[v][k]
                if w <= 0.0:
                    continue
                j = jnt[v][k]
                a, b, c = transform_point(skin_m[j], pos[v])
                px += w * a; py += w * b; pz += w * c
                a, b, c = transform_dir(skin_n[j], nrm[v])
                nx += w * a; ny += w * b; nz += w * c
            out_p.append((px, py, pz))
            out_n.append(normalise((nx, ny, nz)))
        return out_p, out_n, idx

    # Unskinned fallback: just the node's own world transform.
    m = world[mesh_nodes[0]]
    m3 = normal_matrix(m)
    return ([transform_point(m, p) for p in pos],
            [normalise(transform_dir(m3, n)) for n in nrm],
            idx)


# --------------------------------------------------------- subdivision
def weld(pos, nrm, idx, eps=1e-5):
    """Merge vertices that share a position. Sketchfab's FBX pipeline splits
    vertices at UV and smoothing seams, and Loop subdivision on a split mesh
    tears it open along every one of them."""
    key_of, remap, wp, wn = {}, [], [], []
    q = 1.0 / eps
    for i, p in enumerate(pos):
        key = (round(p[0] * q), round(p[1] * q), round(p[2] * q))
        j = key_of.get(key)
        if j is None:
            j = len(wp)
            key_of[key] = j
            wp.append(p)
            wn.append(list(nrm[i]))
        else:
            wn[j][0] += nrm[i][0]; wn[j][1] += nrm[i][1]; wn[j][2] += nrm[i][2]
        remap.append(j)
    wi = [remap[i] for i in idx]
    # drop triangles that welding collapsed to a degenerate
    tris = [wi[i:i + 3] for i in range(0, len(wi), 3)]
    tris = [t for t in tris if t[0] != t[1] and t[1] != t[2] and t[2] != t[0]]
    return wp, [normalise(n) for n in wn], [i for t in tris for i in t]


def loop_subdivide(pos, idx):
    """One level of Loop subdivision, with the boundary rule applied along the
    open wrist. Returns new positions and indices; normals are recomputed by
    the caller from the refined surface."""
    tris = [idx[i:i + 3] for i in range(0, len(idx), 3)]

    # edge -> [triangle-opposite vertices]
    opposite = defaultdict(list)
    for a, b, c in tris:
        opposite[(min(a, b), max(a, b))].append(c)
        opposite[(min(b, c), max(b, c))].append(a)
        opposite[(min(c, a), max(c, a))].append(b)

    neighbours = defaultdict(set)
    boundary_neighbours = defaultdict(set)
    for (u, v), opp in opposite.items():
        neighbours[u].add(v)
        neighbours[v].add(u)
        if len(opp) == 1:                      # an open edge
            boundary_neighbours[u].add(v)
            boundary_neighbours[v].add(u)

    def add(p, q, s):
        return (p[0] + q[0] * s, p[1] + q[1] * s, p[2] + q[2] * s)

    # --- edge points ---
    edge_point = {}
    new_pos = list(pos)
    for (u, v), opp in opposite.items():
        pu, pv = pos[u], pos[v]
        if len(opp) == 2:
            po, pq = pos[opp[0]], pos[opp[1]]
            p = tuple((pu[k] + pv[k]) * 0.375 + (po[k] + pq[k]) * 0.125 for k in range(3))
        else:                                   # boundary: plain midpoint
            p = tuple((pu[k] + pv[k]) * 0.5 for k in range(3))
        edge_point[(u, v)] = len(new_pos)
        new_pos.append(p)

    # --- moved original vertices ---
    moved = []
    for i, p in enumerate(pos):
        bn = boundary_neighbours.get(i)
        if bn:
            # boundary vertex: 3/4 self + 1/8 each along the boundary curve
            acc = (0.0, 0.0, 0.0)
            for j in bn:
                acc = add(acc, pos[j], 1.0)
            k = len(bn)
            moved.append(tuple(p[c] * 0.75 + acc[c] * (0.25 / k) for c in range(3)))
            continue
        nb = neighbours[i]
        n = len(nb)
        if n == 0:
            moved.append(p)
            continue
        t = 0.375 + 0.25 * math.cos(2.0 * math.pi / n)
        beta = (0.625 - t * t) / n
        acc = (0.0, 0.0, 0.0)
        for j in nb:
            acc = add(acc, pos[j], 1.0)
        moved.append(tuple(p[c] * (1.0 - n * beta) + acc[c] * beta for c in range(3)))
    new_pos[:len(pos)] = moved

    # --- four triangles per face ---
    new_idx = []
    for a, b, c in tris:
        ab = edge_point[(min(a, b), max(a, b))]
        bc = edge_point[(min(b, c), max(b, c))]
        ca = edge_point[(min(c, a), max(c, a))]
        new_idx += [a, ab, ca, ab, b, bc, bc, c, ca, ab, bc, ca]
    return new_pos, new_idx


def smooth_normals(pos, idx):
    """Area-weighted face normals averaged onto vertices — the cross product is
    left unnormalised so larger triangles carry proportionally more weight."""
    acc = [[0.0, 0.0, 0.0] for _ in pos]
    for i in range(0, len(idx), 3):
        a, b, c = idx[i], idx[i + 1], idx[i + 2]
        pa, pb, pc = pos[a], pos[b], pos[c]
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        vx, vy, vz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        for v in (a, b, c):
            acc[v][0] += nx; acc[v][1] += ny; acc[v][2] += nz
    return [normalise(n) for n in acc]


# ------------------------------------------------------------- output
# ------------------------------------------------------- AO and thickness
# The two things a marble shader cannot invent at runtime.
#
# Ambient occlusion is what grounds the fingers: without it the gaps between
# them take as much skylight as the knuckles do and the hand reads as a flat
# cutout. Thickness is what makes it read as STONE rather than plaster — marble
# is translucent for a millimetre or two, so light enters the back of a
# fingertip and leaves the front, and the shader needs to know where the
# sections are thin.
#
# Both fall out of the same ray cast, so they are computed together: rays out
# along the normal measure openness, rays in along it measure how far it is to
# the far wall.

def _ray_batch(origin, dirs, V0, E1, E2, eps=1e-6):
    """Moller-Trumbore, one origin against every triangle for every direction.
    Returns the nearest positive hit distance per direction (inf for a miss)."""
    import numpy as np
    P = np.cross(dirs[:, None, :], E2[None, :, :])          # (R, T, 3)
    det = np.einsum('td,rtd->rt', E1, P)
    ok = np.abs(det) > eps
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    T = origin[None, :] - V0                                 # (T, 3)
    u = np.einsum('td,rtd->rt', T, P) * inv
    Q = np.cross(T[None, :, :].repeat(dirs.shape[0], 0), E1[None, :, :])
    v = np.einsum('rd,rtd->rt', dirs, Q) * inv
    t = np.einsum('td,rtd->rt', E2, Q) * inv
    hit = ok & (u >= 0.0) & (v >= 0.0) & (u + v <= 1.0) & (t > 1e-4)
    t = np.where(hit, t, np.inf)
    return t.min(axis=1)


def bake_occlusion(pos, nrm, idx, samples=48, ao_dist=0.22):
    """Per-vertex (ao, thickness), both in 0..1. Geometry must already be
    canonicalised, so distances are fractions of the model's height."""
    import numpy as np
    P = np.asarray(pos, dtype=np.float64)
    N = np.asarray(nrm, dtype=np.float64)
    F = np.asarray(idx, dtype=np.int64).reshape(-1, 3)
    V0 = P[F[:, 0]]
    E1 = P[F[:, 1]] - V0
    E2 = P[F[:, 2]] - V0

    # Fibonacci hemisphere: even coverage without the clumping a random set
    # gives at this few samples, which shows up as blotching on flat areas.
    i = np.arange(samples) + 0.5
    phi = np.arccos(1.0 - i / samples)          # 0..pi/2, cosine-ish weighted
    gold = np.pi * (1.0 + 5.0 ** 0.5)
    theta = gold * i
    local = np.stack([np.cos(theta) * np.sin(phi),
                      np.sin(theta) * np.sin(phi),
                      np.cos(phi)], axis=1)

    ao = np.zeros(len(P))
    thick = np.zeros(len(P))
    span = max(1e-6, P[:, 1].max() - P[:, 1].min())

    for vi in range(len(P)):
        n = N[vi]
        # an orthonormal basis around the normal
        a = np.array([0.0, 0.0, 1.0]) if abs(n[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t1 = np.cross(a, n); t1 /= max(np.linalg.norm(t1), 1e-9)
        t2 = np.cross(n, t1)
        world = local[:, 0:1] * t1 + local[:, 1:2] * t2 + local[:, 2:3] * n

        out = _ray_batch(P[vi] + n * 1e-4, world, V0, E1, E2)
        ao[vi] = np.mean(np.minimum(out, ao_dist) / ao_dist)

        inn = _ray_batch(P[vi] - n * 1e-4, -world, V0, E1, E2)
        d = inn[np.isfinite(inn)]
        thick[vi] = np.median(d) / span if len(d) else 1.0

        if vi % 400 == 0:
            print('    occlusion %d/%d' % (vi, len(P)), flush=True)

    # A little contrast on AO, and thickness clamped to the range the shader
    # actually resolves — beyond about a fifth of the model's height nothing
    # is getting through the stone anyway.
    ao = np.clip(ao, 0.0, 1.0) ** 1.35
    thick = np.clip(thick / 0.20, 0.0, 1.0)
    return ao.tolist(), thick.tolist()


def bounds(pos):
    xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def canonicalise(pos):
    """Put the model in the frame hand.js expects: bbox centred on the y axis
    in x and z, base sitting on y = 0, and exactly 1.0 unit tall. Every real
    dimension then comes from HAND.height in hand.js, so the framing is tuned
    in one place next to the rest of the scene's constants."""
    (x0, x1), (y0, y1), (z0, z1) = bounds(pos)
    height = y1 - y0
    if height < 1e-6:
        raise SystemExit('model has no height — nothing to normalise against')
    cx, cz, s = (x0 + x1) * 0.5, (z0 + z1) * 0.5, 1.0 / height
    return [((p[0] - cx) * s, (p[1] - y0) * s, (p[2] - cz) * s) for p in pos], height


def write_bin(path, pos, nrm, idx, ao=None, thick=None):
    """HND2 layout, all little-endian:

        magic     "HND2"        4
        vertCount u32           4
        idxCount  u32           4
        flags     u32           4     bit 0: ao + thickness present
        positions f32 * 3n
        normals   f32 * 3n
        [ao       f32 * n  ]          only when flags bit 0 is set
        [thick    f32 * n  ]
        indices   u16 * m

    Every array stays 4-byte aligned, so the loader takes typed-array views
    straight onto the response with no copy."""
    n = len(pos)
    if n >= 65536:
        raise SystemExit('%d vertices exceeds the Uint16 index range' % n)
    has = 1 if (ao is not None and thick is not None) else 0
    out = bytearray()
    out += b'HND2'
    out += struct.pack('<III', n, len(idx), has)
    out += struct.pack('<%df' % (n * 3), *[c for p in pos for c in p])
    out += struct.pack('<%df' % (n * 3), *[c for v in nrm for c in v])
    if has:
        out += struct.pack('<%df' % n, *ao)
        out += struct.pack('<%df' % n, *thick)
    out += struct.pack('<%dH' % len(idx), *idx)
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


def main():
    ap = argparse.ArgumentParser(description='Bake hand.glb to hand-pose.bin')
    ap.add_argument('--subdiv', type=int, default=0, metavar='N',
                    help='levels of Loop subdivision (default 0; try 1 if the '
                         'finger silhouettes read faceted at your framing)')
    ap.add_argument('--rays', type=int, default=48, metavar='N',
                    help='hemisphere rays per vertex for AO and thickness '
                         '(default 48)')
    ap.add_argument('--no-occlusion', action='store_true',
                    help='skip the AO/thickness bake (much faster; the shader '
                         'falls back to flat values)')
    ap.add_argument('--src', default=SRC)
    ap.add_argument('--out', default=DST)
    args = ap.parse_args()

    if not os.path.exists(args.src):
        raise SystemExit('no such file: %s' % args.src)

    gltf, blob = read_glb(args.src)
    pos, nrm, idx = bake_pose(gltf, blob)

    (x0, x1), (y0, y1), (z0, z1) = bounds(pos)
    print('source   : %s' % os.path.relpath(args.src, ROOT))
    print('  verts  : %d' % len(pos))
    print('  tris   : %d' % (len(idx) // 3))
    print('  bounds : x %.4f .. %.4f   y %.4f .. %.4f   z %.4f .. %.4f'
          % (x0, x1, y0, y1, z0, z1))
    print('  height : %.4f' % (y1 - y0))

    if len(pos) != EXPECT['verts'] or len(idx) // 3 != EXPECT['tris']:
        print('  note   : geometry differs from the recorded source '
              '(%d verts / %d tris expected)' % (EXPECT['verts'], EXPECT['tris']),
              file=sys.stderr)
    if abs((y1 - y0) - EXPECT['height']) > 0.01:
        print('  note   : height differs from the recorded %.4f — check HAND.height '
              'in hand.js still frames it the way you want'
              % EXPECT['height'], file=sys.stderr)

    if args.subdiv > 0:
        pos, nrm, idx = weld(pos, nrm, idx)
        print('welded   : %d verts / %d tris' % (len(pos), len(idx) // 3))
        for level in range(args.subdiv):
            pos, idx = loop_subdivide(pos, idx)
            print('subdiv %d : %d verts / %d tris' % (level + 1, len(pos), len(idx) // 3))
        nrm = smooth_normals(pos, idx)

    pos, height = canonicalise(pos)

    ao = thick = None
    if not args.no_occlusion:
        print('occlusion: %d rays/vertex over %d triangles ...'
              % (args.rays, len(idx) // 3))
        ao, thick = bake_occlusion(pos, nrm, idx, samples=args.rays)
        print('  ao     : min %.3f  mean %.3f  max %.3f'
              % (min(ao), sum(ao) / len(ao), max(ao)))
        print('  thick  : min %.3f  mean %.3f  max %.3f'
              % (min(thick), sum(thick) / len(thick), max(thick)))

    size = write_bin(args.out, pos, nrm, idx, ao, thick)

    (x0, x1), (y0, y1), (z0, z1) = bounds(pos)
    print('output   : %s' % os.path.relpath(args.out, ROOT))
    print('  verts  : %d   tris: %d' % (len(pos), len(idx) // 3))
    print('  bounds : x %.4f .. %.4f   y %.4f .. %.4f   z %.4f .. %.4f'
          % (x0, x1, y0, y1, z0, z1))
    print('  scale  : 1 model unit = %.4f source units' % height)
    print('  size   : %s (%.1f KB)  from %.1f MB'
          % (f'{size:,}', size / 1024.0, os.path.getsize(args.src) / 1048576.0))


if __name__ == '__main__':
    main()
