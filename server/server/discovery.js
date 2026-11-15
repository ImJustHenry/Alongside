// Lets the iPad app find this server without typing an IP:
//  - Bonjour/mDNS: advertises `_alongside._tcp` with the server's URLs in the TXT record.
//  - Optional public HTTPS tunnel (`--tunnel`, needs `cloudflared`) for people far away.
//  - An `alongside-live://connect?...` app link (printed as a QR) that sets the server
//    and pairing code in one tap.
import os from "node:os";
import { spawn } from "node:child_process";

/** Shared, live view of how to reach this server. */
export const network = { port: 4173, lan: [], public: null };

/** Non-internal IPv4 addresses, Windows hotspot (192.168.137.1) first. */
export function lanAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (
        a.family === "IPv4" &&
        !a.internal &&
        !a.address.startsWith("169.254.")
      )
        found.push(a.address);
  const rank = (ip) =>
    ip === "192.168.137.1"
      ? 0
      : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
        ? 1
        : 2;
  return [...new Set(found)].sort((a, b) => rank(a) - rank(b));
}

export function refreshLan(port = network.port) {
  network.port = port;
  network.lan = lanAddresses().map((ip) => `http://${ip}:${port}`);
  return network.lan;
}

/** Every URL a client could try, local network first. */
export function allUrls() {
  return [...network.lan, ...(network.public ? [network.public] : [])];
}

/** Link that opens the native iPad app connected (and, with a code, paired). */
export function appLink(pairCode, urls = allUrls()) {
  const q = new URLSearchParams();
  for (const u of urls) q.append("server", u);
  if (pairCode) q.set("pair", pairCode);
  return `alongside-live://connect?${q}`;
}

/** Advertise over Bonjour. Returns { refresh(), stop() }; never throws. */
export async function advertise({ port, onError = () => {} }) {
  let bonjour, service;
  try {
    const { Bonjour } = await import("bonjour-service");
    bonjour = new Bonjour({}, (e) => onError(e));
  } catch (e) {
    onError(e);
    return { refresh() {}, stop() {} };
  }
  const name = `Alongside on ${os.hostname().replace(/\.local$/, "")}`.slice(
    0,
    63,
  );
  const publish = () => {
    // TXT strings are limited to 255 bytes each; keep the list short.
    const txt = {
      v: "1",
      path: "/ipad",
      urls: allUrls().join(",").slice(0, 240),
    };
    if (network.public) txt.public = network.public;
    try {
      service = bonjour.publish({
        name,
        type: "alongside",
        port,
        txt,
        probe: false,
        disableIPv6: true,
      });
      service.on?.("error", onError);
    } catch (e) {
      onError(e);
    }
  };
  publish();
  return {
    refresh() {
      if (!service) return publish();
      const old = service;
      service = null;
      old.stop?.(() => publish());
    },
    stop() {
      try {
        bonjour.unpublishAll(() => bonjour.destroy());
      } catch {}
    },
  };
}

/**
 * Starts a Cloudflare quick tunnel to this server and calls onUrl with its HTTPS origin.
 * Needs `cloudflared` on PATH (Windows: `winget install Cloudflare.cloudflared`,
 * macOS: `brew install cloudflared`). The address changes every time it restarts.
 */
export function startTunnel({ port, onUrl, onError = () => {} }) {
  let child;
  try {
    child = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (e) {
    onError(e);
    return { stop() {} };
  }
  let announced = false;
  const scan = (chunk) => {
    const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !announced) {
      announced = true;
      onUrl(m[0]);
    }
  };
  child.stdout.on("data", scan);
  child.stderr.on("data", scan);
  child.on("error", onError);
  child.on("exit", (code) => {
    if (!announced)
      onError(new Error(`cloudflared exited (${code}) before giving a URL`));
  });
  return { stop: () => child.kill() };
}
