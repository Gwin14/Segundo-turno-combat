// All sound is synthesised with WebAudio: impacts, whooshes, crowd, a
// samba-flavoured chiptune loop, plus a pt-BR announcer via speechSynthesis.

let ctx = null;
let master, sfxBus, musicBus, crowdGain, noiseBuf;
let muted = false;
try { muted = localStorage.getItem("st_muted") === "1"; } catch {}

export function initAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.8;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.32;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // crowd bed: band-passed noise, swells on big moments
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.5;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0;
  src.connect(bp).connect(crowdGain).connect(sfxBus);
  src.start();
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("st_muted", muted ? "1" : "0"); } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  if (muted && window.speechSynthesis) speechSynthesis.cancel();
  return muted;
}

const now = () => ctx.currentTime;

function env(g, t, a, peak, dec, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + dec);
}

function noise(t, dur, { type = "lowpass", f0 = 2000, f1 = f0, q = 1, peak = 0.5, a = 0.002, bus = sfxBus } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + a + 0.05);
}

function tone(t, dur, { type = "sine", f0 = 440, f1 = f0, peak = 0.3, a = 0.003, bus = sfxBus, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + a + 0.05);
}

let distCurve;
function crunch(t, dur, f0, f1, peak) {
  if (!distCurve) {
    distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; distCurve[i] = Math.tanh(x * 6); }
  }
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const ws = ctx.createWaveShaper();
  ws.curve = distCurve;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  const g = ctx.createGain();
  env(g, t, 0.002, peak, dur);
  o.connect(ws).connect(lp).connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  whoosh(heavy = false) {
    if (!ctx) return;
    const t = now();
    noise(t, heavy ? 0.22 : 0.14, { type: "bandpass", f0: heavy ? 1800 : 3200, f1: heavy ? 300 : 700, q: 1.4, peak: heavy ? 0.35 : 0.25, a: 0.03 });
  },
  hit(heavy = false) {
    if (!ctx) return;
    const t = now();
    noise(t, heavy ? 0.2 : 0.12, { f0: 4000, f1: 200, peak: heavy ? 0.9 : 0.7 });
    tone(t, heavy ? 0.25 : 0.16, { f0: heavy ? 160 : 220, f1: 40, peak: heavy ? 0.9 : 0.6 });
    crunch(t, heavy ? 0.12 : 0.07, heavy ? 120 : 200, 50, heavy ? 0.35 : 0.2);
    if (heavy) noise(t + 0.01, 0.35, { type: "bandpass", f0: 900, f1: 300, q: 0.8, peak: 0.25 });
  },
  block() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.12, { type: "square", f0: 1900, f1: 1500, peak: 0.12 });
    tone(t, 0.18, { type: "triangle", f0: 2600, f1: 2500, peak: 0.12 });
    noise(t, 0.06, { type: "highpass", f0: 3000, peak: 0.4 });
    tone(t, 0.08, { f0: 300, f1: 120, peak: 0.3 });
  },
  jump() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.1, { type: "square", f0: 260, f1: 620, peak: 0.08 });
    noise(t, 0.1, { type: "bandpass", f0: 1200, f1: 2400, peak: 0.12 });
  },
  land() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.1, { f0: 140, f1: 50, peak: 0.35 });
    noise(t, 0.08, { f0: 800, f1: 200, peak: 0.25 });
  },
  thud(big = false) {
    if (!ctx) return;
    const t = now();
    tone(t, big ? 0.5 : 0.25, { f0: 110, f1: 30, peak: big ? 1 : 0.6 });
    noise(t, big ? 0.6 : 0.3, { f0: 1500, f1: 80, peak: big ? 0.8 : 0.5 });
  },
  sizzle() {
    if (!ctx) return;
    const t = now();
    for (let i = 0; i < 14; i++) noise(t + i * 0.035 + Math.random() * 0.02, 0.03, { type: "highpass", f0: 3500 + Math.random() * 3000, peak: 0.12 + Math.random() * 0.15 });
    noise(t, 0.5, { type: "highpass", f0: 5000, f1: 6000, peak: 0.08, a: 0.05 });
    tone(t, 0.2, { type: "sawtooth", f0: 200, f1: 400, peak: 0.05 });
  },
  kickball() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.15, { f0: 200, f1: 60, peak: 0.8 });
    noise(t, 0.05, { f0: 3000, f1: 500, peak: 0.5 });
    tone(t + 0.02, 0.3, { type: "triangle", f0: 500, f1: 900, peak: 0.12 });
  },
  boing() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(520, t + 0.08);
    o.frequency.linearRampToValueAtTime(260, t + 0.3);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    env(g, t, 0.005, 0.35, 0.35);
    o.connect(g).connect(sfxBus);
    o.start(t); lfo.start(t);
    o.stop(t + 0.45); lfo.stop(t + 0.45);
  },
  splat() {
    if (!ctx) return;
    const t = now();
    noise(t, 0.18, { f0: 1200, f1: 150, q: 3, peak: 0.6 });
    tone(t, 0.12, { type: "sawtooth", f0: 300, f1: 80, peak: 0.15 });
  },
  clash() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.6, { type: "square", f0: 1200, f1: 1150, peak: 0.12 });
    tone(t, 0.6, { type: "square", f0: 1520, f1: 1480, peak: 0.1 });
    noise(t, 0.3, { type: "highpass", f0: 2000, f1: 6000, peak: 0.5 });
    tone(t, 0.3, { f0: 90, f1: 40, peak: 0.6 });
  },
  power() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.25, { type: "sawtooth", f0: 220, f1: 880, peak: 0.08 });
    tone(t, 0.25, { type: "square", f0: 330, f1: 1320, peak: 0.05, detune: 12 });
  },
  ko() {
    if (!ctx) return;
    const t = now();
    noise(t, 1.6, { f0: 2500, f1: 60, peak: 1 });
    tone(t, 1.2, { f0: 80, f1: 25, peak: 1 });
    tone(t, 1.4, { type: "sawtooth", f0: 900, f1: 60, peak: 0.12 });
    crunch(t, 0.4, 150, 40, 0.4);
  },
  gong() {
    if (!ctx) return;
    const t = now();
    [196, 293, 415, 587, 784].forEach((f, i) => tone(t, 2.2 - i * 0.3, { f0: f, f1: f * 0.99, peak: 0.18 / (i + 1), a: 0.004 }));
    noise(t, 0.4, { type: "bandpass", f0: 1200, f1: 400, q: 2, peak: 0.2 });
  },
  stinger() {
    if (!ctx) return;
    const t = now();
    [440, 554, 659, 880].forEach((f, i) => tone(t + i * 0.06, 0.25, { type: "square", f0: f, peak: 0.1 }));
    noise(t + 0.24, 0.4, { type: "highpass", f0: 4000, peak: 0.3 });
  },
  victory() {
    if (!ctx) return;
    const t = now();
    const mel = [523, 659, 784, 1046, 784, 1046, 1318];
    mel.forEach((f, i) => {
      tone(t + i * 0.12, 0.3, { type: "square", f0: f, peak: 0.12 });
      tone(t + i * 0.12, 0.3, { type: "triangle", f0: f / 2, peak: 0.12 });
    });
  },
  blip() {
    if (!ctx) return;
    tone(now(), 0.05, { type: "square", f0: 880, peak: 0.08 });
  },
  confirm() {
    if (!ctx) return;
    const t = now();
    tone(t, 0.07, { type: "square", f0: 660, peak: 0.1 });
    tone(t + 0.07, 0.12, { type: "square", f0: 990, peak: 0.1 });
  },
  tick() {
    if (!ctx) return;
    tone(now(), 0.05, { type: "square", f0: 1400, peak: 0.06 });
  },
  crowd(amount = 0.25, dur = 1.2) {
    if (!ctx) return;
    const t = now();
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setTargetAtTime(Math.min(0.6, amount), t, 0.05);
    crowdGain.gain.setTargetAtTime(ambientCrowd, t + dur * 0.4, dur * 0.5);
  },
};

