import { createApp } from "../server/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const runtime = await createApp({ file: null });
await new Promise((r) => runtime.server.listen(0, "127.0.0.1", r));
try {
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const room = runtime.store.create("MCP smoke host", "Transport check");
  const owner = runtime.store.auth(room.room.id, room.token);
  const agent = runtime.store.mintAgent(
    room.room.id,
    owner,
    "External scripted check",
  );
  const result = await promisify(execFile)(
    process.execPath,
    ["examples/mcp-agent.mjs", "--demo"],
    {
      env: {
        ...process.env,
        ALONGSIDE_MCP_URL: `${base}/mcp/${room.room.id}`,
        ALONGSIDE_AGENT_TOKEN: agent.token,
      },
      timeout: 20000,
    },
  );
  assert.match(result.stdout, /round trip complete/);
  const state = runtime.store.snapshot(room.room.id);
  assert.equal(state.annotations.at(-1).ownerId, agent.id);
  assert.equal(state.messages.at(-1).ownerId, agent.id);
  console.log(
    "PASS standalone external MCP client connects, highlights and sends guidance. Scripted transport check; no live model invoked.",
  );
} finally {
  await runtime.close();
}
