// Explicit diagnostic source. This is NOT Quest camera capture or proof of physical anchoring.
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packFrame } from "../server/liveview.js";
export function projectSimulation(meta, points) {
  return points.map((p) => ({
    x: ((p.u * meta.w - meta.intrinsics.cx) / meta.intrinsics.fx) * 1.5,
    y: ((meta.intrinsics.cy - p.v * meta.h) / meta.intrinsics.fy) * 1.5,
    z: 1.5,
  }));
}
export async function startSimulation(
  base = "http://127.0.0.1:4173",
  supplied = null,
) {
  const room =
    supplied ||
    (await (
      await fetch(base + "/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "SIMULATED source",
          title: "LiveView diagnostic — no headset",
        }),
      })
    ).json());
  if (!room.token) throw Error("Could not create diagnostic room");
  const jpeg = readFileSync(
    new URL("../tests/fixtures/simulated-camera.jpg", import.meta.url),
  );
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/live");
  let epoch,
    seq = 0,
    timer,
    latestState = room.room;
  socket.on("open", () =>
    socket.send(
      JSON.stringify({ type: "auth", room: room.room.id, token: room.token }),
    ),
  );
  socket.on("message", (raw, binary) => {
    if (binary) return;
    const m = JSON.parse(raw);
    if (m.type === "state") {
      latestState = m.state;
      if (!epoch && !timer)
        socket.send(JSON.stringify({ type: "streamStart" }));
    } else if (m.type === "streamStarted" && !timer) {
      epoch = m.epoch;
      timer = setInterval(() => {
        const meta = {
          type: "frame",
          epoch,
          seq: seq++,
          ts: Date.now(),
          w: 640,
          h: 480,
          intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
          pose: { p: [0, 0, 0], q: [0, 0, 0, 1] },
          calibration: "estimated",
          source: "simulation",
          overlays: (latestState.spatialStrokes || [])
            .slice(-20)
            .map((s) => ({
              id: s.id,
              ownerName: s.ownerName,
              source: s.source,
              color: s.color,
              points: s.points.map((p) => ({
                u: Math.max(0, Math.min(1, ((500 * p.x) / p.z + 320) / 640)),
                v: Math.max(0, Math.min(1, (240 - (500 * p.y) / p.z) / 480)),
              })),
            })),
          hands: [{ u: 0.45, v: 0.8 }],
        };
        socket.send(packFrame(meta, jpeg));
      }, 100);
    } else if (m.type === "reproject") {
      socket.send(
        JSON.stringify({
          type: "reprojectResult",
          requestId: m.requestId,
          revision: m.revision,
          phase: m.phase,
          points: projectSimulation(m.frame, m.points),
          placement: "fixed-distance",
        }),
      );
    } else if (m.type === "streamStop") {
      clearInterval(timer);
      timer = null;
    }
  });
  return {
    room,
    socket,
    capture: () => socket.send(JSON.stringify({ type: "capturePermit" })),
    stop: () => {
      clearInterval(timer);
      socket.close();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sim = await startSimulation(process.env.SERVER_URL);
  console.log("SIMULATED diagnostic source — NOT a real camera.");
  console.log(
    (process.env.SERVER_URL || "http://127.0.0.1:4173") +
      "/#room=" +
      sim.room.room.id +
      "&invite=" +
      sim.room.invite +
      "&view=live",
  );
  process.on("SIGINT", () => {
    sim.stop();
    process.exit();
  });
}
