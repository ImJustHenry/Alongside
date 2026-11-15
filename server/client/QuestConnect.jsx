import React, { useEffect, useRef, useState } from "react";
import { nativeApp } from "./LiveView.jsx";

// iPad home-screen app (/ipad): pair once with the server's 6-digit code, then
// automatically join whatever room the Quest headset is currently hosting.
const read = (k, d = "") => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {}
};

export async function fetchCurrent(code) {
  const r = await fetch("/api/live/current", {
    headers: { "X-Pair-Code": code },
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

export default function QuestConnect({ onJoin, brand }) {
  const fromUrl = new URLSearchParams(location.search).get("pair") || "";
  const [code, setCode] = useState(
    () => (/^\d{6}$/.test(fromUrl) ? fromUrl : "") || read("alongside-pair"),
  );
  const [draft, setDraft] = useState(code);
  const [name, setName] = useState(() => read("alongside-name", "iPad"));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    if (!code) return;
    write("alongside-pair", code);
    let stop = false,
      timer = null;
    async function tick() {
      if (stop || busy.current) return;
      busy.current = true;
      try {
        const { status: s, data } = await fetchCurrent(code);
        if (s === 403) {
          write("alongside-pair", "");
          setCode("");
          setError("That pairing code didn't match. Check the server window.");
          return;
        }
        if (s === 200 && data.room) {
          setStatus(`Joining ${data.host || "the Quest"}'s view…`);
          await onJoin(data.room, data.invite, name.trim() || "iPad");
          return;
        }
        setStatus(
          data.error ||
            "Waiting for the Quest… open Alongside LiveView in the headset.",
        );
      } catch {
        setStatus(
          "Can't reach the Alongside server. Is the iPad on the same Wi-Fi?",
        );
      } finally {
        busy.current = false;
      }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code]);

  return (
    <div className="qc">
      <main className="qc-card">
        <div className="qc-brand">{brand}</div>
        {code ? (
          <>
            <div className="qc-radar" aria-hidden="true">
              <span />
              <span />
              <i />
            </div>
            <h1>Connecting to the Quest</h1>
            <p className="qc-status" aria-live="polite">
              {status || "Looking for the Quest…"}
            </p>
            <button
              className="qc-link"
              onClick={() => {
                write("alongside-pair", "");
                setDraft("");
                setCode("");
                setStatus("");
              }}
            >
              Use a different pairing code
            </button>
          </>
        ) : (
          <>
            <h1>Pair this iPad</h1>
            <p className="qc-sub">
              See what the Quest wearer sees, and draw straight into their
              space.
            </p>
            <label className="qc-field">
              <span>Your name</span>
              <input
                value={name}
                maxLength={48}
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value);
                  write("alongside-name", e.target.value.trim());
                }}
              />
            </label>
            <label className="qc-field">
              <span>Pairing code</span>
              <input
                className="qc-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && /^\d{6}$/.test(draft)) {
                    setError("");
                    setCode(draft);
                  }
                }}
                placeholder="••••••"
              />
            </label>
            <p className="qc-hint">
              The 6-digit code is shown in the server window.
            </p>
            <button
              className="qc-primary"
              disabled={!/^\d{6}$/.test(draft)}
              onClick={() => {
                setError("");
                setCode(draft);
              }}
            >
              Pair
            </button>
          </>
        )}
        {nativeApp() && (
          <button
            className="qc-link"
            onClick={() => nativeApp().postMessage({ action: "server" })}
          >
            Change server
          </button>
        )}
        {error && (
          <p role="alert" className="qc-error">
            {error}
          </p>
        )}
        <p className="qc-fine">
          You only pair once. After that, opening this app joins the room the
          Quest is hosting, even after the headset app restarts.
        </p>
      </main>
    </div>
  );
}
