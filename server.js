// Static file server + WebSocket game server. The server owns the simulation:
// clients send inputs, the server steps the match at 60 Hz and broadcasts
// snapshots (with the events that happened since the last one).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createMatch, rematch, snapshot, step, FPS } from "./shared/sim.js";
import { track, browserConfig, shutdownAnalytics, analyticsEnabled } from "./analytics.js";

// .env is optional locally; in production the host provides the variables.
try { process.loadEnvFile(); } catch {}

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};

// Public origin for absolute URLs in the Open Graph tags (scrapers need them).
// PUBLIC_URL pins it (e.g. a custom domain); otherwise it comes from the
// request, honouring the proxy headers Render & co. set.
function publicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const first = (v) => String(v || "").split(",")[0].trim();
  const proto = first(req.headers["x-forwarded-proto"]) === "https" ? "https" : req.socket.encrypted ? "https" : "http";
  const host = first(req.headers["x-forwarded-host"]) || first(req.headers.host);
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `${proto}://${host}` : `http://localhost:${PORT}`;
}

// Browser build of posthog-js, served first-party from node_modules (its
// version is pinned by package-lock.json).
const VENDOR = { "/vendor/posthog.js": join(ROOT, "node_modules", "posthog-js", "dist", "module.js") };

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    let file;
    if (VENDOR[path]) file = VENDOR[path];
    else {
      const base = path.startsWith("/shared/") ? ROOT : join(ROOT, "public");
      file = normalize(join(base, path));
      if (!file.startsWith(normalize(base))) throw new Error("bad path");
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    let body = await readFile(file);
    if (path === "/index.html") {
      // JSON in a <script>: escape "<" so a value can never close the tag
      const ph = JSON.stringify(browserConfig()).replace(/</g, "\\u003c");
      body = body.toString().replaceAll("__ORIGIN__", publicOrigin(req)).replace("__PH_CONFIG__", ph);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": VENDOR[path] ? "public, max-age=86400" : "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404");
  }
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let quickQueue = [];

const OTHER = { lula: "flavio", flavio: "lula" };
const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));
const secs = (t0) => Math.round((Date.now() - t0) / 100) / 10;
// The browser sends its anonymous PostHog id so server events join its person.
const cleanPid = (v) => (typeof v === "string" && /^[\w.:$-]{1,200}$/.test(v) ? v : null);
const roomPhase = (room) => (!room.players[1] ? "espera" : room.state && room.state.ph === "end" ? "fim" : "luta");
const newStats = () => ({ golpes: [0, 0], especiais: [0, 0], defesas: [0, 0], maior_combo: [0, 0],
  socos: [0, 0], chutes: [0, 0], voadoras: [0, 0], baixos: [0, 0], lancados: [0, 0] });

function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  while (rooms.has(code));
  return code;
}

function newRoom(ws, char, origin = "convite") {
  const code = makeCode();
  const room = {
    code, players: [ws, null], chars: [char, OTHER[char]], state: null,
    inputs: [{ h: 0, p: 0 }, { h: 0, p: 0 }], events: [], rematch: [false, false],
    origin, createdAt: Date.now(), matches: 0, matchStartedAt: 0, roundStartedAt: 0, lastEnd: "ko",
    stats: newStats(),
  };
  rooms.set(code, room);
  ws.room = room;
  ws.slot = 0;
  track(ws.pid, "sala criada", { codigo: code, lutador: char, origem: origin });
  return room;
}

function joinRoom(ws, room) {
  room.players[1] = ws;
  ws.room = room;
  ws.slot = 1;
  track(ws.pid, "sala entrou", { codigo: room.code, lutador: room.chars[1], origem: room.origin });
  track(room.players[0].pid, "sala preenchida", { codigo: room.code, origem: room.origin, espera_s: secs(room.createdAt) });
  startMatch(room);
}

function trackMatchStart(room) {
  room.matches++;
  room.matchStartedAt = Date.now();
  room.stats = newStats();
  room.players.forEach((p, i) => p && track(p.pid, "partida online iniciada", {
    codigo: room.code, origem: room.origin, lutador: room.chars[i], oponente: room.chars[1 - i],
    revanche: room.matches > 1, numero_partida: room.matches,
  }));
}

