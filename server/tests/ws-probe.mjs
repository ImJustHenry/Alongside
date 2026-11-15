// Joins a room as a probe and records presence/state messages for 4 s. Usage: node ws-probe.mjs "<invite link>" <out.json>
import { writeFileSync } from "node:fs";
import WebSocket from "ws";
const [link, out] = process.argv.slice(2);
const u = new URL(link); const p = new URLSearchParams(u.hash.slice(1));
const room = p.get("room");
const j = await (await fetch(u.origin + `/api/rooms/${room}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Probe", invite: p.get("invite") }) })).json();
const ws = new WebSocket(u.origin.replace("http", "ws") + "/live");
const seen = [];
ws.on("open", () => ws.send(JSON.stringify({ type: "auth", room, token: j.token })));
ws.on("message", (m) => { const x = JSON.parse(m); seen.push(x.type === "presence" ? { presence: x.members.map((m) => m.name) } : { type: x.type, writing: x.state?.collaborativeWriting, annotations: x.state?.annotations?.length }); });
setTimeout(() => { writeFileSync(out, JSON.stringify(seen, null, 1)); process.exit(0); }, 4000);
