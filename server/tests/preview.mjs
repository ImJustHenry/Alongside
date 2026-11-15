import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 930 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:4173") + "/?preview=1",
  );
  await page.getByText("LOCAL INTERACTIVE PREVIEW", { exact: false }).waitFor();
  const svg = page.locator("svg").first(),
    r = await svg.boundingBox();
  await page.mouse.move(r.x + r.width * 0.15, r.y + r.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.35, r.y + r.height * 0.53, {
    steps: 8,
  });
  await page.mouse.up();
  assert.equal(await svg.locator("polyline").count(), 1);
  await page.getByRole("button", { name: "Show me the next step" }).click();
  assert.equal(await svg.locator("ellipse").count(), 1);
  await page.getByRole("button", { name: "Export board" }).click();
  const json = JSON.parse(await page.locator("textarea").inputValue());
  assert.equal(json.format, "alongside-board");
  assert.equal(json.annotations.length, 3);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/tmp/alongside-browser/05-interactive-preview.png",
    fullPage: true,
  });
  console.log(
    "PASS local interactive preview draws, produces scripted guidance, and exports valid board JSON.",
  );
} finally {
  await browser.close();
}
