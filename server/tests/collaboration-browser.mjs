import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4181";
const out = process.env.TEST_OUTPUT || "/tmp/alongside-writing-browser";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const errors = [];
let checks = 0;
const pass = (s) => {
  checks++;
  console.log("PASS " + s);
};
async function state(page) {
  return page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem("alongside-session"));
    return (
      await fetch("/api/rooms/" + s.roomId, {
        headers: { authorization: "Bearer " + s.token },
      })
    ).json();
  });
}
async function waitFor(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timed out");
}
async function draw(page, y = 0.53) {
  const r = await page.getByTestId("board").boundingBox();
  await page.mouse.move(r.x + r.width * 0.12, r.y + r.height * y);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.36, r.y + r.height * (y + 0.025), {
    steps: 8,
  });
  await page.mouse.up();
}
try {
  const hc = await browser.newContext({
      viewport: { width: 1480, height: 1020 },
    }),
    gc = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const h = await hc.newPage(),
    g = await gc.newPage();
  for (const p of [h, g]) p.on("pageerror", (e) => errors.push(e.message));
  await h.goto(base);
  await h.getByLabel("Your name").fill("Host");
  await h.getByRole("button", { name: "Create a workspace" }).click();
  await h.getByTestId("board").waitFor();
  await h.getByText("Live session", { exact: true }).waitFor();
  const invite = await h.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem("alongside-session"));
    return location.origin + "/#room=" + s.roomId + "&invite=" + s.invite;
  });
  await g.goto(invite);
  await g.getByLabel("Your name").fill("Collaborator");
  await g.getByRole("button", { name: "Join workspace" }).click();
  await g.getByTestId("board").waitFor();
  await g.getByText("Live session", { exact: true }).waitFor();
  assert.equal(
    await h.getByRole("switch", { name: "Collaborative writing" }).isChecked(),
    true,
  );
  assert.equal(
    await h.getByRole("switch", { name: "Collaborative writing" }).isDisabled(),
    false,
  );
  assert.equal(
    await g.getByRole("switch", { name: "Collaborative writing" }).isDisabled(),
    true,
  );
  pass("Host has an enabled switch; collaborators see its read-only status");
  await draw(g);
  await waitFor(async () => (await state(h)).annotations.length === 1);
  pass("Collaborator can draw while ON");
  const r = await g.getByTestId("board").boundingBox();
  await g.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.55);
  await g.mouse.down();
  await g.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.56, { steps: 8 });
  await h.getByText("Collaborative writing", { exact: true }).click();
  await waitFor(
    async () =>
      !(await g
        .getByRole("switch", { name: "Collaborative writing" })
        .isChecked()),
  );
  await g.mouse.up();
  await g.waitForTimeout(150);
  assert.equal((await state(h)).annotations.length, 1);
  pass("Turning OFF cancels a collaborator stroke already in progress");
  assert.equal(
    await g.getByRole("button", { name: "Pen", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await g.getByRole("button", { name: "Move", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await g.getByRole("button", { name: "Undo", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await g
      .getByRole("button", { name: "Clear my marks", exact: true })
      .isDisabled(),
    true,
  );
  await g.getByText("Read-only board.", { exact: false }).waitFor();
  pass("Guest tools disable and the read-only explanation appears");
  await draw(g, 0.61);
  await g.waitForTimeout(120);
  assert.equal((await state(h)).annotations.length, 1);
  pass("Direct canvas gestures cannot bypass the disabled controls");
  await draw(h);
  await waitFor(async () => (await state(g)).annotations.length === 2);
  pass("Host retains drawing access while OFF");
  const oldMarks = JSON.stringify((await state(h)).annotations);
  await g.getByRole("button", { name: "Show me the next step" }).click();
  await waitFor(async () =>
    (await state(h)).messages.some(
      (m) => m.source === "ai" && m.text.includes("guidance only"),
    ),
  );
  assert.equal(JSON.stringify((await state(h)).annotations), oldMarks);
  pass(
    "AI questions remain available and scripted guidance does not change the board",
  );
  await h.screenshot({ path: out + "/host-writing-off.png", fullPage: true });
  await g.screenshot({ path: out + "/guest-read-only.png", fullPage: true });
  await g.reload();
  await g.getByTestId("board").waitFor();
  await g.getByText("Live session", { exact: true }).waitFor();
  assert.equal(
    await g.getByRole("switch", { name: "Collaborative writing" }).isChecked(),
    false,
  );
  assert.equal(
    await g.getByRole("button", { name: "Pen", exact: true }).isDisabled(),
    true,
  );
  pass("Reload/rejoin retains the authoritative OFF policy");
  await h.getByText("Collaborative writing", { exact: true }).click();
  await waitFor(
    async () =>
      await g
        .getByRole("switch", { name: "Collaborative writing" })
        .isChecked(),
  );
  assert.equal(
    await g.getByRole("button", { name: "Pen", exact: true }).isDisabled(),
    false,
  );
  await draw(g, 0.61);
  await waitFor(async () => (await state(h)).annotations.length === 3);
  pass("ON restores collaborator input without rejoining");
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await phone.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(invite);
  await p.getByLabel("Your name").fill("Phone guest");
  await p.getByRole("button", { name: "Join workspace" }).click();
  await p.getByTestId("board").waitFor();
  await h.getByText("Collaborative writing", { exact: true }).click();
  await waitFor(
    async () =>
      !(await p
        .getByRole("switch", { name: "Collaborative writing" })
        .isChecked()),
  );
  assert.equal(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  pass("Phone-sized UI receives the mode without horizontal overflow");
  assert.deepEqual(errors, []);
  pass("No uncaught browser exceptions");
  console.log(
    `${checks} collaborative-writing browser checks passed. Unity and physical Quest remain unverified.`,
  );
} finally {
  await browser.close();
}
