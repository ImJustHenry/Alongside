import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Fault } from "./store.js";
export const LIMITS = {
  jpeg: 600000,
  packet: 700000,
  header: 64000,
  fps: 15,
  pending: 20,
  strokes: 500,
  points: 512,
};
const finite = z.number().finite();
export const xyz = z
  .object({
    x: finite.min(-20).max(20),
    y: finite.min(-20).max(20),
    z: finite.min(-20).max(20),
  })
  .strict();
const uv = z
  .object({ u: finite.min(0).max(1), v: finite.min(0).max(1) })
  .strict();
export const strokeSchema = z
  .object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: finite.min(0.001).max(0.03),
    points: z.array(xyz).min(1).max(LIMITS.points),
    anchorId: z.string().max(100).optional(),
    frameRef: z.number().int().nonnegative().optional(),
    placement: z
      .enum(["room", "scene-plane", "fixed-distance"])
      .default("room"),
  })
  .strict();
export const remoteSchema = z
  .object({
    type: z.literal("remoteStroke"),
    id: z.string().uuid(),
    frameSeq: z.number().int().nonnegative(),
    epoch: z.string().uuid(),
    phase: z.enum(["preview", "commit", "cancel"]),
    points: z.array(uv).min(1).max(256),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: finite.min(0.001).max(0.03),
  })
  .strict();
