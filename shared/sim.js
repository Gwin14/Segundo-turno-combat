// Deterministic fight simulation shared by the server (online matches) and the
// browser (training vs CPU). Everything runs in fixed 60 Hz ticks.

export const W = 640;
export const FPS = 60;
export const ROUND_TIME = 60;
export const MAX_HP = 1000;
export const WINS_NEEDED = 2;
export const VS_TICKS = 110;
export const BTN = { L: 1, R: 2, U: 4, D: 8, P: 16, K: 32, S: 64 };
const ATTACK_BTNS = BTN.P | BTN.K | BTN.S;

const GRAV = 0.45;
const JUMP_V = 8.4;
const JUMP_VX = 2.8;
const WALK_F = 2.3;
const WALK_B = 1.8;
const MIN_X = 22;
const MAX_X = W - 22;
const PUSH_W = 26;
const MAX_SPREAD = 430;
const HURT_W = 13;

// s: startup, a: active, r: recovery (ticks). rx/ry: hitbox relative to feet.
export const MOVES = {
  punch: { s: 5, a: 3, r: 9, dmg: 55, rx: [8, 38], ry: [40, 56], hs: 15, bs: 9, kb: 3.2, heavy: false },
  kick: { s: 8, a: 4, r: 15, dmg: 85, rx: [8, 40], ry: [26, 46], hs: 19, bs: 11, kb: 4.6, heavy: true },
  cpunch: { s: 5, a: 3, r: 10, dmg: 50, rx: [8, 40], ry: [20, 36], hs: 14, bs: 9, kb: 3.2, heavy: false },
  jkick: { s: 3, a: 60, r: 0, dmg: 75, rx: [2, 34], ry: [4, 32], hs: 18, bs: 10, kb: 3.6, heavy: true },
  special: { s: 14, a: 0, r: 24 },
};
const PROJ = { speed: 4.4, y: 56, r: 8, dmg: 90, hs: 22, bs: 14, chip: 14 };

export const CHAR_NAMES = { lula: "LULA", flavio: "FLÁVIO" };

function makeFighter(char, side) {
  return {
    c: char, x: side === 0 ? W / 2 - 80 : W / 2 + 80, y: 0, vx: 0, vy: 0,
    fc: side === 0 ? 1 : -1, hp: MAX_HP, s: "idle", st: 0, mv: "", hit: false,
    stun: 0, cb: 0, w: 0, g: false, inv: 0, buf: 0, bufT: 0, h: 0,
  };
}

export function createMatch(chars) {
  const S = {
    k: 0, ph: "intro", pt: 0, rd: 1, tm: ROUND_TIME, tf: 0, hs: 0, sm: 0,
    control: false, f: [makeFighter(chars[0], 0), makeFighter(chars[1], 1)],
    pr: [], ev: [], eid: 0, winner: -1,
  };
  return S;
}

function resetRound(S) {
  const wins = [S.f[0].w, S.f[1].w];
  S.f = [makeFighter(S.f[0].c, 0), makeFighter(S.f[1].c, 1)];
  S.f[0].w = wins[0];
  S.f[1].w = wins[1];
  S.pr = [];
  S.ph = "intro";
  S.pt = 0;
  S.tm = ROUND_TIME;
  S.tf = 0;
  S.hs = 0;
  S.sm = 0;
  S.control = false;
}

export function rematch(S) {
  const chars = [S.f[0].c, S.f[1].c];
  const fresh = createMatch(chars);
  fresh.eid = S.eid;
  Object.assign(S, fresh);
}

function emit(S, t, data = {}) {
  S.ev.push({ id: ++S.eid, t, ...data });
}

const isGrounded = (f) => f.y <= 0;
const actionable = (f) => f.s === "idle" || f.s === "walk" || f.s === "crouch";
const backBtn = (f, o) => (o.x > f.x ? BTN.L : BTN.R);

function hurtBox(f) {
  if (f.s === "down" || f.s === "ko" || f.inv > 0) return null;
  const crouching = f.s === "crouch" || (f.s === "atk" && f.mv === "cpunch") ||
    (f.s === "blockstun" && f.h & BTN.D);
  let y0 = f.y, y1 = f.y + 68;
  if (crouching) y1 = f.y + 48;
  if (!isGrounded(f)) { y0 = f.y + 4; y1 = f.y + 58; }
  return { x0: f.x - HURT_W, x1: f.x + HURT_W, y0, y1 };
}

function hitBox(f) {
  if (f.s !== "atk" && f.s !== "jatk") return null;
  const m = MOVES[f.mv];
  if (!m || !m.dmg || f.hit) return null;
  if (f.st < m.s || f.st >= m.s + m.a) return null;
  const a = f.x + f.fc * m.rx[0], b = f.x + f.fc * m.rx[1];
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: f.y + m.ry[0], y1: f.y + m.ry[1] };
}

