# Alongside
## Your people. Your AI. One shared space.

**Current LiveView source release:** read `../README.md` and `../RELEASE-NOTES.md` first. This folder now includes the LiveView camera relay, frame-referenced spatial drawing and the save-confirmation/reload repair. Current checks: **93 Node tests and 54 browser checks**; Unity compilation and physical devices remain unverified. The sections below retain baseline board setup and behavior. Collaborative writing OFF still allows host edits on the old 2D board, but blocks everyone's new 3D spatial writing.

**Runnable hackathon MVP, version 0.1.0.** A live, multi-client drawing board with a spatial WebXR view, an iPad/touch/mouse interface, and an authenticated MCP interface for user-authorized AI agents.

This is an actual client/server source package, not just a design mockup. The included chat preview is a separate local-only demonstration. Real collaboration needs the server below.

> Current verification: 93 Node tests, 22 baseline browser checks, 11 writing-policy browser checks and 21 simulated-source LiveView browser checks. Provider adapter tests use mocked HTTP replies. Physical Quest 3S, Apple Pencil, microphone/speech services, live AI accounts, Shizuku, and deployment hardware have NOT been verified. `../verification/` and `../RELEASE-NOTES.md` are current; `TEST_REPORT.md` retains the historical baseline.

## Quick start — use the included prebuilt application

1. Install **Node.js 22 LTS or newer**.
2. Extract this entire folder; do not open `dist/index.html` as a local file.
3. Open a terminal in the extracted folder:

```bash
npm ci --omit=dev
npm start
```

4. Open **http://localhost:4173** on your laptop.
5. Enter your name, create a workspace, then select **Invite**.
6. Test the invitation in an incognito window or a second browser.

The ZIP includes `dist/`, so no build step is needed for this quick start. `start-windows.cmd` and `start-macos-linux.sh` provide equivalent convenience launchers; they require Node and internet access for the first dependency installation. Keep the server terminal open.

### Editing the source

```bash
npm ci
npm run dev
```

After source changes, regenerate the prebuilt application:

```bash
npm run build
npm start
```

Source is formatted and provided under the MIT License. Third-party dependencies retain their own licenses.

## What works

- Private room creation and invitation-based joining; a room code alone is insufficient.
- WebSocket presence, live stroke previews, shared committed annotations, and reconnect snapshots.
- Pen, arrow, circle, text, erase, undo-own-last-mark, and clear-own-marks.
- Pointer events for mouse, touch, and Pencil-compatible input. No Pencil-specific SDK is required.
- A three-tile spatial teaching exercise with move interactions, shared progress, and object-relative annotation anchors.
- A Three.js view of the exact same board, with native WebXR session entry when available.
- Immersive controller-ray drawing and tile movement; in-world Pen, Move, Arrow, Circle, Undo, AI hint, and Exit buttons.
- JSON board export/import, PNG snapshot export, and disk-backed room persistence.
- Per-user OpenAI Responses or Anthropic Messages API configuration, with validated tool execution.
- Optional automatic feedback after completed tile moves, bounded request rate and per-turn tool budget.
- Browser speech synthesis, and optional browser speech recognition with explicit consent and text fallback.
- Room-scoped, revocable, eight-hour MCP agent tokens. Official MCP SDK client/server integration is tested.
- Host-controlled pause that blocks agent reads as well as writes.
- Clear attribution of human, actual external-agent, and scripted-practice contributions.

### What this MVP does NOT claim

- It is a **world-positioned 2D spatial board**, not an arbitrary 3D model editor or a scanned physical-room digital twin.
- Tiles are educational board objects, not electrically simulated components.
- LiveView adds camera publisher/relay and opt-in image-to-AI source paths; the Unity camera publisher and live AI provider calls remain unverified. There is no gaze tracking, shared room-anchor alignment between multiple headsets, or verified arbitrary physical-object recognition.
- It does not silently import a user's existing ChatGPT/Claude chat history or private memories.
- It does not connect Shizuku automatically. Official developer access is still needed; no Shizuku API has been fabricated.
- It is not a high-availability, multi-server enterprise service. Storage and room limits target a small, single-server hackathon demo.
- AI guidance is event-driven and dependent on network/provider latency. It is not hard real-time and must not control safety-critical work.

## Use the workspace

### Draw or teach from iPad/laptop

