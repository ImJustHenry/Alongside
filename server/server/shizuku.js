// GPT (formerly "Shizuku"): a voice + vision companion for the Quest wearer.
// The headset sends a short WAV utterance. We transcribe it, and only if it is addressed to "GPT"
// we look at the latest LiveView camera frame (if the camera is on), answer briefly, and return speech.
// Uses OpenAI for speech-to-text, the vision model and text-to-speech. The key comes ONLY from the
// server environment (OPENAI_API_KEY in .env) and never from clients.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Fault } from "./store.js";

const env = (k, d) => (process.env[k] || "").trim() || d;
const STT_MODEL = () => env("SHIZUKU_STT_MODEL", "gpt-4o-mini-transcribe");
const CHAT_MODEL = () => env("SHIZUKU_MODEL", "gpt-4o-mini");
const TTS_MODEL = () => env("SHIZUKU_TTS_MODEL", "gpt-4o-mini-tts");
const TTS_VOICE = () => env("SHIZUKU_VOICE", "coral");
const FRAME_MAX_AGE_MS = 8000;
// GPT can draw: a circle on the LiveView frame, reprojected by the headset onto real surfaces
// (same path as MCP agents). Needs a stream frame (it carries the camera pose); the hub pins
// frames for at most 10 s, so only fresh frames are drawable.
const MARK_MODEL = () => env("SHIZUKU_MARK_MODEL", "gpt-4.1");
const DRAWABLE_MAX_AGE_MS = 4000;
const MARK_COLOR = "#4A8FD8"; // GPT's blue, distinct from human orange
export const GPT_ACTOR = Object.freeze({ id: "gpt-companion", name: "GPT", kind: "ai", role: "agent", color: MARK_COLOR, builtin: true });
const CLEAR = /^(please\s+)?(clear|erase|remove|delete|undo)\b.*\b(drawings?|marks?|circles?|ink|that|it|yours?)\b/i;

const markRules = `
You can also draw: circle one thing in the wearer's view. Reply as JSON {"reply": string, "mark": null | {"u","v","radius"}}.
Set mark only when the wearer asks you to show, point at, circle, mark, highlight or find something, or asks where or which one, AND you can clearly see it in the image. Otherwise mark is null.
mark.u is the horizontal centre of that thing (0 = left edge, 1 = right edge); mark.v is the vertical centre (0 = top edge, 1 = bottom edge); radius is half its width as a fraction of the image width (0.03 to 0.25); keep it tight around that one thing.
When you draw, mention it briefly and naturally, e.g. "I circled it in blue." Never circle something you can't see.`;

const markSchema = {
  type: "json_schema",
  json_schema: {
    name: "gpt_reply",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "mark"],
      properties: {
        reply: { type: "string" },
        mark: {
          anyOf: [
            { type: "null" },
            { type: "object", additionalProperties: false, required: ["u", "v", "radius"], properties: { u: { type: "number" }, v: { type: "number" }, radius: { type: "number" } } },
          ],
        },
      },
    },
  },
};

// A slightly overshooting loop, like a hand-drawn circle. radius is in image-width units; aspect keeps it round.
export function circlePoints(u, v, radius, w, h, n = 40) {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r = clamp(radius, 0.03, 0.3), ry = (r * w) / h, turns = 1.08, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2 * turns, k = 1 + 0.05 * Math.sin(t * 1.7) + 0.05 * (i / n);
    pts.push({ u: clamp(u + Math.cos(t) * r * k, 0, 1), v: clamp(v + Math.sin(t) * ry * k, 0, 1) });
  }
  return pts;
}

function drawMark(hub, store, room, stream, f, mark) {
  if (hub.rooms.get(room) !== stream) throw new Fault("camera source changed", 409);
  const gateway = { room, actor: GPT_ACTOR, readyState: 1, bufferedAmount: 0, send() {} };
  hub.request(
    gateway,
    { type: "remoteStroke", id: randomUUID(), epoch: f.meta.epoch, frameSeq: f.meta.seq, phase: "commit", points: circlePoints(mark.u, mark.v, Math.max(0.07, mark.radius * 1.15), f.meta.w, f.meta.h), color: MARK_COLOR, width: 0.006 },
    GPT_ACTOR,
    f,
  );
}

