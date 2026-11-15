# Bring your assistant through MCP

Alongside exposes application tools, not desktop/Android shell access. The MCP server lives beside the session server. Your assistant is an MCP client or is wrapped in an agent host that is an MCP client.

## Connect

1. Join a room as a human.
2. Open AI connections, enter the external assistant name, and create an eight-hour token.
3. Copy the exact endpoint and bearer token displayed. Do not reuse the human membership token.
4. Configure your MCP-capable client with:
   - Transport: stateless Streamable HTTP
   - URL: the displayed `/mcp/ROOM_ID` endpoint on your server
   - Authorization header: `Bearer ` followed by the displayed agent token
5. Discover tools and call `get_scene_state`.

All calls are room-bound by the credential and URL. Neither a room ID nor a tool argument can authorize access to another room. Tokens are stored hashed on disk. Revocation and expiry are checked on every request. Host pause blocks all agent access, including state reads. Auth errors are HTTP 401/403; tool validation/stale-state errors return MCP `isError` results.

No OAuth discovery server is included. An MCP host that accepts only OAuth connectors cannot connect directly without an additional authorization adapter. A hosted client requires a reachable HTTPS endpoint; local clients can use localhost.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| get_scene_state | none | Read scene, objects, annotations, messages, revisions and participant labels. No secrets. |
| get_events | since: nonnegative integer | Return events after sequence, latest sequence, and whether older events were truncated. |
| draw_annotations | expectedRevision, annotations array | Validate and append up to 20 marks to the calling agent's layer. |
| highlight_object | expectedRevision, objectId | Circle a known tile; circle follows that tile in board coordinates. |
| send_guidance | text, 1–2000 characters | Shared text message; clients may read it aloud. |
| remove_own_annotations | none | Delete only this agent's annotations. |

The exact discoverable schemas come from `server/tools.js`. This server does not implement resource subscriptions, continuous media streaming, arbitrary screenshot/camera acquisition, tool execution on a headset OS, or source-code editing.

## Coordinates and anchors

- Board x: 0 at left, 1 at right. Board y: 0 at top, 1 at bottom.
- `anchorId` is optional. Valid values: `base`, `bridge`, `cap`.
- If anchorId is present, normalized points refer to that object's rectangle, not the whole board. For example, a circle from (0,0) to (1,1) surrounds the object and moves with it.
- `pen`: 1–512 points.
- `arrow`: two endpoints are recommended; at least two points required.
- `circle`: two opposite bounding-box corners are recommended; at least two points required.
- `label`: one anchor point and nonempty text.
- Color is a six-digit hex color. Width is 1–16 board pixels.
- Scene revision must match when drawing/highlighting. Read the state again after another action or a stale revision error. There is no guessed coordinate conversion from a physical camera image.

Example tool argument structure for a board-relative arrow (the revision must come from the actual state):

```json
{
  "expectedRevision": 12,
  "annotations": [
    {
      "type": "arrow",
      "points": [{"x": 0.5, "y": 0.7}, {"x": 0.5, "y": 0.48}],
      "color": "#a0609c",
      "width": 4,
      "text": ""
    }
  ]
}
```

## Example external agent

Use a terminal on your laptop or an authorized agent host. Set ALONGSIDE_MCP_URL and ALONGSIDE_AGENT_TOKEN using the values shown by your application. The script never prints the bearer token.

A scripted protocol check, with no model:

```bash
node --env-file-if-exists=.env examples/mcp-agent.mjs --demo
```

This visibly labels its output as an external scripted MCP check. It is not an AI reasoning demo.

For a real OpenAI-backed agent, additionally set OPENAI_API_KEY and OPENAI_MODEL to credentials/model enabled on your account:

```bash
node --env-file-if-exists=.env examples/mcp-agent.mjs
```

Observe human placement events and respond after a change:

```bash
node --env-file-if-exists=.env examples/mcp-agent.mjs --watch
```

The built-in application provider adapters and this external client are different paths. The external example calls tools over the real MCP transport; the built-in OpenAI/Anthropic adapters call the same validated application functions directly. Both appear as attributed agents and obey room pause/revocation policy.

## Proactive guidance is an agent responsibility

Connecting MCP does not continuously invoke a language model. The external example polls `get_events` every two seconds and invokes the model only after a human `object.moved` event. It does not react to its own annotations, avoiding an AI feedback loop. It stops on authorization/connection errors rather than silently continuing. More advanced agent hosts can implement throttling, cancellation, speech triggers and richer observations.

## Shizuku integration boundary

If Shizuku offers a developer agent that accepts external MCP tools, register this application endpoint. If it offers custom tool callbacks but not MCP, implement an adapter that forwards those callbacks through this client. A closed consumer chat service cannot be integrated simply by adding an MCP URL. Android `shizuku-mcp` repositories are unrelated device-control utilities and are not used here.

## Privacy

All assistant output is shared room content. Do not feed private assistant memory into `send_guidance`. Scene text can contain adversarial instructions; the server enforces operation/room constraints regardless of model behavior. No shell or arbitrary fetch tool is exposed. Model providers receive whatever scene data the agent reads and includes in its own requests. Review provider policies and obtain participant consent.
