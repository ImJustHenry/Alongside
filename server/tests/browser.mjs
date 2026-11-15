import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const out = process.env.TEST_OUTPUT || "/tmp/alongside-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: [
    "--no-sandbox",
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  acceptDownloads: true,
});
await context.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      window.__testSocket = this;
    }
  };
});
const a = await context.newPage();
const errors = [];
a.on("pageerror", (e) => errors.push(e.message));
const passed = [];
const pass = (s) => {
  passed.push(s);
  console.log("PASS", s);
};
async function credential(p) {
  return p.evaluate(() =>
    JSON.parse(sessionStorage.getItem("alongside-session")),
  );
}
async function scene(p) {
  const s = await credential(p);
  return p.evaluate(
    async (s) =>
      (
        await fetch(`/api/rooms/${s.roomId}`, {
          headers: { Authorization: `Bearer ${s.token}` },
        })
      ).json(),
    s,
  );
}
async function waitAnnotations(p, n) {
  await p.waitForFunction(async (n) => {
    const s = JSON.parse(sessionStorage.getItem("alongside-session"));
    return (
      (
        await (
          await fetch(`/api/rooms/${s.roomId}`, {
            headers: { Authorization: `Bearer ${s.token}` },
          })
        ).json()
      ).annotations.length >= n
    );
  }, n);
}
async function drag(p, from, to) {
  const r = await p.getByTestId("board").boundingBox();
  await p.mouse.move(r.x + r.width * from[0], r.y + r.height * from[1]);
  await p.mouse.down();
  await p.mouse.move(r.x + r.width * to[0], r.y + r.height * to[1], {
    steps: 15,
  });
  await p.mouse.up();
}
try {
  await a.goto(base);
  await a
    .getByRole("heading", { name: "Think together. Draw beyond." })
    .waitFor();
  await a.screenshot({ path: out + "/01-landing.png", fullPage: true });
  pass("Landing renders");
  await a.getByLabel("Your name", { exact: true }).fill("Pacino");
  await a.getByRole("button", { name: "Create a workspace" }).click();
  await a.getByText("Live session", { exact: true }).waitFor();
  pass("Host creates and joins live workspace");
  await a.getByRole("button", { name: "Invite +", exact: true }).click();
  const url = await a.getByLabel("Invitation URL").inputValue();
  assert.ok(url.includes("#room="));
  assert.ok(await a.locator("img.qr").getAttribute("src"));
  await a.getByRole("button", { name: "Close dialog" }).click();
  pass("Private invitation and QR generated");
  const bc = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  });
  const b = await bc.newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await b.goto(url);
  await b.getByLabel("Your name", { exact: true }).fill("Maya");
  await b.getByRole("button", { name: "Join workspace" }).click();
  await b.getByText("Live session", { exact: true }).waitFor();
  await a.getByText("Maya", { exact: true }).waitFor();
  pass("Second independent browser joins and presence synchronizes");
  await drag(a, [0.15, 0.58], [0.4, 0.57]);
  await waitAnnotations(b, 1);
  assert.equal((await scene(b)).annotations[0].source, "human");
  pass("Freehand pen drawing syncs across clients");
  await a.getByRole("button", { name: "Arrow", exact: true }).click();
  await drag(a, [0.62, 0.55], [0.75, 0.48]);
  await waitAnnotations(b, 2);
  pass("Arrow drawing syncs");
  await a.getByRole("button", { name: "Circle", exact: true }).click();
  await drag(a, [0.42, 0.2], [0.58, 0.3]);
  await waitAnnotations(b, 3);
  pass("Circle drawing syncs");
  await a.getByRole("button", { name: "Text", exact: true }).click();
  await a.getByLabel("Label", { exact: true }).fill("Human + AI, together");
  const rect = await a.getByTestId("board").boundingBox();
  await a.mouse.click(rect.x + rect.width * 0.1, rect.y + rect.height * 0.91);
  await waitAnnotations(b, 4);
  assert.equal(
    (await scene(b)).annotations.at(-1).text,
    "Human + AI, together",
  );
  pass("Text annotation persists");
  await a.getByRole("button", { name: "Undo", exact: true }).click();
  await a.waitForTimeout(150);
  assert.equal((await scene(b)).annotations.length, 3);
  pass("Undo removes latest owned annotation");
  await a.getByRole("button", { name: "Move", exact: true }).click();
  await drag(a, [0.24, 0.77], [0.24, 0.39]);
  await b.getByText("1 of 3 tiles aligned.", { exact: false }).waitFor();
  pass("Tile movement and task progress synchronize");
  await a.getByRole("button", { name: "Show me the next step" }).click();
  await b
    .getByText("[Scripted practice — not a live model]", { exact: false })
    .waitFor();
  assert.ok((await scene(b)).annotations.some((x) => x.source === "ai"));
  pass("No-key guide draws and clearly labels scripted mode");
  await a.getByRole("checkbox", { name: "Feedback after tile moves" }).check();
  await drag(a, [0.5, 0.77], [0.5, 0.39]);
  await a.waitForTimeout(800);
  assert.ok(
    (await scene(b)).messages.filter((x) => x.source === "ai").length >= 2,
  );
  pass("Placement event triggers opted-in feedback");
  await a.getByRole("button", { name: "Pause all AI access" }).click();
  await b.getByText("AI access paused by host.", { exact: false }).waitFor();
  assert.ok(
    await b.getByRole("button", { name: "Show me the next step" }).isDisabled(),
  );
  await a.getByRole("button", { name: "Resume AI access" }).click();
  pass("Pause/resume propagates and disables AI actions");
  const downloaded = a.waitForEvent("download");
  await a.getByRole("button", { name: "Export JSON" }).click();
  const json = await downloaded;
  await json.saveAs(out + "/board-export.json");
  pass("JSON export downloads");
  const png = a.waitForEvent("download");
  await a.getByRole("button", { name: "Snapshot PNG" }).click();
  await (await png).saveAs(out + "/board-snapshot.png");
  pass("PNG snapshot downloads");
  await a.getByRole("button", { name: "AI connections", exact: false }).click();
  await a
    .getByLabel("Assistant name", { exact: true })
    .fill("My external agent");
  await a.getByRole("button", { name: "Create 8-hour agent token" }).click();
  assert.ok((await a.getByLabel("Bearer token").inputValue()).length > 20);
  assert.ok(
    (await a.getByLabel("Endpoint", { exact: true }).inputValue()).includes(
      "/mcp/",
    ),
  );
  await a.getByRole("button", { name: "Close dialog" }).click();
  pass("MCP connection can be issued from UI");
  await a.reload();
  await a.getByText("Live session", { exact: true }).waitFor();
  assert.ok((await scene(a)).annotations.length >= 4);
  pass("Reload restores membership and persisted scene");
  await a.evaluate(() => window.__testSocket.close());
  await a.waitForTimeout(1600);
  await a.getByText("Live session", { exact: true }).waitFor();
  assert.ok((await scene(a)).annotations.length >= 4);
  pass("Dropped WebSocket reconnects and restores authoritative state");
  await a.screenshot({ path: out + "/02-workspace.png", fullPage: true });
  await a.getByRole("button", { name: "Spatial view" }).click();
  await a.locator(".xr-render canvas").waitFor();
  await a.waitForTimeout(1000);
  assert.ok(
    await a.getByRole("button", { name: "Enter mixed reality" }).isDisabled(),
  );
  await a.screenshot({ path: out + "/03-spatial-preview.png", fullPage: true });
  pass("Three.js spatial view renders; unsupported XR stays disabled");
  const mc = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const m = await mc.newPage();
  m.on("pageerror", (e) => errors.push(e.message));
  await m.goto(url);
  await m.getByLabel("Your name", { exact: true }).fill("Phone participant");
  await m.getByRole("button", { name: "Join workspace" }).click();
  await m.getByTestId("board").waitFor();
  await m.waitForTimeout(400);
  assert.equal(
    await m.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  await m.screenshot({ path: out + "/04-phone.png", fullPage: true });
  pass("Phone-sized layout joins with no horizontal overflow");
  const before = (await scene(m)).annotations.length;
  const mr = await m.getByTestId("board").boundingBox();
  await m.touchscreen.tap(mr.x + mr.width * 0.25, mr.y + mr.height * 0.56);
  await waitAnnotations(a, before + 1);
  pass("Touch input commits a synchronized mark");
  assert.deepEqual(errors, []);
  pass("No browser JavaScript exceptions across desktop/tablet/phone contexts");
  console.log(
    `\n${passed.length} browser checks passed. Real Quest/Pencil/AI-provider tests remain unverified.`,
  );
  await bc.close();
  await mc.close();
} finally {
  await browser.close();
}
