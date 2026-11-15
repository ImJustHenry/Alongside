import express from "express";
import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { randomInt, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Store, Fault, annotationSchema, point } from "./store.js";
import { mcpServer } from "./tools.js";
import { AIManager } from "./ai.js";
import { FrameHub, LIMITS } from "./liveview.js";
import { askFrame } from "./liveview-ai.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function createApp({
  file = process.env.DATA_FILE || resolve(root, "data/rooms.json"),
  dev = false,
} = {}) {
  const app = express(),
    store = new Store(file),
    ai = new AIManager(store);
  const limited = new Map();
  // iPad app pairing: the latest room a headset created is handed to the iPad app
  // only with this 6-digit code (kept next to the data file, gitignored).
  const dataDir = file ? dirname(file) : null,
    pairFile = dataDir && resolve(dataDir, "pair-code.txt"),
    currentFile = dataDir && resolve(dataDir, "live-current.json");
  let pairCode = process.env.PAIR_CODE || "";
  try {
    if (!pairCode && pairFile && existsSync(pairFile))
      pairCode = readFileSync(pairFile, "utf8").trim();
  } catch {}
  if (!/^\d{6}$/.test(pairCode)) {
    pairCode = String(randomInt(0, 1e6)).padStart(6, "0");
    try {
      if (pairFile) {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(pairFile, pairCode + "\n");
      }
    } catch {}
  }
  let liveCurrent = null;
  try {
    if (currentFile && existsSync(currentFile))
      liveCurrent = JSON.parse(readFileSync(currentFile, "utf8"));
  } catch {}
  const pairOk = (code) => {
    const a = Buffer.from(String(code || "")),
      b = Buffer.from(pairCode);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  const configured = (process.env.PUBLIC_ORIGIN || "")
    .split(",")
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  function safeHost(host) {
    const hostname = host.split(":")[0];
    return (
      ["localhost", "127.0.0.1"].includes(hostname) ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)[\d.]+$/.test(hostname) ||
      configured.some((x) => new URL(x).host === host)
    );
  }
  function safeOrigin(req) {
    const origin = req.headers.origin;
    return (
      !origin ||
      configured.includes(origin) ||
      (["http:", "https:"].includes(new URL(origin).protocol) &&
        new URL(origin).host === req.headers.host)
    );
  }
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(self), xr-spatial-tracking=(self)",
      "Cache-Control": "no-store",
    });
    try {
      if (!safeHost(req.headers.host || "") || !safeOrigin(req))
        throw new Fault(
          "Host/origin not allowed. Set PUBLIC_ORIGIN for your deployment.",
          403,
        );
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use(express.json({ limit: "2mb" }));
  const limit = (req, key, max = 120) => {
    const id = (req.ip || "unknown") + ":" + key,
      now = Date.now();
    let b = limited.get(id);
    if (!b || now - b.t > 60000) {
      b = { t: now, n: 0 };
      limited.set(id, b);
    }
    if (++b.n > max) throw new Fault("Rate limit; try again in a minute", 429);
    if (limited.size > 10000)
      for (const [k, v] of limited) if (now - v.t > 60000) limited.delete(k);
  };
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  const bearer = (req) =>
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const auth = (req) => store.auth(req.params.room, bearer(req));
  const human = (req) => {
    const a = auth(req);
    if (a.kind !== "human") throw new Fault("Human member required", 403);
    return a;
  };
  app.get("/api/health", (_, res) =>
    res.json({ ok: true, app: "Alongside", version: "0.1.0" }),
  );
  app.get(
    "/api/live/current",
    wrap((req, res) => {
      limit(req, "pair", 40);
      if (!pairOk(req.headers["x-pair-code"]))
        throw new Fault("Wrong pairing code", 403);
      if (!liveCurrent || !store.rooms.has(liveCurrent.room))
        return res
          .status(404)
          .json({ error: "Waiting for the Quest to open Alongside" });
      res.json(liveCurrent);
    }),
  );
  app.post(
    "/api/rooms",
    wrap((req, res) => {
      limit(req, "create", 12);
      const created = store.create(req.body.name, req.body.title);
      // Headset hosts (Unity) can't show their invite in VR, so remember it for the
      // paired iPad app (/ipad) and print it for the operator. Files are gitignored.
      if (/UnityPlayer/i.test(req.get("user-agent") || "")) {
        const link = `${req.protocol}://${req.get("host")}/#room=${created.room.id}&invite=${encodeURIComponent(created.invite)}&view=live`;
        console.log(`[Alongside] INVITE ${created.member.name}: ${link}`);
        liveCurrent = {
          room: created.room.id,
          invite: created.invite,
          host: created.member.name,
          created: Date.now(),
        };
        try {
          if (dataDir) {
            writeFileSync(resolve(dataDir, "last-invite.txt"), link + "\n");
            writeFileSync(currentFile, JSON.stringify(liveCurrent));
          }
        } catch {}
      }
      res.status(201).json(created);
    }),
  );
  app.post(
    "/api/rooms/:room/join",
    wrap((req, res) => {
      limit(req, "join", 30);
      res.json(store.join(req.params.room, req.body.invite, req.body.name));
    }),
  );
  app.get(
    "/api/rooms/:room",
    wrap((req, res) => {
      auth(req);
      res.json(store.snapshot(req.params.room));
    }),
  );
  app.post(
    "/api/rooms/:room/actions",
    wrap((req, res) => {
      limit(req, "action", 240);
      store.action(req.params.room, human(req), req.body);
      res.json({ ok: true, revision: store.room(req.params.room).revision });
    }),
  );
  app.post(
    "/api/rooms/:room/invite",
    wrap((req, res) =>
      res.json({ invite: store.rotateInvite(req.params.room, human(req)) }),
    ),
  );
  app.get(
    "/api/rooms/:room/export",
    wrap((req, res) => {
      human(req);
      res
        .attachment(`alongside-${req.params.room}.json`)
        .json(store.export(req.params.room));
    }),
  );
  app.post(
    "/api/rooms/:room/import",
    wrap((req, res) => {
      store.import(req.params.room, human(req), req.body);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/rooms/:room/agents",
    wrap((req, res) => {
      limit(req, "mint", 20);
      res.json({
        ...store.mintAgent(req.params.room, human(req), req.body.name),
        mcpPath: `/mcp/${req.params.room}`,
      });
    }),
  );
  app.delete(
    "/api/rooms/:room/agents/:agent",
    wrap((req, res) => {
      store.revokeAgent(req.params.room, human(req), req.params.agent);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/rooms/:room/ai",
    wrap((req, res) => res.json(ai.status(req.params.room, human(req)))),
  );
  app.put(
    "/api/rooms/:room/ai",
    wrap((req, res) => {
      limit(req, "config", 20);
      const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      );
      if (req.body.provider !== "demo" && !req.secure && !loopback)
        throw new Fault(
          "Use HTTPS before sending an API key from another device.",
          403,
        );
      res.json(ai.configure(req.params.room, human(req), req.body));
    }),
  );
  app.delete(
    "/api/rooms/:room/ai",
    wrap((req, res) => res.json(ai.disconnect(req.params.room, human(req)))),
  );
  app.post(
    "/api/rooms/:room/ai/ask",
    wrap(async (req, res) => {
      limit(req, "ask", 12);
      res.json(await ai.ask(req.params.room, human(req), req.body.prompt));
    }),
  );
  app.get(
    "/api/rooms/:room/liveview",
    wrap((req, res) => {
      human(req);
      res.json(hub.status(req.params.room));
    }),
  );
  app.post(
    "/api/rooms/:room/liveview/stop",
    wrap((req, res) => {
      hub.stop(req.params.room, human(req));
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/rooms/:room/liveview/ask",
    wrap(async (req, res) => {
      limit(req, "frame-ai", 8);
      res.json(
        await askFrame(hub, ai, store, req.params.room, human(req), req.body),
      );
    }),
  );
  app.post(
    "/api/rooms/:room/liveview/capture",
    wrap((req, res) => {
      const a = human(req);
      if (a.role !== "host") throw new Fault("Host only", 403);
      const f = hub.rooms.get(req.params.room)?.latest;
      if (!f) throw new Fault("No camera frame", 409);
      res.attachment("alongside-capture.jpg").type("image/jpeg").send(f.jpeg);
    }),
  );
  app.post(
    "/mcp/:room",
    wrap(async (req, res) => {
      limit(req, "mcp", 180);
      const actor = auth(req);
      if (actor.kind !== "ai")
        throw new Fault(
          "Use a room-scoped agent token, not a human token.",
          403,
        );
      const mcp = mcpServer(store, req.params.room, actor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close();
        mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }),
  );
  app.all("/mcp/:room", (req, res) =>
    res.status(405).json({ error: "Stateless Streamable HTTP: use POST." }),
  );
  let vite;
  if (dev) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(resolve(root, "dist")));
    // The iPad home-screen app: same client, its own manifest/name/start URL.
    app.get(["/ipad", "/ipad/"], (req, res) => {
      const path = resolve(root, "dist/index.html");
      if (!existsSync(path))
        return res.status(503).send("Run npm run build, then npm start.");
      res.type("html").send(
        readFileSync(path, "utf8")
          .replace("/manifest.webmanifest", "/ipad.webmanifest")
          .replace(
            'name="apple-mobile-web-app-title" content="Alongside"',
            'name="apple-mobile-web-app-title" content="Alongside Live"',
          ),
      );
    });
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/"))
        return res.status(404).json({ error: "Not found" });
      const path = resolve(root, "dist/index.html");
      if (existsSync(path)) res.sendFile(path);
      else res.status(503).send("Run npm run build, then npm start.");
    });
  }
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    res.status(e.status || 400).json({
      error:
        e.name === "ZodError"
          ? "Invalid input: " + e.issues.map((x) => x.message).join("; ")
          : e.message || "Request failed",
    });
  });
  const server =
    process.env.HTTPS_KEY && process.env.HTTPS_CERT
      ? https.createServer(
          {
            key: readFileSync(process.env.HTTPS_KEY),
            cert: readFileSync(process.env.HTTPS_CERT),
          },
          app,
        )
      : http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.packet,
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      if (
        new URL(req.url, "http://localhost").pathname !== "/live" ||
        !safeHost(req.headers.host || "") ||
        !safeOrigin(req)
      )
        return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } catch {
      socket.destroy();
    }
  });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 4 * 1024 * 1024) {
        ws.close(1013, "Slow connection");
        return;
      }
      ws.send(JSON.stringify(data));
    }
  };
  const hub = new FrameHub(store, wss.clients, send);
  const peers = (room) =>
    [...wss.clients]
      .filter((ws) => ws.room === room && ws.actor)
      .map((ws) => ({
        id: ws.actor.id,
        name: ws.actor.name,
        color: ws.actor.color,
      }));
  const presence = (room) => {
    const list = [...new Map(peers(room).map((x) => [x.id, x])).values()];
    for (const ws of wss.clients)
      if (ws.room === room) send(ws, { type: "presence", members: list });
  };
  wss.on("connection", (ws) => {
    const timer = setTimeout(() => ws.close(1008, "Authenticate first"), 7000);
    let windowAt = Date.now(),
      count = 0;
    ws.on("message", (raw, isBinary) => {
      try {
        if (isBinary) {
          if (!ws.actor) throw new Fault("Authenticate first", 401);
          hub.publish(ws, raw);
          return;
        }
        if (raw.length > 256 * 1024) throw new Fault("Message too large", 413);
        if (Date.now() - windowAt > 1000) {
          windowAt = Date.now();
          count = 0;
        }
        if (++count > 70) throw new Fault("Too many events");
        const msg = JSON.parse(raw.toString());
        if (!ws.actor) {
          if (msg.type !== "auth") throw new Fault("Authenticate first");
          const a = store.auth(msg.room, msg.token);
          if (a.kind !== "human") throw new Fault("Agents use MCP");
          ws.room = store.room(msg.room).id;
          ws.actor = a;
          clearTimeout(timer);
          send(ws, { type: "state", state: store.snapshot(ws.room) });
          presence(ws.room);
          return;
        }
        if (hub.control(ws, msg)) return;
        if (msg.type === "preview") {
          store.assertCanWrite(ws.room, ws.actor);
          const annotation = annotationSchema.parse(msg.annotation);
          for (const other of wss.clients)
            if (other !== ws && other.room === ws.room)
              send(other, {
                type: "preview",
                ownerId: ws.actor.id,
                annotation: {
                  ...annotation,
                  ownerId: ws.actor.id,
                  ownerName: ws.actor.name,
                  source: "human",
                },
              });
        } else if (msg.type === "previewEnd") {
          for (const other of wss.clients)
            if (other.room === ws.room)
              send(other, { type: "previewEnd", ownerId: ws.actor.id });
        } else if (msg.type === "cursor") {
          const p = point.parse(msg.point);
          for (const other of wss.clients)
            if (other !== ws && other.room === ws.room)
              send(other, {
                type: "cursor",
                member: {
                  id: ws.actor.id,
                  name: ws.actor.name,
                  color: ws.actor.color,
                },
                point: p,
              });
        }
      } catch (e) {
        send(ws, { type: "error", error: e.message });
      }
    });
    ws.on("close", () => {
      hub.disconnect(ws);
      clearTimeout(timer);
      if (ws.room) {
        for (const other of wss.clients)
          if (other.room === ws.room)
            send(other, { type: "previewEnd", ownerId: ws.actor?.id });
        presence(ws.room);
      }
    });
    ws.on("error", () => {});
  });
  const broadcast = (room, state, event) => {
    hub.changed(room, state);
    for (const ws of wss.clients) {
      if (ws.room !== room) continue;
      // Cancel already-visible peer drafts immediately, including older clients.
      if (
        event?.type === "collaboration.writing" &&
        !state.collaborativeWriting
      )
        for (const member of state.members)
          if (member.role !== "host")
            send(ws, { type: "previewEnd", ownerId: member.id });
      send(ws, { type: "state", state, event });
    }
  };
  store.on("change", broadcast);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 25000);
  heartbeat.unref();
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
  });
  const close = async () => {
    hub.dispose();
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await vite?.close();
    await new Promise((done) => server.close(done));
  };
  return { app, server, store, ai, hub, pairCode, close };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, close, pairCode } = await createApp({
    dev: process.argv.includes("--dev"),
  });
  const port = Number(process.env.PORT || 4173);
  server.listen(port, "0.0.0.0", () =>
    console.log(
      `Alongside is ready on ${process.env.HTTPS_CERT ? "https" : "http"}://localhost:${port}. Use PUBLIC_ORIGIN for an HTTPS deployment.\n[Alongside] iPad app: open http://<this-PC-IP>:${port}/ipad, pairing code ${pairCode}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await close();
      process.exit(0);
    });
}
