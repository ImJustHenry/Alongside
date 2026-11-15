import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import Board from "./Board.jsx";
import XRView from "./XRView.jsx";
import LiveView from "./LiveView.jsx";
import QuestConnect, { fetchCurrent } from "./QuestConnect.jsx";

// /ipad is the iPad home-screen app: it pairs once and follows the Quest's room.
const IPAD = location.pathname.startsWith("/ipad");
import { COLORS, placed } from "../shared/model.js";

function stored() {
  try {
    return JSON.parse(sessionStorage.getItem("alongside-session") || "null");
  } catch {
    return null;
  }
}
function invitation() {
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    return { room: p.get("room") || "", invite: p.get("invite") || "" };
  } catch {
    return { room: "", invite: "" };
  }
}
function download(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function Brand() {
  return (
    <div className="brand">
      <span className="brandmark">
        <i />
        <i />
      </span>
      <span>
        alongside<span className="brand-period">.</span>
      </span>
    </div>
  );
}
const tools = [
  ["move", "↔", "Move"],
  ["pen", "✎", "Pen"],
  ["arrow", "↗", "Arrow"],
  ["circle", "◯", "Circle"],
  ["label", "T", "Text"],
  ["erase", "⌫", "Erase"],
];
export default function App() {
  const [session, setSession] = useState(stored),
    [state, setState] = useState(null),
    [connection, setConnection] = useState("connecting"),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [name, setName] = useState(""),
    [title, setTitle] = useState("Spatial learning lab"),
    [join, setJoin] = useState(invitation),
    [working, setWorking] = useState(false);
  const [tool, setTool] = useState("pen"),
    [color, setColor] = useState(COLORS[0]),
    [width, setWidth] = useState(4),
    [label, setLabel] = useState("Look here"),
    [view, setView] = useState(() => {
      const requested = new URLSearchParams(location.hash.slice(1)).get("view");
      if (IPAD && !requested) return "live";
      return ["live", "spatial"].includes(requested) ? requested : "board";
    }),
    [showAI, setShowAI] = useState(true);
  const [peers, setPeers] = useState([]),
    [previews, setPreviews] = useState({}),
    [cursors, setCursors] = useState({});
  const [modal, setModal] = useState(null),
    [inviteURL, setInviteURL] = useState(""),
    [qr, setQR] = useState(""),
    [aiStatus, setAIStatus] = useState({ provider: "demo", configured: false }),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [speak, setSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef(null);
  const [provider, setProvider] = useState("demo"),
    [model, setModel] = useState(""),
    [apiKey, setAPIKey] = useState(""),
    [agentName, setAgentName] = useState("My assistant"),
    [preferences, setPreferences] = useState(""),
    [consent, setConsent] = useState(false),
    [credential, setCredential] = useState(null);
  const socket = useRef(null),
    board = useRef(null),
    inputFile = useRef(null),
    latest = useRef({}),
    lastFeedback = useRef(0),
    lastSpoken = useRef(null),
    toastTimer = useRef(null),
    mounted = useRef(true);
  latest.current = { session, state, auto, busy, speak, aiStatus };
  const notify = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  };
  async function api(path, options = {}, useSession = session) {
    const response = await fetch("/api" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(useSession ? { Authorization: `Bearer ${useSession.token}` } : {}),
        ...options.headers,
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function remember(s) {
    setSession(s);
    try {
      if (s) sessionStorage.setItem("alongside-session", JSON.stringify(s));
      else sessionStorage.removeItem("alongside-session");
    } catch {}
  }
  async function enterRoom(isJoin) {
    setWorking(true);
    setError("");
    try {
      const data = await api(
        isJoin ? `/rooms/${join.room.toUpperCase()}/join` : "/rooms",
        {
          method: "POST",
          body: JSON.stringify(
            isJoin ? { name, invite: join.invite } : { name, title },
          ),
        },
        null,
      );
      const s = {
        roomId: data.room.id,
        member: data.member,
        token: data.token,
        invite: data.invite || join.invite,
      };
      remember(s);
      setState(data.room);
      setColor(data.member.color);
      history.replaceState(null, "", location.pathname);
      setAIStatus({ provider: "demo", configured: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  // Remove invitation secrets after joining, but retain the selected view so
  // reload/recovery returns to LiveView rather than silently showing the board.
  useEffect(() => {
    if (!session) return;
    history.replaceState(
      null,
      "",
      location.pathname +
        location.search +
        (view === "board" ? "" : "#view=" + view),
    );
  }, [session, view]);
  useEffect(() => {
    if (!session) return;
    let disposed = false,
      retry = null,
      attempt = 0;
    setConnection("connecting");
    api(`/rooms/${session.roomId}`)
      .then((s) => {
        if (!disposed) setState(s);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    api(`/rooms/${session.roomId}/ai`)
      .then(setAIStatus)
      .catch(() => {});
    function connect() {
      if (disposed) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`,
      );
      socket.current = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "auth",
            room: session.roomId,
            token: session.token,
          }),
        );
      };
      ws.onmessage = (e) => {
        if (disposed) return;
        const msg = JSON.parse(e.data);
        if (msg.type === "state") {
          attempt = 0;
          setConnection("online");
          setState(msg.state);
          const live = latest.current;
          if (
            msg.event?.type === "object.moved" &&
            live.auto &&
            !live.busy &&
            msg.state.aiEnabled &&
            Date.now() - lastFeedback.current > 4000
          ) {
            lastFeedback.current = Date.now();
            ask(
              "Give brief feedback on the latest tile placement and show the next step.",
            );
          }
        } else if (msg.type === "presence") setPeers(msg.members);
        else if (msg.type === "preview")
          setPreviews((p) => ({
            ...p,
            [msg.ownerId]: { annotation: msg.annotation, at: Date.now() },
          }));
        else if (msg.type === "previewEnd")
          setPreviews((p) => {
            const n = { ...p };
            delete n[msg.ownerId];
            return n;
          });
        else if (msg.type === "cursor")
          setCursors((p) => ({
            ...p,
            [msg.member.id]: { ...msg, at: Date.now() },
          }));
        else if (msg.type === "error") setError(msg.error);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnection("reconnecting");
        retry = setTimeout(connect, Math.min(10000, 700 * 2 ** attempt++));
      };
      ws.onerror = () => {};
    }
    connect();
    const sweep = setInterval(() => {
      setCursors((c) =>
        Object.fromEntries(
          Object.entries(c).filter(([, x]) => Date.now() - x.at < 1800),
        ),
      );
      setPreviews((c) =>
        Object.fromEntries(
          Object.entries(c).filter(([, x]) => Date.now() - x.at < 2000),
        ),
      );
    }, 1200);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(sweep);
      socket.current?.close();
    };
  }, [session?.token]);
  useEffect(() => {
    const m = state?.messages.filter((x) => x.source === "ai").at(-1);
    if (!m || lastSpoken.current === m.id) return;
    lastSpoken.current = m.id;
    if (speak && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(
        m.text.replace("[Scripted practice — not a live model] ", ""),
      );
      u.rate = 1;
      speechSynthesis.speak(u);
    }
  }, [state?.messages, speak]);
  useEffect(
    () => () => {
      mounted.current = false;
      clearTimeout(toastTimer.current);
    },
    [],
  );
  async function action(body) {
    try {
      setError("");
      await api(`/rooms/${session.roomId}/actions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (e) {
      setError(e.message);
    }
  }
  function signal(data) {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(data));
  }
  async function ask(text) {
    const live = latest.current;
    if (!live.session || live.busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${live.session.roomId}/ai/ask`,
        { method: "POST", body: JSON.stringify({ prompt: text }) },
        live.session,
      );
      const status = await api(
        `/rooms/${live.session.roomId}/ai`,
        {},
        live.session,
      );
      if (mounted.current) setAIStatus(status);
    } catch (e) {
      setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function share(rotate = false) {
    try {
      let token = session.invite;
      if (rotate || !token) {
        const d = await api(`/rooms/${session.roomId}/invite`, {
          method: "POST",
          body: "{}",
        });
        token = d.invite;
        remember({ ...session, invite: token });
      }
      const url =
        location.origin +
        location.pathname +
        "#" +
        new URLSearchParams({ room: session.roomId, invite: token });
      setInviteURL(url);
      setQR(
        await QRCode.toDataURL(url, {
          width: 250,
          margin: 1,
          color: { dark: "#244237", light: "#ffffff" },
        }),
      );
      setModal("invite");
    } catch (e) {
      setError(e.message);
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the text manually.");
    }
  }
  async function exportJSON() {
    try {
      const data = await api(`/rooms/${session.roomId}/export`);
      download(
        `alongside-${session.roomId}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
      notify("Board exported. Invitation tokens and API keys are excluded.");
    } catch (e) {
      setError(e.message);
    }
  }
  function exportPNG() {
    const c = board.current?.canvas;
    if (c)
      c.toBlob((b) => {
        if (b) {
          const u = URL.createObjectURL(b);
          const a = document.createElement("a");
          a.href = u;
          a.download = `alongside-${session.roomId}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(u), 2000);
        }
      });
  }
  async function importJSON(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("Import must be under 2 MB.");
      return;
    }
    if (
      !confirm(
        "Replace this board? Imported marks become yours; messages are cleared. Export a backup first.",
      )
    )
      return;
    try {
      const data = JSON.parse(await f.text());
      await api(`/rooms/${session.roomId}/import`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      notify("Board imported");
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveAI() {
    setWorking(true);
    setError("");
    try {
      if (provider !== "demo" && !isSecureContext)
        throw new Error(
          "Connect through trusted HTTPS before entering a live API key.",
        );
      const d = await api(`/rooms/${session.roomId}/ai`, {
        method: "PUT",
        body: JSON.stringify({
          provider,
          model,
          apiKey,
          name: agentName,
          instructions: preferences,
          consent,
        }),
      });
      setAIStatus(d);
      setAPIKey("");
      setModal(null);
      notify(
        provider === "demo"
          ? "Scripted practice guide ready"
          : "Assistant connected; live behavior still depends on your provider.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  async function mintAgent() {
    try {
      const d = await api(`/rooms/${session.roomId}/agents`, {
        method: "POST",
        body: JSON.stringify({ name: agentName }),
      });
      setCredential({ ...d, url: location.origin + d.mcpPath });
    } catch (e) {
      setError(e.message);
    }
  }
  async function disconnectAI() {
    try {
      await api(`/rooms/${session.roomId}/ai`, { method: "DELETE" });
      setAIStatus({ provider: "demo", configured: false });
      setAuto(false);
      notify("Assistant disconnected; key removed from server memory.");
    } catch (e) {
      setError(e.message);
    }
  }
  function startVoice() {
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(
        "Voice input is not supported in this browser. Type your question instead.",
      );
      return;
    }
    if (
      !confirm(
        "Use the browser speech-recognition service? Audio may be processed by your browser vendor. The transcript will be sent to your selected assistant.",
      )
    )
      return;
    const r = new Recognition();
    recognition.current = r;
    r.lang = navigator.language || "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      setError("Voice input: " + e.error + ". You can still type a question.");
    };
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setPrompt(text);
    };
    r.start();
  }
  function leave() {
    recognition.current?.abort();
    window.speechSynthesis?.cancel?.();
    remember(null);
    setState(null);
    setModal(null);
    setCredential(null);
    setError("");
    setAuto(false);
    setAIStatus({ provider: "demo", configured: false });
  }
  // iPad app: join the Quest's current room with the invite the server hands out.
  async function autoJoin(room, invite, who) {
    const data = await api(
      `/rooms/${room}/join`,
      { method: "POST", body: JSON.stringify({ name: who, invite }) },
      null,
    );
    remember({
      roomId: data.room.id,
      member: data.member,
      token: data.token,
      invite,
      pair: true,
    });
    setState(data.room);
    setColor(data.member.color);
    setView("live");
    setError("");
  }
  // iPad app: if the Quest restarts and hosts a new room, follow it.
  useEffect(() => {
    if (!IPAD || !session?.pair) return;
    let code = "";
    try {
      code = localStorage.getItem("alongside-pair") || "";
    } catch {}
    if (!code) return;
    const t = setInterval(async () => {
      try {
        const { status, data } = await fetchCurrent(code);
        if (status === 200 && data.room && data.room !== session.roomId) {
          notify(`The Quest opened a new room. Switching…`);
          leave();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [session?.roomId, session?.pair]);
  function parseJoin(value) {
    try {
      const u = new URL(value);
      const p = new URLSearchParams(u.hash.slice(1));
      setJoin({ room: p.get("room") || "", invite: p.get("invite") || "" });
    } catch {
      setJoin((j) => ({ ...j, room: value }));
    }
  }
  if (!session && IPAD)
    return <QuestConnect onJoin={autoJoin} brand={<Brand />} />;
  if (!session)
    return (
      <div className="landing">
        <header>
          <Brand />
          <span className="eyebrow">A SHARED SPACE FOR HUMAN + AI THOUGHT</span>
          <a
            href="https://github.com"
            onClick={(e) => {
              e.preventDefault();
              notify(
                "Source code and MIT license are included in your downloadable package.",
              );
            }}
          >
            Open source ↗
          </a>
        </header>
        <main className="landing-main">
          <section className="hero">
            <div className="pill">
              <span className="dot" /> BE HERE, TOGETHER
            </div>
            <h1>
              Think together.
              <br />
              <em>Draw beyond.</em>
            </h1>
            <p>
              Your people. Your AI. One shared space.
              <br />A canvas that connects a headset, a Pencil, and a new
              perspective.
            </p>
            <div className="hero-tags">
              <span>01 / Human collaboration</span>
              <span>02 / AI that can point</span>
              <span>03 / Spatial by design</span>
            </div>
            <div className="hero-art">
              <div className="art-note">
                ONE IDEA.
                <br />
                <em>More than one mind.</em>
              </div>
              <div className="art-tile one">01</div>
              <div className="art-tile two">02</div>
              <div className="art-tile three">03</div>
              <svg viewBox="0 0 500 100">
                <path
                  d="M40 70 Q180 -30 260 55 T460 35"
                  fill="none"
                  stroke="#b176a2"
                  strokeWidth="4"
                  strokeDasharray="9 8"
                />
                <path
                  d="m443 20 20 12-12 22"
                  fill="none"
                  stroke="#b176a2"
                  strokeWidth="4"
                />
              </svg>
              <span className="art-caption">
                SHARED CANVAS / CONCEPT ILLUSTRATION
              </span>
            </div>
          </section>
          <section className="welcome-card">
            <span className="eyebrow">YOUR NEXT GOOD IDEA STARTS HERE</span>
            <h2>Make room.</h2>
            <label>
              Your name
              <input
                autoComplete="given-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?"
                maxLength={48}
              />
            </label>
            <label>
              Workspace name
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={48}
              />
            </label>
            <button
              className="primary wide"
              disabled={!name.trim() || working}
              onClick={() => enterRoom(false)}
            >
              {working ? "Opening…" : "Create a workspace"} <span>↗</span>
            </button>
            <div className="divider">
              <span>or join your people</span>
            </div>
            <label>
              Invitation link or room code
              <input
                value={join.room}
                onChange={(e) => parseJoin(e.target.value)}
                placeholder="Paste a full invitation link"
              />
            </label>
            <label>
              Invitation secret
              <input
                type="password"
                value={join.invite}
                onChange={(e) =>
                  setJoin((j) => ({ ...j, invite: e.target.value }))
                }
                placeholder="Filled automatically from an invitation"
              />
            </label>
            <button
              className="secondary wide"
              disabled={!name.trim() || !join.room || !join.invite || working}
              onClick={() => enterRoom(true)}
            >
              Join workspace →
            </button>
            <p className="fine">
              Invitations are access credentials. Share only with people you
              trust. The practice guide works without an AI key; it is
              explicitly scripted.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </main>
        <footer>
          ALONGSIDE / PROTOTYPE 0.1{" "}
          <span>
            Built for the moment an explanation becomes something you can see.
          </span>
        </footer>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  if (!state)
    return (
      <div className="loading">
        <Brand />
        <h2>Opening your shared space…</h2>
        {error && <p className="error">{error}</p>}
        <button onClick={leave}>Back to start</button>
      </div>
    );
  const host = session.member.role === "host",
    collaborativeWriting = state.collaborativeWriting !== false,
    canWrite = host || collaborativeWriting,
    progress = state.objects.filter(placed).length,
    lastGuidance = state.messages.filter((m) => m.source === "ai").at(-1)?.text;
  // iPad app: the live view is the whole app (full-screen camera, floating tools).
  if (IPAD && view === "live")
    return (
      <div className="ipad-app">
        <LiveView
          immersive
          session={session}
          state={state}
          api={api}
          onError={setError}
          peers={peers}
          onLeave={leave}
          onOpenWorkspace={() => setView("board")}
        />
        {error && (
          <div className="lv-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  return (
    <div className="workspace">
      <aside className="left-rail">
        <Brand />
        <div className="workspace-label">YOUR WORKSPACE</div>
        <h3>{state.title}</h3>
        <div className="room-tag">
          ROOM {state.id}{" "}
          <span className={"dot " + (connection === "online" ? "" : "amber")} />
        </div>
        <nav>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            <span>▦</span> Shared canvas
          </button>
          <button
            className={view === "spatial" ? "active" : ""}
            onClick={() => setView("spatial")}
          >
            <span>◇</span> Spatial view
          </button>
          <button
            className={view === "live" ? "active" : ""}
            onClick={() => setView("live")}
          >
            <span>◉</span> Live camera
          </button>
          <button
            onClick={() => {
              setCredential(null);
              setModal("ai");
            }}
          >
            <span>✳</span> AI connections
          </button>
          <button onClick={() => share()}>
            <span>↗</span> Invite people
          </button>
        </nav>
        <div className="rail-section">
          <span className="eyebrow">IN THE ROOM</span>
          {peers.map((p) => (
            <div className="person" key={p.id}>
              <span className="avatar" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                {p.name}
                {p.id === session.member.id && <small>you</small>}
              </span>
              <i className="dot" />
            </div>
          ))}
          {state.agents
            .filter((a) => a.active && a.expires > Date.now())
            .map((a) => (
              <div className="person" key={a.id}>
                <span className="avatar ai">✳</span>
                <span>
                  {a.name}
                  <small>authorized agent</small>
                </span>
              </div>
            ))}
        </div>
        <div className="rail-bottom">
          <div className="connection">
            <i className={"dot " + (connection === "online" ? "" : "amber")} />
            {connection === "online" ? "Live session" : connection}
          </div>
          <button className="text-button" onClick={leave}>
            Leave workspace ↗
          </button>
          <span className="fine">v0.1 · MIT open source</span>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              STUDIO / {view === "board" ? "SHARED CANVAS" : "SPATIAL VIEW"}
            </span>
            <h2>A little more perspective.</h2>
          </div>
          <div className="top-actions">
            <button onClick={exportJSON}>Export JSON ↓</button>
            <button className="primary" onClick={() => share()}>
              Invite +
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        <div
          className={"work-columns " + (view === "live" ? "live-columns" : "")}
        >
          <main className="canvas-column">
            {view === "live" ? (
              <LiveView
                session={session}
                state={state}
                api={api}
                onError={setError}
              />
            ) : (
              <>
                <div className="board-heading">
                  <div>
                    <span className="pill mini">LIVE WORKSPACE</span>
                    <h3>Three tiles. One shared understanding.</h3>
                  </div>
                  <span className="revision">
                    REV {String(state.revision).padStart(3, "0")}
                  </span>
                </div>
                <div
                  className={
                    "collaborative-control " +
                    (collaborativeWriting ? "" : "writing-locked")
                  }
                >
                  <label className="writing-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Collaborative writing"
                      checked={collaborativeWriting}
                      disabled={!host || connection !== "online"}
                      onChange={(e) =>
                        action({
                          type: "collaborativeWriting",
                          value: e.target.checked,
                        })
                      }
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <strong>Collaborative writing</strong>
                    <span className="writing-state">
                      {collaborativeWriting ? "ON" : "OFF"}
                    </span>
                  </label>
                  <small role="status">
                    {collaborativeWriting
                      ? "People and authorized AI can edit. Host controls this switch."
                      : host
                        ? "Host-only editing. Others can view and provide guidance."
                        : "Read-only board. You can still view, ask questions, and export."}
                  </small>
                </div>
                <div
                  className="toolbar"
                  role="toolbar"
                  aria-label="Drawing tools"
                >
                  {tools.map(([id, icon, text]) => (
                    <button
                      key={id}
                      className={tool === id ? "selected" : ""}
                      title={
                        canWrite
                          ? text
                          : "Only the host can edit while collaborative writing is off"
                      }
                      aria-label={text}
                      disabled={!canWrite || connection !== "online"}
                      onClick={() => setTool(id)}
                    >
                      <b>{icon}</b>
                      <span>{text}</span>
                    </button>
                  ))}
                  <div className="tool-separator" />
                  {COLORS.map((c) => (
                    <button
                      className={"swatch " + (c === color ? "chosen" : "")}
                      key={c}
                      aria-label={`Ink ${c}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                  <button
                    onClick={() => action({ type: "undo" })}
                    title="Undo your last mark"
                    disabled={!canWrite || connection !== "online"}
                    aria-label="Undo"
                  >
                    ↶
                  </button>
                </div>
                <div className="tool-settings">
                  {tool === "label" ? (
                    <label>
                      Label
                      <input
                        value={label}
                        maxLength={240}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </label>
                  ) : (
                    <label>
                      Stroke
                      <input
                        aria-label="Stroke width"
                        type="range"
                        min="1"
                        max="12"
                        value={width}
                        onChange={(e) => setWidth(Number(e.target.value))}
                      />
                      <span>{width}px</span>
                    </label>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={showAI}
                      onChange={(e) => setShowAI(e.target.checked)}
                    />{" "}
                    AI layer
                  </label>
                </div>
                <div
                  className={
                    "board-shell " +
                    (connection !== "online" ? "not-connected" : "")
                  }
                >
                  <div className={view === "spatial" ? "canvas-hidden" : ""}>
                    <Board
                      ref={board}
                      state={state}
                      member={session.member}
                      tool={tool}
                      color={color}
                      width={width}
                      label={label}
                      showAI={showAI}
                      onAction={action}
                      onSignal={signal}
                      previews={previews}
                      cursors={cursors}
                      disabled={connection !== "online" || !canWrite}
                    />
                  </div>
                  {view === "spatial" && (
                    <XRView
                      board={board}
                      onTool={setTool}
                      onUndo={() => canWrite && action({ type: "undo" })}
                      onAsk={ask}
                      guidance={
                        collaborativeWriting
                          ? lastGuidance
                          : "Collaborative writing OFF: only the host can edit. " +
                            (lastGuidance ||
                              "Viewing and guidance remain available.")
                      }
                    />
                  )}
                </div>
                <div className="canvas-bottom">
                  <span>
                    ✦{" "}
                    {tool === "move"
                      ? "Drag a tile onto its matching outline."
                      : tool === "label"
                        ? "Set your label, then tap the canvas."
                        : "Draw with Pencil, touch, or mouse. Everyone sees the same marks."}
                  </span>
                  <button className="text-button" onClick={exportPNG}>
                    Snapshot PNG ↓
                  </button>
                </div>
                <div className="progress-card">
                  <div>
                    <span className="eyebrow">SHARED EXERCISE</span>
                    <h3>
                      {progress === 3
                        ? "That’s the shape of teamwork."
                        : "Find the next connection."}
                    </h3>
                    <p>
                      {progress} of 3 tiles aligned. Ask your assistant to
                      explain or point out the next step.
                    </p>
                  </div>
                  <div className="progress-dots">
                    {state.objects.map((o) => (
                      <span key={o.id} className={placed(o) ? "complete" : ""}>
                        {placed(o) ? "✓" : o.glyph}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="board-management">
                  <button
                    className="text-button"
                    onClick={() => action({ type: "clearMine" })}
                    disabled={!canWrite || connection !== "online"}
                  >
                    Clear my marks
                  </button>
                  {host && (
                    <>
                      <button
                        className="text-button"
                        onClick={() => inputFile.current.click()}
                      >
                        Import board
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          if (
                            confirm(
                              "Reset all tiles, annotations, and messages?",
                            )
                          )
                            action({ type: "reset" });
                        }}
                      >
                        Reset exercise
                      </button>
                    </>
                  )}
                  <input
                    ref={inputFile}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={importJSON}
                  />
                </div>
              </>
            )}
          </main>
          {view !== "live" && (
            <aside className="assistant-panel">
              <div className="assistant-title">
                <span className="avatar ai large">✳</span>
                <div>
                  <span className="eyebrow">ANOTHER PERSPECTIVE</span>
                  <h3>{aiStatus.name || "Practice guide"}</h3>
                </div>
              </div>
              <div className="provider-badge">
                {aiStatus.provider === "demo"
                  ? "SCRIPTED PRACTICE · NO LIVE MODEL"
                  : `${aiStatus.provider.toUpperCase()} · YOUR CONNECTION`}
              </div>
              <p className="assistant-intro">
                Not just an answer.
                <br />
                Something you can point to.
              </p>
              <button
                className="ask-next"
                disabled={busy || !state.aiEnabled}
                onClick={() =>
                  ask("Show me the next step and explain it briefly.")
                }
              >
                {busy ? "Working on your board…" : "Show me the next step ↗"}
              </button>
              <div className="agent-controls">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => setAuto(e.target.checked)}
                  />{" "}
                  Feedback after tile moves
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={speak}
                    onChange={(e) => {
                      setSpeak(e.target.checked);
                      if (!e.target.checked) window.speechSynthesis?.cancel();
                    }}
                  />{" "}
                  Read guidance aloud
                </label>
                {host && (
                  <button
                    className="text-button"
                    onClick={() =>
                      action({ type: "aiEnabled", value: !state.aiEnabled })
                    }
                  >
                    {state.aiEnabled
                      ? "Pause all AI access"
                      : "Resume AI access"}
                  </button>
                )}
              </div>
              {!state.aiEnabled && (
                <div className="paused">
                  AI access paused by host. Reading and drawing are blocked.
                </div>
              )}
              <div className="messages" aria-live="polite">
                {!state.messages.length && (
                  <div className="empty-message">
                    <span>↗</span>
                    <p>
                      Invite a thought.
                      <br />
                      Then watch it take shape.
                    </p>
                  </div>
                )}
                {state.messages.slice(-20).map((m) => (
                  <div
                    className={
                      "message " + (m.source === "ai" ? "from-ai" : "")
                    }
                    key={m.id}
                  >
                    <div>
                      <b>{m.author}</b>
                      <time>
                        {new Date(m.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{m.text}</p>
                  </div>
                ))}
              </div>
              <form
                className="prompt-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (prompt.trim()) {
                    ask(prompt.trim());
                    setPrompt("");
                  }
                }}
              >
                <label className="sr-only" htmlFor="prompt">
                  Ask your assistant
                </label>
                <textarea
                  id="prompt"
                  value={prompt}
                  maxLength={2000}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    aiStatus.provider === "demo"
                      ? "Practice mode gives the next tile instruction. Connect a model for open-ended questions."
                      : "Ask, explain, or point something out…"
                  }
                />
                <div className="prompt-actions">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !state.aiEnabled ||
                      !(
                        window.SpeechRecognition ||
                        window.webkitSpeechRecognition
                      )
                    }
                    onClick={() =>
                      listening ? recognition.current?.stop() : startVoice()
                    }
                  >
                    {listening ? "Stop listening" : "Voice input"}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !state.aiEnabled || !prompt.trim()}
                  >
                    Send ↗
                  </button>
                </div>
              </form>
              <button
                className="text-button connect-link"
                onClick={() => {
                  setCredential(null);
                  setModal("ai");
                }}
              >
                Connect your own assistant →
              </button>
            </aside>
          )}
        </div>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setModal(null);
            setAPIKey("");
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "invite" ? "Invite collaborators" : "AI connections"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => {
                setModal(null);
                setAPIKey("");
              }}
            >
              ×
            </button>
            {modal === "invite" ? (
              <>
                <span className="eyebrow">GOOD IDEAS NEED COMPANY</span>
                <h2>Bring someone alongside.</h2>
                <p>
                  Open this invitation on an iPad, laptop, phone, or Quest. Room
                  code alone does not grant access.
                </p>
                {qr && (
                  <img
                    className="qr"
                    src={qr}
                    alt="QR code for this private room invitation"
                  />
                )}
                <label>
                  Invitation URL
                  <textarea readOnly value={inviteURL} />
                </label>
                <button
                  className="primary wide"
                  onClick={() => copy(inviteURL)}
                >
                  Copy invitation
                </button>
                {host && (
                  <button className="text-button" onClick={() => share(true)}>
                    Replace invitation secret
                  </button>
                )}
                <p className="fine">
                  Replacing the invitation prevents new joins through the old
                  link. It does not remove existing members. On a headset, use a
                  trusted HTTPS deployment—not a laptop localhost URL.
                </p>
              </>
            ) : (
              <>
                <span className="eyebrow">BRING YOUR OWN PERSPECTIVE</span>
                <h2>Your AI, in the room.</h2>
                <p>
                  Two options: connect a provider through this server, or give
                  your existing agent a scoped MCP connection. No private
                  assistant history is imported.
                </p>
                <div className="ai-config">
                  <label>
                    Provider
                    <select
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value);
                        setAPIKey("");
                        setModel("");
                      }}
                    >
                      <option value="demo">
                        Scripted practice (no AI key)
                      </option>
                      <option value="openai">OpenAI Responses API</option>
                      <option value="anthropic">Anthropic Messages API</option>
                    </select>
                  </label>
                  {provider !== "demo" && (
                    <>
                      <label>
                        Model ID
                        <input
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder="Exact model ID enabled for your account"
                        />
                      </label>
                      <label>
                        API key
                        <input
                          type="password"
                          autoComplete="off"
                          value={apiKey}
                          onChange={(e) => setAPIKey(e.target.value)}
                          placeholder="Kept in server memory only"
                        />
                      </label>
                      <p className="fine">
                        Only use a server you trust. Your key is sent to its
                        operator and your provider receives the shared board
                        context. Billing is through your API account, not a chat
                        subscription.
                      </p>
                    </>
                  )}
                  <label>
                    Assistant name
                    <input
                      value={agentName}
                      maxLength={48}
                      onChange={(e) => setAgentName(e.target.value)}
                    />
                  </label>
                  <label>
                    Coaching preference
                    <textarea
                      value={preferences}
                      maxLength={2000}
                      onChange={(e) => setPreferences(e.target.value)}
                      placeholder="Explain briefly; show me rather than only telling me."
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />{" "}
                    Allow this assistant to read the shared room and add
                    reversible annotations.
                  </label>
                  <button
                    className="primary wide"
                    disabled={!consent || working}
                    onClick={saveAI}
                  >
                    Connect assistant
                  </button>
                  {aiStatus.configured && (
                    <button className="text-button" onClick={disconnectAI}>
                      Disconnect current assistant
                    </button>
                  )}
                </div>
                <div className="mcp-section">
                  <span className="eyebrow">EXTERNAL AGENT / MCP</span>
                  <p>
                    Your application is the MCP server. Give this endpoint and
                    bearer token to a compatible agent client. The agent must
                    run its own observation loop.
                  </p>
                  <button className="secondary wide" onClick={mintAgent}>
                    Create 8-hour agent token
                  </button>
                  {credential && (
                    <>
                      <label>
                        Endpoint
                        <input readOnly value={credential.url} />
                      </label>
                      <label>
                        Bearer token
                        <input readOnly value={credential.token} />
                      </label>
                      <button
                        className="text-button"
                        onClick={() =>
                          copy(
                            JSON.stringify(
                              {
                                url: credential.url,
                                headers: {
                                  Authorization: `Bearer ${credential.token}`,
                                },
                              },
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        Copy connection details
                      </button>
                      <p className="fine">
                        Save this token now. It is shown only here. Do not put
                        it in a public repository.
                      </p>
                    </>
                  )}
                  {state.agents
                    .filter(
                      (a) =>
                        a.active && (host || a.ownerId === session.member.id),
                    )
                    .map((a) => (
                      <div className="agent-row" key={a.id}>
                        <span>{a.name}</span>
                        <button
                          onClick={async () => {
                            try {
                              await api(
                                `/rooms/${session.roomId}/agents/${a.id}`,
                                { method: "DELETE" },
                              );
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                </div>
                <p className="fine">
                  Shizuku is not connected: no verified developer API was
                  available for this build. A supported Shizuku agent could use
                  this MCP interface. Connecting it is not simulated.
                </p>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
