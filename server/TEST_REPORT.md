# Alongside 0.1.0 — original baseline validation report

> Collaborative-writing update: 65 Node tests (39 baseline + 26 new), 22 baseline browser checks and 11 new toggle browser checks passed. See `../COLLABORATIVE-WRITING-UPDATE.md` for the current patch report. Unity source was syntax-checked, not compiled or tested on a headset here. The original baseline results below are retained for traceability.

Build date: November 14, 2026. Tests were run in a Linux sandbox with Node 22.23.3 and preinstalled headless Chromium. This report describes observed local results, not physical-device or live-provider certification.

## Summary

| Check | Result | What was actually exercised |
|---|---|---|
| Production Vite build | PASS | React/Three.js frontend compiles into dist. |
| Clean release installation | PASS | A separate release folder installed with npm ci --omit=dev, started with npm start, and passed the 22 browser checks plus preview smoke check. |
| Server/domain/protocol suite | 39/39 PASS | Real local HTTP, WebSockets, official MCP client/server, validation, permissions and persistence. Two of these tests use mocked provider HTTP replies. |
| Browser workflow suite | 22/22 PASS | Real Chromium contexts simulating desktop, tablet-sized and phone-sized browsers. |
| Standalone external MCP client | PASS | A separate Node process authenticates, highlights an object and sends shared guidance over the real MCP transport. Agent decisions are explicitly scripted. |
| Interactive local preview | PASS | SVG drawing, scripted guide, valid board JSON export, no browser exceptions. |
| Production dependency audit | PASS at build time | npm audit --omit=dev reported zero known vulnerabilities after updating Zod to the patched major version. Not a security certification. |
| Physical Quest 3S | NOT TESTED | No headset connected to the sandbox. |
| Physical iPad/Apple Pencil | NOT TESTED | Touch/browser events were tested; real stylus/palm behavior was not. |
| Real OpenAI/Anthropic inference | NOT TESTED | No user's API credentials were supplied. Provider protocol adapters were tested with mocked replies. |
| Shizuku AI | NOT INTEGRATED | Official developer access remains necessary. No fake Shizuku connection is shown. |
| Microphone / speech services | NOT TESTED | Optional browser speech input/output paths are implemented, with text fallback. |
| HTTPS tunnel / cloud deployment / Docker | NOT TESTED | Configuration and deployment instructions are included; no external service was deployed. |

The combined automated total is 39 server tests + 22 browser checks + 2 standalone smoke checks. These overlap in coverage; the count is not a claim of exhaustive quality or production readiness.

## Server and MCP tests

1. Health identifies build.
2. Private room creation and host identity.
3. Missing credentials rejected.
4. Room code without invitation rejected.
5. Authorized invitation join.
6. Cross-room token isolation.
7. Snapshots exclude token material.
8. Two WebSocket clients receive committed drawing state.
9. Live preview is transient rather than persisted.
10. Invalid normalized coordinates rejected.
11. Arbitrary anchor IDs rejected.
12. Arrow requires two points.
13. Collaborator cannot erase another human's mark.
14. Undo removes only current author's latest mark.
15. Tile movement updates progress and object version.
16. Stale object moves rejected.
17. Non-host reset rejected.
18. Scoped external agent token creation.
19. Official MCP client initialization and tool discovery.
20. MCP reads the shared scene.
21. MCP adds an object-attached highlight.
22. Stale AI revision rejected.
23. MCP guidance appears in shared message history.
24. Agent blocked from human-only editing endpoint.
25. Host pause blocks agent reads and writes.
26. Resume restores authorized access.
27. AI clears only its own marks.
28. Token revocation immediately blocks access.
29. Scripted guide operates without a provider key and labels itself.
30. Provider connection requires consent and credentials.
31. Exports exclude credentials.
32. Export/import preserves board content without importing identities.
33. Invalid import does not mutate the board.
34. Invitation rotation invalidates the old secret for new joins.
35. Disk persistence reload recovers state and auth.
36. Malicious browser origin rejected.
37. Completed exercise gets completion guidance.
38. OpenAI tool loop executes with a mocked provider response.
39. Anthropic tool loop executes with a mocked provider response.

## Browser checks

1. Landing page renders.
2. Host creates and enters live workspace.
3. Invitation link and QR generated.
4. Independent collaborator joins; presence synchronizes.
5. Pen strokes sync.
6. Arrows sync.
7. Circles sync.
8. Text annotation persists.
9. Undo removes owned latest mark.
10. Tile movement/progress sync.
11. No-key guide visibly labels scripted output and draws.
12. Opted-in feedback is triggered by placement events.
13. Host pause/resume reaches both clients and disables AI actions.
14. JSON export downloads.
15. PNG snapshot downloads.
16. MCP endpoint/token issuance works in UI.
17. Browser reload restores membership and board state.
18. Dropped WebSocket reconnects and restores authoritative state.
19. Three.js desktop spatial preview renders; unsupported immersive modes remain disabled.
20. Phone viewport joins with no horizontal overflow.
21. Touch tap creates a synchronized mark.
22. No uncaught JavaScript errors in the tested browser contexts.

## Important limits

- A desktop 3D preview is not a Quest emulator or hardware test. XR session entry, controller rays, headset placement and optional hand input require the physical acceptance checklist in DEPLOYMENT.md.
- The spatial workspace is a shared plane with board objects. There is no physical camera stream, arbitrary 3D CAD editing, room reconstruction or multi-headset shared-anchor calibration.
- Human strokes are previewed during drawing, then committed on release. Tile moves are synchronized on placement, not continuously during drag.
- Built-in AI adapters use ordinary tool-capable provider requests, not streamed full-duplex voice models. Live feedback is event-triggered and latency depends on the provider/network.
- First-time runtime dependency installation needs npm access. Network proxies or organization policies may affect installation and provider access.
- Source and prebuilt assets are included with a lockfile. Runtime secrets, test room databases and installed node_modules are excluded from the archive.

## Reproduce

```bash
npm ci
npm run build
npm test
npm run test:mcp
npm start
```

In another terminal, with an installed compatible Chromium or PUPPETEER_EXECUTABLE_PATH set:

```bash
npm run test:browser
node tests/preview.mjs
npm audit --omit=dev
```

See the screenshots directory for actual renders from these local browser tests. The labels in those images are demo participants, not evidence of physical-device testing.