// Turns simulation events into analytics: per-round results, per-player
// stats and the final result from each player's point of view.
function trackSimEvents(room, events) {
  const S = room.state;
  const slotOf = (c) => room.chars.indexOf(c);
  const st = room.stats;
  for (const e of events) {
    switch (e.t) {
      case "round": room.roundStartedAt = Date.now(); break;
      case "ko": room.lastEnd = "ko"; break;
      case "timeup": room.lastEnd = "tempo"; break;
      case "swing": {
        const i = slotOf(e.c);
        if (i < 0) break;
        const key = { punch: "socos", kick: "chutes", jkick: "voadoras", cpunch: "baixos" }[e.mv];
        if (key) st[key][i]++;
        break;
      }
      case "proj": { const i = slotOf(e.c); if (i >= 0) st.lancados[i]++; break; }
      case "hit": {
        const a = 1 - e.d;
        st.golpes[a]++;
        if (e.proj) st.especiais[a]++;
        st.maior_combo[a] = Math.max(st.maior_combo[a], e.cb || 1);
        break;
      }
      case "block": st.defesas[e.d]++; break;
      case "roundwin":
        track(`sala_${room.code}`, "round terminado", {
          codigo: room.code, origem: room.origin, round: S.rd, motivo: room.lastEnd,
          vencedor: e.p < 0 ? "empate" : room.chars[e.p],
          vida_vencedor: e.p < 0 ? null : S.f[e.p].hp, duracao_s: secs(room.roundStartedAt || room.matchStartedAt),
        });
        break;
      case "matchwin":
        room.players.forEach((p, i) => p && track(p.pid, "partida online terminada", {
          codigo: room.code, origem: room.origin, lutador: room.chars[i], oponente: room.chars[1 - i],
          resultado: e.p < 0 ? "empate" : e.p === i ? "vitoria" : "derrota",
          vencedor: e.p < 0 ? "empate" : room.chars[e.p],
          placar: `${S.f[i].w}x${S.f[1 - i].w}`, rounds: S.rd, motivo_final: room.lastEnd,
          duracao_s: secs(room.matchStartedAt), revanche: room.matches > 1,
          golpes_acertados: st.golpes[i], especiais_acertados: st.especiais[i], defesas: st.defesas[i],
          maior_combo: st.maior_combo[i], socos: st.socos[i], chutes: st.chutes[i], voadoras: st.voadoras[i],
          golpes_baixos: st.baixos[i], especiais_lancados: st.lancados[i],
        }));
        break;
    }
  }
}

function roomInfo(room, slot) {
  return { t: "room", code: room.code, you: slot, chars: room.chars, ready: !!(room.players[0] && room.players[1]) };
}

function startMatch(room) {
  room.state = createMatch(room.chars);
  room.inputs = [{ h: 0, p: 0 }, { h: 0, p: 0 }];
  room.rematch = [false, false];
  room.events = [];
  trackMatchStart(room);
  room.players.forEach((p, i) => { send(p, roomInfo(room, i)); send(p, { t: "start" }); });
}

function closeRoom(room, leaver, reason) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  const phase = roomPhase(room);
  if (leaver) {
    track(leaver.pid, phase === "espera" ? "sala cancelada" : "sala abandonada", {
      codigo: room.code, origem: room.origin, fase: phase, motivo: reason,
      round: room.state ? room.state.rd : null, espera_s: phase === "espera" ? secs(room.createdAt) : null,
    });
  }
  room.players.forEach((p) => {
    if (p && p !== leaver) {
      send(p, { t: "opleft" });
      p.room = null;
      track(p.pid, "oponente saiu", { codigo: room.code, origem: room.origin, fase: phase, motivo: reason,
        round: room.state ? room.state.rd : null });
    }
  });
}

