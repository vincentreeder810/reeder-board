// Terminanfragen von Bestandskunden: Kunde wählt Anliegen + bis zu 3 Wunschtermine im Portal,
// das Team nimmt einen davon im Admin-Board an (→ Kalender, Portal, Verlauf, Mail) oder lehnt mit Antwort ab.
import { db, getSetting, DEFAULT_AVAILABILITY, DEFAULT_MAIL, videoUrl, chatProjekt } from "./db.mjs";
import { freeSlots, isSlotFree, formatDe, zonedParts } from "./slots.mjs";
import { sendMail, icsFor, icsCalendar } from "./mail.mjs";
import { vorlage, kalenderAnhang, marke } from "./mail-vorlagen.mjs";
import { firmaVonProjekt } from "./firmen.mjs";

export const onBooked = new Set();   // z. B. Vorab-Fragebogen nach einem vom Team eingeplanten Erstgespräch
export function createRequests({ json, readJson, clean, logEvent, SITE_URL }) {
  const av = () => getSetting("availability", DEFAULT_AVAILABILITY);
  const portalTypes = () => Object.entries(av().types).filter(([, t]) => t.portal && t.active !== false)
    .map(([key, t]) => ({ key, label: t.label, minutes: t.minutes, desc: t.desc || "" }));
  const typeLabel = key => av().types[key]?.label || key;
  const short = iso => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " Uhr";
  const reqOut = r => ({ id: r.id, type: r.type, label: typeLabel(r.type), minutes: r.minutes, project_id: r.project_id, project: r.project_title || null,
    slots: JSON.parse(r.slots || "[]").map(s => ({ start: s, free: r.status === "offen" ? isSlotFree(r.type, s) : undefined })), flexible: !!r.flexible,
    message: r.message, status: r.status, answer: r.answer, appointment_id: r.appointment_id, created_at: r.created_at, decided_at: r.decided_at,
    client_id: r.client_id, client: r.company ? { company: r.company, name: r.name } : undefined });
  const SELECT = "SELECT r.*, p.title project_title, c.company, c.name FROM appointment_requests r LEFT JOIN projects p ON p.id = r.project_id JOIN clients c ON c.id = r.client_id";
  // Termin fest eintragen: Kalender (Buchung), Termin beim Kunden, Video-Link, Einladung per Mail mit Kalenderdatei
  async function book({ c, type, start, minutes, title, projectId, channel = "Video", note = "", user, notify = true }) {
    const video = channel.includes("Video") ? videoUrl() : null;
    const proj = projectId ? db.prepare("SELECT title FROM projects WHERE id = ?").get(projectId)?.title : null;
    const b = db.prepare("INSERT INTO bookings(type, product, start, minutes, name, email, company, channel, message, status, client_id, video_url) VALUES(?,?,?,?,?,?,?,?,?, 'bestaetigt', ?, ?)")
      .run(type, proj || "Kundenportal", start, minutes, c.name, c.email, c.company, channel, note, c.id, video);
    const a = db.prepare("INSERT INTO appointments(client_id, project_id, title, start, minutes, kind, booking_id, video_url) VALUES(?,?,?,?,?,?,?,?)")
      .run(c.id, projectId || null, title, start, minutes, typeLabel(type), b.lastInsertRowid, video);
    db.prepare("UPDATE clients SET stage = 'interessent' WHERE id = ? AND stage = 'anfrage'").run(c.id);
    logEvent(c.id, projectId || null, "termin", "Termin vereinbart", `${title} · ${short(start)}`, false);
    let mailed = null;
    if (notify) {
      const firma = projectId ? firmaVonProjekt(projectId) : av().types[type]?.bereich === "hardware" ? "hardware" : "software";
      const ics = icsCalendar([icsFor({ id: b.lastInsertRowid, start, minutes, type, name: c.name, email: c.email, company: c.company, channel, status: "bestaetigt", video_url: video, typeLabel: typeLabel(type) }, { title: `${title} – ${marke(firma)}` })]);
      mailed = await sendMail({ to: c.email, ...vorlage("termin_einladung", { name: c.name, titel: title, start, minuten: minutes, videoUrl: video || "", kanal: channel, notiz: note,
          absender: user.name, portalLink: c.pw_hash ? `${SITE_URL}/portal/` : "", firma }),
        attachments: [kalenderAnhang(ics, "PUBLISH")] });
    }
    if (notify) { const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(b.lastInsertRowid); for (const fn of onBooked) Promise.resolve().then(() => fn(row)).catch(e => console.warn("Nach Buchung:", e.message)); }
    return { appointment_id: a.lastInsertRowid, booking_id: b.lastInsertRowid, video_url: video, mailed };
  }
  // Nachricht des Teams im Chat-Faden des Projekts (ohne Projekt: einziges Projekt des Kunden oder „Allgemein“)
  const teamMsg = (clientId, author, body, projectId = null) => db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id) VALUES(?, 'team', ?, ?, ?)").run(clientId, author, body, chatProjekt(clientId, projectId));

  /* ---------- Kundenportal ---------- */
  async function portal(req, res, url, p, c) {
    const m = req.method;
    if (p === "/booking-types" && m === "GET") return json(res, 200, portalTypes());
    if (p === "/slots" && m === "GET") {
      const type = clean(url.searchParams.get("type"), 40);
      if (!portalTypes().some(t => t.key === type)) return json(res, 400, { error: "Unbekannte Terminart" });
      const today = zonedParts(new Date(), "Europe/Berlin").ymd, to = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
      return json(res, 200, freeSlots(type, today, to));
    }
    if (p === "/requests" && m === "GET")
      return json(res, 200, db.prepare(`${SELECT} WHERE r.client_id = ? AND (r.status = 'offen' OR r.created_at > datetime('now', '-30 days')) AND r.status != 'zurückgezogen' ORDER BY r.id DESC`).all(c.id).map(reqOut));
    if (p === "/requests" && m === "POST") {
      const d = await readJson(req);
      const t = portalTypes().find(x => x.key === d.type);
      if (!t) return json(res, 400, { error: "Bitte wählen Sie, worum es geht." });
      const slots = [...new Set((Array.isArray(d.slots) ? d.slots : []).slice(0, 3).map(s => { const x = Date.parse(s); return Number.isFinite(x) ? new Date(x).toISOString() : null; }).filter(Boolean))];
      if (slots.some(s => !isSlotFree(t.key, s))) return json(res, 409, { error: "Einer der gewählten Termine ist gerade vergeben worden. Bitte wählen Sie neu." });
      if (!slots.length && !d.flexible) return json(res, 400, { error: "Bitte wählen Sie mindestens einen Wunschtermin – oder „Ich bin flexibel“." });
      if (db.prepare("SELECT COUNT(*) n FROM appointment_requests WHERE client_id = ? AND status = 'offen'").get(c.id).n >= 5) return json(res, 429, { error: "Sie haben bereits mehrere offene Anfragen. Wir melden uns in Kürze." });
      const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null;
      const message = clean(d.message, 2000);
      const r = db.prepare("INSERT INTO appointment_requests(client_id, project_id, type, minutes, slots, flexible, message) VALUES(?,?,?,?,?,?,?)")
        .run(c.id, projectId, t.key, t.minutes, JSON.stringify(slots), d.flexible ? 1 : 0, message);
      const proj = projectId ? db.prepare("SELECT title FROM projects WHERE id = ?").get(projectId).title : null;
      // Im Chat sichtbar machen (Kunde und Team sehen die Anfrage im Verlauf)
      db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id) VALUES(?, 'client', ?, ?, ?)").run(c.id, c.name,
        `📅 Terminanfrage: ${t.label} (${t.minutes} Min.)${proj ? "\nProjekt: " + proj : ""}\n${slots.length ? "Wunschtermine:\n" + slots.map(s => "• " + short(s)).join("\n") : "Ich bin flexibel – bitte schlagen Sie mir einen Termin vor."}${d.flexible && slots.length ? "\n(Andere Zeiten gehen auch.)" : ""}${message ? "\n\n" + message : ""}`, chatProjekt(c.id, projectId));
      sendMail({ to: getSetting("mail", DEFAULT_MAIL).notifyAddress, ...vorlage("terminanfrage_team", { name: c.name, unternehmen: c.company, art: t.label, minuten: t.minutes, projekt: proj || "",
        wunsch: slots, nachricht: message, link: `${SITE_URL}/admin/#kunden/${c.id}/termine`, firma: projectId ? firmaVonProjekt(projectId) : "software" }) }).catch(e => console.warn("Mail:", e.message));
      return json(res, 201, reqOut(db.prepare(`${SELECT} WHERE r.id = ?`).get(r.lastInsertRowid)));
    }
    const mm = p.match(/^\/requests\/(\d+)$/);
    if (mm && m === "DELETE") {
      const r = db.prepare("SELECT * FROM appointment_requests WHERE id = ? AND client_id = ? AND status = 'offen'").get(+mm[1], c.id);
      if (!r) return json(res, 404, { error: "Anfrage nicht gefunden oder schon bearbeitet." });
      db.prepare("UPDATE appointment_requests SET status = 'zurückgezogen', decided_at = datetime('now') WHERE id = ?").run(r.id);
      db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id) VALUES(?, 'client', ?, ?, ?)").run(c.id, c.name, `Terminanfrage „${typeLabel(r.type)}“ zurückgezogen.`, chatProjekt(c.id, r.project_id));
      return json(res, 200, { ok: true });
    }
    return null;
  }

  /* ---------- Admin ---------- */
  async function admin(req, res, url, p, user) {
    const m = req.method;
    if (p === "/slots" && m === "GET") {
      const type = clean(url.searchParams.get("type"), 40); if (!av().types[type]) return json(res, 400, { error: "Unbekannte Terminart" });
      const today = zonedParts(new Date(), "Europe/Berlin").ymd, to = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
      return json(res, 200, { types: Object.entries(av().types).filter(([, t]) => t.active !== false).map(([key, t]) => ({ key, label: t.label, minutes: t.minutes, portal: !!t.portal })), days: freeSlots(type, today, to) });
    }
    let ms = p.match(/^\/clients\/(\d+)\/schedule$/);
    if (ms && m === "POST") {
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+ms[1]); if (!c) return json(res, 404, { error: "Kontakt nicht gefunden" });
      const d = await readJson(req), type = av().types[d.type] ? d.type : "erstgespraech";
      const t = Date.parse(d.start); if (!Number.isFinite(t)) return json(res, 400, { error: "Bitte einen Termin wählen." });
      const iso = new Date(t).toISOString();
      if (!d.force && !isSlotFree(type, iso)) return json(res, 409, { error: "Dieser Zeitpunkt ist schon belegt.", taken: true });
      const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null;
      const bk = await book({ c, type, start: iso, minutes: Math.min(600, Math.max(5, +d.minutes || av().types[type].minutes)), title: clean(d.title, 160) || typeLabel(type),
        projectId, channel: clean(d.channel, 30) || "Video", note: clean(d.note, 2000), user, notify: d.notify !== false });
      if (c.pw_hash) teamMsg(c.id, user.name, `Neuer Termin: ${clean(d.title, 160) || typeLabel(type)}, ${formatDe(iso)}.${bk.video_url ? `\nZum Videogespräch: ${bk.video_url}` : ""}`, projectId);
      return json(res, 201, bk);
    }
    let mm = p.match(/^\/clients\/(\d+)\/requests$/);
    if (mm && m === "GET") return json(res, 200, db.prepare(`${SELECT} WHERE r.client_id = ? AND r.status != 'zurückgezogen' ORDER BY r.status != 'offen', r.id DESC LIMIT 50`).all(+mm[1]).map(reqOut));
    if (p === "/requests" && m === "GET") return json(res, 200, db.prepare(`${SELECT} WHERE r.status = 'offen' ORDER BY r.id`).all().map(reqOut));
    mm = p.match(/^\/requests\/(\d+)\/(accept|decline)$/);
    if (!mm || m !== "POST") return null;
    const r = db.prepare("SELECT * FROM appointment_requests WHERE id = ?").get(+mm[1]);
    if (!r) return json(res, 404, { error: "Anfrage nicht gefunden" });
    if (r.status !== "offen") return json(res, 409, { error: "Diese Anfrage wurde bereits bearbeitet." });
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(r.client_id);
    const d = await readJson(req);
    if (mm[2] === "decline") {
      const answer = clean(d.answer, 2000);
      db.prepare("UPDATE appointment_requests SET status = 'abgelehnt', answer = ?, decided_at = datetime('now') WHERE id = ?").run(answer, r.id);
      teamMsg(c.id, user.name, `Zu Ihrer Terminanfrage „${typeLabel(r.type)}“: ${answer || "Leider passt keiner der Wunschtermine. Wir melden uns mit einem neuen Vorschlag."}`, r.project_id);
      return json(res, 200, { ok: true });
    }
    // Annehmen: einen der Wunschtermine – oder eine eigene Zeit
    const start = Date.parse(d.start); if (!Number.isFinite(start)) return json(res, 400, { error: "Bitte einen Termin wählen." });
    const iso = new Date(start).toISOString(), minutes = Math.min(600, Math.max(5, +d.minutes || r.minutes));
    if (!d.force && !isSlotFree(r.type, iso)) return json(res, 409, { error: "Dieser Zeitpunkt ist inzwischen belegt.", taken: true });
    const title = clean(d.title, 160) || typeLabel(r.type);
    const bk = await book({ c, type: r.type, start: iso, minutes, title, projectId: r.project_id, channel: clean(d.channel, 30) || "Video", note: r.message || "", user, notify: d.notify !== false });
    db.prepare("UPDATE appointment_requests SET status = 'angenommen', appointment_id = ?, decided_at = datetime('now') WHERE id = ?").run(bk.appointment_id, r.id);
    teamMsg(c.id, user.name, `Ihr Termin ist bestätigt: ${title}, ${formatDe(iso)} (${minutes} Min.).${bk.video_url ? `\nZum Videogespräch: ${bk.video_url}` : ""}`, r.project_id);
    return json(res, 200, { ok: true, ...bk });
  }

  const openCount = () => db.prepare("SELECT COUNT(*) n FROM appointment_requests WHERE status = 'offen'").get().n;
  return { portal, admin, openCount };
}
