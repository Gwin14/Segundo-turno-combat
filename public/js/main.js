import { createMatch, step, rematch, CHAR_NAMES } from "/shared/sim.js";
import { Renderer } from "./render.js";
import { initAudio, sfx, playMusic, toggleMute, isMuted, setCrowd } from "./audio.js";
import { readInput, setEnabled, setupTouch, releaseTouch } from "./input.js";
import { makeCpu, cpuInput } from "./ai.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const stageEl = $("#stage");
const canvas = $("#game");
const OTHER = { lula: "flavio", flavio: "lula" };
const TICK = 1 / 60;

// ------------------------------------------------------------------ layout
// The scene is always 270 logical pixels tall. Its width follows the screen
// (400..640, the arena width), so the canvas fills the window without bars;
// on tall screens (portrait phones) the canvas grows taller instead and the
// extra space holds the touch controls.
const SCENE_H = 270, MIN_W = 400, MAX_W = 640;
function fit() {
  const vv = window.visualViewport;
  const ww = Math.round(vv ? vv.width * vv.scale : window.innerWidth);
  const wh = Math.round(vv ? vv.height * vv.scale : window.innerHeight);
  const aspect = ww / wh;
  let W, H, sw = ww, sh = wh;
  if (aspect >= MIN_W / SCENE_H) {
    H = SCENE_H;
    W = Math.min(MAX_W, Math.round(SCENE_H * aspect));
    if (aspect > MAX_W / SCENE_H) sw = Math.round(wh * MAX_W / SCENE_H); // ultra-wide: thin side bars
  } else {
    W = MIN_W;
    H = Math.round(MIN_W / aspect);
  }
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  if (R) R.resize(W, H);
  stageEl.style.width = `${sw}px`;
  stageEl.style.height = `${sh}px`;
  stageEl.style.fontSize = `${Math.max(9, (sw / W) * 10)}px`;
  document.documentElement.classList.toggle("portrait", H > SCENE_H);
}
window.addEventListener("resize", fit);
window.addEventListener("orientationchange", () => setTimeout(fit, 200));
if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);

// Block pinch and double-tap zoom: iOS Safari ignores user-scalable=no, and a
// zoomed page has no way back since nothing scrolls.
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  const onControl = e.target.closest && e.target.closest("button, input, .card, #touch");
  if (now - lastTouchEnd < 350 && !onControl) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

// On phones, go fullscreen (and landscape where allowed) when a fight starts.
function enterFullscreen() {
  if (!document.documentElement.classList.contains("touch")) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
    try {
      const p = req.call(el, { navigationUI: "hide" });
      if (p && p.then) p.then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {});
    } catch {}
  }
}

// ------------------------------------------------------------------ assets
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

async function loadAssets() {
  const names = ["sky", "far", "near", "lula", "flavio", "lula_portrait", "flavio_portrait", "fx", "proj"];
  const imgs = await Promise.all(names.map((n) => loadImage(`/assets/${n}.png`)));
  const A = Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
  A.meta = {
    lula: await (await fetch("/assets/lula.json")).json(),
    flavio: await (await fetch("/assets/flavio.json")).json(),
  };
  try { await document.fonts.load("16px 'Press Start 2P'"); } catch {}
  return A;
}

// ------------------------------------------------------------------ screens
function show(id) {
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}
function hideScreens() { $$(".screen").forEach((s) => s.classList.remove("active")); }
function message(title, text, then) {
  $("#msg-title").textContent = title;
  $("#msg-text").textContent = text;
  show("scr-msg");
  $("#btn-msg-ok").onclick = () => { sfx.confirm(); (then || goTitle)(); };
}

// ------------------------------------------------------------------ state
let A, R;
let mode = "menu"; // menu | local | online
let local = null;
let online = null;
let paused = false;
let pickedChar = "lula";
let cpuLevel = "normal";
let selectMode = "cpu";
let menuView = null;
const urlRoom = new URLSearchParams(location.search).get("sala");

function attractView(t) {
  const st = Math.floor(t * 60);
  return {
    k: st, ph: "menu", pt: 0, rd: 1, tm: 60, hs: 0, sm: 0,
    f: [
      { c: "lula", x: 250 + Math.sin(t * 0.7) * 10, y: 0, fc: 1, hp: 1000, s: "idle", st, mv: "", cb: 0, w: 0, g: 0, inv: 0, h: 0 },
      { c: "flavio", x: 390 - Math.sin(t * 0.7) * 10, y: 0, fc: -1, hp: 1000, s: "idle", st: st + 13, mv: "", cb: 0, w: 0, g: 0, inv: 0, h: 0 },
    ],
    pr: [],
  };
}

