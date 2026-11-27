// Projekträume: Projekte, Termine mit Zusammenfassung, Finanzen, Dokumente, Anmerkungen an Prototypen, Verlauf.
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { projektnamenPflegen } from "./projektname.mjs";
import { vereinbarungenVonProjekt } from "./vereinbarungen.mjs";
import { fragebogenVonProjekt, termineVonProjekt, projektZurAnfrage } from "./anfragen.mjs";
import { callModel, assistantStatus } from "./assistant.mjs";
import { db } from "./db.mjs";
import { isOwner, memberProjectIds, FINANCE_DOC_KINDS, FINANCE_EVENT_KINDS } from "./access.mjs";
import { sendMail } from "./mail.mjs";
import { vorlage } from "./mail-vorlagen.mjs";
import { firmaVonProjekt } from "./firmen.mjs";

const DOC_DIR = path.resolve(process.env.DATA_DIR || "data", "documents");
export const PHASES = ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"];
const DUE_ON = ["Auftrag", ...PHASES.slice(1)];
const STATUSES = ["anfrage", "aktiv", "pausiert", "abgeschlossen"];   // "anfrage" = aus einem Onboarding entstanden, noch kein Auftrag
const DOC_KINDS = ["Angebot", "Rechnung", "Vertrag", "Konzept", "Protokoll", "Prüfbericht", "Sonstiges"];
const DOC_MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".txt": "text/plain; charset=utf-8", ".zip": "application/zip" };
const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#8b5cf6", "#111111"];
const PAY_STATES = ["offen", "berechnet", "bezahlt"];
// Meilenstein-Mails: Änderungen innerhalb dieses Zeitraums werden zu einer E-Mail gebündelt
const DIGEST_DELAY = Number(process.env.DIGEST_DELAY_MS || 90000);

