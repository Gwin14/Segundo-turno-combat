// Static file server + WebSocket game server. The server owns the simulation:
// clients send inputs, the server steps the match at 60 Hz and broadcasts
// snapshots (with the events that happened since the last one).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createMatch, rematch, snapshot, step, FPS } from "./shared/sim.js";

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

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const base = path.startsWith("/shared/") ? ROOT : join(ROOT, "public");
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(base))) throw new Error("bad path");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    let body = await readFile(file);
    if (path === "/index.html") body = body.toString().replaceAll("__ORIGIN__", publicOrigin(req));
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
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

function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  while (rooms.has(code));
  return code;
}

function newRoom(ws, char) {
  const code = makeCode();
  const room = {
    code, players: [ws, null], chars: [char, OTHER[char]], state: null,
    inputs: [{ h: 0, p: 0 }, { h: 0, p: 0 }], events: [], rematch: [false, false],
  };
  rooms.set(code, room);
  ws.room = room;
  ws.slot = 0;
  return room;
}

function joinRoom(ws, room) {
  room.players[1] = ws;
  ws.room = room;
  ws.slot = 1;
  startMatch(room);
}

function roomInfo(room, slot) {
  return { t: "room", code: room.code, you: slot, chars: room.chars, ready: !!(room.players[0] && room.players[1]) };
}

function startMatch(room) {
  room.state = createMatch(room.chars);
  room.inputs = [{ h: 0, p: 0 }, { h: 0, p: 0 }];
  room.rematch = [false, false];
  room.events = [];
  room.players.forEach((p, i) => { send(p, roomInfo(room, i)); send(p, { t: "start" }); });
}

function closeRoom(room, leaver) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  room.players.forEach((p) => {
    if (p && p !== leaver) { send(p, { t: "opleft" }); p.room = null; }
  });
}

function leave(ws) {
  quickQueue = quickQueue.filter((q) => q.ws !== ws);
  if (ws.room) closeRoom(ws.room, ws);
  ws.room = null;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = ws.room;
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
        if (!r) return send(ws, { t: "err", msg: "Sala não encontrada." });
        if (r.players[1]) return send(ws, { t: "err", msg: "Essa sala já está cheia." });
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
          const r = newRoom(other.ws, hostChar);
          joinRoom(ws, r);
        } else {
          quickQueue.push({ ws, want });
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
            room.players.forEach((p) => send(p, { t: "start" }));
          }
        }
        break;
      case "leave":
        leave(ws);
        break;
    }
  });
  ws.on("close", () => leave(ws));
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
      const msg = JSON.stringify({ t: "s", s: snapshot(room.state, ev) });
      for (const p of room.players) if (p && p.readyState === 1) p.send(msg);
    }
  }
  setTimeout(loop, Math.max(0, STEP - acc - 1));
}
loop();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`A porta ${PORT} já está em uso (o jogo já está rodando?). Use outra: PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => console.log(`Segundo Turno rodando em http://localhost:${PORT}`));
