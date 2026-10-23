// Keyboard + gamepad + on-screen touch controls, merged into one bitmask.
import { BTN } from "/shared/sim.js";

const KEYMAP = {
  ArrowLeft: BTN.L, KeyA: BTN.L,
  ArrowRight: BTN.R, KeyD: BTN.R,
  ArrowUp: BTN.U, KeyW: BTN.U, Space: BTN.U,
  ArrowDown: BTN.D, KeyS: BTN.D,
  KeyJ: BTN.P, KeyZ: BTN.P, KeyU: BTN.P,
  KeyK: BTN.K, KeyX: BTN.K, KeyI: BTN.K,
  KeyL: BTN.S, KeyC: BTN.S, KeyO: BTN.S,
};

let keyHeld = 0;
let touchHeld = 0;
let pressed = 0;
let prevPad = 0;
export let enabled = false;

export function setEnabled(v) {
  enabled = v;
  if (!v) { keyHeld = 0; touchHeld = 0; pressed = 0; }
}

window.addEventListener("keydown", (e) => {
  const b = KEYMAP[e.code];
  if (!b || !enabled) return;
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;
  e.preventDefault();
  if (!(keyHeld & b)) pressed |= b;
  keyHeld |= b;
});
window.addEventListener("keyup", (e) => {
  const b = KEYMAP[e.code];
  if (b) keyHeld &= ~b;
});
window.addEventListener("blur", () => { keyHeld = 0; touchHeld = 0; });

function padState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let m = 0;
  for (const p of pads) {
    if (!p) continue;
    const b = (i) => p.buttons[i] && p.buttons[i].pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (b(14) || ax < -0.45) m |= BTN.L;
    if (b(15) || ax > 0.45) m |= BTN.R;
    if (b(12) || ay < -0.6) m |= BTN.U;
    if (b(13) || ay > 0.6) m |= BTN.D;
    if (b(2)) m |= BTN.P;
    if (b(0)) m |= BTN.K;
    if (b(1) || b(3) || b(5)) m |= BTN.S;
  }
  return m;
}

// Poll once per simulation tick.
export function readInput() {
  if (!enabled) return { h: 0, p: 0 };
  const pad = padState();
  pressed |= pad & ~prevPad;
  prevPad = pad;
  const h = keyHeld | touchHeld | pad;
  const p = pressed;
  pressed = 0;
  return { h, p };
}

// ------------------------------------------------------------------ touch
export function setupTouch(root) {
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  root.classList.add("show");
  const active = new Map(); // pointerId -> mask
  const recompute = () => {
    let m = 0;
    for (const v of active.values()) m |= v;
    pressed |= m & ~touchHeld;
    touchHeld = m;
  };
  const maskAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 0;
    const t = el.closest("[data-btn]");
    return t ? Number(t.dataset.btn) : 0;
  };
  root.querySelectorAll("[data-btn]").forEach((el) => {
    const k = el.dataset.key;
    el.dataset.btn = { L: BTN.L, R: BTN.R, U: BTN.U, D: BTN.D, UL: BTN.U | BTN.L, UR: BTN.U | BTN.R,
      DL: BTN.D | BTN.L, DR: BTN.D | BTN.R, P: BTN.P, K: BTN.K, S: BTN.S }[k];
  });
  root.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    root.setPointerCapture?.(e.pointerId);
    active.set(e.pointerId, maskAt(e.clientX, e.clientY));
    recompute();
  });
  root.addEventListener("pointermove", (e) => {
    if (!active.has(e.pointerId)) return;
    active.set(e.pointerId, maskAt(e.clientX, e.clientY));
    recompute();
  });
  const end = (e) => { active.delete(e.pointerId); recompute(); };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
}