function setPlaying(on) {
  setEnabled(on);
  if (!on) releaseTouch();
  $("#touch").classList.toggle("playing", on);
  $("#btn-menu").classList.toggle("hidden", !on);
}

function goTitle() {
  leaveOnline();
  local = null;
  mode = "menu";
  paused = false;
  setPlaying(false);
  R.reset();
  playMusic("menu");
  setCrowd(0.02);
  if (urlRoom) {
    $("#btn-joinlink").textContent = `ENTRAR NA SALA ${urlRoom.toUpperCase()}`;
    $("#btn-joinlink").classList.remove("hidden");
  }
  show("scr-title");
}

// ------------------------------------------------------------------ select screen
function drawCards(t) {
  for (const card of $$(".card")) {
    const c = card.dataset.char;
    const cv = card.querySelector("canvas");
    const x = cv.getContext("2d");
    const meta = A.meta[c];
    const on = card.classList.contains("on");
    const tag = on ? meta.tags.win : meta.tags.idle;
    const n = tag[1] - tag[0] + 1;
    const fi = tag[0] + (Math.floor(t * (on ? 4 : 7)) % n);
    x.clearRect(0, 0, 96, 80);
    x.imageSmoothingEnabled = false;
    x.save();
    if (c === "flavio") { x.translate(96, 0); x.scale(-1, 1); x.translate(16, 0); }
    else x.translate(8, 0);
    x.drawImage(A[c], fi * 96, 0, 96, 80, 0, 0, 96, 80);
    x.restore();
  }
}

function pickChar(c) {
  pickedChar = c;
  $$(".card").forEach((el) => {
    el.classList.toggle("on", el.dataset.char === c);
    el.classList.toggle("off", el.dataset.char !== c);
  });
}

function openSelect(m) {
  selectMode = m;
  $("#select-title").textContent = m === "cpu" ? "TREINO: ESCOLHA SEU LUTADOR" : "ONLINE: ESCOLHA SEU LUTADOR";
  $("#cpu-opts").classList.toggle("hidden", m !== "cpu");
  $("#cpu-actions").classList.toggle("hidden", m !== "cpu");
  $("#online-actions").classList.toggle("hidden", m !== "online");
  pickChar(pickedChar);
  show("scr-select");
}

// ------------------------------------------------------------------ local (CPU)
function startLocal() {
  const chars = [pickedChar, OTHER[pickedChar]];
  local = { S: createMatch(chars), cpu: makeCpu(cpuLevel), acc: 0 };
  mode = "local";
  paused = false;
  R.reset();
  hideScreens();
  setPlaying(true);
  playMusic("off");
}

function updateLocal(dt) {
  if (paused) return;
  local.acc = Math.min(local.acc + dt, 0.25);
  while (local.acc >= TICK) {
    local.acc -= TICK;
    const S = local.S;
    step(S, [readInput(), cpuInput(local.cpu, S, 1)]);
    for (const e of S.ev) R.onEvent(e, S);
    S.ev = [];
  }
}

// ------------------------------------------------------------------ online
function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

function connect() {
  return new Promise((res, rej) => {
    if (online && online.ws.readyState === 1) return res(online);
    const ws = new WebSocket(wsUrl());
    online = { ws, buf: [], rt: -1, you: 0, lastSent: -1, lastSendT: 0, ping: null, processed: 0, chars: null, rematchSent: false };
    ws.onopen = () => res(online);
    ws.onerror = () => rej(new Error("Falha na conexão"));
    ws.onclose = () => {
      if (online && online.ws === ws) {
        const wasPlaying = mode === "online";
        online = null;
        if (wasPlaying) message("CONEXÃO PERDIDA", "A conexão com o servidor caiu.");
      }
    };
    ws.onmessage = (m) => onNet(JSON.parse(m.data));
  });
}

function send(msg) {
  if (online && online.ws.readyState === 1) online.ws.send(JSON.stringify(msg));
}

function leaveOnline() {
  if (!online) return;
  const o = online;
  online = null;
  try { o.ws.send(JSON.stringify({ t: "leave" })); o.ws.close(); } catch {}
}

