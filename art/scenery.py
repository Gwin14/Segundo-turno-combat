"""Stage (parallax layers), effects and projectiles, drawn through aseprite-mcp."""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ase import OUT, SRC, call, draw_grid, drawing, export, fx, new_sprite  # noqa: E402

OUTLINE = "#1b1420"
random.seed(7)


def pts(*xy):
    return [{"x": x, "y": y} for x, y in xy]


# ------------------------------------------------------------------ sky
def build_sky():
    W, H = 480, 270
    p = os.path.join(SRC, "sky.aseprite")
    new_sprite(p, W, H, layer="sky")
    bands = [(0, 70, "#15123a", "#3a1f5c"), (70, 70, "#3a1f5c", "#93366d"),
             (140, 50, "#93366d", "#e0606a"), (190, 80, "#e0606a", "#f7a85a")]
    for y, h, a, b in bands:
        call(fx.apply_dither_gradient(p, "sky", 1, 0, y, W, h, a, b, horizontal=False))
    # stars
    star_rows = {}
    for _ in range(45):
        star_rows[(random.randrange(W), random.randrange(70))] = random.choice("XY")
    draw_grid(p, "sky", 1, star_rows, W, H, {"X": "#ffffff", "Y": "#a99cff"})
    # retro sun with stripes
    call(drawing.draw_circle_at(p, "sky", 1, 330, 172, 40, "#ffd36b", True))
    call(drawing.draw_circle_at(p, "sky", 1, 330, 172, 34, "#ffe9a0", True))
    for i, y in enumerate(range(170, 214, 6)):
        call(drawing.draw_rectangle_at(p, "sky", 1, 286, y, 90, 2 + i // 2, "#f29a5c", True))
    # clouds
    for cx, cy, rx, col in [(80, 110, 46, "#b8477a"), (130, 118, 34, "#c9577d"), (420, 92, 40, "#7a2f6a"),
                            (230, 150, 30, "#e2737a"), (450, 140, 28, "#e98a74")]:
        call(drawing.draw_ellipse_at(p, "sky", 1, cx, cy, rx, 5, col, True))
        call(drawing.draw_ellipse_at(p, "sky", 1, cx - rx // 3, cy - 3, rx // 2, 4, col, True))
    call(export.export_frame(p, 1, os.path.join(OUT, "sky.png"), 1))


# ------------------------------------------------------------------ Congresso Nacional
MINISTRIES = (10, 70, 130, 190, 406, 466, 526, 586)
def build_far():
    W, H = 640, 270
    p = os.path.join(SRC, "far.aseprite")
    new_sprite(p, W, H, layer="city")
    sil, sil2, lit, win = "#4b2c5e", "#3a2150", "#e58c80", "#ffd27a"
    # distant hills
    call(drawing.draw_polygon(p, "city", 1, pts((0, 200), (60, 186), (140, 192), (220, 182), (300, 190),
                                                 (380, 180), (470, 190), (560, 184), (640, 190), (640, 214), (0, 214)),
                              "#5e3768", True))
    # Esplanada ministries: long low blocks on both sides with lit windows
    for bx in MINISTRIES:
        call(drawing.draw_rectangle_at(p, "city", 1, bx, 176, 44, 30, sil2, True))
        call(drawing.draw_line_at(p, "city", 1, bx, 176, bx + 43, 176, lit, 1))
    # windows in one draw_rows pass (fast)
    wins = {}
    for bx in MINISTRIES:
        for wy in range(180, 204, 5):
            for wx in range(bx + 3, bx + 42, 4):
                if random.random() < 0.4:
                    wins[(wx, wy)] = "Y"; wins[(wx + 1, wy)] = "Y"
    draw_grid(p, "city", 1, wins, W, H, {"Y": win})
    cx = W // 2
    # main horizontal platform
    call(drawing.draw_rectangle_at(p, "city", 1, cx - 120, 182, 240, 14, sil, True))
    call(drawing.draw_line_at(p, "city", 1, cx - 120, 182, cx + 119, 182, lit, 1))
    call(drawing.draw_polygon(p, "city", 1, pts((cx - 130, 196), (cx + 130, 196), (cx + 120, 206), (cx - 120, 206)), sil2, True))
    # twin towers + bridge
    for tx in (cx - 14, cx + 3):
        call(drawing.draw_rectangle_at(p, "city", 1, tx, 92, 11, 92, sil, True))
        call(drawing.draw_line_at(p, "city", 1, tx + 10, 92, tx + 10, 182, lit, 1))
        tw = {}
        for wy in range(96, 180, 4):
            for wx in range(tx + 2, tx + 9, 3):
                if random.random() < 0.35:
                    tw[(wx, wy)] = "Y"
        draw_grid(p, "city", 1, tw, W, H, {"Y": win})
    call(drawing.draw_rectangle_at(p, "city", 1, cx - 3, 118, 6, 6, sil2, True))
    # Senado: dome (convex) on the left
    call(drawing.draw_ellipse_at(p, "city", 1, cx - 70, 182, 22, 14, sil, True))
    call(drawing.draw_rectangle_at(p, "city", 1, cx - 94, 182, 48, 3, sil, True))
    call(drawing.draw_ellipse_at(p, "city", 1, cx - 64, 176, 8, 5, "#6a3e74", True))
    # Câmara: bowl (concave) on the right
    call(drawing.draw_polygon(p, "city", 1, pts((cx + 42, 164), (cx + 118, 164), (cx + 108, 174), (cx + 96, 180),
                                                 (cx + 64, 180), (cx + 52, 174)), sil, True))
    call(drawing.draw_ellipse_at(p, "city", 1, cx + 80, 164, 38, 3, lit, True))
    call(drawing.draw_ellipse_at(p, "city", 1, cx + 80, 164, 34, 2, "#6a3e74", True))
    call(drawing.draw_rectangle_at(p, "city", 1, cx + 76, 180, 8, 3, sil, True))
    # flag pole with Brazilian flag
    call(drawing.draw_line_at(p, "city", 1, cx - 160, 120, cx - 160, 196, "#2a1838", 1))
    flag = ["GGGGGGGGGGGG", "GGGGGYYGGGGG", "GGGYYBBYYGGG", "GYYBBWBBBYYG", "GGGYYBBYYGGG", "GGGGGYYGGGGG",
            "GGGGGGGGGGGG"]
    call(drawing.draw_rows(p, "city", 1, cx - 159, 120, flag,
                           {"G": "#1f9a4a", "Y": "#f8d43a", "B": "#2a44a0", "W": "#ffffff"}))
    # reflecting pool
    call(fx.apply_dither_gradient(p, "city", 1, 0, 206, W, 10, "#c55c78", "#7a3a6a", horizontal=False))
    refl = {}
    for _ in range(90):
        x, y = random.randrange(W), random.randrange(207, 216)
        for k in range(random.randint(2, 6)):
            refl[(x + k, y)] = "L"
    draw_grid(p, "city", 1, refl, W, H, {"L": "#f2a07a"})
    call(export.export_frame(p, 1, os.path.join(OUT, "far.png"), 1))


# ------------------------------------------------------------------ crowd + floor (2 frames)
def build_near():
    W, H = 640, 270
    p = os.path.join(SRC, "near.aseprite")
    new_sprite(p, W, H, frames=2, layer="floor", duration=180)
    for f in (1, 2):
        # crowd: three rows of heads + shoulders, flags
        g = {}
        shirts = ["a", "b", "c", "d", "e", "f"]
        rnd = random.Random(3)
        for row, base in enumerate((206, 214, 222)):
            x = -4 + row * 5
            while x < W:
                up = (1 if (x // 9 + f + row) % 2 else 0) * (2 if row == 2 else 1)
                sh = rnd.choice(shirts)
                skin = rnd.choice("ST")
                yb = base - up
                for yy in range(yb, 236):
                    for xx in range(x - 4, x + 5):
                        if abs(xx - x) <= 4 - max(0, (yb + 2 - yy)):
                            g[(xx, yy)] = sh
                for yy in range(yb - 8, yb - 1):
                    for xx in range(x - 3, x + 3):
                        if (xx - x + 0.5) ** 2 / 9 + (yy - (yb - 5)) ** 2 / 12 <= 1:
                            g[(xx, yy)] = skin
                for xx in range(x - 3, x + 3):
                    g[(xx, yb - 8)] = "h"
                if rnd.random() < 0.18:  # a waving flag
                    fx0 = x + 2
                    top = yb - 26
                    for yy in range(top, yb - 2):
                        g[(fx0, yy)] = "k"
                    kind = rnd.random() < 0.5
                    wave = 1 if f == 1 else -1
                    for yy in range(7):
                        for xx in range(11):
                            off = int(round(math.sin((xx + f * 3) * 0.7) * 1.2))
                            px, py = fx0 + 1 + xx, top + yy + off
                            if kind:
                                c = "G"
                                if abs(xx - 5) + abs(yy - 3) * 1.6 < 5:
                                    c = "Y"
                                if (xx - 5) ** 2 + (yy - 3) ** 2 < 4:
                                    c = "B"
                            else:
                                c = "R"
                                if abs(xx - 5) + abs(yy - 3) < 2:
                                    c = "Y"
                            g[(px, py)] = c
                x += rnd.randint(8, 11)
        leg = {"a": "#2b2440", "b": "#3a2d52", "c": "#46315a", "d": "#5a2a4a", "e": "#2d3a5a", "f": "#33284a",
               "S": "#8a5a4a", "T": "#6a4436", "h": "#1f1626", "k": "#2a1d24",
               "G": "#1f9a4a", "Y": "#f8d43a", "B": "#2a44a0", "R": "#d8302c"}
        draw_grid(p, "floor", f, g, W, H, leg)
        # barrier
        call(drawing.draw_rectangle_at(p, "floor", f, 0, 226, W, 10, "#2a2034", True))
        call(drawing.draw_line_at(p, "floor", f, 0, 226, W - 1, 226, "#c46a6a", 1))
        stripes = {}
        for x in range(0, W, 16):
            for yy in range(228, 235):
                for k in range(6):
                    stripes[(x + k + (yy - 228), yy)] = "Y" if (x // 16) % 2 else "R"
        draw_grid(p, "floor", f, stripes, W, H, {"Y": "#f2c94c", "R": "#3a2b48"})
        # ground: plaza stone tiles
        call(fx.apply_dither_gradient(p, "floor", f, 0, 236, W, 34, "#a86a62", "#5a3446", horizontal=False))
        tiles = {}
        for y, step in ((242, 0), (250, 1), (260, 2)):
            for x in range(W):
                tiles[(x, y)] = "l"
        for i, x in enumerate(range(-200, W + 200, 40)):
            for y in range(237, 270):
                xx = int(x + (x - W / 2) * (y - 237) / 60)
                tiles[(xx, y)] = "l"
        for x in range(W):
            tiles[(x, 236)] = "h"
        draw_grid(p, "floor", f, tiles, W, H, {"l": "#6e3f50", "h": "#e4a08a"})
    call(export.export_spritesheet(p, os.path.join(OUT, "near.png"), "vertical"))


# ------------------------------------------------------------------ effects
def build_fx():
    S = 48
    names = [("hit", 4), ("block", 3), ("dust", 4), ("super", 4)]
    total = sum(n for _, n in names)
    p = os.path.join(SRC, "fx.aseprite")
    new_sprite(p, S, S, frames=total, layer="fx", duration=50)
    leg = {"W": "#ffffff", "Y": "#ffe45c", "O": "#ff9a2e", "R": "#e8402c", "C": "#9ae8ff", "B": "#3a8cff",
           "D": "#d8c0a8", "d": "#a08470", "P": "#ffb0f0", "M": "#c050ff"}
    fi = 1
    c = S / 2
    # hit spark: star burst that grows and breaks apart
    for k in range(4):
        g = {}
        rays = 8
        L = [10, 18, 22, 20][k]
        inner = [0, 3, 9, 14][k]
        for r in range(rays):
            a = r * 2 * math.pi / rays + (0.2 if r % 2 else 0)
            ln = L if r % 2 == 0 else L * 0.6
            for t in range(int(inner), int(ln)):
                w = max(0, int((1 - t / ln) * (3 - k * 0.6)))
                for s in range(-w, w + 1):
                    x = int(c + math.cos(a) * t - math.sin(a) * s)
                    y = int(c + math.sin(a) * t + math.cos(a) * s)
                    col = "W" if t < ln * 0.4 else ("Y" if t < ln * 0.7 else "O")
                    if k == 3:
                        col = "O" if t < ln * 0.7 else "R"
                    g[(x, y)] = col
        if k < 2:
            rr = [6, 8][k]
            for y in range(S):
                for x in range(S):
                    if (x - c) ** 2 + (y - c) ** 2 <= rr * rr:
                        g[(x, y)] = "W"
        draw_grid(p, "fx", fi, g, S, S, leg)
        fi += 1
    # block spark: blue arc shield
    for k in range(3):
        g = {}
        R = [10, 15, 18][k]
        for y in range(S):
            for x in range(S):
                d = math.hypot(x - c + 6, y - c)
                ang = math.atan2(y - c, x - c + 6)
                if abs(ang) < 1.1 and R - 3 + k <= d <= R:
                    g[(x, y)] = "W" if d > R - 1.5 else ("C" if k < 2 else "B")
        for i in range(6):
            a = -0.9 + i * 0.36
            for t in range(R, R + 4 + k * 2):
                g[(int(c - 6 + math.cos(a) * t), int(c + math.sin(a) * t))] = "C"
        draw_grid(p, "fx", fi, g, S, S, leg)
        fi += 1
    # dust puffs
    for k in range(4):
        g = {}
        for (ox, oy, rad) in [(-10, 0, 5), (10, 0, 5), (-4, -3, 6), (5, -2, 6)]:
            r = rad * [0.6, 1, 1.15, 0.9][k]
            cxp = c + ox * [0.5, 1, 1.4, 1.7][k]
            cyp = 40 + oy - k * 2
            for y in range(S):
                for x in range(S):
                    d = (x - cxp) ** 2 + (y - cyp) ** 2
                    if d <= r * r and (k < 3 or (x + y) % 2):
                        g[(x, y)] = "D" if (x - cxp) + (y - cyp) < 0 else "d"
        draw_grid(p, "fx", fi, g, S, S, leg)
        fi += 1
    # super/special flash ring
    for k in range(4):
        g = {}
        R = [6, 12, 18, 22][k]
        for y in range(S):
            for x in range(S):
                d = math.hypot(x - c, y - c)
                if R - 3 <= d <= R:
                    g[(x, y)] = "W" if d > R - 1 else ("P" if k < 2 else "M")
        draw_grid(p, "fx", fi, g, S, S, leg)
        fi += 1
    call(export.export_spritesheet(p, os.path.join(OUT, "fx.png"), "horizontal"))


def build_projectiles():
    S = 32
    p = os.path.join(SRC, "proj.aseprite")
    new_sprite(p, S, S, frames=6, layer="proj", duration=80)
    # picanha: steak with its fat cap, two frames of sizzle
    steak = [
        "....FFFFFFFFFFF.......",
        "..FFFFFFFFFFFFFFF.....",
        ".FfffffffffffffffF....",
        "FRRRRRRRRRRRRRRRRRF...",
        "RRRRrRRRRRRRRrRRRRRR..",
        "RRRRRRRRrRRRRRRRRRRRR.",
        "RRrRRRRRRRRRRRRRRrRRR.",
        "RRRRRRRRRRRRRrRRRRRRR.",
        ".RRRRrRRRRRRRRRRRRRR..",
        "..rrRRRRRRRRRRRRRRrr..",
        "....rrrrrrrrrrrrrr....",
    ]
    leg = {"F": "#fff3dc", "f": "#e8c9a0", "R": "#c0392b", "r": "#7e1e1a", "G": "#5a3a2a", "S": "#ffffff",
           "s": "#c8c8d8", "W": "#f4f4f4", "K": "#202028", "k": "#5a5a66"}
    for f in (1, 2):
        call(drawing.draw_rows(p, "proj", f, 5, 12, steak, leg))
        # grill marks
        for gx in (9, 14, 19):
            call(drawing.draw_line_at(p, "proj", f, gx + (f - 1), 16, gx + 3 + (f - 1), 21, "#5a1a14", 1))
        call(fx.outline_cel(p, "proj", f, OUTLINE))
        # steam
        steam = {}
        for i, sx in enumerate((10, 16, 22)):
            for t in range(6):
                steam[(sx + int(math.sin(t + f * 2 + i) * 1.5), 10 - t)] = "S" if t < 3 else "s"
        draw_grid(p, "proj", f, steam, S, S, leg)
    # football: 4 rotation frames
    for f in range(4):
        g = {}
        cx, cy, R = 15.5, 15.5, 7.5
        for y in range(S):
            for x in range(S):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                if dx * dx + dy * dy <= R * R:
                    a = math.atan2(dy, dx) + f * math.pi / 8
                    d = math.hypot(dx, dy)
                    patch = (d < 2.6) or (d > 4.8 and int((a + 0.3) / (2 * math.pi / 5)) % 2 == 0 and d < 7.6)
                    shade = dx + dy > 6
                    g[(x, y)] = "K" if patch else ("s" if shade else "W")
        draw_grid(p, "proj", 3 + f, g, S, S, leg)
        call(fx.outline_cel(p, "proj", 3 + f, OUTLINE))
    call(export.export_spritesheet(p, os.path.join(OUT, "proj.png"), "horizontal"))


if __name__ == "__main__":
    build_sky()
    build_far()
    build_near()
    build_fx()
    build_projectiles()
    print("scenery done")
