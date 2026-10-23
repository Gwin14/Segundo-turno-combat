"""Thin wrapper around the aseprite-mcp tool functions.

The art pipeline calls the same tools the MCP server exposes (create_canvas,
draw_rows, outline_cel, set_tag, export_spritesheet, ...) directly from Python,
so every sprite is drawn, outlined, tagged and exported by Aseprite itself.
"""
import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MCP_DIR = os.path.join(ROOT, "tools", "aseprite-mcp")
sys.path.insert(0, MCP_DIR)

os.environ.setdefault(
    "ASEPRITE_PATH",
    os.path.expanduser(
        "~/Library/Application Support/Steam/steamapps/common/Aseprite/"
        "Aseprite.app/Contents/MacOS/aseprite"
    ),
)

from aseprite_mcp.tools import (  # noqa: E402
    animation, canvas, drawing, export, fx, layers, script, transform,
)

SRC = os.path.join(ROOT, "art", "src")
OUT = os.path.join(ROOT, "public", "assets")
os.makedirs(SRC, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def call(coro):
    res = asyncio.run(coro)
    text = str(res)
    if text.startswith(("Failed", "ERROR", "Invalid", "Script failed")) or (
        text.startswith("File ") and "not found" in text
    ):
        raise RuntimeError(text)
    return text


def grid_to_rows(grid, w, h):
    """grid: dict (x,y)->char  ->  list of row strings ('.' = untouched)."""
    return ["".join(grid.get((x, y), ".") for x in range(w)) for y in range(h)]


def new_sprite(path, w, h, frames=1, layer="art", duration=100):
    if os.path.exists(path):
        os.remove(path)
    call(canvas.create_canvas(w, h, path))
    call(canvas.add_layer(path, layer))
    if frames > 1:
        call(animation.add_frames(path, frames - 1, duration))
    call(animation.set_frame_duration_all(path, duration))


def draw_grid(path, layer, frame, grid, w, h, legend, ox=0, oy=0):
    rows = grid_to_rows(grid, w, h)
    # trim fully empty rows/cols to keep the call small
    ys = [i for i, r in enumerate(rows) if r.strip(".")]
    if not ys:
        return
    y0, y1 = ys[0], ys[-1]
    xs = [i for i in range(w) if any(rows[y][i] != "." for y in range(y0, y1 + 1))]
    x0, x1 = xs[0], xs[-1]
    sub = [r[x0:x1 + 1] for r in rows[y0:y1 + 1]]
    call(drawing.draw_rows(path, layer, frame, ox + x0, oy + y0, sub, legend))