function onNet(m) {
  if (!online) return;
  switch (m.t) {
    case "room":
      online.you = m.you;
      online.chars = m.chars;
      online.code = m.code;
      if (!m.ready) {
        $("#room-code").textContent = m.code;
        $("#wait-you").textContent = CHAR_NAMES[m.chars[m.you]];
        const link = `${location.origin}${location.pathname}?sala=${m.code}`;
        $("#room-link").value = link;
        show("scr-wait");
      }
      break;
    case "queued":
      show("scr-queue");
      break;
    case "start":
      mode = "online";
      online.buf = [];
      online.rt = -1;
      online.rematchSent = false;
      R.reset();
      hideScreens();
      setPlaying(true);
      playMusic("off");
      sfx.confirm();
      break;
    case "s":
      if (mode !== "online") break;
      online.buf.push(m.s);
      if (online.buf.length > 90) online.buf.splice(0, online.buf.length - 90);
      break;
    case "pong":
      online.ping = Math.round(performance.now() - m.ts);
      break;
    case "rematch":
      if (m.who !== online.you) $("#end-status").textContent = "O oponente quer revanche!";
      break;
    case "opleft":
      setPlaying(false);
      message("OPONENTE SAIU", "Seu oponente desconectou da partida.");
      break;
    case "err":
      message("OPS", m.msg, () => openSelect("online"));
      break;
  }
}

async function onlineAction(msg) {
  initAudio();
  sfx.confirm();
  enterFullscreen();
  try {
    await connect();
    send(msg);
  } catch {
    message("SEM CONEXÃO", "Não foi possível conectar ao servidor do jogo.");
  }
}

// interpolated view from the snapshot buffer
function onlineView(dt) {
  const o = online;
  const buf = o.buf;
  if (!buf.length) return null;
  const latest = buf[buf.length - 1].k;
  if (o.rt < 0) o.rt = latest - 2;
  o.rt += dt * 60;
  const lag = latest - o.rt;
  if (lag > 8) o.rt += (lag - 3) * 0.2;
  if (o.rt > latest) o.rt = latest;
  if (o.rt < buf[0].k) o.rt = buf[0].k;
  // fire events for every snapshot we've now played past
  for (const s of buf) {
    if (s.k > o.rt) break;
    if (s.k > o.processed) {
      for (const e of s.ev) R.onEvent(e, s);
      o.processed = s.k;
    }
  }
  let i = 0;
  while (i < buf.length - 1 && buf[i + 1].k <= o.rt) i++;
  if (i > 0) buf.splice(0, i);
  const a = buf[0], b = buf[1];
  if (!b) return a;
  const t = Math.max(0, Math.min(1, (o.rt - a.k) / (b.k - a.k)));
  const v = { ...a, f: a.f.map((f, j) => ({ ...f, x: f.x + (b.f[j].x - f.x) * t, y: f.y + (b.f[j].y - f.y) * t })) };
  v.pr = a.pr.map((p, j) => {
    const q = b.pr[j];
    return q && q.o === p.o ? { ...p, x: p.x + (q.x - p.x) * t } : p;
  });
  return v;
}

function updateOnlineInput(dt) {
  const o = online;
  o.acc = Math.min((o.acc || 0) + dt, 0.25);
  while (o.acc >= TICK) {
    o.acc -= TICK;
    const inp = readInput();
    const nowT = performance.now();
    if (inp.h !== o.lastSent || inp.p || nowT - o.lastSendT > 250) {
      send({ t: "in", h: inp.h, p: inp.p });
      o.lastSent = inp.h;
      o.lastSendT = nowT;
    }
  }
}

setInterval(() => send({ t: "ping", ts: performance.now() }), 2000);

