// Fake Quest headset for testing the iPad app without VR hardware.
//
//   npm start            (in one terminal)
//   npm run fake-quest   (in another)
//
// It does what the Quest app does:
//  - creates the room as a headset host (so the paired iPad app auto-joins it),
//  - streams a camera view: a software-rendered room (desk, whiteboard, walls, floor)
//    while the "wearer" slowly looks around,
//  - reprojects iPad strokes into 3D by ray-casting them onto the room's surfaces, so
//    marks stay stuck to the desk/whiteboard/wall as the view moves,
//  - shows the wearer's hands, and the wearer draws a couple of marks of their own.
//
// Frames are labelled source "simulation"; the web client shows a SIMULATED banner.
import WebSocket from "ws";
import jpeg from "jpeg-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { packFrame } from "../server/liveview.js";

const W = 480,
  H = 360,
  FPS = 10;
const INTRINSICS = { fx: 380, fy: 380, cx: W / 2, cy: H / 2 };

// ---------- Scene (metres; x right, y up, z forward; eyes at y = 0) ----------
const ROOM = { min: [-2.5, -1.55, -1.5], max: [2.5, 1.2, 3.0] };
const BOXES = [
  {
    name: "desk",
    min: [-0.9, -1.55, 1.0],
    max: [0.9, -0.75, 1.8],
    color: [176, 132, 92],
  },
  {
    name: "box",
    min: [0.3, -0.75, 1.25],
    max: [0.56, -0.53, 1.5],
    color: [214, 98, 69],
  },
  {
    name: "book",
    min: [-0.55, -0.75, 1.2],
    max: [-0.2, -0.71, 1.45],
    color: [52, 101, 140],
  },
];
const BOARD = { x: [-1.2, 1.2], y: [-0.25, 0.85], z: 2.99 }; // whiteboard on the back wall
const LIGHT = norm([0.35, 0.8, -0.45]);

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Closest hit of a ray with the room interior and boxes: {t, n, name, color} or null. */
function intersect(o, d) {
  let best = null;
  // Room interior: the ray leaves through the nearest wall.
  let tWall = Infinity,
    axis = -1,
    sign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) continue;
    const t = ((d[a] > 0 ? ROOM.max[a] : ROOM.min[a]) - o[a]) / d[a];
    if (t > 0 && t < tWall) {
      tWall = t;
      axis = a;
      sign = d[a] > 0 ? 1 : -1;
    }
  }
  if (axis >= 0) {
    const n = [0, 0, 0];
    n[axis] = -sign;
    const name =
      axis === 1
        ? sign < 0
          ? "floor"
          : "ceiling"
        : axis === 2
          ? sign > 0
            ? "back-wall"
            : "front-wall"
          : sign < 0
            ? "left-wall"
            : "right-wall";
    best = { t: tWall, n, name };
  }
  for (const b of BOXES) {
    let t0 = -Infinity,
      t1 = Infinity,
      hitAxis = -1,
      hitSign = 0;
    let miss = false;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < b.min[a] || o[a] > b.max[a]) {
          miss = true;
          break;
        }
        continue;
      }
      let ta = (b.min[a] - o[a]) / d[a],
        tb = (b.max[a] - o[a]) / d[a],
        s = -1;
      if (ta > tb) {
        [ta, tb] = [tb, ta];
        s = 1;
      }
      if (ta > t0) {
        t0 = ta;
        hitAxis = a;
        hitSign = s;
      }
      t1 = Math.min(t1, tb);
      if (t0 > t1) {
        miss = true;
        break;
      }
    }
    if (miss || t0 <= 0 || hitAxis < 0 || (best && t0 >= best.t)) continue;
    const n = [0, 0, 0];
    n[hitAxis] = hitSign;
    best = { t: t0, n, name: b.name, color: b.color };
  }
  return best;
}

