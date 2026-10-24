"""Open Graph share image (1200x630), composed in Aseprite through aseprite-mcp.

The stage layers and fighter frames already exported by scenery.py and
characters.py are imported as layers, the title is drawn with draw_text in
the game font, and the 400x210 sprite is exported at 3x.
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ase import OUT, ROOT, SRC, call, export, new_sprite  # noqa: E402
from aseprite_mcp.tools import text  # noqa: E402

W, H = 400, 210
FONT = os.path.join(ROOT, "art", "fonts", "press-start-2p.ttf")
INK = "#1b1420"
TMP = os.path.join(SRC, "og_parts")
os.makedirs(TMP, exist_ok=True)


def fighter_png(name, tag, flip):
    """Cut one frame out of the exported sheet, 2x nearest-neighbour."""
    meta = json.load(open(os.path.join(OUT, f"{name}.json")))
    fi = meta["tags"][tag][0]
    sheet = Image.open(os.path.join(OUT, f"{name}.png"))
    fw, fh = meta["frameW"], meta["frameH"]
    frame = sheet.crop((fi * fw, 0, fi * fw + fw, fh)).resize((fw * 2, fh * 2), Image.NEAREST)
    if flip:
        frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
    path = os.path.join(TMP, f"{name}_{tag}.png")
    frame.save(path)
    return path, meta


def build_og():
    p = os.path.join(SRC, "og.aseprite")
    new_sprite(p, W, H, layer="sky")
    # stage, cropped to the sunset band and the front of the crowd
    oy = -55
    call(export.import_image_as_layer(p, os.path.join(OUT, "sky.png"), "sky", 1, (W - 480) // 2, oy))
    call(export.import_image_as_layer(p, os.path.join(OUT, "far.png"), "far", 1, (W - 640) // 2, oy))
    call(export.import_image_as_layer(p, os.path.join(OUT, "near.png"), "near", 1, (W - 640) // 2, oy))
    # fighters facing each other at 2x
    lula, meta = fighter_png("lula", "idle", False)
    flavio, _ = fighter_png("flavio", "idle", True)
    feet = 202
    top = feet - meta["anchorY"] * 2
    call(export.import_image_as_layer(p, lula, "lula", 1, 6, top))
    call(export.import_image_as_layer(p, flavio, "flavio", 1, W - 6 - meta["frameW"] * 2, top))
    # title block
    call(text.draw_text(p, "SEGUNDO", W // 2, 12, FONT, size=16, color="#ffffff", layer_name="title",
                        anchor="top", letter_spacing=4, outline_color=INK, outline_width=2,
                        shadow_color=INK, shadow_dx=2, shadow_dy=2))
    call(text.draw_text(p, "TURNO", W // 2, 34, FONT, size=40, color="#ffd23c", layer_name="title",
                        anchor="top", outline_color=INK, outline_width=3,
                        shadow_color="#c01818", shadow_dx=3, shadow_dy=3))
    call(text.draw_text(p, "O EMBATE FINAL", W // 2, 86, FONT, size=8, color="#9ae8ff", layer_name="title",
                        anchor="top", letter_spacing=2, outline_color=INK, outline_width=2))
    call(text.draw_text(p, "VS", W // 2, 132, FONT, size=24, color="#ff7a1a", layer_name="title",
                        anchor="center", outline_color=INK, outline_width=3,
                        shadow_color="#fff36b", shadow_dx=-2, shadow_dy=-2))
    call(text.draw_text(p, "LUTA ONLINE NO NAVEGADOR", W // 2, 196, FONT, size=8, color="#ffffff",
                        layer_name="title", anchor="center", outline_color=INK, outline_width=2))
    call(export.export_frame(p, 1, os.path.join(ROOT, "public", "og.png"), 3))
    print("og image ->", os.path.join(ROOT, "public", "og.png"))


if __name__ == "__main__":
    build_og()