function clearMarks(store, room) {
  const r = store.room(room);
  const before = (r.spatialStrokes ??= []).length;
  r.spatialStrokes = r.spatialStrokes.filter((s) => s.ownerId !== GPT_ACTOR.id);
  const n = before - r.spatialStrokes.length;
  if (n) store.record(r, GPT_ACTOR, "spatial.clearMine");
  return n;
}

async function speak(text) {
  const speech = await openai("audio/speech", {
    model: TTS_MODEL(),
    voice: TTS_VOICE(),
    input: text,
    response_format: "wav",
    instructions: "Warm, light, cheerful and concise, like a friendly helper sprite.",
  });
  return Buffer.from(await speech.arrayBuffer()).toString("base64");
}

// Wake word "GPT" (also "Chat GPT", "G.P.T.", "gee pee tee"), tolerant of common mis-transcriptions.
const WAKE = /^\W*(hey\s+|hi\s+|ok(ay)?\s+|yo\s+)?(chat\s*)?(g\W{0,2}p\W{0,2}t\b|gpt\b|gee\W*pee\W*tee\b|g\W*p\W*tea\b|jee\W*pee\W*tee\b|gbt\b|gpd\b|cheap\W*t\b)[\s,.!?:-]*/i;

const history = new Map(); // room -> last few turns, so follow-ups make sense

const instructions = `You are GPT, a small friendly anime-maid-styled helper living in a mixed-reality headset (Alongside).
You can see a still image of what the wearer sees through the headset camera when one is provided.
Answer in one to three short spoken sentences. No lists, no markdown, no emoji: your words are read aloud.
Describe only what is actually visible; say when you are unsure. Never claim physical safety or certainty.
When an image is attached, it is the wearer's current view: use it whenever the question is about what they see.
If no image is attached and the question needs one, say once, briefly, that you can't see right now; otherwise just answer.
Earlier turns may have lacked an image; that does not mean the current one does.`;