- **Pen:** hold and draw. Strokes are previewed to peers while being created and persisted on release.
- **Arrow / Circle:** drag from one corner/endpoint to the other.
- **Text:** enter the label in the tool settings and tap the board.
- **Move:** drag a tile to its matching dashed outline. Placement, not intermediate drag positions, is committed to the shared session.
- **Erase:** click near a mark. You can erase your own marks; the host may erase any mark.
- **Undo:** removes your most recent retained annotation; it does not undo other users' work or tile moves.
- **AI layer:** hides AI annotations in your own view only.
- **Reset exercise:** host-only, with confirmation. Removes annotations/messages and returns tiles to the tray.

Use landscape on a phone or iPad for more drawing area. Pressure samples are accepted but the rendered stroke uses the selected fixed width. Palm rejection and physical Pencil behavior require device testing.

### Invitations and identity

The invitation is a secret link with room ID and secret in the URL fragment. Send it only to trusted participants. Each joining browser gets a separate bearer token. That token is stored in sessionStorage for that tab, not in an account system.

Reload keeps the tab's membership. Closing the tab or clearing browser storage may lose it. Keep the host tab open. Host-only invitation rotation invalidates old links for future joins but does not remove existing members. This prototype has no user-account recovery, member-kick workflow, or host transfer. For a completely new access boundary, start a new room.

## Use Quest 3S

1. Run the application at a **trusted HTTPS address reachable by the Quest and iPad**. See DEPLOYMENT.md. `localhost` on the Quest means the Quest, not your laptop.
2. Open the invitation in Quest Browser, join under a wearer name, and select **Spatial view**.
3. Select **Enter mixed reality** for passthrough, or **Enter VR** for an opaque environment. Buttons remain disabled when the browser does not report the relevant immersive session mode.
4. The board is positioned in front of the initial headset pose. Point at the in-world toolbar and pull the trigger to choose a tool.
5. In Pen/Arrow/Circle, point at the board and hold the trigger while moving. In Move, begin on a tile and drag.
6. **AI hint** requests guidance from that wearer's configured provider, or the clearly scripted practice guide if no live provider is connected.
7. Exit with the in-world Exit button or system controls.

Hand input is requested as an optional WebXR feature, but no dedicated hand-model rendering or custom gesture recognizer is included. Controllers are the intended first-demo input. Headset placement, permissions, rendering, ray interactions, and frame rate must be tested on the real device before judging.

## Connecting iPads, nearby or far away

When the server starts it prints the pairing code, its addresses, an `alongside-live://` app link and a QR code. The native iPad app ([`../ipad`](../ipad)) finds the server in three ways:

- **Automatically on the same network.** The server announces itself over Bonjour (`_alongside._tcp`). Turn this off with `NO_MDNS=1`. The app also remembers every address that has worked.
- **QR code.** On the server computer, open `http://localhost:4173/connect` and scan it with the iPad's Camera. The app opens connected and paired. This page only opens on the server computer itself, because it shows the pairing code.
- **Far away.** Run `npm run start:remote` instead of `npm start`. It also starts a free Cloudflare quick tunnel and gets a public `https://….trycloudflare.com` address, which it allows automatically and announces to the app.
  - Install `cloudflared` first. Windows: `winget install Cloudflare.cloudflared`. macOS: `brew install cloudflared`.
  - Send the remote person the "Far away" link from `/connect`. It contains the pairing code, so send it privately.
  - Without the app, they can open `https://….trycloudflare.com/ipad` in any browser.
  - An iPad that has connected once nearby already knows the public address, and switches to it by itself when the local network can't reach the server.

Everyone uses the same server and the same room, so drawings and the Quest camera stay in sync wherever people are. The Quest itself stays on the local network.

Limits:
- The tunnel address changes every time it restarts, so send a fresh link.
- Video over the internet is slower than on the local network.
- Anyone with the public address still needs the pairing code or an invite.

## AI modes and honest attribution

### 1. Scripted practice guide — works immediately

The default guide deterministically highlights the next unplaced tile and draws an arrow to the matching target. It is explicitly labeled **scripted practice, not a live model**. It is useful for testing synchronization and the presentation flow without credentials. It is not evidence of natural-language reasoning; every question follows the same next-step routine.

### 2. Bring your provider

Open **AI connections**. Select OpenAI or Anthropic, enter an exact model ID enabled on your account, your API key, your assistant's name and optional coaching preference. Check the permission checkbox and connect.

