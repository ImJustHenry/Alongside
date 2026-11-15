import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/index.js";
import { Store } from "../server/store.js";
const dir = mkdtempSync(join(tmpdir(), "alongside-writing-"));
let runtime, base;
before(async () => {
  runtime = await createApp({ file: join(dir, "rooms.json") });
  await new Promise((r) => runtime.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${runtime.server.address().port}`;
});
after(async () => {
  await runtime.close();
  rmSync(dir, { recursive: true, force: true });
});
const pen = {
  type: "pen",
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.3 },
  ],
};
function fixture() {
  const h = runtime.store.create("Host", "Writing toggle");
  const g = runtime.store.join(h.room.id, h.invite, "Guest");
  const host = runtime.store.auth(h.room.id, h.token),
    guest = runtime.store.auth(h.room.id, g.token);
  const token = runtime.store.mintAgent(h.room.id, host, "Host-owned agent");
  const agent = runtime.store.auth(h.room.id, token.token);
  return { id: h.room.id, h, g, host, guest, token, agent };
}
function set(f, value) {
  runtime.store.action(f.id, f.host, { type: "collaborativeWriting", value });
}
async function post(f, token, body) {
  const r = await fetch(base + `/api/rooms/${f.id}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
async function connectAgent(f) {
  const c = new Client({ name: "writing-test", version: "1.0.0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base + `/mcp/${f.id}`), {
      requestInit: { headers: { authorization: "Bearer " + f.token.token } },
    }),
  );
  return c;
}
async function socket(f, token) {
  const ws = new WebSocket(base.replace("http", "ws") + "/live");
  ws.messages = [];
  ws.on("message", (raw) => ws.messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "auth", room: f.id, token }));
  await until(() => ws.messages.some((m) => m.type === "state"));
  return ws;
}
async function until(fn) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw Error("Timed out waiting for socket update");
}

test("writing defaults ON for new rooms", () => {
  const f = fixture();
  assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, true);
  assert.equal(runtime.store.canWrite(f.id, f.guest), true);
});
test("older persisted rooms without the field preserve ON behavior", () => {
  const f = fixture();
  delete runtime.store.room(f.id).collaborativeWriting;
  runtime.store.save();
  const s = new Store(join(dir, "rooms.json"));
  assert.equal(s.snapshot(f.id).collaborativeWriting, true);
  assert.equal(s.canWrite(f.id, f.guest), true);
});
test("host changes writing mode through the actual HTTP API", async () => {
  const f = fixture();
  const r = await post(f, f.h.token, {
    type: "collaborativeWriting",
    value: false,
  });
  assert.equal(r.status, 200);
  assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, false);
});
test("guest cannot turn collaborative writing off or on", async () => {
  const f = fixture();
  for (const value of [false, true]) {
    const r = await post(f, f.g.token, { type: "collaborativeWriting", value });
    assert.equal(r.status, 403);
    assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, true);
  }
});
test("only a JSON boolean is accepted for the setting", async () => {
  const f = fixture();
  const r = await post(f, f.h.token, {
    type: "collaborativeWriting",
    value: "false",
  });
  assert.equal(r.status, 400);
  assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, true);
});
for (const type of ["pen", "arrow", "circle", "label"])
  test(`OFF blocks collaborator ${type} marks`, async () => {
    const f = fixture();
    set(f, false);
    const r = await post(f, f.g.token, {
      type: "add",
      annotation: { ...pen, type, text: "A label" },
    });
    assert.equal(r.status, 403);
    assert.equal(runtime.store.snapshot(f.id).annotations.length, 0);
  });
for (const type of ["undo", "erase", "clearMine", "move"])
  test(`OFF blocks collaborator ${type} without mutating the board`, async () => {
    const f = fixture();
    const [a] = runtime.store.addAnnotations(f.id, f.guest, [pen]);
    set(f, false);
    const before = JSON.stringify(runtime.store.snapshot(f.id));
    const body =
      type === "move"
        ? { type, id: "base", position: { x: 0.6, y: 0.6 }, version: 0 }
        : { type, id: a.id };
    assert.equal((await post(f, f.g.token, body)).status, 403);
    assert.equal(JSON.stringify(runtime.store.snapshot(f.id)), before);
  });
