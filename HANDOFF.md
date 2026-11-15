# Alongside handoff (for the next developer or AI)

State as of **2026-11-14, about 11:40 PM PT**. Hackathon: Immerse the Bay 2026 (Stanford XR). Pens down **9:00 AM Sun Nov 15**. The submission needs Devpost, a vertical video of 30 seconds or less, and this public MIT repo.

Read this before changing builds. It records what's been verified, what hasn't, and the traps already hit.

---

## 1. What the product is

Alongside is a shared board for learning together:
- **Quest 3/3S wearer (Unity app):**
  - sees the board in passthrough mixed reality
  - draws on the board, in the air, or **on real objects** (desks, walls, furniture)
  - can stream the headset camera to the room
- **Phone, iPad and browser users (web client served by the Node server):** join the same room, see the board and the Quest camera view, and draw marks. Those marks are reprojected into 3D in the wearer's space.
- **AI layer:** a deterministic "scripted practice guide" unless a real AI provider key is configured on the server.

## 2. Repo layout

| Path | Contents |
| --- | --- |
| `unity/` | Unity **6000.6.5f1** project. Build scene: `Assets/Scenes/Alongside.unity`. (`Main.unity` is an unused template scene.) |
| `unity/Assets/Alongside/Runtime/` | All app code (namespace `Alongside`). |
| `unity/Assets/Alongside/Editor/` | Setup and build helpers (`AlongsideSetup`, `LiveViewSetup`, manifest fixers). |
| `unity/Packages/com.unity.xr.hands/` | XR Hands 1.10, stored inside the project and overriding the registry version. Keep it. |
| `server/` | Node (Express + WebSocket) room server. `dist/` is the built web client and **must stay committed**, because `npm ci --omit=dev` skips Vite. |

Key runtime files:
- `BoardController.cs`: board, toolbar, side panel, sessions. Has `startMode` (Local/CreateRoom/JoinInvite) and `serverUrl`.
  - `serverUrl` accepts a **comma-separated list**. `PickServer()` probes `GET /api/health` on each address (3 s timeout) and uses the first that answers.
- `LiveViewController.cs`: the LiveView row of buttons above the board.
  - Ink mode, Eraser, Undo 3D, Clear mine, Camera ON, Surfaces, Allow capture, Ask frame.
  - Runs the per-frame hand and controller ink loop.
  - Handles camera stream start/stop and reprojects remote marks.
- `SurfaceInk.cs` (added 2026-11-14): makes real-world geometry drawable. See section 6.
- `ControlHud.cs` (added 2026-11-15): the headset's follow-me control HUD. It reparents the LiveView row into itself and hides or shows `board.view`. Created by `LiveViewController.EnableHud()` when XR starts.
- `XRRig.cs`: head pose, recenter, `SetMixedReality()`. Adds `ARCameraManager` and `ARSession` at runtime. The camera clears to a solid colour with alpha 0.
- `LiveCameraSource.cs`: Quest camera through `WebCamTexture`. Requests `horizonos.permission.HEADSET_CAMERA` and then `android.permission.CAMERA`.
- `ServerSession.cs` / `LocalSession.cs`: networking (REST plus WebSocket) and offline mode.
- `AlongsideDebug.cs`: static helpers for driving a running board from editor scripts: `Status()`, `Hint()`, `MoveTile`, `Stroke`, `Label`, `Create(url,name)`, `Invite()`.

## 3. Current release on the Quest

- **Meta app:** "Alongside LiveView", app ID `1356417340898608`, team "Futuer Resonance". Platform: Meta Horizon Store, unpublished.
- **Channel:** **ALPHA**, private and invite-only. The owner's Meta account is a member.
- **Latest build:** **0.1.14 (versionCode 15)**, uploaded 4:02 AM Nov 15. Package `edu.slu.stanfordxr.alongside`.
- **Installing on the headset:** Store, search "Alongside LiveView", Install. If you only see "0.1.0", uninstall and reinstall; the Store listing caches the old name.
- **How to confirm the new build is running:** the first LiveView button reads **"Ink: surfaces"**.

**Version history:**

