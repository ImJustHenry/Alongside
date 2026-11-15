// iPad air drawing (0.1.18): remote strokes may carry mode "air"; the server forwards it to the headset.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FrameHub, packFrame, remoteSchema } from "../server/liveview.js";
import { Store } from "../server/store.js";

const jpeg = Buffer.from([255, 216, 1, 2, 3, 4, 255, 217]);
function setup() {
  const store = new Store(null), h = store.create("Host", "Test"), g = store.join(h.room.id, h.invite, "Helper");
  const host = store.auth(h.room.id, h.token), guest = store.auth(h.room.id, g.token), messages = [];
  const source = { room: h.room.id, actor: host, readyState: 1, send() {} };
  const viewer = { room: h.room.id, actor: guest, readyState: 1, send() {} };
  const hub = new FrameHub(store, new Set([source, viewer]), (ws, msg) => messages.push({ ws, msg }));
  hub.start(source);
  const epoch = hub.rooms.get(h.room.id).epoch;
  hub.publish(source, packFrame({ type: "frame", epoch, seq: 1, ts: Date.now(), w: 640, h: 480, intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 }, pose: { p: [0, 0, 0], q: [0, 0, 0, 1] }, calibration: "estimated", source: "simulation", overlays: [], hands: [] }, jpeg));
  return { hub, viewer, source, epoch, messages };
}
const stroke = (epoch, extra = {}) => ({ type: "remoteStroke", id: randomUUID(), frameSeq: 1, epoch, phase: "commit", points: [{ u: 0.4, v: 0.5 }, { u: 0.6, v: 0.5 }], color: "#da6b45", width: 0.006, ...extra });

test("air mode is accepted and forwarded to the headset", () => {
  const f = setup();
  try {
    f.hub.request(f.viewer, stroke(f.epoch, { mode: "air" }));
    const rq = f.messages.findLast((m) => m.msg?.type === "reproject");
    assert.equal(rq.ws, f.source);
    assert.equal(rq.msg.mode, "air");
  } finally { f.hub.dispose(); }
});

test("strokes without a mode (older iPad apps) default to surface", () => {
  const f = setup();
  try {
    f.hub.request(f.viewer, stroke(f.epoch));
    assert.equal(f.messages.findLast((m) => m.msg?.type === "reproject").msg.mode, "surface");
  } finally { f.hub.dispose(); }
});

test("unknown modes are rejected", () => {
  assert.throws(() => remoteSchema.parse(stroke(randomUUID(), { mode: "underwater" })));
});
