// Steuert einen echten Browser (Edge oder Chrome) ohne Zusatzpaket über das DevTools-Protokoll (Baustein H6).
// Pfad selbst festlegen: BROWSER_PATH in der .env. Auf dem Server später z. B. /usr/bin/chromium.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
export const browserPath = () => CANDIDATES.find(p => existsSync(p)) || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Startet den Browser, gibt eine Seite mit cmd()/on() an fn und räumt danach immer auf */
export async function withBrowser(fn) {
  const exe = browserPath(); if (!exe) throw new Error("Kein Browser gefunden (Edge oder Chrome) – BROWSER_PATH in der .env setzen.");
  const prof = await mkdtemp(path.join(os.tmpdir(), "reeder-pruef-")), port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let targets;
    for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === "page")) break; } catch {} await sleep(250); }
    const page = targets?.find(t => t.type === "page"); if (!page) throw new Error("Browser hat nicht gestartet.");
    ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("Keine Verbindung zum Browser.")); });
    let id = 0; const wait = new Map(), listeners = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.no(new Error(m.error.message)) : w.ok(m.result); }
      else if (m.method) for (const f of listeners.get(m.method) || []) f(m.params);
    };
    const cmd = (method, params = {}) => new Promise((ok, no) => { const i = ++id; wait.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (wait.has(i)) { wait.delete(i); no(new Error("Zeitüberschreitung: " + method)); } }, 30000); });
    const on = (method, f) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(f); return () => listeners.set(method, listeners.get(method).filter(x => x !== f)); };
    await cmd("Page.enable"); await cmd("Runtime.enable"); await cmd("Network.enable");
    return await fn({ cmd, on, sleep });
  } finally {
    try { ws?.close(); } catch {}
    proc.kill();
    await sleep(300); await rm(prof, { recursive: true, force: true }).catch(() => {});
  }
}

/** Öffnet eine Adresse in einer Gerätebreite und sammelt Fehler, Anfragen und Ladezeit */
export async function loadPage({ cmd, on, sleep }, url, device) {
  const errors = [], requests = new Map(), t0 = Date.now();
  const off = [
    on("Runtime.exceptionThrown", p => errors.push({ type: "exception", text: String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Fehler").split("\n")[0].slice(0, 200) })),
    on("Runtime.consoleAPICalled", p => { if (p.type === "error") errors.push({ type: "console", text: (p.args || []).map(a => a.value ?? a.description ?? "").join(" ").slice(0, 200) }); }),
    on("Network.requestWillBeSent", p => { if (!requests.has(p.requestId)) requests.set(p.requestId, { url: p.request.url, type: p.type, bytes: 0 }); }),
    on("Network.responseReceived", p => requests.set(p.requestId, { url: p.response.url, status: p.response.status, type: p.type, bytes: 0 })),
    on("Network.loadingFinished", p => { const r = requests.get(p.requestId); if (r) r.bytes = p.encodedDataLength || 0; }),
    on("Network.loadingFailed", p => { const r = requests.get(p.requestId) || { url: "", type: p.type }; requests.set(p.requestId, { ...r, failed: /ORB|CORB/.test(p.errorText) ? "nicht vorhanden oder falscher Dateityp" : p.errorText }); }),
  ];
  await cmd("Emulation.setDeviceMetricsOverride", { width: device.w, height: device.h, deviceScaleFactor: 1, mobile: !!device.mobile });
  await cmd("Emulation.setTouchEmulationEnabled", { enabled: !!device.mobile });
  let loaded = false; const offLoad = on("Page.loadEventFired", () => { loaded = true; });
  await cmd("Page.navigate", { url });
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100);
  await sleep(700);                                              // Schriften, späte Skripte
  offLoad(); off.forEach(f => f());
  return { errors, requests: [...requests.values()], loadMs: Date.now() - t0, timedOut: !loaded };
}
