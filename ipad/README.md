# Alongside Live (iPad app)

A fully native SwiftUI iPad app for Alongside. You see the Quest wearer's camera view live and draw back with your finger or Apple Pencil. The headset places each stroke in 3D on the real surface you drew over.

It talks to the server in [`../server`](../server) directly:
- **Pairing and joining:** REST (`/api/live/current`, `/api/rooms/:id/join`).
- **Live connection:** the `/live` WebSocket carries camera frames, room state and presence, and sends `remoteStroke` messages.
- **Room actions:** undo, clear and Ask AI go over REST.

The server's web client (`/ipad` in a browser) still works for people without the app.

| File | Role |
| --- | --- |
| `ServerFinder.swift`, `ServerAddress.swift`, `ServerSetupView.swift` | Finding the server (saved addresses, Bonjour, public address, app links). |
| `Live/LiveSession.swift` | Pairing, join, WebSocket with reconnect, frame decoding, following the Quest's room, stroke protocol. |
| `Live/LiveStage.swift` | Camera view (Canvas) and touch/Pencil input. |
| `Live/LiveScreen.swift` | Top bar, tool dock, pop-up messages, waiting card, session menu. |
| `Live/PairingView.swift` | Pairing and connecting screens, and the screen-picking `LiveRootView`. |
| `Live/Models.swift`, `Live/AlongsideAPI.swift` | Wire types and REST client. |

## Install on your iPad

1. Open `AlongsideLive.xcodeproj` in Xcode (Xcode 16 or newer; iPadOS 17 or newer).
2. Target **AlongsideLive** → **Signing & Capabilities** → set **Team** to your Apple ID ("Personal Team" is fine). If the bundle ID is taken, change it to something unique.
3. Plug in the iPad, pick it as the run destination, and press **Run**.
4. The first time only, on the iPad: **Settings → General → VPN & Device Management** → trust your developer certificate. If iPadOS asks, also turn on **Developer Mode** (Settings → Privacy & Security).
5. When the app asks for **Local Network** access, allow it. That's how it finds the server.

With a free Personal Team, the install stops opening after 7 days; press Run again to reinstall.

## Connecting (no IP typing)

Start the server on the laptop (`cd server && npm start`, or `npm run start:remote` for people far away). Then:

- **Same Wi-Fi or the laptop's hotspot:** just open the app. It finds the server over Bonjour and remembers every address that has worked.
- **Quickest first-time setup:** on the laptop, open `http://localhost:4173/connect`. Scan the QR code with the iPad's Camera. The app opens connected and paired.
- **Far away:** send the remote person the "Far away" link from that page. An iPad that has connected once nearby already knows the public address and uses it automatically when it's away.
- **Manual:** the network button in the bottom-left corner lets you type an address or pick a preset.

How the app chooses, in order:
1. Remembered local addresses.
2. Bonjour.
3. The public `https://` address.

It searches again when the network changes or the page fails to load. A **Remote** badge shows when it's connected over the internet.

The app stores the pairing code and its room membership, so reopening it rejoins the same room without adding a duplicate member. When the Quest opens a new room, the app follows it within about 5 seconds.

## Debugging

- Logs: in Console.app, filter on subsystem `edu.slu.stanfordxr.alongside.ipad`. They show the chosen server, the room joined and socket reconnects.
- Debug builds accept the launch argument `-AlongsideDemoStroke YES`. Once video is live, the app draws one stroke through the normal drawing path, so you can test stroke sending without touch (e.g. in the simulator).

## Test without a headset

`server/examples/fake-quest.mjs` plays the Quest's part, so you can try the iPad app with no VR hardware:

```bash
cd server
npm start              # terminal 1
npm run fake-quest     # terminal 2
```

- It hosts a room the way the headset does, so the paired app joins it automatically.
- It streams a software-rendered room (desk, whiteboard, walls, floor) while a simulated wearer looks around. The frames are marked **SIMULATED**.
- It places your strokes in 3D the way the Quest does: it ray-casts them onto the desk, whiteboard, walls or floor. Marks stay stuck to those surfaces as the view moves, and the app shows which surface each stroke landed on.
- The simulated wearer's hands appear as green dots. The wearer also draws two marks of their own: a circle on the desk and an arrow on the whiteboard.

To try the browser version instead, open `http://localhost:4173/ipad`.