// ------------------------------------------------------------------ end of match UI
let endShown = false;
function checkEnd(v) {
  const over = v && v.ph === "end" && v.pt > 100;
  if (over && !endShown) {
    endShown = true;
    $("#end-status").textContent = "";
    $("#btn-rematch").disabled = false;
    show("scr-end");
    setEnabled(false);
  } else if (!over && endShown && v && v.ph !== "end") {
    endShown = false;
    hideScreens();
    setPlaying(true);
  }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let view = null, opts = {};
  if (mode === "local" && local) {
    updateLocal(dt);
    view = local.S;
    opts = { you: 0, cpu: 1 };
  } else if (mode === "online" && online) {
    updateOnlineInput(dt);
    view = onlineView(dt);
    opts = { you: online.you, ping: online.ping };
  }
  if (view) {
    R.draw(view, paused ? 0 : dt, opts);
    checkEnd(view);
  } else {
    menuView = attractView(now / 1000);
    R.draw(menuView, dt, { hud: false });
    if ($("#scr-select").classList.contains("active")) drawCards(now / 1000);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ wiring
function wire() {
  const unlock = () => initAudio();
  window.addEventListener("pointerdown", unlock, { once: false });
  window.addEventListener("keydown", unlock, { once: false });

  $("#btn-online").onclick = () => { initAudio(); sfx.confirm(); playMusic("menu"); openSelect("online"); };
  $("#btn-cpu").onclick = () => { initAudio(); sfx.confirm(); playMusic("menu"); openSelect("cpu"); };
  $("#btn-help").onclick = () => { initAudio(); sfx.blip(); show("scr-help"); };
  $$(".back-title").forEach((b) => (b.onclick = () => { sfx.blip(); goTitle(); }));
  $$(".back").forEach((b) => (b.onclick = () => { sfx.blip(); goTitle(); }));
  $$(".card").forEach((c) => (c.onclick = () => { initAudio(); sfx.blip(); pickChar(c.dataset.char); }));
  $$(".chip").forEach((c) => (c.onclick = () => {
    sfx.blip();
    cpuLevel = c.dataset.level;
    $$(".chip").forEach((x) => x.classList.toggle("on", x === c));
  }));
  $("#btn-cpu-go").onclick = () => { initAudio(); sfx.confirm(); enterFullscreen(); startLocal(); };
  $("#btn-create").onclick = () => onlineAction({ t: "create", char: pickedChar });
  $("#btn-quick").onclick = () => onlineAction({ t: "quick", char: pickedChar });
  $("#btn-join").onclick = () => {
    const code = $("#code-in").value.trim().toUpperCase();
    if (code.length !== 4) { sfx.block(); return; }
    onlineAction({ t: "join", code });
  };
  $("#code-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-join").click(); });
  $("#btn-joinlink").onclick = () => onlineAction({ t: "join", code: urlRoom.toUpperCase() });
  $("#btn-copy").onclick = async () => {
    sfx.confirm();
    try { await navigator.clipboard.writeText($("#room-link").value); $("#btn-copy").textContent = "COPIADO!"; }
    catch { $("#room-link").select(); }
    setTimeout(() => ($("#btn-copy").textContent = "COPIAR"), 1500);
  };
  $$(".cancel").forEach((b) => (b.onclick = () => { sfx.blip(); leaveOnline(); openSelect("online"); }));
  $("#btn-resume").onclick = () => togglePause(false);
  $$(".quit").forEach((b) => (b.onclick = () => { sfx.blip(); endShown = false; goTitle(); }));
  $("#btn-rematch").onclick = () => {
    sfx.confirm();
    if (mode === "local") {
      rematch(local.S);
      R.reset();
      endShown = false;
      hideScreens();
      setPlaying(true);
      playMusic("off");
    } else if (online) {
      send({ t: "rematch" });
      $("#btn-rematch").disabled = true;
      $("#end-status").textContent = "Aguardando o oponente aceitar...";
    }
  };
  const muteBtn = $("#btn-mute");
  muteBtn.classList.toggle("off", isMuted());
  muteBtn.onclick = () => { initAudio(); muteBtn.classList.toggle("off", toggleMute()); muteBtn.blur(); };
  $("#btn-menu").onclick = () => togglePause();

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && document.activeElement.tagName !== "INPUT") muteBtn.click();
    if (e.code === "Escape") togglePause();
  });
  setupTouch($("#touch"));
}

function togglePause(force) {
  if (mode === "menu") return;
  if (endShown) return;
  const next = force != null ? force : !paused && !$("#scr-pause").classList.contains("active");
  sfx.blip();
  if (mode === "local") {
    paused = next;
    if (window.speechSynthesis) next ? speechSynthesis.pause() : speechSynthesis.resume();
  }
  if (next) { show("scr-pause"); setEnabled(false); }
  else { hideScreens(); setEnabled(true); }
}

// ------------------------------------------------------------------ boot
(async function boot() {
  fit();
  A = await loadAssets();
  R = new Renderer(canvas, A);
  wire();
  fit();
  goTitle();
  requestAnimationFrame(frame);
})();
