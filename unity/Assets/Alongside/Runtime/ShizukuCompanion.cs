using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Dict = System.Collections.Generic.Dictionary<string, object>;
namespace Alongside {
// GPT (formerly "Shizuku"): an original chibi-maid voice + vision companion beside the control HUD.
// Say "GPT, ..." and it listens (voice activity detection on the headset mic), sends the utterance
// to the Alongside server (/shizuku), which transcribes it, looks at the latest LiveView camera frame,
// answers, and returns speech. Only utterances that start with "GPT" get an answer. It sees through the LiveView camera stream (started automatically) or its own snapshot.
public class ShizukuCompanion : MonoBehaviour {
 public const int Rate = 16000;
 public bool Enabled { get; private set; }
 public string State { get; private set; } = "off";

 BoardController board; Transform anchor; // the HUD
 Transform body, mouth, eyes; TextMesh bubble; AudioSource voice; Material clipMat;
 string mic; AudioClip micClip; int readPos; float noiseFloor = .01f;
 readonly List<float> utterance = new List<float>(); readonly Queue<float> preroll = new Queue<float>();
 bool speechOn, busy; float silentFor, bubbleUntil; readonly float[] chunk = new float[800], outData = new float[256];

 public static ShizukuCompanion Create(BoardController board, Transform hud) {
  var s = new GameObject("Shizuku").AddComponent<ShizukuCompanion>(); s.board = board; s.anchor = hud; s.Build(); return s;
 }

