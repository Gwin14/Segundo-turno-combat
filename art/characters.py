"""Builds both fighters' sprite sheets through aseprite-mcp.

Each frame is a skeleton pose (joints in sprite pixels, facing right). Limbs,
torso and head are rasterised into a character grid with light coming from
the upper left, then the grid is drawn into the Aseprite frame with
draw_rows, outlined with outline_cel, tagged and exported as a sheet.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ase import OUT, SRC, animation, call, draw_grid, export, fx, new_sprite  # noqa: E402

W, H = 96, 80
OUTLINE = "#1b1420"
LIGHT = (-0.6, -0.8)

# ---------------------------------------------------------------- characters
# material -> (base, shade, deep). One legend char per colour.
CHARS = {
    "lula": {
        "colors": {
            "skin": ("#c98a5a", "#9c6440", "#6e4029"),
            "shirt": ("#f4f1e8", "#bcc2d0", "#8a90a3"),
            "tie": ("#e0302c", "#9c1c22", "#6a1018"),
            "pants": ("#3a3b4a", "#25252f", "#16161d"),
            "shoe": ("#4a2c1a", "#2b170d", "#1a0d06"),
            "hair": ("#f0f2f5", "#aeb0bf", "#7d7f8e"),
            "belt": ("#1c1a1a", "#111010", "#0a0909"),
            "eye": ("#1a0f0a",) * 3,
            "mouth": ("#5e1f22", "#3c1215", "#3c1215"),
            "brow": ("#8d8f9e", "#6d6f7e", "#6d6f7e"),
            "accent": ("#ffd23c", "#d29a1c", "#9a6a10"),
        },
        "head": [
            "......hhhhhh......",
            "....hhHHHHHHhh....",
            "...hHHHHHHHSSSh...",
            "..hHHHHHHSSSSSSS..",
            "..hHHHHHSSSSSSSSS.",
            "..hHHHHHSSSSSSSSS.",
            "..hHHHHSSSSSSSSSS.",
            "..hHHHssSSSSSSSSS.",
            "..hHHsSsSSSSSSSSSS",
            "..hhHsssSSSSSSSSsS",
            "...hHHsSSSSSSSSss.",
            "...hHHHSSSHHHHHHH.",
            "...hHHHHHHHHHHHHH.",
            "...hHHHHHHHHHHHHh.",
            "....hHHHHHHHHHHHh.",
            ".....hHHHHHHHHHh..",
            "......hhHHHHHhh...",
            "........hhhhh.....",
        ],
        "mouth_row": 12,
        "sleeve": "rolled",  # forearms bare
    },
    "flavio": {
        "colors": {
            "skin": ("#e9b68c", "#c18862", "#8e5c3e"),
            "shirt": ("#f8d43a", "#cf9d18", "#946a0c"),
            "tie": ("#1fa04c", "#11693a", "#0a4426"),
            "pants": ("#2a44a0", "#1a2b6c", "#101b46"),
            "shoe": ("#f2f2f2", "#b9bcc6", "#7e8190"),
            "hair": ("#3b2a1f", "#22160f", "#140c07"),
            "belt": ("#1fa04c", "#11693a", "#0a4426"),
            "eye": ("#1a0f0a",) * 3,
            "mouth": ("#7a3030", "#4e1a1c", "#4e1a1c"),
            "brow": ("#22160f", "#22160f", "#22160f"),
            "accent": ("#2a44a0", "#1a2b6c", "#101b46"),
            "stubble": ("#b98a6c", "#9b6e52", "#9b6e52"),
        },
        "head": [
            "......hhhhhhh.....",
            "....hhHHHHHHHHh...",
            "...hHHHHHHHHHHHHh.",
            "..hHHHHHHHHHHHHHHh",
            "..hHHHHHHHHHHSSSh.",
            "..hHHHHHHSSSSSSSS.",
            "..hHHHHSSSSSSSSSS.",
            "..hHHHssSSSSSSSSS.",
            "..hHHsSsSSSSSSSSSS",
            "..hhHsssSSSSSSSSsS",
            "...hhHsSSSSSSSSss.",
            "....hdSSSSSSSSSSS.",
            "....ddSSSSSSSSSSd.",
            ".....ddSSSSSSSSdd.",
            "......ddddSSSddd..",
            "........ddddddd...",
        ],
        "mouth_row": 12,
        "sleeve": "short",
    },
}

# legend characters per (material, tone)
TONES = ["base", "shade", "deep"]
CODES = {
    ("skin", 0): "S", ("skin", 1): "s", ("skin", 2): "z",
    ("shirt", 0): "W", ("shirt", 1): "w", ("shirt", 2): "v",
    ("tie", 0): "R", ("tie", 1): "r", ("tie", 2): "q",
    ("pants", 0): "P", ("pants", 1): "p", ("pants", 2): "o",
    ("shoe", 0): "B", ("shoe", 1): "b", ("shoe", 2): "n",
    ("hair", 0): "H", ("hair", 1): "h", ("hair", 2): "g",
    ("belt", 0): "L", ("belt", 1): "l", ("belt", 2): "j",
    ("eye", 0): "E", ("eye", 1): "E", ("eye", 2): "E",
    ("mouth", 0): "M", ("mouth", 1): "m", ("mouth", 2): "m",
    ("brow", 0): "Y", ("brow", 1): "y", ("brow", 2): "y",
    ("accent", 0): "A", ("accent", 1): "a", ("accent", 2): "c",
    ("stubble", 0): "d", ("stubble", 1): "f", ("stubble", 2): "f",
}


def legend_for(ch):
    leg = {}
    for (mat, tone), code in CODES.items():
        if mat in ch["colors"]:
            leg[code] = ch["colors"][mat][tone]
    leg["X"] = "#ffffff"
    return leg


# ---------------------------------------------------------------- raster
class Canvas:
    def __init__(self):
        self.g = {}

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.g[(x, y)] = c

    def capsule(self, a, b, r, mat, back=False, shade_w=1.6):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-6
        x0, x1 = int(min(ax, bx) - r - 1), int(max(ax, bx) + r + 2)
        y0, y1 = int(min(ay, by) - r - 1), int(max(ay, by) + r + 2)
        t0 = 1 if back else 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                px, py = x + 0.5, y + 0.5
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                cx, cy = ax + t * dx, ay + t * dy
                ddx, ddy = px - cx, py - cy
                d = math.hypot(ddx, ddy)
                if d <= r:
                    tone = t0
                    if d > 0.01:
                        nl = (ddx * LIGHT[0] + ddy * LIGHT[1]) / d
                        if nl < -0.25 and d > r - shade_w:
                            tone = min(2, t0 + 1)
                    self.put(x, y, CODES[(mat, tone)])

    def ellipse(self, cx, cy, rx, ry, mat, back=False):
        t0 = 1 if back else 0
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                d = nx * nx + ny * ny
                if d <= 1.0:
                    tone = t0
                    if d > 0.45 and (nx * LIGHT[0] + ny * LIGHT[1]) < -0.2:
                        tone = min(2, t0 + 1)
                    self.put(x, y, CODES[(mat, tone)])

    def poly(self, pts, mat, back=False):
        t0 = 1 if back else 0
        ys = [p[1] for p in pts]
        xs = [p[0] for p in pts]
        cx = sum(xs) / len(xs)
        maxx = max(xs)
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if point_in_poly(x + 0.5, y + 0.5, pts):
                    tone = t0
                    # shadow band on the right/back side, away from the light
                    if x + 0.5 > cx + (maxx - cx) * 0.55:
                        tone = min(2, t0 + 1)
                    self.put(x, y, CODES[(mat, tone)])

    def line(self, a, b, code):
        x0, y0 = a
        x1, y1 = b
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / max(1, n)
            self.put(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), code)


def point_in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
            inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------- head/faces
HEAD_MAP = {"H": ("hair", 0), "h": ("hair", 1), "S": ("skin", 0), "s": ("skin", 1),
            "d": ("stubble", 0)}


def head_grid(ch, face):
    rows = [list(r) for r in ch["head"]]
    conv = []
    for r in rows:
        conv.append([CODES[HEAD_MAP[c]] if c in HEAD_MAP else None for c in r])
    E, M, m, Y = "E", "M", "m", "Y"
    mr = ch["mouth_row"]

    def put(x, y, c):
        if 0 <= y < len(conv) and 0 <= x < len(conv[0]):
            conv[y][x] = c

    put(16, 10, CODES[("skin", 2)])
    if face == "normal":
        for x in (10, 11, 14, 15):
            put(x, 7, Y)
        put(11, 8, E); put(15, 8, E)
        put(12, mr, m); put(13, mr, m); put(14, mr, m)
    elif face == "shout":
        put(10, 6, Y); put(11, 7, Y); put(14, 7, Y); put(15, 6, Y)
        put(11, 8, E); put(15, 8, E)
        for x in (12, 13, 14):
            put(x, mr, M); put(x, mr + 1, M)
        put(13, mr, "X")
    elif face == "hurt":
        put(10, 7, Y); put(11, 6, Y); put(14, 6, Y); put(15, 7, Y)
        put(10, 8, E); put(11, 8, E); put(14, 8, E); put(15, 8, E)
        put(12, mr, M); put(13, mr, M); put(12, mr + 1, M); put(13, mr + 1, M)
    elif face == "happy":
        for x in (10, 11, 14, 15):
            put(x, 6, Y)
        put(10, 8, E); put(11, 7, E); put(12, 8, E)
        put(14, 8, E); put(15, 7, E); put(16, 8, E)
        for x in (11, 12, 13, 14, 15):
            put(x, mr, M)
        put(12, mr, "X"); put(13, mr, "X"); put(14, mr, "X")
    elif face == "ko":
        # X eyes
        put(10, 7, E); put(12, 9, E); put(11, 8, E); put(12, 7, E); put(10, 9, E)
        put(14, 7, E); put(16, 9, E); put(15, 8, E); put(16, 7, E); put(14, 9, E)
        put(12, mr, M); put(13, mr, M); put(14, mr, M)
    return conv


def rot_ccw(grid):
    h, w = len(grid), len(grid[0])
    return [[grid[y][w - 1 - x] for y in range(h)] for x in range(w)]


def rot_cw(grid):
    h, w = len(grid), len(grid[0])
    return [[grid[h - 1 - y][x] for y in range(h)] for x in range(w)]


def stamp_head(cv, ch, neck, face, rot=0):
    g = head_grid(ch, face)
    hh = len(g)
    if rot == 0:
        ox, oy = neck[0] - 9, neck[1] - hh + 1
    elif rot == 90:  # lying on the back, head to the left, face up
        g = rot_ccw(g)
        ox, oy = neck[0] - len(g[0]) + 1, neck[1] - 9
    else:  # -90: tipped forward
        g = rot_cw(g)
        ox, oy = neck[0], neck[1] - 9
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c:
                cv.put(ox + x, oy + y, c)


# ---------------------------------------------------------------- body
def render(ch, p):
    cv = Canvas()
    neck, hip = p["neck"], p["hip"]
    lean = p.get("lean", 0)
    sf = (neck[0] + 3, neck[1] + 4)
    sb = (neck[0] - 3, neck[1] + 4)
    hf = (hip[0] + 3, hip[1])
    hb = (hip[0] - 3, hip[1])
    rolled = ch["sleeve"] == "rolled"

    def leg(h, k, f, back):
        cv.capsule(h, k, 4.2, "pants", back)
        cv.capsule(k, (f[0], f[1] - 3), 3.4, "pants", back)
        cv.capsule((f[0] - 2, f[1] - 1.5), (f[0] + 4, f[1] - 1.5), 2.3, "shoe", back)

    def arm(s, e, h, back, hand="fist"):
        # upper arm: sleeve
        if rolled:
            cv.capsule(s, e, 3.2, "shirt", back)
            cv.capsule(e, h, 2.6, "skin", back)
        else:
            mid = ((s[0] + e[0]) / 2, (s[1] + e[1]) / 2)
            cv.capsule(s, mid, 3.4, "shirt", back)
            cv.capsule(mid, e, 2.7, "skin", back)
            cv.capsule(e, h, 2.6, "skin", back)
        if hand == "fist":
            cv.ellipse(h[0] + 0.5, h[1] + 0.5, 3.1, 3.1, "skin", back)
        else:
            cv.ellipse(h[0] + 0.5, h[1] + 0.5, 2.6, 3.4, "skin", back)

    order = p.get("order", "normal")
    # back limbs
    leg(hb, p["kb"], p["fb"], True)
    arm(sb, p["eb"], p["hb"], True, p.get("hand_b", "fist"))
    # torso
    tw = p.get("tw", 0)
    pts = [(neck[0] - 8 + tw, neck[1] + 1), (neck[0] + 8 + tw, neck[1] + 1),
           (neck[0] + 9 + tw * 0.5, neck[1] + 8), (hip[0] + 7, hip[1] - 1),
           (hip[0] - 7, hip[1] - 1), (neck[0] - 8 + tw * 0.5, neck[1] + 8)]
    cv.poly(pts, "shirt")
    cv.ellipse(neck[0] - 5 + tw, neck[1] + 4, 4.5, 4, "shirt")
    cv.ellipse(neck[0] + 5 + tw, neck[1] + 4, 4.5, 4, "shirt")
    # neck
    cv.capsule((neck[0], neck[1] - 2), (neck[0] + tw * 0.5, neck[1] + 1), 2.6, "skin")
    # collar / tie / trim
    if ch is CHARS["lula"]:
        top = (neck[0] + 2 + tw, neck[1] + 2)
        bot = (hip[0] + 3, hip[1] - 4)
        cv.line(top, bot, CODES[("tie", 0)])
        cv.line((top[0] + 1, top[1] + 1), (bot[0] + 1, bot[1]), CODES[("tie", 1)])
        cv.put(int(top[0]), int(top[1]), CODES[("tie", 1)])
        # star pin
        cv.put(neck[0] - 2 + tw, neck[1] + 6, CODES[("tie", 0)])
    else:
        # green collar v + number
        cv.line((neck[0] - 3 + tw, neck[1] + 1), (neck[0] + 1 + tw, neck[1] + 5), CODES[("tie", 0)])
        cv.line((neck[0] + 5 + tw, neck[1] + 1), (neck[0] + 1 + tw, neck[1] + 5), CODES[("tie", 0)])
        cx = (neck[0] + hip[0]) // 2 + 1
        cy = (neck[1] + hip[1]) // 2 + 1
        cv.line((cx - 1, cy), (cx + 1, cy), CODES[("tie", 0)])
        cv.line((cx, cy - 1), (cx, cy + 1), CODES[("tie", 0)])
    # belt + pelvis
    cv.ellipse(hip[0], hip[1] + 2, 6.5, 3.6, "pants")
    for x in range(hip[0] - 6, hip[0] + 7):
        cv.put(x, hip[1] - 1, CODES[("belt", 0 if x < hip[0] + 3 else 1)])
    # front leg, head, front arm
    leg(hf, p["kf"], p["ff"], False)
    stamp_head(cv, ch, p.get("head", (neck[0], neck[1])), p.get("face", "normal"), p.get("rot", 0))
    arm(sf, p["ef"], p["hf"], False, p.get("hand_f", "fist"))
    return cv.g


# ---------------------------------------------------------------- poses
BASE = dict(neck=(42, 27), hip=(40, 50),
            ef=(50, 39), hf=(55, 31), eb=(41, 41), hb=(48, 34),
            kf=(48, 63), ff=(53, 76), kb=(34, 63), fb=(29, 76))


def P(_base=BASE, dy=0, dx=0, **kw):
    p = dict(_base)
    p.update(kw)
    if dy or dx:
        for k in ("neck", "hip", "ef", "hf", "eb", "hb", "head"):
            if k in p and k not in kw:
                p[k] = (p[k][0] + dx, p[k][1] + dy)
    return p


def bob(p, dy):
    q = dict(p)
    for k in ("neck", "hip", "ef", "hf", "eb", "hb"):
        q[k] = (q[k][0], q[k][1] + dy)
    q["kf"] = (q["kf"][0] + (1 if dy > 0 else 0), q["kf"][1] + dy // 2)
    q["kb"] = (q["kb"][0] - (1 if dy > 0 else 0), q["kb"][1] + dy // 2)
    return q


CROUCH = dict(neck=(43, 40), hip=(40, 61), ef=(51, 51), hf=(56, 44), eb=(43, 54), hb=(50, 47),
              kf=(52, 61), ff=(53, 76), kb=(31, 66), fb=(28, 76))


def anims(name):
    win_hand = "open" if name == "lula" else "fist"
    A = {}
    A["idle"] = [bob(BASE, d) for d in (0, 1, 2, 1)]
    A["walk"] = [
        bob(P(kf=(51, 63), ff=(57, 76), kb=(33, 63), fb=(26, 76)), 1),
        P(kf=(46, 62), ff=(45, 76), kb=(41, 61), fb=(37, 71)),
        bob(P(kf=(39, 63), ff=(33, 76), kb=(46, 63), fb=(51, 76)), 1),
        P(kf=(44, 61), ff=(41, 71), kb=(38, 62), fb=(39, 76)),
    ]
    A["crouch"] = [P(CROUCH)]
    A["jump"] = [
        P(neck=(42, 22), hip=(40, 45), kf=(50, 52), ff=(48, 63), kb=(35, 55), fb=(30, 64),
          ef=(50, 33), hf=(55, 25), eb=(41, 36), hb=(48, 29)),
        P(neck=(42, 22), hip=(40, 44), kf=(51, 46), ff=(45, 56), kb=(42, 50), fb=(34, 56),
          ef=(50, 33), hf=(55, 25), eb=(41, 36), hb=(48, 29)),
        P(neck=(42, 24), hip=(40, 47), kf=(48, 58), ff=(52, 70), kb=(36, 60), fb=(31, 71),
          ef=(50, 35), hf=(55, 27), eb=(41, 38), hb=(48, 31)),
    ]
    A["jkick"] = [P(neck=(38, 23), hip=(40, 46), kf=(54, 52), ff=(67, 57), kb=(41, 56), fb=(32, 54),
                    ef=(44, 34), hf=(49, 28), eb=(32, 34), hb=(26, 38), face="shout")]
    A["punch"] = [
        P(neck=(41, 27), ef=(45, 40), hf=(48, 33), face="shout"),
        P(neck=(46, 28), hip=(41, 50), ef=(58, 32), hf=(70, 31), eb=(43, 40), hb=(47, 35),
          kf=(50, 63), ff=(56, 76), tw=1, face="shout"),
        P(neck=(44, 27), ef=(54, 36), hf=(62, 33), face="normal"),
    ]
    A["kick"] = [
        P(neck=(38, 27), kf=(51, 53), ff=(50, 65), kb=(37, 63), fb=(36, 76),
          ef=(46, 38), hf=(51, 31), eb=(36, 40), hb=(42, 34), face="shout"),
        P(neck=(36, 28), hip=(40, 50), kf=(55, 47), ff=(70, 44), kb=(38, 63), fb=(37, 76),
          ef=(44, 38), hf=(49, 32), eb=(30, 37), hb=(24, 41), face="shout"),
        P(neck=(39, 27), kf=(50, 56), ff=(54, 68), kb=(37, 63), fb=(35, 76),
          ef=(47, 38), hf=(52, 31), eb=(38, 40), hb=(44, 34)),
    ]
    A["cpunch"] = [P(CROUCH, neck=(45, 41), ef=(60, 48), hf=(72, 48), eb=(45, 54), hb=(50, 49),
                     face="shout")]
    A["special"] = [
        P(neck=(39, 27), hip=(40, 50), ef=(37, 22), hf=(31, 15), eb=(44, 41), hb=(50, 36),
          face="shout", hand_f="open"),
        P(neck=(46, 27), hip=(41, 50), ef=(57, 26), hf=(67, 22), eb=(41, 42), hb=(44, 49),
          kf=(52, 63), ff=(58, 76), face="shout", hand_f="open", tw=1),
        P(neck=(45, 28), hip=(41, 50), ef=(55, 40), hf=(62, 46), eb=(41, 42), hb=(45, 48),
          kf=(51, 63), ff=(57, 76), hand_f="open"),
    ]
    A["block"] = [P(neck=(39, 28), hip=(38, 51), ef=(51, 41), hf=(49, 27), eb=(48, 43), hb=(53, 31),
                    kf=(46, 64), ff=(51, 76), kb=(32, 64), fb=(27, 76), face="hurt")]
    A["hit"] = [
        P(neck=(36, 28), hip=(39, 51), ef=(44, 40), hf=(48, 47), eb=(31, 37), hb=(26, 43),
          kf=(47, 64), ff=(52, 76), kb=(33, 64), fb=(28, 76), face="hurt"),
        P(neck=(33, 30), hip=(38, 52), ef=(42, 42), hf=(47, 49), eb=(28, 38), hb=(22, 44),
          kf=(46, 64), ff=(52, 76), kb=(32, 65), fb=(27, 76), face="hurt"),
    ]
    A["ko"] = [
        P(neck=(30, 35), hip=(40, 55), ef=(36, 28), hf=(34, 20), eb=(24, 38), hb=(18, 32),
          kf=(48, 65), ff=(53, 76), kb=(36, 67), fb=(32, 76), face="hurt"),
        P(neck=(22, 55), hip=(40, 63), ef=(26, 44), hf=(22, 37), eb=(18, 58), hb=(12, 52),
          kf=(52, 58), ff=(62, 52), kb=(50, 63), fb=(60, 60), face="ko", rot=90,
          head=(20, 55)),
        P(neck=(22, 71), hip=(42, 71), ef=(28, 75), hf=(34, 76), eb=(16, 74), hb=(10, 76),
          kf=(54, 68), ff=(66, 73), kb=(53, 72), fb=(65, 76), face="ko", rot=90,
          head=(20, 71)),
    ]
    A["win"] = [
        P(neck=(41, 26), hip=(40, 50), ef=(49, 17), hf=(51, 7), eb=(33, 41), hb=(37, 49),
          kf=(45, 63), ff=(47, 76), kb=(36, 63), fb=(33, 76), face="happy", hand_f=win_hand),
        P(neck=(41, 25), hip=(40, 49), ef=(50, 16), hf=(52, 5), eb=(33, 40), hb=(37, 48),
          kf=(45, 63), ff=(47, 76), kb=(36, 63), fb=(33, 76), face="happy", hand_f=win_hand),
    ]
    return A


ORDER = ["idle", "walk", "crouch", "jump", "jkick", "punch", "kick", "cpunch",
         "special", "block", "hit", "ko", "win"]


def build(name):
    ch = CHARS[name]
    A = anims(name)
    frames = [(tag, i, p) for tag in ORDER for i, p in enumerate(A[tag])]
    path = os.path.join(SRC, f"{name}.aseprite")
    new_sprite(path, W, H, frames=len(frames), layer="body", duration=100)
    leg = legend_for(ch)
    meta = {"frameW": W, "frameH": H, "anchorX": 40, "anchorY": 77, "tags": {}}
    idx = 0
    for tag in ORDER:
        n = len(A[tag])
        meta["tags"][tag] = [idx, idx + n - 1]
        call(animation.set_tag(path, tag, idx + 1, idx + n))
        idx += n
    for fi, (tag, i, p) in enumerate(frames, start=1):
        g = render(ch, p)
        draw_grid(path, "body", fi, g, W, H, leg)
        call(fx.outline_cel(path, "body", fi, OUTLINE))
    png = os.path.join(OUT, f"{name}.png")
    call(export.export_spritesheet(path, png, "horizontal"))
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(name, len(frames), "frames ->", png)
    return path


def build_portrait(name):
    """24x24 HUD portrait: the head in the 'normal' face, drawn and outlined in Aseprite."""
    ch = CHARS[name]
    path = os.path.join(SRC, f"{name}_portrait.aseprite")
    new_sprite(path, 24, 24, layer="face")
    g = {}
    for y, row in enumerate(head_grid(ch, "normal")):
        for x, c in enumerate(row):
            if c:
                g[(x + 3, y + 3)] = c
    draw_grid(path, "face", 1, g, 24, 24, legend_for(ch))
    call(fx.outline_cel(path, "face", 1, OUTLINE))
    call(export.export_frame(path, 1, os.path.join(OUT, f"{name}_portrait.png"), 1))


if __name__ == "__main__":
    which = sys.argv[1:] or ["lula", "flavio"]
    for n in which:
        build(n)
        build_portrait(n)
