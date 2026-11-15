export const COLORS = ["#256b62", "#da6b45", "#4b68bd", "#a0609c", "#273a47"];
export const TASK =
  "Place the three tiles on their matching outlines. This is a spatial learning demonstration, not an electrical simulation.";
export function initialObjects() {
  return [
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
}
export function placed(o) {
  return Math.hypot(o.x - o.target.x, o.y - o.target.y) < 0.055;
}
export function anchorPoint(p, ann, objects) {
  const o = objects.find((x) => x.id === ann.anchorId);
  return o ? { x: o.x - o.w / 2 + p.x * o.w, y: o.y - o.h / 2 + p.y * o.h } : p;
}
export function hitObject(objects, p) {
  return [...objects]
    .reverse()
    .find(
      (o) => Math.abs(o.x - p.x) < o.w / 2 && Math.abs(o.y - p.y) < o.h / 2,
    );
}
export function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
export function makeGuideActions(state) {
  const o = state.objects.find((x) => !placed(x));
  if (!o)
    return {
      annotations: [],
      text: "All three tiles are aligned. Explain the sequence to your collaborator, or reset the exercise to try again.",
    };
  return {
    annotations: [
      {
        type: "circle",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        anchorId: o.id,
        color: "#a0609c",
        width: 4,
        text: "",
      },
      {
        type: "arrow",
        points: [
          { x: o.x, y: o.y - 0.09 },
          { x: o.target.x, y: o.target.y + 0.09 },
        ],
        color: "#a0609c",
        width: 4,
        text: "",
      },
    ],
    text: `Move ${o.label} (${o.glyph}) onto its matching dashed outline. Use Move mode and drag the tile. ${state.objects.filter(placed).length} of 3 are aligned.`,
  };
}
