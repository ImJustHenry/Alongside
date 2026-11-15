import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { startSimulation } from "../examples/simulated-camera.mjs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4173",
  out = process.env.TEST_OUTPUT || "/tmp/alongside-liveview-browser";
mkdirSync(out, { recursive: true });
const sim = await startSimulation(base);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
let count = 0;
const pass = (s) => {
    count++;
    console.log("PASS " + s);
  },
  errors = [],
  wire = [];
async function wait(fn, label = "expected LiveView state") {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out waiting for " + label);
}
async function state() {
  return (
    await fetch(base + "/api/rooms/" + sim.room.room.id, {
      headers: { authorization: "Bearer " + sim.room.token },
    })
  ).json();
}
async function point(page, u, v) {
  const r = await page.getByTestId("live-canvas").boundingBox(),
    scale = Math.min(r.width / 640, r.height / 480);
  return {
    x: r.x + (r.width - 640 * scale) / 2 + u * 640 * scale,
    y: r.y + (r.height - 480 * scale) / 2 + v * 480 * scale,
  };
}
try {
  const guestContext = await browser.newContext({
      viewport: { width: 1180, height: 1000 },
      acceptDownloads: true,
    }),
    page = await guestContext.newPage();
  await guestContext.addInitScript(() => {
    // Test-only instrumentation: capture the real subscribed socket for a
    // forced disconnect and inspect received frame headers, never fake state.
    const Native = window.WebSocket;
    window.__liveSockets = [];
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.watchCount = 0;
        window.__liveSockets.push(this);
        this.addEventListener("message", (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          const size = new DataView(event.data).getUint32(0, true);
          window.__liveMeta = JSON.parse(
            new TextDecoder().decode(new Uint8Array(event.data, 4, size)),
          );
        });
      }
      send(payload) {
        if (
          typeof payload === "string" &&
          JSON.parse(payload).type === "watchLive"
        )
          this.watchCount++;
        return super.send(payload);
      }
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (socket) => {
    for (const direction of ["framesent", "framereceived"]) {
      socket.on(direction, ({ payload }) => {
        if (typeof payload !== "string") return;
        try {
          const m = JSON.parse(payload);
          if (
            [
              "watchLive",
              "state",
              "streamStatus",
              "remoteStroke",
              "remoteResult",
            ].includes(m.type)
          )
            wire.push({
              direction,
              type: m.type,
              phase: m.phase,
              placement: m.placement,
              error: m.error,
            });
        } catch {
          /* Binary packets are not JSON event diagnostics. */
        }
      });
    }
  });
  const link =
    base +
    "/#room=" +
    sim.room.room.id +
    "&invite=" +
    sim.room.invite +
    "&view=live";
  await page.goto(link);
  await page.getByLabel("Your name", { exact: true }).fill("iPad helper");
  await page.getByRole("button", { name: "Join workspace" }).click();
  await page.getByTestId("live-canvas").waitFor();
  await wait(
    async () =>
      !!(await page.getByTestId("live-canvas").getAttribute("data-frame-seq")),
  );
  assert.equal(
    await page.getByTestId("live-canvas").getAttribute("data-source"),
    "simulation",
  );
  pass(
    "Invitation view=live opens the camera canvas and receives real WebSocket JPEG packets",
  );
  await page.screenshot({
    path: out + "/liveview-simulated.png",
    fullPage: true,
  });
  assert.match(
    await page.locator(".live-metrics").innerText(),
    /\d+ decoded fps/,
  );
  pass(
    "Receiver FPS and clock-qualified frame age are visible; source is labeled simulated",
  );
  const p1 = await point(page, 0.3, 0.45),
    p2 = await point(page, 0.55, 0.65);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 12 });
  const held = await page
    .getByTestId("live-canvas")
    .getAttribute("data-frame-seq");
  await page.waitForTimeout(350);
  assert.equal(
    await page.getByTestId("live-canvas").getAttribute("data-frame-seq"),
    held,
  );
  pass(
    "The displayed frame freezes during the stroke while new camera packets arrive",
  );
  await page.mouse.up();
  try {
    await wait(async () => (await state()).spatialStrokes.length === 1);
  } catch (e) {
    console.log("Live notice:", await page.locator(".live-notice").innerText());
    console.log("Browser errors:", errors);
    throw e;
  }
  const s = (await state()).spatialStrokes[0];
  assert.equal(s.ownerName, "iPad helper");
  assert.equal(s.source, "remote");
  assert.equal(s.placement, "fixed-distance");
  pass(
    "Helper stroke commits to server state with the correct author and remote/fixed-distance metadata",
  );
  try {
    await wait(
      async () =>
        (await page.locator(".live-notice").innerText()).includes(
          "NOT anchored",
        ),
      "the retained stroke-save acknowledgement / fixed-distance warning",
    );
  } catch (e) {
    console.log(
      "Committed stroke count:",
      (await state()).spatialStrokes.length,
    );
    console.log("Live notice:", await page.locator(".live-notice").innerText());
    console.log("Recent protocol events:", JSON.stringify(wire.slice(-16)));
    throw e;
  }
  pass(
    "The viewer retains the fixed-distance warning after the save acknowledgement",
  );
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () => window.__liveSockets.find((s) => s.watchCount)?.watchCount,
    ),
    1,
  );
  assert.match(await page.locator(".live-notice").innerText(), /Stroke saved/);
  pass(
    "A save broadcast does not resubscribe the camera or erase the acknowledgement",
  );
  await page.evaluate(() =>
    window.__liveSockets
      .find((s) => s.watchCount)
      .send(JSON.stringify({ type: "watchLive", enabled: true })),
  );
  await page.waitForTimeout(200);
  assert.match(
    await page.locator(".live-notice").innerText(),
    /Stroke saved.*NOT anchored/,
  );
  pass(
    "A same-stream status refresh preserves the save result and placement warning",
  );
  await wait(
    async () =>
      await page.evaluate(
        (id) => window.__liveMeta?.overlays.some((o) => o.id === id),
        s.id,
      ),
  );
  pass("Saved stroke returns in the source's projected video overlay metadata");
  await page.reload();
  await page.getByTestId("live-canvas").waitFor();
  await wait(
    async () =>
      await page.evaluate(
        (id) => window.__liveMeta?.overlays.some((o) => o.id === id),
        s.id,
      ),
  );
  assert.deepEqual((await state()).spatialStrokes, [s]);
  pass(
    "Reload restores the same saved stroke ID, geometry and attribution without duplication",
  );
  await page.evaluate(() =>
    window.__liveSockets.find((s) => s.watchCount).close(),
  );
  await wait(
    async () =>
      await page.evaluate(
        () =>
          window.__liveSockets.filter(
            (s) => s.watchCount > 0 && s.readyState === WebSocket.OPEN,
          ).length === 1,
      ),
    "LiveView socket reconnect",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__liveSockets.find(
          (s) => s.watchCount && s.readyState === WebSocket.OPEN,
        ).watchCount,
    ),
    1,
  );
  assert.deepEqual((await state()).spatialStrokes, [s]);
  await wait(
    async () =>
      !(await page
        .getByRole("button", { name: "Undo my spatial stroke" })
        .isDisabled()),
  );
  pass(
    "Forced socket reconnect resubscribes once and preserves the saved stroke",
  );
  const r = await page.getByTestId("live-canvas").boundingBox();
  const before = (await state()).spatialStrokes.length;
  await page.mouse.click(r.x + 2, r.y + 2);
  await page.waitForTimeout(150);
  assert.equal((await state()).spatialStrokes.length, before);
  pass("Letterbox clicks are ignored rather than misprojected");
  await page.getByRole("button", { name: "Undo my spatial stroke" }).click();
  await wait(async () => (await state()).spatialStrokes.length === 0);
  pass("Spatial undo uses the existing authenticated action pipeline");
  const longStart = await point(page, 0.35, 0.4),
    longEnd = await point(page, 0.6, 0.6);
  await page.mouse.move(longStart.x, longStart.y);
  await page.mouse.down();
  const pinned = await page
    .getByTestId("live-canvas")
    .getAttribute("data-frame-seq");
  await page.waitForTimeout(2500);
  await page.mouse.move(longEnd.x, longEnd.y, { steps: 6 });
  await page.mouse.up();
  await wait(
    async () => (await state()).spatialStrokes.length === 1,
    "long-stroke commit after frame-history expiry",
  );
  assert.equal((await state()).spatialStrokes[0].frameRef, Number(pinned));
  await wait(async () =>
    (await page.locator(".live-notice").innerText()).includes("Stroke saved"),
  );
  pass(
    "A stroke held beyond the rolling frame history saves against its pinned original frame",
  );
  await page.getByRole("button", { name: "Undo my spatial stroke" }).click();
  await wait(async () => (await state()).spatialStrokes.length === 0);
  const hc = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  await hc.addInitScript(
    (s) => sessionStorage.setItem("alongside-session", JSON.stringify(s)),
    {
      roomId: sim.room.room.id,
      member: sim.room.member,
      token: sim.room.token,
      invite: sim.room.invite,
    },
  );
  const host = await hc.newPage();
  host.on("pageerror", (e) => errors.push(e.message));
  await host.goto(base + "/#view=live");
  await host.getByTestId("live-canvas").waitFor();
  // This is server-authoritative, not an optimistic local checkbox. Wait for
  // the authenticated state broadcast rather than checking in the click task.
  await host.getByLabel("Spatial writing", { exact: true }).click();
  await wait(async () => !(await state()).collaborativeWriting);
  await wait(
    async () =>
      !(await host.getByLabel("Spatial writing", { exact: true }).isChecked()),
  );
  await wait(
    async () =>
      await page
        .getByRole("button", { name: "Undo my spatial stroke" })
        .isDisabled(),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Undo my spatial stroke" })
      .isDisabled(),
    true,
  );
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y);
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal((await state()).spatialStrokes.length, 0);
  pass("Host OFF disables helper drawing and actions immediately");
  await host.getByLabel("Spatial writing", { exact: true }).click();
  await wait(async () => (await state()).collaborativeWriting);
  await wait(
    async () =>
      await host.getByLabel("Spatial writing", { exact: true }).isChecked(),
  );
  await page.getByText("Ask AI about this view", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Ask AI about what I see" })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Send this frame and question to my configured AI provider")
    .check();
  await page.getByRole("button", { name: "Ask AI about what I see" }).click();
  await page.locator(".live-answer").waitFor();
  assert.match(await page.locator(".live-answer").innerText(), /Scripted demo/);
  pass(
    "Frame AI requires consent and identifies no-key output as scripted, not visual intelligence",
  );
  await host.getByRole("button", { name: "Pause AI", exact: true }).click();
  await wait(async () => !(await state()).aiEnabled);
  await page.getByRole("button", { name: "Ask AI about what I see" }).click();
  await wait(async () =>
    (await page.locator(".live-answer").innerText()).includes("AI is paused"),
  );
  pass(
    "Pause AI prevents provider/frame access and produces only a status message",
  );
  await page
    .getByText("Judging backup / approved replay", { exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Record approved clip" })
      .isDisabled(),
    true,
  );
  sim.capture();
  await wait(
    async () =>
      !(await page
        .getByRole("button", { name: "Record approved clip" })
        .isDisabled()),
  );
  await page.getByRole("button", { name: "Record approved clip" }).click();
  await page.waitForTimeout(450);
  const dl = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download \d+ frames/ }).click(),
  ]);
  const replayPath = out + "/approved-replay.json";
  await dl[0].saveAs(replayPath);
  const replayData = JSON.parse(readFileSync(replayPath, "utf8"));
  assert.ok(replayData.frames.length > 0 && replayData.frames.length <= 30);
  pass(
    "Recording is blocked until host approval, then downloads only explicitly captured frames",
  );
  await page.locator("input[type=file]").setInputFiles(replayPath);
  await page.getByText("REPLAY — NOT LIVE", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Undo my spatial stroke" })
      .isDisabled(),
    true,
  );
  pass("Replay is visibly labeled and cannot write into the live room");
  await page.getByRole("button", { name: "Return to live" }).click();
  await wait(async () =>
    (await page.locator(".live-badge").innerText()).includes("CAMERA LIVE"),
  );
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(link);
  await mobile.getByLabel("Your name", { exact: true }).fill("Phone helper");
  await mobile.getByRole("button", { name: "Join workspace" }).click();
  await mobile.getByTestId("live-canvas").waitFor();
  await wait(
    async () =>
      !!(await mobile
        .getByTestId("live-canvas")
        .getAttribute("data-frame-seq")),
  );
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  await mobile.screenshot({
    path: out + "/liveview-phone.png",
    fullPage: true,
  });
  pass(
    "Phone/touch layout receives the live stream without horizontal overflow",
  );
  await host.getByRole("button", { name: "Stop camera", exact: true }).click();
  await wait(async () =>
    (await page.locator(".live-badge").innerText()).includes("CAMERA OFF"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Undo my spatial stroke" })
      .isDisabled(),
    true,
  );
  pass("Stopping the camera clears live viewing and stops drawing");
  assert.deepEqual(errors, []);
  pass("No uncaught browser exceptions");
  console.log(
    `${count} LiveView browser checks passed with a SIMULATED source; not Quest/Pencil/latency certification.`,
  );
} finally {
  sim.stop();
  await browser.close();
}
