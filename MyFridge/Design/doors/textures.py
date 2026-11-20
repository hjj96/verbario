"""Photographic door surfaces, generated once and bundled with the app.
Brushed metals: anisotropic streaks lit by a soft window. Enamel: glossy paint reflecting a room."""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

N = 1200
rng_master = np.random.default_rng(7)

def noise(shape, seed):
    return np.random.default_rng(seed).standard_normal(shape).astype(np.float32)

def norm(a):
    a = a - a.mean()
    return a / (a.std() + 1e-6)

def srgb_to_lin(c):
    c = np.asarray(c, np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def gauss1d(n, center, sigma):
    t = np.arange(n, dtype=np.float32) / n
    return np.exp(-0.5 * ((t - center) / sigma) ** 2)

def brushed(base_rgb, seed, highlight=1.0, contrast=1.0):
    h = w = N
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    # streaks of several lengths, almost no vertical blur
    s1 = norm(ndimage.gaussian_filter(noise((h, w), seed), (0.55, 90)))
    s2 = norm(ndimage.gaussian_filter(noise((h, w), seed + 1), (0.45, 22)))
    s3 = norm(ndimage.gaussian_filter(noise((h, w), seed + 2), (0.4, 6)))
    streak = 0.55 * s1 + 0.3 * s2 + 0.15 * s3
    # uneven finish over the whole sheet
    blotch = norm(ndimage.gaussian_filter(noise((h, w), seed + 3), 140))
    # soft window light: broad vertical bands (perpendicular to the brushing)
    band = (0.85 * gauss1d(w, 0.34, 0.11) + 0.35 * gauss1d(w, 0.74, 0.05))[None, :]
    vertical = 1.0 + 0.05 * (0.5 - yy)
    base = srgb_to_lin(base_rgb)[None, None, :]
    lum = vertical * (1 + 0.035 * blotch)[..., None] * (1 + highlight * 0.42 * band[..., None])
    lum = lum * (1 + contrast * (0.05 + 0.07 * band[..., None]) * streak[..., None])
    img = base * lum
    # cooler highlights, slightly warmer shadows
    img = img + highlight * 0.03 * band[..., None] * np.array([0.0, 0.01, 0.03], np.float32)
    grain = noise((h, w), seed + 4)[..., None] * 0.006
    return lin_to_srgb(img + grain)

def enamel(base_rgb, seed, gloss=1.0, dark=False):
    h = w = N
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    base = srgb_to_lin(base_rgb)[None, None, :]
    # gentle light falloff: brighter top-left, darker towards the floor
    shade = (1.04 - 0.16 * yy ** 1.4) * (1.02 - 0.05 * xx)
    img = base * shade[..., None]
    # the room reflected in glossy paint: bright ceiling/window area, soft horizon, darker floor
    horizon = 1 / (1 + np.exp((yy - 0.66) / 0.05))
    env = 0.06 * horizon * (1 - 0.6 * yy)
    # a large window seen at an angle: soft edges, two panes, fading towards the floor
    win = np.zeros((h, w), np.float32)
    rows = np.arange(h, dtype=np.float32) / h
    for row in range(h):
        t = rows[row]
        left = 0.06 + 0.035 * t
        right = 0.31 + 0.06 * t
        if t < 0.78:
            win[row, int(left * w):int(right * w)] = 1.0
    mull = (np.abs(np.arange(w, dtype=np.float32) / w - (0.19 + 0.045 * rows[:, None])) < 0.006)
    win[mull] *= 0.45
    win[int(0.34 * h):int(0.347 * h), :] *= 0.55
    win = ndimage.gaussian_filter(win, (26, 18))
    win *= np.clip(1.0 - (yy / 0.82) ** 2.2, 0, 1)
    # slight waviness of a real painted panel bends the reflection
    wave = ndimage.gaussian_filter(noise((h, w), seed + 5), 70)
    wave = norm(wave) * 5
    win = ndimage.map_coordinates(win, [np.arange(h)[:, None].repeat(w, 1), np.arange(w)[None, :].repeat(h, 0) + wave], order=1)
    refl = gloss * (env + (0.24 if not dark else 0.16) * win)
    img = img + (1 - img) * refl[..., None] if not dark else img + refl[..., None] * 0.55
    # a faint far wall / second light on the right
    side = gloss * 0.05 * gauss1d(w, 0.86, 0.05)[None, :] * (1 - yy)
    img = img + side[..., None]
    # orange peel and specks
    peel = ndimage.gaussian_filter(noise((h, w), seed + 6), 1.6)
    img = img * (1 + 0.012 * norm(peel)[..., None])
    grain = noise((h, w), seed + 7)[..., None] * 0.003
    return lin_to_srgb(img + grain)

FINISHES = {
    "steel":     lambda: brushed((198, 201, 204), 11),
    "graphite":  lambda: brushed((86, 90, 95), 12, highlight=1.25, contrast=1.3),
    "champagne": lambda: brushed((206, 194, 178), 13, highlight=0.9),
    "cream":     lambda: enamel((236, 224, 197), 21),
    "mint":      lambda: enamel((186, 225, 204), 22),
    "sky":       lambda: enamel((166, 203, 232), 23),
    "cherry":    lambda: enamel((206, 52, 46), 24),
    "lemon":     lambda: enamel((241, 212, 98), 25),
    "powder":    lambda: enamel((240, 196, 204), 26),
    "black":     lambda: enamel((34, 36, 40), 27, dark=True),
}

if __name__ == "__main__":
    out = sys.argv[1]
    names = sys.argv[2:] or list(FINISHES)
    os.makedirs(out, exist_ok=True)
    for name in names:
        arr = (FINISHES[name]() * 255 + 0.5).astype(np.uint8)
        Image.fromarray(arr).save(os.path.join(out, f"door-{name}.jpg"), quality=90, optimize=True, progressive=True)
        print(name, os.path.getsize(os.path.join(out, f"door-{name}.jpg")) // 1024, "KB")
