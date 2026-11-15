import React, { useEffect, useRef, useState } from "react";

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
        setStatus("Can't reach the Alongside server. Is the iPad on the same Wi-Fi?");
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
    <div className="landing quest-connect">
      <header>{brand}</header>
      <main className="landing-main">
        <section className="welcome-card">
          <span className="eyebrow">ALONGSIDE LIVEVIEW · IPAD</span>
          <h2>{code ? "Connecting to the Quest" : "Pair this iPad"}</h2>
          {code ? (
            <>
              <p className="connect-status" aria-live="polite">
                <span className="dot" /> {status || "Looking for the Quest…"}
              </p>
              <button
                className="secondary wide"
                onClick={() => {
                  write("alongside-pair", "");
                  setDraft("");
                  setCode("");
                  setStatus("");
                }}
              >
                Change pairing code
              </button>
            </>
          ) : (
            <>
              <label>
                Your name
                <input
                  value={name}
                  maxLength={48}
                  onChange={(e) => {
                    setName(e.target.value);
                    write("alongside-name", e.target.value.trim());
                  }}
                />
              </label>
              <label>
                Pairing code (shown in the server window)
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 digits"
                />
              </label>
              <button
                className="primary wide"
                disabled={!/^\d{6}$/.test(draft)}
                onClick={() => {
                  setError("");
                  setCode(draft);
                }}
              >
                Pair <span>↗</span>
              </button>
            </>
          )}
          <p className="fine">
            You only pair once. After that, opening this app always joins the
            room the Quest is hosting, even after the headset app restarts.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
