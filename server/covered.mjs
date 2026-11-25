/* Covered-Anbindung: meldet Termine, Anfragen, Kundennachrichten und Briefings an Nova (Covered-App).
   Grundsatz: Das Board hängt nie an Covered. Ist Covered nicht erreichbar, läuft alles weiter;
   nicht übertragene Einträge werden bei der nächsten Runde der Automatik (jede Minute) nachgeholt.
   Abgleich statt Einzel-Hooks: jede Runde vergleicht den Stand im Board mit dem, was schon gemeldet wurde
   (Tabelle covered_sync, gleiche ID = Covered aktualisiert statt verdoppelt). */
import { createHash } from "node:crypto";
import { db, getSetting, setSetting } from "./db.mjs";
import { formatDe } from "./slots.mjs";

db.exec(`CREATE TABLE IF NOT EXISTS covered_sync (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL, ref_id INTEGER, start TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')), error TEXT
);`);

const TYPE_LABEL = { erstgespraech: "Erstgespräch", workshop: "Workshop", abstimmung: "Abstimmung", feedback: "Feedback-Termin", rueckfrage: "Rückfrage", schulung: "Schulung" };
const hashOf = o => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 24);
const sqlTime = iso => iso.replace("T", " ").slice(0, 19);
const short = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createCovered({ json, readJson, SITE_URL }) {
  const base = () => (process.env.COVERED_API_URL || "").trim().replace(/\/+$/, "");
  const key = () => (process.env.COVERED_API_KEY || "").trim();
  const configured = () => !!(base() && key()) && !process.env.COVERED_DISABLED;
  const cfg = () => getSetting("covered", { enabled: true, since: null });
  const state = { lastOk: null, lastError: null, lastRun: null, pausedUntil: 0, sentLastRun: 0 };

  /* ---------- HTTP mit kurzem Zeitlimit und einem Wiederholversuch ---------- */
  async function call(method, path, body) {
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(base() + path, {
          method, signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", Accept: "application/json" },
          body: body ? JSON.stringify(body) : undefined
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) return { ok: true, status: r.status, data };
        last = { ok: false, status: r.status, error: data.error || `HTTP ${r.status}` };
        if (r.status < 500 && r.status !== 429) return last;   // 400/401/403: Wiederholen bringt nichts
      } catch (e) { last = { ok: false, status: 0, error: e.name === "TimeoutError" ? "Zeitüberschreitung" : "nicht erreichbar" }; }
      if (attempt === 0) await sleep(1500);
    }
    return last;
  }

  /* ---------- Was gemeldet werden soll ---------- */
  function desired(since) {
    const out = [], nowIso = new Date().toISOString(), since_ = sqlTime(since);

    // Termine: alle kommenden (auch von vor der Aktivierung) – landen in Vincents Kalender
    for (const a of db.prepare(`SELECT a.*, c.company, c.name AS cname, p.title AS ptitle FROM appointments a JOIN clients c ON c.id = a.client_id
        LEFT JOIN projects p ON p.id = a.project_id WHERE a.start > ? ORDER BY a.start LIMIT 300`).all(new Date(Date.now() - 3600e3).toISOString())) {
      const title = a.company && !a.title.includes(a.company) ? `${a.title} – ${a.company}` : a.title;
      const text = [a.cname && `Mit ${a.cname}${a.company ? ` (${a.company})` : ""}`, a.ptitle && `Projekt: ${a.ptitle}`, a.summary && short(a.summary, 1500)].filter(Boolean).join("\n");
      const ev = { id: `appt-${a.id}`, type: "appointment", title: short(title, 200), text: text || undefined, startsAt: a.start, minutes: a.minutes || 30, location: a.video_url || undefined, url: a.video_url || undefined };
      out.push({ key: ev.id, kind: "appointment", ref: a.id, start: a.start, ev });
    }

    // Briefing nach dem Termin: Zusammenfassung und nächste Schritte (Termine ab 3 Tage vor der Einrichtung)
    for (const a of db.prepare(`SELECT a.*, c.company FROM appointments a JOIN clients c ON c.id = a.client_id
        WHERE a.start <= ? AND a.start >= ? AND (COALESCE(a.summary,'') <> '' OR COALESCE(a.next_steps,'') <> '')`).all(nowIso, new Date(Date.parse(since) - 3 * 864e5).toISOString())) {
      const text = [a.summary && `Zusammenfassung:\n${a.summary}`, a.next_steps && `Nächste Schritte:\n${a.next_steps}`].filter(Boolean).join("\n\n");
      out.push({ key: `brief-${a.id}`, kind: "briefing", ref: a.id, ev: { id: `brief-${a.id}`, type: "briefing", appointmentId: `appt-${a.id}`, title: short(`Briefing: ${a.title}${a.company && !a.title.includes(a.company) ? " – " + a.company : ""}`, 200), text: short(text, 6000) } });
    }

    // Neue Website-Buchungen (noch nicht bestätigt) → mit Push
    for (const b of db.prepare("SELECT * FROM bookings WHERE status = 'neu' AND created_at >= ?").all(since_)) {
      const who = [b.name, b.company].filter(Boolean).join(", ");
      out.push({ key: `booking-${b.id}`, kind: "message", ref: b.id, ev: { id: `booking-${b.id}`, type: "message", notify: true,
        title: short(`Neue Terminbuchung: ${TYPE_LABEL[b.type] || b.type} mit ${who}`, 200),
        text: [`Wunschtermin: ${formatDe(b.start)} (${b.minutes} Min.)`, b.message && `Nachricht: ${short(b.message, 800)}`, "Bitte im Board bestätigen."].filter(Boolean).join("\n"),
        url: `${SITE_URL}/admin/#anfragen` } });
    }

    // Projektanfragen über die Website → mit Push
    for (const q of db.prepare("SELECT * FROM requests WHERE created_at >= ?").all(since_)) {
      out.push({ key: `anfrage-${q.id}`, kind: "message", ref: q.id, ev: { id: `anfrage-${q.id}`, type: "message", notify: true,
        title: short(`Neue Projektanfrage von ${[q.name, q.company].filter(Boolean).join(", ")}`, 200),
        text: [q.kinds && `Art: ${q.kinds}`, q.budget && `Budget: ${q.budget}`, q.timing && `Zeitraum: ${q.timing}`, short(q.description, 1200)].filter(Boolean).join("\n"),
        url: `${SITE_URL}/admin/#anfragen` } });
    }

    // Terminanfragen aus dem Kundenportal → mit Push (nur solange offen; bereits gemeldete bleiben gemeldet)
    for (const r of db.prepare("SELECT r.*, c.company, c.name AS cname FROM appointment_requests r JOIN clients c ON c.id = r.client_id WHERE r.status = 'offen' AND r.created_at >= ?").all(since_)) {
      let slots = []; try { slots = JSON.parse(r.slots || "[]"); } catch {}
      out.push({ key: `req-${r.id}`, kind: "message", ref: r.id, ev: { id: `req-${r.id}`, type: "message", notify: true,
        title: short(`Terminanfrage: ${TYPE_LABEL[r.type] || r.type} – ${r.company}`, 200),
        text: [`Von ${r.cname}, ${r.minutes} Min.`, r.flexible ? "Zeit: flexibel" : slots.length ? `Vorschläge: ${slots.map(s => formatDe(s)).join("; ")}` : "", r.message && `Nachricht: ${short(r.message, 800)}`].filter(Boolean).join("\n"),
        url: `${SITE_URL}/admin/#posteingang` } });
    }

    // Kundennachrichten im Portal-Chat und Anmerkungen an Prototypen: eine Meldung je Kunde und Stunde, ohne Push
    const grouped = (rows, prefix, label) => {
      const g = new Map();
      for (const m of rows) { const k = `${prefix}-c${m.client_id}-${m.created_at.slice(0, 13).replace(/\D/g, "")}`; if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
      for (const [k, list] of g) {
        const c = list[0];
        out.push({ key: k, kind: "message", ref: c.client_id, ev: { id: k, type: "message", notify: false,
          title: short(`${list.length === 1 ? label[0] : `${list.length} ${label[1]}`} von ${c.company}`, 200),
          text: list.slice(-5).map(m => `${m.author}: ${short(m.text, 300)}`).join("\n"),
          url: `${SITE_URL}/admin/#kunden/${c.client_id}` } });
      }
    };
    grouped(db.prepare("SELECT m.client_id, m.author, m.body AS text, m.created_at, c.company FROM messages m JOIN clients c ON c.id = m.client_id WHERE m.sender = 'client' AND m.created_at >= ? ORDER BY m.id").all(since_), "msg", ["Neue Nachricht", "neue Nachrichten"]);
    grouped(db.prepare("SELECT a.client_id, a.author, a.comment AS text, a.created_at, c.company FROM annotations a JOIN clients c ON c.id = a.client_id WHERE a.author_kind = 'client' AND a.created_at >= ? ORDER BY a.id").all(since_), "anm", ["Neue Anmerkung", "neue Anmerkungen"]);
    return out;
  }

  /* ---------- Abgleich (läuft in der Automatik jede Minute) ---------- */
  let running = false;
  async function sync() {
    if (!configured() || running) return null;
    let c = cfg();
    if (!c.enabled || Date.now() < state.pausedUntil) return null;
    if (!c.since) { c.since = new Date().toISOString(); setSetting("covered", c); }   // erste Aktivierung: keine Altlasten melden
    running = true; state.lastRun = new Date().toISOString(); let sent = 0;
    try {
      const want = desired(c.since), seen = new Set(want.map(w => w.key));
      const known = new Map(db.prepare("SELECT key, hash, kind, start FROM covered_sync").all().map(r => [r.key, r]));
      const queue = [];
      for (const w of want) { const h = hashOf(w.ev); if (known.get(w.key)?.hash !== h) queue.push({ ...w, h }); }
      // Abgesagte/gelöschte Termine: früher gemeldet, liegen noch in der Zukunft, existieren aber nicht mehr
      for (const [k, r] of known) if (r.kind === "appointment" && !seen.has(k) && r.start > new Date().toISOString())
        queue.push({ key: k, kind: "appointment", cancel: true, h: "abgesagt", start: r.start, ev: { id: k, type: "appointment.cancelled", text: "Termin im Reeder Board abgesagt" } });

      const save = db.prepare(`INSERT INTO covered_sync(key, kind, hash, ref_id, start, sent_at, error) VALUES(?,?,?,?,?, datetime('now'), ?)
        ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, hash = excluded.hash, ref_id = excluded.ref_id, start = excluded.start, sent_at = excluded.sent_at, error = excluded.error`);
      for (const q of queue.slice(0, 60)) {   // höchstens 60 pro Minute (Covered erlaubt 120)
        const r = await call("POST", "/events", q.ev);
        if (r.ok) { save.run(q.key, q.cancel ? "abgesagt" : q.kind, q.h, q.ref ?? null, q.cancel ? null : q.start ?? null, null); sent++; state.lastOk = new Date().toISOString(); state.lastError = null; continue; }
        state.lastError = { at: new Date().toISOString(), status: r.status, error: r.error };
        if (r.status === 400) { save.run(q.key, q.kind, q.h, q.ref ?? null, q.start ?? null, r.error); continue; }   // Eingabe abgelehnt: nicht endlos wiederholen
        if (r.status === 401 || r.status === 403) { state.pausedUntil = Date.now() + 30 * 60e3; break; }     // Schlüssel/Erlaubnis: 30 Min. Pause
        state.pausedUntil = Date.now() + 5 * 60e3; break;                                                    // nicht erreichbar: in 5 Min. erneut
      }
      // Erledigtes aufräumen: vorbei gegangene Termine/Absagen nach 30 Tagen vergessen
      db.prepare("DELETE FROM covered_sync WHERE kind IN ('appointment','abgesagt') AND sent_at < datetime('now','-30 days') AND (start IS NULL OR start < ?)").run(new Date().toISOString());
    } catch (e) { state.lastError = { at: new Date().toISOString(), status: 0, error: e.message }; }
    finally { running = false; state.sentLastRun = sent; }
    return sent;
  }

  /* ---------- Board: Einstellungen > Nova (Covered) ---------- */
  async function api(req, res, p, m) {
    if (p === "/covered" && m === "GET") {
      const c = cfg(), counts = Object.fromEntries(db.prepare("SELECT kind, COUNT(*) n FROM covered_sync GROUP BY kind").all().map(r => [r.kind, r.n]));
      const recent = db.prepare("SELECT key, kind, sent_at, error FROM covered_sync ORDER BY sent_at DESC LIMIT 8").all();
      return json(res, 200, { configured: configured(), disabled: !!process.env.COVERED_DISABLED, hasUrl: !!base(), hasKey: !!key(), url: base(), enabled: c.enabled, since: c.since,
        lastOk: state.lastOk, lastError: state.lastError, lastRun: state.lastRun, pausedUntil: state.pausedUntil > Date.now() ? new Date(state.pausedUntil).toISOString() : null, counts, recent });
    }
    if (p === "/covered" && m === "PUT") {
      const d = await readJson(req), c = cfg();
      if (typeof d.enabled === "boolean") c.enabled = d.enabled;
      setSetting("covered", c); state.pausedUntil = 0;
      if (c.enabled) sync().catch(() => {});
      return json(res, 200, { ok: true, enabled: c.enabled });
    }
    if (p === "/covered/test" && m === "POST") {
      if (!configured()) return json(res, 400, { error: process.env.COVERED_DISABLED ? "Im Demo-Board ist Covered abgeschaltet." : "COVERED_API_URL und COVERED_API_KEY fehlen in der .env." });
      const r = await call("GET", "/me");
      if (!r.ok) return json(res, 200, { ok: false, status: r.status, error: r.status === 401 ? "Schlüssel falsch oder gesperrt" : r.status === 403 ? "Erlaubnis fehlt" : r.error });
      state.lastOk = new Date().toISOString(); state.pausedUntil = 0;
      return json(res, 200, { ok: true, scopes: r.data.scopes || [], firstName: r.data.user?.firstName || "", assistantName: r.data.assistantName || "Nova", connection: r.data.connection || "" });
    }
    if (p === "/covered/sync" && m === "POST") { state.pausedUntil = 0; const n = await sync(); return json(res, 200, { ok: true, sent: n ?? 0, lastError: state.lastError }); }
    return null;
  }

  return { sync, api, configured };
}