const projection = z.object({
  id: z.string().max(100),
  ownerName: z.string().max(80).default(""),
  source: z.string().max(20).default("human"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  points: z.array(uv).min(1).max(512),
});
export const frameSchema = z
  .object({
    type: z.literal("frame"),
    epoch: z.string().uuid(),
    seq: z.number().int().nonnegative(),
    ts: finite.nonnegative(),
    w: z.number().int().min(64).max(1280),
    h: z.number().int().min(64).max(1280),
    intrinsics: z.object({
      fx: finite.positive().max(10000),
      fy: finite.positive().max(10000),
      cx: finite.min(0).max(1280),
      cy: finite.min(0).max(1280),
    }),
    pose: z.object({
      p: z.array(finite.min(-20).max(20)).length(3),
      q: z.array(finite.min(-1).max(1)).length(4),
    }),
    calibration: z.enum(["measured", "estimated"]),
    source: z.enum(["quest-pca", "quest-webcam", "simulation"]),
    overlays: z.array(projection).max(150).default([]),
    hands: z.array(uv).max(2).default([]),
  })
  .superRefine((m, c) => {
    if (m.intrinsics.cx > m.w || m.intrinsics.cy > m.h)
      c.addIssue({ code: "custom", message: "Principal point outside frame" });
    if (Math.abs(Math.hypot(...m.pose.q) - 1) > 0.03)
      c.addIssue({
        code: "custom",
        message: "Camera quaternion must be normalized",
      });
  });
export function packFrame(meta, jpeg) {
  const json = Buffer.from(JSON.stringify(meta));
  if (json.length > LIMITS.header || jpeg.length > LIMITS.jpeg)
    throw new Fault("Frame too large", 413);
  const h = Buffer.alloc(4);
  h.writeUInt32LE(json.length);
  return Buffer.concat([h, json, jpeg]);
}
export function unpackFrame(input) {
  const b = Buffer.from(input);
  if (b.length > LIMITS.packet || b.length < 12)
    throw new Fault("Bad frame size", 413);
  const n = b.readUInt32LE(0);
  if (n < 2 || n > LIMITS.header || n + 4 >= b.length)
    throw new Fault("Bad frame header");
  const meta = frameSchema.parse(JSON.parse(b.toString("utf8", 4, n + 4))),
    jpeg = b.subarray(n + 4);
  if (
    jpeg.length > LIMITS.jpeg ||
    jpeg[0] !== 255 ||
    jpeg[1] !== 216 ||
    jpeg.at(-2) !== 255 ||
    jpeg.at(-1) !== 217
  )
    throw new Fault("Expected JPEG");
  return { meta, jpeg };
}
export function spatialAllowed(store, id, actor) {
  if (store.room(id).collaborativeWriting === false)
    throw new Fault(
      "Spatial writing is OFF for everyone, including the host.",
      403,
    );
  if (actor.kind === "ai" && !store.room(id).aiEnabled)
    throw new Fault("AI is paused", 403);
}
export function addStroke(store, id, actor, raw) {
  spatialAllowed(store, id, actor);
  const r = store.room(id);
  r.spatialStrokes ??= [];
  if (r.spatialStrokes.length >= LIMITS.strokes)
    throw new Fault("Spatial stroke limit reached");
  if (
    r.spatialStrokes.reduce((n, s) => n + s.points.length, 0) +
      (raw.points?.length || 0) >
    20000
  )
    throw new Fault("Spatial point budget reached");
  const s = {
    ...strokeSchema.parse(raw),
    id: randomUUID(),
    ownerId: actor.id,
    ownerName: actor.name,
    source:
      actor.kind === "ai"
        ? "ai"
        : raw.frameRef !== undefined
          ? "remote"
          : "human",
    at: Date.now(),
  };
  r.spatialStrokes.push(s);
  store.record(r, actor, "spatial.add", { id: s.id });
  return s;
}
export function spatialAction(store, id, actor, a) {
  if (!a?.type?.startsWith("spatial.")) return false;
  spatialAllowed(store, id, actor);
  const r = store.room(id);
  r.spatialStrokes ??= [];
  if (a.type === "spatial.add") addStroke(store, id, actor, a.stroke);
  else {
    let target;
    if (a.type === "spatial.undo")
      target = [...r.spatialStrokes]
        .reverse()
        .find((x) => x.ownerId === actor.id);
    else if (a.type === "spatial.erase") {
      target = r.spatialStrokes.find((x) => x.id === a.id);
      if (target && target.ownerId !== actor.id && actor.role !== "host")
        throw new Fault("Only author or host can erase", 403);
    } else if (a.type === "spatial.clearMine") {
      r.spatialStrokes = r.spatialStrokes.filter((x) => x.ownerId !== actor.id);
      store.record(r, actor, a.type);
      return true;
    } else throw new Fault("Unknown spatial action");
    if (target) {
      r.spatialStrokes = r.spatialStrokes.filter((x) => x.id !== target.id);
      store.record(r, actor, a.type, { id: target.id });
    }
  }
  return true;
}
// At most one in-flight and one latest pending frame per receiver. Old pending frames are discarded.
export class LatestFrameSender {
  constructor(send) {
    this.send = send;
    this.pending = null;
    this.busy = false;
    this.dropped = 0;
  }
  offer(packet) {
    if (this.pending) this.dropped++;
    this.pending = packet;
    this.flush();
  }
  flush() {
    if (this.busy || !this.pending) return;
    const b = this.pending;
    this.pending = null;
    this.busy = true;
    this.send(b, () => {
      this.busy = false;
      this.flush();
    });
  }
  clear() {
    this.pending = null;
  }
}
export class FrameHub {
  constructor(store, clients, send) {
    this.store = store;
    this.clients = clients;
    this.send = send;
    this.rooms = new Map();
    this.timer = setInterval(() => this.sweep(), 250);
    this.timer.unref();
  }
  status(room) {
    const s = this.rooms.get(room);
    return {
      type: "streamStatus",
      live: !!s,
      epoch: s?.epoch || null,
      source: s?.sourceLabel || null,
      receivedAt: s?.latest?.receivedAt || null,
      captureUntil: s?.captureUntil || 0,
    };
  }
  broadcast(room, msg) {
    for (const w of this.clients)
      if (w.actor && w.room === room) this.send(w, msg);
  }
  start(ws) {
    if (ws.actor.kind !== "human" || ws.actor.role !== "host")
      throw new Fault("Only the human host can publish a camera", 403);
    const old = this.rooms.get(ws.room);
    if (old && old.source !== ws)
      throw new Fault("Another source is active. Stop it first.", 409);
    if (old) return this.send(ws, { type: "streamStarted", epoch: old.epoch });
    const s = {
      source: ws,
      epoch: randomUUID(),
      frames: new Map(),
      pending: new Map(),
      latest: null,
      lastSeq: -1,
      lastAt: 0,
    };
    this.rooms.set(ws.room, s);
    this.send(ws, { type: "streamStarted", epoch: s.epoch });
    this.broadcast(ws.room, this.status(ws.room));
  }
  stop(room, actor) {
    if (actor.role !== "host") throw new Fault("Host only", 403);
    const s = this.rooms.get(room);
    if (s) this.send(s.source, { type: "streamStop" });
    this.rooms.delete(room);
    for (const w of this.clients) if (w.room === room) w.frameSender?.clear();
    this.broadcast(room, { type: "streamStatus", live: false });
  }
  publish(ws, packet) {
    const s = this.rooms.get(ws.room);
    if (!s || s.source !== ws || !ws.actor)
      throw new Fault("Not the authorized source", 403);
    const now = Date.now();
    if (now - s.lastAt < 1000 / LIMITS.fps) return false;
    const { meta, jpeg } = unpackFrame(packet);
    if (meta.epoch !== s.epoch || meta.seq <= s.lastSeq)
      throw new Fault("Stale stream/frame", 409);
    s.lastSeq = meta.seq;
    s.lastAt = now;
    s.sourceLabel = meta.source;
    const receivedAt = now;
    s.latest = { meta, jpeg, receivedAt };
    s.frames.set(meta.seq, { meta, receivedAt });
    for (const [id, f] of s.frames)
      if (now - f.receivedAt > 2200) s.frames.delete(id);
    const payload = packFrame({ ...meta, receivedAt }, jpeg);
    for (const other of this.clients) {
      if (
        other === ws ||
        other.room !== ws.room ||
        !other.actor ||
        !other.watchLive
      )
        continue;
      other.frameSender ??= new LatestFrameSender((b, done) => {
        if (other.readyState !== 1) return done();
        other.send(b, { binary: true }, () => done());
      });
      other.frameSender.offer(payload);
    }
    return true;
  }
  request(ws, raw, actor = ws.actor, pinnedFrame = null) {
    const s = this.rooms.get(ws.room);
    if (!s) throw new Fault("No live camera source", 409);
    spatialAllowed(this.store, ws.room, actor);
    const a = remoteSchema.parse(raw),
      now = Date.now();
    if (a.epoch !== s.epoch)
      throw new Fault("Camera stream changed; start the stroke again", 409);
    let p = s.pending.get(a.id);
    if (
      p &&
      (p.ownerSocket !== ws ||
        p.actor.id !== actor.id ||
        p.meta.seq !== a.frameSeq)
    )
      throw new Fault("Stroke identity/frame mismatch", 403);
    if (a.phase === "cancel") {
      s.pending.delete(a.id);
      this.send(s.source, { type: "remoteCancel", requestId: a.id });
      return;
    }
    if (!p) {
      const f =
        s.frames.get(a.frameSeq) ||
        (pinnedFrame?.meta.seq === a.frameSeq ? pinnedFrame : null);
      if (!f || now - f.receivedAt > (pinnedFrame ? 10000 : 2200))
        throw new Fault("Frame is stale; draw on the current video frame", 409);
      if (s.pending.size >= LIMITS.pending)
        throw new Fault("Too many outstanding strokes", 429);
      p = {
        ownerSocket: ws,
        actor,
        meta: f.meta,
        created: now,
        committed: false,
      };
      s.pending.set(a.id, p);
    }
    if (now - p.created > 10000)
      throw new Fault("Stroke took too long; start again", 409);
    if (p.committed) throw new Fault("Stroke already submitted", 409);
    if (a.phase === "commit") p.committed = true;
    p.color = a.color;
    p.width = a.width;
    p.points = a.points;
    p.revision = (p.revision || 0) + 1;
    this.send(s.source, {
      type: "reproject",
      requestId: a.id,
      revision: p.revision,
      phase: a.phase,
      frame: p.meta,
      points: a.points,
      color: a.color,
      width: a.width,
      ownerId: actor.id,
      ownerName: actor.name,
      source: actor.kind === "ai" ? "ai" : "remote",
    });
  }
  resolve(ws, msg) {
    const s = this.rooms.get(ws.room);
    if (!s || s.source !== ws) throw new Fault("Source only", 403);
    const p = s.pending.get(msg.requestId);
    if (!p) throw new Fault("Unknown reprojection", 404);
    if (msg.revision !== p.revision) return;
    spatialAllowed(this.store, ws.room, p.actor);
    // Built-in GPT companion (server-side, see shizuku.js) has no MCP agent token to check.
    if (p.actor.kind === "ai" && !p.actor.builtin) {
      const agent = this.store.room(ws.room).agents[p.actor.id];
      if (!agent?.active || agent.expires < Date.now())
        throw new Fault("Agent revoked", 403);
    }
    if (msg.error) {
      this.send(p.ownerSocket, {
        type: "remoteResult",
        id: msg.requestId,
        error: String(msg.error).slice(0, 200),
      });
      s.pending.delete(msg.requestId);
      return;
    }
    const raw = strokeSchema.parse({
      color: p.color,
      width: p.width,
      points: msg.points,
      frameRef: p.meta.seq,
      placement: msg.placement,
      anchorId: msg.anchorId || undefined,
    });
    if (raw.points.length !== p.points.length)
      throw new Fault("Reprojection point count mismatch");
    if (msg.phase === "preview") {
      this.broadcast(ws.room, {
        type: "spatialPreview",
        requestId: msg.requestId,
        stroke: {
          ...raw,
          ownerId: p.actor.id,
          ownerName: p.actor.name,
          source: p.actor.kind === "ai" ? "ai" : "remote",
        },
      });
      return;
    }
    if (!p.committed) throw new Fault("No committed request", 409);
    const stroke = addStroke(this.store, ws.room, p.actor, raw);
    s.pending.delete(msg.requestId);
    this.broadcast(ws.room, {
      type: "spatialPreviewEnd",
      requestId: msg.requestId,
    });
    this.send(p.ownerSocket, {
      type: "remoteResult",
      id: msg.requestId,
      strokeId: stroke.id,
      placement: stroke.placement,
      anchorId: stroke.anchorId,
    });
  }
  control(ws, msg) {
    if (msg.type === "capturePermit") {
      if (ws.actor.role !== "host") throw new Fault("Host only", 403);
      const s = this.rooms.get(ws.room);
      if (!s) throw new Fault("No stream", 409);
      s.captureUntil = Date.now() + 15000;
      this.broadcast(ws.room, this.status(ws.room));
      return true;
    }
    if (msg.type === "watchLive") {
      ws.watchLive = !!msg.enabled;
      this.send(ws, this.status(ws.room));
      return true;
    }
    if (msg.type === "streamStart") {
      this.start(ws);
      return true;
    }
    if (msg.type === "streamStop") {
      this.stop(ws.room, ws.actor);
      return true;
    }
    if (msg.type === "remoteStroke") {
      this.request(ws, msg);
      return true;
    }
    if (msg.type === "reprojectResult") {
      this.resolve(ws, msg);
      return true;
    }
    return false;
  }
  changed(room, state) {
    if (!state.collaborativeWriting || !state.aiEnabled) {
      const s = this.rooms.get(room);
      if (s)
        for (const [id, p] of s.pending)
          if (!state.collaborativeWriting || p.actor.kind === "ai") {
            s.pending.delete(id);
            this.send(s.source, { type: "remoteCancel", requestId: id });
            this.broadcast(room, { type: "spatialPreviewEnd", requestId: id });
          }
    }
  }
  disconnect(ws) {
    for (const [room, s] of this.rooms) {
      if (s.source === ws) {
        this.rooms.delete(room);
        this.broadcast(room, { type: "streamStatus", live: false });
      } else
        for (const [id, p] of s.pending)
          if (p.ownerSocket === ws) {
            s.pending.delete(id);
            this.send(s.source, { type: "remoteCancel", requestId: id });
            this.broadcast(room, { type: "spatialPreviewEnd", requestId: id });
          }
    }
    ws.frameSender?.clear();
  }
  sweep() {
    const now = Date.now();
    for (const [room, s] of this.rooms) {
      if (s.latest && now - s.latest.receivedAt > 5000) {
        this.stop(room, { role: "host" });
        continue;
      }
      for (const [id, p] of s.pending)
        if (now - p.created > 10000) {
          s.pending.delete(id);
          this.send(s.source, { type: "remoteCancel", requestId: id });
          this.send(p.ownerSocket, {
            type: "remoteResult",
            id,
            error: "Reprojection expired",
          });
        }
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.rooms.clear();
  }
}