let ambientCrowd = 0;
export function setCrowd(level) {
  ambientCrowd = level;
  if (ctx) crowdGain.gain.setTargetAtTime(level, now(), 0.6);
}

// ------------------------------------------------------------------ announcer
let voice = null;
function pickVoice() {
  if (!window.speechSynthesis) return null;
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => (voice = pickVoice());

export function announce(text, { interrupt = true, pitch = 0.7, rate = 1.05 } = {}) {
  if (muted || !window.speechSynthesis) return;
  if (!interrupt && speechSynthesis.speaking) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  voice = voice || pickVoice();
  if (voice) u.voice = voice;
  u.lang = "pt-BR";
  u.pitch = pitch;
  u.rate = rate;
  u.volume = 1;
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------------ music
const BPM = 138;
const STEP = 60 / BPM / 4; // 16th note
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// A minor: Am  F  G  Em  (one bar each), 16 steps per bar
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const SURDO = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0];
const TAMB = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1];
// lead melody over 4 bars (MIDI notes, 0 = rest, -1 = hold)
const MEL = [
  76, -1, 74, 72, -1, 0, 69, -1, 72, -1, 74, -1, 76, -1, 0, 0,
  77, -1, 76, 74, -1, 0, 72, -1, 69, -1, 72, -1, 74, -1, -1, 0,
  74, -1, 72, 71, -1, 0, 67, -1, 71, -1, 74, -1, 79, -1, 77, 76,
  76, -1, 74, 71, -1, 0, 67, -1, 71, -1, 72, -1, 71, -1, -1, 0,
];