test("OFF leaves host pen, move, erase, undo and clear controls working", () => {
  const f = fixture();
  set(f, false);
  const [a] = runtime.store.addAnnotations(f.id, f.host, [pen]);
  runtime.store.action(f.id, f.host, { type: "erase", id: a.id });
  runtime.store.addAnnotations(f.id, f.host, [pen]);
  runtime.store.action(f.id, f.host, { type: "undo" });
  runtime.store.addAnnotations(f.id, f.host, [pen]);
  runtime.store.action(f.id, f.host, { type: "clearMine" });
  runtime.store.action(f.id, f.host, {
    type: "move",
    id: "base",
    position: { x: 0.4, y: 0.4 },
    version: 0,
  });
  assert.equal(runtime.store.snapshot(f.id).annotations.length, 0);
  assert.equal(runtime.store.snapshot(f.id).objects[0].x, 0.4);
});
test("OFF permits viewing, guest messages and exports", async () => {
  const f = fixture();
  set(f, false);
  assert.equal(
    (
      await post(f, f.g.token, {
        type: "message",
        text: "Still collaborating verbally.",
      })
    ).status,
    200,
  );
  const view = await fetch(base + `/api/rooms/${f.id}`, {
    headers: { authorization: "Bearer " + f.g.token },
  });
  assert.equal(view.status, 200);
  const exp = await fetch(base + `/api/rooms/${f.id}/export`, {
    headers: { authorization: "Bearer " + f.g.token },
  });
  assert.equal(exp.status, 200);
});
test("OFF blocks AI marks even if that agent belongs to the host", () => {
  const f = fixture();
  set(f, false);
  assert.throws(
    () => runtime.store.addAnnotations(f.id, f.agent, [pen]),
    /Collaborative writing is off/,
  );
});
test("OFF blocks AI deletion and preserves previous annotations", () => {
  const f = fixture();
  runtime.store.addAnnotations(f.id, f.agent, [pen]);
  set(f, false);
  assert.throws(
    () => runtime.store.removeOwnAI(f.id, f.agent),
    /Collaborative writing is off/,
  );
  assert.equal(runtime.store.snapshot(f.id).annotations.length, 1);
});
test("MCP stays readable and can send guidance, but cannot draw while OFF", async () => {
  const f = fixture();
  const c = await connectAgent(f);
  try {
    set(f, false);
    const state = await c.callTool({ name: "get_scene_state", arguments: {} });
    assert.notEqual(state.isError, true);
    assert.equal(JSON.parse(state.content[0].text).collaborativeWriting, false);
    const highlight = await c.callTool({
      name: "highlight_object",
      arguments: {
        objectId: "base",
        expectedRevision: runtime.store.snapshot(f.id).revision,
      },
    });
    assert.equal(highlight.isError, true);
    assert.match(highlight.content[0].text, /Collaborative writing/);
    const guide = await c.callTool({
      name: "send_guidance",
      arguments: { text: "Verbal guidance is available." },
    });
    assert.notEqual(guide.isError, true);
    assert.equal(
      runtime.store.snapshot(f.id).messages.at(-1).text,
      "Verbal guidance is available.",
    );
  } finally {
    await c.close();
  }
});
test("practice guide gives text-only advice while OFF without deleting previous AI marks", async () => {
  const f = fixture();
  await runtime.ai.ask(f.id, f.guest, "First hint");
  const before = JSON.stringify(runtime.store.snapshot(f.id).annotations);
  set(f, false);
  await runtime.ai.ask(f.id, f.guest, "Another hint");
  const state = runtime.store.snapshot(f.id);
  assert.equal(JSON.stringify(state.annotations), before);
  assert.match(state.messages.at(-1).text, /guidance only/);
});
test("AI pause remains separate from collaborative writing", () => {
  const f = fixture();
  set(f, false);
  assert.equal(runtime.store.auth(f.id, f.token.token).kind, "ai");
  runtime.store.action(f.id, f.host, { type: "aiEnabled", value: false });
  assert.throws(
    () => runtime.store.auth(f.id, f.token.token),
    /AI access is paused/,
  );
  runtime.store.addAnnotations(f.id, f.host, [pen]);
});
test("ON restores human and AI drawing without issuing new credentials", () => {
  const f = fixture();
  set(f, false);
  set(f, true);
  runtime.store.addAnnotations(f.id, f.guest, [pen]);
  runtime.store.addAnnotations(f.id, f.agent, [pen]);
  assert.equal(runtime.store.snapshot(f.id).annotations.length, 2);
});
test("server restart restores OFF", () => {
  const f = fixture();
  set(f, false);
  const s = new Store(join(dir, "rooms.json"));
  assert.equal(s.snapshot(f.id).collaborativeWriting, false);
  assert.equal(s.canWrite(f.id, s.auth(f.id, f.g.token)), false);
  assert.equal(s.canWrite(f.id, s.auth(f.id, f.h.token)), true);
});
test("reset and imported board content cannot silently re-enable writing", () => {
  const f = fixture();
  set(f, false);
  const data = { ...runtime.store.export(f.id), collaborativeWriting: true };
  runtime.store.import(f.id, f.host, data);
  assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, false);
  runtime.store.action(f.id, f.host, { type: "reset" });
  assert.equal(runtime.store.snapshot(f.id).collaborativeWriting, false);
});
test("writing mode is isolated between rooms", () => {
  const a = fixture(),
    b = fixture();
  set(a, false);
  assert.equal(runtime.store.snapshot(b.id).collaborativeWriting, true);
  runtime.store.addAnnotations(b.id, b.guest, [pen]);
});
test("repeated identical toggle does not churn revision", () => {
  const f = fixture();
  set(f, false);
  const rev = runtime.store.snapshot(f.id).revision;
  set(f, false);
  assert.equal(runtime.store.snapshot(f.id).revision, rev);
});
test("live peers see mode change, old drafts are cleared, and further previews are denied", async () => {
  const f = fixture();
  const host = await socket(f, f.h.token),
    guest = await socket(f, f.g.token);
  try {
    guest.send(JSON.stringify({ type: "preview", annotation: pen }));
    await until(() => host.messages.some((m) => m.type === "preview"));
    set(f, false);
    await until(() =>
      host.messages.some(
        (m) => m.type === "previewEnd" && m.ownerId === f.g.member.id,
      ),
    );
    await until(() =>
      guest.messages.some(
        (m) => m.type === "state" && m.state.collaborativeWriting === false,
      ),
    );
    const n = host.messages.filter((m) => m.type === "preview").length;
    guest.send(JSON.stringify({ type: "preview", annotation: pen }));
    await until(() =>
      guest.messages.some(
        (m) => m.type === "error" && /Collaborative writing/.test(m.error),
      ),
    );
    assert.equal(host.messages.filter((m) => m.type === "preview").length, n);
    host.send(JSON.stringify({ type: "preview", annotation: pen }));
    await until(() =>
      guest.messages.some(
        (m) => m.type === "preview" && m.ownerId === f.h.member.id,
      ),
    );
    set(f, true);
    guest.send(JSON.stringify({ type: "preview", annotation: pen }));
    await until(
      () => host.messages.filter((m) => m.type === "preview").length === n + 1,
    );
  } finally {
    host.terminate();
    guest.terminate();
  }
});
