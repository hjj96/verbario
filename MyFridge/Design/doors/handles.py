"""Chrome door hardware for the retro fridges, rendered like a photograph.

Each piece is described as a few raised parts (plates, bars, buttons) on the door. Their
height field gives a surface normal per pixel, and the chrome simply mirrors a studio:
a bright sky above a dark horizon, a warm floor below, a softbox on the left and the
photographer's room straight ahead. The shadow on the door is baked into the image, so it
works on any finish.

    python handles.py <out-dir> [--preview]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SS = 3  # supersampling


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------
# Signed distances (negative inside), in unit coordinates of the canvas.

def sd_capsule(x, y, ax, ay, bx, by, r):
    px, py = x - ax, y - ay
    dx, dy = bx - ax, by - ay
    h = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - dx * h, py - dy * h) - r


def sd_ellipse(x, y, cx, cy, rx, ry):
    # good enough for the gentle ellipses used here
    k = np.hypot((x - cx) / rx, (y - cy) / ry)
    return (k - 1) * min(rx, ry)


def sd_round_rect(x, y, cx, cy, hw, hh, r):
    qx = np.abs(x - cx) - (hw - r)
    qy = np.abs(y - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def tube(sd, radius):
    """Round cross-section: a bar or a dome."""
    d = np.clip(-sd, 0, radius)
    return np.sqrt(np.maximum(radius ** 2 - (radius - d) ** 2, 0))


def plate(sd, edge, thickness):
    """Flat top with a rounded edge."""
    d = np.clip(-sd, 0, edge)
    return thickness * np.sqrt(np.maximum(1 - (1 - d / edge) ** 2, 0))


# ---------------------------------------------------------------------------------------
# The studio that chrome reflects. r: x right, y down, z towards the viewer.

def studio(r):
    rx, ry, rz = r[..., 0], r[..., 1], r[..., 2]
    up = -ry
    # a mirror needs contrast: bright sky, a sharp dark horizon, a dark warm floor
    sky = 0.9 + 0.5 * smoothstep(0.05, 0.7, up)
    ground = 0.07 + 0.08 * smoothstep(-0.15, -0.8, up)
    env = ground + (sky - ground) * smoothstep(-0.015, 0.015, up)
    # straight ahead: the dim room behind the camera, a little lighter towards the ceiling
    front = smoothstep(0.86, 0.985, rz)
    room = 0.16 + 0.22 * smoothstep(-0.05, 0.25, up)
    env = env * (1 - front) + room * front
    # a tall softbox on the left, a narrow fill on the right
    env = env + 2.2 * smoothstep(-0.3, -0.5, rx) * smoothstep(0.6, 0.3, np.abs(up))
    env = env + 0.6 * smoothstep(0.55, 0.7, rx) * smoothstep(0.5, 0.2, np.abs(up))
    rgb = np.stack([env * 0.97, env * 0.985, env * 1.02], -1)
    rgb[..., 2] += 0.06 * smoothstep(0.1, 0.6, up)
    rgb[..., 0] += 0.03 * smoothstep(-0.1, -0.6, up)
    return rgb


def shoulder(x, knee=0.8):
    over = np.maximum(x - knee, 0)
    return np.where(x > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), x)


MARGIN = (0.05, 0.04, 0.26, 0.32)  # left, top, right, bottom: room for the whole shadow


def enamel_field(x, y, sd, rgb_base):
    """Glossy red enamel inside a badge: a gentle gradient and a soft highlight on top."""
    t = np.clip((y - y[sd < 0].min()) / max(np.ptp(y[sd < 0]), 1e-6), 0, 1) if (sd < 0).any() else 0
    base = np.array(rgb_base, np.float32)[None, None, :] * (1.08 - 0.25 * np.asarray(t))[..., None]
    gloss = smoothstep(0.55, 0.0, np.asarray(t))[..., None] * 0.11
    return base + gloss


def render(parts, piece_size, height_px, dark_slots=None, paint=None, margin=MARGIN):
    """parts: list of (signed distance, height) functions in piece units (piece height = 1).
    Returns the image and the piece's frame inside it, as fractions of the image."""
    ml, mt, mr, mb = margin
    unit_w = piece_size[0] + ml + mr
    unit_h = piece_size[1] + mt + mb
    size = (int(round(height_px * unit_w)), int(round(height_px * unit_h)))
    unit = unit_h
    w, h = size[0] * SS, size[1] * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x = (xx + 0.5) / h * unit - ml
    y = (yy + 0.5) / h * unit - mt
    height = np.zeros((h, w), np.float32)
    cover = np.zeros((h, w), np.float32)
    for sd_fn, height_fn in parts:
        sd = sd_fn(x, y)
        hgt = height_fn(sd)
        inside = sd < 0
        height = np.where(inside, np.maximum(height, hgt), height)
        cover = np.maximum(cover, np.clip(0.5 - sd * h / unit, 0, 1))
    px_per_unit = h / unit
    hz = ndimage.gaussian_filter(height * px_per_unit, 0.8)
    gy, gx = np.gradient(hz)
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # a camera at a finite distance: flat faces get a gentle gradient, like in a photo
    eye = np.stack([(x.mean() - x) * 0.4, (y.mean() - y) * 0.4, np.ones_like(x)], -1)
    eye /= np.linalg.norm(eye, axis=-1, keepdims=True)
    r = 2 * (n * eye).sum(-1, keepdims=True) * n - eye
    rgb = studio(r)
    # ambient occlusion in the creases where parts meet
    occl = ndimage.gaussian_filter(hz, 6) - hz
    rgb *= np.clip(1 - np.maximum(occl, 0) * 0.04, 0.55, 1)[..., None]
    if dark_slots is not None:
        slot = dark_slots(x, y) < 0
        rgb = np.where(slot[..., None], np.array([0.05, 0.05, 0.06], np.float32), rgb)
    if paint is not None:
        sd_fn, colour = paint
        sd = sd_fn(x, y)
        field = enamel_field(x, y, sd, colour)
        edge = np.clip(0.5 - sd * h / unit, 0, 1)[..., None]
        rgb = rgb * (1 - edge) + field * edge
    rgb = shoulder(rgb)
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    # shadow on the door: light from the upper left, so it falls down and to the right
    top = max(height.max(), 1e-6)
    shift = (int(0.9 * top * px_per_unit), int(0.45 * top * px_per_unit))
    sil = np.roll(np.roll(cover, shift[0], 0), shift[1], 1)
    soft = ndimage.gaussian_filter(sil, 0.38 * top * px_per_unit) * 0.45
    contact = ndimage.gaussian_filter(cover, 0.08 * top * px_per_unit) * 0.35
    shadow_a = np.clip(np.maximum(soft, contact), 0, 0.6)
    alpha = cover + shadow_a * (1 - cover)
    color = np.where(alpha[..., None] > 0, rgb * cover[..., None] / np.maximum(alpha, 1e-6)[..., None], 0)
    out = np.concatenate([color, alpha[..., None]], -1)
    img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    frame = (ml / unit_w, mt / unit_h, piece_size[0] / unit_w, piece_size[1] / unit_h)
    return img.resize(size, Image.LANCZOS), frame


