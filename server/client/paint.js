import { anchorPoint, placed } from "../shared/model.js";
export const W = 1200,
  H = 750;
function round(ctx, x, y, w, h, r = 12) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
export function paint(
  ctx,
  state,
  { preview = [], cursors = [], showAI = true, ghost = null } = {},
) {
  const cw = ctx.canvas.width,
    ch = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(cw / W, 0, 0, ch / H, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fbfaf5";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#dddcd3";
  for (let x = 30; x < W; x += 30)
    for (let y = 30; y < H; y += 30) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.fillStyle = "#68736a";
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillText("SHARED LEARNING CANVAS", 48, 48);
  ctx.fillStyle = "#243b36";
  ctx.font = "30px Georgia, serif";
  ctx.fillText("A little guidance. A shared understanding.", 48, 95);
  ctx.fillStyle = "#78847c";
  ctx.font = "16px sans-serif";
  ctx.fillText(
    "Move each tile to its matching outline. Draw, point, or invite your assistant.",
    48,
    127,
  );
  const objects = state.objects.map((o) =>
    ghost?.id === o.id ? { ...o, ...ghost } : o,
  );
  for (const o of objects) {
    const x = o.target.x * W,
      y = o.target.y * H;
    ctx.strokeStyle = placed(o) ? o.color : "#b2b9ae";
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    round(
      ctx,
      x - (o.w * W) / 2 - 9,
      y - (o.h * H) / 2 - 9,
      o.w * W + 18,
      o.h * H + 18,
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#79857b";
    ctx.font = "14px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.fillText(o.glyph + " / " + o.label, x, y + (o.h * H) / 2 + 40);
    ctx.textAlign = "left";
  }
  ctx.strokeStyle = "#dce1d7";
  ctx.beginPath();
  ctx.moveTo(W * 0.33, H * 0.39);
  ctx.lineTo(W * 0.41, H * 0.39);
  ctx.moveTo(W * 0.59, H * 0.39);
  ctx.lineTo(W * 0.67, H * 0.39);
  ctx.stroke();
  ctx.fillStyle = "#7a867d";
  ctx.font = "13px ui-monospace,monospace";
  ctx.fillText("TILE TRAY", 48, 510);
  ctx.strokeStyle = "#e4e6dd";
  ctx.beginPath();
  ctx.moveTo(150, 505);
  ctx.lineTo(W - 48, 505);
  ctx.stroke();
  for (const o of objects) {
    const x = o.x * W,
      y = o.y * H;
    ctx.save();
    ctx.shadowColor = "#23362e20";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = o.color;
    round(ctx, x - (o.w * W) / 2, y - (o.h * H) / 2, o.w * W, o.h * H, 15);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#ffffff";
    ctx.font = "30px Georgia,serif";
    ctx.fillText(o.glyph, x - (o.w * W) / 2 + 18, y + 2);
    ctx.font = "14px sans-serif";
    ctx.fillText(o.label, x - (o.w * W) / 2 + 18, y + 28);
    if (placed(o)) {
      ctx.font = "18px sans-serif";
      ctx.fillText("✓", x + (o.w * W) / 2 - 28, y - 21);
    }
  }
  for (const a of [...state.annotations, ...preview]) {
    if (a.source === "ai" && !showAI) continue;
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = a.width || 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = a.points
      .map((p) => anchorPoint(p, a, objects))
      .map((p) => ({ x: p.x * W, y: p.y * H }));
    if (!pts.length) {
      ctx.restore();
      continue;
    }
    const p = pts[0],
      q = pts.at(-1);
    ctx.beginPath();
    if (a.type === "pen") {
      ctx.moveTo(p.x, p.y);
      for (const n of pts.slice(1)) ctx.lineTo(n.x, n.y);
      if (pts.length === 1) ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
    }
    if (a.type === "arrow") {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      const theta = Math.atan2(q.y - p.y, q.x - p.x),
        len = 19;
      ctx.moveTo(
        q.x - len * Math.cos(theta - 0.5),
        q.y - len * Math.sin(theta - 0.5),
      );
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(
        q.x - len * Math.cos(theta + 0.5),
        q.y - len * Math.sin(theta + 0.5),
      );
      ctx.stroke();
    }
    if (a.type === "circle") {
      ctx.ellipse(
        (p.x + q.x) / 2,
        (p.y + q.y) / 2,
        Math.max(4, Math.abs(p.x - q.x) / 2),
        Math.max(4, Math.abs(p.y - q.y) / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    if (a.type === "label") {
      ctx.font = "22px sans-serif";
      const text = (a.text || "").slice(0, 240);
      const width = Math.min(W - 30, ctx.measureText(text).width + 22);
      ctx.fillStyle = "#fbfaf5ed";
      round(ctx, p.x - 5, p.y - 25, width, 37, 6);
      ctx.fill();
      ctx.fillStyle = a.color;
      ctx.fillText(text, p.x + 5, p.y);
    }
    ctx.restore();
  }
  for (const c of cursors) {
    if (Date.now() - c.at > 1800) continue;
    const x = c.point.x * W,
      y = c.point.y * H;
    ctx.fillStyle = c.member.color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 5, y + 18);
    ctx.lineTo(x + 10, y + 11);
    ctx.lineTo(x + 18, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.fillText(c.member.name, x + 20, y + 21);
  }
  const n = objects.filter(placed).length;
  ctx.fillStyle = "#5f7166";
  ctx.font = "14px ui-monospace,monospace";
  ctx.fillText(`${n}/3 ALIGNED  ·  HUMAN + AI WORKSPACE`, 48, H - 32);
  ctx.restore();
}
