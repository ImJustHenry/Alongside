import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { paint, W, H } from "./paint.js";
import { hitObject, anchorPoint } from "../shared/model.js";
const clamp = (n) => Math.min(1, Math.max(0, n));
export default forwardRef(function Board(
  {
    state,
    member,
    tool,
    color,
    width,
    label,
    showAI,
    onAction,
    onSignal,
    previews,
    cursors,
    disabled,
  },
  ref,
) {
  const canvas = useRef(null),
    drag = useRef(null),
    latest = useRef(null),
    lastSignal = useRef(0);
  const [draft, setDraft] = useState(null),
    [ghost, setGhost] = useState(null);
  latest.current = {
    state,
    member,
    tool,
    color,
    width,
    label,
    showAI,
    onAction,
    onSignal,
    disabled,
  };
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) {
      paint(ctx, state, {
        showAI,
        preview: [
          ...Object.values(previews || {})
            .filter((x) => Date.now() - x.at < 2000)
            .map((x) => x.annotation),
          ...(draft ? [draft] : []),
        ],
        cursors: Object.values(cursors || {}),
        ghost,
      });
      canvas.current.dataset.paint = String(performance.now());
    }
  }, [state, draft, ghost, previews, cursors, showAI]);
  // A host may turn collaboration off in the middle of a pointer stroke.
  useEffect(() => {
    if (disabled) void end(true);
  }, [disabled]);
  function signal(type, body) {
    const now = performance.now();
    if (type !== "previewEnd" && now - lastSignal.current < 45) return;
    lastSignal.current = now;
    latest.current.onSignal?.({ type, ...body });
  }
  function begin(p) {
    const a = latest.current;
    if (a.disabled || drag.current) return;
    p = { x: clamp(p.x), y: clamp(p.y), p: clamp(p.p ?? 0.5) };
    if (a.tool === "move") {
      const o = hitObject(a.state.objects, p);
      if (o) {
        drag.current = {
          kind: "move",
          object: o,
          offset: { x: o.x - p.x, y: o.y - p.y },
          p,
        };
        setGhost({ ...o });
      }
      return;
    }
    if (a.tool === "erase") {
      const hit = [...a.state.annotations].reverse().find((ann) => {
        if (ann.ownerId !== a.member.id && a.member.role !== "host")
          return false;
        const pts = ann.points.map((q) => anchorPoint(q, ann, a.state.objects));
        if (ann.type === "circle" || ann.type === "label") {
          const xs = pts.map((q) => q.x),
            ys = pts.map((q) => q.y);
          return (
            p.x >= Math.min(...xs) - 0.02 &&
            p.x <= Math.max(...xs) + (ann.type === "label" ? 0.15 : 0.02) &&
            p.y >= Math.min(...ys) - 0.035 &&
            p.y <= Math.max(...ys) + 0.02
          );
        }
        return pts.some((q, i) => {
          const n = pts[Math.max(0, i - 1)],
            dx = q.x - n.x,
            dy = q.y - n.y,
            t = Math.max(
              0,
              Math.min(
                1,
                ((p.x - n.x) * dx + (p.y - n.y) * dy) /
                  (dx * dx + dy * dy || 1),
              ),
            );
          return Math.hypot(p.x - n.x - t * dx, p.y - n.y - t * dy) < 0.02;
        });
      });
      if (hit) a.onAction({ type: "erase", id: hit.id });
      return;
    }
    if (a.tool === "label") {
      if (a.label.trim())
        a.onAction({
          type: "add",
          annotation: {
            type: "label",
            points: [p],
            text: a.label.trim(),
            color: a.color,
            width: a.width,
          },
        });
      return;
    }
    const annotation = {
      type: a.tool,
      points: ["arrow", "circle"].includes(a.tool) ? [p, p] : [p],
      color: a.color,
      width: a.width,
      text: "",
      source: "human",
      ownerId: a.member.id,
    };
    drag.current = { kind: "draw", annotation };
    setDraft({ ...annotation });
  }
  function move(p) {
    const a = latest.current;
    p = { x: clamp(p.x), y: clamp(p.y), p: clamp(p.p ?? 0.5) };
    signal("cursor", { point: p });
    if (a.disabled) {
      if (drag.current) void end(true);
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "move") {
      d.p = p;
      setGhost({
        ...d.object,
        x: clamp(p.x + d.offset.x),
        y: clamp(p.y + d.offset.y),
      });
      return;
    }
    const ann = d.annotation;
    if (ann.type === "pen") {
      const last = ann.points.at(-1);
      if (Math.hypot(last.x - p.x, last.y - p.y) < 0.002) return;
      if (ann.points.length >= 512)
        ann.points = ann.points.filter((_, i) => i % 2 === 0);
      ann.points.push(p);
    } else ann.points[1] = p;
    setDraft({ ...ann, points: [...ann.points] });
    const { source, ownerId, ...wire } = ann;
    signal("preview", { annotation: wire });
  }
  async function end(cancel = false) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      if (!cancel && !latest.current.disabled) {
        if (d.kind === "move")
          await latest.current.onAction({
            type: "move",
            id: d.object.id,
            version: d.object.version,
            position: {
              x: clamp(d.p.x + d.offset.x),
              y: clamp(d.p.y + d.offset.y),
            },
          });
        else {
          const { source, ownerId, ...annotation } = d.annotation;
          await latest.current.onAction({ type: "add", annotation });
        }
      }
    } finally {
      setDraft(null);
      setGhost(null);
      signal("previewEnd", {});
    }
  }
  useImperativeHandle(
    ref,
    () => ({
      get canvas() {
        return canvas.current;
      },
      begin,
      move,
      end,
    }),
    [],
  );
  function location(e) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      p: e.pressure || 0.5,
    };
  }
  return (
    <canvas
      ref={canvas}
      data-testid="board"
      width={W * 1.5}
      height={H * 1.5}
      aria-label="Shared annotation board. Use Move to drag tiles; pen, arrow, circle and text tools to annotate."
      className={"board tool-" + tool}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.isPrimary === false) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        begin(location(e));
      }}
      onPointerMove={(e) => {
        if (e.isPrimary !== false) move(location(e));
      }}
      onPointerUp={() => end()}
      onPointerCancel={() => end(true)}
    />
  );
});
