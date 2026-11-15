// Reproducible source-level verification. Requires npm ci and Playwright Chromium.
// Uses only loopback networking and a labelled simulated camera, never hardware.
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createApp } from "../server/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "alongside-verification-"));
const output = resolve(process.env.VERIFY_OUTPUT || join(temp, "reports"));
mkdirSync(output, { recursive: true });
let runtime;
async function run(label, args, extraEnv = {}) {
  console.log("\n=== " + label + " ===");
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log += chunk.toString();
      process.stdout.write(chunk);
    });
  const [code, signal] = await once(child, "exit");
  writeFileSync(join(output, label + ".log"), log);
  if (code !== 0)
    throw new Error(
      `${label} failed: exit ${code}, signal ${signal || "none"}`,
    );
}
try {
  writeFileSync(
    join(output, "environment.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        scope:
          "Node server, production web build and Chromium with a simulated camera; no Unity/hardware validation",
      },
      null,
      2,
    ),
  );
  await run("production-build", ["node_modules/vite/bin/vite.js", "build"]);
  const tests = readdirSync(join(root, "tests"))
    .filter((n) => n.endsWith(".test.js"))
    .sort()
    .map((n) => "tests/" + n);
  await run("node-tests", ["--test", ...tests]);
  runtime = await createApp({ file: join(temp, "test-rooms.json") });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const base = "http://127.0.0.1:" + runtime.server.address().port;
  for (const [label, file] of [
    ["browser-baseline", "browser.mjs"],
    ["browser-writing", "collaboration-browser.mjs"],
    ["browser-liveview", "liveview-browser.mjs"],
  ])
    await run(label, ["tests/" + file], {
      TEST_BASE_URL: base,
      TEST_OUTPUT: join(output, label + "-screenshots"),
    });
  console.log("\nPASS: all source/browser release checks. Reports: " + output);
  console.log(
    "NOT TESTED: Unity compilation, Android APK, Quest/iPad hardware, live AI, calibration or physical anchoring.",
  );
} finally {
  if (runtime) await runtime.close();
  // Keep report artifacts, but never leave test room credentials in a public bundle.
  rmSync(join(temp, "test-rooms.json"), { force: true });
}
