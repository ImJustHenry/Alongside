# Start Alongside

## Open the real application

1. Install Node.js 22 LTS or newer.
2. Extract **Alongside-Full-App.zip**.
3. Open a terminal inside the extracted `alongside` folder.
4. Run:

```bash
npm ci --omit=dev
npm start
```

5. Open **http://localhost:4173** on your laptop.

Windows users can run `start-windows.cmd` after installing Node. macOS/Linux users can run `bash start-macos-linux.sh`. The prebuilt frontend is included; keep the terminal open.

## Try it in two browsers

Create a room → Invite → copy the invitation → open it in an incognito window → join with another name. Draw an arrow in one window and see it in the other. Choose **Move** to drag the three learning tiles.

## Try the assistant

**Show me the next step** works immediately using an explicitly labeled scripted guide. It demonstrates drawing and feedback without pretending to be a live AI model.

For real AI, open **AI connections**, choose OpenAI or Anthropic, enter your own supported model ID/API key, and authorize the shared room. Only use a server/operator you trust. The key stays in server-process memory, but the server operator can access that process. Provider billing and network access are required.

To bring an external agent, issue an eight-hour MCP token from the same panel. See **MCP.md**. Shizuku is not preconnected; official developer access is required.

## Try Quest 3S / iPad

The devices must open the same reachable **trusted HTTPS** origin. `localhost` on your Quest is not your laptop. See **DEPLOYMENT.md** for hosted, tunnel, and trusted-local-HTTPS options. In Quest Browser choose **Spatial view → Enter mixed reality**. Start with controllers.

## Export your work

- **Export JSON:** editable board data; import it into another Alongside room.
- **Snapshot PNG:** current board image.
- **Public source:** MIT-licensed app code and a dependency lockfile are included.

The separate **Alongside-Interactive-Preview.jsx** opens in the chat viewer for a local-only interactive trial. It does not connect devices or call AI services. Its exported JSON can be imported into the real server app.

## Validation boundary

The application was built and tested locally. Server/API/MCP tests, browser synchronization and a standalone external MCP connection were exercised. Real Quest hardware, physical Apple Pencil, live model accounts, speech services, and HTTPS deployment still need your device/account validation. Exact results and limitations are in **TEST_REPORT.md**.
