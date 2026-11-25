// Reeder Software – Website-Server mit Termin-API und Admin-Board.
// Start: npm start   (läuft lokal unter http://localhost:5510)
import http from "node:http";
import { readFile, stat, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, getSetting, setSetting, DEFAULT_AVAILABILITY, DEFAULT_MAIL, DEFAULT_COMPANY, calendarToken, resetCalendarToken, upsertLead, videoUrl, STAGES } from "./db.mjs";
import { guard, isOwner, ROLES, memberProjectIds, clientIdsFor } from "./access.mjs";
import { freeSlots, isSlotFree, formatDe, zonedParts, ACTIVE_STATES } from "./slots.mjs";
import { sendMail, mailStatus, icsFor, icsCalendar, reloadSmtp, testSmtp } from "./mail.mjs";
import { createPortal } from "./portal.mjs";
import { createFinance } from "./finance.mjs";
import { createAutomation } from "./automation.mjs";
import { createContracts } from "./contracts.mjs";
import { createSubscriptions } from "./subscriptions.mjs";
import { createWork } from "./work.mjs";
import { createStand } from "./stand.mjs";
import { createAssistant } from "./assistant.mjs";
import { createAuftrag } from "./auftrag.mjs";
import { createPruefung } from "./pruefung.mjs";
import { createVorab, answersView } from "./vorab.mjs";
import { createCovered } from "./covered.mjs";
import { onBooked } from "./requests.mjs";
import { createKpi } from "./kpi.mjs";
import { createSupport } from "./support.mjs";
import { createOps } from "./ops.mjs";
import { createSecurity } from "./security.mjs";
import { createHardware } from "./hardware.mjs";
import { DEFAULT_HARDWARE } from "./firmen.mjs";
import { createVereinbarungen } from "./vereinbarungen.mjs";
import { createOnboarding, fragebogenStand } from "./onboarding.mjs";
// Cookie-Name je Instanz (Demo-Board läuft parallel auf demselben localhost)
const ADMIN_CK = `${process.env.COOKIE_PREFIX || "rs"}_admin`;

const ROOT = path.resolve(".");
const PORT = Number(process.env.PORT || 5510);
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

/* ================= Erster Admin ================= */
function hashPw(pw) { const salt = randomBytes(16); return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`; }
function checkPw(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split("$");
  if (!saltHex || !hashHex) return false;
  const h = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(h, Buffer.from(hashHex, "hex"));
}
if (!db.prepare("SELECT COUNT(*) n FROM users").get().n) {
  let email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) {
    email = email || "admin@reeder-software.de";
    pw = randomBytes(9).toString("base64url");
    await appendFile(".env", `\n# Erster Admin-Zugang (bitte im Admin-Board unter Einstellungen ändern)\nADMIN_EMAIL=${email}\nADMIN_PASSWORD=${pw}\n`);
    console.log("Admin-Zugang angelegt – die Zugangsdaten stehen in der Datei .env");
  }
  db.prepare("INSERT INTO users(email, name, pw_hash) VALUES(?, ?, ?)").run(email.toLowerCase(), "Admin", hashPw(pw));
}

/* ================= Helfer ================= */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
// Sicherheits-Header für jede Antwort; HSTS nur, wenn die Seite über https läuft
const SEC_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()", "Cross-Origin-Opener-Policy": "same-origin",
  ...(String(process.env.SITE_URL || "").startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}) };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SEC_HEADERS, ...headers }); res.end(body); };