function leave(ws, reason = "saiu") {
  const queued = quickQueue.find((q) => q.ws === ws);
  if (queued) {
    quickQueue = quickQueue.filter((q) => q.ws !== ws);
    track(ws.pid, "partida rapida cancelada", { espera_s: secs(queued.at), motivo: reason });
  }
  if (ws.room) closeRoom(ws.room, ws, reason);
  ws.room = null;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.pid = `anon_${randomUUID()}`;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = ws.room;
    const pid = cleanPid(m.pid);
    if (pid) ws.pid = pid;
    switch (m.t) {
      case "in":
        if (room && room.state) {
          const inp = room.inputs[ws.slot];
          inp.h = m.h | 0;
          inp.p |= m.p | 0;
        }
        break;
      case "ping":
        send(ws, { t: "pong", ts: m.ts });
        break;
      case "create": {
        leave(ws);
        const char = m.char === "flavio" ? "flavio" : "lula";
        const r = newRoom(ws, char);
        send(ws, roomInfo(r, 0));
        break;
      }
      case "join": {
        leave(ws);
        const r = rooms.get(String(m.code || "").toUpperCase().trim());
        if (!r || r.players[1]) {
          track(ws.pid, "sala entrada falhou", { motivo: r ? "cheia" : "nao_encontrada" });
          return send(ws, { t: "err", msg: r ? "Essa sala já está cheia." : "Sala não encontrada." });
        }
        joinRoom(ws, r);
        break;
      }
      case "quick": {
        leave(ws);
        const want = m.char === "flavio" ? "flavio" : m.char === "lula" ? "lula" : null;
        // prefer an opponent who wants the other character
        let idx = quickQueue.findIndex((q) => !want || !q.want || q.want !== want);
        if (idx < 0 && quickQueue.length) idx = 0;
        if (idx >= 0) {
          const other = quickQueue.splice(idx, 1)[0];
          const hostChar = other.want || (want ? OTHER[want] : Math.random() < 0.5 ? "lula" : "flavio");
          track(other.ws.pid, "partida rapida pareada", { espera_s: secs(other.at), lutador: hostChar,
            pediu: other.want || "qualquer" });
          track(ws.pid, "partida rapida pareada", { espera_s: 0, lutador: OTHER[hostChar], pediu: want || "qualquer" });
          const r = newRoom(other.ws, hostChar, "partida_rapida");
          joinRoom(ws, r);
        } else {
          quickQueue.push({ ws, want, at: Date.now() });
          track(ws.pid, "partida rapida na fila", { pediu: want || "qualquer" });
          send(ws, { t: "queued" });
        }
        break;
      }
      case "rematch":
        if (room && room.state && room.state.ph === "end") {
          room.rematch[ws.slot] = true;
          room.players.forEach((p) => send(p, { t: "rematch", who: ws.slot }));
          if (room.rematch[0] && room.rematch[1]) {
            rematch(room.state);
            room.rematch = [false, false];
            trackMatchStart(room);
            room.players.forEach((p) => send(p, { t: "start" }));
          }
        }
        break;
      case "leave":
        leave(ws);
        break;
    }
  });
  ws.on("close", () => leave(ws, "desconectou"));
});

// heartbeat to drop dead sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);

// fixed-step game loop
const STEP = 1000 / FPS;
let last = performance.now();
let acc = 0;
function loop() {
  const now = performance.now();
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    for (const room of rooms.values()) {
      if (!room.state) continue;
      step(room.state, room.inputs);
      room.inputs[0].p = 0;
      room.inputs[1].p = 0;
      const ev = room.state.ev;
      room.state.ev = [];
      if (ev.length) trackSimEvents(room, ev);
      const msg = JSON.stringify({ t: "s", s: snapshot(room.state, ev) });
      for (const p of room.players) if (p && p.readyState === 1) p.send(msg);
    }
  }
  setTimeout(loop, Math.max(0, STEP - acc - 1));
}
loop();

// Load snapshot every 5 minutes while anyone is connected.
setInterval(() => {
  if (!wss.clients.size) return;
  const all = [...rooms.values()];
  track("servidor", "servidor status", {
    jogadores_conectados: wss.clients.size, salas_abertas: all.length,
    partidas_em_andamento: all.filter((r) => r.players[1] && r.state && r.state.ph !== "end").length,
    na_fila: quickQueue.length,
  });
}, 5 * 60 * 1000);

// Flush queued analytics before the host stops the process (deploys, restarts).
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.once(sig, async () => {
    try { await shutdownAnalytics(); } finally { process.exit(0); }
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`A porta ${PORT} já está em uso (o jogo já está rodando?). Use outra: PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => console.log(`Segundo Turno rodando em http://localhost:${PORT}` +
  (analyticsEnabled() ? " (PostHog ligado)" : " (PostHog desligado: defina POSTHOG_PROJECT_TOKEN e POSTHOG_HOST)")));
