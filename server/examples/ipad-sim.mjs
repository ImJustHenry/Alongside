// Headless stand-in for the native iPad app (ipad/AlongsideLive): same REST + WebSocket protocol as
// Live/AlongsideAPI.swift and Live/LiveSession.swift. Use with a real Quest or `npm run fake-quest`.
//   node examples/ipad-sim.mjs http://127.0.0.1:4173 <pairing code>
import WebSocket from "ws";
const base = process.argv[2] || "http://127.0.0.1:4173";
const pair = process.argv[3];
if (!pair) { console.log("usage: node examples/ipad-sim.mjs <server url> <pairing code>"); process.exit(2); }
const log = (...a) => console.log("[ipad-sim]", ...a);
const fail = (m) => { console.log("[ipad-sim] FAIL:", m); process.exit(1); };

const cur = await fetch(base + "/api/live/current", { headers: { "X-Pair-Code": pair } });
if (!cur.ok) fail("live/current " + cur.status + " " + (await cur.text()));
const { room, invite, host } = await cur.json();
log("paired: Quest room", room, host ? "(host " + host + ")" : "");

const j = await fetch(`${base}/api/rooms/${room}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite, name: "iPad (simulated)" }) });
if (!j.ok) fail("join " + j.status + " " + (await j.text()));
const { token, member } = await j.json();
log("joined as", member.name, "role", member.role);

const ws = new WebSocket(base.replace(/^http/, "ws") + "/live");
let frames = 0, lastMeta = null, strokeSent = false, result = null, watching = false;
const done = (ok, msg) => { log(msg); log(`frames received: ${frames}`); ws.close(); process.exit(ok ? 0 : 1); };
ws.on("open", () => ws.send(JSON.stringify({ type: "auth", room, token })));
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    const b = Buffer.from(data); const n = b.readUInt32LE(0);
    const meta = JSON.parse(b.subarray(4, 4 + n).toString()); const jpeg = b.subarray(4 + n);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) fail("frame payload is not a JPEG");
    frames++; lastMeta = meta;
    if (frames === 1) log(`first frame: ${meta.w}x${meta.h}, seq ${meta.seq}, epoch ${String(meta.epoch).slice(0, 8)}…, jpeg ${Math.round(jpeg.length / 1024)} KB`);
    if (frames === 5 && !strokeSent) {
      strokeSent = true;
      const pts = Array.from({ length: 12 }, (_, i) => ({ u: 0.35 + i * 0.025, v: 0.62 }));
      const base = { type: "remoteStroke", id: crypto.randomUUID().toUpperCase(), epoch: meta.epoch, frameSeq: meta.seq, points: pts, color: "#da6b45", width: 0.006 };
      ws.send(JSON.stringify({ ...base, phase: "preview" }));
      ws.send(JSON.stringify({ ...base, phase: "commit" }));
      log("sent stroke (preview + commit) on frame", meta.seq);
    }
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.type === "state" && !watching) { watching = true; ws.send(JSON.stringify({ type: "watchLive", enabled: true })); log("state received; watchLive sent"); }
  if (m.type === "remoteResult") { result = m; done(m.ok !== false, `remoteResult: ${JSON.stringify({ ok: m.ok, placement: m.placement, surface: m.surface, phase: m.phase, error: m.error }).slice(0, 200)}`); }
  if (m.type === "error") log("server error:", m.message || m.error);
});
ws.on("error", (e) => fail("socket " + e.message));
setTimeout(() => done(false, strokeSent ? "no remoteResult within 15 s" : "no/too few frames within 15 s"), 15000);