const json = (res, code, obj, headers = {}) => send(res, code, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
async function readJson(req, max = 64 * 1024) {
  if (!String(req.headers["content-type"] || "").includes("application/json")) throw Object.assign(new Error("JSON erwartet"), { code: 415 });
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("Zu groß"), { code: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Ungültiges JSON"), { code: 400 }); }
}
const clean = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(key, list); return list.length > max;
}
const ipOf = req => req.socket.remoteAddress || "?";
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map(c => c.trim().split("=").map(decodeURIComponent)).filter(p => p[0])); }
function currentUser(req) {
  const t = cookies(req)[ADMIN_CK]; if (!t) return null;
  const row = db.prepare("SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(t);
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}
const portal = createPortal({ json, send, readJson, clean, isEmail, limited, ipOf, cookies, hashPw, checkPw, SITE_URL });
const finance = createFinance({ json, send, readJson, clean, logEvent: (...a) => portal.logEvent(...a), SITE_URL, inviteLink: id => portal.newInvite(id) });
const automation = createAutomation({ json, readJson, clean, SITE_URL });
const contracts = createContracts({ json, readJson, clean, logEvent: (...a) => portal.logEvent(...a), SITE_URL });
contracts.onChange = () => automation.run();
portal.extend(contracts.portal);
const subs = createSubscriptions({ json, readJson, clean });
portal.extend(subs.portal);
const support = createSupport({ json, readJson, clean, SITE_URL });
const vereinbarungen = createVereinbarungen({ json, readJson, clean });
const hardware = createHardware({ json, send, readJson, clean, logEvent: (...a) => portal.logEvent(...a), SITE_URL });
const onboarding = createOnboarding({ json, readJson, clean, limited, ipOf, SITE_URL, hashPw, checkPw, currentClient: (...a) => portal.currentClient(...a), clientLogin: (...a) => portal.clientLogin(...a) });
portal.extend(support.portal);
const ops = createOps({ json, send, readJson, clean, automationStatus: () => automation.status() });
automation.extend(h => support.housekeeping(h));
automation.extend(h => ops.runMonitors(h));
automation.extend(() => ops.dailyBackup());
const kpi = createKpi({ json, subs, support });
const security = createSecurity({ json, readJson, clean, limited, ipOf, hashPw, checkPw, SITE_URL, issueAdmin: (res, id, extra = {}) => adminSession(res, id, { to: "/admin/", ...extra }) });
const work = createWork({ json, readJson, clean, logEvent: (...a) => portal.logEvent(...a) });
const stand = createStand({ json, readJson, clean, limited, ipOf, logEvent: (...a) => portal.logEvent(...a) });
portal.extend(stand.portal);
const assistant = createAssistant({ json, readJson, clean, limited });
portal.extend(assistant.portal);
const auftrag = createAuftrag({ json, readJson, clean, stand });
automation.extend(h => auftrag.automation(h));
const pruefung = createPruefung({ json, readJson, clean, base: `http://127.0.0.1:${PORT}`, stand, logEvent: (...a) => portal.logEvent(...a) });
automation.extend(() => pruefung.housekeeping());
const vorab = createVorab({ json, readJson, limited, ipOf, SITE_URL, hashPw, checkPw, currentClient: portal.currentClient, clientLogin: portal.clientLogin });
onBooked.add(b => vorab.invite(b));
const covered = createCovered({ json, readJson, SITE_URL });
automation.extend(() => covered.sync());
const typeLabel = key => (getSetting("availability", DEFAULT_AVAILABILITY).types[key] || {}).label || key;

/* ================= E-Mail-Texte ================= */
const sig = () => `\n\nViele Grüße\nIhr Team der Reeder Software GmbH\n${SITE_URL}`;
const typePrice = key => +(getSetting("availability", DEFAULT_AVAILABILITY).types[key]?.price || 0);
// Info an Reeder: neuer Termin direkt über die Website gebucht (ist schon bestätigt)
async function mailNewBookingToTeam(b) {
  const when = formatDe(b.start), cfg = getSetting("mail", DEFAULT_MAIL), price = typePrice(b.type);
  await sendMail({ to: cfg.notifyAddress, subject: `Neuer Termin gebucht: ${typeLabel(b.type)} mit ${b.name} – ${when}`,
    text: `${typeLabel(b.type)}${b.product ? " – " + b.product : ""}\n${when} (${b.minutes} Min)${price ? `\nKostenpflichtig: ${price} € zzgl. MwSt. – Rechnung nach dem Termin` : ""}\n\nName: ${b.name}\nE-Mail: ${b.email}\nTelefon: ${b.phone || "–"}\nUnternehmen: ${b.company || "–"}\nGespräch: ${b.channel || "–"}${b.video_url ? `\nVideo: ${b.video_url}` : ""}\n\n${b.message || ""}\n\nDer Termin ist bereits bestätigt und steht im Kalender: ${SITE_URL}/admin/#termine` });
}
async function mailForStatus(b, status) {
  const when = formatDe(b.start);
  if (status === "bestaetigt") {
    const ics = icsCalendar([icsFor({ ...b, status, typeLabel: typeLabel(b.type) }, { title: `${typeLabel(b.type)} – Reeder Software` })]);
    const price = typePrice(b.type);
    return sendMail({ to: b.email, subject: `Bestätigt: ${typeLabel(b.type)} am ${when}`,
      text: `Hallo ${b.name},\n\nIhr Termin ist bestätigt:\n\n${typeLabel(b.type)}${b.product ? " – " + b.product : ""}\n${when} (${b.minutes} Minuten)\n${b.video_url && (b.channel || "Video").includes("Video") ? `\nZum Videogespräch (einfach zur Uhrzeit anklicken – ohne Anmeldung, ohne Installation):\n${b.video_url}\n` : `Gesprächsart: ${b.channel}\n`}${price ? `\nKosten: ${price} € zzgl. MwSt. Die Rechnung bekommen Sie nach dem Termin.\n` : ""}${b.type === "erstgespraech" ? `\nIn einer zweiten E-Mail schicken wir Ihnen gleich einen kurzen Fragebogen. Daraus bereiten wir schon vor dem Termin einen ersten Entwurf für Sie vor.\n` : ""}\nDen Termin für Ihren Kalender finden Sie im Anhang. Falls Sie den Termin verschieben müssen, antworten Sie einfach auf diese E-Mail.${sig()}`,
      attachments: [{ filename: "termin-reeder-software.ics", content: ics, contentType: "text/calendar" }] });
  }
  if (status === "abgesagt") {
    return sendMail({ to: b.email, subject: `Ihr Termin am ${when}`,
      text: `Hallo ${b.name},\n\nleider können wir den Termin am ${when} nicht wahrnehmen. Bitte wählen Sie einen neuen Termin unter ${SITE_URL}/termin.html – oder antworten Sie einfach auf diese E-Mail.${sig()}` });
  }
}

// Termin festmachen: Videolink, Kontakt, Termin beim Kunden (Kalender), Stufe „Interessent“. Gibt die aktuelle Buchung zurück.
function confirmBooking(b, source) {
  if (!b.video_url && (b.channel || "Video").includes("Video")) { b.video_url = videoUrl(); db.prepare("UPDATE bookings SET video_url = ? WHERE id = ?").run(b.video_url, b.id); }
  const cid = b.client_id || upsertLead({ email: b.email, name: b.name, company: b.company, phone: b.phone, source });
  db.prepare("UPDATE bookings SET client_id = ? WHERE id = ?").run(cid, b.id);
  if (!db.prepare("SELECT 1 FROM appointments WHERE booking_id = ?").get(b.id))
    db.prepare("INSERT INTO appointments(client_id, title, start, minutes, kind, summary, booking_id, video_url) VALUES(?,?,?,?,?,?,?,?)")
      .run(cid, typeLabel(b.type) + (b.product ? " – " + b.product : ""), b.start, b.minutes, typeLabel(b.type), null, b.id, b.video_url || null);   // Anliegen bleibt an der Buchung (Kalender zeigt es unter „Vorbereitung“); die Zusammenfassung sieht der Kunde im Portal
  db.prepare("UPDATE clients SET stage = 'interessent' WHERE id = ? AND stage = 'anfrage'").run(cid);
  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(b.id);
}

/* ================= Öffentliche API ================= */
async function publicApi(req, res, url) {
  const p = url.pathname;
  if (p === "/api/ping") return json(res, 200, { ok: true });
  if (p === "/api/slots" && req.method === "GET") {
    const type = clean(url.searchParams.get("type"), 40), from = clean(url.searchParams.get("from"), 10), to = clean(url.searchParams.get("to"), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json(res, 400, { error: "Datum fehlt" });
    if (getSetting("availability", DEFAULT_AVAILABILITY).types[type]?.portal) return json(res, 200, { days: {} });
    return json(res, 200, { days: freeSlots(type, from, to) });
  }
  if (p === "/api/next-slot" && req.method === "GET") {
    const tz = getSetting("availability", DEFAULT_AVAILABILITY).timeZone, from = zonedParts(new Date(), tz).ymd;
    const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const days = freeSlots("erstgespraech", from, to), first = Object.keys(days).sort()[0];
    return json(res, 200, first ? { day: first, t: days[first][0].t, start: days[first][0].start } : {});
  }
  if (p === "/api/bookings" && req.method === "POST") {
    if (limited("b:" + ipOf(req), 8, 3600000)) return json(res, 429, { error: "Zu viele Anfragen – bitte später erneut versuchen." });
    const d = await readJson(req);
    if (d.website) return json(res, 200, { ok: true });               // Spam-Falle
    const av = getSetting("availability", DEFAULT_AVAILABILITY);
    const type = clean(d.type, 40), t = av.types[type];
    const topics = (Array.isArray(d.topics) ? d.topics : []).map(x => clean(x, 60)).filter(Boolean).slice(0, 12);
    const b = { type, product: clean(d.product, 80), start: clean(d.start, 40), name: clean(d.name, 120), email: clean(d.email, 160).toLowerCase(),
      phone: clean(d.phone, 40), company: clean(d.company, 160), channel: clean(d.channel, 30),
      message: [topics.length && `Themen: ${topics.join(", ")}`, clean(d.message, 3000)].filter(Boolean).join("\n\n") };
    if (!t || t.portal || !b.name || !isEmail(b.email) || !Date.parse(b.start)) return json(res, 400, { error: "Bitte prüfen Sie Ihre Angaben." }); // Kundenportal-Termine nur über das Portal
    if (!isSlotFree(type, b.start)) return json(res, 409, { error: "Dieser Termin ist leider nicht mehr frei." });
    b.start = new Date(b.start).toISOString(); b.minutes = t.minutes;
    // Direkt verbindlich gebucht: Termin steht sofort fest (Kalender, Kunde, Videolink), dann Bestätigung, Info ans Team und – beim Erstgespräch – der Fragebogen
    const r = db.prepare("INSERT INTO bookings(type, product, start, minutes, name, email, phone, company, channel, message, status) VALUES(?,?,?,?,?,?,?,?,?,?, 'bestaetigt')")
      .run(b.type, b.product, b.start, b.minutes, b.name, b.email, b.phone, b.company, b.channel, b.message);
    const row = confirmBooking(db.prepare("SELECT * FROM bookings WHERE id = ?").get(r.lastInsertRowid), "Website-Termin");
    // Welches Onboarding? "Worum geht es?" kennt Website, Software und Hardware (Mehrfachauswahl); Hardware-Terminarten zählen immer als Hardware.
    // Website → der bildhafte Fragebogen mit KI-Entwurf (vorab.mjs). Software/Hardware → Fragen ohne Entwurf (onboarding.mjs).
    const gewaehlt = new Set(topics.map(t => /^website$/i.test(t) ? "website" : /^hardware$/i.test(t) ? "hardware" : "software"));
    if (bereichOfType(type) === "hardware") gewaehlt.add("hardware");
    const weitere = [...gewaehlt].filter(k => k !== "website");
    (async () => { await mailForStatus(row, "bestaetigt"); await mailNewBookingToTeam(row);
      if (gewaehlt.has("website") || !gewaehlt.size) await vorab.invite(row);
      if (weitere.length) await onboarding.invite(row, weitere); })().catch(e => console.warn("Mail:", e.message));
    return json(res, 201, { ok: true, id: row.id, status: "bestaetigt", video_url: row.video_url || null });
  }
  if (p === "/api/requests" && req.method === "POST") {
    if (limited("r:" + ipOf(req), 8, 3600000)) return json(res, 429, { error: "Zu viele Anfragen – bitte später erneut versuchen." });
    const d = await readJson(req);
    if (d.website) return json(res, 200, { ok: true });
    const q = { kinds: clean(d.kinds, 400), model: clean(d.model, 80), budget: clean(d.budget, 80), timing: clean(d.timing, 80), description: clean(d.description, 5000),
      name: clean(d.name, 120), email: clean(d.email, 160).toLowerCase(), phone: clean(d.phone, 40), company: clean(d.company, 160) };
    if (!q.name || !isEmail(q.email) || !q.description) return json(res, 400, { error: "Bitte prüfen Sie Ihre Angaben." });
    const r = db.prepare("INSERT INTO requests(kinds, model, budget, timing, description, name, email, phone, company) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(q.kinds, q.model, q.budget, q.timing, q.description, q.name, q.email, q.phone, q.company);
    const cfg = getSetting("mail", DEFAULT_MAIL);
    Promise.all([
      sendMail({ to: q.email, subject: "Ihre Projektanfrage bei Reeder Software", text: `Hallo ${q.name},\n\nvielen Dank für Ihre Anfrage. Wir melden uns innerhalb eines Werktags mit ersten Gedanken und einem Terminvorschlag.\n\nIhre Angaben:\n${q.kinds || "–"}\nModell: ${q.model || "–"}\n\n${q.description}${sig()}` }),
      sendMail({ to: cfg.notifyAddress, subject: `Neue Projektanfrage: ${q.name}${q.company ? " (" + q.company + ")" : ""}`, text: `Art: ${q.kinds || "–"}\nModell: ${q.model || "–"}\nBudget: ${q.budget || "–"}\nStart: ${q.timing || "–"}\n\nName: ${q.name}\nE-Mail: ${q.email}\nTelefon: ${q.phone || "–"}\nUnternehmen: ${q.company || "–"}\n\n${q.description}\n\n${SITE_URL}/admin` }),
    ]).catch(e => console.warn("Mail:", e.message));
    db.prepare("UPDATE requests SET client_id = ? WHERE id = ?").run(upsertLead({ email: q.email, name: q.name, company: q.company, phone: q.phone, source: "Projektanfrage" }), r.lastInsertRowid);
    return json(res, 201, { ok: true, id: r.lastInsertRowid });
  }
  const cal = p.match(/^\/calendar\/([a-f0-9]{48})\.ics$/);
  if (cal && req.method === "GET") {
    if (cal[1] !== calendarToken()) return send(res, 404, "Nicht gefunden");
    const rows = db.prepare(`SELECT * FROM bookings WHERE status IN (${ACTIVE_STATES.map(() => "?").join(",")}) AND start > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-60 days')`).all(...ACTIVE_STATES);
    const events = rows.map(b => icsFor({ ...b, typeLabel: typeLabel(b.type) }, { title: `${b.status === "neu" ? "Anfrage: " : ""}${typeLabel(b.type)} – ${b.name}` }));
    return send(res, 200, icsCalendar(events), { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" });
  }
  return null;
}

/* ================= Gemeinsame Anmeldung ================= */
// Eine Adresse für alle: Team-Zugänge landen im Admin-Board, Kunden im Kundenportal.
function adminSession(res, userId, extra = {}) {
  const token = randomBytes(32).toString("hex"), days = 14;
  db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)").run(token, userId, Date.now() + days * 86400000);
  return json(res, 200, { ok: true, ...extra }, { "Set-Cookie": `${ADMIN_CK}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${days * 86400}${SITE_URL.startsWith("https") ? "; Secure" : ""}` });
}
async function unifiedLogin(req, res) {
  if (limited("login:" + ipOf(req), 10, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." });
  const d = await readJson(req), email = clean(d.email, 160).toLowerCase(), pw = String(d.password || "");
  const u = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
  if (u && checkPw(pw, u.pw_hash)) { if (!u.totp_enabled) db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id); return security.afterPassword(req, res, u); }
  const c = db.prepare("SELECT * FROM clients WHERE email = ? AND active = 1").get(email);
  if (c && c.pw_hash && checkPw(pw, c.pw_hash)) { security.log("client", c.id, c.email, req, true); return portal.clientLogin(res, c.id, { to: "/portal/" }); }
  security.failed(req, u ? "team" : c ? "client" : "unbekannt", u?.id ?? c?.id, email, "falsches Passwort");
  return json(res, 401, { error: "E-Mail oder Passwort ist falsch." });
}

/* ================= Cockpit & Posteingang (je nach Rolle) ================= */
const inList = (ids, col) => ids === null ? "1=1" : ids.length ? `${col} IN (${ids.map(Number).join(",")})` : "0=1";
function cockpit(user) {
  const owner = isOwner(user), cids = clientIdsFor(user), pids = memberProjectIds(user);
  const one = sql => db.prepare(sql).get().n;
  const cw = inList(cids, "client_id"), pw = inList(pids, "p.id");
  const projects = db.prepare(`SELECT p.*, c.company FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.status = 'aktiv' AND ${pw} ORDER BY p.updated_at DESC`).all();
  const nowIso = new Date().toISOString(), dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const today = db.prepare(`SELECT a.*, c.company, p.title project FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.start >= ? AND a.start <= ? AND ${inList(cids, "a.client_id")} ${pids ? `AND (a.project_id IS NULL OR ${inList(pids, "a.project_id")})` : ""} ORDER BY a.start`).all(new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), dayEnd.toISOString());
  const week = db.prepare(`SELECT a.*, c.company, p.title project FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.start > ? AND a.start <= ? AND ${inList(cids, "a.client_id")} ${pids ? `AND (a.project_id IS NULL OR ${inList(pids, "a.project_id")})` : ""} ORDER BY a.start LIMIT 8`).all(dayEnd.toISOString(), new Date(Date.now() + 7 * 86400000).toISOString());
  const missingSummary = db.prepare(`SELECT a.*, c.company FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.start < ? AND a.start > ? AND (a.summary IS NULL OR a.summary = '') AND ${inList(cids, "a.client_id")} ORDER BY a.start DESC LIMIT 5`).all(nowIso, new Date(Date.now() - 30 * 86400000).toISOString());
  const out = {
    owner, name: user.name.split(" ")[0],
    unread: one(`SELECT COUNT(*) n FROM messages WHERE sender = 'client' AND read_at IS NULL AND ${cw}`),
    openRequests: one(`SELECT COUNT(*) n FROM appointment_requests WHERE status = 'offen' AND ${cw}`),
    openNotes: one(`SELECT COUNT(*) n FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE a.status = 'offen' AND ${inList(cids, "a.client_id")} ${pids ? `AND (pr.project_id IS NULL OR ${inList(pids, "pr.project_id")})` : ""}`),
    clients: cids === null ? one("SELECT COUNT(*) n FROM clients WHERE active = 1") : cids.length,
    projects: projects.map(p => ({ id: p.id, client_id: p.client_id, title: p.title, company: p.company, phase: p.phase })),
    phases: ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"],
    today: today.map(a => ({ id: a.id, client_id: a.client_id, title: a.title, start: a.start, minutes: a.minutes, company: a.company, project: a.project })),
    week: week.map(a => ({ id: a.id, client_id: a.client_id, title: a.title, start: a.start, company: a.company, project: a.project })),
    nudges: automation.countFor(user),
    missingSummary: missingSummary.map(a => ({ id: a.id, client_id: a.client_id, title: a.title, start: a.start, company: a.company })),
  };
  if (owner) {
    const gross = "ROUND(pay.amount_net * (1 + p.vat_rate / 100.0))";
    out.newBookings = one("SELECT COUNT(*) n FROM bookings WHERE status = 'neu'");
    // Für die Zähler in der Navigation: wann kamen Kontakte im Vertrieb und kommende Termine dazu? Der Browser vergleicht mit „zuletzt angesehen“.
    out.kontakteNeu = db.prepare("SELECT created_at FROM clients WHERE stage IN ('anfrage','interessent') AND created_at >= datetime('now','-30 days')").all().map(r => r.created_at);
    out.termineNeu = [...db.prepare("SELECT created_at FROM appointments WHERE start >= ? AND created_at >= datetime('now','-30 days')").all(new Date().toISOString()),
      ...db.prepare("SELECT created_at FROM bookings WHERE start >= ? AND status = 'neu' AND created_at >= datetime('now','-30 days')").all(new Date().toISOString())].map(r => r.created_at);
    // Neue Projektanfragen = Kontakte, mit denen noch kein Gespräch vereinbart ist (danach zählen sie nicht mehr als „neu“)
    out.newLeads = one("SELECT COUNT(*) n FROM requests r WHERE r.status = 'neu' AND (r.client_id IS NULL OR (r.client_id IN (SELECT id FROM clients WHERE stage = 'anfrage') AND r.client_id NOT IN (SELECT client_id FROM appointments)))");
    out.receivables = db.prepare(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status != 'bezahlt'`).get().s;
    out.invoiced = db.prepare(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status = 'berechnet'`).get().s;
    out.overdue = db.prepare(`SELECT pay.label, pay.due, ${gross} gross, p.title project, p.client_id, c.company FROM payments pay JOIN projects p ON p.id = pay.project_id JOIN clients c ON c.id = p.client_id WHERE pay.status != 'bezahlt' AND pay.due IS NOT NULL AND pay.due < date('now') ORDER BY pay.due`).all();
    const y = new Date().getFullYear(), mth = new Date().toISOString().slice(0, 7);
    out.paidMonth = db.prepare(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status = 'bezahlt' AND substr(pay.paid_at,1,7) = ?`).get(mth).s;
    out.paidYear = db.prepare(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status = 'bezahlt' AND substr(pay.paid_at,1,4) = ?`).get(String(y)).s;
    out.pipeline = db.prepare("SELECT COALESCE(SUM(offer_net),0) s FROM projects WHERE status = 'aktiv'").get().s;
  }
  return out;
}
function inbox(user) {
  const owner = isOwner(user), cids = clientIdsFor(user), pids = memberProjectIds(user), items = [];
  for (const r of db.prepare(`SELECT c.id, c.company, c.name, COUNT(*) n, MAX(m.id) last FROM messages m JOIN clients c ON c.id = m.client_id WHERE m.sender = 'client' AND m.read_at IS NULL AND ${inList(cids, "c.id")} GROUP BY c.id`).all()) {
    const last = db.prepare("SELECT body, created_at FROM messages WHERE id = ?").get(r.last);
    items.push({ kind: "chat", at: last.created_at, title: `${r.name} · ${r.company}`, text: last.body.slice(0, 400), count: r.n, href: `#kunden/${r.id}/chat`, client_id: r.id });
  }
  for (const r of db.prepare(`SELECT r.*, c.company, c.name FROM appointment_requests r JOIN clients c ON c.id = r.client_id WHERE r.status = 'offen' AND ${inList(cids, "r.client_id")}`).all())
    items.push({ kind: "termin", at: r.created_at, title: `Terminanfrage · ${r.company}`, text: `${typeLabel(r.type)} (${r.minutes} Min.)${r.message ? " · " + r.message.slice(0, 160) : ""}`, href: `#kunden/${r.client_id}/termine`,
      client_id: r.client_id, request_id: r.id, slots: JSON.parse(r.slots).map(s => ({ start: s, free: isSlotFree(r.type, s) })), flexible: !!r.flexible });
  for (const r of db.prepare(`SELECT pr.id, pr.title, pr.version, pr.client_id, pr.project_id, c.company, COUNT(*) n, MAX(a.created_at) at FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id JOIN clients c ON c.id = a.client_id
      WHERE a.status = 'offen' AND a.author_kind = 'client' AND ${inList(cids, "a.client_id")} ${pids ? `AND (pr.project_id IS NULL OR ${inList(pids, "pr.project_id")})` : ""} GROUP BY pr.id`).all())
    items.push({ kind: "anmerkung", at: r.at, title: `${r.n} offene Anmerkung${r.n === 1 ? "" : "en"} · ${r.company}`, text: `${r.title} (V${r.version})`, href: r.project_id ? `#projekte/${r.project_id}` : `#kunden/${r.client_id}/projekte` });
  if (owner) {
    for (const b of db.prepare("SELECT * FROM bookings WHERE status = 'neu' ORDER BY created_at DESC").all())
      items.push({ kind: "buchung", at: b.created_at, title: `Neue Website-Buchung · ${b.name}${b.company ? " (" + b.company + ")" : ""}`, text: `${typeLabel(b.type)}${b.product ? " – " + b.product : ""} · ${formatDe(b.start)}${b.message ? " · „" + b.message.slice(0, 140) + "“" : ""}`,
        href: b.client_id ? `#kunden/${b.client_id}` : "#termine", client_id: b.client_id, booking_id: b.id, start: b.start, channel: b.channel });
    for (const q of db.prepare("SELECT * FROM requests r WHERE r.status = 'neu' AND (r.client_id IS NULL OR (r.client_id IN (SELECT id FROM clients WHERE stage = 'anfrage') AND r.client_id NOT IN (SELECT client_id FROM appointments))) ORDER BY created_at DESC").all())
      items.push({ kind: "lead", at: q.created_at, title: `Projektanfrage · ${q.name}${q.company ? " (" + q.company + ")" : ""}`, text: `${q.kinds ? q.kinds + " · " : ""}${q.model ? q.model + " · " : ""}${q.description.slice(0, 220)}`,
        href: q.client_id ? `#kunden/${q.client_id}` : "#anfragen", client_id: q.client_id, lead_id: q.id });
  }
  const ts = s => Date.parse(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z");
  return items.sort((a, b) => ts(b.at) - ts(a.at));
}

/* ================= Kalender: Termine + (für Inhaber) noch unbestätigte Website-Buchungen ================= */
// Vorbereitung eines Termins: Anliegen aus der Buchung + Vorab-Fragebogen/-Entwurf getrennt von den eigenen Notizen
function prepFor(a) {
  let notes = a.summary || "", prep = null;
  const b = a.booking_id ? db.prepare("SELECT message FROM bookings WHERE id = ?").get(a.booking_id) : null;
  const v = a.booking_id ? db.prepare("SELECT v.status, v.answers, v.images, p.token FROM vorab v LEFT JOIN prototypes p ON p.id = v.prototype_id WHERE v.booking_id = ?").get(a.booking_id) : null;
  // ältere Termine: automatisch angehängte Texte aus den Notizen herausnehmen
  if (b?.message) notes = notes.replace(`Anliegen laut Buchung:\n${b.message}`, "");
  notes = notes.replace(/Vorab-Fragebogen:\n[\s\S]*?(\n\nVorab-Entwurf: \S+|$)/, "").trim();
  if (b?.message || v) {
    const m = (b?.message || "").match(/^Themen: (.+?)(?:\n\n([\s\S]*))?$/);
    let answers = null; try { answers = v?.answers ? answersView(JSON.parse(v.answers)) : null; } catch {}
    prep = { topics: m ? m[1].split(", ") : [], message: m ? (m[2] || "") : (b?.message || ""),
      vorab: v ? { status: v.status, answers, url: v.token ? `${SITE_URL}/p/${v.token}/index.html` : null, images: (() => { try { return JSON.parse(v.images || "null")?.notes || []; } catch { return []; } })() } : null };
  }
  return { notes: notes.slice(0, 4000), prep };
}
/** Bereich einer Terminart: Hardware-Terminarten sind in den Vorgaben markiert, alles andere ist Software */
const bereichOfType = key => getSetting("availability", DEFAULT_AVAILABILITY).types?.[key]?.bereich === "hardware" ? "hardware" : "software";
function kalender(user, from, to) {
  const owner = isOwner(user), cids = clientIdsFor(user), pids = memberProjectIds(user);
  const team = pid => pid ? db.prepare("SELECT u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.name").all(pid) : [];
  const events = db.prepare(`SELECT a.*, c.company, c.name client_name, c.stage, p.title project_title, p.bereich project_bereich, bk.type booking_type FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN bookings bk ON bk.id = a.booking_id
      WHERE a.start >= ? AND a.start < ? AND ${inList(cids, "a.client_id")} ${pids ? `AND (a.project_id IS NULL OR ${inList(pids, "a.project_id")})` : ""} ORDER BY a.start`).all(from, to)
    .map(a => { const pr = prepFor(a); return { kind: "termin", bereich: a.project_id ? (a.project_bereich || "software") : a.booking_type ? bereichOfType(a.booking_type) : null, id: a.id, title: a.title, start: a.start, minutes: a.minutes || 30, type: a.kind || "", video_url: a.video_url || null, summary: !!pr.notes, notes: pr.notes, prep: pr.prep,
      fragebogen: fragebogenStand(a.client_id), client: { id: a.client_id, company: a.company, name: a.client_name, stage: a.stage }, project: a.project_id ? { id: a.project_id, title: a.project_title, bereich: a.project_bereich || "software" } : null, team: team(a.project_id) }; });
  if (owner) for (const b of db.prepare("SELECT * FROM bookings WHERE start >= ? AND start < ? AND status IN ('neu','bestaetigt') AND id NOT IN (SELECT booking_id FROM appointments WHERE booking_id IS NOT NULL) ORDER BY start").all(from, to)) {
    const c = b.client_id ? db.prepare("SELECT id, company, name, stage FROM clients WHERE id = ?").get(b.client_id) : null;
    events.push({ kind: "buchung", bereich: bereichOfType(b.type), id: b.id, title: typeLabel(b.type), start: b.start, minutes: b.minutes, type: typeLabel(b.type), tentative: b.status === "neu", video_url: b.video_url || null, fragebogen: b.client_id ? fragebogenStand(b.client_id) : null,
      client: c || { id: null, company: b.company || b.name, name: b.name }, project: null, team: [] });
  }
  const av = getSetting("availability", DEFAULT_AVAILABILITY);
  return { events: events.sort((x, y) => x.start.localeCompare(y.start)), blocked: av.blocked || [] };
}

/* ================= Team (nur Inhaber) ================= */
async function teamApi(req, res, p, m, user) {
  const out = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLES[u.role], active: !!u.active, invited: !!u.invite_token, last_login: u.last_login, created_at: u.created_at, me: u.id === user.id,
    ...workload(u.id) });
  function workload(uid) {
    const projects = db.prepare("SELECT p.id, p.title, p.phase, p.status, p.offer_net, p.client_id, c.company FROM project_members pm JOIN projects p ON p.id = pm.project_id JOIN clients c ON c.id = p.client_id WHERE pm.user_id = ? ORDER BY p.status, c.company").all(uid);
    const act = projects.filter(p => p.status === "aktiv"), ids = act.map(p => p.id);
    const q = (sql) => ids.length ? db.prepare(sql.replace("IDS", ids.join(","))).get().n : 0;
    return { projects, load: { active: act.length, clients: new Set(act.map(p => p.client_id)).size, volume: act.reduce((s, p) => s + (p.offer_net || 0), 0),
      phases: act.reduce((o, p) => (o[p.phase] = (o[p.phase] || 0) + 1, o), {}),
      notes: q("SELECT COUNT(*) n FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE a.status = 'offen' AND pr.project_id IN (IDS)"),
      appts: q(`SELECT COUNT(*) n FROM appointments WHERE project_id IN (IDS) AND start >= '${new Date().toISOString()}' AND start < '${new Date(Date.now() + 7 * 864e5).toISOString()}'`) } };
  }
  if (p === "/team" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM users ORDER BY active DESC, role, name").all().map(out));
  const invite = id => { const t = randomBytes(24).toString("hex"); db.prepare("UPDATE users SET invite_token = ?, invite_expires = ? WHERE id = ?").run(t, Date.now() + 14 * 86400000, id); return `${SITE_URL}/admin/#einladung=${t}`; };
  const inviteMail = (u, link) => sendMail({ to: u.email, subject: "Einladung ins Team-Board von Reeder Software",
    text: `Hallo ${u.name},\n\ndu wurdest als ${ROLES[u.role]} ins Board der Reeder Software GmbH eingeladen. Über diesen Link legst du dein Passwort fest (14 Tage gültig):\n${link}\n\nViele Grüße\n${user.name}` });
  if (p === "/team" && m === "POST") {
    const d = await readJson(req), email = clean(d.email, 160).toLowerCase(), name = clean(d.name, 120), role = ROLES[d.role] ? d.role : "entwickler";
    if (!name || !isEmail(email)) return json(res, 400, { error: "Bitte Name und eine gültige E-Mail angeben." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return json(res, 409, { error: "Diese E-Mail hat schon einen Zugang." });
    const id = db.prepare("INSERT INTO users(email, name, pw_hash, role) VALUES(?, ?, '!', ?)").run(email, name, role).lastInsertRowid;
    const link = invite(id), u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    const mailed = d.sendInvite ? await inviteMail(u, link) : null;
    return json(res, 201, { member: out(u), inviteLink: link, mailed });
  }
  const mm = p.match(/^\/team\/(\d+)(\/invite)?$/); if (!mm) return null;
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(+mm[1]);
  if (!u) return json(res, 404, { error: "Nicht gefunden" });
  if (mm[2] && m === "POST") { const d = await readJson(req), link = invite(u.id); return json(res, 200, { inviteLink: link, mailed: d.send ? await inviteMail(u, link) : null }); }
  if (m === "PATCH") {
    const d = await readJson(req);
    if (u.id === user.id && (d.role && d.role !== "inhaber" || d.active === false)) return json(res, 400, { error: "Sie können sich nicht selbst herabstufen oder sperren." });
    const role = ROLES[d.role] ? d.role : u.role, active = d.active === undefined ? u.active : (d.active ? 1 : 0);
    db.prepare("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?").run(clean(d.name, 120) || u.name, role, active, u.id);
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    if (Array.isArray(d.projects)) {
      db.prepare("DELETE FROM project_members WHERE user_id = ?").run(u.id);
      for (const pid of d.projects.slice(0, 200)) if (db.prepare("SELECT 1 FROM projects WHERE id = ?").get(+pid)) db.prepare("INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES(?, ?)").run(+pid, u.id);
    }
    return json(res, 200, out(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)));
  }
  return null;
}

/* ================= Admin-API ================= */
async function adminApi(req, res, url) {
  const p = url.pathname.replace(/^\/api\/admin/, ""), m = req.method;
  if (p === "/login" && m === "POST") return unifiedLogin(req, res);
  let mi = p.match(/^\/invite\/([a-f0-9]{48})$/);
  if (mi) {   // Einladung ins Team annehmen (ohne Anmeldung)
    const u = db.prepare("SELECT * FROM users WHERE invite_token = ? AND active = 1").get(mi[1]);
    if (!u || u.invite_expires < Date.now()) return json(res, 404, { error: "Dieser Einladungslink ist ungültig oder abgelaufen." });
    if (m === "GET") return json(res, 200, { name: u.name, email: u.email, role: ROLES[u.role] || u.role });
    if (m === "POST") {
      if (limited("tinv:" + ipOf(req), 10, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche." });
      const d = await readJson(req);
      if (String(d.password || "").length < 10) return json(res, 400, { error: "Das Passwort braucht mindestens 10 Zeichen." });
      db.prepare("UPDATE users SET pw_hash = ?, invite_token = NULL, invite_expires = NULL, last_login = datetime('now') WHERE id = ?").run(hashPw(String(d.password)), u.id);
      return adminSession(res, u.id, { to: "/admin/" });
    }
  }
  const user = currentUser(req);
  if (!user) return json(res, 401, { error: "Bitte anmelden." });
  if (m !== "GET" && !String(req.headers["content-type"] || "").includes("application/json")) return json(res, 415, { error: "JSON erwartet" });
  const denied = guard(user, m, p);
  if (denied) return json(res, denied.code, { error: denied.error });
  const owner = isOwner(user);

  if (p === "/logout" && m === "POST") {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(cookies(req)[ADMIN_CK]);
    return json(res, 200, { ok: true }, { "Set-Cookie": `${ADMIN_CK}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (p === "/me") return json(res, 200, { id: user.id, email: user.email, name: user.name, role: user.role, roleLabel: ROLES[user.role] || user.role, owner, mail: mailStatus() });
  if (p === "/cockpit") return json(res, 200, { ...cockpit(user), timer: !!db.prepare("SELECT 1 FROM timers WHERE user_id = ?").get(user.id), support: support.unreadFor(user) });
  if (p === "/kalender") { const d = s => /^\d{4}-\d{2}-\d{2}/.test(s || "") ? new Date(s).toISOString() : null;
    const from = d(url.searchParams.get("from")) || new Date(Date.now() - 31 * 864e5).toISOString(), to = d(url.searchParams.get("to")) || new Date(Date.now() + 62 * 864e5).toISOString();
    return json(res, 200, kalender(user, from, to)); }
  if (p === "/inbox") return json(res, 200, inbox(user));
  if (p.startsWith("/team")) { const r = await teamApi(req, res, p, m, user); if (r !== null) return; }
  if (p.startsWith("/finance")) { const r = await finance.api(req, res, url, p, user); if (r !== null) return; }
  if (p.startsWith("/automation")) { const r = await automation.api(req, res, p, m, user); if (r !== null) return; }
  if (p.startsWith("/contracts")) { const r = await contracts.admin(req, res, p, m, user); if (r !== null) return; }
  if (/^\/(arbeitsplatz|tasks|timer|time|zeiten)(\/|$)|^\/projects\/\d+\/(tasks|time)$|^\/annotations\/\d+\/task$|^\/appointments\/\d+\/tasks$/.test(p)) { const r = await work.api(req, res, url, p, m, user); if (r !== null) return; }
  if (p.startsWith("/covered")) { if (!owner) return json(res, 403, { error: "Nur für Inhaber." }); const r = await covered.api(req, res, p, m); if (r !== null) return; }
  if (p === "/vorab" || /^\/vorab\/(\d+\/neu|kunde\/\d+)$/.test(p)) { if (!owner) return json(res, 403, { error: "Nur für Inhaber." }); const r = await vorab.admin(req, res, p, m); if (r !== null) return; }
  if (/^\/projects\/\d+\/(pruefung|pruefbericht)$|^\/pruefung\//.test(p)) { const r = await pruefung.admin(req, res, p, m, user, url); if (r !== null) return; }
  if (/^\/projects\/\d+\/auftrag$|^\/auftrag\/\d+/.test(p)) { const r = await auftrag.admin(req, res, p, m, user); if (r !== null) return; }
  if (p === "/assistant" || /^\/annotations\/\d+\/assist$/.test(p)) { const r = await assistant.admin(req, res, p, m, user); if (r !== null) return; }
  if (p === "/stand-cli" || /^\/projects\/\d+\/stand(\/key)?$/.test(p)) { const r = await stand.admin(req, res, p, m, user); if (r !== null) return; }
  if (p.startsWith("/security") || p === "/livegang") { const r = await security.admin(req, res, url, p, m, user); if (r !== null) return; }
  if (p === "/vereinbarungen" || /^\/vereinbarungen\/\d+(\/meldung)?$|^\/projects\/\d+\/vereinbarungen$/.test(p)) { if (!owner) return json(res, 403, { error: "Nur für Inhaber." }); const r = await vereinbarungen.admin(req, res, p, m, user); if (r !== null) return; }
  if (p.startsWith("/support")) { const r = await support.admin(req, res, url, p, m, user); if (r !== null) return; }
  if (p.startsWith("/hardware")) { const r = await hardware.api(req, res, url, p, m, user); if (r !== null) return; }
  if (p.startsWith("/onboarding")) { if (!owner) return json(res, 403, { error: "Nur für Inhaber." }); const r = await onboarding.admin(req, res, p, m); if (r !== null) return; }
  if (p === "/health" || p.startsWith("/betrieb")) { const r = await ops.api(req, res, url, p, m, user); if (r !== null) return; }
  if (p === "/kpi") { const r = await kpi.api(req, res, url, p, m, user); if (r !== null) return; }
  if (p.startsWith("/vertraege") || p.startsWith("/produkte")) { const r = await subs.admin(req, res, p, m, url, user); if (r !== null) return; }
  if (p === "/overview") {
    const c = (sql, ...a) => db.prepare(sql).get(...a).n;
    const upcoming = db.prepare("SELECT * FROM bookings WHERE status IN ('neu','bestaetigt') AND start >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ORDER BY start LIMIT 6").all();
    return json(res, 200, {
      newBookings: c("SELECT COUNT(*) n FROM bookings WHERE status = 'neu'"),
      newRequests: c("SELECT COUNT(*) n FROM requests WHERE status = 'neu'"),
      week: c("SELECT COUNT(*) n FROM bookings WHERE status = 'bestaetigt' AND start >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AND start < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days')"),
      total: c("SELECT COUNT(*) n FROM bookings"),
      unreadChats: c("SELECT COUNT(*) n FROM messages WHERE sender = 'client' AND read_at IS NULL"),
      openRequests: c("SELECT COUNT(*) n FROM appointment_requests WHERE status = 'offen'"),
      upcoming: upcoming.map(b => ({ ...b, typeLabel: typeLabel(b.type) })),
    });
  }
  if (p === "/bookings" && m === "GET") {
    const st = clean(url.searchParams.get("status"), 20);
    const rows = st ? db.prepare("SELECT * FROM bookings WHERE status = ? ORDER BY start DESC").all(st) : db.prepare("SELECT * FROM bookings ORDER BY start DESC LIMIT 500").all();
    return json(res, 200, rows.map(b => ({ ...b, typeLabel: typeLabel(b.type) })));
  }
  let mm = p.match(/^\/bookings\/(\d+)$/);
  if (mm && m === "PATCH") {
    const d = await readJson(req), b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(+mm[1]);
    if (!b) return json(res, 404, { error: "Nicht gefunden" });
    const status = ["neu", "bestaetigt", "abgesagt", "erledigt"].includes(d.status) ? d.status : b.status;
    const note = d.note !== undefined ? clean(d.note, 3000) : b.note;
    db.prepare("UPDATE bookings SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ?").run(status, note, b.id);
    if (status === "bestaetigt" && b.status !== "bestaetigt") { const c = confirmBooking({ ...b }, "Website-Termin"); b.video_url = c.video_url; b.client_id = c.client_id; }
    if (status === "abgesagt") db.prepare("DELETE FROM appointments WHERE booking_id = ? AND start > ?").run(b.id, new Date().toISOString());
    let mailed = null;
    if (d.notify && status !== b.status && (status === "bestaetigt" || status === "abgesagt")) mailed = await mailForStatus(b, status);
    // Zweite Mail: Vorab-Fragebogen fürs Erstgespräch (daraus entsteht automatisch ein Vorab-Entwurf)
    if (d.notify && status === "bestaetigt" && b.status !== "bestaetigt") vorab.invite(db.prepare("SELECT * FROM bookings WHERE id = ?").get(b.id)).catch(e => console.warn("Vorab-Mail:", e.message));
    return json(res, 200, { ok: true, mailed, client_id: b.client_id || db.prepare("SELECT client_id FROM bookings WHERE id = ?").get(b.id).client_id, video_url: b.video_url || null });
  }
  if (p === "/requests" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT 500").all());
  mm = p.match(/^\/requests\/(\d+)$/);
  if (mm && m === "PATCH") {
    const d = await readJson(req), q = db.prepare("SELECT * FROM requests WHERE id = ?").get(+mm[1]);
    if (!q) return json(res, 404, { error: "Nicht gefunden" });
    const status = ["neu", "in Bearbeitung", "Angebot", "gewonnen", "abgelehnt", "erledigt"].includes(d.status) ? d.status : q.status;
    db.prepare("UPDATE requests SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ?").run(status, d.note !== undefined ? clean(d.note, 3000) : q.note, q.id);
    return json(res, 200, { ok: true });
  }
  if (p === "/availability" && m === "GET") return json(res, 200, getSetting("availability", DEFAULT_AVAILABILITY));
  if (p === "/availability" && m === "PUT") {
    const d = await readJson(req), base = getSetting("availability", DEFAULT_AVAILABILITY);
    const hm = /^\d{2}:\d{2}$/, ymd = /^\d{4}-\d{2}-\d{2}$/;
    const weekly = {};
    for (let i = 1; i <= 7; i++) weekly[i] = (d.weekly?.[i] || []).filter(w => Array.isArray(w) && hm.test(w[0]) && hm.test(w[1]) && w[0] < w[1]).slice(0, 6);
    const types = { ...base.types };
    for (const k of Object.keys(types)) if (d.types?.[k]) {
      const t = d.types[k];
      types[k] = { ...types[k], minutes: Math.min(480, Math.max(10, +t.minutes || types[k].minutes)), buffer: Math.min(120, Math.max(0, +t.buffer || 0)), active: t.active !== false };
    }
    const next = { ...base, weekly, types,
      step: [15, 30, 60].includes(+d.step) ? +d.step : base.step,
      leadHours: Math.min(336, Math.max(0, +d.leadHours || 0)), horizonDays: Math.min(365, Math.max(7, +d.horizonDays || base.horizonDays)),
      blocked: (d.blocked || []).filter(b => ymd.test(b.from) && ymd.test(b.to) && b.from <= b.to).map(b => ({ from: b.from, to: b.to, note: clean(b.note, 80) })).slice(0, 100) };
    setSetting("availability", next);
    return json(res, 200, next);
  }
  if (p === "/settings" && m === "GET") {
    const smtp = getSetting("smtp", {});
    return json(res, 200, { mail: getSetting("mail", DEFAULT_MAIL), mailStatus: mailStatus(), calendarUrl: `${SITE_URL}/calendar/${calendarToken()}.ics`,
      company: getSetting("company", DEFAULT_COMPANY), companyHardware: getSetting("companyHardware", DEFAULT_HARDWARE), meeting: getSetting("meeting", { mode: "jitsi", url: "" }), smtp: { host: smtp.host || "", port: smtp.port || 587, user: smtp.user || "", hasPass: !!smtp.pass } });
  }
  if (p === "/settings/company" && m === "PUT") {
    const d = await readJson(req), next = { ...getSetting("company", DEFAULT_COMPANY) };
    for (const k of Object.keys(DEFAULT_COMPANY)) if (d[k] !== undefined) next[k] = typeof DEFAULT_COMPANY[k] === "number" ? Math.min(365, Math.max(0, +d[k] || 0)) : clean(d[k], 160);
    if (next.iban) next.iban = next.iban.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
    setSetting("company", next); return json(res, 200, next);
  }
  if (p === "/settings/company-hardware" && m === "PUT") {
    // Stammdaten der Reeder Hardware GmbH; "aktiv" schaltet ein, dass Hardware-Projekte über diese Firma abgerechnet werden
    const d = await readJson(req), next = { ...getSetting("companyHardware", DEFAULT_HARDWARE) };
    for (const k of Object.keys(DEFAULT_COMPANY)) if (d[k] !== undefined) next[k] = typeof DEFAULT_COMPANY[k] === "number" ? Math.min(365, Math.max(0, +d[k] || 0)) : clean(d[k], 160);
    if (next.iban) next.iban = next.iban.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
    next.aktiv = d.aktiv === true || d.aktiv === "on" || d.aktiv === "1";
    if (next.aktiv && (!next.name || !next.street || !next.city)) return json(res, 400, { error: "Zum Aktivieren bitte mindestens Firma und Anschrift der Hardware GmbH eintragen." });
    setSetting("companyHardware", next); return json(res, 200, next);
  }
  if (p === "/settings/meeting" && m === "PUT") {
    const d = await readJson(req), url2 = clean(d.url, 300);
    if (d.mode === "fixed" && !/^https:\/\//.test(url2)) return json(res, 400, { error: "Bitte einen https-Link eintragen (z. B. Ihr Teams-, Zoom- oder Google-Meet-Raum)." });
    setSetting("meeting", { mode: d.mode === "fixed" ? "fixed" : "jitsi", url: url2 }); return json(res, 200, getSetting("meeting", {}));
  }
  if (p === "/settings/smtp" && m === "PUT") {
    const d = await readJson(req), cur = getSetting("smtp", {});
    const next = { host: clean(d.host, 160), port: Math.min(65535, Math.max(1, +d.port || 587)), user: clean(d.user, 160), pass: d.pass ? String(d.pass).slice(0, 300) : cur.pass || "" };
    if (!next.host) { setSetting("smtp", {}); await reloadSmtp(); return json(res, 200, { mailStatus: mailStatus() }); }
    setSetting("smtp", next); await reloadSmtp();
    return json(res, 200, { mailStatus: mailStatus() });
  }
  if (p === "/settings/test-mail" && m === "POST") {
    if (limited("testmail:" + user.id, 5, 10 * 60000)) return json(res, 429, { error: "Bitte kurz warten." });
    const r = await testSmtp(user.email); return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, to: user.email } : { error: r.error });
  }
  if (p === "/settings" && m === "PUT") {
    const d = await readJson(req), cur = getSetting("mail", DEFAULT_MAIL);
    const next = { fromName: clean(d.fromName, 80) || cur.fromName, fromAddress: isEmail(d.fromAddress) ? d.fromAddress : cur.fromAddress, notifyAddress: isEmail(d.notifyAddress) ? d.notifyAddress : cur.notifyAddress };
    setSetting("mail", next); return json(res, 200, next);
  }
  if (p === "/calendar/reset" && m === "POST") { resetCalendarToken(); return json(res, 200, { calendarUrl: `${SITE_URL}/calendar/${calendarToken()}.ics` }); }
  if (p === "/password" && m === "POST") {   // eigenes Passwort – für jede Rolle
    const d = await readJson(req), u = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    if (!checkPw(String(d.current || ""), u.pw_hash)) return json(res, 400, { error: "Das aktuelle Passwort stimmt nicht." });
    if (String(d.next || "").length < 10) return json(res, 400, { error: "Das neue Passwort braucht mindestens 10 Zeichen." });
    db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(hashPw(String(d.next)), u.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(u.id, cookies(req)[ADMIN_CK]);
    return json(res, 200, { ok: true });
  }
  if (p === "/outbox" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM outbox ORDER BY id DESC LIMIT 100").all());
  if (/^\/(clients|projects|appointments|documents|prototypes|annotations|requests|slots)(\/|$)/.test(p)) {
    if ((await portal.requestsAdmin(req, res, url, p, user)) !== null) return;
    if ((await portal.projectsAdmin(req, res, url, p, user)) !== null) return;
    if (p.startsWith("/clients") && (await portal.adminClientsApi(req, res, url, p, user)) !== null) return;
  }
  return json(res, 404, { error: "Unbekannt" });
}

/* ================= Statische Dateien (nur freigegebene Pfade) ================= */
const PUBLIC_DIRS = ["assets", "admin", "portal"];
const PUBLIC_FILES = new Set(["robots.txt", "sitemap.xml"]);
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "" ) rel = "index.html";
  if (rel === "admin" || rel === "admin/") rel = "admin/index.html";
  if (rel === "portal" || rel === "portal/") rel = "portal/index.html";
  const top = rel.split("/")[0];
  const allowed = (!rel.includes("/") && (rel.endsWith(".html") || PUBLIC_FILES.has(rel))) || PUBLIC_DIRS.includes(top);
  const file = path.resolve(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep) || rel.includes("..")) return send(res, 404, "Nicht gefunden");
  try {
    const st = await stat(file); if (!st.isFile()) throw 0;
    const ext = path.extname(file).toLowerCase();
    const extra = top === "admin" || top === "portal" ? { "X-Frame-Options": "DENY", "Cache-Control": "no-store" } : { "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" };
    send(res, 200, await readFile(file), { "Content-Type": MIME[ext] || "application/octet-stream", ...extra });
  } catch { send(res, 404, "Nicht gefunden"); }
}

/* ================= Server ================= */
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/login" && req.method === "POST") return await unifiedLogin(req, res);
    if (url.pathname === "/api/login/2fa" || url.pathname.startsWith("/api/password/")) { const r = await security.publicRoutes(req, res, url); if (r !== null) return; }
    if (url.pathname === "/login" || url.pathname === "/login/") return send(res, 302, "", { Location: "/portal/" + (url.search || "") });
    if (url.pathname.startsWith("/api/onboarding/")) { const r = await onboarding.publicRoute(req, res, url); if (r !== null) return; }
    if (url.pathname.startsWith("/api/vorab/")) { const r = await vorab.publicRoute(req, res, url); if (r !== null) return; }
    if (url.pathname === "/api/stand" || url.pathname === "/api/stand/auftrag") return await stand.publicRoute(req, res, url);
    if (url.pathname.startsWith("/api/admin/")) return await adminApi(req, res, url);
    if (url.pathname.startsWith("/api/portal/")) return await portal.portalApi(req, res, url);
    if (url.pathname.startsWith("/p/") && (req.method === "GET" || req.method === "HEAD")) return await portal.servePrototype(req, res, url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/calendar/")) {
      const r = await publicApi(req, res, url);
      if (r === null) json(res, 404, { error: "Unbekannt" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Nicht erlaubt");
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.code ? e.message : "Interner Fehler" });
    if (!e.code) console.error(e);
  }
}).listen(PORT, () => {
  automation.start();
  console.log(`Reeder Software läuft auf ${SITE_URL}  ·  Admin-Board: ${SITE_URL}/admin  ·  E-Mail-Versand: ${mailStatus().ready ? "aktiv" : "aus (nur Postausgang)"}`);
});
