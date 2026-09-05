#!/usr/bin/env python3
# =====================================================================
# bake-ocean.py — big_churning_ocean_waves__free.glb -> ocean-cache.bin
#
# The source is an 86 MB Alembic simulation cache that Sketchfab shipped as
# 249 morph targets on a 21,025-vertex plane: one target per frame of a
# 10.4-second loop at 24 fps. Nothing in a browser wants to hold that.
#
# Two properties make it cheap to bake down:
#   * TEXCOORD_0 is a perfect 145x145 regular grid, so the sim is already a
#     heightfield on a lattice — no rasterising needed, just an index.
#   * the animation is a plain frame sequencer: key k drives morph target
#     k-1 at weight 1.0, so frame lookup is an array index.
#
# Output is a 3D displacement volume (x, z, time) that sea.js uploads as a
# Data3DTexture and samples in the projected grid's vertex stage. Trilinear
# filtering gives interpolation between frames for free.
#
# The patch is only 152 units across while the scene's dominant swell is a
# 465-unit wavelength, so this is NOT a replacement for the analytic wave
# field — it is the short-scale churn layered on top of it. The field is
# made periodic here so it can tile without a seam.
#
# Run from the project root:
#     python tools/bake-ocean.py
#     python tools/bake-ocean.py --grid 96 --frames 96     # smaller
#
# ---------------------------------------------------------------------
# Model: "Big Churning Ocean Waves  Free"
# Author: the9thearl — https://sketchfab.com/the9thearl
# Licence: check the Sketchfab listing; attribution is required for CC-BY.
# =====================================================================

import argparse
import json
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'big_churning_ocean_waves__free.glb')
DST = os.path.join(ROOT, 'ocean-cache.bin')

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def read_glb(path):
    with open(path, 'rb') as f:
        magic, version, _ = struct.unpack('<III', f.read(12))
        if magic != GLB_MAGIC:
            raise SystemExit('not a .glb: %s' % path)
        js = binary = None
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
        raise SystemExit('glb missing JSON or BIN chunk')
    return js, binary


def accessor(gltf, blob, index):
    """Float accessors only, which is all this model uses for geometry."""
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    if acc['componentType'] != 5126:
        raise SystemExit('expected float accessor, got %d' % acc['componentType'])
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[acc['type']]
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride') or 4 * n
    if stride != 4 * n:
        raise SystemExit('interleaved accessor not supported here')
    return np.frombuffer(blob, dtype=np.float32,
                         count=acc['count'] * n, offset=off).reshape(acc['count'], n)


