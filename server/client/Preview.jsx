import React, { useRef, useState } from "react";

// Local, self-contained preview. No network, API credentials, or device access.
// Download the server package for real multi-device collaboration and MCP.
const seed = () => [
  {
    id: "base",
    label: "Foundation",
    glyph: "01",
    color: "#256b62",
    x: 0.24,
    y: 0.77,
    w: 0.16,
    h: 0.14,
    target: { x: 0.24, y: 0.39 },
    version: 0,
  },
  {
    id: "bridge",
    label: "Connection",
    glyph: "02",
    color: "#da6b45",
    x: 0.5,
    y: 0.77,
    w: 0.16,
    h: 0.14,
    target: { x: 0.5, y: 0.39 },
    version: 0,
  },
  {
    id: "cap",
    label: "Finish",
    glyph: "03",
    color: "#4b68bd",
    x: 0.76,
    y: 0.77,
    w: 0.16,
    h: 0.14,
    target: { x: 0.76, y: 0.39 },
    version: 0,
  },
];
const aligned = (o) => Math.hypot(o.x - o.target.x, o.y - o.target.y) < 0.055;
const ink = "#253c35";
export default function AlongsidePreview() {
  const [objects, setObjects] = useState(seed),
    [marks, setMarks] = useState([]),
    [draft, setDraft] = useState(null),
    [tool, setTool] = useState("pen"),
    [color, setColor] = useState("#256b62"),
    [label, setLabel] = useState("Look here"),
    [message, setMessage] = useState(
      "Draw on the canvas, or choose Move and drag a tile to its outline.",
    ),
    [showAI, setShowAI] = useState(true),
    [json, setJson] = useState("");
  const svg = useRef(null),
    drag = useRef(null);
  const count = objects.filter(aligned).length;
  const button = (active = false) => ({
    border: "1px solid " + (active ? "#a8bda7" : "#dce1d4"),
    borderRadius: 7,
    padding: "9px 13px",
    background: active ? "#e0ead9" : "#faf9f4",
    color: ink,
    cursor: "pointer",
    fontSize: 12,
  });
  const point = (e) => {
    const r = svg.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  function begin(e) {
    if (e.button !== 0 || e.isPrimary === false) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === "move") {
      const o = [...objects]
        .reverse()
        .find(
          (o) => Math.abs(o.x - p.x) < o.w / 2 && Math.abs(o.y - p.y) < o.h / 2,
        );
      if (o)
        drag.current = { type: "move", id: o.id, dx: o.x - p.x, dy: o.y - p.y };
      return;
    }
    if (tool === "label") {
      setMarks((m) => [
        ...m,
        {
          id: Date.now().toString(),
          type: "label",
          points: [p],
          text: label || "Note",
          width: 4,
          color,
          source: "human",
        },
      ]);
      return;
    }
    const a = {
      id: Date.now().toString(),
      type: tool,
      points: tool === "pen" ? [p] : [p, p],
      text: "",
      width: 4,
      color,
      source: "human",
    };
    drag.current = { type: "draw", a };
    setDraft(a);
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.type === "move") {
      setObjects((os) =>
        os.map((o) =>
          o.id === d.id
            ? {
                ...o,
                x: Math.max(0.1, Math.min(0.9, p.x + d.dx)),
                y: Math.max(0.16, Math.min(0.88, p.y + d.dy)),
              }
            : o,
        ),
      );
      return;
    }
    const a = d.a;
    a.points =
      a.type === "pen" ? [...a.points.slice(-510), p] : [a.points[0], p];
    setDraft({ ...a });
  }
  function end(cancel = false) {
    const d = drag.current;
    if (d?.type === "draw" && !cancel) setMarks((m) => [...m, d.a]);
    drag.current = null;
    setDraft(null);
  }
  function guide() {
    const o = objects.find((o) => !aligned(o));
    if (!o) {
      setMessage(
        "Scripted practice: all three tiles are aligned. Explain the sequence to a collaborator in the full application.",
      );
      return;
    }
    setMarks((ms) => [
      ...ms.filter((m) => m.source !== "ai"),
      {
        id: "guide-circle",
        type: "circle",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        anchorId: o.id,
        width: 4,
        color: "#a0609c",
        source: "ai",
        text: "",
      },
      {
        id: "guide-arrow",
        type: "arrow",
        points: [
          { x: o.x, y: o.y - 0.1 },
          { x: o.target.x, y: o.target.y + 0.1 },
        ],
        width: 4,
        color: "#a0609c",
        source: "ai",
        text: "",
      },
    ]);
    setMessage(
      `Scripted practice: move ${o.label} (${o.glyph}) onto its matching outline. ${count} of 3 are aligned. This is a deterministic guide, not a live AI model.`,
    );
  }
  function exportBoard() {
    const data = JSON.stringify(
      {
        format: "alongside-board",
        version: 1,
        title: "Alongside preview",
        exportedAt: new Date().toISOString(),
        objects,
        annotations: marks,
        messages: [],
      },
      null,
      2,
    );
    setJson(data);
    try {
      const u = URL.createObjectURL(
        new Blob([data], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = u;
      a.download = "alongside-preview-board.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch {}
    setMessage(
      "Board JSON is ready below. Download it or copy it, then import it into your real Alongside workspace.",
    );
  }
  function mark(a, i) {
    if (a.source === "ai" && !showAI) return null;
    const obj = objects.find((o) => o.id === a.anchorId);
    const ps = a.points
      .map((p) =>
        obj
          ? {
              x: obj.x - obj.w / 2 + p.x * obj.w,
              y: obj.y - obj.h / 2 + p.y * obj.h,
            }
          : p,
      )
      .map((p) => ({ x: p.x * 900, y: p.y * 560 }));
    const p = ps[0],
      q = ps.at(-1);
    const common = {
      stroke: a.color,
      strokeWidth: a.width,
      fill: "none",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    };
    if (a.type === "pen")
      return (
        <polyline
          key={i}
          points={ps.map((x) => `${x.x},${x.y}`).join(" ")}
          {...common}
        />
      );
    if (a.type === "circle")
      return (
        <ellipse
          key={i}
          cx={(p.x + q.x) / 2}
          cy={(p.y + q.y) / 2}
          rx={Math.max(3, Math.abs(q.x - p.x) / 2)}
          ry={Math.max(3, Math.abs(q.y - p.y) / 2)}
          {...common}
        />
      );
    if (a.type === "label")
      return (
        <text key={i} x={p.x} y={p.y} fill={a.color} fontSize="20">
          {a.text}
        </text>
      );
    const t = Math.atan2(q.y - p.y, q.x - p.x);
    return (
      <path
        key={i}
        d={`M${p.x} ${p.y}L${q.x} ${q.y}M${q.x - 16 * Math.cos(t - 0.5)} ${q.y - 16 * Math.sin(t - 0.5)}L${q.x} ${q.y}L${q.x - 16 * Math.cos(t + 0.5)} ${q.y - 16 * Math.sin(t + 0.5)}`}
        {...common}
      />
    );
  }
  return (
    <div
      style={{
        fontFamily: "Avenir Next, Segoe UI, sans-serif",
        color: ink,
        background: "#efede5",
        minHeight: 700,
        padding: 24,
        borderRadius: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: "1px solid #d9decf",
          paddingBottom: 20,
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1.5 }}>
          ◌ alongside<span style={{ color: "#da6b45" }}>.</span>
        </div>
        <span style={{ fontSize: 10, letterSpacing: 1.2, color: "#657b65" }}>
          YOUR PEOPLE. YOUR AI. ONE SHARED SPACE.
        </span>
        <button style={button()} onClick={exportBoard}>
          Export board ↓
        </button>
      </header>
      <div style={{ padding: "14px 0", fontSize: 12, color: "#6e7967" }}>
        LOCAL INTERACTIVE PREVIEW · No network or live AI. The downloadable
        server app provides real rooms, WebXR and MCP.
      </div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        <main style={{ flex: "3 1 540px", minWidth: 0 }}>
          <h1
            style={{
              font: "34px Georgia, serif",
              letterSpacing: -1,
              margin: "12px 0 20px",
            }}
          >
            A little more perspective.
          </h1>
          <div
            style={{
              display: "flex",
              gap: 7,
              flexWrap: "wrap",
              alignItems: "center",
              padding: 10,
              background: "#faf9f4",
              borderRadius: 10,
              border: "1px solid #d9dece",
            }}
          >
            {[
              ["pen", "✎ Pen"],
              ["move", "↔ Move"],
              ["arrow", "↗ Arrow"],
              ["circle", "◯ Circle"],
              ["label", "T Text"],
            ].map(([id, text]) => (
              <button
                key={id}
                style={button(tool === id)}
                onClick={() => setTool(id)}
              >
                {text}
              </button>
            ))}
            {["#256b62", "#da6b45", "#4b68bd", "#a0609c"].map((c) => (
              <button
                key={c}
                aria-label={"Ink " + c}
                onClick={() => setColor(c)}
                style={{
                  height: 22,
                  width: 22,
                  borderRadius: "50%",
                  border: "3px solid #faf9f4",
                  outline: c === color ? "1px solid #63725b" : "none",
                  background: c,
                  cursor: "pointer",
                }}
              />
            ))}
            <button
              style={button()}
              onClick={() =>
                setMarks((ms) => {
                  const n = [...ms];
                  for (let i = n.length - 1; i >= 0; i--)
                    if (n[i].source === "human") {
                      n.splice(i, 1);
                      break;
                    }
                  return n;
                })
              }
            >
              ↶ Undo
            </button>
          </div>
          {tool === "label" && (
            <input
              aria-label="Annotation label"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 240))}
              style={{
                padding: 10,
                marginTop: 10,
                border: "1px solid #cad5bf",
                borderRadius: 7,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          )}
          <div
            style={{
              marginTop: 15,
              border: "1px solid #d3dcc8",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 9px 25px #2d4c2710",
            }}
          >
            <svg
              ref={svg}
              viewBox="0 0 900 560"
              style={{
                display: "block",
                width: "100%",
                background: "#fbfaf5",
                touchAction: "none",
                cursor: tool === "move" ? "grab" : "crosshair",
                userSelect: "none",
              }}
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={() => end()}
              onPointerCancel={() => end(true)}
            >
              <defs>
                <pattern
                  id="alongside-dots"
                  width="24"
                  height="24"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="12" cy="12" r=".8" fill="#d5dacd" />
                </pattern>
              </defs>
              <rect width="900" height="560" fill="url(#alongside-dots)" />
              <text
                x="35"
                y="34"
                fill="#73856c"
                fontSize="10"
                letterSpacing="2"
              >
                SHARED LEARNING CANVAS
              </text>
              <text
                x="35"
                y="70"
                fill={ink}
                fontFamily="Georgia,serif"
                fontSize="26"
              >
                A little guidance. A shared understanding.
              </text>
              <text x="35" y="96" fill="#819077" fontSize="12">
                Move the tiles. Draw a thought. Ask for a different perspective.
              </text>
              {objects.map((o) => (
                <g key={"target-" + o.id}>
                  <rect
                    x={(o.target.x - o.w / 2) * 900 - 6}
                    y={(o.target.y - o.h / 2) * 560 - 6}
                    width={o.w * 900 + 12}
                    height={o.h * 560 + 12}
                    rx="10"
                    fill="none"
                    stroke={aligned(o) ? o.color : "#aeba9f"}
                    strokeDasharray="6 6"
                  />
                  <text
                    x={o.target.x * 900}
                    y={(o.target.y + o.h / 2) * 560 + 33}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#829078"
                  >
                    {o.glyph} / {o.label}
                  </text>
                </g>
              ))}
              <line x1="35" x2="865" y1="370" y2="370" stroke="#e0e5d8" />
              <text
                x="35"
                y="357"
                fill="#88987d"
                fontSize="10"
                letterSpacing="1"
              >
                TILE TRAY
              </text>
              {objects.map((o) => (
                <g key={o.id}>
                  <rect
                    x={(o.x - o.w / 2) * 900}
                    y={(o.y - o.h / 2) * 560}
                    width={o.w * 900}
                    height={o.h * 560}
                    rx="12"
                    fill={o.color}
                  />
                  <text
                    x={(o.x - o.w / 2) * 900 + 16}
                    y={o.y * 560}
                    fill="white"
                    fontFamily="Georgia,serif"
                    fontSize="28"
                  >
                    {o.glyph}
                  </text>
                  <text
                    x={(o.x - o.w / 2) * 900 + 16}
                    y={o.y * 560 + 22}
                    fill="white"
                    fontSize="11"
                  >
                    {o.label}
                  </text>
                  {aligned(o) && (
                    <text
                      x={(o.x + o.w / 2) * 900 - 24}
                      y={o.y * 560 - 15}
                      fill="white"
                      fontSize="16"
                    >
                      ✓
                    </text>
                  )}
                </g>
              ))}
              {[...marks, ...(draft ? [draft] : [])].map(mark)}
              <text x="35" y="534" fill="#73866b" fontSize="11">
                {count}/3 ALIGNED · LOCAL PREVIEW
              </text>
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              paddingTop: 13,
              fontSize: 12,
              color: "#778c6e",
            }}
          >
            <span>
              {tool === "move"
                ? "Drag a tile to its dashed outline."
                : "Draw with touch or mouse. Use Move to place tiles."}
            </span>
            <label>
              <input
                type="checkbox"
                checked={showAI}
                onChange={(e) => setShowAI(e.target.checked)}
              />{" "}
              AI layer
            </label>
          </div>
        </main>
        <aside
          style={{
            flex: "1 1 230px",
            padding: 24,
            background: "#f8f7f0",
            border: "1px solid #dfe4d5",
            borderRadius: 12,
            alignSelf: "flex-start",
          }}
        >
          <div style={{ color: "#a0609c", fontSize: 35 }}>✳</div>
          <span style={{ fontSize: 9, letterSpacing: 1.5, color: "#86947a" }}>
            ANOTHER PERSPECTIVE
          </span>
          <h2 style={{ font: "29px Georgia,serif", margin: "15px 0" }}>
            Not just an answer.
            <br />
            Something you can point to.
          </h2>
          <div
            style={{
              background: "#efe9dc",
              padding: 8,
              borderRadius: 5,
              fontSize: 10,
              color: "#837861",
              marginBottom: 20,
            }}
          >
            SCRIPTED PRACTICE · NOT A LIVE MODEL
          </div>
          <button
            style={{
              ...button(),
              background: ink,
              color: "white",
              width: "100%",
            }}
            onClick={guide}
          >
            Show me the next step ↗
          </button>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.75,
              color: "#708068",
              padding: "16px 0",
            }}
          >
            {message}
          </p>
          <div style={{ borderTop: "1px solid #dce3d2", paddingTop: 18 }}>
            <b style={{ fontSize: 12 }}>In the full application</b>
            <p style={{ fontSize: 12, lineHeight: 1.8, color: "#798a70" }}>
              Invite an iPad or Quest. Connect your own AI. Let people and
              authorized agents draw on the same board.
            </p>
            <p style={{ fontSize: 11, lineHeight: 1.6, color: "#9a806a" }}>
              Live model credentials and physical headset tests are still
              required. Shizuku is not preconnected.
            </p>
          </div>
          <button
            style={button()}
            onClick={() => {
              setObjects(seed());
              setMarks([]);
              setDraft(null);
              setMessage("A fresh canvas. Start a new shared idea.");
            }}
          >
            Reset preview
          </button>
        </aside>
      </div>
      {json && (
        <div style={{ marginTop: 20 }}>
          <label style={{ fontSize: 12 }}>
            Exported board JSON — compatible with the server app’s Import board
            action
            <textarea
              readOnly
              value={json}
              style={{
                display: "block",
                width: "100%",
                height: 160,
                marginTop: 10,
                fontFamily: "monospace",
                fontSize: 11,
                padding: 12,
                border: "1px solid #cad5bf",
                borderRadius: 8,
                boxSizing: "border-box",
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
