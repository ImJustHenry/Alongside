import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { once } from "node:events";
import { createApp } from "../server/index.js";
import {
  FrameHub,
  LatestFrameSender,
  packFrame,
  unpackFrame,
  strokeSchema,
  remoteSchema,
  addStroke,
} from "../server/liveview.js";
import { Store } from "../server/store.js";
import { askFrame } from "../server/liveview-ai.js";
const jpeg = Buffer.from([255, 216, 1, 2, 3, 4, 255, 217]);
function metadata(epoch, seq = 1) {
  return {
    type: "frame",
    epoch,
    seq,
    ts: Date.now(),
    w: 640,
    h: 480,
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
    pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
    calibration: "estimated",
    source: "simulation",
    overlays: [],
    hands: [],
  };
}
function fixture() {
  const store = new Store(null),
    h = store.create("Host", "Test"),
    g = store.join(h.room.id, h.invite, "Helper"),
    host = store.auth(h.room.id, h.token),
    guest = store.auth(h.room.id, g.token),
    clients = new Set(),
    messages = [];
  const source = { room: h.room.id, actor: host, readyState: 1, send() {} },
    viewer = {
      room: h.room.id,
      actor: guest,
      readyState: 1,
      watchLive: true,
      send(b, o, done) {
        messages.push({ binary: b });
        done?.();
      },
    };
  clients.add(source);
  clients.add(viewer);
  const hub = new FrameHub(store, clients, (ws, msg) =>
    messages.push({ ws, msg }),
  );
  hub.start(source);
  const epoch = hub.rooms.get(h.room.id).epoch;
  hub.publish(source, packFrame(metadata(epoch), jpeg));
  return { store, h, g, host, guest, source, viewer, hub, epoch, messages };
}
const ink = {
  color: "#da6b45",
  width: 0.006,
  points: [
    { x: 0, y: 1, z: 2 },
    { x: 0.2, y: 1, z: 2 },
  ],
  placement: "room",
};
function remote(f, extra = {}) {
  return {
    type: "remoteStroke",
    id: randomUUID(),
    frameSeq: 1,
    epoch: f.epoch,
    phase: "commit",
    points: [
      { u: 0.5, v: 0.5 },
      { u: 0.6, v: 0.5 },
    ],
    color: "#256b62",
    width: 0.006,
    ...extra,
  };
}
function reproject(f, a) {
  const msg = f.messages.findLast((m) => m.msg?.type === "reproject")?.msg;
  return {
    type: "reprojectResult",
    requestId: a.id,
    revision: msg.revision,
    phase: a.phase,
    points: a.points.map((p) => ({
      x: ((p.u * 640 - 320) / 500) * 2,
      y: ((240 - p.v * 480) / 500) * 2,
      z: 2,
    })),
    placement: "fixed-distance",
  };
}
test("binary frame roundtrip and bounded metadata", () => {
  const m = metadata(randomUUID()),
    p = packFrame(m, jpeg),
    r = unpackFrame(p);
  assert.deepEqual(r.meta, m);
  assert.deepEqual(r.jpeg, jpeg);
});
test("oversized frame and invalid header are rejected", () => {
  assert.throws(() => unpackFrame(Buffer.alloc(700001)), /size/);
  assert.throws(
    () =>
      unpackFrame(Buffer.from([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0])),
    /header/,
  );
});
test("JPEG signature, intrinsics and quaternion are validated", () => {
  const m = metadata(randomUUID());
  assert.throws(
    () => unpackFrame(packFrame(m, Buffer.from("not jpeg"))),
    /JPEG/,
  );
  assert.throws(() =>
    unpackFrame(
      packFrame({ ...m, intrinsics: { ...m.intrinsics, fx: 0 } }, jpeg),
    ),
  );
  assert.throws(() =>
    unpackFrame(
      packFrame({ ...m, pose: { p: [0, 0, 0], q: [0, 0, 0, 0] } }, jpeg),
    ),
  );
});
test("spatial schema rejects spoofed attribution and excessive coordinates", () => {
  assert.throws(() => strokeSchema.parse({ ...ink, ownerId: "other" }));
  assert.throws(() =>
    strokeSchema.parse({ ...ink, points: [{ x: 50, y: 0, z: 0 }] }),
  );
});
test("spatial ON permits attributed room-space hand strokes", () => {
  const f = fixture();
  try {
    const s = addStroke(f.store, f.h.room.id, f.host, ink);
    assert.equal(s.ownerName, "Host");
    assert.equal(s.source, "human");
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 1);
  } finally {
    f.hub.dispose();
  }
});
test("spatial OFF blocks the host hands, helper and AI while preserving old 2D host policy", () => {
  const f = fixture();
  try {
    f.store.action(f.h.room.id, f.host, {
      type: "collaborativeWriting",
      value: false,
    });
    for (const a of [f.host, f.guest])
      assert.throws(() => addStroke(f.store, f.h.room.id, a, ink), /OFF/);
    const ag = f.store.mintAgent(f.h.room.id, f.host, "AI"),
      a = f.store.auth(f.h.room.id, ag.token);
    assert.throws(() => addStroke(f.store, f.h.room.id, a, ink), /OFF/);
    f.store.addAnnotations(f.h.room.id, f.host, [
      { type: "pen", color: "#256b62", width: 4, points: [{ x: 0.5, y: 0.5 }] },
    ]);
  } finally {
    f.hub.dispose();
  }
});
test("spatial undo/erase respects ownership", () => {
  const f = fixture();
  try {
    const a = addStroke(f.store, f.h.room.id, f.host, ink);
    assert.throws(
      () =>
        f.store.action(f.h.room.id, f.guest, {
          type: "spatial.erase",
          id: a.id,
        }),
      /author/,
    );
    addStroke(f.store, f.h.room.id, f.guest, ink);
    f.store.action(f.h.room.id, f.guest, { type: "spatial.undo" });
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 1);
  } finally {
    f.hub.dispose();
  }
});
test("spatial export/import is validated and reattributed without importing permissions", () => {
  const f = fixture();
  try {
    addStroke(f.store, f.h.room.id, f.guest, ink);
    const out = f.store.export(f.h.room.id);
    f.store.import(f.h.room.id, f.host, out);
    assert.equal(
      f.store.snapshot(f.h.room.id).spatialStrokes[0].ownerId,
      f.host.id,
    );
  } finally {
    f.hub.dispose();
  }
});
test("only human host may publish a stream", () => {
  const f = fixture();
  try {
    assert.throws(() => f.hub.start(f.viewer), /host/);
    assert.throws(
      () => f.hub.publish(f.viewer, packFrame(metadata(f.epoch, 2), jpeg)),
      /authorized/,
    );
  } finally {
    f.hub.dispose();
  }
});
test("frame fan-out is room scoped and requires an authenticated subscribed viewer", () => {
  const f = fixture();
  try {
    let leaked = false;
    f.hub.clients.add({
      room: "OTHER",
      actor: f.guest,
      watchLive: true,
      readyState: 1,
      send() {
        leaked = true;
      },
    });
    f.hub.clients.add({
      room: f.h.room.id,
      watchLive: true,
      readyState: 1,
      send() {
        leaked = true;
      },
    });
    f.hub.rooms.get(f.h.room.id).lastAt = 0;
    f.hub.publish(f.source, packFrame(metadata(f.epoch, 2), jpeg));
    assert.equal(leaked, false);
    assert.ok(f.messages.some((x) => x.binary));
  } finally {
    f.hub.dispose();
  }
});
test("FPS limit drops surplus frames; duplicate sequence is rejected", () => {
  const f = fixture();
  try {
    assert.equal(
      f.hub.publish(f.source, packFrame(metadata(f.epoch, 2), jpeg)),
      false,
    );
    f.hub.rooms.get(f.h.room.id).lastAt = 0;
    assert.throws(
      () => f.hub.publish(f.source, packFrame(metadata(f.epoch, 1), jpeg)),
      /Stale/,
    );
  } finally {
    f.hub.dispose();
  }
});
test("slow viewer keeps only one in-flight and the latest pending frame", () => {
  const sent = [],
    done = [];
  const queue = new LatestFrameSender((b, cb) => {
    sent.push(b);
    done.push(cb);
  });
  queue.offer("one");
  queue.offer("two");
  queue.offer("three");
  assert.deepEqual(sent, ["one"]);
  assert.equal(queue.pending, "three");
  assert.equal(queue.dropped, 1);
  done.shift()();
  assert.deepEqual(sent, ["one", "three"]);
});
test("stop clears latest frame and pending frames without persisting JPEG", () => {
  const f = fixture();
  try {
    assert.ok(
      !JSON.stringify(f.store.export(f.h.room.id)).includes(
        jpeg.toString("base64"),
      ),
    );
    f.hub.stop(f.h.room.id, f.host);
    assert.equal(f.hub.status(f.h.room.id).live, false);
    assert.equal(f.hub.rooms.size, 0);
  } finally {
    f.hub.dispose();
  }
});
test("remoteStroke schema rejects outside-frame points and injected source names", () => {
  const f = fixture();
  try {
    assert.throws(() =>
      remoteSchema.parse(remote(f, { points: [{ u: 1.1, v: 0 }] })),
    );
    assert.throws(() =>
      remoteSchema.parse({ ...remote(f), ownerName: "Host" }),
    );
  } finally {
    f.hub.dispose();
  }
});
test("frame-referenced helper stroke is reprojected and attributed by the server", () => {
  const f = fixture();
  try {
    const a = remote(f);
    f.hub.request(f.viewer, a);
    f.hub.resolve(f.source, reproject(f, a));
    const s = f.store.snapshot(f.h.room.id).spatialStrokes[0];
    assert.equal(s.ownerId, f.guest.id);
    assert.equal(s.source, "remote");
    assert.equal(s.placement, "fixed-distance");
    assert.equal(s.points[0].z, 2);
  } finally {
    f.hub.dispose();
  }
});
test("a stale frame cannot start a new helper stroke", () => {
  const f = fixture();
  try {
    f.hub.rooms.get(f.h.room.id).frames.get(1).receivedAt -= 3000;
    assert.throws(() => f.hub.request(f.viewer, remote(f)), /stale/);
  } finally {
    f.hub.dispose();
  }
});
test("a preview pins its frame until commit even after rolling history expiry", () => {
  const f = fixture();
  try {
    const a = remote(f, { phase: "preview" });
    f.hub.request(f.viewer, a);
    f.hub.rooms.get(f.h.room.id).frames.clear();
    f.hub.request(f.viewer, { ...a, phase: "commit" });
    f.hub.resolve(f.source, reproject(f, { ...a, phase: "commit" }));
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 1);
  } finally {
    f.hub.dispose();
  }
});
test("wrong resolver, frame epoch, request owner and point count are rejected", () => {
  const f = fixture();
  try {
    const a = remote(f);
    f.hub.request(f.viewer, a);
    assert.throws(() => f.hub.resolve(f.viewer, reproject(f, a)), /Source/);
    assert.throws(
      () => f.hub.request(f.viewer, remote(f, { epoch: randomUUID() })),
      /changed/,
    );
    assert.throws(
      () =>
        f.hub.resolve(f.source, {
          ...reproject(f, a),
          points: [{ x: 0, y: 0, z: 2 }],
        }),
      /count/,
    );
  } finally {
    f.hub.dispose();
  }
});
test("late preview resolution cannot replace the newer commit", () => {
  const f = fixture();
  try {
    const a = remote(f, { phase: "preview" });
    f.hub.request(f.viewer, a);
    const old = reproject(f, a);
    f.hub.request(f.viewer, { ...a, phase: "commit" });
    f.hub.resolve(f.source, old);
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 0);
    f.hub.resolve(f.source, reproject(f, { ...a, phase: "commit" }));
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 1);
  } finally {
    f.hub.dispose();
  }
});
test("writing OFF during a request prevents its eventual commit", () => {
  const f = fixture();
  try {
    const a = remote(f);
    f.hub.request(f.viewer, a);
    f.store.action(f.h.room.id, f.host, {
      type: "collaborativeWriting",
      value: false,
    });
    assert.throws(() => f.hub.resolve(f.source, reproject(f, a)), /OFF/);
    assert.equal(f.store.snapshot(f.h.room.id).spatialStrokes.length, 0);
  } finally {
    f.hub.dispose();
  }
});
test("AI token revocation prevents pending frame annotation completion", () => {
  const f = fixture();
  try {
    const token = f.store.mintAgent(f.h.room.id, f.host, "AI"),
      agent = f.store.auth(f.h.room.id, token.token),
      a = remote(f);
    f.hub.request(f.viewer, a, agent);
    f.store.revokeAgent(f.h.room.id, f.host, token.id);
    assert.throws(() => f.hub.resolve(f.source, reproject(f, a)), /revoked/);
  } finally {
    f.hub.dispose();
  }
});
test("capture recording permission is host controlled and expires", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.hub.control(f.viewer, { type: "capturePermit" }),
      /Host/,
    );
    f.hub.control(f.source, { type: "capturePermit" });
    assert.ok(f.hub.status(f.h.room.id).captureUntil > Date.now());
  } finally {
    f.hub.dispose();
  }
});
test("disconnecting a helper cancels its outstanding preview", () => {
  const f = fixture();
  try {
    const a = remote(f, { phase: "preview" });
    f.hub.request(f.viewer, a);
    f.hub.disconnect(f.viewer);
    assert.equal(f.hub.rooms.get(f.h.room.id).pending.size, 0);
    assert.ok(f.messages.some((x) => x.msg?.type === "remoteCancel"));
  } finally {
    f.hub.dispose();
  }
});
let runtime, base;
before(async () => {
  runtime = await createApp({ file: null });
  await new Promise((r) => runtime.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + runtime.server.address().port;
});
after(async () => runtime.close());
test("real /live socket authenticates binary frames and relays only to subscribed room members", async () => {
  const h = runtime.store.create("Host", "Network"),
    g = runtime.store.join(h.room.id, h.invite, "Helper"),
    a = new WebSocket(base.replace("http", "ws") + "/live"),
    b = new WebSocket(base.replace("http", "ws") + "/live");
  try {
    await Promise.all([once(a, "open"), once(b, "open")]);
    let epoch;
    const received = [];
    a.on("message", (raw, binary) => {
      if (!binary) {
        const m = JSON.parse(raw);
        if (m.type === "streamStarted") epoch = m.epoch;
      }
    });
    b.on("message", (raw, binary) => {
      if (binary) received.push(unpackFrame(raw));
    });
    a.send(JSON.stringify({ type: "auth", room: h.room.id, token: h.token }));
    b.send(JSON.stringify({ type: "auth", room: h.room.id, token: g.token }));
    b.send(JSON.stringify({ type: "watchLive", enabled: true }));
    a.send(JSON.stringify({ type: "streamStart" }));
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(epoch);
    a.send(packFrame(metadata(epoch), jpeg));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(received.length, 1);
    assert.equal(received[0].meta.seq, 1);
  } finally {
    a.close();
    b.close();
  }
});
test("frame AI requires explicit consent and does not pretend scripted guidance is vision", async () => {
  const h = runtime.store.create("Host", "AI"),
    a = runtime.store.auth(h.room.id, h.token);
  await assert.rejects(() =>
    askFrame(runtime.hub, runtime.ai, runtime.store, h.room.id, a, {
      prompt: "Look",
    }),
  );
  runtime.store.action(h.room.id, a, { type: "aiEnabled", value: false });
  const paused = await askFrame(
    runtime.hub,
    runtime.ai,
    runtime.store,
    h.room.id,
    a,
    { prompt: "Look", consent: true },
  );
  assert.equal(paused.paused, true);
  assert.match(paused.text, /No image/);
});