| Version (code) | What changed |
| --- | --- |
| 0.1.0 (2) | First accepted upload. Landscape orientation fix. |
| 0.1.0 (3) | Surface ink and server-list fallback. |
| 0.1.3 (4) | Same as code 3 with a visible version name. Verified running on the Quest 3S. |
| 0.1.4 (5) | Enables the OpenXR **Composition Layers** feature. **Verified: passthrough works.** |
| 0.1.5 (6) | Detected surfaces are drawn with a faint blue tint. The LiveView status shows surface diagnostics (plane, mesh and box counts, subsystem and session state), whether the aim ray is on a surface, and whether the server is connected. **Verified: surface ink, camera and room all work.** |
| 0.1.6 (7) | Two changes, described below the table. **Bug:** lasers and drawing froze at their startup position, because the HUD deactivated the Board GameObject (see 0.1.7). |
| 0.1.7 (8) | Fixes 0.1.6. Hiding the board now hides only its visual children. Also moves the HUD lower and to the side. |
| 0.1.8 (9) | **The HUD no longer follows the gaze**, at the user's request. Details below the table. User feedback: drawing lagged, surface mode still sometimes drew in the air, and the blue tint was unwanted. |
| 0.1.9 (10) | Fixes that feedback; details below the table. **Verified: drawing works well.** **Bug:** the HUD was missing. It was placed once, 0.5 s after XR start, while the head pose was still at the tracking origin. |
| 0.1.10 (11) | HUD placement fixes, listed below the table. **Verified: the HUD appears.** |
| 0.1.11 (12) | Air ink starts 1 cm ahead of the controller pose (was 7 cm). Adds **Shizuku**, the voice + vision companion; see the section below. **Verified on the Quest** over the laptop hotspot. **Bug:** it always said the camera was off, because it only used Camera ON stream frames from the last 4 s. |
| 0.1.12 (13) | Shizuku sees and looks new; details below. Snapshot path tested on the laptop with a real image. **On the headset she still couldn't see**, cause unknown (no logcat). |
| 0.1.13 (14) | Camera diagnostics, listed below the table. **The server log showed every Quest request with `headset image: none`:** the snapshot path fails on the Quest. But Camera ON stream frames *did* arrive (one was 2 s old), so streaming works on the device. |
| 0.1.14 (15) | **Shizuku renamed to GPT**, and GPT sees through the stream; details below. Tested end to end in the editor with the laptop webcam; not yet seen on the headset. |

**0.1.14 details:**
- **Wake word "GPT":** also accepts "Chat GPT", "G.P.T." and "gee pee tee"; tested against sample phrases. Labels are "GPT: on/off" and the persona is an anime-maid-styled helper. Internal names (`ShizukuCompanion`, `/shizuku`, `askShizuku`) were left unchanged.
- **GPT sees through the LiveView stream**, the path proven on the Quest.
  - `LiveViewController.EnsureStreaming()` sends `streamStart`, the same as Camera ON (host only). GPT calls it when switched on and before each question, waiting up to 2.5 s.
  - The server accepts stream frames up to 8 s old (was 4 s). The snapshot is still attempted as a bonus.
