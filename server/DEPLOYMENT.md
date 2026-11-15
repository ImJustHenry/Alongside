# Deployment and device checklist

## One server, three clients

Alongside needs one long-running Node process with WebSocket support. The laptop, iPad and Quest must reach that same origin. A static-only host cannot run the backend or MCP server.

Local laptop testing: http://localhost:4173 is sufficient. Plain HTTP on a laptop's LAN address can test ordinary drawing, but **immersive WebXR and remote API-key entry require trusted HTTPS**. A self-signed warning page or bypass flag is not a reliable hackathon deployment.

## Option A — a hosted Node service / HTTPS reverse proxy

1. Upload the source/package to a Node-capable host that supports WebSocket upgrades.
2. Install production dependencies with `npm ci --omit=dev`.
3. Start `node server/index.js`. The built frontend in `dist/` is included.
4. Set `PORT` to the host's expected port and `PUBLIC_ORIGIN` to the exact public HTTPS origin (no trailing slash).
5. If one trusted proxy terminates TLS and overwrites forwarded headers, set `TRUST_PROXY=1`. Do not enable this behind an untrusted or unknown proxy chain.
6. Mount persistent writable storage and set `DATA_FILE` to its `rooms.json` path. Without persistence, redeployment loses rooms.
7. Forward WebSocket upgrades for `/live`; allow POST bodies and Authorization headers for `/mcp/*` and `/api/*`.
8. Create new invitations using the deployed origin, not a saved localhost link.

The supplied Dockerfile packages the already built frontend and production server. Docker build/run has not been tested in this environment. Re-run `npm run build` before building the image if you changed frontend source.

## Option B — development tunnel

A developer-managed HTTPS tunnel can make a laptop server reachable by the devices and by a hosted MCP client. Use only a tunnel service permitted by the venue and by your data policy. Do not put internal/proprietary work into a public demo room.

For example, if Cloudflare's `cloudflared` is already installed, its quick-tunnel command is:

```bash
cloudflared tunnel --url http://localhost:4173
```

Use the exact HTTPS origin printed by the tunnel as `PUBLIC_ORIGIN` in your `.env` file, set `TRUST_PROXY=1` only when the tunnel is the trusted proxy, and restart Alongside. The tunnel must remain running. Its address can change after restarting; update PUBLIC_ORIGIN and create fresh invitation links. This is setup guidance, not a deployed or tested tunnel.

## Option C — trusted local HTTPS

Use a local CA/certificate workflow where both the iPad and Quest actually trust the issuer, and where the certificate covers the server name/IP used in invitations. Set HTTPS_KEY and HTTPS_CERT to the private key and certificate paths. Set PUBLIC_ORIGIN to the exact HTTPS origin. Do not check those certificates/private keys into Git. Installing a trusted local certificate on all devices can take longer than using an approved hosted HTTPS origin.

## Network pitfalls

- Venue Wi-Fi may isolate clients. Devices on the same SSID may still be unable to reach the laptop.
- A phone hotspot/travel router may help only if venue policy permits it. It still does not create a trusted HTTPS origin by itself.
- Do not assume a browser tab cast from Quest is the app's camera feed. This implementation shares scene state, not camera video.
- An MCP-enabled cloud service cannot access your laptop's localhost. Give it a reachable HTTPS endpoint and a scoped bearer token.
- Keep the process alive; this is not a serverless-per-request backend.
- PUBLIC_ORIGIN is an allowlist, not a public URL launcher. It does not create a tunnel or obtain certificates.

## Physical-device acceptance checklist — NOT yet executed

- [ ] Open one invitation on laptop, iPad and Quest 3S; all show the same room.
- [ ] Pencil strokes on iPad show on laptop and Quest with acceptable perceived latency.
- [ ] Pointer capture and palm behavior work for the actual Pencil/iPad model.
- [ ] Mixed reality button becomes enabled on Quest over trusted HTTPS.
- [ ] Enter/exit MR repeatedly without a black screen or stuck session.
- [ ] Board appears comfortably in front of the wearer.
- [ ] Both controllers can select tools and draw; verify one active stroke at a time.
- [ ] Move all three tiles through controller ray input.
- [ ] Use in-world AI hint and see the resulting marks/guidance.
- [ ] Verify speech output is audible and does not cause feedback/echo.
- [ ] If using optional voice recognition, test real browser support and permissions; keep text as fallback.
- [ ] Disconnect/reconnect Wi-Fi; committed state returns and no duplicate writes appear.
- [ ] Test one real AI key/model: inspect scene, annotate, answer, and react to one placement.
- [ ] Connect a real external MCP-capable assistant with bearer-header support.
- [ ] Pause AI access, then verify the external assistant cannot read or draw.
- [ ] Revoke token, verify access stops, and demonstrate undo of an AI mark by the host.
- [ ] Export JSON/PNG and inspect them before sharing.
- [ ] Remove secrets from recordings and the public repository.

## Security and operating limits

This is a single-server prototype, not a production security certification. Default limits include 100 rooms/server, 40 human memberships/room, 20 simultaneously active agent tokens/room, 400 annotations/board, 512 points/stroke, 80 retained messages and 250 retained events. Tokens grant access to the entire shared room; there are no per-object ACLs. Membership tokens persist until the room is removed. API keys stay in process memory until disconnect or restart; the host operator can access process memory.

Use an isolated deployment for the demo. Add proper accounts, room lifecycle/deletion, backups, member removal, audit retention policy, abuse protection, OAuth if needed, secret management and a scalable database before real enterprise use. Do not run multiple instances against the same JSON state file.
