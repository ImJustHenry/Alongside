import React, { useEffect, useRef, useState } from "react";
export function containRect(cw, ch, iw, ih) {
  const s = Math.min(cw / iw, ch / ih);
  return { x: (cw - iw * s) / 2, y: (ch - ih * s) / 2, w: iw * s, h: ih * s };
}
export function unpackPacket(buffer) {
  const v = new DataView(buffer);
  if (buffer.byteLength > 700000 || buffer.byteLength < 12)
    throw Error("Frame size rejected");
  const n = v.getUint32(0, true);
  if (n < 2 || n > 64000 || n + 4 >= buffer.byteLength)
    throw Error("Invalid frame header");
  const meta = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, n)),
  );
  if (
    meta.type !== "frame" ||
    !Number.isInteger(meta.seq) ||
    meta.w < 64 ||
    meta.w > 1280 ||
    meta.h < 64 ||
    meta.h > 1280
  )
    throw Error("Invalid frame metadata");
  return { meta, jpeg: new Uint8Array(buffer, 4 + n) };
}
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ ((Math.random() * 16) >> (c / 4))).toString(16),
  );
const to64 = (buffer) => {
  const a = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
};
const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
async function decode(jpeg) {
  const blob = new Blob([jpeg], { type: "image/jpeg" });
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const image = new Image(),
      url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Error("JPEG decode failed"));
    };
    image.src = url;
  });
}
const SWATCHES = [
  "#da6b45",
  "#e0457b",
  "#f2c94c",
  "#3fbf7f",
  "#2f7de1",
  "#ffffff",
];
const WIDTHS = [
  [0.003, "Fine", 6],
  [0.006, "Medium", 10],
  [0.012, "Bold", 16],
];
const ICONS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "M18 6 6 18M6 6l12 12",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  exit: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
};
/** The native iPad app (Alongside Live) exposes a message bridge; absent in browsers. */
export const nativeApp = () => window.webkit?.messageHandlers?.alongside;
const Icon = ({ d, size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={d === ICONS.more ? 3 : 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
/** Friendly name for where a stroke was pinned (simulated anchors are named; real Quest anchors are IDs). */
const surfaceName = (anchorId) => {
  const m = /^sim-(.+)$/.exec(anchorId || "");
  if (!m) return "a real surface";
  const name = m[1].replace(/^(back|front|left|right)-wall$/, "wall");
  return "the " + name;
};
export default function LiveView({
  session,
  state,
  api,
  onError,
  immersive = false,
  peers = [],
  onLeave,
  onOpenWorkspace,
}) {
  const [status, setStatus] = useState({ live: false }),
    [connected, setConnected] = useState(false),
    [color, setColor] = useState("#da6b45"),
    [width, setWidth] = useState(0.006),
    [metrics, setMetrics] = useState({ fps: 0, age: 0, calibration: "—" }),
    [notice, setNotice] = useState(
      "Waiting for the Quest host to turn on the camera.",
    ),
    [labels, setLabels] = useState(true),
    [question, setQuestion] = useState(
      "What should I inspect next? Explain uncertainty.",
    ),
    [consent, setConsent] = useState(false),
    [asking, setAsking] = useState(false),
    [answer, setAnswer] = useState(""),
    [mode, setMode] = useState("live"),
    [recording, setRecording] = useState(false),
    [recorded, setRecorded] = useState(0),
    [fullscreen, setFullscreen] = useState(false),
    [sheet, setSheet] = useState(false),
    [toastOn, setToastOn] = useState(false);
  const canvas = useRef(),
    container = useRef(),
    ws = useRef(),
    frame = useRef(null),
    stroke = useRef(null),
    latest = useRef(),
    pending = useRef(null),
    decoding = useRef(false),
    generation = useRef(0),
    times = useRef([]),
    record = useRef(null),
    replay = useRef(null),
    fileInput = useRef(),
    animation = useRef(),
    paintRef = useRef(() => {}),
    clock = useRef();
  latest.current = {
    state,
    color,
    width,
    labels,
    mode,
    recording,
    status,
    immersive,
  };
  const send = (m) => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify(m));
  };
  const host = session.member.role === "host",
    canDraw =
      connected &&
      status.live &&
      state.collaborativeWriting !== false &&
      mode === "live";
  function render() {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2);
    if (
      c.width !== Math.round(r.width * d) ||
      c.height !== Math.round(r.height * d)
    ) {
      c.width = Math.round(r.width * d);
      c.height = Math.round(r.height * d);
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = latest.current.immersive ? "#0b0f0e" : "#152923";
    ctx.fillRect(0, 0, r.width, r.height);
    const current = stroke.current?.frame || frame.current;
    if (!current && latest.current.immersive) return; // the lock card explains the state
    if (!current) {
      ctx.fillStyle = "#9aafa3";
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Camera off • no frame is being displayed",
        r.width / 2,
        r.height / 2,
      );
      return;
    }
    c.dataset.frameSeq = String(current.meta.seq);
    c.dataset.source = current.meta.source;
    const box = containRect(r.width, r.height, current.meta.w, current.meta.h);
    ctx.drawImage(current.bitmap, box.x, box.y, box.w, box.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    function path(points, ink, thick = 3) {
      if (!points?.length) return;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = thick;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = box.x + p.u * box.w,
          y = box.y + p.v * box.h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      if (points.length === 1) {
        const p = points[0];
        ctx.arc(box.x + p.u * box.w, box.y + p.v * box.h, 3, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.stroke();
    }
    for (const o of current.meta.overlays || []) {
      path(o.points, o.color);
      if (latest.current.labels && o.points?.[0]) {
        const p = o.points[0];
        ctx.textAlign = "left";
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(
          (o.ownerName || o.source || "").slice(0, 30),
          box.x + p.u * box.w + 6,
          box.y + p.v * box.h - 7,
        );
      }
    }
    for (const p of current.meta.hands || []) {
      ctx.fillStyle = "#b8ffd5";
      ctx.beginPath();
      ctx.arc(box.x + p.u * box.w, box.y + p.v * box.h, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (stroke.current) path(stroke.current.points, stroke.current.color, 4);
    ctx.restore();
    ctx.textAlign = "left";
    if (current.meta.source === "simulation") {
      // Immersive layout: tag the image's bottom-left corner so floating bars don't hide it.
      const x = latest.current.immersive ? box.x + 12 : 10,
        y = latest.current.immersive ? box.y + box.h - 40 : 10;
      ctx.fillStyle = "#f9d378";
      ctx.fillRect(x, y, 230, 28);
      ctx.fillStyle = "#17261f";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("SIMULATED SOURCE — NOT CAMERA", x + 8, y + 19);
    }
  }
  paintRef.current = render;
  function clearFrame() {
    generation.current++;
    pending.current = null;
    const a = stroke.current?.frame?.bitmap,
      b = frame.current?.bitmap;
    if (a && a !== b) a.close?.();
    b?.close?.();
    frame.current = null;
    stroke.current = null;
    paintRef.current();
  }
  async function receive(buffer, playback = false) {
    if (!playback && latest.current.mode !== "live") return;
    pending.current = { buffer, playback };
    if (decoding.current) return;
    decoding.current = true;
    while (pending.current) {
      const item = pending.current;
      pending.current = null;
      const g = generation.current;
      try {
        const { meta, jpeg } = unpackPacket(item.buffer),
          bitmap = await decode(jpeg);
        if (g !== generation.current) {
          bitmap.close?.();
          continue;
        }
        if (bitmap.width !== meta.w || bitmap.height !== meta.h) {
          bitmap.close?.();
          throw Error("JPEG dimensions do not match metadata");
        }
        const previous = frame.current;
        frame.current = { meta, bitmap };
        if (previous && previous.bitmap !== stroke.current?.frame.bitmap)
          previous.bitmap.close?.();
        const now = Date.now();
        times.current = times.current.filter((t) => now - t < 1000);
        times.current.push(now);
        setMetrics({
          fps: times.current.length,
          age: Math.round(now - meta.ts),
          calibration: meta.calibration,
        });
        if (
          record.current?.active &&
          latest.current.recording &&
          !item.playback &&
          latest.current.status.captureUntil > now
        ) {
          record.current.frames.push(to64(item.buffer));
          setRecorded(record.current.frames.length);
          if (record.current.frames.length >= 30) {
            setRecording(false);
            setNotice(
              "30-frame clip captured in memory. Download it explicitly.",
            );
            record.current.active = false;
          }
        }
        paintRef.current();
      } catch (e) {
        setNotice(e.message);
      }
    }
    decoding.current = false;
  }
  function cancelStroke() {
    const s = stroke.current;
    if (s) {
      send({
        type: "remoteStroke",
        id: s.id,
        epoch: s.frame.meta.epoch,
        frameSeq: s.frame.meta.seq,
        phase: "cancel",
        points: s.points,
        color: s.color,
        width: s.width,
      });
      if (s.frame.bitmap !== frame.current?.bitmap) s.frame.bitmap.close?.();
    }
    stroke.current = null;
    paintRef.current();
  }
  useEffect(() => {
    let disposed = false,
      timer,
      attempt = 0;
    function connect() {
      // A state broadcast is not a new connection. Subscribe exactly once per
      // authenticated socket, and repeat only when a fresh socket reconnects.
      let subscribed = false;
      let streamStatus = null;
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`,
      );
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: "auth",
            room: session.roomId,
            token: session.token,
          }),
        );
      socket.onmessage = (e) => {
        if (disposed) return;
        if (typeof e.data !== "string") {
          receive(e.data);
          return;
        }
        const m = JSON.parse(e.data);
        if (m.type === "state") {
          setConnected(true);
          attempt = 0;
          if (!subscribed) {
            subscribed = true;
            socket.send(JSON.stringify({ type: "watchLive", enabled: true }));
          }
        } else if (m.type === "streamStatus") {
          const streamChanged =
            !streamStatus ||
            !!m.live !== !!streamStatus.live ||
            m.epoch !== streamStatus.epoch;
          streamStatus = m;
          setStatus(m);
          // Capture-permission/status refreshes must not erase save results,
          // rejection reasons or the physical-placement safety warning.
          if (streamChanged && latest.current.mode === "live") {
            clearFrame();
            setNotice(
              m.live
                ? "Live camera connected. Frame age depends on source/receiver clock synchronization."
                : "Camera stopped. No live frame retained in this view.",
            );
          }
        } else if (m.type === "remoteResult") {
          setNotice(
            m.error ||
              (latest.current.immersive
                ? m.placement === "fixed-distance"
                  ? "Placed 1.5 m in front of the wearer — no surface found there"
                  : `Pinned to ${surfaceName(m.anchorId)} in the wearer's space`
                : m.placement === "fixed-distance"
                  ? "Stroke saved. Approximate 1.5 m fallback — NOT anchored to a detected real surface."
                  : "Stroke saved. Projected onto a scene plane; verify physical alignment."),
          );
        } else if (m.type === "error") {
          setNotice(m.error);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (latest.current.mode === "live") clearFrame();
        if (!disposed)
          timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
      };
    }
    connect();
    const ro = new ResizeObserver(() => paintRef.current());
    ro.observe(canvas.current);
    clock.current = setInterval(() => {
      if (
        latest.current.recording &&
        (!latest.current.status.captureUntil ||
          Date.now() > latest.current.status.captureUntil)
      ) {
        setRecording(false);
        setNotice("Host capture permission expired. Recording stopped.");
      }
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(clock.current);
      clearInterval(replay.current);
      ro.disconnect();
      ws.current?.close();
      clearFrame();
    };
  }, [session.roomId, session.token]);
  // Immersive layout: notices show briefly as a toast.
  useEffect(() => {
    if (!immersive || !notice) return;
    setToastOn(true);
    const t = setTimeout(() => setToastOn(false), 3800);
    return () => clearTimeout(t);
  }, [notice, immersive]);
  useEffect(() => {
    if (state.collaborativeWriting === false) cancelStroke();
    paintRef.current();
  }, [state.collaborativeWriting, labels, fullscreen]);
  const normalize = (e) => {
    const f = stroke.current?.frame || frame.current;
    if (!f) return null;
    const r = canvas.current.getBoundingClientRect(),
      box = containRect(r.width, r.height, f.meta.w, f.meta.h),
      u = (e.clientX - r.left - box.x) / box.w,
      v = (e.clientY - r.top - box.y) / box.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
  };
  function begin(e) {
    if (!canDraw || !e.isPrimary || !frame.current) return;
    const p = normalize(e);
    if (!p) return;
    canvas.current.setPointerCapture(e.pointerId);
    stroke.current = {
      id: uuid(),
      frame: frame.current,
      points: [p],
      color,
      width,
      last: 0,
      started: Date.now(),
    };
    sendStroke("preview");
    paintRef.current();
  }
  function sendStroke(phase) {
    const s = stroke.current;
    if (!s) return;
    send({
      type: "remoteStroke",
      id: s.id,
      epoch: s.frame.meta.epoch,
      frameSeq: s.frame.meta.seq,
      phase,
      points: s.points,
      color: s.color,
      width: s.width,
    });
  }
  function move(e) {
    const s = stroke.current;
    if (!s) return;
    if (Date.now() - s.started > 9000) {
      cancelStroke();
      setNotice(
        "Stroke exceeded 9 seconds. Draw a shorter stroke on a fresh frame.",
      );
      return;
    }
    const p = normalize(e);
    if (!p) return;
    if (s.points.length < 256) s.points.push(p);
    if (Date.now() - s.last > 90) {
      s.last = Date.now();
      sendStroke("preview");
    }
    paintRef.current();
  }
  function end() {
    const s = stroke.current;
    if (!s) return;
    sendStroke("commit");
    stroke.current = null;
    if (s.frame.bitmap !== frame.current?.bitmap) s.frame.bitmap.close?.();
    setNotice(
      immersive
        ? "Placing your stroke in the wearer's space…"
        : "Sent. Waiting for headset reprojection…",
    );
    paintRef.current();
  }
  async function ask() {
    setAsking(true);
    try {
      const result = await api(`/rooms/${session.roomId}/liveview/ask`, {
        method: "POST",
        body: JSON.stringify({ prompt: question, consent: true }),
      });
      setAnswer(result.text);
    } catch (e) {
      onError(e.message);
    } finally {
      setAsking(false);
    }
  }
  function saveClip() {
    if (!record.current?.frames.length) return;
    const blob = new Blob(
        [
          JSON.stringify({
            format: "alongside-liveview-replay",
            version: 1,
            frames: record.current.frames,
          }),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "alongside-approved-replay.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function loadReplay(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 25000000) throw Error("Replay file is too large");
      const data = JSON.parse(await file.text());
      if (
        data.format !== "alongside-liveview-replay" ||
        data.version !== 1 ||
        !Array.isArray(data.frames) ||
        !data.frames.length ||
        data.frames.length > 30
      )
        throw Error("Invalid replay file");
      const frames = data.frames.map(from64);
      frames.forEach(unpackPacket);
      cancelStroke();
      clearFrame();
      clearInterval(replay.current);
      setMode("replay");
      setNotice("REPLAY — recorded frames, no live camera or world writes.");
      let i = 0;
      replay.current = setInterval(
        () => receive(frames[i++ % frames.length], true),
        100,
      );
    } catch (e) {
      onError(e.message);
    }
  }
  const action = (body) =>
    api(`/rooms/${session.roomId}/actions`, {
      method: "POST",
      body: JSON.stringify(body),
    }).catch((e) => onError(e.message));
  if (immersive) {
    const lock =
      mode === "replay"
        ? null
        : !connected
          ? ["Connecting…", "Reaching the Alongside server."]
          : state.collaborativeWriting === false
            ? [
                "Drawing paused",
                "The host turned spatial writing off for everyone.",
              ]
            : !status.live
              ? [
                  "Waiting for the Quest camera",
                  "Ask the wearer to pinch Camera ON above the board.",
                ]
              : null;
    const hostName =
      (state.members || []).find((m) => m.role === "host")?.name || "Quest";
    const online = peers.length ? peers : [session.member];
    return (
      <section className="lv" ref={container}>
        <div className="lv-stage">
          <canvas
            data-testid="live-canvas"
            ref={canvas}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={cancelStroke}
          />
          {lock && (
            <div className="lv-lock">
              <div className="lv-glass lv-lock-card">
                {lock[0] !== "Drawing paused" && (
                  <span className="lv-spinner" />
                )}
                <strong>{lock[0]}</strong>
                <span>{lock[1]}</span>
              </div>
            </div>
          )}
        </div>

        <header className="lv-top">
          <div className="lv-glass lv-title">
            <span
              className={
                "lv-pill " +
                (mode === "replay" ? "replay" : status.live ? "live" : "off")
              }
            >
              <i />
              {mode === "replay" ? "Replay" : status.live ? "Live" : "Offline"}
            </span>
            <div>
              <strong>{hostName}</strong>
              <small>
                Room {state.id}
                {status.live && mode === "live"
                  ? ` · ${metrics.fps} fps · ${metrics.age < 0 ? "clock skew" : metrics.age + " ms"}`
                  : ""}
              </small>
            </div>
          </div>
          <div className="lv-glass lv-actions">
            <div
              className="lv-avatars"
              aria-label={online.length + " people in the room"}
            >
              {online.slice(0, 4).map((p) => (
                <span key={p.id} title={p.name} style={{ background: p.color }}>
                  {(p.name || "?").slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
            <button
              className={"lv-icon " + (labels ? "on" : "")}
              aria-label="Author labels"
              aria-pressed={labels}
              onClick={() => setLabels(!labels)}
            >
              <Icon d={ICONS.tag} />
            </button>
            <button
              className="lv-icon"
              aria-label="Session menu"
              onClick={() => setSheet(true)}
            >
              <Icon d={ICONS.more} />
            </button>
          </div>
        </header>

        <div
          className={"lv-toast lv-glass " + (toastOn ? "show" : "")}
          role="status"
        >
          {notice}
        </div>

        <footer className="lv-dock lv-glass" aria-label="Drawing tools">
          <div className="lv-swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                aria-label={"Ink " + c}
                aria-pressed={color === c}
                className={color === c ? "on" : ""}
                style={{ "--c": c }}
                onClick={() => setColor(c)}
              />
            ))}
            <label
              className={"lv-custom " + (SWATCHES.includes(color) ? "" : "on")}
              style={{ "--c": color }}
              title="Custom color"
            >
              <input
                aria-label="Live ink color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
          <span className="lv-sep" />
          <div className="lv-widths">
            {WIDTHS.map(([w, label, px]) => (
              <button
                key={w}
                aria-label={label + " stroke"}
                aria-pressed={width === w}
                className={width === w ? "on" : ""}
                onClick={() => setWidth(w)}
              >
                <i style={{ width: px, height: px, background: color }} />
              </button>
            ))}
          </div>
          <span className="lv-sep" />
          <button
            className="lv-icon"
            aria-label="Undo my spatial stroke"
            disabled={!canDraw}
            onClick={() => action({ type: "spatial.undo" })}
          >
            <Icon d={ICONS.undo} />
          </button>
          <button
            className="lv-icon"
            aria-label="Clear my strokes"
            disabled={!canDraw}
            onClick={() =>
              confirm("Remove all of your strokes from the wearer's space?") &&
              action({ type: "spatial.clearMine" })
            }
          >
            <Icon d={ICONS.trash} />
          </button>
        </footer>

        <div
          className={"lv-scrim " + (sheet ? "open" : "")}
          onClick={() => setSheet(false)}
        />
        <aside
          className={"lv-sheet " + (sheet ? "open" : "")}
          aria-hidden={!sheet}
          aria-label="Session"
        >
          <div className="lv-sheet-head">
            <h3>Session</h3>
            <button
              className="lv-icon"
              aria-label="Close"
              onClick={() => setSheet(false)}
            >
              <Icon d={ICONS.close} />
            </button>
          </div>

          <h4>In the room</h4>
          {online.map((p) => (
            <div className="lv-person" key={p.id}>
              <span className="lv-avatar" style={{ background: p.color }}>
                {(p.name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span>
                {p.name}
                {p.id === session.member.id && <small> · you</small>}
              </span>
            </div>
          ))}

          {host && (
            <>
              <h4>Host controls</h4>
              <label className="lv-row">
                <span>Spatial writing</span>
                <input
                  className="lv-switch"
                  aria-label="Spatial writing"
                  type="checkbox"
                  checked={state.collaborativeWriting !== false}
                  onChange={(e) =>
                    action({
                      type: "collaborativeWriting",
                      value: e.target.checked,
                    })
                  }
                />
              </label>
              <div className="lv-buttons">
                <button
                  className="lv-btn"
                  onClick={() =>
                    action({ type: "aiEnabled", value: !state.aiEnabled })
                  }
                >
                  {state.aiEnabled ? "Pause AI" : "Resume AI"}
                </button>
                <button
                  className="lv-btn danger"
                  onClick={() =>
                    api(`/rooms/${session.roomId}/liveview/stop`, {
                      method: "POST",
                      body: "{}",
                    }).catch((e) => onError(e.message))
                  }
                >
                  Stop camera
                </button>
              </div>
            </>
          )}

          <h4>Ask AI about this view</h4>
          <textarea
            aria-label="Question about live frame"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1600}
          />
          <label className="lv-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Send this frame and question to my configured AI provider
          </label>
          <button
            className="lv-btn primary"
            disabled={asking || !consent || !status.live || mode !== "live"}
            onClick={ask}
          >
            {asking ? "Asking…" : "Ask AI"}
          </button>
          {answer && <p className="lv-answer">{answer}</p>}

          <h4>Approved replay</h4>
          <p className="lv-fine">
            The Quest host must press “Allow capture” before a clip can be
            recorded. Frames are never saved automatically.
          </p>
          <div className="lv-buttons">
            <button
              className="lv-btn"
              disabled={
                !status.live ||
                !(status.captureUntil > Date.now()) ||
                mode !== "live"
              }
              onClick={() => {
                record.current = { frames: [], active: true };
                setRecorded(0);
                setRecording(true);
                setNotice("Recording up to 30 frames, with host permission.");
              }}
            >
              Record clip
            </button>
            <button
              className="lv-btn"
              disabled={!recorded}
              onClick={() => {
                setRecording(false);
                saveClip();
              }}
            >
              Download {recorded || ""} frames
            </button>
            <button
              className="lv-btn"
              onClick={() => fileInput.current.click()}
            >
              Open replay
            </button>
            {mode === "replay" && (
              <button
                className="lv-btn primary"
                onClick={() => {
                  clearInterval(replay.current);
                  clearFrame();
                  setMode("live");
                }}
              >
                Back to live
              </button>
            )}
          </div>

          <div className="lv-sheet-foot">
            {nativeApp() && (
              <button
                className="lv-btn"
                onClick={() => nativeApp().postMessage({ action: "server" })}
              >
                <Icon d={ICONS.server} size={18} /> Server
              </button>
            )}
            {onOpenWorkspace && (
              <button className="lv-btn" onClick={onOpenWorkspace}>
                <Icon d={ICONS.grid} size={18} /> Shared board
              </button>
            )}
            {onLeave && (
              <button className="lv-btn danger" onClick={onLeave}>
                <Icon d={ICONS.exit} size={18} /> Leave
              </button>
            )}
          </div>
        </aside>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={loadReplay}
        />
      </section>
    );
  }
  return (
    <section
      ref={container}
      className={"liveview " + (fullscreen ? "live-full" : "")}
    >
      <header className="liveview-head">
        <div>
          <span
            className={
              "live-badge " +
              (mode === "replay" ? "replay" : status.live ? "on" : "off")
            }
          >
            {mode === "replay"
              ? "REPLAY — NOT LIVE"
              : status.live
                ? "● CAMERA LIVE"
                : "CAMERA OFF"}
          </span>
          <h3>See together. Point precisely.</h3>
        </div>
        <button onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </header>
      <div className="live-metrics">
        <span>{metrics.fps} decoded fps</span>
        <span>
          {metrics.age < 0 ? "Clock skew" : metrics.age + " ms frame age"}{" "}
          <small>(clocks must match)</small>
        </span>
        <span>Calibration: {metrics.calibration}</span>
      </div>
      <div className="live-stage">
        <canvas
          data-testid="live-canvas"
          ref={canvas}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={cancelStroke}
        />
        {!canDraw && (
          <div className="live-lock">
            {mode === "replay"
              ? "Replay is view-only"
              : !state.collaborativeWriting
                ? "Spatial writing paused for everyone"
                : !status.live
                  ? "Waiting for camera"
                  : "Connecting…"}
          </div>
        )}
      </div>
      <div className="live-tools">
        {host && (
          <>
            <label>
              <input
                aria-label="Spatial writing"
                type="checkbox"
                checked={state.collaborativeWriting !== false}
                onChange={(e) =>
                  api(`/rooms/${session.roomId}/actions`, {
                    method: "POST",
                    body: JSON.stringify({
                      type: "collaborativeWriting",
                      value: e.target.checked,
                    }),
                  }).catch((e) => onError(e.message))
                }
              />
              Spatial writing
            </label>
            <button
              onClick={() =>
                api(`/rooms/${session.roomId}/actions`, {
                  method: "POST",
                  body: JSON.stringify({
                    type: "aiEnabled",
                    value: !state.aiEnabled,
                  }),
                }).catch((e) => onError(e.message))
              }
            >
              {state.aiEnabled ? "Pause AI" : "Resume AI"}
            </button>
          </>
        )}
        <label>
          Ink{" "}
          <input
            aria-label="Live ink color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Width{" "}
          <input
            aria-label="Live stroke width"
            type="range"
            min=".002"
            max=".015"
            step=".001"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => setLabels(e.target.checked)}
          />
          Author labels
        </label>
        {host && (
          <button
            onClick={() =>
              api(`/rooms/${session.roomId}/liveview/stop`, {
                method: "POST",
                body: "{}",
              }).catch((e) => onError(e.message))
            }
          >
            Stop camera
          </button>
        )}
        <button
          onClick={() =>
            api(`/rooms/${session.roomId}/actions`, {
              method: "POST",
              body: JSON.stringify({ type: "spatial.undo" }),
            }).catch((e) => onError(e.message))
          }
          disabled={!canDraw}
        >
          Undo my spatial stroke
        </button>
      </div>
      <p role="status" className="live-notice">
        {notice}
      </p>
      <p className="fine">
        Draw with finger or Pencil. The displayed frame freezes during each
        stroke. Green dots are the wearer's tracked hands. A fixed-distance
        fallback is not physical surface tracking.
      </p>
      <details>
        <summary>Ask AI about this view</summary>
        <textarea
          aria-label="Question about live frame"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1600}
        />
        <label className="live-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Send this frame and question to my configured AI provider
        </label>
        <button
          disabled={asking || !consent || !status.live || mode !== "live"}
          onClick={ask}
        >
          {asking ? "Asking…" : "Ask AI about what I see"}
        </button>
        {answer && <p className="live-answer">{answer}</p>}
        <p className="fine">
          Pause AI sends no frame to a model. Collaborative writing OFF permits
          text-only guidance. Without keys the response is explicitly scripted.
        </p>
      </details>
      <details>
        <summary>Judging backup / approved replay</summary>
        <p className="fine">
          The Quest host must press “Allow capture” before a clip can be
          recorded here. Camera frames are not saved automatically. Room members
          can still take screenshots outside this app.
        </p>
        <div className="live-tools">
          <button
            disabled={
              !status.live ||
              !(status.captureUntil > Date.now()) ||
              mode !== "live"
            }
            onClick={() => {
              record.current = { frames: [], active: true };
              setRecorded(0);
              setRecording(true);
              setNotice("Recording up to 30 frames, with host permission.");
            }}
          >
            Record approved clip
          </button>
          <button
            disabled={!recorded}
            onClick={() => {
              setRecording(false);
              saveClip();
            }}
          >
            Download {recorded} frames
          </button>
          <button onClick={() => fileInput.current.click()}>
            Open replay file
          </button>
          {mode === "replay" && (
            <button
              onClick={() => {
                clearInterval(replay.current);
                clearFrame();
                setMode("live");
              }}
            >
              Return to live
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={loadReplay}
        />
      </details>
    </section>
  );
}
