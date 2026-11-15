# Alongside for Unity (StanfordXR)

Native Unity port of the Alongside shared board. It works offline and also syncs live with the
Alongside Node server (`Desktop\hackathon\alongside-server`), so browser, iPad and Unity/Quest users share one board.

## Run it
- Open `Assets/Scenes/Alongside.unity` and press Play.
- **Desktop:** click the in-world buttons. Keys: P pen, M move, A arrow, C circle, T text, E erase, Z undo, H hint, right-click undo.
  **Tab** opens the panel with these tabs:
  - **Room:** create a room, join one, and copy or rotate the invite.
  - **AI:** ask, message the room, connect OpenAI or Anthropic, pause AI.
  - **MCP:** issue an 8-hour agent token.
  - **Board:** export, snapshot, import, reset, and edit the label text.
- **Quest via Link (PC VR):** turn on Quest Link or Air Link, then press Play. OpenXR (Standalone) with Touch profiles is already enabled.
  Point the controller laser and hold the trigger to draw or drag tiles. B/Y undoes. The right panel has Recenter, Mixed reality, Label and AI layer.
- **Quest standalone build:** install *Android Build Support* for 6000.6.5f1 in Unity Hub. Then switch the platform to Android.
  Then enable OpenXR → Meta Quest feature + Touch profiles + Meta Quest Camera (Passthrough) for Android.
  Then set `BoardController` → Start Mode = JoinInvite and paste an invite whose host is your laptop's LAN IP (not localhost). Then Build & Run.

## Server
`npm ci --omit=dev` then `npm start` in `alongside-server` → http://localhost:4173.
Other devices must use your laptop's LAN IP, for example `http://10.16.92.33:4173`. Browser WebXR on Quest needs trusted HTTPS (see DEPLOYMENT.md). The Unity app on Quest can use plain HTTP on the LAN.

## Honesty notes (same boundaries as the web MVP)
- "Show me the next step" uses the deterministic **scripted practice guide**, clearly labelled, unless a real provider is authorized on the server.
- Speech recognition/synthesis (browser features) are not ported. Hand tracking isn't either; controllers are the intended input.
- Real Quest hardware, passthrough and live AI accounts still need to be checked on your devices.