async function openai(path, body, asJson = true) {
  const key = env("OPENAI_API_KEY", "");
  if (!key) throw new Fault("GPT needs OPENAI_API_KEY in the server's .env file, then restart the server.", 503);
  const res = await fetch("https://api.openai.com/v1/" + path, {
    method: "POST",
    headers: asJson ? { authorization: `Bearer ${key}`, "content-type": "application/json" } : { authorization: `Bearer ${key}` },
    body: asJson ? JSON.stringify(body) : body,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Fault(`OpenAI ${path} returned ${res.status}. ${detail}`, 502);
  }
  return res;
}

export async function askShizuku(hub, store, room, member, body) {
  const req = z
    .object({
      audio: z.string().min(100).max(1_400_000), // base64 WAV, ~10 s at 16 kHz mono
      image: z.string().max(600_000).optional(), // base64 JPEG snapshot taken by the headset when the question ended
      consent: z.literal(true),
      requireWakeWord: z.boolean().default(true),
    })
    .parse(body);
  if (!store.room(room).aiEnabled)
    return { heard: "", addressed: false, paused: true, reply: "AI is paused in this room." };

  // 1. Hear.
  const form = new FormData();
  form.append("model", STT_MODEL());
  form.append("file", new Blob([Buffer.from(req.audio, "base64")], { type: "audio/wav" }), "speech.wav");
  form.append("prompt", "GPT (said as G P T), an assistant's name, may be spoken first.");
  const heard = ((await (await openai("audio/transcriptions", form, false)).json()).text || "").trim();
  const m = heard.match(WAKE);
  if (req.requireWakeWord && !m) return { heard, addressed: false };
  const question = (m ? heard.slice(m[0].length) : heard).trim() || "What do you see?";

  // "GPT, clear your drawings": remove GPT's own marks, no vision needed.
  const roomId = store.room(room).id;
  if (CLEAR.test(question)) {
    const n = clearMarks(store, roomId);
    const reply = n ? `Okay, I cleared ${n === 1 ? "my circle" : "my " + n + " marks"}.` : "I don't have any marks up right now.";
    return { heard, addressed: true, question, reply, sawCamera: false, cleared: n, audio: await speak(reply), by: member.name };
  }

  // 2. See: a fresh LiveView stream frame first (it has the camera pose, so GPT can draw on it),
  //    else the headset's own snapshot, else an older stream frame.
  const stream = hub.rooms.get(roomId) || hub.rooms.get(room);
  const f = stream?.latest;
  const age = f ? Date.now() - f.receivedAt : Infinity;
  const drawable = age < DRAWABLE_MAX_AGE_MS && !!store.room(roomId).collaborativeWriting;
  const frame = drawable ? f.jpeg.toString("base64") : req.image || (age < FRAME_MAX_AGE_MS ? f.jpeg.toString("base64") : null);
  console.log(
    `[GPT] ${new Date().toLocaleTimeString()} room ${room} heard "${heard.slice(0, 80)}" | headset image: ${req.image ? Math.round((req.image.length * 3) / 4 / 1024) + " KB" : "none"} | stream frame: ${f ? Math.round((Date.now() - f.receivedAt) / 1000) + " s old" : "none"}`,
  );

  // 3. Think.
  const turns = history.get(room) || [];
  const userContent = frame
    ? [
        { type: "text", text: question },
        // "high" detail when GPT may draw: pointing on the 512 px "low" image lands noticeably off.
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + frame, detail: drawable ? "high" : "low" } },
      ]
    : [{ type: "text", text: question + "\n(No camera image is available for this question.)" }];
  const chat = await (
    await openai(
      "chat/completions",
      drawable
        ? {
            model: MARK_MODEL(),
            max_tokens: 220,
            response_format: markSchema,
            messages: [{ role: "system", content: instructions + markRules }, ...turns, { role: "user", content: userContent }],
          }
        : {
            model: CHAT_MODEL(),
            max_tokens: 160,
            messages: [{ role: "system", content: instructions }, ...turns, { role: "user", content: userContent }],
          },
    )
  ).json();
  const content = (chat.choices?.[0]?.message?.content || "").trim();
  let reply = content, mark = null;
  if (drawable) {
    try {
      const j = JSON.parse(content);
      reply = String(j.reply || "").trim();
      const m = j.mark;
      if (m && [m.u, m.v, m.radius].every(Number.isFinite) && m.u >= 0 && m.u <= 1 && m.v >= 0 && m.v <= 1) mark = m;
    } catch {
      reply = "";
    }
  }
  reply ||= "Sorry, I didn't catch that.";

  // 3b. Draw: hand the circle to the headset for reprojection onto the real surface (iPad sees it in the stream overlay).
  let marked = false, markError = null;
  if (mark) {
    try {
      drawMark(hub, store, roomId, stream, f, mark);
      marked = true;
    } catch (e) {
      markError = e.message;
    }
  }
  console.log(`[GPT] reply "${reply.slice(0, 80)}"${mark ? ` | mark u=${mark.u.toFixed(2)} v=${mark.v.toFixed(2)} r=${mark.radius.toFixed(2)} ${marked ? "sent" : "FAILED: " + markError}` : ""}`);
  if (markError) reply += " I couldn't draw it, though.";
  history.set(room, [...turns, { role: "user", content: question }, { role: "assistant", content: reply }].slice(-8));

  // 4. Speak (16-bit PCM WAV so the headset can play it without a decoder).
  const audio = await speak(reply);
  return { heard, addressed: true, question, reply, sawCamera: !!frame, marked, mark, audio, by: member.name };
}