const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// Is the opponent (or one of their projectiles) threatening f right now?
function threatened(S, f, o, oi) {
  if ((o.s === "atk" || o.s === "jatk") && Math.abs(o.x - f.x) < 110) return true;
  return S.pr.some((p) => p.o === oi && Math.abs(p.x - f.x) < 150 && Math.sign(f.x - p.x) === Math.sign(p.vx));
}

function startAttack(S, f, mv) {
  f.s = "atk";
  f.mv = mv;
  f.st = 0;
  f.hit = false;
  f.vx = 0;
  f.g = false;
  emit(S, "swing", { mv, c: f.c, x: f.x });
}

function updateFighter(S, i, inp) {
  const f = S.f[i], o = S.f[1 - i];
  const held = inp.h;
  f.h = held;
  f.st++;
  if (f.inv > 0) f.inv--;

  switch (f.s) {
    case "idle":
    case "walk":
    case "crouch": {
      if (!S.control) {
        f.s = "idle"; f.vx = 0; f.g = false;
        break;
      }
      f.fc = o.x >= f.x ? 1 : -1;
      const back = backBtn(f, o);
      const down = held & BTN.D;
      if (f.buf) {
        const b = f.buf;
        f.buf = 0;
        if (b & BTN.S && !S.pr.some((p) => p.o === i)) { startAttack(S, f, "special"); break; }
        if (b & (BTN.P | BTN.K)) {
          startAttack(S, f, down ? "cpunch" : b & BTN.K ? "kick" : "punch");
          break;
        }
      }
      if (held & BTN.U) {
        f.s = "jump"; f.st = 0; f.vy = JUMP_V; f.g = false;
        f.vx = held & BTN.R && !(held & BTN.L) ? JUMP_VX : held & BTN.L && !(held & BTN.R) ? -JUMP_VX : 0;
        emit(S, "jump", { x: f.x });
        break;
      }
      const guarding = !!(held & back) && threatened(S, f, o, 1 - i);
      f.g = guarding;
      if (down) {
        if (f.s !== "crouch") f.st = 0;
        f.s = "crouch"; f.vx = 0;
      } else {
        const dir = (held & BTN.R ? 1 : 0) - (held & BTN.L ? 1 : 0);
        if (dir && !guarding) {
          if (f.s !== "walk") f.st = 0;
          f.s = "walk";
          f.vx = dir * (dir === f.fc ? WALK_F : WALK_B);
        } else {
          if (f.s !== "idle") f.st = 0;
          f.s = "idle"; f.vx = 0;
        }
      }
      break;
    }
    case "jump":
      if (f.buf & (BTN.P | BTN.K) && f.y > 8) {
        f.buf = 0;
        f.s = "jatk"; f.mv = "jkick"; f.st = 0; f.hit = false;
        emit(S, "swing", { mv: "jkick", c: f.c, x: f.x });
      }
      break;
    case "jatk":
      break;
    case "atk": {
      const m = MOVES[f.mv];
      if (f.mv === "special" && f.st === m.s) {
        S.pr.push({ o: i, c: f.c, x: f.x + f.fc * 28, y: PROJ.y, vx: f.fc * PROJ.speed, t: 0 });
        emit(S, "proj", { c: f.c, x: f.x });
      }
      if (f.st >= m.s + m.a + m.r) {
        f.s = f.mv === "cpunch" && held & BTN.D ? "crouch" : "idle";
        f.st = 0; f.mv = "";
      }
      break;
    }
    case "hit":
    case "blockstun":
      f.vx *= 0.82;
      if (f.st >= f.stun) { f.s = "idle"; f.st = 0; f.cb = 0; }
      break;
    case "land":
      f.vx = 0;
      if (f.st >= 4) { f.s = "idle"; f.st = 0; }
      break;
    case "down":
      f.vx *= 0.8;
      if (f.st >= 34) { f.s = "getup"; f.st = 0; f.inv = 22; }
      break;
    case "getup":
      if (f.st >= 16) { f.s = "idle"; f.st = 0; }
      break;
    case "win":
    case "ko":
    case "fall":
      break;
  }

  // physics
  if (f.s === "jump" || f.s === "jatk" || f.s === "fall" || (f.s === "ko" && (f.y > 0 || f.vy > 0))) {
    f.x += f.vx;
    f.y += f.vy;
    f.vy -= GRAV;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.s === "fall") { f.s = "down"; f.st = 0; emit(S, "thud", { x: f.x }); }
      else if (f.s === "ko") { f.vx = 0; emit(S, "thud", { x: f.x, big: true }); }
      else { f.s = "land"; f.st = 0; f.vx = 0; emit(S, "land", { x: f.x }); }
    }
  } else {
    f.x += f.vx;
  }
}

