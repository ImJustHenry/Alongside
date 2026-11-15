// GPT (formerly "Shizuku"): a voice + vision companion for the Quest wearer.
// The headset sends a short WAV utterance. We transcribe it, and only if it is addressed to "GPT"
// we look at the latest LiveView camera frame (if the camera is on), answer briefly, and return speech.
// Uses OpenAI for speech-to-text, the vision model and text-to-speech. The key comes ONLY from the
// server environment (OPENAI_API_KEY in .env) and never from clients.
import { z } from "zod";
import { Fault } from "./store.js";

const env = (k, d) => (process.env[k] || "").trim() || d;
const STT_MODEL = () => env("SHIZUKU_STT_MODEL", "gpt-4o-mini-transcribe");
const CHAT_MODEL = () => env("SHIZUKU_MODEL", "gpt-4o-mini");
const TTS_MODEL = () => env("SHIZUKU_TTS_MODEL", "gpt-4o-mini-tts");
const TTS_VOICE = () => env("SHIZUKU_VOICE", "coral");
const FRAME_MAX_AGE_MS = 8000;

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

  // 2. See: the headset's own snapshot first, else the latest LiveView stream frame (Camera ON).
  const f = hub.rooms.get(room)?.latest;
  const frame = req.image || (f && Date.now() - f.receivedAt < FRAME_MAX_AGE_MS ? f.jpeg.toString("base64") : null);
  console.log(
    `[GPT] ${new Date().toLocaleTimeString()} room ${room} heard "${heard.slice(0, 80)}" | headset image: ${req.image ? Math.round((req.image.length * 3) / 4 / 1024) + " KB" : "none"} | stream frame: ${f ? Math.round((Date.now() - f.receivedAt) / 1000) + " s old" : "none"}`,
  );

  // 3. Think.
  const turns = history.get(room) || [];
  const userContent = frame
    ? [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64," + frame, detail: "low" } },
      ]
    : [{ type: "text", text: question + "\n(No camera image is available for this question.)" }];
  const chat = await (
    await openai("chat/completions", {
      model: CHAT_MODEL(),
      max_tokens: 160,
      messages: [{ role: "system", content: instructions }, ...turns, { role: "user", content: userContent }],
    })
  ).json();
  const reply = (chat.choices?.[0]?.message?.content || "Sorry, I didn't catch that.").trim();
  history.set(room, [...turns, { role: "user", content: question }, { role: "assistant", content: reply }].slice(-8));

  // 4. Speak (16-bit PCM WAV so the headset can play it without a decoder).
  const speech = await openai("audio/speech", {
    model: TTS_MODEL(),
    voice: TTS_VOICE(),
    input: reply,
    response_format: "wav",
    instructions: "Warm, light, cheerful and concise, like a friendly helper sprite.",
  });
  const audio = Buffer.from(await speech.arrayBuffer()).toString("base64");
  return { heard, addressed: true, question, reply, sawCamera: !!frame, audio, by: member.name };
}