- **If GPT still can't see,** the bubble shows `(can't see: stream <reason>; snapshot <reason>)`.
- **Editor test:** host room, GPT on → `streaming=True` with the laptop webcam. The spoken "GPT, what do you see?" was logged as `headset image: 20 KB | stream frame: 0 s old`, and GPT described the webcam view correctly with a spoken reply.

**0.1.13 camera diagnostics:**
- **Capture:** GPU first (`Graphics.Blit` to a RenderTexture, then `ReadPixels`), because Android OES camera textures can fail `GetPixels32`. CPU fallback. All-black frames are rejected.
- **Bubble:** when she can't see, it shows `(can't see: <reason>)`, such as no frames with `LiveCameraSource.Status`, black frames, unreadable image, or no image reaching the server.
- **Server log:** each `/shizuku` request prints a line to the server console: what was heard, the headset image size, and the stream frame age.

**0.1.12 details:**
- **Shizuku sees:** turning Shizuku on opens the headset camera (`LiveCameraSource.Open`). At the end of each question it grabs a JPEG still (`WebCamTexture.GetPixels32` → `EncodeToJPG(70)`) and sends it as `image` in the `/shizuku` request. The server prefers that image over the stream frame.
- **Camera ON state:** the button and the red "CAMERA LIVE" label now use `LiveViewController.Streaming` (the encoder epoch is set), not `cameraSource.Requested`, so Shizuku opening the camera doesn't look like streaming.
- **Fewer "camera off" replies:** the prompt was reworded so replies don't keep repeating it.
- **New look:** an original chibi anime maid built from primitives, about 14 cm tall. Pastel-blue twin tails, a white frilled headband, big eyes and blush, a navy dress with a white apron and blue bow.
  - Sprites/Default is transparent, so each part has an explicit render queue (2989–3013), painted back to front. She always faces the wearer.
  - The **droplet hair clip** is her status light: grey when off, blue when listening, cyan when hearing you, pulsing while thinking.

### Shizuku (voice + vision companion, 0.1.11)

**What it is:** an original water-droplet mascot (no Live2D: the SDK and model weren't available and need the user's own license acceptance) that floats beside the HUD. The **Shizuku: off/on** button on the HUD turns the mic on; it's off by default.

**Headset side (`ShizukuCompanion.cs`):**
- Requests `RECORD_AUDIO`, which `LiveViewAndroidManifest` now also declares.
- Records 16 kHz mono. Voice activity detection runs on 50 ms chunks with an adaptive noise floor, 0.3 s of pre-roll, an end after 0.7 s of silence, and an 8 s cap.
- Sends the utterance as a base64 WAV to `POST /api/rooms/:room/shizuku` through `ServerSession.AskShizuku`.
- The mic pauses while Shizuku is thinking or speaking, so it doesn't hear itself.

**Server side (`server/server/shizuku.js`):**
1. OpenAI speech-to-text (`gpt-4o-mini-transcribe`).
2. Answers only if the transcript starts with the wake word "Shizuku", matched by a regex that tolerates mis-transcriptions.
3. Attaches the latest LiveView frame, if one arrived in the last 4 s. The camera has to be ON for Shizuku to "see".
4. `gpt-4o-mini` chat with vision, a short spoken-style reply, and 8 turns of per-room memory.
5. OpenAI text-to-speech (`gpt-4o-mini-tts`, voice `coral`), returned as 16-bit PCM WAV that the headset decodes itself.
6. Respects the room's AI pause.

**Configuration:**
- The key comes **only from `OPENAI_API_KEY` in `server/.env`**. Restart the server after setting it.
- Optional overrides: `SHIZUKU_MODEL`, `SHIZUKU_STT_MODEL`, `SHIZUKU_TTS_MODEL` and `SHIZUKU_VOICE` (see `.env.example`).

**Tested on the laptop:**
- Without a key, the endpoint returns a clear 503, and the error shows in Shizuku's bubble on a Unity-to-server round trip.
- The WAV encoder and decoder round-trip, including streaming headers with unknown data sizes.
- **Not tested:** real OpenAI calls (no key available), and the mic on the Quest.

**0.1.10 HUD placement fixes:**
- The first placement waits for a **tracked** head pose (CenterEye `isTracked`, non-zero position), then 1 s more.
- If the HUD is more than 3 m from the head, it comes back in front automatically.
- **Pressing either thumbstick in** summons the HUD in front of you and un-minimizes it.

**0.1.9 details:**
- **No lag:** controller ink uses the raw tip pose. Hands use a lighter 1€ filter (MinCutoff 3, Beta 0.3). The status TextMesh is only rewritten when its text changes.
- **No tint:** surfaces are colliders only, with no renderers.
- **Ink: surfaces is surface-only.**
  - Both hands (pinch-aim ray) and controllers cast up to **3 m** (`SurfaceReach`).
  - With no hit, nothing draws, and leaving the surface ends the stroke, so there's never an air fallback or a bridge. The 25 cm jump split stays.
  - **Pointer:** an orange line plus a ring where ink lands, or a grey dot at the 3 m limit when nothing is in range (`UpdatePointer` in LiveViewController).
  - The old touch-to-draw for hands is gone. **Ink: air** still draws at the fingertip or controller tip.

**0.1.8, draggable HUD:**
- The HUD is world-locked. It's placed once, about 0.5 s after XR starts, low-left in front of the wearer.
- A **"Drag here to move"** bar across the top moves it: hold the trigger or pinch on it and move. The grabbed point stays at the same distance along the pointer ray, and the HUD turns to face the wearer.
- **Bring here** (which replaced Recenter) snaps it back in front of the wearer.
- The drag handle is a BoardButton, so pinching it never starts air ink.

**0.1.7 details:**
- `Board` carries BoardView, BoardController, PointerInput and LiveViewController on the same GameObject. **Never `SetActive(false)` it.**
- The HUD now sits about 0.5 m out, 0.29 m below eye level and 0.2 m to the left, tilted to face the wearer. In 0.1.7 it followed once you turned more than 45°; 0.1.8 removed following.

**0.1.6, ink fixes:**
- Air ink starts at the index fingertip, or at the controller's front tip about 7 cm ahead (it used to be 20 cm out along the ray).
- Surface ink: hands draw on a surface only when the fingertip touches it, within about 7 cm. Controllers reach 1.5 m along the ray (it used to be 6 m).
- Each stroke keeps the mode it started in, so air strokes never jump onto surfaces and surface strokes never draw back to the controller.
- A surface stroke that jumps more than 25 cm splits into a new stroke.

**0.1.6, control HUD (`ControlHud.cs`):** on the headset, the big shared canvas is hidden by default.
- A small panel lazily follows the wearer's gaze. In 0.1.6 it was about 0.55 m ahead and slightly low; 0.1.7 moved it lower and to the left.
- It holds the LiveView buttons, the status lines, five ink colours, **Board: on/off** (shows the shared canvas again), **Recenter** and **Minimize**.
- Minimize collapses it to an "Alongside +" pill.
- The plate has a collider, so surface ink can't pass through the HUD.

## 4. How to ship a new build (tested procedure)

1. **Bump the version in PlayerSettings and confirm it stuck.**
   - Set `bundleVersion` and `Android.bundleVersionCode`, which must be higher than 5. Then `AssetDatabase.SaveAssets()`.
   - Read the values back before building. One build silently reverted to the old version (see Gotchas).
2. **Set up release signing.** Unity forgets keystore passwords after a restart.
   - Set `PlayerSettings.Android.useCustomKeystore = true`.
   - Point `keystoreName` at the keystore.
   - Set `keyaliasName = "alongside"`.
   - Set `keystorePass` and `keyaliasPass`, reading both from the private password file. Never hard-code them in scripts.
3. **Build.**
   - Turn `EditorUserBuildSettings.development` off and `buildAppBundle` off.
   - Call `BuildPipeline.BuildPlayer` with scene `Assets/Scenes/Alongside.unity`, target Android, `BuildOptions.None`, output path `Builds/Alongside-LiveView-release.apk` (git-ignored).
   - A full IL2CPP rebuild takes about 25 minutes. An incremental one takes 1–4 minutes.
4. **Verify the APK.**
   - Run `aapt2 dump badging` and check the version.
   - Run `apksigner verify --print-certs` and check that the SHA-256 starts with `6f8534af…` (the release key). A debug-signed APK is rejected.
   - Both tools are in `<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/build-tools/36.0.0/`. Use the bundled OpenJDK `java.exe -jar lib/apksigner.jar`, because `apksigner.bat` prints nothing.
5. **Upload** with Meta Quest Developer Hub (installed as "Meta VR Developer Hub"): App distribution → Alongside LiveView → **ALPHA → Upload** → pick the APK → Next → Upload.
   - Keep the supported devices as Quest 2, Pro, Quest 3 family, and Future devices.
   - Or use the dashboard: developers.meta.com → app → Release channels.
6. On the headset, uninstall and reinstall if the update doesn't appear.

Meta rejects uploads that aren't release-signed, aren't landscape (`screenOrientation`), or come from a team that hasn't signed the Developer Distribution Agreement. The agreement is now signed.

### Signing key (NOT in this repo)

The keystore and its password file are **in the original working copy only**: `Desktop\hackathon\StanfordXR\Keystore\` (`alongside-release.keystore`, alias `alongside`, plus `KEYSTORE-PASSWORD-PRIVATE.txt`).
- Every future upload of this app must be signed with that same key.
- Never commit either file; `.gitignore` blocks them.

## 5. Settings that matter (and why)

- **Android OpenXR features enabled:**
  - Meta Quest support
  - AR Session, Camera (passthrough), Planes, Raycast, **Mesh**, **Bounding Boxes**
  - **Composition Layers**
  - Hand tracking and hand aim
  - Touch and Touch Plus controller profiles
- **Composition Layers is required:**
  - The Meta Quest feature set lists `OpenXRCompositionLayersFeature` as a required feature.
  - The passthrough layer is registered through it (`OpenXRLayerProvider.Started` in `MetaOpenXRCameraSubsystem`).
  - With it off, the scene renders but the surroundings are **black**. This happened up to version code 4.
- **Rendering:**
  - Render pipeline: **built-in**. The URP/Lit "stripped" warnings are harmless.
  - Graphics API: **Vulkan**.
  - OpenXR render mode: **MultiPass** on both Android and Standalone. Single Pass Instanced made the board invisible because the shaders aren't stereo-instanced.
- **Network:** `insecureHttpOption = AlwaysAllowed`, because the server runs on plain HTTP over the local network.
- **Orientation:** landscape-left, with portrait auto-rotation off. Required by the Store validator.
- **Standalone (Windows) "Initialize XR on Startup" is OFF.**
  - That way Editor Play mode runs as a desktop app without launching Quest Link.
  - Turn it back on to test over Link.
- **The board's starting values are stored in the scene:**
  - `startMode = CreateRoom`
  - `serverUrl = "http://192.168.137.1:4173, http://10.16.92.33:4173"` (laptop hotspot first, then the Stanford campus IP)

## 6. Surface ink design (`SurfaceInk.cs`)

- **Turning it on:** the user presses **Surfaces**. `EnableSurfaces()` requests `com.oculus.permission.USE_SCENE`, adds an `XROrigin`, plane and raycast managers, then `SurfaceInk.Setup()`.
- **What `Setup()` creates.** Prefab templates are built at runtime under an inactive parent object, all on layer 2 ("Ignore Raycast"):
  - `ARPlaneManager.planePrefab`: ARPlane, MeshFilter, MeshCollider and ARPlaneMeshVisualizer. No renderer, so planes are invisible.
  - `ARMeshManager` on a child of the XR Origin, with `meshPrefab` = MeshFilter + MeshCollider. This is the room mesh: chairs, monitors, and anything else Space Setup scanned.
  - `ARBoundingBoxManager` with BoxCollider + `BoxColliderSync` for furniture boxes.
- **`SurfaceInk.Raycast(ray)`:**
  - Physics raycast against layer 2 only, up to 6 m.
  - Returns false if any collider on the default layers is closer, so the board and its buttons always win.
  - Lifts the hit point 4 mm off the surface along the normal.
- **Ink loop in `LiveViewController.Update`:**
  - When `AirInk && SurfaceMode` and the controller or hand aim ray hits a surface, the tip snaps to the hit point and an orange reticle shows.
  - Strokes begun on a surface get `placement = "scene-plane"`, and they skip points while off-surface instead of jumping into the air.
  - The server only accepts `room`, `scene-plane` or `fixed-distance` (see `server/server/liveview.js`).
- **Ink button:** cycles **Ink: surfaces → Ink: air → Ink: OFF**.
- **Status:** works in the build (the user saw "Ink: surfaces"). **Not confirmed on the device:** that mesh and box colliders actually populate on the Quest 3S, and how well drawing feels.

## 7. Networking (what blocks the camera)

- **Camera ON requires:**
  - the Quest created the room and is its host
  - the WebSocket is connected to the server
  - the camera permission was granted
- **The server:**
  - Start it with `cd server && npm start`.
  - It binds `0.0.0.0:4173`, and the health check is `GET /api/health`.
  - The Windows firewall already allows Node inbound on Public networks.
- **Campus (Stanford) and hotel Wi-Fi block devices from reaching each other.** The Quest can't reach the laptop and stays in "Local session", so Camera ON refuses to start.
  - **The fix:** turn on the laptop's Windows **Mobile hotspot**, which shares the hotel or campus Wi-Fi. The laptop is then always `192.168.137.1`.
  - Connect the Quest, phone and iPad to that hotspot.
  - Pause NordVPN, which also blocks local connections.
  - Web viewers open `http://192.168.137.1:4173`.
- **Laptop IPs seen:** `10.16.92.33` (Stanford) and `192.168.102.237` (Comfort Inn). Neither is reachable from other devices, because of the network isolation above.
- **Not yet verified:** the Quest actually joining a room over the hotspot, and Camera ON streaming passthrough frames. `LiveCameraSource` uses WebCamTexture with an estimated calibration. An MRUK `PassthroughCameraAccess` hookup through reflection exists, but it's unused.

## 8. Device and tooling state

- **Quest 3S** (serial `340YC10G880D6K`): developer mode is on, but **adb stays "unauthorized"**. The USB-debugging prompt never appears, and the headset has no "USB Connection Dialog" setting.
  - So there's no `adb install` and no `adb logcat`. Ship through the ALPHA channel instead (section 4).
  - If adb ever authorizes, Build And Run and `adb tcpip` work normally.
  - Use Unity's adb (v37): `<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb.exe`. Developer Hub is configured to use the same one.
- **Unity Editor control:** the `unity-editor-mcp` tools (`script_eval`, `editor_playmode_start`, `capture_game_view`, `script_recompile`) worked well for building.
  - `script_eval` with a `.cs` file and a long timeout runs `BuildPipeline` builds.
- **Desktop test:**
  - Play mode in the Editor renders the board.
  - `AlongsideDebug.Status()` reports "LOCAL · not connected" when the server is down.

## 9. Gotchas already hit

- **Version reverted mid-build.** A build script set `bundleVersionCode` 5, yet the APK came out as code 4 and PlayerSettings read 4 afterwards.
  - It happened right after toggling OpenXR features and calling `AssetDatabase.Refresh()`.
  - Fix: set the version, save, read it back, then build in a separate call, and check the APK with `aapt2`.
- **Don't run `AlongsideSetup.BuildScene` or the LiveView menu items 3 and 5** (`Alongside/LiveView/*`). They rebuild the scene and reset `startMode`, `serverUrl` and the Development build flag.
- **The Quest Store listing keeps the old version name.** It's labelled "0.1.0" even when a newer build is published. Check the in-app button text instead.
- **Over Quest Link:** the reported head height can sit below the floor (`XRRig.Recenter` centres at eye height). Virtual "Meta Quest" webcams deliver no frames on the PC; the code picks a real webcam.
- **Two Unity scenes exist.** The Editor sometimes reopens `Main.unity`; builds use `Alongside.unity`.

## 10. Suggested next steps (priority order)

1. **On the headset, verify 0.1.4:**
   - Passthrough is visible, not black.
   - With the Quest on the laptop's hotspot, the status shows "Joined room".
   - Camera ON shows frames in a browser at `http://192.168.137.1:4173`.
2. **Verify surface ink on real objects.**
   - If only flat planes work, the room mesh isn't populating on the 3S. Check `SurfaceInk.Count`, which could be surfaced in the status label.
   - Consider a faint visual of the surfaces to aid aiming.
3. **Show diagnostics in the app.** Without logcat, put passthrough, session and server status in the LiveView status label, for example `ARSession.state`, the camera subsystem's running state, the server URL in use and the surface count.
4. **Theme for "Take Me To The Moon"** (the hackathon theme). The board content is still a generic 3-tile puzzle.
5. **Submission:** a vertical video of 30 seconds or less (Quest capture plus the iPad view), the Devpost write-up, and pushing this repo publicly. The hackathon brief recommends the AI Horizons and Virtuous Reality tracks, plus Pico.