export function createProjects({ json, send, readJson, clean, protoOut, SITE_URL }) {
  /* ---------- Helfer ---------- */
  // Euro-Betrag → Cent. Akzeptiert Zahlen und deutsche Schreibweise ("40.000,50").
  const cents = v => {
    if (v === "" || v === null || v === undefined) return null;
    const str = typeof v === "number" ? String(v) : String(v).trim().replace(/\s|€/g, "");
    const norm = typeof v === "number" ? str : str.includes(",") ? str.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(str) ? str.replace(/\./g, "") : str;
    const n = Math.round(Number(norm) * 100); return Number.isFinite(n) && Math.abs(n) < 1e13 ? n : null;
  };
  const isoOrNull = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  const ymdOrNull = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
  const pick = (v, list, fallback) => list.includes(v) ? v : fallback;
  /* ---------- Verlauf + automatische Benachrichtigung ---------- */
  // Jeder Meilenstein landet im Verlauf. Ist notify an, bekommt der Kunde nach kurzer Wartezeit
  // eine gebündelte E-Mail mit allen Neuigkeiten (statt einer Mail pro Klick).
  function logEvent(clientId, projectId, kind, title, detail = "", notify = true) {
    db.prepare("INSERT INTO events(client_id, project_id, kind, title, detail, notify) VALUES(?, ?, ?, ?, ?, ?)").run(clientId, projectId ?? null, kind, clean(title, 200), clean(detail, 600), notify ? 1 : 0);
    if (notify) scheduleDigest(clientId);
  }
  const timers = new Map();
  function scheduleDigest(clientId) {
    clearTimeout(timers.get(clientId));
    timers.set(clientId, setTimeout(() => { timers.delete(clientId); sendDigest(clientId).catch(e => console.warn("Digest:", e.message)); }, DIGEST_DELAY));
  }
  async function sendDigest(clientId) {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId); if (!c) return;
    const events = db.prepare("SELECT e.*, p.title project_title FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.client_id = ? AND e.id > ? AND e.notify = 1 ORDER BY e.id").all(c.id, c.digest_event_id);
    const maxId = db.prepare("SELECT COALESCE(MAX(id), 0) m FROM events WHERE client_id = ?").get(c.id).m;
    db.prepare("UPDATE clients SET digest_event_id = ? WHERE id = ?").run(maxId, c.id);
    if (!events.length || !c.pw_hash || !c.active || !c.notify_email) return;
    const projects = [...new Set(events.map(e => e.project_id).filter(Boolean))];
    const one = projects.length === 1 ? events.find(e => e.project_id === projects[0]).project_title : null;
    const punkte = events.map(e => `${e.title}${e.detail ? " – " + e.detail : ""}${!one && e.project_title ? ` (${e.project_title})` : ""}`);
    const link = `${SITE_URL}/portal/${projects.length === 1 ? "#projekt/" + projects[0] : "#uebersicht"}`;
    // Firma: die des Projekts, wenn alle Neuigkeiten zu einem Projekt gehören – sonst Software
    await sendMail({ to: c.email, ...vorlage("projekt_neuigkeiten", { name: c.name, projekt: one || "", punkte, link, firma: projects.length === 1 ? firmaVonProjekt(projects[0]) : "software" }) });
  }
  // Nach einem Neustart liegengebliebene Neuigkeiten nachholen
  setTimeout(() => {
    for (const r of db.prepare("SELECT DISTINCT e.client_id id FROM events e JOIN clients c ON c.id = e.client_id WHERE e.id > c.digest_event_id AND e.notify = 1").all()) scheduleDigest(r.id);
  }, 15000).unref?.();

  // Interne Gesprächsnotizen: nur fürs Team. Bewusst nicht in apptOut, weil der Kunde seine Termine darüber im Portal sieht.
  if (!db.prepare("PRAGMA table_info(appointments)").all().some(c => c.name === "notes_intern")) db.exec("ALTER TABLE appointments ADD COLUMN notes_intern TEXT");
  // Rohe Mitschrift während des Gesprächs (diktiert oder getippt) – nur fürs Team, wird per „Auswerten“ aufgeteilt
  if (!db.prepare("PRAGMA table_info(appointments)").all().some(c => c.name === "mitschrift")) db.exec("ALTER TABLE appointments ADD COLUMN mitschrift TEXT");
  const MITSCHRIFT_SCHEMA = { type: "object", additionalProperties: false, required: ["intern", "zusammenfassung", "naechste_schritte"],
    properties: { intern: { type: "string" }, zusammenfassung: { type: "string" }, naechste_schritte: { type: "string" } } };
  /** Mitschrift bereinigen und aufteilen: interne Notiz / Zusammenfassung für den Kunden / nächste Schritte (kleines, günstiges Modell) */
  async function mitschriftAuswerten(text, kontext) {
    if (!assistantStatus().available) throw Object.assign(new Error("Die KI ist gerade nicht verfügbar (Einstellungen → KI-Assistent: ausgeschaltet, kein Schlüssel oder Monatsbudget erreicht)."), { status: 503 });
    const r = await callModel("mitschrift", "claude-haiku-5-5",
      "Du bekommst die rohe Gesprächsmitschrift eines Software- und Hardware-Dienstleisters (Reeder) aus einem Kundentermin – oft per Diktierprogramm entstanden, mit Hör- und Rechtschreibfehlern (z. B. „Reda“ = Reeder). " +
      "Bereinige Fehler, erfinde nichts dazu und lass nichts Inhaltliches weg. Teile den Inhalt auf:\n" +
      "1. intern: alles, was nur das Team wissen soll – eigene Merkposten („ich muss darauf achten …“), Einschätzungen, Budget, Preise, Risiken, Bauchgefühl, was der Kunde auf keinen Fall will. Knappe Stichpunkte, je Zeile ein Punkt mit „– “.\n" +
      "2. zusammenfassung: freundliche, sachliche Zusammenfassung für den Kunden in der Sie-Form (was besprochen wurde, was er sich wünscht, was er nicht möchte). Keine internen Einschätzungen, keine Preise, die nicht ausdrücklich zugesagt wurden. Kurze Absätze oder Stichpunkte.\n" +
      "3. naechste_schritte: konkrete nächste Schritte, je Zeile einer mit „– “, wer was bis wann macht (soweit genannt), für den Kunden lesbar.\n" +
      "Ist für ein Feld nichts da, gib einen leeren Text zurück. Antworte auf Deutsch.",
      `Werte diese Mitschrift aus.\n<<DATEN>>\n${JSON.stringify({ ...kontext, mitschrift: text })}`, MITSCHRIFT_SCHEMA, null, kontext.projekt_id || null);
    return { intern: clean(r?.intern, 12000), zusammenfassung: clean(r?.zusammenfassung, 6000), naechste_schritte: clean(r?.naechste_schritte, 3000) };
  }
  // Arbeitsstand: tägliche Updates zugesagt?, Notiz fürs nächste Mal, Zusammenfassung der letzten Sitzung (zur Version gemerkt)
  { const pc = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
    for (const [c, t] of [["daily_updates", "INTEGER NOT NULL DEFAULT 0"], ["next_note", "TEXT"], ["stand_summary", "TEXT"], ["stand_summary_ref", "INTEGER"]]) if (!pc.includes(c)) db.exec(`ALTER TABLE projects ADD COLUMN ${c} ${t}`); }
  const letzterStand = pid => db.prepare("SELECT id, version, created_at, changes, diff FROM prototypes WHERE project_id = ? AND state IS NULL ORDER BY id DESC LIMIT 1").get(pid) || null;
  /** Zwei Sätze zur letzten Sitzung: aus der Änderungsliste des letzten Stands, per kleinem Modell; ohne KI die nackten Zahlen */
  async function standZusammenfassen(pr, st) {
    let d = {}; try { d = JSON.parse(st.diff || "{}"); } catch {}
    const n = k => (Array.isArray(d[k]) ? d[k] : []);
    let text = [st.changes, `${n("changed").length} Dateien geändert, ${n("added").length} neu, ${n("removed").length} entfernt`].filter(Boolean).join(" – ");
    if (assistantStatus().available && (st.changes || n("changed").length + n("added").length)) {
      try { const r = await callModel("stand", "claude-haiku-5-5",
          "Fasse in höchstens zwei kurzen deutschen Sätzen zusammen, was in dieser Arbeitssitzung an einer Software geändert wurde – für jemanden, der beim nächsten Mal dort weitermacht. Sachlich, ohne Dateilisten, ohne Einleitung.",
          `Fasse zusammen.\n<<DATEN>>\n${JSON.stringify({ projekt: pr.title, notiz_zur_version: st.changes || "", geaendert: n("changed").slice(0, 40), neu: n("added").slice(0, 40), entfernt: n("removed").slice(0, 20) })}`,
          { type: "object", additionalProperties: false, required: ["zusammenfassung"], properties: { zusammenfassung: { type: "string" } } }, null, pr.id);
        if (r?.zusammenfassung) text = clean(r.zusammenfassung, 500); } catch {}
    }
    db.prepare("UPDATE projects SET stand_summary = ?, stand_summary_ref = ? WHERE id = ?").run(text, st.id, pr.id);
    return text;
  }
  const projectOut = p => p && ({ id: p.id, client_id: p.client_id, title: p.title, bereich: p.bereich || "software", kind: p.kind, description: p.description, phase: p.phase, phaseIndex: PHASES.indexOf(p.phase), phases: PHASES,
    model: p.model, status: p.status, offer_net: p.offer_net, vat_rate: p.vat_rate, anfrage_art: p.anfrage_art || null,
    // Liegt ein versendetes Angebot beim Kunden? Dann ist das Projekt „Angebot offen“.
    offerOpen: db.prepare("SELECT id, number, gross FROM invoices WHERE project_id = ? AND kind = 'angebot' AND locked = 1 AND status = 'versendet' ORDER BY id DESC LIMIT 1").get(p.id) || null,
    offer_gross: p.offer_net == null ? null : Math.round(p.offer_net * (1 + p.vat_rate / 100)), conditions: p.conditions, created_at: p.created_at, updated_at: p.updated_at });
  const apptOut = a => ({ id: a.id, project_id: a.project_id, project: a.project_title || null, title: a.title, start: a.start, minutes: a.minutes, kind: a.kind, summary: a.summary, next_steps: a.next_steps, video_url: a.video_url || null });
  const docOut = (d, base) => ({ id: d.id, project_id: d.project_id, project: d.project_title || null, kind: d.kind, title: d.title, amount_gross: d.amount_gross, doc_date: d.doc_date,
    file_name: d.file_name, bytes: d.bytes, mime: d.mime, url: `${base}/documents/${d.id}/file`, created_at: d.created_at });
  const payOut = (x, vat, base) => ({ id: x.id, label: x.label, amount_net: x.amount_net, amount_gross: Math.round(x.amount_net * (1 + vat / 100)), due: x.due, status: x.status, paid_at: x.paid_at,
    due_on: x.due_on || null, pct: x.pct ?? null, invoice_doc_id: x.invoice_doc_id || null, invoice_url: x.invoice_doc_id ? `${base}/documents/${x.invoice_doc_id}/file` : null });
  const annOut = a => ({ id: a.id, prototype_id: a.prototype_id, author_kind: a.author_kind, author: a.author, page: a.page, device_w: a.device_w, x: a.x, y: a.y,
    strokes: JSON.parse(a.strokes || "[]"), change: a.change ? JSON.parse(a.change) : null, comment: a.comment, status: a.status, reply: a.reply, created_at: a.created_at, done_at: a.done_at,
    ai: a.ai_status ? { kind: a.ai_kind, status: a.ai_status, summary: a.ai_summary } : null, proto_title: a.proto_title, proto_version: a.proto_version, proto_url: a.proto_token ? `/p/${a.proto_token}/` : undefined, proto_entry: a.proto_entry });

  // Prototypen eines Projekts gruppiert nach Versionsreihe (neueste Version zuerst)
  function protoGroups(where, ...args) {
    const rows = db.prepare(`SELECT * FROM prototypes WHERE ${where} ORDER BY COALESCE(group_id, id), version DESC`).all(...args);
    const open = db.prepare("SELECT COUNT(*) n FROM annotations WHERE prototype_id = ? AND status = 'offen'");
    const groups = new Map();
    for (const r of rows) {
      if (r.state === "verworfen") continue;               // zurückgewiesene Kandidaten (Dateien gelöscht)
      const g = r.group_id || r.id;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ ...protoOut(r), version: r.version, changes: r.changes, project_id: r.project_id, group_id: g, openNotes: open.get(r.id).n });
    }
    // Welche Version hat der Kunde zuletzt geöffnet? (Tabelle aus stand.mjs)
    let seen = null; try { seen = db.prepare("SELECT version, seen_at FROM proto_seen WHERE client_id = ? AND group_id = ?"); } catch {}
    for (const [g, list] of groups) { const cid = rows.find(r => (r.group_id || r.id) === g)?.client_id; list[0].seen = seen && cid ? seen.get(cid, g) || null : null; }
    return [...groups.values()].sort((a, b) => b[0].id - a[0].id);
  }
  function projectDetail(p, base, includeInactive) {
    const payments = db.prepare("SELECT * FROM payments WHERE project_id = ? ORDER BY sort, id").all(p.id).map(x => payOut(x, p.vat_rate, base));
    const paid = payments.filter(x => x.status === "bezahlt").reduce((s, x) => s + x.amount_net, 0);
    return {
      ...projectOut(p), payments,
      paid_net: paid, open_net: payments.filter(x => x.status !== "bezahlt").reduce((s, x) => s + x.amount_net, 0),
      appointments: db.prepare("SELECT * FROM appointments WHERE project_id = ? ORDER BY start DESC").all(p.id).map(apptOut),
      documents: db.prepare("SELECT * FROM documents WHERE project_id = ? ORDER BY COALESCE(doc_date, created_at) DESC").all(p.id).map(d => docOut(d, base)),
      prototypes: protoGroups(`project_id = ?${includeInactive ? "" : " AND active = 1"}`, p.id),
      events: db.prepare("SELECT * FROM events WHERE project_id = ? AND kind != 'anmerkung' ORDER BY id DESC LIMIT 200").all(p.id),
      openNotes: db.prepare("SELECT COUNT(*) n FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE pr.project_id = ? AND a.status = 'offen'").get(p.id).n,
    };
  }
  function projectSummary(p) {
    const next = db.prepare("SELECT * FROM appointments WHERE (project_id = ? OR (? IS NOT NULL AND booking_id = ?)) AND start >= ? ORDER BY start LIMIT 1").get(p.id, p.booking_id ?? null, p.booking_id ?? null, new Date().toISOString());
    const latest = db.prepare("SELECT * FROM prototypes WHERE project_id = ? AND active = 1 ORDER BY id DESC LIMIT 1").get(p.id);
    const open = db.prepare("SELECT COALESCE(SUM(amount_net),0) s FROM payments WHERE project_id = ? AND status != 'bezahlt'").get(p.id).s;
    return { ...projectOut(p), fragebogen: fragebogenVonProjekt(p), next: next ? apptOut(next) : null, latest: latest ? { ...protoOut(latest), version: latest.version } : null, open_net: open,
      open_gross: Math.round(open * (1 + p.vat_rate / 100)) };
  }

  // Zeichnungen prüfen – Daten kommen aus dem Browser und werden nur in festen Formen gespeichert
  function cleanStrokes(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 200).map(s => {
      const pts = Array.isArray(s?.p) ? s.p.slice(0, 6000).map(Number).filter(n => Number.isFinite(n) && n > -5000 && n < 500000).map(n => Math.round(n * 10) / 10) : [];
      return { t: s?.t === "marker" ? "marker" : "pen", c: COLORS.includes(s?.c) ? s.c : COLORS[0], p: pts.length % 2 ? pts.slice(0, -1) : pts };
    }).filter(s => s.p.length >= 2);
  }
  // Änderungswunsch aus der Live-Vorschau: nur feste Felder, harmlose Werte
  const CHANGE_PROPS = ["fontSize", "fontWeight", "color", "backgroundColor", "textAlign", "marginTop", "marginBottom", "paddingTop", "paddingBottom", "borderRadius"];
  const KINDS = ["heading", "text", "link", "button", "image", "block"];
  function cleanChange(c) {
    if (!c || typeof c !== "object" || !c.target) return null;
    const sel = String(c.target.sel || ""); if (!/^[#\w\-:().>\s]{1,600}$/.test(sel)) return null;
    const vals = o => Object.fromEntries(CHANGE_PROPS.filter(k => typeof o?.[k] === "string" && /^[#\w\s.,%()\-]{1,40}$/.test(o[k])).map(k => [k, o[k]]));
    const out = { target: { sel, tag: clean(c.target.tag, 20), kind: KINDS.includes(c.target.kind) ? c.target.kind : "block", text: clean(c.target.text, 200) }, css: vals(c.css), before: vals(c.before) };
    if (typeof c.text === "string" && c.text.trim()) { out.text = clean(c.text, 800); out.textBefore = clean(c.textBefore, 800); }
    return Object.keys(out.css).length || out.text ? out : null;
  }
  async function createAnnotation(req, res, proto, clientId, authorKind, author) {
    const d = await readJson(req, 512 * 1024);
    const strokes = cleanStrokes(d.strokes), comment = clean(d.comment, 2000).replace(/\r/g, ""), change = cleanChange(d.change);
    if (!comment && !strokes.length && !change) return json(res, 400, { error: "Bitte etwas einzeichnen oder einen Kommentar schreiben." });
    const page = clean(d.page, 300).replace(/^\/+/, "") || proto.entry;
    const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
    const r = db.prepare("INSERT INTO annotations(prototype_id, client_id, author_kind, author, page, device_w, x, y, strokes, comment, change) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(proto.id, clientId, authorKind, author, page, Math.round(num(d.device_w, 200, 4000)), num(d.x, -5000, 500000), num(d.y, -5000, 500000), JSON.stringify(strokes), comment, change ? JSON.stringify(change) : null);
    return json(res, 201, annOut(db.prepare("SELECT * FROM annotations WHERE id = ?").get(r.lastInsertRowid)));
  }
  const annSelect = `SELECT a.*, pr.title proto_title, pr.version proto_version, pr.token proto_token, pr.entry proto_entry, t.kind ai_kind, t.status ai_status, t.team_summary ai_summary FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id LEFT JOIN assistant_threads t ON t.annotation_id = a.id`;

  async function sendDoc(res, d) {
    let body; try { body = await readFile(path.join(DOC_DIR, d.file_token)); } catch { return json(res, 404, { error: "Datei fehlt" }); }
    const inline = /^(application\/pdf|image\/)/.test(d.mime);
    const name = d.file_name.replace(/[^\w.\- äöüÄÖÜß()]/g, "_");
    return send(res, 200, body, { "Content-Type": d.mime, "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}` });
  }

  /* ================= Kundenportal ================= */
  async function portal(req, res, url, p, c) {
    const m = req.method, base = "/api/portal";
    if (p === "/overview" && m === "GET") {
      const projects = db.prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY status = 'abgeschlossen', updated_at DESC").all(c.id).map(projectSummary);
      const next = db.prepare("SELECT a.*, p.title project_title FROM appointments a LEFT JOIN projects p ON p.id = a.project_id WHERE a.client_id = ? AND a.start >= ? ORDER BY a.start LIMIT 1").get(c.id, new Date().toISOString());
      return json(res, 200, { projects, next: next ? apptOut(next) : null,
        unread: db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id = ? AND sender = 'team' AND read_at IS NULL").get(c.id).n,
        openNotes: db.prepare("SELECT COUNT(*) n FROM annotations WHERE client_id = ? AND status = 'offen'").get(c.id).n,
        events: db.prepare("SELECT e.*, p.title project_title FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.client_id = ? AND e.kind != 'anmerkung' ORDER BY e.id DESC LIMIT 60").all(c.id) });
    }
    if (p === "/projects" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY status = 'abgeschlossen', updated_at DESC").all(c.id).map(projectSummary));
    let mm = p.match(/^\/projects\/(\d+)$/);
    if (mm && m === "GET") {
      const pr = db.prepare("SELECT * FROM projects WHERE id = ? AND client_id = ?").get(+mm[1], c.id);
      return pr ? json(res, 200, projectDetail(pr, base, false)) : json(res, 404, { error: "Projekt nicht gefunden" });
    }
    if (p === "/appointments" && m === "GET")
      return json(res, 200, db.prepare("SELECT a.*, p.title project_title FROM appointments a LEFT JOIN projects p ON p.id = a.project_id WHERE a.client_id = ? ORDER BY a.start DESC").all(c.id).map(apptOut));
    // Anfragen des Kunden, zu denen es noch kein Projekt gibt: verschickte und ausgefüllte Fragebögen (Website, Software, Hardware)
    if (p === "/anfragen" && m === "GET") {
      const out = [], termin = id => (id ? db.prepare("SELECT start FROM bookings WHERE id = ? AND status IN ('neu','bestaetigt')").get(id)?.start : null) || null;
      try { for (const o of db.prepare("SELECT o.* FROM onboarding o LEFT JOIN bookings b ON b.id = o.booking_id WHERE o.client_id = ? OR b.client_id = ? ORDER BY o.id DESC").all(c.id, c.id)) {
        const fertig = o.status === "ausgefuellt"; let kinds = [], ids = []; try { kinds = JSON.parse(o.kinds || "[]"); ids = JSON.parse(o.project_ids || "[]"); } catch {}
        if ((fertig && ids.length) || (o.booking_id && kinds.length && kinds.every(k => projektZurAnfrage(o.booking_id, k)))) continue;   // steht schon als Projekt in der Liste
        out.push({ art: kinds.map(k => k === "hardware" ? "Hardware" : "Software").join(" & ") || "Software", fertig, am: (fertig ? o.answered_at : o.invited_at) || null, link: fertig ? null : `/portal/onboarding.html#${o.token}`, termin: termin(o.booking_id) });
      } } catch {}
      try { for (const v of db.prepare("SELECT v.* FROM vorab v LEFT JOIN bookings b ON b.id = v.booking_id WHERE v.client_id = ? OR b.client_id = ? ORDER BY v.id DESC").all(c.id, c.id))
        if (!projektZurAnfrage(v.booking_id, "website")) out.push({ art: "Website", fertig: !!v.answered_at, am: v.answered_at || v.invited_at || null, link: v.answered_at ? null : `/portal/fragebogen.html#${v.token}`, termin: termin(v.booking_id) }); } catch {}
      return json(res, 200, out);
    }
    if (p === "/documents" && m === "GET")
      return json(res, 200, db.prepare("SELECT d.*, p.title project_title FROM documents d LEFT JOIN projects p ON p.id = d.project_id WHERE d.client_id = ? ORDER BY COALESCE(d.doc_date, d.created_at) DESC").all(c.id).map(d => docOut(d, base)));
    mm = p.match(/^\/documents\/(\d+)\/file$/);
    if (mm && m === "GET") {
      const d = db.prepare("SELECT * FROM documents WHERE id = ? AND client_id = ?").get(+mm[1], c.id);
      return d ? sendDoc(res, d) : json(res, 404, { error: "Nicht gefunden" });
    }
    mm = p.match(/^\/prototypes\/(\d+)\/annotations$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM prototypes WHERE id = ? AND client_id = ? AND active = 1").get(+mm[1], c.id);
      if (!pr) return json(res, 404, { error: "Prototyp nicht gefunden" });
      if (m === "GET") return json(res, 200, db.prepare(`${annSelect} WHERE a.prototype_id = ? ORDER BY a.id`).all(pr.id).map(annOut));
      if (m === "POST") return createAnnotation(req, res, pr, c.id, "client", c.name);
    }
    mm = p.match(/^\/annotations\/(\d+)$/);
    if (mm && m === "PATCH") {   // eigene, offene Anmerkung ändern: Text oder einzelne Striche entfernen
      const a = db.prepare("SELECT * FROM annotations WHERE id = ? AND client_id = ? AND author_kind = 'client' AND status = 'offen'").get(+mm[1], c.id);
      if (!a) return json(res, 404, { error: "Nicht gefunden oder bereits bearbeitet" });
      const d = await readJson(req, 512 * 1024);
      const strokes = d.strokes !== undefined ? cleanStrokes(d.strokes) : JSON.parse(a.strokes || "[]");
      const comment = d.comment !== undefined ? clean(d.comment, 2000).replace(/\r/g, "") : a.comment || "";
      if (!comment && !strokes.length) { db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id); return json(res, 200, { deleted: true }); }
      db.prepare("UPDATE annotations SET strokes = ?, comment = ? WHERE id = ?").run(JSON.stringify(strokes), comment, a.id);
      return json(res, 200, annOut(db.prepare(`${annSelect} WHERE a.id = ?`).get(a.id)));
    }
    if (mm && m === "DELETE") {
      const a = db.prepare("SELECT * FROM annotations WHERE id = ? AND client_id = ? AND author_kind = 'client' AND status = 'offen'").get(+mm[1], c.id);
      if (!a) return json(res, 404, { error: "Nicht gefunden oder bereits bearbeitet" });
      db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id); return json(res, 200, { ok: true });
    }
    if (p === "/annotations" && m === "GET")
      return json(res, 200, db.prepare(`${annSelect} WHERE a.client_id = ? AND pr.active = 1 ORDER BY a.status = 'erledigt', a.id DESC LIMIT 300`).all(c.id).map(annOut));
    return null;
  }

  /* ================= Admin ================= */
  async function admin(req, res, url, p, user) {
    const m = req.method, base = "/api/admin";
    // Entwickler: nur zugewiesene Projekte, keine Beträge/Rechnungen
    const dev = !isOwner(user), allowed = dev ? memberProjectIds(user) : null;
    const okP = pid => !dev || pid == null || allowed.includes(pid);
    const FIN = ["offer_net", "offer_gross", "vat_rate", "conditions", "payments", "paid_net", "open_net", "open_gross"];
    const strip = o => { if (!dev || !o) return o; const x = { ...o }; for (const k of FIN) delete x[k];
      if (x.documents) x.documents = x.documents.filter(d => !FINANCE_DOC_KINDS.includes(d.kind));
      if (x.events) x.events = x.events.filter(e => !FINANCE_EVENT_KINDS.includes(e.kind) && !/^(Rechnung|Angebot|Vertrag)/.test(e.title));
      return x; };
    const members = pid => db.prepare("SELECT u.id, u.name, u.role FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.name").all(pid);
    let mm = p.match(/^\/clients\/(\d+)\/(projects|documents|annotations|appointments|bookings|events)$/);
    if (mm) {
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+mm[1]);
      if (!c) return json(res, 404, { error: "Kunde nicht gefunden" });
      const what = mm[2];
      if (what === "projects" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY status = 'abgeschlossen', updated_at DESC").all(c.id)
        .filter(x => !dev || allowed.includes(x.id)).map(x => strip({ ...projectSummary(x), members: members(x.id) })));
      if (what === "projects" && m === "POST") {
        const d = await readJson(req), title = clean(d.title, 160);
        if (!title) return json(res, 400, { error: "Bitte einen Projektnamen angeben." });
        const r = db.prepare("INSERT INTO projects(client_id, title, kind, description, model, phase, bereich) VALUES(?,?,?,?,?,?,?)")
          .run(c.id, title, clean(d.kind, 80), clean(d.description, 4000), clean(d.model, 80), pick(d.phase, PHASES, PHASES[0]), d.bereich === "hardware" ? "hardware" : "software");
        logEvent(c.id, r.lastInsertRowid, "projekt", "Projekt gestartet", title, d.notify !== false);
        return json(res, 201, projectOut(db.prepare("SELECT * FROM projects WHERE id = ?").get(r.lastInsertRowid)));
      }
      if (what === "annotations" && m === "GET")
        return json(res, 200, db.prepare(`${annSelect} WHERE a.client_id = ? ORDER BY a.status = 'erledigt', a.id DESC LIMIT 500`).all(c.id).filter(a => okP(a.project_id ?? db.prepare("SELECT project_id FROM prototypes WHERE id = ?").get(a.prototype_id)?.project_id)).map(annOut));
      if (what === "documents" && m === "POST") {
        const d = await readJson(req, 30 * 1024 * 1024);
        const name = clean(d.file_name, 160), ext = path.extname(name).toLowerCase();
        if (!DOC_MIME[ext]) return json(res, 400, { error: "Erlaubt sind PDF, Bilder, Word, Excel, PowerPoint, TXT und ZIP." });
        const buf = Buffer.from(String(d.data || ""), "base64");
        if (!buf.length) return json(res, 400, { error: "Keine Datei." });
        const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null;
        const token = randomBytes(24).toString("hex");
        await mkdir(DOC_DIR, { recursive: true }); await writeFile(path.join(DOC_DIR, token), buf);
        const kind = pick(d.kind, DOC_KINDS, "Sonstiges"), title = clean(d.title, 160) || name;
        if (dev && (FINANCE_DOC_KINDS.includes(kind) || !okP(projectId))) return json(res, 403, { error: "Angebote, Rechnungen und Verträge lädt nur der Inhaber hoch." });
        const r = db.prepare("INSERT INTO documents(client_id, project_id, kind, title, amount_gross, doc_date, file_token, file_name, mime, bytes) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(c.id, projectId, kind, title, cents(d.amount_gross), ymdOrNull(d.doc_date), token, name, DOC_MIME[ext], buf.length);
        const amt = cents(d.amount_gross), docId = r.lastInsertRowid;
        const pay = d.payment_id && projectId ? db.prepare("SELECT * FROM payments WHERE id = ? AND project_id = ?").get(+d.payment_id, projectId) : null;
        if (pay) db.prepare("UPDATE payments SET invoice_doc_id = ?, status = CASE WHEN status = 'offen' THEN 'berechnet' ELSE status END WHERE id = ?").run(docId, pay.id);
        logEvent(c.id, projectId, "dokument", { Angebot: "Angebot übersendet", Rechnung: "Rechnung gestellt", Vertrag: "Vertrag bereitgestellt", Konzept: "Konzept bereitgestellt", Protokoll: "Protokoll bereitgestellt" }[kind] || "Dokument bereitgestellt",
          title + (amt != null ? ` · ${(amt / 100).toLocaleString("de-DE", { minimumFractionDigits: amt % 100 ? 2 : 0 })} € brutto` : "") + (pay ? ` · ${pay.label}` : ""), d.notify !== false);
        return json(res, 201, docOut(db.prepare("SELECT * FROM documents WHERE id = ?").get(r.lastInsertRowid), base));
      }
      if (what === "documents" && m === "GET")
        return json(res, 200, db.prepare("SELECT d.*, p.title project_title FROM documents d LEFT JOIN projects p ON p.id = d.project_id WHERE d.client_id = ? ORDER BY COALESCE(d.doc_date, d.created_at) DESC").all(c.id).filter(d => !dev || (!FINANCE_DOC_KINDS.includes(d.kind) && okP(d.project_id))).map(d => docOut(d, base)));
      if (what === "appointments" && m === "GET")
        return json(res, 200, db.prepare("SELECT a.*, p.title project_title FROM appointments a LEFT JOIN projects p ON p.id = a.project_id WHERE a.client_id = ? ORDER BY a.start DESC").all(c.id).filter(a => okP(a.project_id)).map(apptOut));
      if (what === "appointments" && m === "POST") {
        const d = await readJson(req), start = isoOrNull(d.start), title = clean(d.title, 160);
        if (!title || !start) return json(res, 400, { error: "Bitte Titel und Datum angeben." });
        const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null;
        if (!okP(projectId)) return json(res, 403, { error: "Kein Zugriff auf dieses Projekt." });
        const r = db.prepare("INSERT INTO appointments(client_id, project_id, title, start, minutes, kind, summary, next_steps, booking_id) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(c.id, projectId, title, start, Math.min(600, Math.max(0, +d.minutes || 0)) || null, clean(d.kind, 40), clean(d.summary, 6000), clean(d.next_steps, 3000), +d.booking_id || null);
        if (d.notes_intern) db.prepare("UPDATE appointments SET notes_intern = ? WHERE id = ?").run(clean(d.notes_intern, 12000), r.lastInsertRowid);
        if (d.mitschrift) db.prepare("UPDATE appointments SET mitschrift = ? WHERE id = ?").run(clean(d.mitschrift, 20000), r.lastInsertRowid);
        logEvent(c.id, projectId, "termin", new Date(start) > new Date() ? "Termin vereinbart" : "Termin dokumentiert",
          `${title} · ${new Date(start).toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} Uhr`, d.notify !== false);
        return json(res, 201, apptOut(db.prepare("SELECT * FROM appointments WHERE id = ?").get(r.lastInsertRowid)));
      }
      if (what === "bookings" && m === "GET") // Website-Buchungen dieses Kunden, die noch nicht als Termin übernommen wurden
        return dev ? json(res, 200, []) : json(res, 200, db.prepare("SELECT * FROM bookings WHERE lower(email) = ? AND id NOT IN (SELECT booking_id FROM appointments WHERE booking_id IS NOT NULL) ORDER BY start DESC").all(c.email));
      if (what === "events" && m === "GET")
        return json(res, 200, db.prepare("SELECT e.*, p.title project_title FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.client_id = ? AND e.kind != 'anmerkung' ORDER BY e.id DESC LIMIT 300").all(c.id).filter(e => !dev || (okP(e.project_id) && !FINANCE_EVENT_KINDS.includes(e.kind))));
    }
    // Alle Projekte auf einen Blick (für die Projektliste)
    if (p === "/projects" && m === "GET") {
      const now = new Date().toISOString();
      if (!dev) projektnamenPflegen().catch(() => {});   // Satzanfänge als Titel im Hintergrund durch kurze Namen ersetzen
      const rows = db.prepare("SELECT p.*, c.company, c.name client_name, c.stage FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY p.updated_at DESC").all().filter(x => !dev || allowed.includes(x.id));
      return json(res, 200, rows.map(x => {
        const next = db.prepare("SELECT title, start FROM appointments WHERE project_id = ? AND start >= ? ORDER BY start LIMIT 1").get(x.id, now);
        const last = db.prepare("SELECT MAX(created_at) t FROM events WHERE project_id = ?").get(x.id).t;
        const latest = db.prepare("SELECT version FROM prototypes WHERE project_id = ? AND active = 1 ORDER BY id DESC LIMIT 1").get(x.id);
        const open = db.prepare("SELECT COALESCE(SUM(amount_net),0) s FROM payments WHERE project_id = ? AND status != 'bezahlt'").get(x.id).s;
        // Vorgang: Wo steht dieses Vorhaben zwischen erstem Termin und Auftrag, und wer ist am Zug?
        // schritt 0 Termin · 1 Gespräch · 2 Angebot · 3 Auftrag · 4 Arbeit läuft; wer: "ich" | "kunde" | "geplant"
        let vorgang = null, offerOpen = null;
        if (x.status === "anfrage" || x.status === "aktiv") {
          // Projekte aus einer Buchung zeigen nur ihre eigenen Termine – zwei Anfragen desselben Kunden vermischen sich nicht
          const eigene = x.booking_id ? termineVonProjekt(x, now) : null;
          const termin = eigene ? eigene.naechster : db.prepare("SELECT id, title, start, video_url FROM appointments WHERE client_id = ? AND start >= ? ORDER BY start LIMIT 1").get(x.client_id, now) || null;
          const letztes = eigene ? eigene.letzter : db.prepare("SELECT id, title, start, notes_intern FROM appointments WHERE client_id = ? AND start < ? ORDER BY start DESC LIMIT 1").get(x.client_id, now) || null;
          const buchung = db.prepare("SELECT id, start FROM bookings WHERE client_id = ? AND status = 'neu' AND start >= ? AND id NOT IN (SELECT booking_id FROM appointments WHERE booking_id IS NOT NULL) ORDER BY start LIMIT 1").get(x.client_id, now) || null;
          offerOpen = db.prepare("SELECT id, number, gross, issue_date FROM invoices WHERE kind = 'angebot' AND locked = 1 AND status = 'versendet' AND (project_id = ? OR (project_id IS NULL AND client_id = ?)) ORDER BY id DESC LIMIT 1").get(x.id, x.client_id) || null;
          const entwurf = offerOpen ? null : db.prepare("SELECT id FROM invoices WHERE kind = 'angebot' AND locked = 0 AND (project_id = ? OR (project_id IS NULL AND client_id = ?)) LIMIT 1").get(x.id, x.client_id) || null;
          const [schritt, wer] = x.status === "aktiv" ? [4, "ich"] : offerOpen ? [2, "kunde"] : termin ? [1, "geplant"] : letztes ? [2, "ich"] : [0, "ich"];
          vorgang = { schritt, wer, termin, buchung, entwurf: !!entwurf,
            letztes: letztes ? { id: letztes.id, title: letztes.title, start: letztes.start, notiz: dev ? "" : (letztes.notes_intern || "") } : null,
            angebot: dev ? null : offerOpen };
        }
        const st = x.bereich === "hardware" ? null : letzterStand(x.id);
        return strip({ id: x.id, vorgang, fragebogen: fragebogenVonProjekt(x).stand, anfrage_art: x.anfrage_art || null, offerOpen: dev ? null : offerOpen, updated_at: x.updated_at, taeglich: !!x.daily_updates, notiz: x.next_note || "", vereinbarungen: dev ? [] : vereinbarungenVonProjekt(x.id),
          stand: st ? { version: st.version, at: st.created_at, text: x.stand_summary_ref === st.id ? (x.stand_summary || "") : (st.changes || "") } : null, title: x.title, bereich: x.bereich || "software", kind: x.kind, phase: x.phase, phaseIndex: PHASES.indexOf(x.phase), status: x.status, model: x.model,
          client: { id: x.client_id, company: x.company, name: x.client_name }, members: members(x.id), next, last_activity: last || x.updated_at, prototype: latest?.version || null,
          openNotes: db.prepare("SELECT COUNT(*) n FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE pr.project_id = ? AND a.status = 'offen'").get(x.id).n,
          unread: db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id = ? AND sender = 'client' AND read_at IS NULL AND (project_id = ? OR project_id IS NULL)").get(x.client_id, x.id).n,   // Chat dieses Projekts + „Allgemein“
          open_gross: Math.round(open * (1 + x.vat_rate / 100)), offer_net: x.offer_net });
      }));
    }
    // Gesamtverlauf eines Kontakts – Anfrage, Termine, Projekte, Angebote, Rechnungen, Chat
    let mt = p.match(/^\/clients\/(\d+)\/timeline$/);
    if (mt && m === "GET") {
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+mt[1]); if (!c) return json(res, 404, { error: "Nicht gefunden" });
      const items = [{ kind: "kontakt", at: c.created_at, title: "Kontakt angelegt", detail: c.source ? `Quelle: ${c.source}` : "" }];
      if (!dev) {
        for (const b of db.prepare("SELECT * FROM bookings WHERE client_id = ? OR lower(email) = ?").all(c.id, c.email))
          items.push({ kind: "buchung", at: b.created_at, title: `Termin gebucht: ${b.type === "erstgespraech" ? "Erstgespräch" : b.type}${b.product && b.product !== "Kundenportal" ? " – " + b.product : ""}`, detail: `${new Date(b.start).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" })} Uhr · ${b.status}${b.message ? "\n„" + b.message + "“" : ""}`, ref: { booking_id: b.id, status: b.status } });
        for (const q of db.prepare("SELECT * FROM requests WHERE client_id = ? OR lower(email) = ?").all(c.id, c.email))
          items.push({ kind: "lead", at: q.created_at, title: "Projektanfrage über die Website", detail: [q.kinds, q.model && `Modell: ${q.model}`, q.budget && `Budget: ${q.budget}`, q.timing && `Start: ${q.timing}`].filter(Boolean).join(" · ") + `\n${q.description}` });
        // Was die Automatik für diesen Kontakt verschickt hat (Erinnerungen, Nachfassen)
        try { for (const j of db.prepare("SELECT * FROM job_log WHERE client_id = ?").all(c.id))
          items.push({ kind: "automatik", at: j.created_at, title: j.kind === "erinnerung" ? "Automatische Terminerinnerung" : "Automatisch nachgefasst", detail: j.detail }); } catch {}
      }
      for (const a of db.prepare("SELECT a.*, p.title project_title FROM appointments a LEFT JOIN projects p ON p.id = a.project_id WHERE a.client_id = ?").all(c.id).filter(a => okP(a.project_id)))
        items.push({ kind: "termin", at: a.start, title: `${new Date(a.start) > new Date() ? "Geplant" : "Termin"}: ${a.title}`, detail: [a.project_title, a.summary ? "Zusammenfassung ✓" : new Date(a.start) < new Date() ? "Zusammenfassung fehlt" : "", a.video_url].filter(Boolean).join(" · "), future: new Date(a.start) > new Date() });
      for (const e of db.prepare("SELECT e.*, p.title project_title FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE e.client_id = ? AND e.kind NOT IN ('anmerkung','termin')").all(c.id).filter(e => !dev || (okP(e.project_id) && !FINANCE_EVENT_KINDS.includes(e.kind) && !/^(Rechnung|Angebot|Vertrag)/.test(e.title))))
        items.push({ kind: e.kind, at: e.created_at, title: e.title, detail: [e.detail, e.project_title].filter(Boolean).join(" · ") });
      const msgDays = db.prepare("SELECT substr(created_at,1,10) d, COUNT(*) n, MAX(created_at) at, SUM(sender = 'client') fromClient FROM messages WHERE client_id = ? GROUP BY d").all(c.id);
      for (const md of msgDays) items.push({ kind: "chat", at: md.at, title: `${md.n} Nachricht${md.n === 1 ? "" : "en"} im Chat`, detail: `${md.fromClient} vom Kunden, ${md.n - md.fromClient} vom Team` });
      const ts = s => Date.parse(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z");
      return json(res, 200, items.sort((a, b) => ts(b.at) - ts(a.at)));
    }
    mm = p.match(/^\/projects\/(\d+)$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]);
      if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
      if (m === "GET") return json(res, 200, strip({ ...projectDetail(pr, base, true), members: members(pr.id) }));
      if (m === "PATCH") {
        const d = await readJson(req);
        if (dev) for (const k of ["offer_net", "vat_rate", "conditions", "payments", "status"]) delete d[k];   // Entwickler ändern keine Finanzen/Status
        const next = { title: clean(d.title, 160) || pr.title, kind: d.kind !== undefined ? clean(d.kind, 80) : pr.kind, description: d.description !== undefined ? clean(d.description, 4000) : pr.description,
          phase: pick(d.phase, PHASES, pr.phase), model: d.model !== undefined ? clean(d.model, 80) : pr.model, status: pick(d.status, STATUSES, pr.status),
          offer_net: d.offer_net !== undefined ? cents(d.offer_net) : pr.offer_net, vat_rate: d.vat_rate !== undefined ? Math.min(30, Math.max(0, +d.vat_rate || 0)) : pr.vat_rate,
          conditions: d.conditions !== undefined ? clean(d.conditions, 4000) : pr.conditions };
        db.prepare("UPDATE projects SET title=?, kind=?, description=?, phase=?, model=?, status=?, offer_net=?, vat_rate=?, conditions=?, updated_at=datetime('now') WHERE id=?")
          .run(next.title, next.kind, next.description, next.phase, next.model, next.status, next.offer_net, next.vat_rate, next.conditions, pr.id);
        const nf = d.notify !== false;
        if (next.phase !== pr.phase) logEvent(pr.client_id, pr.id, "phase", `Neue Phase: ${next.phase}`, "", nf);
        if (next.status !== pr.status) logEvent(pr.client_id, pr.id, "status", next.status === "aktiv" ? "Projekt wieder aufgenommen" : `Projekt ${next.status}`, "", nf);
        if (next.offer_net !== pr.offer_net && next.offer_net != null) logEvent(pr.client_id, pr.id, "angebot", pr.offer_net == null ? "Kostenvoranschlag erstellt" : "Kostenvoranschlag angepasst", `${(next.offer_net / 100).toLocaleString("de-DE")} € netto`, nf);
        if (Array.isArray(d.payments)) {
          const before = new Map(db.prepare("SELECT * FROM payments WHERE project_id = ?").all(pr.id).map(x => [x.id, x]));
          const keep = new Set();
          d.payments.slice(0, 40).forEach((x, i) => {
            const label = clean(x.label, 120), amt = cents(x.amount_net); if (!label || amt === null) return;
            const status = pick(x.status, PAY_STATES, "offen"), old = before.get(+x.id);
            const paidAt = status === "bezahlt" ? (old?.paid_at || new Date().toISOString().slice(0, 10)) : null;
            const dueOn = DUE_ON.includes(x.due_on) ? x.due_on : null;
            if (old) { db.prepare("UPDATE payments SET label=?, amount_net=?, due=?, status=?, paid_at=?, sort=?, due_on=? WHERE id=?").run(label, amt, ymdOrNull(x.due), status, paidAt, i, dueOn, old.id); keep.add(old.id);
              if (old.status !== "bezahlt" && status === "bezahlt") logEvent(pr.client_id, pr.id, "zahlung", "Zahlungseingang bestätigt", `${label} · ${(amt / 100).toLocaleString("de-DE")} € netto`, nf); }
            else { const id = db.prepare("INSERT INTO payments(project_id, label, amount_net, due, status, paid_at, sort, due_on) VALUES(?,?,?,?,?,?,?,?)").run(pr.id, label, amt, ymdOrNull(x.due), status, paidAt, i, dueOn).lastInsertRowid; keep.add(id);
              if (status === "bezahlt") logEvent(pr.client_id, pr.id, "zahlung", "Zahlungseingang bestätigt", `${label} · ${(amt / 100).toLocaleString("de-DE")} € netto`, nf); }
          });
          for (const id of before.keys()) if (!keep.has(id)) db.prepare("DELETE FROM payments WHERE id = ?").run(id);
        }
        return json(res, 200, strip({ ...projectDetail(db.prepare("SELECT * FROM projects WHERE id = ?").get(pr.id), base, true), members: members(pr.id) }));
      }
      if (m === "DELETE") { db.prepare("DELETE FROM projects WHERE id = ?").run(pr.id); return json(res, 200, { ok: true }); }
    }
    mm = p.match(/^\/projects\/(\d+)\/members$/);
    if (mm && m === "PUT") {   // Team zuweisen (nur Inhaber – geprüft in access.mjs)
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
      const d = await readJson(req);
      db.prepare("DELETE FROM project_members WHERE project_id = ?").run(pr.id);
      for (const uid of (d.user_ids || []).slice(0, 50)) if (db.prepare("SELECT 1 FROM users WHERE id = ?").get(+uid)) db.prepare("INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES(?, ?)").run(pr.id, +uid);
      return json(res, 200, { members: members(pr.id) });
    }
    // Arbeitsstand eines Projekts: letzte Sitzung, Notiz fürs nächste Mal, Verlauf der letzten Tage, „tägliche Updates zugesagt“
    mm = p.match(/^\/projects\/(\d+)\/arbeitsstand$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]);
      if (!pr || (dev && !allowed.includes(pr.id))) return json(res, 404, { error: "Projekt nicht gefunden" });
      if (m === "PATCH") {
        const d = await readJson(req);
        if (d.notiz !== undefined) db.prepare("UPDATE projects SET next_note = ? WHERE id = ?").run(clean(d.notiz, 4000), pr.id);
        if (typeof d.taeglich === "boolean") db.prepare("UPDATE projects SET daily_updates = ? WHERE id = ?").run(d.taeglich ? 1 : 0, pr.id);
        return json(res, 200, { ok: true });
      }
      if (m === "GET") {
        const st = letzterStand(pr.id);
        const text = st ? (pr.stand_summary_ref === st.id ? pr.stand_summary : await standZusammenfassen(pr, st)) : "";
        const tagBerlin = t => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(t);
        const alle = db.prepare("SELECT version, created_at FROM prototypes WHERE project_id = ? AND state IS NULL AND created_at >= datetime('now','-15 days') ORDER BY id").all(pr.id);
        const verlauf = Array.from({ length: 10 }, (_, i) => { const tag = tagBerlin(new Date(Date.now() - (9 - i) * 864e5));
          return { tag, versionen: alle.filter(a => tagBerlin(new Date(String(a.created_at).replace(" ", "T") + "Z")) === tag).map(a => a.version) }; });
        return json(res, 200, { taeglich: !!pr.daily_updates, notiz: pr.next_note || "", letzter: st ? { version: st.version, at: st.created_at, zusammenfassung: text || "" } : null, verlauf });
      }
    }
    // Mitschrift auswerten (speichert nichts – das Ergebnis landet erst mit „Speichern“ im Termin)
    if (p === "/appointments/auswerten" && m === "POST") {
      const d = await readJson(req);
      const text = clean(d.mitschrift, 20000);
      if (text.length < 5) return json(res, 400, { error: "Bitte zuerst etwas in die Mitschrift schreiben." });
      const kunde = d.client_id ? db.prepare("SELECT name, company FROM clients WHERE id = ?").get(+d.client_id) : null;
      const projekt = d.project_id ? db.prepare("SELECT id, title FROM projects WHERE id = ?").get(+d.project_id) : null;
      try { return json(res, 200, await mitschriftAuswerten(text, { kunde: kunde ? [kunde.name, kunde.company].filter(Boolean).join(", ") : "", projekt: projekt?.title || "", projekt_id: projekt?.id || null })); }
      catch (e) { return json(res, e.status || 502, { error: e.status ? e.message : "Die Auswertung hat nicht geklappt. Bitte gleich noch einmal versuchen." }); }
    }
    mm = p.match(/^\/appointments\/(\d+)$/);
    if (mm) {
      const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(+mm[1]);
      if (!a) return json(res, 404, { error: "Termin nicht gefunden" });
      if (m === "GET") return json(res, 200, { id: a.id, notes_intern: a.notes_intern || "", summary: a.summary || "", next_steps: a.next_steps || "", mitschrift: a.mitschrift || "", start: a.start, title: a.title, project_id: a.project_id });
      if (m === "PATCH") {
        const d = await readJson(req);
        if (d.notes_intern !== undefined) db.prepare("UPDATE appointments SET notes_intern = ? WHERE id = ?").run(clean(d.notes_intern, 12000), a.id);
        if (d.mitschrift !== undefined) db.prepare("UPDATE appointments SET mitschrift = ? WHERE id = ?").run(clean(d.mitschrift, 20000), a.id);
        const projectId = d.project_id !== undefined ? (d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, a.client_id)?.id ?? null : null) : a.project_id;
        db.prepare("UPDATE appointments SET title=?, start=?, minutes=?, kind=?, summary=?, next_steps=?, project_id=? WHERE id=?")
          .run(clean(d.title, 160) || a.title, isoOrNull(d.start) || a.start, d.minutes !== undefined ? (Math.min(600, Math.max(0, +d.minutes || 0)) || null) : a.minutes,
            d.kind !== undefined ? clean(d.kind, 40) : a.kind, d.summary !== undefined ? clean(d.summary, 6000) : a.summary, d.next_steps !== undefined ? clean(d.next_steps, 3000) : a.next_steps, projectId, a.id);
        // Wird ein Termin aus einer Website-Buchung verlegt, zieht die Buchung mit (sonst zeigt der Kalender die alte Zeit)
        { const neu = isoOrNull(d.start); if (neu && neu !== a.start && a.booking_id) db.prepare("UPDATE bookings SET start = ? WHERE id = ?").run(neu, a.booking_id);
          if (neu && neu !== a.start && Date.parse(neu) > Date.now()) logEvent(a.client_id, projectId, "termin", "Termin verschoben", `${a.title}: neu am ${new Date(neu).toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} Uhr`, d.notify !== false); }
        if (d.summary && !a.summary) logEvent(a.client_id, projectId, "protokoll", "Zusammenfassung hinterlegt", a.title, d.notify !== false);
        return json(res, 200, apptOut(db.prepare("SELECT * FROM appointments WHERE id = ?").get(a.id)));
      }
      if (m === "DELETE") { db.prepare("DELETE FROM appointments WHERE id = ?").run(a.id); return json(res, 200, { ok: true }); }
    }
    mm = p.match(/^\/documents\/(\d+)(\/file)?$/);
    if (mm) {
      const d = db.prepare("SELECT * FROM documents WHERE id = ?").get(+mm[1]);
      if (!d) return json(res, 404, { error: "Nicht gefunden" });
      if (mm[2] && m === "GET") return sendDoc(res, d);
      if (!mm[2] && m === "DELETE") { db.prepare("UPDATE payments SET status = CASE WHEN status = 'berechnet' THEN 'offen' ELSE status END, invoice_doc_id = NULL WHERE invoice_doc_id = ?").run(d.id); await rm(path.join(DOC_DIR, d.file_token), { force: true }); db.prepare("DELETE FROM documents WHERE id = ?").run(d.id); return json(res, 200, { ok: true }); }
    }
    mm = p.match(/^\/prototypes\/(\d+)\/annotations$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM prototypes WHERE id = ?").get(+mm[1]);
      if (!pr) return json(res, 404, { error: "Prototyp nicht gefunden" });
      if (m === "GET") return json(res, 200, db.prepare(`${annSelect} WHERE a.prototype_id = ? ORDER BY a.id`).all(pr.id).map(annOut));
      if (m === "POST") return createAnnotation(req, res, pr, pr.client_id, "team", user.name);
    }
    mm = p.match(/^\/annotations\/(\d+)$/);
    if (mm) {
      const a = db.prepare("SELECT * FROM annotations WHERE id = ?").get(+mm[1]);
      if (!a) return json(res, 404, { error: "Nicht gefunden" });
      if (m === "PATCH") {
        const d = await readJson(req), status = d.status === "erledigt" ? "erledigt" : d.status === "offen" ? "offen" : a.status;
        db.prepare("UPDATE annotations SET status=?, reply=?, done_at=? WHERE id=?").run(status, d.reply !== undefined ? clean(d.reply, 2000) : a.reply, status === "erledigt" ? (a.done_at || new Date().toISOString()) : null, a.id);
        return json(res, 200, annOut(db.prepare(`${annSelect} WHERE a.id = ?`).get(a.id)));
      }
      if (m === "DELETE") { db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id); return json(res, 200, { ok: true }); }
    }
    return null;
  }

  return { portal, admin, logEvent, sendDigest, PHASES };
}
