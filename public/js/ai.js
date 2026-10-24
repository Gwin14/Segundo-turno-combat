// Simple CPU opponent for training mode.
import { BTN } from "/shared/sim.js";

const LEVELS = {
  facil: { react: 22, block: 0.15, aggro: 0.35, special: 0.15, antiAir: 0.1 },
  normal: { react: 12, block: 0.45, aggro: 0.55, special: 0.25, antiAir: 0.4 },
  dificil: { react: 6, block: 0.75, aggro: 0.7, special: 0.35, antiAir: 0.75 },
};

export function makeCpu(level = "normal") {
  return { level, L: LEVELS[level] || LEVELS.normal, t: 0, hold: 0, press: 0, jumpAtk: false };
}

export function cpuInput(cpu, S, i) {
  const f = S.f[i], o = S.f[1 - i];
  const L = cpu.L;
  const toward = o.x > f.x ? BTN.R : BTN.L;
  const away = o.x > f.x ? BTN.L : BTN.R;
  const dist = Math.abs(o.x - f.x);
  let press = 0;

  // air kick near the opponent
  if (f.s === "jump" && dist < 70 && f.y > 20 && !cpu.jumpAtk) { cpu.jumpAtk = true; press = BTN.K; }
  if (f.s !== "jump") cpu.jumpAtk = false;

  if (--cpu.t <= 0) {
    cpu.t = L.react + Math.floor(Math.random() * L.react);
    const r = Math.random();
    const oAttacking = o.s === "atk" || o.s === "jatk";
    const incoming = S.pr.find((p) => p.o !== i && Math.abs(p.x - f.x) < 170 && Math.sign(f.x - p.x) === Math.sign(p.vx));
    const ownProj = S.pr.some((p) => p.o === i);
    cpu.hold = 0;
    if (incoming) {
      if (r < L.block) cpu.hold = Math.random() < 0.5 ? away : BTN.D;
      else if (r < L.block + 0.2) cpu.hold = BTN.U | toward;
      cpu.t = Math.min(cpu.t, 10);
    } else if (oAttacking && dist < 100 && r < L.block) {
      cpu.hold = away | (o.mv === "cpunch" ? BTN.D : 0);
      cpu.t = 14;
    } else if (o.y > 20 && dist < 90 && r < L.antiAir) {
      press = Math.random() < 0.5 ? BTN.P : BTN.K;
    } else if (dist > 160) {
      if (!ownProj && r < L.special) press = BTN.S;
      else cpu.hold = toward;
    } else if (dist > 55) {
      if (r < 0.12) cpu.hold = BTN.U | toward;
      else if (!ownProj && r < 0.12 + L.special * 0.5) press = BTN.S;
      else if (r < 0.85) cpu.hold = toward;
      else cpu.hold = away;
    } else {
      if (r < L.aggro) {
        const k = Math.random();
        if (k < 0.4) press = BTN.P;
        else if (k < 0.75) press = BTN.K;
        else { cpu.hold = BTN.D; press = BTN.P; }
        cpu.t = Math.min(cpu.t, 8);
      } else if (r < L.aggro + 0.2) cpu.hold = away;
      else cpu.hold = away;
    }
  }
  return { h: cpu.hold, p: press };
}
