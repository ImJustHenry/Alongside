// GPT companion drawing: GPT's mark becomes a frame-referenced circle that the headset reprojects,
// then a committed spatial stroke attributed to GPT. OpenAI calls are mocked; no network.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { FrameHub, packFrame } from "../server/liveview.js";
import { Store } from "../server/store.js";
import { askShizuku, circlePoints, GPT_ACTOR } from "../server/shizuku.js";

const jpeg = Buffer.from([255, 216, 1, 2, 3, 4, 255, 217]);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup() {
  process.env.OPENAI_API_KEY = "test-key-not-real";
  const store = new Store(null),
    h = store.create("Host", "Test"),
    host = store.auth(h.room.id, h.token),
    messages = [];
  const source = { room: h.room.id, actor: host, readyState: 1, send() {} };
  const hub = new FrameHub(store, new Set([source]), (ws, msg) => messages.push({ ws, msg }));
  hub.start(source);
  const epoch = hub.rooms.get(h.room.id).epoch;
  hub.publish(
    source,
    packFrame(
      { type: "frame", epoch, seq: 1, ts: Date.now(), w: 640, h: 480, intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, pose: { p: [0, 0, 0], q: [0, 0, 0, 1] }, calibration: "estimated", source: "simulation", overlays: [], hands: [] },
      jpeg,
    ),
  );
  return { store, h, host, hub, source, messages };
}

// heard: transcription text; chat: assistant message content
function mockOpenAI(heard, chat) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).split("/v1/")[1];
    calls.push({ path, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (path === "audio/transcriptions") return new Response(JSON.stringify({ text: heard }));
    if (path === "chat/completions") return new Response(JSON.stringify({ choices: [{ message: { content: chat } }] }));
    if (path === "audio/speech") return new Response(Buffer.from("RIFFfakewav"));
    throw new Error("unexpected " + path);
  };
  return calls;
}
const ask = (f) => askShizuku(f.hub, f.store, f.h.room.id, f.host, { audio: "A".repeat(200), consent: true });

test("circlePoints is a closed-ish round loop inside the frame", () => {
  const pts = circlePoints(0.5, 0.5, 0.1, 640, 480);
  assert.equal(pts.length, 41);
  for (const p of pts) assert.ok(p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1);
  const us = pts.map((p) => p.u), vs = pts.map((p) => p.v);
  const wPx = (Math.max(...us) - Math.min(...us)) * 640, hPx = (Math.max(...vs) - Math.min(...vs)) * 480;
  assert.ok(Math.abs(wPx - hPx) / wPx < 0.15, `round in pixels: ${wPx} vs ${hPx}`);
  const edge = circlePoints(0.98, 0.02, 0.2, 640, 480);
  for (const p of edge) assert.ok(p.u <= 1 && p.v >= 0);
});

test("GPT circles what it names: reprojection request, then a GPT-attributed stroke", async () => {
  const f = setup();
  try {
    const calls = mockOpenAI("GPT, circle the red cup.", JSON.stringify({ reply: "There it is. I circled the red cup in blue.", mark: { u: 0.3, v: 0.6, radius: 0.08 } }));
    const r = await ask(f);
    assert.equal(r.addressed, true);
    assert.equal(r.marked, true);
    assert.equal(r.sawCamera, true);
    assert.match(r.reply, /circled/);
    const chat = calls.find((c) => c.path === "chat/completions").body;
    assert.equal(chat.response_format.type, "json_schema");
    const rq = f.messages.findLast((m) => m.msg?.type === "reproject");
    assert.ok(rq, "headset got a reprojection request");
    assert.equal(rq.ws, f.source);
    assert.equal(rq.msg.source, "ai");
    assert.equal(rq.msg.ownerName, "GPT");
    assert.equal(rq.msg.points.length, 41);
    // headset answers; builtin GPT has no MCP agent token, which must not block it
    f.hub.resolve(f.source, {
      type: "reprojectResult",
      requestId: rq.msg.requestId,
      revision: rq.msg.revision,
      phase: "commit",
      points: rq.msg.points.map((p) => ({ x: p.u - 0.5, y: 0.5 - p.v, z: 1.5 })),
      placement: "fixed-distance",
    });
    const s = f.store.snapshot(f.h.room.id).spatialStrokes.at(-1);
    assert.equal(s.ownerId, GPT_ACTOR.id);
    assert.equal(s.ownerName, "GPT");
    assert.equal(s.source, "ai");
    assert.equal(s.color, "#4A8FD8");
  } finally {
    f.hub.dispose();
  }
});

test("no mark when GPT is just describing", async () => {
  const f = setup();
  try {
    mockOpenAI("GPT, what do you see?", JSON.stringify({ reply: "A desk with a laptop.", mark: null }));
    const r = await ask(f);
    assert.equal(r.marked, false);
    assert.equal(r.reply, "A desk with a laptop.");
    assert.ok(!f.messages.some((m) => m.msg?.type === "reproject"));
  } finally {
    f.hub.dispose();
  }
});

test("spatial writing OFF: GPT answers in plain text and never draws", async () => {
  const f = setup();
  try {
    f.store.room(f.h.room.id).collaborativeWriting = false;
    const calls = mockOpenAI("GPT, circle the cup", "It's on the left side of the desk.");
    const r = await ask(f);
    assert.equal(r.marked, false);
    assert.equal(calls.find((c) => c.path === "chat/completions").body.response_format, undefined);
    assert.ok(!f.messages.some((m) => m.msg?.type === "reproject"));
  } finally {
    f.hub.dispose();
  }
});

test("'GPT, clear your drawings' removes only GPT's marks", async () => {
  const f = setup();
  try {
    const room = f.store.room(f.h.room.id);
    room.spatialStrokes = [
      { id: "a", ownerId: GPT_ACTOR.id, points: [] },
      { id: "b", ownerId: f.host.id, points: [] },
    ];
    const calls = mockOpenAI("GPT, clear your drawings.", "unused");
    const r = await ask(f);
    assert.equal(r.cleared, 1);
    assert.deepEqual(room.spatialStrokes.map((s) => s.id), ["b"]);
    assert.ok(!calls.some((c) => c.path === "chat/completions"));
  } finally {
    f.hub.dispose();
  }
});