# ---------------------------------------------------------------------------------------
# The pieces. Canvas: unit = 1 is the image height; x runs 0...width/height.

def fifties():
    """A long bar on two posts, with a round push button in a plate at the top."""
    W = 0.32
    cx = W / 2
    return [
        (lambda x, y: sd_round_rect(x, y, cx, 0.17, 0.1, 0.135, 0.065), lambda sd: plate(sd, 0.022, 0.024)),
        (lambda x, y: sd_ellipse(x, y, cx, 0.13, 0.058, 0.058), lambda sd: 0.024 + tube(sd, 0.034) * 0.8),
        (lambda x, y: sd_ellipse(x, y, cx, 0.13, 0.03, 0.03), lambda sd: 0.05 + tube(sd, 0.022) * 0.6),
        (lambda x, y: sd_capsule(x, y, cx, 0.28, cx, 0.9, 0.05), lambda sd: 0.032 + tube(sd, 0.05)),
        (lambda x, y: sd_ellipse(x, y, cx, 0.9, 0.078, 0.064), lambda sd: plate(sd, 0.02, 0.03)),
    ], (W, 1.0)


def riviera():
    """A chunky grip standing off the door on two oval feet."""
    W = 0.4
    cx = W / 2
    return [
        (lambda x, y: sd_ellipse(x, y, cx, 0.11, 0.12, 0.092), lambda sd: plate(sd, 0.035, 0.04)),
        (lambda x, y: sd_ellipse(x, y, cx, 0.89, 0.12, 0.092), lambda sd: plate(sd, 0.035, 0.04)),
        (lambda x, y: sd_capsule(x, y, cx, 0.13, cx, 0.87, 0.085), lambda sd: 0.045 + tube(sd, 0.085)),
    ], (W, 1.0)


