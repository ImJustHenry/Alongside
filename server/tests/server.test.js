import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/index.js";
import { Store, annotationSchema } from "../server/store.js";
import { buildTools } from "../server/tools.js";
import { runProvider } from "../server/ai.js";
import { makeGuideActions, placed } from "../shared/model.js";

let runtime, base, owner, guest, other, agent, mcp;
const tmp = mkdtempSync(join(tmpdir(), "alongside-test-"));
async function request(
  path,
  { token, method = "GET", body, headers = {} } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: await res.json() };
}
const roomPath = () => `/api/rooms/${owner.room.id}`;
const stroke = {
  type: "pen",
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ],
  color: "#256b62",
  width: 4,
  text: "",
};
function nextMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error("WebSocket event timeout"));
    }, 4000);
    function handler(raw) {
      const m = JSON.parse(raw.toString());
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(m);
      }
    }
    ws.on("message", handler);
  });
}
async function connect(person) {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/live");
  await once(ws, "open");
  const received = nextMessage(ws, (m) => m.type === "state");
  ws.send(
    JSON.stringify({ type: "auth", room: owner.room.id, token: person.token }),
  );
  await received;
  return ws;
}

test.before(async () => {
  runtime = await createApp({ file: join(tmp, "rooms.json") });
  await new Promise((r) => runtime.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${runtime.server.address().port}`;
});
test.after(async () => {
  await mcp?.close();
  await runtime.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("health endpoint identifies build", async () => {
  const r = await request("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.app, "Alongside");
});
test("creates a private room and host", async () => {
  const r = await request("/api/rooms", {
    method: "POST",
    body: { name: "Host", title: "Test studio" },
  });
  assert.equal(r.status, 201);
  owner = r.data;
  assert.equal(owner.member.role, "host");
  assert.ok(owner.invite);
});
test("room rejects missing credentials", async () => {
  assert.equal((await request(roomPath())).status, 401);
});
test("room code alone does not allow joining", async () => {
  assert.equal(
    (
      await request(roomPath() + "/join", {
        method: "POST",
        body: { name: "Guest" },
      })
    ).status,
    403,
  );
});
test("invitation admits a collaborator", async () => {
  const r = await request(roomPath() + "/join", {
    method: "POST",
    body: { name: "Guest", invite: owner.invite },
  });
  assert.equal(r.status, 200);
  guest = r.data;
  assert.equal(guest.member.role, "member");
});
test("different room token cannot access first room", async () => {
  other = (
    await request("/api/rooms", {
      method: "POST",
      body: { name: "Other", title: "Separate" },
    })
  ).data;
  assert.equal((await request(roomPath(), { token: other.token })).status, 401);
});
test("snapshot contains no token material", async () => {
  const { data } = await request(roomPath(), { token: owner.token });
  const text = JSON.stringify(data);
  for (const secret of [owner.token, owner.invite, "tokenHash", "inviteHash"])
    assert.ok(!text.includes(secret));
});
test("host and guest receive real WebSocket annotation updates", async () => {
  const a = await connect(owner),
    b = await connect(guest);
  try {
    const sa = nextMessage(a, (m) => m.event?.type === "annotations.added"),
      sb = nextMessage(b, (m) => m.event?.type === "annotations.added");
    const r = await request(roomPath() + "/actions", {
      token: owner.token,
      method: "POST",
      body: { type: "add", annotation: stroke },
    });
    assert.equal(r.status, 200);
    assert.equal((await sa).state.annotations.length, 1);
    assert.equal((await sb).state.annotations.length, 1);
  } finally {
    a.close();
    b.close();
  }
});
test("live preview is transient, not persisted", async () => {
  const a = await connect(owner),
    b = await connect(guest);
  try {
    const before = runtime.store.room(owner.room.id).annotations.length;
    const p = nextMessage(b, (m) => m.type === "preview");
    a.send(JSON.stringify({ type: "preview", annotation: stroke }));
    assert.equal((await p).annotation.source, "human");
    assert.equal(runtime.store.room(owner.room.id).annotations.length, before);
  } finally {
    a.close();
    b.close();
  }
});
test("rejects malformed normalized coordinates", async () => {
  const r = await request(roomPath() + "/actions", {
    token: owner.token,
    method: "POST",
    body: {
      type: "add",
      annotation: { ...stroke, points: [{ x: 8, y: 0.2 }] },
    },
  });
  assert.equal(r.status, 400);
});
test("rejects arbitrary anchor IDs", () => {
  assert.throws(() =>
    annotationSchema.parse({ ...stroke, anchorId: "secret-object" }),
  );
});
test("requires two points for an arrow", () => {
  assert.throws(() =>
    annotationSchema.parse({
      ...stroke,
      type: "arrow",
      points: [{ x: 0.1, y: 0.2 }],
    }),
  );
});
test("a collaborator cannot erase another person’s drawing", async () => {
  const id = runtime.store.room(owner.room.id).annotations[0].id;
  assert.equal(
    (
      await request(roomPath() + "/actions", {
        token: guest.token,
        method: "POST",
        body: { type: "erase", id },
      })
    ).status,
    403,
  );
});
test("undo removes only the current author’s latest mark", async () => {
  await request(roomPath() + "/actions", {
    token: guest.token,
    method: "POST",
    body: { type: "add", annotation: stroke },
  });
  await request(roomPath() + "/actions", {
    token: guest.token,
    method: "POST",
    body: { type: "undo" },
  });
  assert.equal(runtime.store.room(owner.room.id).annotations.length, 1);
  assert.equal(
    runtime.store.room(owner.room.id).annotations[0].ownerId,
    owner.member.id,
  );
});
test("move updates version and shared exercise progress", async () => {
  const r = await request(roomPath() + "/actions", {
    token: guest.token,
    method: "POST",
    body: {
      type: "move",
      id: "base",
      position: { x: 0.24, y: 0.39 },
      version: 0,
    },
  });
  assert.equal(r.status, 200);
  assert.ok(placed(runtime.store.room(owner.room.id).objects[0]));
});
test("rejects stale object moves", async () => {
  assert.equal(
    (
      await request(roomPath() + "/actions", {
        token: guest.token,
        method: "POST",
        body: {
          type: "move",
          id: "base",
          position: { x: 0.2, y: 0.6 },
          version: 0,
        },
      })
    ).status,
    409,
  );
});
test("non-host cannot reset room", async () => {
  assert.equal(
    (
      await request(roomPath() + "/actions", {
        token: guest.token,
        method: "POST",
        body: { type: "reset" },
      })
    ).status,
    403,
  );
});
test("creates a scoped external agent token", async () => {
  const r = await request(roomPath() + "/agents", {
    token: guest.token,
    method: "POST",
    body: { name: "External assistant" },
  });
  agent = r.data;
  assert.equal(r.status, 200);
  assert.equal(agent.mcpPath, `/mcp/${owner.room.id}`);
});
test("official MCP client initializes and discovers tools", async () => {
  mcp = new Client({ name: "alongside-test-client", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(base + agent.mcpPath), {
      requestInit: { headers: { Authorization: `Bearer ${agent.token}` } },
    }),
  );
  const r = await mcp.listTools();
  assert.deepEqual(
    r.tools.map((t) => t.name).sort(),
    [
      "draw_annotations",
      "get_events",
      "get_scene_state",
      "highlight_object",
      "remove_own_annotations",
      "send_guidance",
    ].sort(),
  );
});
test("MCP can read the real shared scene", async () => {
  const r = await mcp.callTool({ name: "get_scene_state", arguments: {} });
  assert.equal(JSON.parse(r.content[0].text).id, owner.room.id);
});
test("MCP can draw an object-attached highlight", async () => {
  const state = runtime.store.snapshot(owner.room.id);
  const r = await mcp.callTool({
    name: "highlight_object",
    arguments: { objectId: "bridge", expectedRevision: state.revision },
  });
  assert.ok(!r.isError);
  const a = runtime.store.room(owner.room.id).annotations.at(-1);
  assert.equal(a.source, "ai");
  assert.equal(a.anchorId, "bridge");
  assert.equal(a.ownerId, agent.id);
});
test("MCP rejects a stale scene revision", async () => {
  const r = await mcp.callTool({
    name: "highlight_object",
    arguments: { objectId: "cap", expectedRevision: 0 },
  });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Scene changed/);
});
test("MCP guidance appears in shared message history", async () => {
  await mcp.callTool({
    name: "send_guidance",
    arguments: { text: "Move the connection next." },
  });
  assert.equal(
    runtime.store.room(owner.room.id).messages.at(-1).author,
    "External assistant",
  );
});
test("external agents cannot use human editing endpoint", async () => {
  assert.equal(
    (
      await request(roomPath() + "/actions", {
        token: agent.token,
        method: "POST",
        body: { type: "reset" },
      })
    ).status,
    403,
  );
});
test("host pause blocks agent reads and writes", async () => {
  await request(roomPath() + "/actions", {
    token: owner.token,
    method: "POST",
    body: { type: "aiEnabled", value: false },
  });
  assert.equal((await request(roomPath(), { token: agent.token })).status, 403);
  await assert.rejects(() =>
    mcp.callTool({ name: "get_scene_state", arguments: {} }),
  );
});
test("host resume restores permitted agent access", async () => {
  await request(roomPath() + "/actions", {
    token: owner.token,
    method: "POST",
    body: { type: "aiEnabled", value: true },
  });
  const r = await mcp.callTool({ name: "get_scene_state", arguments: {} });
  assert.ok(!r.isError);
});
test("AI clears its own marks without deleting human strokes", async () => {
  await mcp.callTool({ name: "remove_own_annotations", arguments: {} });
  assert.ok(
    runtime.store
      .room(owner.room.id)
      .annotations.some((a) => a.source === "human"),
  );
  assert.ok(
    !runtime.store
      .room(owner.room.id)
      .annotations.some((a) => a.ownerId === agent.id),
  );
});
test("revoking a token immediately blocks further use", async () => {
  await request(roomPath() + `/agents/${agent.id}`, {
    token: guest.token,
    method: "DELETE",
  });
  assert.equal((await request(roomPath(), { token: agent.token })).status, 401);
});
test("scripted guide functions without any provider key and identifies itself", async () => {
  const r = await request(roomPath() + "/ai/ask", {
    token: owner.token,
    method: "POST",
    body: { prompt: "Next step" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, "demo");
  assert.match(
    runtime.store.room(owner.room.id).messages.at(-1).text,
    /Scripted practice/,
  );
  assert.ok(
    runtime.store
      .room(owner.room.id)
      .annotations.some((a) => a.source === "ai"),
  );
});
test("connecting a live provider requires explicit consent and credentials", async () => {
  assert.equal(
    (
      await request(roomPath() + "/ai", {
        token: owner.token,
        method: "PUT",
        body: { provider: "openai", model: "example", apiKey: "x" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(roomPath() + "/ai", {
        token: owner.token,
        method: "PUT",
        body: { provider: "openai", model: "", apiKey: "", consent: true },
      })
    ).status,
    400,
  );
});
test("export excludes member secrets and agent credentials", async () => {
  const r = await request(roomPath() + "/export", { token: owner.token });
  assert.equal(r.data.format, "alongside-board");
  assert.ok(!JSON.stringify(r.data).includes(owner.token));
  assert.ok(!JSON.stringify(r.data).includes(agent.token));
  assert.ok(!("members" in r.data));
});
test("exported boards can be imported without importing credentials", async () => {
  const exp = runtime.store.export(owner.room.id);
  const r = await request(roomPath() + "/import", {
    token: owner.token,
    method: "POST",
    body: exp,
  });
  assert.equal(r.status, 200);
  assert.equal(
    runtime.store.room(owner.room.id).annotations.length,
    exp.annotations.length,
  );
  assert.ok(
    runtime.store
      .room(owner.room.id)
      .annotations.every((a) => a.ownerId === owner.member.id),
  );
});
test("invalid imports do not mutate the current board", async () => {
  const before = runtime.store.snapshot(owner.room.id),
    data = runtime.store.export(owner.room.id);
  data.objects[0].x = 10;
  assert.equal(
    (
      await request(roomPath() + "/import", {
        token: owner.token,
        method: "POST",
        body: data,
      })
    ).status,
    400,
  );
  assert.equal(runtime.store.room(owner.room.id).revision, before.revision);
});
test("rotating invitations invalidates old invitation for new joins", async () => {
  const r = await request(roomPath() + "/invite", {
    token: owner.token,
    method: "POST",
    body: {},
  });
  assert.ok(r.data.invite);
  assert.equal(
    (
      await request(roomPath() + "/join", {
        method: "POST",
        body: { name: "Late", invite: owner.invite },
      })
    ).status,
    403,
  );
});
test("persistence recovers board and member auth after reload", () => {
  const recovered = new Store(join(tmp, "rooms.json"));
  assert.equal(
    recovered.snapshot(owner.room.id).revision,
    runtime.store.snapshot(owner.room.id).revision,
  );
  assert.equal(recovered.auth(owner.room.id, owner.token).id, owner.member.id);
});
test("malicious web origins are rejected", async () => {
  assert.equal(
    (
      await request("/api/health", {
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status,
    403,
  );
});
test("completed exercise guide reports completion", () => {
  const state = runtime.store.snapshot(owner.room.id);
  const objects = state.objects.map((o) => ({ ...o, ...o.target }));
  assert.equal(makeGuideActions({ ...state, objects }).annotations.length, 0);
});
test("OpenAI adapter executes validated tool loop (mocked provider, not live service)", async () => {
  const s = new Store(),
    r = s.create("Test"),
    user = s.auth(r.room.id, r.token),
    a = s.mintAgent(r.room.id, user, "Mock test");
  const tools = buildTools(s, r.room.id, s.auth(r.room.id, a.token));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () =>
      ++calls === 1
        ? {
            output: [
              {
                type: "function_call",
                id: "fc1",
                call_id: "call1",
                name: "send_guidance",
                arguments: JSON.stringify({ text: "Mocked OpenAI response" }),
              },
            ],
          }
        : {
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Done" }],
              },
            ],
          },
  });
  try {
    const text = await runProvider(
      {
        provider: "openai",
        apiKey: "not-real",
        model: "mock",
        instructions: "",
      },
      tools,
      "Test",
    );
    assert.equal(text, "Done");
    assert.equal(
      s.snapshot(r.room.id).messages[0].text,
      "Mocked OpenAI response",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Anthropic adapter executes validated tool loop (mocked provider, not live service)", async () => {
  const s = new Store(),
    r = s.create("Test"),
    user = s.auth(r.room.id, r.token),
    a = s.mintAgent(r.room.id, user, "Mock test");
  const tools = buildTools(s, r.room.id, s.auth(r.room.id, a.token));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () =>
      ++calls === 1
        ? {
            content: [
              {
                type: "tool_use",
                id: "tool1",
                name: "send_guidance",
                input: { text: "Mocked Anthropic response" },
              },
            ],
          }
        : { content: [{ type: "text", text: "Done" }] },
  });
  try {
    const text = await runProvider(
      {
        provider: "anthropic",
        apiKey: "not-real",
        model: "mock",
        instructions: "",
      },
      tools,
      "Test",
    );
    assert.equal(text, "Done");
    assert.equal(
      s.snapshot(r.room.id).messages[0].text,
      "Mocked Anthropic response",
    );
  } finally {
    globalThis.fetch = original;
  }
});
