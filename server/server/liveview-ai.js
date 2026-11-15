import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Fault } from "./store.js";
import { runProvider } from "./ai.js";
export async function askFrame(hub, ai, store, room, member, body) {
  const request = z
    .object({
      prompt: z.string().trim().min(1).max(1600),
      consent: z.literal(true),
    })
    .parse(body);
  if (!store.room(room).aiEnabled)
    return {
      paused: true,
      text: "AI is paused. No image or question was sent to an AI provider.",
    };
  const stream = hub.rooms.get(room),
    f = stream?.latest;
  if (!f || Date.now() - f.receivedAt > 2200)
    throw new Fault("No fresh live camera frame", 409);
  const key = ai.key(room, member),
    cfg = ai.configs.get(key);
  if (!cfg || cfg.provider === "demo")
    return {
      scripted: true,
      text: "[Scripted demo — not a live model] I cannot identify objects in this frame. Ask your human helper to circle a target, or connect a vision-capable AI account.",
    };
  if (ai.busy.has(key)) throw new Fault("Assistant already responding", 429);
  ai.busy.add(key);
  const actor = store.auth(room, cfg.agent.token),
    gateway = { room, actor, readyState: 1, send() {} };
  const check = () => {
    store.auth(room, cfg.agent.token);
    if (ai.configs.get(key) !== cfg)
      throw new Fault("Assistant disconnected", 403);
  };
  const uv = z.object({
    u: z.number().min(0).max(1),
    v: z.number().min(0).max(1),
  });
  const tools = [
    {
      name: "annotate_live_frame",
      description:
        "Draw an explanatory line or closed polyline on the selected frame. Coordinates u/v are 0..1, top-left origin. Reprojection is performed by the headset. Do not claim physical certainty.",
      schema: z.object({
        points: z.array(uv).min(2).max(128),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#a0609c"),
      }),
      run: ({ points, color }) => {
        check();
        if (Date.now() - f.receivedAt > 10000)
          throw new Fault("AI frame is stale; text guidance only", 409);
        if (hub.rooms.get(room) !== stream)
          throw new Fault("Camera source changed", 409);
        hub.request(
          gateway,
          {
            type: "remoteStroke",
            id: randomUUID(),
            epoch: f.meta.epoch,
            frameSeq: f.meta.seq,
            phase: "commit",
            points,
            color,
            width: 0.006,
          },
          actor,
          f,
        );
        return {
          submitted: true,
          physicalPlacement:
            "pending headset reprojection; may be an explicitly labeled fixed-distance fallback",
        };
      },
    },
  ];
  try {
    store.message(room, member, request.prompt);
    const text = await runProvider(
      cfg,
      tools,
      request.prompt +
        "\nFrame calibration: " +
        f.meta.calibration +
        ". This is a user-approved still from a live stream, not continuous observation. Never certify safety or completion.",
      check,
      f.jpeg.toString("base64"),
    );
    check();
    if (text?.trim()) store.message(room, actor, text.slice(0, 2000));
    return { text: text || "Annotation requested.", provider: cfg.provider };
  } finally {
    ai.busy.delete(key);
  }
}
