"""Photographic door surfaces, generated once and bundled with the app.

The doors are lit like a product photograph: a tall softbox on the left, a dim fill on the
right and light from above, with a faint kitchen (window, wall, counter) mixed into the
reflection so the surface never looks synthetically clean. Glossy enamel mirrors it through
a clear coat with slight panel waviness and orange peel; brushed steel smears it across a
vertical grain. Everything is computed in linear light and rolled off like film.

Each finish is saved as two layers so the reflection can slide when the phone tilts:
`door-<finish>.jpg` is the surface without the reflection, and `door-<finish>-gloss.jpg`
is the reflection to put over it with the screen blend mode. Together, unshifted, they
give exactly the full photograph.

    python textures.py <out-dir> [--preview] [finish ...]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

N = 1200
GRID_V, GRID_U = np.mgrid[0:N, 0:N].astype(np.float32) / N


def noise(seed):
    return np.random.default_rng(seed).standard_normal((N, N)).astype(np.float32)


def blurred_noise(seed, sigma):
    a = ndimage.gaussian_filter(noise(seed), sigma)
    a -= a.mean()
    return a / (a.std() + 1e-6)


def srgb_to_lin(c):
    c = np.asarray(c, np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def shoulder(x, knee=0.78):
    """Film-like roll-off above the knee; untouched below it."""
    over = np.maximum(x - knee, 0)
    return np.where(x > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), x)


# ---------------------------------------------------------------------------------------
# What the door reflects, already mirrored, in linear radiance.

def kitchen(seed=3):
    """A faint room: wall lit by a window on the left, a doorway on the right, a counter."""
    u, v = GRID_U, GRID_V
    wall = np.array([0.70, 0.66, 0.60], np.float32)
    rgb = wall * (0.82 + 0.30 * np.exp(-((u - 0.18) / 0.42) ** 2) - 0.10 * v)[..., None]
    top = 0.11 + 0.03 * (0.36 - u) / 0.31
    bottom = 0.63 - 0.035 * (0.36 - u) / 0.31
    inside = (u > 0.05) & (u < 0.36) & (v > top) & (v < bottom)
    t = np.clip((v - top) / (bottom - top), 0, 1)
    sky = np.stack([4.2 - 1.4 * t, 4.6 - 1.4 * t, 5.2 - 1.3 * t], -1)
    foliage = smoothstep(0.1, 0.9, blurred_noise(seed, 22) * 0.5 + 1.6 * (t - 0.55))[..., None]
    outside = sky * (1 - 0.8 * foliage) + np.array([0.5, 0.65, 0.4], np.float32) * foliage
    rgb = np.where(inside[..., None], outside, rgb)
    mid_u = 0.205 - 0.006 * (v - 0.37)
    mid_v = top + 0.47 * (bottom - top)
    bars = inside & ((np.abs(u - mid_u) < 0.0075) | (np.abs(v - mid_v) < 0.0065))
    frame = ((u > 0.04) & (u < 0.37) & (v > top - 0.012) & (v < bottom + 0.014)) & ~inside
    rgb = np.where((bars | frame)[..., None], np.array([1.25, 1.22, 1.18], np.float32), rgb)
    doorway = (u > 0.74) & (u < 0.88) & (v > 0.17) & (v < 0.74)
    rgb = np.where(doorway[..., None], np.array([0.30, 0.28, 0.26], np.float32), rgb)
    counter = smoothstep(0.705, 0.715, v)[..., None]
    wood = np.array([0.36, 0.25, 0.16], np.float32) * (1 + 0.15 * blurred_noise(seed + 1, (1.5, 40)))[..., None]
    rgb = rgb * (1 - counter) + wood * (0.9 - 0.5 * (v - 0.7))[..., None] * counter
    return rgb.astype(np.float32)


def softbox(c, hw, soft, top, bottom, tilt=0.0):
    u, v = GRID_U, GRID_V
    across = np.abs(u - (c + tilt * v)) / hw
    inside = smoothstep(1.0, 1.0 - soft / hw, across)
    profile = 0.8 + 0.2 * np.cos(np.clip(across, 0, 1) * np.pi / 2)
    along = smoothstep(top - 0.06, top + 0.06, v) * smoothstep(bottom + 0.08, bottom - 0.12, v)
    return inside * profile * along


def studio(room_mix=0.22):
    v = GRID_V
    rgb = np.repeat((0.22 - 0.12 * v)[..., None], 3, -1) * (1 - room_mix)
    rgb = rgb + kitchen() * room_mix * 0.35
    rgb += (2.6 * softbox(0.23, 0.105, 0.03, -0.05, 0.95, 0.02) * (0.55 + 0.45 * (1 - v)))[..., None]
    rgb += (0.6 * softbox(0.86, 0.09, 0.08, 0.02, 0.8))[..., None]
    rgb += (0.45 * smoothstep(0.14, 0.0, v))[..., None]
    return rgb.astype(np.float32)


_ENV = None


def environment():
    global _ENV
    if _ENV is None:
        _ENV = studio()
    return _ENV


def warp(img, du, dv):
    """Samples img at (u + du, v + dv) in pixels: the panel is not perfectly flat."""
    rows = np.arange(N, dtype=np.float32)[:, None] + dv
    cols = np.arange(N, dtype=np.float32)[None, :] + du
    return np.stack([ndimage.map_coordinates(img[..., c], [rows, cols], order=1, mode="nearest")
                     for c in range(img.shape[2])], -1)


def waviness(seed, amount):
    """Large soft dents of a pressed steel sheet, as a displacement in pixels."""
    return blurred_noise(seed, 120) * amount, blurred_noise(seed + 1, 120) * amount * 0.6


# ---------------------------------------------------------------------------------------

def enamel(base_rgb, seed, reflect=0.05):
    """Glossy paint under a clear coat."""
    u, v = GRID_U, GRID_V
    albedo = srgb_to_lin(base_rgb)[None, None, :]
    light = 0.95 + 0.10 * np.exp(-((u - 0.1) / 0.6) ** 2) + 0.05 * (1 - v) - 0.08 * v ** 2
    du, dv = waviness(seed, 5.0)
    du = du + blurred_noise(seed + 2, 2.2) * 0.8  # orange peel
    dv = dv + blurred_noise(seed + 3, 2.2) * 0.8
    mirrored = ndimage.gaussian_filter(warp(environment(), du, dv), (5, 5, 0))
    paint = albedo * light[..., None]
    texture = (1 + 0.006 * blurred_noise(seed + 4, 0.8))[..., None]
    grain = noise(seed + 5)[..., None] * 0.0025

    def finish(reflection):
        return lin_to_srgb(shoulder((paint + reflect * reflection) * texture) + grain)

    # the surface alone still shows the dim room, so the screen layer only adds light
    return finish(np.float32(0.06)), finish(mirrored)


def brushed(base_rgb, seed, gain=0.28, grain=1.0):
    """Brushed metal with a vertical grain: reflections smear sideways."""
    du, dv = waviness(seed, 6.0)
    mirrored = ndimage.gaussian_filter(warp(environment(), du, dv), (14, 110, 0))
    lum = mirrored.mean(-1)
    lum = (lum / lum.mean())[..., None]
    tint = srgb_to_lin(base_rgb)[None, None, :]
    scratches = (0.55 * blurred_noise(seed + 1, (110, 0.6)) + 0.3 * blurred_noise(seed + 2, (26, 0.45))
                 + 0.15 * blurred_noise(seed + 3, (6, 0.4)))[..., None]
    sheet = (1 + 0.02 * blurred_noise(seed + 4, 160))[..., None]
    speckle = noise(seed + 5)[..., None] * 0.004

    def finish(refl):
        img = tint * (1 + gain * (refl - 1))
        img = img * (1 + grain * (0.02 + 0.025 * np.clip(refl - 0.9, 0, 1)) * scratches) * sheet
        return lin_to_srgb(shoulder(img, 0.82) + speckle)

    # the surface alone is the metal in its darkest light; the screen layer adds the rest
    return finish(np.float32(np.percentile(lum, 2))), finish(lum)


FINISHES = {
    "steel":     lambda: brushed((196, 199, 202), 11),
    "graphite":  lambda: brushed((84, 88, 93), 12, gain=0.45, grain=1.3),
    "champagne": lambda: brushed((204, 193, 177), 13),
    "cream":     lambda: enamel((236, 224, 197), 21),
    "mint":      lambda: enamel((180, 222, 200), 22),
    "sky":       lambda: enamel((160, 199, 230), 23),
    "cherry":    lambda: enamel((200, 40, 38), 24),
    "lemon":     lambda: enamel((242, 210, 92), 25),
    "powder":    lambda: enamel((240, 192, 202), 26),
    "black":     lambda: enamel((26, 28, 32), 27, reflect=0.06),
}

GLOSS_SIZE = 600  # the reflection is soft, so half the resolution is enough


def screen_layer(base, full):
    """The layer that, screen-blended over `base`, gives `full` (both sRGB, 0...1)."""
    return np.clip(1 - (1 - full) / np.maximum(1 - base, 1e-3), 0, 1)


def save(arr, path, size=None):
    image = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size:
        image = image.resize((size, size), Image.LANCZOS)
    image.save(path, quality=90, optimize=True, progressive=True)
    return os.path.getsize(path) // 1024


if __name__ == "__main__":
    args = sys.argv[1:]
    preview = "--preview" in args
    args = [a for a in args if a != "--preview"]
    out, names = args[0], args[1:] or list(FINISHES)
    os.makedirs(out, exist_ok=True)
    for name in names:
        base, full = FINISHES[name]()
        kb = save(base, os.path.join(out, f"door-{name}.jpg"))
        kb_gloss = save(screen_layer(base, full), os.path.join(out, f"door-{name}-gloss.jpg"), GLOSS_SIZE)
        if preview:
            save(full, os.path.join(out, f"full-{name}.jpg"))
        print(f"{name}: surface {kb} KB, gloss {kb_gloss} KB")
