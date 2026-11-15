# Alongside

A shared mixed-reality board for learning together. The Quest wearer draws on the board and directly on real objects around them (desks, walls, furniture). People on a phone, iPad or browser join the same room, see the Quest's camera view, and draw marks that appear in the wearer's space.

Built at Immerse the Bay 2026 (Stanford XR).

## What's here

| Folder | What it is |
| --- | --- |
| [`unity/`](unity) | Unity 6 (6000.6.5f1) project for Meta Quest 3/3S: board, passthrough, surface ink, LiveView camera. Main scene: `Assets/Scenes/Alongside.unity`. More detail in [`unity/Assets/Alongside/README.md`](unity/Assets/Alongside/README.md). |
| [`server/`](server) | Node.js room server and web client. Rooms, invites, live sync, camera relay, iPad pairing (`/connect` QR), and the GPT voice + vision endpoint. More detail in [`server/README.md`](server/README.md). |
| [`ipad/`](ipad) | Native SwiftUI iPad app "Alongside Live": watch the Quest wearer's view and draw onto their real surfaces with a finger or Apple Pencil. Build with Xcode on a Mac; see [`ipad/README.md`](ipad/README.md). |

## Run it

### 1. Server (laptop)

```bash
cd server
npm ci --omit=dev
npm start
```

It serves on `http://localhost:4173`. Other devices use the laptop's IP, for example `http://192.168.137.1:4173` on the laptop's Windows Mobile Hotspot.

### 2. Quest app

- **Open in Unity:** add `unity/` in Unity Hub with 6000.6.5f1 and Android Build Support, then open `Assets/Scenes/Alongside.unity`.
- **Desktop test:** press Play. Use the mouse on the in-world buttons; Tab opens the room/AI/board panel.
- **Quest build:** switch the platform to Android and build. The board's `serverUrl` can list several addresses, comma-separated; the app uses the first one whose `/api/health` answers.

### Networking

Campus and hotel Wi-Fi usually block devices from reaching each other. Turn on the laptop's Mobile Hotspot (the laptop is then always `192.168.137.1`), connect the Quest and other devices to it, and pause any VPN.

## On the headset

- **Surfaces:** loads the room mesh, planes and furniture boxes from Space Setup. Point and hold the trigger, or pinch, to draw on real objects.
- **Ink button:** cycles **Ink: surfaces → air → off**.
- **Camera ON:** streams the passthrough camera to the room. The Quest wearer must be the room host.

## License

MIT. See [LICENSE](LICENSE). Third-party notices are in [`server/THIRD_PARTY_NOTICES.md`](server/THIRD_PARTY_NOTICES.md).