function separate(S) {
  const [a, b] = S.f;
  for (const f of S.f) f.x = Math.max(MIN_X, Math.min(MAX_X, f.x));
  const dx = b.x - a.x;
  if (Math.abs(dx) < PUSH_W && Math.abs(a.y - b.y) < 50 && a.s !== "ko" && b.s !== "ko") {
    const push = (PUSH_W - Math.abs(dx)) / 2;
    const s = dx === 0 ? (a.fc > 0 ? 1 : -1) : Math.sign(dx);
    a.x -= s * push;
    b.x += s * push;
  }
  const spread = b.x - a.x;
  if (Math.abs(spread) > MAX_SPREAD) {
    const over = (Math.abs(spread) - MAX_SPREAD) / 2;
    const s = Math.sign(spread);
    a.x += s * over;
    b.x -= s * over;
  }
  for (const f of S.f) f.x = Math.max(MIN_X, Math.min(MAX_X, f.x));
}

function canBlock(S, d, srcX) {
  if (!isGrounded(d)) return false;
  if (!(actionable(d) || d.s === "blockstun")) return false;
  const back = srcX > d.x ? BTN.L : BTN.R;
  return !!(d.h & back);
}

function applyHit(S, ai, di, { dmg, hs, bs, kb, heavy, srcX, hx, hy, proj, chip }) {
  const a = S.f[ai], d = S.f[di];
  const dir = d.x >= srcX ? 1 : -1;
  if (canBlock(S, d, srcX)) {
    d.s = "blockstun"; d.st = 0; d.stun = bs; d.vx = dir * kb * 0.9; d.g = true;
    if (chip) d.hp = Math.max(1, d.hp - chip);
    S.hs = 5;
    emit(S, "block", { x: hx, y: hy, d: di });
    if (d.x <= MIN_X + 1 || d.x >= MAX_X - 1) a.vx = -dir * kb * 0.6;
    return;
  }
  const comboing = d.s === "hit" || d.s === "fall";
  a.cb = comboing ? a.cb + 1 : 1;
  const scale = Math.pow(0.85, Math.max(0, a.cb - 1));
  const amount = Math.round(dmg * scale);
  d.hp = Math.max(0, d.hp - amount);
  d.g = false;
  d.mv = "";
  if (d.hp <= 0) {
    d.s = "ko"; d.st = 0; d.vy = 5.5; d.vx = dir * 2.6; d.y = Math.max(d.y, 1);
    S.hs = 14;
    emit(S, "hit", { x: hx, y: hy, dmg: amount, heavy: true, cb: a.cb, d: di, proj });
    emit(S, "ko", { d: di });
    S.ph = "ko"; S.pt = 0; S.sm = 90; S.control = false;
    return;
  }
  if (!isGrounded(d) || (proj && d.s === "jump")) {
    d.s = "fall"; d.st = 0; d.vy = 4; d.vx = dir * 2.6; d.y = Math.max(d.y, 1);
  } else {
    d.s = "hit"; d.st = 0; d.stun = hs; d.vx = dir * kb;
  }
  S.hs = heavy ? 11 : 8;
  if (d.x <= MIN_X + 1 || d.x >= MAX_X - 1) a.vx = -dir * kb * 0.6;
  emit(S, "hit", { x: hx, y: hy, dmg: amount, heavy, cb: a.cb, d: di, proj });
}

function resolveHits(S) {
  const results = [];
  for (let i = 0; i < 2; i++) {
    const a = S.f[i], d = S.f[1 - i];
    const hb = hitBox(a);
    const hu = hurtBox(d);
    if (hb && hu && overlap(hb, hu)) results.push(i);
  }
  for (const i of results) {
    const a = S.f[i];
    const m = MOVES[a.mv];
    a.hit = true;
    const hb = hitBox({ ...a, hit: false });
    const hx = a.fc > 0 ? Math.min(hb.x1, S.f[1 - i].x) : Math.max(hb.x0, S.f[1 - i].x);
    applyHit(S, i, 1 - i, { dmg: m.dmg, hs: m.hs, bs: m.bs, kb: m.kb, heavy: m.heavy, srcX: a.x,
      hx, hy: (hb.y0 + hb.y1) / 2 });
  }
}