def make_periodic(field):
    """Blend the field with a half-period roll of itself, weighted by a smooth
    window that falls to zero at the borders.

    The patch is a finite crop of a simulation, so tiling it raw puts a hard
    discontinuity on every tile boundary. Near the border the window is zero
    and the output is the ROLLED copy, which is interior data and therefore
    continuous across the wrap; in the middle the window is one and the output
    is the original. Standard offset-and-blend, done per frame."""
    f, h, w = field.shape
    wx = 0.5 - 0.5 * np.cos(2.0 * np.pi * (np.arange(w) + 0.5) / w)
    wy = 0.5 - 0.5 * np.cos(2.0 * np.pi * (np.arange(h) + 0.5) / h)
    win = (wy[:, None] * wx[None, :]).astype(np.float32)
    rolled = np.roll(np.roll(field, w // 2, axis=2), h // 2, axis=1)
    return field * win[None] + rolled * (1.0 - win[None])


def resample(field, grid):
    """Bilinear resample each frame from its native lattice to grid x grid,
    sampling periodically so the seamlessness survives."""
    f, h, w = field.shape
    if (h, w) == (grid, grid):
        return field
    ys = np.arange(grid) * (h / grid)
    xs = np.arange(grid) * (w / grid)
    y0 = np.floor(ys).astype(int) % h
    x0 = np.floor(xs).astype(int) % w
    y1 = (y0 + 1) % h
    x1 = (x0 + 1) % w
    fy = (ys - np.floor(ys)).astype(np.float32)[:, None]
    fx = (xs - np.floor(xs)).astype(np.float32)[None, :]
    a = field[:, y0][:, :, x0]
    b = field[:, y0][:, :, x1]
    c = field[:, y1][:, :, x0]
    d = field[:, y1][:, :, x1]
    top = a * (1 - fx) + b * fx
    bot = c * (1 - fx) + d * fx
    return top * (1 - fy) + bot * fy


def main():
    ap = argparse.ArgumentParser(description='Bake the ocean sim to a displacement volume')
    ap.add_argument('--grid', type=int, default=128, help='output lattice (default 128)')
    ap.add_argument('--frames', type=int, default=144, help='output frames (default 144)')
    ap.add_argument('--src', default=SRC)
    ap.add_argument('--out', default=DST)
    args = ap.parse_args()

    if not os.path.exists(args.src):
        raise SystemExit('no such file: %s' % args.src)

    gltf, blob = read_glb(args.src)
    prim = gltf['meshes'][0]['primitives'][0]
    pos = accessor(gltf, blob, prim['attributes']['POSITION'])
    uv = accessor(gltf, blob, prim['attributes']['TEXCOORD_0'])
    targets = prim.get('targets', [])
    if not targets:
        raise SystemExit('no morph targets — wrong file?')

    # --- the lattice, recovered from the UVs ---
    us = np.unique(np.round(uv[:, 0], 4))
    vs = np.unique(np.round(uv[:, 1], 4))
    nx, ny = len(us), len(vs)
    if nx * ny != len(pos):
        raise SystemExit('UVs are not a regular grid (%d x %d != %d)' % (nx, ny, len(pos)))
    ix = np.searchsorted(us, np.round(uv[:, 0], 4))
    iy = np.searchsorted(vs, np.round(uv[:, 1], 4))

    size_x = float(pos[:, 0].max() - pos[:, 0].min())
    size_z = float(pos[:, 2].max() - pos[:, 2].min())
    print('source   : %s  (%.1f MB)' % (os.path.relpath(args.src, ROOT),
                                        os.path.getsize(args.src) / 1048576))
    print('  lattice: %d x %d = %d verts, %d morph targets' % (nx, ny, len(pos), len(targets)))
    print('  patch  : %.2f x %.2f world units' % (size_x, size_z))

    # --- pick the output frames out of the sequence ---
    src_idx = np.floor(np.linspace(0, len(targets), args.frames, endpoint=False)).astype(int)
    src_idx = np.clip(src_idx, 0, len(targets) - 1)

    field = np.zeros((args.frames, ny, nx), dtype=np.float32)
    base_y = pos[:, 1]
    for f, t in enumerate(src_idx):
        dy = accessor(gltf, blob, targets[t]['POSITION'])[:, 1]
        field[f, iy, ix] = base_y + dy
        if f % 24 == 0:
            print('    frame %d/%d (target %d)' % (f, args.frames, t), flush=True)

    field -= field.mean()
    raw_amp = float(np.abs(field).max())
    print('  height : +/- %.3f units before tiling' % raw_amp)

    field = make_periodic(field)
    field = resample(field, args.grid)

    amp = float(np.abs(field).max())
    if amp < 1e-6:
        raise SystemExit('field is flat — nothing to bake')
    print('  height : +/- %.3f units after tiling and resample' % amp)

    q = np.clip(np.round(field / amp * 32767.0), -32767, 32767).astype('<i2')

    # OCN1: magic, grid u32, frames u32, flags u32, tile f32, amp f32, then
    # grid*grid*frames int16 samples in x-fastest, then z, then time order.
    out = bytearray()
    out += b'OCN1'
    out += struct.pack('<III', args.grid, args.frames, 0)
    out += struct.pack('<ff', (size_x + size_z) * 0.5, amp)
    out += q.tobytes()
    with open(args.out, 'wb') as fh:
        fh.write(out)

    print('output   : %s' % os.path.relpath(args.out, ROOT))
    print('  volume : %d x %d x %d frames' % (args.grid, args.grid, args.frames))
    print('  tile   : %.2f world units' % ((size_x + size_z) * 0.5))
    print('  size   : %s (%.1f MB)  from %.1f MB'
          % (f'{len(out):,}', len(out) / 1048576, os.path.getsize(args.src) / 1048576))


if __name__ == '__main__':
    main()