 // Original chibi maid built from primitives with flat (cel-like) colours, about 14 cm tall.
 // Sprites/Default is always in builds but transparent (no depth write), so every part gets an explicit
 // render queue, painted back to front. That's correct because she always turns to face the wearer.
 void Build() {
  var unlit = Shader.Find("Sprites/Default");
  Material M(Color c, int queue) => new Material(unlit) { color = c, renderQueue = queue };
  GameObject Ball(string n, Transform p, Vector3 pos, Vector3 scale, Material m) { var g = GameObject.CreatePrimitive(PrimitiveType.Sphere); g.name = n; Destroy(g.GetComponent<Collider>()); g.transform.SetParent(p, false); g.transform.localPosition = pos; g.transform.localScale = scale; g.GetComponent<Renderer>().sharedMaterial = m; return g; }
  Color C(string hex) => Model.ParseColor(hex);
  Color hair = C("#9ccbf0"), hairDark = C("#7fb2e0"), skin = C("#ffe6d8"), navy = C("#2f3a5c"), white = C("#fbfbff");
  body = new GameObject("Shizuku body").transform; body.SetParent(transform, false);
  // back layer: hair behind the head, twin tails, arms
  Ball("Long hair", body, new Vector3(0, .03f, .014f), new Vector3(.062f, .055f, .04f), M(hairDark, 2989));
  Ball("Back hair", body, new Vector3(0, .056f, .006f), new Vector3(.07f, .07f, .064f), M(hair, 2990));
  var tailMat = M(hair, 2991);
  Ball("Twin tail L", body, new Vector3(-.041f, .03f, .006f), new Vector3(.022f, .062f, .022f), tailMat);
  Ball("Twin tail R", body, new Vector3(.041f, .03f, .006f), new Vector3(.022f, .062f, .022f), tailMat);
  var tieMat = M(white, 2992);
  Ball("Tie L", body, new Vector3(-.037f, .055f, .002f), new Vector3(.011f, .011f, .011f), tieMat);
  Ball("Tie R", body, new Vector3(.037f, .055f, .002f), new Vector3(.011f, .011f, .011f), tieMat);
  var sleeve = M(navy, 2993); var hand = M(skin, 2993);
  Ball("Arm L", body, new Vector3(-.026f, -.006f, -.002f), new Vector3(.014f, .04f, .014f), sleeve);
  Ball("Arm R", body, new Vector3(.026f, -.006f, -.002f), new Vector3(.014f, .04f, .014f), sleeve);
  Ball("Hand L", body, new Vector3(-.028f, -.028f, -.006f), new Vector3(.012f, .012f, .012f), hand);
  Ball("Hand R", body, new Vector3(.028f, -.028f, -.006f), new Vector3(.012f, .012f, .012f), hand);
  // dress + apron
  Ball("Skirt", body, new Vector3(0, -.032f, 0), new Vector3(.076f, .042f, .06f), M(navy, 2994));
  Ball("Torso", body, new Vector3(0, -.004f, 0), new Vector3(.045f, .05f, .036f), M(navy, 2995));
  var apron = M(white, 2996);
  Ball("Apron bib", body, new Vector3(0, -.006f, -.017f), new Vector3(.022f, .03f, .005f), apron);
  Ball("Apron skirt", body, new Vector3(0, -.033f, -.029f), new Vector3(.036f, .026f, .007f), apron);
  Ball("Collar", body, new Vector3(0, .019f, -.011f), new Vector3(.03f, .01f, .012f), M(white, 2997));
  var bow = M(C("#4a8fd8"), 2998);
  Ball("Bow L", body, new Vector3(-.006f, .016f, -.019f), new Vector3(.011f, .008f, .004f), bow);
  Ball("Bow R", body, new Vector3(.006f, .016f, -.019f), new Vector3(.011f, .008f, .004f), bow);
  // head + face
  Ball("Head", body, new Vector3(0, .05f, 0), new Vector3(.062f, .058f, .058f), M(skin, 3000));
  var hairFront = M(hair, 3004);
  Ball("Bangs", body, new Vector3(0, .071f, -.017f), new Vector3(.062f, .026f, .03f), hairFront);
  Ball("Side lock L", body, new Vector3(-.027f, .045f, -.017f), new Vector3(.012f, .036f, .012f), hairFront);
  Ball("Side lock R", body, new Vector3(.027f, .045f, -.017f), new Vector3(.012f, .036f, .012f), hairFront);
  var frill = M(white, 3006);
  Ball("Headband", body, new Vector3(0, .083f, -.006f), new Vector3(.05f, .012f, .03f), frill);
  for (int i = -1; i <= 1; i++) Ball("Frill " + i, body, new Vector3(i * .015f, .089f, -.007f), new Vector3(.013f, .012f, .01f), frill);
  clipMat = M(new Color(.7f, .75f, .8f, 1), 3008); // the droplet hair clip shows her state
  Ball("Droplet clip", body, new Vector3(.025f, .072f, -.018f), new Vector3(.01f, .013f, .006f), clipMat);
  var blush = M(new Color(1f, .55f, .62f, .55f), 3009);
  Ball("Blush L", body, new Vector3(-.019f, .038f, -.026f), new Vector3(.011f, .005f, .003f), blush);
  Ball("Blush R", body, new Vector3(.019f, .038f, -.026f), new Vector3(.011f, .005f, .003f), blush);
  eyes = new GameObject("Eyes").transform; eyes.SetParent(body, false); eyes.localPosition = new Vector3(0, .047f, 0);
  Material eyeDark = M(C("#22304f"), 3010), iris = M(C("#3f7fc4"), 3011), shine = M(Color.white, 3012);
  foreach (var s in new[] { -1, 1 }) {
   Ball("Eye", eyes, new Vector3(s * .012f, 0, -.028f), new Vector3(.011f, .015f, .004f), eyeDark);
   Ball("Iris", eyes, new Vector3(s * .012f, -.002f, -.0295f), new Vector3(.008f, .010f, .003f), iris);
   Ball("Eye shine", eyes, new Vector3(s * .012f - .002f, .003f, -.031f), new Vector3(.0045f, .0045f, .002f), shine);
  }
  mouth = Ball("Mouth", body, new Vector3(0, .032f, -.029f), new Vector3(.007f, .002f, .003f), M(C("#b0455a"), 3013)).transform;
  bubble = Draw.Text(transform, "Shizuku bubble", "", new Vector3(0, .13f, 0), .012f, Model.ParseColor(Model.Ink), TextAnchor.LowerCenter);
  voice = gameObject.AddComponent<AudioSource>(); voice.playOnAwake = false; voice.spatialBlend = .6f; voice.volume = 1f;
 }

 public void SetEnabled(bool on) {
  if (on == Enabled) return; Enabled = on;
  if (on) StartCoroutine(StartMic()); else StopMic("GPT is off");
 }