let musicTimer = null;
let nextTime = 0;
let stepIdx = 0;
let musicMode = "off";

function scheduleStep(t, i) {
  const bar = Math.floor(i / 16) % 4;
  const s = i % 16;
  const chord = CHORDS[bar];
  const fight = musicMode === "fight";
  // bass
  if (BASS[s]) {
    const n = chord[0] - 12 + (s === 11 || s === 13 ? 12 : 0);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = NOTE(n);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(fight ? 1200 : 700, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + STEP * 2);
    const g = ctx.createGain();
    env(g, t, 0.005, 0.5, STEP * 2);
    o.connect(lp).connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + STEP * 2.5);
  }
  // arpeggio
  if (s % 2 === 0 || fight) {
    const n = chord[(s >> (fight ? 0 : 1)) % 3] + 12;
    tone(t, STEP * 0.9, { type: "square", f0: NOTE(n), peak: fight ? 0.05 : 0.04, bus: musicBus });
  }
  // shaker every 16th (accented on the off-beats, samba feel)
  noise(t, 0.03, { type: "highpass", f0: 7000, peak: s % 4 === 2 ? 0.18 : 0.07, bus: musicBus });
  if (fight) {
    // kick
    if (s === 0 || s === 8) tone(t, 0.18, { f0: 150, f1: 45, peak: 0.9, bus: musicBus });
    // surdo (deep tom)
    if (SURDO[s]) tone(t, 0.35, { f0: SURDO[s] === 2 ? 70 : 90, f1: 50, peak: 0.6, bus: musicBus });
    // snare / clap on 2 and 4
    if (s === 4 || s === 12) noise(t, 0.12, { type: "bandpass", f0: 1800, f1: 1200, q: 0.8, peak: 0.45, bus: musicBus });
    // tamborim
    if (TAMB[s]) tone(t, 0.04, { type: "triangle", f0: 1300, peak: 0.08, bus: musicBus });
    // lead
    const m = MEL[i % 64];
    if (m > 0) {
      let len = 1;
      while (MEL[(i + len) % 64] === -1 && len < 8) len++;
      tone(t, STEP * len * 0.95, { type: "square", f0: NOTE(m), peak: 0.07, bus: musicBus, detune: 4 });
      tone(t, STEP * len * 0.95, { type: "triangle", f0: NOTE(m - 12), peak: 0.05, bus: musicBus });
    }
  }
}

function pump() {
  while (nextTime < ctx.currentTime + 0.15) {
    scheduleStep(nextTime, stepIdx++);
    nextTime += STEP;
  }
}

export function playMusic(mode) {
  if (!ctx || mode === musicMode) return;
  musicMode = mode;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (mode === "off") return;
  nextTime = ctx.currentTime + 0.05;
  stepIdx = 0;
  musicTimer = setInterval(pump, 40);
}
