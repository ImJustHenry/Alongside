import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
import { Store } from "../server/store.js";
import { FrameHub, packFrame } from "../server/liveview.js";
import { createApp } from "../server/index.js";
import { startSimulation } from "../examples/simulated-camera.mjs";

async function until(fn, label) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out: " + label);
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "alongside-save-test-"));
  const file = join(dir, "rooms.json"),
    store = new Store(file);
  const host = store.create("Host", "Save regression"),
    guest = store.join(host.room.id, host.invite, "Helper");
  const source = {
    room: host.room.id,
    actor: store.auth(host.room.id, host.token),
  };
  const viewer = {
    room: host.room.id,
    actor: store.auth(host.room.id, guest.token),
  };
  const events = [];
  const hub = new FrameHub(store, new Set([source, viewer]), (ws, msg) => {
    events.push(msg);
    if (msg.type === "remoteResult" && msg.strokeId) {
      // An acknowledgement is only useful if the state file already contains
      // the matching stroke. This is checked at the actual send boundary.
      const saved = new Store(file).snapshot(host.room.id).spatialStrokes;
      assert.equal(saved.filter((s) => s.id === msg.strokeId).length, 1);
    }
  });
  hub.start(source);
  const epoch = hub.rooms.get(host.room.id).epoch;
  hub.publish(
    source,
    packFrame(
      {
        type: "frame",
        epoch,
        seq: 1,
        ts: Date.now(),
        w: 640,
        h: 480,
        intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
        pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
        calibration: "estimated",
        source: "simulation",
        overlays: [],
        hands: [],
      },
      Buffer.from([255, 216, 1, 2, 255, 217]),
    ),
  );
  const request = {
    type: "remoteStroke",
    id: randomUUID(),
    epoch,
    frameSeq: 1,
    phase: "commit",
    points: [
      { u: 0.4, v: 0.5 },
      { u: 0.6, v: 0.5 },
    ],
    color: "#256b62",
    width: 0.006,
  };
  const response = () => ({
    type: "reprojectResult",
    requestId: request.id,
    revision: events.findLast((e) => e.type === "reproject").revision,
    phase: events.findLast((e) => e.type === "reproject").phase,
    points: [
      { x: -0.192, y: 0, z: 1.5 },
      { x: 0.192, y: 0, z: 1.5 },
    ],
    placement: "fixed-distance",
  });
  return {
    dir,
    file,
    store,
    host,
    guest,
    source,
    viewer,
    hub,
    request,
    response,
    events,
    close() {
      hub.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("remote save acknowledgement follows disk persistence, with original attribution", () => {
  const f = fixture();
  try {
    f.hub.request(f.viewer, f.request);
    f.hub.resolve(f.source, f.response());
    const ack = f.events.findLast((e) => e.type === "remoteResult");
    assert.ok(ack.strokeId);
    const saved = new Store(f.file).snapshot(f.host.room.id).spatialStrokes;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].ownerId, f.viewer.actor.id);
    assert.equal(saved[0].ownerName, "Helper");
    assert.equal(saved[0].source, "remote");
    assert.equal(saved[0].frameRef, 1);
    // JSON intentionally omits optional undefined fields such as anchorId.
    assert.deepEqual(
      saved,
      JSON.parse(
        JSON.stringify(f.store.snapshot(f.host.room.id).spatialStrokes),
      ),
    );
    const persisted = JSON.parse(readFileSync(f.file, "utf8"));
    assert.equal(persisted.rooms[0].frames, undefined);
    assert.equal(persisted.rooms[0].latest, undefined);
  } finally {
    f.close();
  }
});

test("preview is not saved; commit is saved once; undo remains removed after reload", () => {
  const f = fixture();
  try {
    f.hub.request(f.viewer, { ...f.request, phase: "preview" });
    f.hub.resolve(f.source, f.response());
    assert.equal(
      new Store(f.file).snapshot(f.host.room.id).spatialStrokes.length,
      0,
    );
    f.hub.request(f.viewer, f.request);
    const response = f.response();
    f.hub.resolve(f.source, response);
    assert.throws(
      () => f.hub.resolve(f.source, response),
      /Unknown reprojection/,
    );
    assert.equal(
      new Store(f.file).snapshot(f.host.room.id).spatialStrokes.length,
      1,
    );
    f.store.action(f.host.room.id, f.viewer.actor, { type: "spatial.undo" });
    assert.equal(
      new Store(f.file).snapshot(f.host.room.id).spatialStrokes.length,
      0,
    );
  } finally {
    f.close();
  }
});

async function listen(file) {
  const runtime = await createApp({ file });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  return { runtime, base: "http://127.0.0.1:" + runtime.server.address().port };
}
async function memberSocket(base, roomId, token) {
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/live"),
    messages = [];
  socket.on("message", (raw, binary) => {
    if (!binary) messages.push(JSON.parse(raw));
  });
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "auth", room: roomId, token }));
  await until(
    () => messages.find((m) => m.type === "state"),
    "authenticated snapshot",
  );
  return { socket, messages };
}

test("real WebSocket commit survives full server restart and re-authentication", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alongside-restart-test-")),
    file = join(dir, "rooms.json");
  let current, sim, guestSocket;
  try {
    current = await listen(file);
    sim = await startSimulation(current.base);
    const id = sim.room.room.id;
    const guest = current.runtime.store.join(
      id,
      sim.room.invite,
      "Restart helper",
    );
    guestSocket = await memberSocket(current.base, id, guest.token);
    const frame = await until(
      () => current.runtime.hub.rooms.get(id)?.latest?.meta,
      "simulated camera frame",
    );
    const requestId = randomUUID();
    guestSocket.socket.send(
      JSON.stringify({
        type: "remoteStroke",
        id: requestId,
        epoch: frame.epoch,
        frameSeq: frame.seq,
        phase: "commit",
        color: "#256b62",
        width: 0.006,
        points: [
          { u: 0.4, v: 0.5 },
          { u: 0.6, v: 0.5 },
        ],
      }),
    );
    const ack = await until(
      () =>
        guestSocket.messages.find(
          (m) => m.type === "remoteResult" && m.id === requestId,
        ),
      "commit acknowledgement",
    );
    assert.equal(ack.error, undefined);
    const saved = JSON.parse(
      JSON.stringify(current.runtime.store.snapshot(id).spatialStrokes),
    );
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, ack.strokeId);
    guestSocket.socket.close();
    sim.stop();
    sim = null;
    await current.runtime.close();
    current = null;
    current = await listen(file);
    guestSocket = await memberSocket(current.base, id, guest.token);
    const restored = guestSocket.messages.find((m) => m.type === "state").state
      .spatialStrokes;
    assert.deepEqual(restored, saved);
    assert.equal(
      current.runtime.hub.status(id).live,
      false,
      "camera must not resume without consent",
    );
    const result = await fetch(current.base + "/api/rooms/" + id + "/actions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + guest.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "spatial.undo" }),
    });
    assert.equal(result.status, 200);
    assert.equal(new Store(file).snapshot(id).spatialStrokes.length, 0);
  } finally {
    guestSocket?.socket.close();
    sim?.stop();
    if (current) await current.runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
