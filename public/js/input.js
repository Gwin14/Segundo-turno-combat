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
  document.documentElement.classList.add("touch");
  const MASKS = { L: BTN.L, R: BTN.R, U: BTN.U, D: BTN.D, UL: BTN.U | BTN.L, UR: BTN.U | BTN.R,
    DL: BTN.D | BTN.L, DR: BTN.D | BTN.R, P: BTN.P, K: BTN.K, S: BTN.S };
  const keys = [...root.querySelectorAll("[data-key]")];
  const active = new Map(); // touch identifier -> element under that finger
  const keyAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const t = el && el.closest("[data-key]");
    return t && root.contains(t) ? t : null;
  };
  const recompute = () => {
    let m = 0;
    for (const el of active.values()) if (el) m |= MASKS[el.dataset.key] || 0;
    const fresh = m & ~touchHeld;
    if (fresh & (BTN.P | BTN.K | BTN.S) && navigator.vibrate) navigator.vibrate(12);
    pressed |= fresh;
    touchHeld = m;
    const lit = new Set(active.values());
    for (const k of keys) {
      const on = lit.has(k) || (k.dataset.key.length === 1 && (m & MASKS[k.dataset.key]) && k.closest(".dpad"));
      k.classList.toggle("on", !!on);
    }
  };
  const track = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) active.set(t.identifier, keyAt(t.clientX, t.clientY));
    recompute();
  };
  const end = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) active.delete(t.identifier);
    recompute();
  };
  for (const zone of root.querySelectorAll(".dpad, .abtns")) {
    zone.addEventListener("touchstart", track, { passive: false });
    zone.addEventListener("touchmove", track, { passive: false });
    zone.addEventListener("touchend", end, { passive: false });
    zone.addEventListener("touchcancel", end, { passive: false });
  }
}

// Clear touch state, e.g. when the controls are hidden mid-press.
export function releaseTouch() {
  touchHeld = 0;
  document.querySelectorAll("#touch .on").forEach((el) => el.classList.remove("on"));
}
