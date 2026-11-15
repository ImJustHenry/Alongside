import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import { z } from "zod";
import { initialObjects, COLORS, TASK } from "../shared/model.js";
import { spatialAction, strokeSchema } from "./liveview.js";

export const hash = (s) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(24).toString("base64url");
export const point = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    p: z.number().min(0).max(1).optional(),
  })
  .strict();
export const annotationSchema = z
  .object({
    type: z.enum(["pen", "arrow", "circle", "label"]),
    points: z.array(point).min(1).max(512),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#a0609c"),
    width: z.number().min(1).max(16).default(4),
    text: z.string().max(240).default(""),
    anchorId: z.enum(["base", "bridge", "cap"]).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (["circle", "arrow"].includes(a.type) && a.points.length < 2)
      ctx.addIssue({ code: "custom", message: "Two points required" });
    if (a.type === "label" && !a.text.trim())
      ctx.addIssue({ code: "custom", message: "Label text required" });
  });
export class Fault extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function check(v, msg, status = 400) {
  if (!v) throw new Fault(msg, status);
}
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanName = (x) => z.string().trim().min(1).max(48).parse(x);

export class Store extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.rooms = new Map();
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      check(data.version === 1, "Unsupported state file");
      for (const r of data.rooms) this.rooms.set(r.id, r);
    }
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(
      this.file + ".tmp",
      JSON.stringify({ version: 1, rooms: [...this.rooms.values()] }),
      { mode: 0o600 },
    );
    renameSync(this.file + ".tmp", this.file);
  }
  room(id) {
    const r = this.rooms.get(String(id).toUpperCase());
    check(r, "Room not found", 404);
    return r;
  }
  snapshot(id) {
    const r = this.room(id);
    return {
      id: r.id,
      title: r.title,
      task: TASK,
      revision: r.revision,
      eventSeq: r.eventSeq,
      created: r.created,
      aiEnabled: r.aiEnabled,
      collaborativeWriting: r.collaborativeWriting !== false,
      objects: r.objects,
      annotations: r.annotations,
      spatialStrokes: r.spatialStrokes || [],
      messages: r.messages,
      members: Object.values(r.members).map(({ id, name, color, role }) => ({
        id,
        name,
        color,
        role,
      })),
      agents: Object.values(r.agents).map(
        ({ id, name, ownerId, active, expires }) => ({
          id,
          name,
          ownerId,
          active,
          expires,
        }),
      ),
    };
  }
  create(name, title = "Shared studio") {
    check(this.rooms.size < 100, "Server room limit reached", 429);
    let id;
    do {
      id = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    } while (this.rooms.has(id));
    const memberToken = secret(),
      invite = secret(),
      memberId = randomUUID();
    const member = {
      id: memberId,
      name: cleanName(name),
      role: "host",
      color: COLORS[0],
      tokenHash: hash(memberToken),
    };
    this.rooms.set(id, {
      id,
      title: cleanName(title),
      created: Date.now(),
      revision: 0,
      eventSeq: 0,
      aiEnabled: true,
      collaborativeWriting: true,
      inviteHash: hash(invite),
      members: { [memberId]: member },
      agents: {},
      objects: initialObjects(),
      annotations: [],
      messages: [],
      events: [],
    });
    this.save();
    return {
      room: this.snapshot(id),
      member: {
        id: memberId,
        name: member.name,
        role: member.role,
        color: member.color,
      },
      token: memberToken,
      invite,
    };
  }
  join(id, invite, name) {
    const r = this.room(id);
    check(
      equal(hash(String(invite || "")), r.inviteHash),
      "Invalid invitation",
      403,
    );
    check(
      Object.keys(r.members).length < 40,
      "Room participant limit reached",
      429,
    );
    const token = secret(),
      member = {
        id: randomUUID(),
        name: cleanName(name),
        role: "member",
        color: COLORS[Object.keys(r.members).length % COLORS.length],
        tokenHash: hash(token),
      };
    r.members[member.id] = member;
    this.record(r, member, "participant.joined", { name: member.name });
    return {
      room: this.snapshot(id),
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        color: member.color,
      },
      token,
    };
  }
  auth(id, token) {
    const r = this.room(id),
      h = hash(String(token || ""));
    const m = Object.values(r.members).find((x) => equal(x.tokenHash, h));
    if (m) return { ...m, kind: "human" };
    const a = Object.values(r.agents).find(
      (x) => equal(x.tokenHash, h) && x.active && x.expires > Date.now(),
    );
    check(a, "Unauthorized or expired token", 401);
    check(r.aiEnabled, "AI access is paused by the host", 403);
    return { ...a, kind: "ai", role: "agent", color: "#a0609c" };
  }
  record(r, actor, type, data = {}) {
    r.revision++;
    r.eventSeq++;
    r.events.push({
      seq: r.eventSeq,
      at: Date.now(),
      type,
      actorId: actor.id,
      actorKind: actor.kind || "human",
      data,
    });
    r.events = r.events.slice(-250);
    this.save();
    this.emit("change", r.id, this.snapshot(r.id), r.events.at(-1));
  }
  // Room policy: when collaboration is off, only the human host edits the board.
  // AI guidance/chat, viewing, invitations and exports remain available.
  canWrite(id, actor) {
    return (
      this.room(id).collaborativeWriting !== false ||
      (actor.kind === "human" && actor.role === "host")
    );
  }
  assertCanWrite(id, actor) {
    check(
      this.canWrite(id, actor),
      "Collaborative writing is off. Only the host can edit the board.",
      403,
    );
  }
  addAnnotations(id, actor, input, expectedRevision) {
    this.assertCanWrite(id, actor);
    const r = this.room(id);
    if (actor.kind === "ai") check(r.aiEnabled, "AI is paused", 403);
    if (expectedRevision !== undefined)
      check(
        expectedRevision === r.revision,
        "Scene changed; read the current state and retry",
        409,
      );
    const anns = z.array(annotationSchema).min(1).max(20).parse(input);
    check(
      r.annotations.length + anns.length <= 400,
      "Board is full. Remove annotations before adding more.",
      409,
    );
    const result = anns.map((a) => ({
      ...a,
      id: randomUUID(),
      ownerId: actor.id,
      ownerName: actor.name,
      source: actor.kind === "ai" ? "ai" : "human",
      at: Date.now(),
    }));
    r.annotations.push(...result);
    this.record(r, actor, "annotations.added", {
      ids: result.map((a) => a.id),
      count: result.length,
    });
    return result;
  }
  action(id, actor, action) {
    const r = this.room(id);
    check(actor.kind === "human", "Human action required", 403);
    check(action && typeof action === "object", "Action required");
    if (spatialAction(this, id, actor, action)) return;
    if (["add", "undo", "erase", "clearMine", "move"].includes(action.type))
      this.assertCanWrite(id, actor);
    switch (action.type) {
      case "collaborativeWriting": {
        check(actor.role === "host", "Host only", 403);
        const value = z.boolean().parse(action.value);
        if (r.collaborativeWriting === value) return;
        r.collaborativeWriting = value;
        this.record(r, actor, "collaboration.writing", { enabled: value });
        return;
      }
      case "add":
        this.addAnnotations(id, actor, [action.annotation]);
        return;
      case "undo": {
        const a = [...r.annotations]
          .reverse()
          .find((x) => x.ownerId === actor.id);
        if (a) {
          r.annotations = r.annotations.filter((x) => x.id !== a.id);
          this.record(r, actor, "annotation.removed", { id: a.id });
        }
        return;
      }
      case "erase": {
        const a = r.annotations.find((x) => x.id === action.id);
        check(a, "Annotation not found", 404);
        check(
          a.ownerId === actor.id || actor.role === "host",
          "Only the author or host can erase this mark",
          403,
        );
        r.annotations = r.annotations.filter((x) => x.id !== a.id);
        this.record(r, actor, "annotation.removed", { id: a.id });
        return;
      }
      case "clearMine":
        r.annotations = r.annotations.filter((x) => x.ownerId !== actor.id);
        this.record(r, actor, "annotations.cleared");
        return;
      case "move": {
        const p = point.parse(action.position),
          o = r.objects.find((x) => x.id === action.id);
        check(o, "Unknown object", 404);
        if (action.version !== undefined)
          check(
            action.version === o.version,
            "Object moved; refresh and try again",
            409,
          );
        o.x = Math.max(0.1, Math.min(0.9, p.x));
        o.y = Math.max(0.16, Math.min(0.88, p.y));
        o.version++;
        this.record(r, actor, "object.moved", {
          id: o.id,
          x: o.x,
          y: o.y,
          version: o.version,
        });
        return;
      }
      case "aiEnabled":
        check(actor.role === "host", "Host only", 403);
        r.aiEnabled = z.boolean().parse(action.value);
        this.record(r, actor, "ai.access", { enabled: r.aiEnabled });
        return;
      case "reset":
        check(actor.role === "host", "Host only", 403);
        r.objects = initialObjects();
        r.annotations = [];
        r.spatialStrokes = [];
        r.messages = [];
        this.record(r, actor, "board.reset");
        return;
      case "message":
        this.message(id, actor, action.text);
        return;
      default:
        throw new Fault("Unknown action");
    }
  }
  message(id, actor, text) {
    const r = this.room(id);
    if (actor.kind === "ai") check(r.aiEnabled, "AI is paused", 403);
    text = z.string().trim().min(1).max(2000).parse(text);
    const message = {
      id: randomUUID(),
      at: Date.now(),
      author: actor.name,
      ownerId: actor.id,
      source: actor.kind || "human",
      text,
    };
    r.messages.push(message);
    r.messages = r.messages.slice(-80);
    this.record(r, actor, "guidance.sent", { messageId: message.id });
    return message;
  }
  mintAgent(id, owner, name) {
    check(owner.kind === "human", "Human member required", 403);
    const r = this.room(id);
    check(
      Object.values(r.agents).filter((a) => a.active && a.expires > Date.now())
        .length < 20,
      "Agent limit reached",
      429,
    );
    const token = secret(),
      a = {
        id: randomUUID(),
        name: cleanName(name),
        ownerId: owner.id,
        tokenHash: hash(token),
        active: true,
        expires: Date.now() + 8 * 60 * 60 * 1000,
      };
    r.agents[a.id] = a;
    this.record(r, owner, "agent.created", { id: a.id, name: a.name });
    return { id: a.id, name: a.name, token, expires: a.expires };
  }
  revokeAgent(id, owner, agentId) {
    const r = this.room(id),
      a = r.agents[agentId];
    check(a, "Agent not found", 404);
    check(
      owner.kind === "human" &&
        (owner.role === "host" || a.ownerId === owner.id),
      "Not permitted",
      403,
    );
    a.active = false;
    this.record(r, owner, "agent.revoked", { id: a.id });
  }
  rotateInvite(id, owner) {
    check(owner.role === "host", "Host only", 403);
    const r = this.room(id),
      invite = secret();
    r.inviteHash = hash(invite);
    this.record(r, owner, "invite.rotated");
    return invite;
  }
  events(id, since = 0) {
    const r = this.room(id);
    return {
      events: r.events.filter((e) => e.seq > since),
      latest: r.eventSeq,
      truncated:
        since > 0 && r.events.length > 0 && since < r.events[0].seq - 1,
    };
  }
  removeOwnAI(id, actor) {
    check(actor.kind === "ai", "Agent required", 403);
    this.assertCanWrite(id, actor);
    const r = this.room(id);
    check(r.aiEnabled, "AI is paused", 403);
    r.annotations = r.annotations.filter((a) => a.ownerId !== actor.id);
    r.spatialStrokes = (r.spatialStrokes || []).filter(
      (a) => a.ownerId !== actor.id,
    );
    this.record(r, actor, "agent.annotations.cleared");
  }
  export(id) {
    const s = this.snapshot(id);
    return {
      format: "alongside-board",
      version: 1,
      exportedAt: new Date().toISOString(),
      title: s.title,
      objects: s.objects,
      annotations: s.annotations,
      messages: s.messages,
      spatialStrokes: s.spatialStrokes,
    };
  }
  import(id, owner, data) {
    check(owner.role === "host", "Host only", 403);
    check(
      data?.format === "alongside-board" && data.version === 1,
      "Not an Alongside v1 board",
    );
    const r = this.room(id);
    check(
      Array.isArray(data.annotations) && data.annotations.length <= 400,
      "Too many annotations",
    );
    const anns = data.annotations.map((raw) => {
      const { type, points, color, width, text, anchorId } = raw;
      return annotationSchema.parse({
        type,
        points,
        color,
        width,
        text,
        ...(anchorId ? { anchorId } : {}),
      });
    });
    const positions = z
      .array(
        z.object({
          id: z.enum(["base", "bridge", "cap"]),
          x: z.number().min(0.1).max(0.9),
          y: z.number().min(0.16).max(0.88),
        }),
      )
      .length(3)
      .parse(data.objects.map(({ id, x, y }) => ({ id, x, y })));
    check(
      new Set(positions.map((o) => o.id)).size === 3,
      "Duplicate object IDs",
    );
    const objects = initialObjects().map((o) => ({
      ...o,
      ...positions.find((p) => p.id === o.id),
      version: o.version + 1,
    }));
    const spatial = z
      .array(z.any())
      .max(500)
      .parse(data.spatialStrokes || [])
      .map((raw) =>
        strokeSchema.parse({
          color: raw.color,
          width: raw.width,
          points: raw.points,
          placement: raw.placement || "room",
          ...(raw.anchorId ? { anchorId: raw.anchorId } : {}),
          ...(raw.frameRef >= 0 ? { frameRef: raw.frameRef } : {}),
        }),
      );
    check(
      spatial.reduce((n, s) => n + s.points.length, 0) <= 20000,
      "Spatial point budget exceeded",
    );
    r.objects = objects;
    r.spatialStrokes = spatial.map((s) => ({
      ...s,
      id: randomUUID(),
      ownerId: owner.id,
      ownerName: owner.name,
      source: "human",
      at: Date.now(),
    }));
    r.annotations = anns.map((a) => ({
      ...a,
      id: randomUUID(),
      ownerId: owner.id,
      ownerName: owner.name,
      source: "human",
      at: Date.now(),
    }));
    r.messages = [];
    this.record(r, owner, "board.imported");
  }
}