function updateProjectiles(S) {
  for (const p of S.pr) { p.x += p.vx; p.t++; }
  // clash
  for (let i = 0; i < S.pr.length; i++) {
    for (let j = i + 1; j < S.pr.length; j++) {
      const a = S.pr[i], b = S.pr[j];
      if (a.o !== b.o && !a.dead && !b.dead && Math.abs(a.x - b.x) < 16) {
        a.dead = b.dead = true;
        emit(S, "clash", { x: (a.x + b.x) / 2, y: PROJ.y });
      }
    }
  }
  for (const p of S.pr) {
    if (p.dead) continue;
    if (p.x < -30 || p.x > W + 30) { p.dead = true; continue; }
    const di = 1 - p.o;
    const d = S.f[di];
    const hu = hurtBox(d);
    const box = { x0: p.x - PROJ.r, x1: p.x + PROJ.r, y0: p.y - PROJ.r, y1: p.y + PROJ.r };
    if (hu && overlap(box, hu) && S.ph === "fight") {
      p.dead = true;
      applyHit(S, p.o, di, { dmg: PROJ.dmg, hs: PROJ.hs, bs: PROJ.bs, kb: 4, heavy: true, srcX: p.x - p.vx * 4,
        hx: p.x, hy: p.y, proj: p.c, chip: PROJ.chip });
    }
  }
  S.pr = S.pr.filter((p) => !p.dead);
}

function endRound(S) {
  const [a, b] = S.f;
  if (a.hp > b.hp) a.w++;
  else if (b.hp > a.hp) b.w++;
  else { a.w++; b.w++; }
}

function roundLogic(S) {
  S.pt++;
  switch (S.ph) {
    case "intro": {
      // the first round opens with a VS splash before the announcer
      const o = S.rd === 1 ? VS_TICKS : 0;
      if (S.pt === 1 + o) emit(S, "round", { n: S.rd, final: S.f[0].w === WINS_NEEDED - 1 && S.f[1].w === WINS_NEEDED - 1 });
      if (S.pt === 80 + o) emit(S, "fight");
      if (S.pt >= 96 + o) { S.ph = "fight"; S.pt = 0; S.control = true; }
      break;
    }
    case "fight":
      S.tf++;
      if (S.tf >= FPS) {
        S.tf = 0;
        S.tm--;
        if (S.tm <= 0) {
          S.tm = 0;
          S.ph = "timeup"; S.pt = 0; S.control = false;
          emit(S, "timeup");
        }
      }
      break;
    case "ko":
    case "timeup":
      if (S.pt === 110) {
        const [a, b] = S.f;
        const winner = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
        for (let i = 0; i < 2; i++) {
          const f = S.f[i];
          if (f.s === "ko") continue;
          if (winner === i) { f.s = "win"; f.st = 0; f.vx = 0; f.fc = S.f[1 - i].x >= f.x ? 1 : -1; }
          else if (S.ph === "timeup") { f.s = "hit"; f.st = 0; f.stun = 9999; }
        }
        emit(S, "roundwin", { p: winner });
      }
      if (S.pt >= 230) {
        endRound(S);
        const [a, b] = S.f;
        if (a.w >= WINS_NEEDED || b.w >= WINS_NEEDED) {
          S.ph = "end"; S.pt = 0;
          S.winner = a.w > b.w ? 0 : b.w > a.w ? 1 : -1;
          emit(S, "matchwin", { p: S.winner });
        } else {
          S.rd++;
          resetRound(S);
        }
      }
      break;
    case "end":
      break;
  }
}

// inputs: [{h: heldMask, p: pressedMask}, {...}]
export function step(S, inputs) {
  S.k++;
  for (let i = 0; i < 2; i++) {
    const f = S.f[i];
    const pressed = inputs[i].p & ATTACK_BTNS;
    if (pressed) { f.buf = pressed; f.bufT = 8; }
    else if (f.buf && --f.bufT <= 0) f.buf = 0;
  }
  roundLogic(S);
  if (S.hs > 0) { S.hs--; return; }
  if (S.sm > 0) {
    S.sm--;
    if (S.sm % 3 !== 0) return;
  }
  // facing for grounded, neutral fighters is set in updateFighter; land→face too
  for (let i = 0; i < 2; i++) updateFighter(S, i, inputs[i]);
  separate(S);
  if (S.ph === "fight") resolveHits(S);
  updateProjectiles(S);
}

// Compact snapshot for the network.
export function snapshot(S, events) {
  const r = (v) => Math.round(v * 10) / 10;
  return {
    k: S.k, ph: S.ph, pt: S.pt, rd: S.rd, tm: S.tm, hs: S.hs, sm: S.sm, wn: S.winner,
    f: S.f.map((f) => ({ c: f.c, x: r(f.x), y: r(f.y), fc: f.fc, hp: f.hp, s: f.s, st: f.st, mv: f.mv,
      cb: f.cb, w: f.w, g: f.g ? 1 : 0, inv: f.inv, h: f.h })),
    pr: S.pr.map((p) => ({ o: p.o, c: p.c, x: r(p.x), y: p.y, vx: p.vx, t: p.t })),
    ev: events,
  };
}
