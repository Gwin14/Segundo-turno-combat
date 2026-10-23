// Canvas renderer + "director": turns simulation snapshots and events into
// sprites, particles, screen shake, flashes, HUD and sound.
import { MOVES, MAX_HP, ROUND_TIME, VS_TICKS, CHAR_NAMES, BTN } from "/shared/sim.js";
import { sfx, announce, playMusic, setCrowd } from "./audio.js";

export const VW = 480;
export const VH = 270;
const GROUND = 240;
const FONT = "'Press Start 2P', monospace";
const FX = { hit: [0, 4], block: [4, 3], dust: [7, 4], super: [11, 4] };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function whiteVersion(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class Renderer {
  constructor(canvas, assets) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.A = assets;
    this.white = { lula: whiteVersion(assets.lula), flavio: whiteVersion(assets.flavio) };
    this.reset();
  }

  reset() {
    this.parts = [];
    this.sprites = [];
    this.texts = [];
    this.banners = [];
    this.combo = [null, null];
    this.flash = [0, 0];
    this.trail = [[], []];
    this.dispHp = [MAX_HP, MAX_HP];
    this.trailHp = [MAX_HP, MAX_HP];
    this.trailDelay = [0, 0];
    this.shake = 0;
    this.screenFlash = 0;
    this.flashColor = "#fff";
    this.zoom = 1;
    this.zoomT = 0;
    this.zoomFocus = 240;
    this.camX = 80;
    this.hype = 0;
    this.time = 0;
    this.persistent = null;
    this.lastTimer = ROUND_TIME;
  }

  // ---------------------------------------------------------------- events
  onEvent(e, v) {
    const F = v.f;
    switch (e.t) {
      case "swing":
        sfx.whoosh(e.mv === "kick" || e.mv === "jkick");
        if (e.mv === "kick") this.dust(e.x, 0.6);
        break;
      case "jump":
        sfx.jump();
        this.dust(e.x, 0.8);
        break;
      case "land":
        sfx.land();
        this.dust(e.x, 0.8);
        break;
      case "thud":
        sfx.thud(e.big);
        this.dust(e.x - 12, 1.2);
        this.dust(e.x + 12, 1.2);
        this.addShake(e.big ? 7 : 4);
        break;
      case "proj": {
        const f = F.find((q) => q.c === e.c) || F[0];
        const hx = f.x + f.fc * 28;
        this.spriteFx("super", hx, 56, { fps: 30, scale: 1.2 });
        sfx.power();
        if (e.c === "lula") { sfx.sizzle(); announce("Picanha!", { interrupt: false, pitch: 1 }); }
        else { sfx.kickball(); announce("Bolada!", { interrupt: false, pitch: 1 }); }
        this.texts.push({ x: f.x, y: 92, text: e.c === "lula" ? "PICANHA!" : "BOLADA!", t: 0, dur: 50,
          color: e.c === "lula" ? "#ff6b4a" : "#7dff8a", size: 8, vy: -0.4 });
        break;
      }
      case "hit": {
        const heavy = e.heavy;
        const d = F[e.d];
        const dir = d && F[1 - e.d] ? Math.sign(d.x - F[1 - e.d].x) || 1 : 1;
        this.spriteFx("hit", e.x, e.y, { fps: 30, scale: heavy ? 1.4 : 1, add: true });
        this.sparks(e.x, e.y, dir, heavy ? 22 : 12, ["#ffffff", "#ffe45c", "#ff9a2e"]);
        this.flash[e.d] = 6;
        this.addShake(heavy ? 6 : 3);
        sfx.hit(heavy);
        this.hype = heavy ? 90 : 50;
        sfx.crowd(heavy ? 0.3 : 0.18, 1.2);
        this.texts.push({ x: e.x + rand(-6, 6), y: e.y + 10, text: String(e.dmg), t: 0, dur: 45,
          color: heavy ? "#ff5a3c" : "#ffe45c", size: 8, vy: 0.7 });
        if (e.proj === "lula") { sfx.splat(); this.sparks(e.x, e.y, dir, 16, ["#7a3a1a", "#c0392b", "#f4d29a"], true); }
        if (e.proj === "flavio") { sfx.boing(); this.sparks(e.x, e.y, -dir, 8, ["#ffffff", "#cccccc"], true); }
        if (e.cb >= 2) {
          const a = 1 - e.d;
          this.combo[a] = { n: e.cb, t: 0 };
          if (e.cb >= 3) sfx.stinger();
        }
        break;
      }
      case "block": {
        const d = F[e.d];
        const flip = d && d.x > F[1 - e.d].x;
        this.spriteFx("block", e.x, e.y, { fps: 24, flip: !flip, scale: 1.1, add: true });
        this.sparks(e.x, e.y, flip ? 1 : -1, 8, ["#9ae8ff", "#ffffff"]);
        this.addShake(2);
        sfx.block();
        break;
      }
      case "clash":
        this.spriteFx("super", e.x, e.y, { fps: 20, scale: 2, add: true });
        this.sparks(e.x, e.y, 1, 14, ["#ffb0f0", "#ffffff", "#c050ff"]);
        this.sparks(e.x, e.y, -1, 14, ["#ffb0f0", "#ffffff", "#c050ff"]);
        this.screenFlash = 0.5;
        this.flashColor = "#ffd6ff";
        this.addShake(5);
        sfx.clash();
        break;
      case "ko": {
        sfx.ko();
        this.screenFlash = 1;
        this.flashColor = "#ffffff";
        this.addShake(10);
        this.zoomT = 120;
        this.zoomFocus = F[e.d] ? F[e.d].x : 320;
        this.banner("K.O.!", { color: ["#ff6a3c", "#c01818"], size: 40, dur: 150 });
        announce("Nocaute!", { pitch: 0.5, rate: 0.9 });
        sfx.crowd(0.6, 3);
        for (let i = 0; i < 40; i++) this.confetti(rand(0, 640), rand(-60, 0));
        break;
      }
      case "round":
        sfx.gong();
        this.persistent = null;
        this.banner(e.final ? "ROUND FINAL" : `ROUND ${e.n}`, { color: ["#ffffff", "#ffd23c"], size: 24, dur: 75 });
        announce(e.final ? "Round final!" : `Round ${e.n}!`, { pitch: 0.55 });
        setCrowd(0.03);
        break;
      case "fight":
        sfx.stinger();
        this.banner("LUTEM!", { color: ["#fff36b", "#ff7a1a"], size: 40, dur: 55, punch: true });
        announce("Lutem!", { pitch: 0.6, rate: 1.1 });
        playMusic("fight");
        sfx.crowd(0.35, 1.5);
        setCrowd(0.05);
        break;
      case "timeup":
        this.banner("TEMPO!", { color: ["#ffffff", "#7ac8ff"], size: 32, dur: 110 });
        announce("Tempo esgotado!", { pitch: 0.55 });
        sfx.gong();
        break;
      case "roundwin": {
        if (e.p < 0) {
          this.banner("EMPATE", { color: ["#ffffff", "#bbbbbb"], size: 24, dur: 100, y: 120 });
          announce("Empate!", { interrupt: false });
        } else {
          const name = CHAR_NAMES[F[e.p].c];
          this.banner(`${name} VENCE`, { color: ["#ffffff", "#ffd23c"], size: 16, dur: 110, y: 128 });
          announce(`${name === "LULA" ? "Lula" : "Flávio"} vence!`, { interrupt: false, pitch: 0.6 });
          for (let i = 0; i < 30; i++) this.confetti(F[e.p].x + rand(-40, 40), 150 + rand(0, 40));
        }
        break;
      }
      case "matchwin": {
        sfx.victory();
        playMusic("menu");
        setCrowd(0.08);
        sfx.crowd(0.5, 4);
        const text = e.p < 0 ? "EMPATE!" : `${CHAR_NAMES[F[e.p].c]} VENCEU!`;
        this.persistent = { text, t: 0 };
        if (e.p >= 0) announce(`${F[e.p].c === "lula" ? "Lula" : "Flávio"} é o grande vencedor!`, { pitch: 0.55 });
        this.confettiRain = 240;
        break;
      }
    }
  }

  addShake(m) { this.shake = Math.max(this.shake, m); }

  banner(text, opts) {
    this.banners = this.banners.filter((b) => b.y !== (opts.y || 110));
    this.banners.push({ text, t: 0, dur: 80, size: 32, color: ["#fff", "#fd3"], y: 110, ...opts });
  }

  spriteFx(kind, x, y, { fps = 24, flip = false, scale = 1, add = false } = {}) {
    const [f0, n] = FX[kind];
    this.sprites.push({ f0, n, x, y, t: 0, fps, flip, scale, add });
  }

  dust(x, s = 1) {
    this.spriteFx("dust", x, 12, { fps: 16, scale: s });
  }

  sparks(x, y, dir, n, colors, blob = false) {
    for (let i = 0; i < n; i++) {
      const a = rand(-1.1, 1.1) + (dir < 0 ? Math.PI : 0);
      const sp = rand(1.5, blob ? 3.5 : 6);
      this.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (blob ? 2 : 1), life: 0, max: rand(14, 30),
        color: colors[i % colors.length], size: blob ? rand(1.5, 3) : rand(1, 2), grav: blob ? 0.25 : 0.12,
        type: blob ? "blob" : "spark",
      });
    }
  }

  confetti(x, y) {
    const cols = ["#1fa04c", "#f8d43a", "#2a44a0", "#ffffff", "#e0302c"];
    this.parts.push({ x, y: 270 - y, vx: rand(-1, 1), vy: rand(-0.5, 2.5), life: 0, max: rand(90, 160),
      color: cols[Math.floor(Math.random() * cols.length)], size: 2, grav: 0.04, type: "confetti", ph: rand(0, 6) });
  }

  // ---------------------------------------------------------------- frames
  frameFor(f, v) {
    const tags = this.A.meta[f.c].tags;
    const T = (name, i = 0) => {
      const [a, b] = tags[name];
      return a + clamp(i, 0, b - a);
    };
    const guardOk = f.s === "idle" || f.s === "walk" || f.s === "crouch";
    if (f.s === "blockstun" || (f.g && guardOk)) return T("block");
    switch (f.s) {
      case "idle": return T("idle", Math.floor(f.st / 9) % 4);
      case "walk": {
        const fwd = f.h & (f.fc > 0 ? BTN.R : BTN.L);
        const i = Math.floor(f.st / 7) % 4;
        return T("walk", fwd ? i : 3 - i);
      }
      case "crouch": return T("crouch");
      case "land": return T("crouch");
      case "jump": return T("jump", f.st < 8 ? 0 : f.st < 26 ? 1 : 2);
      case "jatk": return T("jkick");
      case "atk": {
        const m = MOVES[f.mv];
        if (!m) return T("idle");
        if (f.mv === "cpunch") return T("cpunch");
        const tag = f.mv;
        if (f.st < m.s) return T(tag, 0);
        if (f.st < m.s + m.a + Math.floor(m.r / 2)) return T(tag, 1);
        return T(tag, 2);
      }
      case "hit": return T("hit", f.st < 5 ? 0 : 1);
      case "fall": return T("ko", f.st < 12 ? 0 : 1);
      case "down": return T("ko", 2);
      case "getup": return T("crouch");
      case "ko":
        if (f.y > 0) return T("ko", f.st < 12 ? 0 : 1);
        return T("ko", 2);
      case "win": return T("win", Math.floor(f.st / 16) % 2);
    }
    return T("idle");
  }

  drawFighter(ctx, f, i, v, viewX) {
    const meta = this.A.meta[f.c];
    const fi = this.frameFor(f, v);
    let sx = Math.round(f.x - viewX);
    const sy = Math.round(GROUND - f.y);
    if (v.hs > 0 && (f.s === "hit" || f.s === "blockstun" || f.s === "fall" || f.s === "ko")) sx += (v.k % 2 ? 2 : -2);
    if (f.inv > 0 && f.s !== "getup" && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.5;
    if (f.s === "getup" && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.6;
    const img = this.flash[i] > 3 ? this.white[f.c] : this.A[f.c];
    this.blit(ctx, img, fi, meta, sx, sy, f.fc);
    if (this.flash[i] > 0 && this.flash[i] <= 3) {
      ctx.globalAlpha = 0.5;
      this.blit(ctx, this.white[f.c], fi, meta, sx, sy, f.fc);
    }
    ctx.globalAlpha = 1;
  }

  blit(ctx, img, fi, meta, sx, sy, fc) {
    const { frameW: fw, frameH: fh, anchorX: ax, anchorY: ay } = meta;
    if (fc > 0) {
      ctx.drawImage(img, fi * fw, 0, fw, fh, sx - ax, sy - ay, fw, fh);
    } else {
      ctx.save();
      ctx.translate(sx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, fi * fw, 0, fw, fh, -ax, sy - ay, fw, fh);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- draw
  draw(v, dt, opts = {}) {
    const ctx = this.ctx;
    this.time += dt;
    const steps = dt * 60;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // camera
    const mid = (v.f[0].x + v.f[1].x) / 2;
    const target = clamp(mid - VW / 2, 0, 640 - VW);
    this.camX = lerp(this.camX, target, 1 - Math.pow(0.001, dt));
    if (this.zoomT > 0) { this.zoomT -= steps; this.zoom = lerp(this.zoom, 1.3, 0.08); }
    else this.zoom = lerp(this.zoom, 1, 0.06);
    this.shake *= Math.pow(0.86, steps);
    const shx = this.shake > 0.3 ? rand(-this.shake, this.shake) : 0;
    const shy = this.shake > 0.3 ? rand(-this.shake, this.shake) * 0.6 : 0;
    const viewX = Math.round(this.camX);

    ctx.save();
    // zoom around the focus point near the ground
    if (this.zoom > 1.001) {
      const fx = clamp(this.zoomFocus - viewX, 120, 360);
      ctx.translate(fx, 200);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-fx, -200);
    }
    ctx.translate(Math.round(shx), Math.round(shy));

    // background layers
    ctx.drawImage(this.A.sky, -8, -8, VW + 16, VH + 16);
    ctx.drawImage(this.A.far, -Math.round(viewX * 0.5), 0);
    if (this.hype > 0) this.hype -= steps;
    const crowdFrame = Math.floor(this.time * (this.hype > 0 ? 10 : 3.5)) % 2;
    ctx.drawImage(this.A.near, 0, crowdFrame * 270, 640, 270, -viewX, 0, 640, 270);

    // shadows
    for (const f of v.f) {
      const s = clamp(1 - f.y / 140, 0.4, 1);
      ctx.fillStyle = "rgba(20,8,30,0.45)";
      ctx.beginPath();
      ctx.ellipse(f.x - viewX, GROUND + 1, 16 * s, 3.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of v.pr) {
      ctx.fillStyle = "rgba(20,8,30,0.35)";
      ctx.beginPath();
      ctx.ellipse(p.x - viewX, GROUND + 1, 7, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // afterimage trails
    v.f.forEach((f, i) => {
      const tr = this.trail[i];
      const showTrail = f.s === "jatk" || (f.s === "atk" && (f.mv === "special" || f.mv === "kick")) || f.s === "fall" || (f.s === "ko" && f.y > 0);
      tr.push({ x: f.x, y: f.y, fi: this.frameFor(f, v), fc: f.fc });
      if (tr.length > 8) tr.shift();
      if (showTrail) {
        const meta = this.A.meta[f.c];
        for (let k = 0; k < tr.length - 1; k += 2) {
          const g = tr[k];
          ctx.globalAlpha = 0.12 + k * 0.03;
          this.blit(ctx, this.white[f.c], g.fi, meta, Math.round(g.x - viewX), Math.round(GROUND - g.y), g.fc);
        }
        ctx.globalAlpha = 1;
      }
    });

    // fighters: the one attacking is drawn on top
    const order = [0, 1].sort((a, b) => (v.f[a].s === "atk" || v.f[a].s === "jatk" ? 1 : 0) - (v.f[b].s === "atk" || v.f[b].s === "jatk" ? 1 : 0));
    for (const i of order) this.drawFighter(ctx, v.f[i], i, v, viewX);
    for (let i = 0; i < 2; i++) if (this.flash[i] > 0) this.flash[i] -= steps;

    // projectiles
    for (const p of v.pr) {
      const sx = Math.round(p.x - viewX), sy = Math.round(GROUND - p.y);
      let fi;
      if (p.c === "lula") {
        fi = Math.floor(p.t / 6) % 2;
        if (Math.random() < 0.6 * steps) this.parts.push({ x: p.x - Math.sign(p.vx) * 10, y: p.y + rand(-3, 5), vx: -p.vx * 0.1, vy: rand(0.3, 0.9),
          life: 0, max: rand(14, 26), color: Math.random() < 0.5 ? "#ff9a2e" : "#ffd36b", size: rand(1, 2.5), grav: -0.02, type: "ember" });
      } else {
        fi = 2 + ((Math.floor(p.t / 3) % 4) + 4) % 4;
        if (Math.random() < 0.5 * steps) this.parts.push({ x: p.x - Math.sign(p.vx) * 8, y: p.y + rand(-5, 5), vx: -p.vx * 0.3, vy: 0,
          life: 0, max: 10, color: "#ffffff", size: 1, grav: 0, type: "line" });
      }
      ctx.save();
      ctx.translate(sx, sy);
      if (p.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(this.A.proj, fi * 32, 0, 32, 32, -16, -16, 32, 32);
      ctx.restore();
    }

    // sprite effects
    this.sprites = this.sprites.filter((s) => {
      s.t += dt;
      const fr = Math.floor(s.t * s.fps);
      if (fr >= s.n) return false;
      const sz = 48 * s.scale;
      ctx.save();
      if (s.add) ctx.globalCompositeOperation = "lighter";
      ctx.translate(Math.round(s.x - viewX), Math.round(GROUND - s.y));
      if (s.flip) ctx.scale(-1, 1);
      ctx.drawImage(this.A.fx, (s.f0 + fr) * 48, 0, 48, 48, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
      return true;
    });

    // particles
    if (this.confettiRain > 0) {
      this.confettiRain -= steps;
      if (Math.random() < 0.8) this.confetti(viewX + rand(0, VW), -10);
    }
    this.parts = this.parts.filter((p) => {
      p.life += steps;
      if (p.life > p.max) return false;
      p.x += p.vx * steps;
      p.y += p.vy * steps;
      p.vy -= p.grav * steps;
      p.vx *= Math.pow(0.97, steps);
      const a = 1 - p.life / p.max;
      const sx = p.x - viewX, sy = GROUND - p.y;
      ctx.globalAlpha = clamp(a * 1.4, 0, 1);
      ctx.fillStyle = p.color;
      if (p.type === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - p.vx * 2, sy + p.vy * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (p.type === "line") {
        ctx.fillRect(Math.round(sx), Math.round(sy), 6, 1);
      } else if (p.type === "confetti") {
        p.ph += 0.2 * steps;
        p.vx = Math.sin(p.ph) * 0.8;
        p.vy = Math.max(p.vy, -0.9);
        ctx.fillRect(Math.round(sx), Math.round(sy), Math.abs(Math.cos(p.ph)) * 3 + 1, 2);
      } else {
        ctx.fillRect(Math.round(sx), Math.round(sy), Math.ceil(p.size), Math.ceil(p.size));
      }
      ctx.globalAlpha = 1;
      return true;
    });

    // floating texts in world space
    this.texts = this.texts.filter((t) => {
      t.t += steps;
      if (t.t > t.dur) return false;
      const a = t.t < t.dur * 0.7 ? 1 : 1 - (t.t - t.dur * 0.7) / (t.dur * 0.3);
      const pop = t.t < 6 ? 1 + (6 - t.t) / 6 : 1;
      ctx.globalAlpha = a;
      this.text(ctx, t.text, t.x - viewX, GROUND - t.y - t.t * t.vy, { size: t.size * pop, color: t.color });
      ctx.globalAlpha = 1;
      return true;
    });

    ctx.restore();

    if (opts.hud !== false) this.drawHud(ctx, v, steps, opts, viewX);

    // banners
    this.banners = this.banners.filter((b) => {
      b.t += steps;
      if (b.t > b.dur) return false;
      let sc = 1;
      if (b.t < 8) sc = 1 + Math.pow((8 - b.t) / 8, 2) * 1.6;
      else if (b.t < 12) sc = 1 - (b.t - 8) * 0.015;
      const out = b.t > b.dur - 10 ? (b.t - (b.dur - 10)) / 10 : 0;
      ctx.globalAlpha = 1 - out;
      this.bigText(ctx, b.text, VW / 2, b.y, b.size * sc, b.color);
      ctx.globalAlpha = 1;
      return true;
    });
    if (this.persistent) {
      this.persistent.t += steps;
      const sc = this.persistent.t < 10 ? 1 + (10 - this.persistent.t) / 10 : 1 + Math.sin(this.time * 4) * 0.03;
      this.bigText(ctx, this.persistent.text, VW / 2, 100, 24 * sc, ["#ffffff", "#ffd23c"]);
    }

    // VS splash at the start of the match
    if (v.ph === "intro" && v.rd === 1 && v.pt < VS_TICKS + 2 && opts.hud !== false) this.drawVs(ctx, v);

    if (this.screenFlash > 0) {
      ctx.globalAlpha = clamp(this.screenFlash, 0, 1);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
      this.screenFlash -= 0.06 * steps;
    }
  }

  drawHud(ctx, v, steps, opts) {
    const F = v.f;
    for (let i = 0; i < 2; i++) {
      const hp = F[i].hp;
      this.dispHp[i] = lerp(this.dispHp[i], hp, 0.5);
      // the red "damage taken" part lingers, then drains
      if (this.flash[i] > 4) this.trailDelay[i] = 32;
      this.trailDelay[i] -= steps;
      if (hp >= this.trailHp[i]) this.trailHp[i] = hp;
      else if (this.trailDelay[i] <= 0) this.trailHp[i] = Math.max(hp, lerp(this.trailHp[i], hp, 0.1 * steps));
    }

    const barW = 176, barH = 10, top = 12;
    const drawBar = (i) => {
      const left = i === 0;
      const x0 = left ? 30 : VW - 30 - barW;
      ctx.fillStyle = "#1b1420";
      ctx.fillRect(x0 - 2, top - 2, barW + 4, barH + 4);
      ctx.fillStyle = "#3a1c2a";
      ctx.fillRect(x0, top, barW, barH);
      const tw = (this.trailHp[i] / MAX_HP) * barW;
      const hw = (this.dispHp[i] / MAX_HP) * barW;
      // health hugs the timer in the middle
      const ax = (w) => (left ? x0 + barW - w : x0);
      ctx.fillStyle = "#e8402c";
      ctx.fillRect(ax(tw), top, tw, barH);
      const low = F[i].hp < MAX_HP * 0.25;
      const blink = low && Math.floor(this.time * 6) % 2;
      const g = ctx.createLinearGradient(0, top, 0, top + barH);
      g.addColorStop(0, blink ? "#ff8a6a" : "#fff4a0");
      g.addColorStop(0.4, blink ? "#ff4a2a" : "#ffd23c");
      g.addColorStop(1, blink ? "#a01818" : "#d08a10");
      ctx.fillStyle = g;
      ctx.fillRect(ax(hw), top, hw, barH);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(ax(hw), top + 1, hw, 1);
      // portrait
      const pimg = this.A[F[i].c + "_portrait"];
      const px = left ? 2 : VW - 26;
      ctx.fillStyle = "#1b1420";
      ctx.fillRect(px - 1, 3, 26, 26);
      ctx.fillStyle = left ? "#6a1830" : "#174a2a";
      ctx.fillRect(px, 4, 24, 24);
      if (left) ctx.drawImage(pimg, px, 4);
      else { ctx.save(); ctx.translate(px + 24, 4); ctx.scale(-1, 1); ctx.drawImage(pimg, 0, 0); ctx.restore(); }
      // name + round wins
      const name = CHAR_NAMES[F[i].c] + (opts.you === i ? " (VOCÊ)" : opts.cpu === i ? " (CPU)" : "");
      this.text(ctx, name, left ? x0 : x0 + barW, top + barH + 10, { size: 8, color: "#ffffff", align: left ? "left" : "right" });
      for (let w = 0; w < 2; w++) {
        const cx = left ? x0 + barW - 6 - w * 12 : x0 + 6 + w * 12;
        ctx.fillStyle = "#1b1420";
        ctx.beginPath(); ctx.arc(cx, top + barH + 8, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = w < F[i].w ? "#ffd23c" : "#4a3a52";
        ctx.beginPath(); ctx.arc(cx, top + barH + 8, 3, 0, Math.PI * 2); ctx.fill();
      }
    };
    drawBar(0);
    drawBar(1);

    // timer
    ctx.fillStyle = "#1b1420";
    ctx.fillRect(VW / 2 - 18, 6, 36, 26);
    ctx.fillStyle = "#2c1e3a";
    ctx.fillRect(VW / 2 - 16, 8, 32, 22);
    const urgent = v.tm <= 10 && v.ph === "fight";
    if (urgent && v.tm !== this.lastTimer) sfx.tick();
    this.lastTimer = v.tm;
    const tsc = urgent ? 1 + Math.max(0, 0.3 - (this.time % 1) * 0.6) : 1;
    this.text(ctx, String(v.tm).padStart(2, "0"), VW / 2, 26, { size: 16 * tsc, color: urgent ? "#ff5a3c" : "#ffffff", align: "center" });

    // combo counters
    for (let i = 0; i < 2; i++) {
      const c = this.combo[i];
      if (!c) continue;
      c.t += steps;
      if (c.t > 70) { this.combo[i] = null; continue; }
      const pop = c.t < 6 ? 1 + (6 - c.t) / 4 : 1;
      const x = i === 0 ? 40 : VW - 40;
      ctx.globalAlpha = c.t > 55 ? 1 - (c.t - 55) / 15 : 1;
      this.bigText(ctx, `${c.n}`, x, 92, 24 * pop, ["#ffffff", "#ff9a2e"]);
      this.text(ctx, "HITS!", x, 106, { size: 8, color: "#ffe45c", align: "center" });
      ctx.globalAlpha = 1;
    }

    // "you" marker
    const showMarker = (v.ph === "intro" && (v.rd > 1 || v.pt > VS_TICKS)) || (v.ph === "fight" && v.pt < 120);
    if (showMarker && opts.you != null && opts.you >= 0) {
      const f = F[opts.you];
      const x = Math.round(f.x - this.camX);
      const y = Math.round(GROUND - f.y - 84 + Math.sin(this.time * 8) * 2);
      this.text(ctx, "VOCÊ", x, y - 6, { size: 8, color: "#7dff8a", align: "center" });
      ctx.fillStyle = "#7dff8a";
      ctx.beginPath(); ctx.moveTo(x - 4, y - 2); ctx.lineTo(x + 4, y - 2); ctx.lineTo(x, y + 3); ctx.fill();
    }

    if (opts.ping != null) this.text(ctx, `${opts.ping}ms`, VW - 4, VH - 4, { size: 8, color: opts.ping > 150 ? "#ff8a6a" : "#9fe0a0", align: "right" });
  }

  drawVs(ctx, v) {
    const t = v.pt;
    const slide = clamp(1 - t / 16, 0, 1);
    const out = t > VS_TICKS - 12 ? (t - (VS_TICKS - 12)) / 12 : 0;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.fillStyle = "#120a1c";
    ctx.fillRect(0, 0, VW, VH);
    // diagonal halves
    const off = slide * 260;
    ctx.fillStyle = v.f[0].c === "lula" ? "#7a1424" : "#145a2e";
    ctx.beginPath(); ctx.moveTo(-off, 0); ctx.lineTo(VW / 2 + 30 - off, 0); ctx.lineTo(VW / 2 - 30 - off, VH); ctx.lineTo(-off, VH); ctx.fill();
    ctx.fillStyle = v.f[1].c === "lula" ? "#7a1424" : "#145a2e";
    ctx.beginPath(); ctx.moveTo(VW + off, 0); ctx.lineTo(VW / 2 + 34 + off, 0); ctx.lineTo(VW / 2 - 26 + off, VH); ctx.lineTo(VW + off, VH); ctx.fill();
    // speed lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 18; i++) {
      const y = (i * 37 + t * 9) % VH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y + 20); ctx.stroke();
    }
    // fighters, big
    for (let i = 0; i < 2; i++) {
      const c = v.f[i].c;
      const meta = this.A.meta[c];
      const fi = meta.tags.idle[0] + (Math.floor(t / 9) % 4);
      ctx.save();
      const x = i === 0 ? 110 - off : 370 + off;
      ctx.translate(x, 236);
      ctx.scale(i === 0 ? 2.4 : -2.4, 2.4);
      ctx.drawImage(this.A[c], fi * meta.frameW, 0, meta.frameW, meta.frameH, -meta.anchorX, -meta.anchorY, meta.frameW, meta.frameH);
      ctx.restore();
      this.bigText(ctx, CHAR_NAMES[c], i === 0 ? 110 - off : 370 + off, 40, 16, ["#ffffff", "#ffd23c"]);
    }
    const vsScale = t < 20 ? 0 : t < 28 ? 3 - (t - 20) / 4 : 1 + Math.sin(t * 0.3) * 0.05;
    if (vsScale > 0) this.bigText(ctx, "VS", VW / 2 + 2, 150, 40 * vsScale, ["#fff36b", "#ff3a1a"]);
    if (t === 20) sfx.hit(true);
    ctx.restore();
  }

  text(ctx, s, x, y, { size = 8, color = "#fff", align = "left" } = {}) {
    ctx.font = `${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(2, size / 3);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1420";
    ctx.strokeText(s, Math.round(x), Math.round(y));
    ctx.fillStyle = color;
    ctx.fillText(s, Math.round(x), Math.round(y));
  }

  bigText(ctx, s, x, y, size, [c1, c2]) {
    ctx.font = `${Math.round(size)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, size / 4);
    ctx.strokeStyle = "#1b1420";
    ctx.strokeText(s, x, y + 2);
    ctx.strokeText(s, x, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, c1);
    g.addColorStop(0.55, c2);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillText(s, x, y);
  }
}