function shade(o, d, hit) {
  const p = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
  let c;
  if (hit.color) c = hit.color;
  else if (hit.name === "floor") {
    const check = (Math.floor(p[0] * 2) + Math.floor(p[2] * 2)) & 1;
    c = check ? [150, 122, 96] : [136, 108, 84];
  } else if (hit.name === "ceiling") c = [236, 234, 228];
  else if (hit.name === "back-wall") {
    const onBoard =
      p[0] > BOARD.x[0] &&
      p[0] < BOARD.x[1] &&
      p[1] > BOARD.y[0] &&
      p[1] < BOARD.y[1];
    const frame =
      p[0] > BOARD.x[0] - 0.04 &&
      p[0] < BOARD.x[1] + 0.04 &&
      p[1] > BOARD.y[0] - 0.04 &&
      p[1] < BOARD.y[1] + 0.04;
    c = onBoard ? [246, 247, 245] : frame ? [120, 126, 130] : [206, 214, 205];
  } else c = hit.name === "left-wall" ? [196, 206, 198] : [214, 210, 196];
  const lambert = Math.max(
    0,
    hit.n[0] * LIGHT[0] + hit.n[1] * LIGHT[1] + hit.n[2] * LIGHT[2],
  );
  const k = (0.62 + 0.38 * lambert) * Math.max(0.55, 1 - hit.t * 0.07);
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---------- Camera pose (the wearer's head) ----------
function poseAt(t) {
  const yaw = 0.38 * Math.sin(t * 0.22),
    pitch = 0.4 + 0.12 * Math.sin(t * 0.15); // positive looks down
  const p = [
    0.12 * Math.sin(t * 0.18),
    0.015 * Math.sin(t * 1.4),
    0.05 * Math.sin(t * 0.11),
  ];
  const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    qx = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
  return { p, q: qmul(qy, qx) };
}
function qmul(a, b) {
  const [ax, ay, az, aw] = a,
    [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/** Rotation matrix (row-major) from quaternion [x, y, z, w]. */
function qmat([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}
const rot = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const rotT = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/** Camera-space direction through pixel (px, py); image y grows downward. */
const pixelDir = (px, py, k = INTRINSICS) => [
  (px - k.cx) / k.fx,
  -(py - k.cy) / k.fy,
  1,
];

function project(pose, point, k = INTRINSICS, w = W, h = H) {
  const m = qmat(pose.q);
  const c = rotT(m, [
    point.x - pose.p[0],
    point.y - pose.p[1],
    point.z - pose.p[2],
  ]);
  if (c[2] < 0.05) return null;
  const u = (k.fx * (c[0] / c[2]) + k.cx) / w,
    v = (k.cy - k.fy * (c[1] / c[2])) / h;
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
}

/** Same job as the Quest's Reproject(): image point on a given frame → 3D point on a surface. */
export function reprojectPoints(frame, points) {
  const m = qmat(frame.pose.q),
    o = frame.pose.p;
  let anchor = null;
  const out = points.map(({ u, v }) => {
    const d = norm(
      rot(m, pixelDir(u * frame.w, v * frame.h, frame.intrinsics)),
    );
    const hit = intersect(o, d);
    const t = hit ? hit.t : 1.5;
    anchor ||= hit?.name;
    // Lift 4 mm off the surface (like SurfaceInk) so ink doesn't z-fight.
    const lift = hit ? 0.004 : 0;
    const n = hit?.n || [0, 0, 0];
    return {
      x: o[0] + d[0] * t + n[0] * lift,
      y: o[1] + d[1] * t + n[1] * lift,
      z: o[2] + d[2] * t + n[2] * lift,
    };
  });
  return {
    points: out,
    placement: anchor ? "scene-plane" : "fixed-distance",
    anchorId: anchor ? "sim-" + anchor : undefined,
  };
}

// ---------- Rendering ----------
const rgba = Buffer.alloc(W * H * 4);
const camDirs = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const d = norm(pixelDir(x + 0.5, y + 0.5));
    camDirs.set(d, (y * W + x) * 3);
  }
function render(pose, t) {
  const m = qmat(pose.q),
    o = pose.p;
  for (let i = 0, n = W * H; i < n; i++) {
    const cd = [camDirs[i * 3], camDirs[i * 3 + 1], camDirs[i * 3 + 2]];
    const d = rot(m, cd);
    const hit = intersect(o, d);
    const c = hit ? shade(o, d, hit) : [30, 30, 30];
    // Slight sensor noise + vignette so it reads as a camera feed.
    const x = (i % W) / W - 0.5,
      y = Math.floor(i / W) / H - 0.5;
    const vig = 1 - 0.35 * (x * x + y * y) * 2;
    const noise = (Math.random() - 0.5) * 6;
    rgba[i * 4] = Math.max(0, Math.min(255, c[0] * vig + noise));
    rgba[i * 4 + 1] = Math.max(0, Math.min(255, c[1] * vig + noise));
    rgba[i * 4 + 2] = Math.max(0, Math.min(255, c[2] * vig + noise));
    rgba[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width: W, height: H }, 72).data;
}

// ---------- The fake wearer ----------
function wearerMarks() {
  const circle = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    circle.push({
      x: 0.43 + 0.24 * Math.cos(a),
      y: -0.746,
      z: 1.375 + 0.2 * Math.sin(a),
    });
  }
  const arrow = [
    { x: -0.75, y: 0.3, z: 2.986 },
    { x: -0.25, y: 0.02, z: 2.986 },
    { x: -0.37, y: 0.16, z: 2.986 },
    { x: -0.25, y: 0.02, z: 2.986 },
    { x: -0.43, y: -0.02, z: 2.986 },
  ];
  return [
    { at: 6, color: "#2f7de1", points: circle, anchorId: "sim-desk" },
    { at: 18, color: "#1f9d6b", points: arrow, anchorId: "sim-back-wall" },
  ];
}

export async function startFakeQuest(
  base = "http://127.0.0.1:4173",
  { log = console.log } = {},
) {
  const res = await fetch(base + "/api/rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Same marker the Unity app sends, so the paired iPad app auto-joins this room.
      "user-agent": "UnityPlayer/6000.6.5f1 (Alongside fake Quest)",
    },
    body: JSON.stringify({ name: "Quest (simulated)" }),
  });
  const room = await res.json();
  if (!room.token)
    throw Error("Could not create a room: " + JSON.stringify(room));
  const api = (body) =>
    fetch(`${base}/api/rooms/${room.room.id}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + room.token,
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const started = Date.now() / 1000;
  const marks = wearerMarks();
  let state = room.room,
    epoch = null,
    seq = 0,
    timer = null,
    drawing = null; // { mark, progress } while the wearer is drawing

  const socket = new WebSocket(base.replace(/^http/, "ws") + "/live");
  socket.on("open", () =>
    socket.send(
      JSON.stringify({ type: "auth", room: room.room.id, token: room.token }),
    ),
  );
  socket.on("message", (raw, binary) => {
    if (binary) return;
    const m = JSON.parse(raw);
    if (m.type === "state") {
      state = m.state;
      if (!epoch && !timer)
        socket.send(JSON.stringify({ type: "streamStart" })); // "Camera ON"
    } else if (m.type === "streamStarted" && !timer) {
      epoch = m.epoch;
      log("[fake-quest] Camera ON, streaming.");
      timer = setInterval(tick, 1000 / FPS);
    } else if (m.type === "reproject") {
      const r = reprojectPoints(m.frame, m.points);
      socket.send(
        JSON.stringify({
          type: "reprojectResult",
          requestId: m.requestId,
          revision: m.revision,
          phase: m.phase,
          ...r,
        }),
      );
      if (m.phase === "commit")
        log(
          `[fake-quest] ${m.ownerName || "Someone"} drew on the ${r.anchorId?.slice(4) || "air (1.5 m)"}.`,
        );
    } else if (m.type === "streamStop") {
      clearInterval(timer);
      timer = null;
      epoch = null;
      log("[fake-quest] Camera stopped by host.");
    } else if (m.type === "error") log("[fake-quest] server: " + m.error);
  });
  socket.on("close", () => {
    clearInterval(timer);
    log("[fake-quest] Disconnected.");
  });

  function tick() {
    const t = Date.now() / 1000 - started;
    const pose = poseAt(t);
    // Wearer draws their marks progressively, hand following the pen.
    for (const mark of marks)
      if (!mark.done && !drawing && t >= mark.at) drawing = { mark, from: t };
    let pen = null;
    if (drawing) {
      const k = Math.min(1, (t - drawing.from) / 2.2);
      const pts = drawing.mark.points;
      pen = pts[Math.min(pts.length - 1, Math.floor(k * (pts.length - 1)))];
      if (k >= 1) {
        const { mark } = drawing;
        mark.done = true;
        drawing = null;
        api({
          type: "spatial.add",
          stroke: {
            color: mark.color,
            width: 0.006,
            placement: "scene-plane",
            anchorId: mark.anchorId,
            points: mark.points,
          },
        })
          .then((r) => r.error && log("[fake-quest] " + r.error))
          .catch(() => {});
      }
    }
    const left = {
      x: -0.32 + 0.03 * Math.sin(t * 0.9),
      y: -0.58 + 0.02 * Math.sin(t * 1.3),
      z: 0.75,
    };
    const right = pen
      ? { x: pen.x, y: pen.y + 0.03, z: pen.z - 0.04 }
      : {
          x: 0.3 + 0.05 * Math.sin(t * 0.7),
          y: -0.55 + 0.03 * Math.cos(t),
          z: 0.8,
        };
    const strokes = (state.spatialStrokes || []).slice(-40);
    if (drawing) {
      const k = Math.min(1, (t - drawing.from) / 2.2);
      const pts = drawing.mark.points;
      strokes.push({
        id: "wip",
        ownerName: "Quest (simulated)",
        source: "human",
        color: drawing.mark.color,
        points: pts.slice(0, Math.max(1, Math.ceil(k * pts.length))),
      });
    }
    const meta = {
      type: "frame",
      epoch,
      seq: seq++,
      ts: Date.now(),
      w: W,
      h: H,
      intrinsics: INTRINSICS,
      pose,
      calibration: "measured",
      source: "simulation",
      overlays: strokes
        .map((s) => ({
          id: s.id,
          ownerName: s.ownerName || "",
          source: s.source || "human",
          color: s.color,
          points: s.points.map((p) => project(pose, p)).filter(Boolean),
        }))
        .filter((o) => o.points.length),
      hands: [left, right].map((p) => project(pose, p)).filter(Boolean),
    };
    try {
      socket.send(packFrame(meta, Buffer.from(render(pose, t))));
    } catch (e) {
      log("[fake-quest] frame error: " + e.message);
    }
  }

  return {
    room,
    stop() {
      clearInterval(timer);
      socket.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.env.SERVER_URL || "http://127.0.0.1:4173";
  const quest = await startFakeQuest(base);
  const pairFile = fileURLToPath(
    new URL("../data/pair-code.txt", import.meta.url),
  );
  const code = existsSync(pairFile)
    ? readFileSync(pairFile, "utf8").trim()
    : "(see the server window)";
  console.log(`[fake-quest] Hosting room ${quest.room.room.id} as "Quest (simulated)". No headset needed.
[fake-quest] Open the iPad app (or ${base}/ipad in a browser) and pair with code ${code}.
[fake-quest] Draw on the live view: strokes land on the desk, whiteboard, walls or floor in 3D
             and stay put as the simulated wearer looks around. Ctrl+C to stop.`);
  process.on("SIGINT", () => {
    quest.stop();
    process.exit(0);
  });
}