def thaw():
    """A lever on a plate with a lock cylinder and a key slot."""
    W = 0.36
    cx = W / 2
    parts = [
        (lambda x, y: sd_round_rect(x, y, cx, 0.17, 0.13, 0.155, 0.05), lambda sd: plate(sd, 0.026, 0.028)),
        (lambda x, y: sd_ellipse(x, y, cx, 0.11, 0.06, 0.06), lambda sd: 0.028 + plate(sd, 0.02, 0.022)),
        (lambda x, y: sd_capsule(x, y, cx, 0.24, cx, 0.86, 0.054), lambda sd: 0.032 + tube(sd, 0.054)),
        (lambda x, y: sd_ellipse(x, y, cx, 0.87, 0.08, 0.07), lambda sd: 0.032 + tube(sd, 0.07)),
    ]
    slot = lambda x, y: sd_round_rect(x, y, cx, 0.11, 0.009, 0.034, 0.007)
    return parts, (W, 1.0), slot


def thaw_badge():
    """An enamel plate in a chrome rim with three chrome wings on each side.
    The app writes the name in chrome letters over the red field."""
    W = 3.6
    cx = W / 2
    parts = [(lambda x, y: sd_round_rect(x, y, cx, 0.5, 0.62, 0.36, 0.12), lambda sd: plate(sd, 0.06, 0.05))]
    for side in (-1, 1):
        for i, (y0, length) in enumerate(((0.3, 1.05), (0.5, 1.15), (0.7, 1.05))):
            x_in = cx + side * 0.6
            x_out = cx + side * (0.6 + length)
            parts.append((lambda x, y, a=x_in, b=x_out, c=y0: sd_capsule(x, y, a, c, b, c, 0.035),
                          lambda sd: tube(sd, 0.035)))
    field = lambda x, y: sd_round_rect(x, y, cx, 0.5, 0.53, 0.27, 0.07)
    return parts, (W, 1.0), field


HANDLES = {"fifties": fifties, "riviera": riviera, "thaw": thaw}
HEIGHT_PX = 600

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--preview"]
    out = args[0]
    os.makedirs(out, exist_ok=True)
    for name, build in HANDLES.items():
        spec = build()
        parts, piece = spec[0], spec[1]
        slot = spec[2] if len(spec) > 2 else None
        img, frame = render(parts, piece, HEIGHT_PX, dark_slots=slot)
        path = os.path.join(out, f"handle-{name}.png")
        img.save(path, optimize=True)
        # the app needs where the piece sits inside the image (the rest is shadow)
        print(f"{name}: {img.size[0]}x{img.size[1]}, {os.path.getsize(path) // 1024} KB")
        print(f"    frame: CGRect(x: {frame[0]:.4f}, y: {frame[1]:.4f}, width: {frame[2]:.4f}, height: {frame[3]:.4f}), "
              f"imageAspect: {img.size[0]}.0 / {img.size[1]}.0, pixelHeight: {img.size[1]}")
    parts, piece, field = thaw_badge()
    img, frame = render(parts, piece, 200, paint=(field, (0.5, 0.03, 0.04)), margin=(0.04, 0.04, 0.12, 0.2))
    path = os.path.join(out, "badge-thaw.png")
    img.save(path, optimize=True)
    print(f"badge-thaw: {img.size[0]}x{img.size[1]}, {os.path.getsize(path) // 1024} KB")
    print(f"    frame: CGRect(x: {frame[0]:.4f}, y: {frame[1]:.4f}, width: {frame[2]:.4f}, height: {frame[3]:.4f}), "
          f"imageAspect: {img.size[0]}.0 / {img.size[1]}.0, pixelHeight: {img.size[1]}")