 IEnumerator StartMic() {
  State = "starting"; Say("Hi! Say \"GPT\" and then ask me something.", 5);
#if UNITY_ANDROID && !UNITY_EDITOR
  const string perm = "android.permission.RECORD_AUDIO";
  if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(perm)) {
   UnityEngine.Android.Permission.RequestUserPermission(perm); float end = Time.realtimeSinceStartup + 30;
   while (Enabled && !UnityEngine.Android.Permission.HasUserAuthorizedPermission(perm) && Time.realtimeSinceStartup < end) yield return null;
   if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(perm)) { Enabled = false; StopMic("Microphone permission denied. Allow it in Settings > Apps, then turn GPT on."); yield break; }
  }
#else
  yield return null;
#endif
  if (!Enabled) yield break;
  Live?.EnsureStreaming(); // GPT's eyes: start the room camera stream (same as pressing Camera ON)
  var cam = Cam; if (cam != null && !cam.Requested) cam.Open(); // also warm up the camera for the snapshot path
  if (Microphone.devices.Length == 0) { Enabled = false; StopMic("No microphone found."); yield break; }
  mic = Microphone.devices[0]; micClip = Microphone.Start(mic, true, 10, Rate); readPos = 0;
  utterance.Clear(); preroll.Clear(); speechOn = false; State = "listening";
 }

 void StopMic(string why) {
  if (mic != null && Microphone.IsRecording(mic)) Microphone.End(mic);
  mic = null; micClip = null; State = "off"; Say(why, 4);
 }

 void Say(string text, float seconds) { if (bubble == null) return; bubble.text = Draw.Wrap(text, 36, 9); bubbleUntil = Time.time + seconds; }

 void Update() {
  // Float beside the HUD (left edge), bobbing gently; face the wearer.
  var head = board.rig.head.transform;
  if (anchor != null && anchor.gameObject.activeInHierarchy) {
   var basePos = anchor.TransformPoint(new Vector3(-1.45f, .25f, -.05f));
   transform.position = basePos + Vector3.up * (Mathf.Sin(Time.time * 2f) * .006f);
   var look = transform.position - head.position; if (look.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(look.normalized, Vector3.up);
  }
  // Mood: thinking = slow spin pulse; speaking = mouth follows the voice; listening = brighter when hearing speech.
  float level = 0; if (voice.isPlaying) { voice.GetOutputData(outData, 0); foreach (var v in outData) level = Mathf.Max(level, Mathf.Abs(v)); }
  mouth.localScale = new Vector3(.007f, .002f + Mathf.Clamp01(level * 3f) * .008f, .003f);
  // thinking: curious head tilt; hearing: little bounce; otherwise still.
  body.localRotation = busy && !voice.isPlaying ? Quaternion.Euler(0, 0, Mathf.Sin(Time.time * 3f) * 8f) : Quaternion.identity;
  body.localPosition = speechOn ? Vector3.up * (Mathf.Abs(Mathf.Sin(Time.time * 9f)) * .004f) : Vector3.zero;
  // droplet hair clip = status light: grey off, soft blue listening, bright cyan hearing, pulsing while thinking.
  clipMat.color = !Enabled ? new Color(.7f, .75f, .8f, 1) : speechOn ? new Color(.3f, .95f, 1f, 1) : busy ? Color.Lerp(new Color(.55f, .8f, 1f, 1), Color.white, (Mathf.Sin(Time.time * 6f) + 1) * .5f) : new Color(.55f, .82f, .98f, 1);
  eyes.localScale = new Vector3(1, (Time.time % 4f) < .12f ? .15f : 1, 1); // blink
  if (Time.time > bubbleUntil && bubble.text.Length > 0 && !busy && !voice.isPlaying) bubble.text = "";
  if (Enabled && micClip != null && !busy && !voice.isPlaying) Listen();
 }

 // Simple voice activity detection over 50 ms chunks with an adaptive noise floor.
 void Listen() {
  int pos = Microphone.GetPosition(mic); if (pos < 0) return;
  int available = (pos - readPos + micClip.samples) % micClip.samples;
  while (available >= chunk.Length) {
   micClip.GetData(chunk, readPos); readPos = (readPos + chunk.Length) % micClip.samples; available -= chunk.Length;
   float sum = 0; foreach (var s in chunk) sum += s * s; float rms = Mathf.Sqrt(sum / chunk.Length);
   if (!speechOn) noiseFloor = Mathf.Lerp(noiseFloor, rms, .05f);
   float threshold = Mathf.Max(.012f, noiseFloor * 3f);
   if (!speechOn) {
    foreach (var s in chunk) { preroll.Enqueue(s); } while (preroll.Count > Rate * 3 / 10) preroll.Dequeue(); // 0.3 s
    if (rms > threshold) { speechOn = true; silentFor = 0; utterance.Clear(); utterance.AddRange(preroll); preroll.Clear(); State = "hearing"; }
   } else {
    utterance.AddRange(chunk);
    silentFor = rms > threshold * .7f ? 0 : silentFor + chunk.Length / (float)Rate;
    float length = utterance.Count / (float)Rate;
    if (silentFor > .7f || length > 8f) { speechOn = false; State = "listening"; if (length - silentFor > .35f) Send(utterance.ToArray()); utterance.Clear(); return; }
   }
  }
 }

 LiveCameraSource Cam { get { var lv = board.GetComponent<LiveViewController>(); return lv != null ? lv.cameraSource : null; } }

 // Shizuku's eyes: a still from the headset camera taken when the question ends (independent of Camera ON streaming).
 // Why the last snapshot failed (shown in the bubble, since there are no device logs).
 string seeProblem, streamProblem;

 // GPU path first (works for Android external/OES camera textures, where GetPixels32 can return nothing or black),
 // then the CPU path. Rejects all-black frames, which is what a camera without permission/frames delivers.
 string Snapshot(WebCamTexture w) {
  if (w == null) { var c = Cam; seeProblem = c == null ? "no camera component" : "camera not delivering frames (" + c.Status + ")"; return null; }
  int width = Mathf.Min(w.width, 960), height = Mathf.Max(1, Mathf.RoundToInt(width * (float)w.height / w.width));
  Texture2D t = null; string path = "gpu";
  try {
   var rt = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32);
   if (w.videoVerticallyMirrored) Graphics.Blit(w, rt, new Vector2(1, -1), new Vector2(0, 1)); else Graphics.Blit(w, rt);
   var prev = RenderTexture.active; RenderTexture.active = rt;
   t = new Texture2D(width, height, TextureFormat.RGB24, false); t.ReadPixels(new Rect(0, 0, width, height), 0, 0); t.Apply(false);
   RenderTexture.active = prev; RenderTexture.ReleaseTemporary(rt);
   if (IsBlack(t)) { path = "cpu"; Destroy(t); t = null; }
  } catch (Exception e) { Debug.LogWarning("[GPT] gpu snapshot: " + e.Message); if (t) Destroy(t); t = null; path = "cpu"; }
  if (t == null) {
   try {
    var px = w.GetPixels32(); if (px == null || px.Length < w.width * w.height) { seeProblem = "camera image unreadable on this device"; return null; }
    t = new Texture2D(w.width, w.height, TextureFormat.RGBA32, false); t.SetPixels32(px); t.Apply(false);
    if (IsBlack(t)) { Destroy(t); seeProblem = "camera frames are black (permission or camera access)"; return null; }
   } catch (Exception e) { seeProblem = "snapshot failed: " + e.Message; return null; }
  }
  var jpg = t.EncodeToJPG(70); Destroy(t); seeProblem = null;
  Debug.Log("[GPT] snapshot via " + path + " " + jpg.Length / 1024 + " KB");
  return Convert.ToBase64String(jpg);
 }

 static bool IsBlack(Texture2D t) {
  var px = t.GetPixels32(); long sum = 0; int n = 0;
  for (int i = 0; i < px.Length; i += Mathf.Max(1, px.Length / 500)) { sum += px[i].r + px[i].g + px[i].b; n++; }
  return n == 0 || sum / (n * 3f) < 4f; // average brightness under ~1.5%
 }

 void Send(float[] samples) {
  var remote = board.Session as ServerSession;
  if (remote == null) { Say("I need the Alongside server. Join the laptop's hotspot so I can hear you.", 5); return; }
  busy = true; State = "thinking";
  StartCoroutine(SendWithSnapshot(remote, samples));
 }

 LiveViewController Live => board.GetComponent<LiveViewController>();

 IEnumerator SendWithSnapshot(ServerSession remote, float[] samples) {
  // Eyes, path 1 (proven on the Quest): the LiveView stream. Make sure it is running and give it a moment to deliver a frame.
  var live = Live; streamProblem = live != null ? live.EnsureStreaming() : "no LiveView";
  float until = Time.realtimeSinceStartup + 2.5f;
  while (live != null && !live.Streaming && Time.realtimeSinceStartup < until) { yield return null; streamProblem = live.EnsureStreaming(); }
  if (live != null && live.Streaming) { streamProblem = null; yield return new WaitForSeconds(.4f); }
  // Eyes, path 2: our own still from the camera (bonus; failed on the Quest in 0.1.12/0.1.13).
  var cam = Cam; if (cam != null && !cam.Requested) cam.Open();
  until = Time.realtimeSinceStartup + 1f; while (cam != null && cam.Webcam == null && Time.realtimeSinceStartup < until) yield return null;
  string image = null; if (cam != null) image = Snapshot(cam.Webcam); else seeProblem = "no camera component";
  remote.AskShizuku(Convert.ToBase64String(Wav(samples)), image, r => {
   busy = false; State = "listening"; if (r == null) return;
   bool addressed = r.TryGetValue("addressed", out var a) && a is bool b && b;
   if (!addressed) return; // not for Shizuku: stay quiet
   string reply = r.TryGetValue("reply", out var t) ? Convert.ToString(t) : "";
   bool saw = r.TryGetValue("sawCamera", out var sc) && sc is bool sb && sb;
   Say((saw ? "" : "(can't see: stream " + (streamProblem ?? "running but no recent frame") + "; snapshot " + (seeProblem ?? "none") + ")\n") + reply, 14);
   if (r.TryGetValue("audio", out var au) && au is string a64 && a64.Length > 0) { var clip = FromWav(Convert.FromBase64String(a64)); if (clip != null) { voice.clip = clip; voice.Play(); } }
  }, err => { busy = false; State = "listening"; Say("GPT: " + err, 8); });
 }

 static byte[] Wav(float[] s) {
  var b = new byte[44 + s.Length * 2]; void I(int o, int v) { BitConverter.GetBytes(v).CopyTo(b, o); } void S(int o, short v) { BitConverter.GetBytes(v).CopyTo(b, o); }
  System.Text.Encoding.ASCII.GetBytes("RIFF").CopyTo(b, 0); I(4, b.Length - 8); System.Text.Encoding.ASCII.GetBytes("WAVEfmt ").CopyTo(b, 8);
  I(16, 16); S(20, 1); S(22, 1); I(24, Rate); I(28, Rate * 2); S(32, 2); S(34, 16); System.Text.Encoding.ASCII.GetBytes("data").CopyTo(b, 36); I(40, s.Length * 2);
  for (int i = 0; i < s.Length; i++) S(44 + i * 2, (short)Mathf.Clamp(s[i] * 32767f, -32768, 32767));
  return b;
 }

 // Minimal PCM16 WAV reader (OpenAI TTS "wav"). Tolerates streaming headers with unknown data sizes.
 static AudioClip FromWav(byte[] b) {
  try {
   int channels = 1, rate = 24000, bits = 16, p = 12;
   while (p + 8 <= b.Length) {
    string id = System.Text.Encoding.ASCII.GetString(b, p, 4); int size = BitConverter.ToInt32(b, p + 4);
    if (id == "fmt ") { channels = BitConverter.ToInt16(b, p + 10); rate = BitConverter.ToInt32(b, p + 12); bits = BitConverter.ToInt16(b, p + 22); }
    if (id == "data") {
     int start = p + 8, len = (size <= 0 || start + size > b.Length) ? b.Length - start : size; if (bits != 16) return null;
     int n = len / 2; var f = new float[n]; for (int i = 0; i < n; i++) f[i] = BitConverter.ToInt16(b, start + i * 2) / 32768f;
     var clip = AudioClip.Create("Shizuku reply", n / channels, channels, rate, false); clip.SetData(f, 0); return clip;
    }
    if (size < 0) break; p += 8 + size + (size & 1);
   }
  } catch (Exception e) { Debug.LogWarning("[GPT] wav decode: " + e.Message); }
  return null;
 }

 void OnDestroy() { if (mic != null && Microphone.IsRecording(mic)) Microphone.End(mic); }
}
}