- OpenAI uses `POST https://api.openai.com/v1/responses` with function tools and `store: false`.
- Anthropic uses `POST https://api.anthropic.com/v1/messages` with tools.
- Keys are sent to this application's server. They are retained only in that server process's memory, never written to the room JSON, returned in status endpoints, or included in exports.
- **Use only a server/operator you trust.** Your provider receives the shared board and any room messages requested through the tool context. There is no private-chat compartment in this prototype.
- API billing is separate from a consumer chat subscription. Model availability, quotas, context limits, and provider retention policies remain governed by your account/provider.
- Disconnecting removes the key from the configuration map and revokes its agent token. Restarting the server clears all provider keys; reconnect afterward. Provider agent tokens expire after eight hours and must be reconfigured.
- API calls are bounded, and scene mutations are validated. The provider cannot move objects, edit source, open a shell, or delete human annotations through its offered tool set.
- Speech recognition is an optional browser service; audio may be processed by the browser vendor. Transcription fills the question box; review it before Send. Text input always remains available. Speech synthesis must be enabled by the wearer and depends on installed browser voices.

Mocked adapter tests do not establish that a live account or model works. Validate one actual question and one actual drawing call with your own credentials before claiming live AI integration.

### 3. Bring an existing MCP-capable agent

Open AI connections and create an external agent token. Give its endpoint and bearer token to your agent host. The transport is authenticated **stateless Streamable HTTP**. Tools are POST-based; GET/SSE subscriptions are not implemented. Use the example in `examples/mcp-agent.mjs` or configure a client that supports bearer headers. OAuth-only clients may need an additional authorization adapter.

See MCP.md for exact schemas and operating instructions. Your agent must run its own observation/polling loop: connecting MCP does not automatically wake an assistant whenever a human moves.

## Export and persistence

- **Export JSON** contains the title, board objects, annotations, and shared message history. It excludes invites, API keys, and bearer tokens. Shared message text may still contain sensitive material; review before sharing.
- **Snapshot PNG** downloads the current visible 2D board. It is not a headset screenshot. Hidden AI layers remain hidden in the snapshot.
- **Import board** is host-only and replaces board content after confirmation. Imported annotation geometry/text/color are preserved but attributed to the importing host, preventing identity spoofing. Messages, old identities and credentials are not imported. Duplicate/missing object IDs and invalid geometry are rejected.
- The server atomically replaces `data/rooms.json` after state changes. Back up that directory privately. Writes are single-process; do not run multiple instances against the same file.
- Keep `data/`, `.env`, certificates, tokens and private exports out of your public Git repository. A sample `.gitignore` is included.

## Testing

```bash
npm ci
npm run build
npm test
npm start
```

In another terminal:

```bash
npm run test:browser
```

Browser tests require a compatible local Playwright Chromium installation, or set `PUPPETEER_EXECUTABLE_PATH` to an already installed Chromium binary. The build environment used a preinstalled browser; no browser download was performed. Set `TEST_BASE_URL` to test another deployment and `TEST_OUTPUT` to choose a screenshots directory. Tests create demo rooms; use a separate DATA_FILE instead of a live user's database.

## Source map

```text
client/App.jsx        Invitations, room UI, AI connection settings, export controls
client/Board.jsx      Pointer drawing, erasing, tile movement, live previews
client/paint.js       Shared canvas rendering used in both 2D and XR
client/XRView.jsx     Three.js spatial view, immersive sessions, controller rays
client/style.css      Responsive visual design
shared/model.js      Known objects, coordinate helpers, deterministic practice guide
server/index.js      HTTP API, origin checks, WebSocket synchronization, MCP routing
server/store.js      State, persistence, credentials, access policy, validation
server/tools.js      Application tools shared by MCP and API-backed assistants
server/ai.js         OpenAI/Anthropic adapters and memory-only provider credentials
examples/mcp-agent.mjs External MCP client with scripted or real-provider mode
examples/smoke-mcp.mjs Repeatable standalone external-agent connection check
tests/               Automated domain, protocol and browser tests
dist/                Prebuilt deployable frontend
```

## Research references used for implementation

- MCP SDK stateless HTTP pattern: https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts
- OpenAI function tools: https://developers.openai.com/api/docs/guides/function-calling
- Anthropic tools: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Three.js WebXR: https://threejs.org/docs/pages/WebXRManager.html
- Shizuku announcement (NOT an API integration): https://shizuku.ai/en/blog/1/

Alongside is a working-name suggestion. Trademark/domain clearance has not been performed. The product is not sponsored or endorsed by any listed model provider.
