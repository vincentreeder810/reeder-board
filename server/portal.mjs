// Kundenportal: Kundenzugänge, Chat mit dem Team und klickbare Prototypen.
// Prototypen laufen in einer Sandbox (eigener, undurchsichtiger Ursprung): kein Zugriff auf Logins, nichts wird gespeichert.
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { fragebogenStand } from "./onboarding.mjs";
import { createProjects } from "./projects.mjs";
import { createRequests } from "./requests.mjs";
import { clientIdsFor, memberProjectIds } from "./access.mjs";
// Cookie-Name je Instanz (Demo-Board läuft parallel auf demselben localhost)
const PORTAL_CK = `${process.env.COOKIE_PREFIX || "rs"}_portal`;

const PROTO_DIR = path.resolve(process.env.DATA_DIR || "data", "prototypes");
const MAX_UPLOAD = 40 * 1024 * 1024;           // JSON inkl. Base64
const MAX_FILES = 600;
const NOTIFY_PAUSE = 30 * 60000;               // höchstens eine Benachrichtigungs-Mail je 30 Minuten und Richtung
const INVITE_DAYS = 14;

export const PROTO_MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".pdf": "application/pdf",
};

// Wird in jede HTML-Seite eines Prototyps eingesetzt: Speicher-APIs gibt es in der Sandbox nicht –
// statt Fehlern bekommen Mockups einen flüchtigen Speicher, der beim Neuladen verschwindet.
const SHIM = `<script>(()=>{const mk=()=>{const m=new Map();return{get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>{m.set(String(k),String(v))},removeItem:k=>{m.delete(String(k))},clear:()=>m.clear()}};for(const n of["localStorage","sessionStorage"]){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch(_){}}}let c="";try{document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:()=>c,set:v=>{c=String(v).split(";")[0]},configurable:true})}catch(_){}}if(parent!==window){let r=0;const s=()=>{r=0;try{const d=document.documentElement,b=document.body;parent.postMessage({rs:"proto",path:location.pathname,hash:location.hash,sx:scrollX,sy:scrollY,w:innerWidth,h:Math.max(d.scrollHeight,b?b.scrollHeight:0)},"*")}catch(_){}},q=()=>{if(!r)r=requestAnimationFrame(s)};addEventListener("scroll",q,{passive:true});addEventListener("resize",q);addEventListener("load",q);addEventListener("hashchange",q);document.addEventListener("DOMContentLoaded",q);setInterval(q,1200);addEventListener("message",e=>{if(e.source!==parent)return;const d=e.data||{};if(d.rs==="scrollTo")scrollTo({top:+d.y||0,left:+d.x||0,behavior:d.smooth?"smooth":"auto"});if(d.rs==="scrollBy")scrollBy(+d.dx||0,+d.dy||0);if(d.rs==="ping")q()})}})();</script>`;

// Elementerkennung und Live-Vorschau für Anmerkungen (Baustein H3) – lesbare Quelle in proto-pick.js
const PICK = `<script>${readFileSync(new URL("./proto-pick.js", import.meta.url), "utf8")}</script>`;

export function createPortal({ json, send, readJson, clean, isEmail, limited, ipOf, cookies, hashPw, checkPw, SITE_URL }) {
  const secure = SITE_URL.startsWith("https") ? "; Secure" : "";
  const portalUrl = `${SITE_URL}/portal/`;
  const sig = `\n\nViele Grüße\nIhr Team der Reeder Software GmbH`;

  /* ---------- Helfer ---------- */
  const publicClient = c => c && ({ id: c.id, company: c.company, name: c.name, email: c.email, phone: c.phone || "", active: !!c.active, stage: c.stage || "mandant", source: c.source || null,
    status: c.pw_hash ? "aktiv" : (c.invite_expires > Date.now() ? "eingeladen" : (c.stage && c.stage !== "mandant" ? "kein Zugang" : "Einladung abgelaufen")), last_seen: c.last_seen, created_at: c.created_at });
  const protoOut = p => p && ({ id: p.id, title: p.title, note: p.note, url: `/p/${p.token}/${p.entry}`, base: `/p/${p.token}/`, entry: p.entry, files: p.files, bytes: p.bytes, active: !!p.active,
    version: p.version || 1, project_id: p.project_id || null, group_id: p.group_id || p.id, changes: p.changes || "", state: p.state || null, created_at: p.created_at });
  const msgOut = m => ({ id: m.id, has_prototype: !!m.prototype_id, sender: m.sender, author: m.author, body: m.body, created_at: m.created_at, read: !!m.read_at,
    prototype: m.prototype_id ? protoOut(db.prepare("SELECT * FROM prototypes WHERE id = ? AND active = 1").get(m.prototype_id)) || null : null });

  const projects = createProjects({ json, send, readJson, clean, protoOut, SITE_URL });
  const requests = createRequests({ json, readJson, clean, logEvent: projects.logEvent, SITE_URL });

  function currentClient(req) {
    const t = cookies(req)[PORTAL_CK]; if (!t) return null;
    const row = db.prepare("SELECT c.*, s.expires_at FROM client_sessions s JOIN clients c ON c.id = s.client_id WHERE s.token = ?").get(t);
    if (!row || row.expires_at < Date.now() || !row.active) return null;
    return row;
  }
  function newInvite(clientId) {
    const token = randomBytes(24).toString("hex");
    db.prepare("UPDATE clients SET invite_token = ?, invite_expires = ? WHERE id = ?").run(token, Date.now() + INVITE_DAYS * 86400000, clientId);
    return `${portalUrl}#einladung=${token}`;
  }
  function inviteMail(c, link) {
    return sendMail({ to: c.email, subject: "Ihr Zugang zum Kundenportal von Reeder Software",
      text: `Hallo ${c.name},\n\nfür ${c.company} haben wir Ihnen einen Zugang zu unserem Kundenportal eingerichtet. Dort schreiben Sie direkt mit unserem Team und klicken sich durch die Prototypen, die wir für Sie bauen.\n\nÜber diesen Link legen Sie Ihr Passwort fest (gültig ${INVITE_DAYS} Tage):\n${link}${sig}` });
  }
  function notifyClient(c) {
    if (!c.pw_hash || !c.notify_email || (c.notified_client_at && Date.now() - c.notified_client_at < NOTIFY_PAUSE)) return;
    db.prepare("UPDATE clients SET notified_client_at = ? WHERE id = ?").run(Date.now(), c.id);
    sendMail({ to: c.email, subject: "Neue Nachricht von Reeder Software",
      text: `Hallo ${c.name},\n\nin Ihrem Kundenportal wartet eine neue Nachricht von unserem Team.\n\n${portalUrl}${sig}` }).catch(e => console.warn("Mail:", e.message));
  }
  function notifyTeam(c, body) {
    if (c.notified_team_at && Date.now() - c.notified_team_at < NOTIFY_PAUSE) return;
    db.prepare("UPDATE clients SET notified_team_at = ? WHERE id = ?").run(Date.now(), c.id);
    sendMail({ to: getSetting("mail", DEFAULT_MAIL).notifyAddress, subject: `Neue Chat-Nachricht: ${c.name} (${c.company})`,
      text: `${c.name} schreibt:\n\n${body}\n\nAntworten im Admin-Board: ${SITE_URL}/admin#kunden` }).catch(e => console.warn("Mail:", e.message));
  }
  const listMessages = (clientId, after) =>
    db.prepare("SELECT * FROM messages WHERE client_id = ? AND id > ? ORDER BY id LIMIT 500").all(clientId, after).map(msgOut);

  /* ---------- Portal-API (Kunden) ---------- */
  const ext = [];   // weitere Portal-Bereiche (z. B. Angebote annehmen)
  async function portalApi(req, res, url) {
    const p = url.pathname.replace(/^\/api\/portal/, ""), m = req.method;

    let mm = p.match(/^\/invite\/([a-f0-9]{48})$/);
    if (mm && m === "GET") {
      const c = db.prepare("SELECT * FROM clients WHERE invite_token = ? AND active = 1").get(mm[1]);
      if (!c || c.invite_expires < Date.now()) return json(res, 404, { error: "Dieser Einladungslink ist ungültig oder abgelaufen. Bitte fragen Sie uns nach einem neuen." });
      return json(res, 200, { name: c.name, company: c.company, email: c.email });
    }
    if (mm && m === "POST") {
      if (limited("inv:" + ipOf(req), 10, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte später erneut versuchen." });
      const d = await readJson(req), c = db.prepare("SELECT * FROM clients WHERE invite_token = ? AND active = 1").get(mm[1]);
      if (!c || c.invite_expires < Date.now()) return json(res, 404, { error: "Dieser Einladungslink ist ungültig oder abgelaufen." });
      if (String(d.password || "").length < 10) return json(res, 400, { error: "Das Passwort braucht mindestens 10 Zeichen." });
      db.prepare("UPDATE clients SET pw_hash = ?, invite_token = NULL, invite_expires = NULL WHERE id = ?").run(hashPw(String(d.password)), c.id);
      db.prepare("DELETE FROM client_sessions WHERE client_id = ?").run(c.id);
      return login(res, c.id);
    }
    if (p === "/login" && m === "POST") {
      if (limited("plogin:" + ipOf(req), 8, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." });
      const d = await readJson(req);
      const c = db.prepare("SELECT * FROM clients WHERE email = ? AND active = 1").get(clean(d.email, 160).toLowerCase());
      if (!c || !c.pw_hash || !checkPw(String(d.password || ""), c.pw_hash)) return json(res, 401, { error: "E-Mail oder Passwort ist falsch." });
      return login(res, c.id, { to: "/portal/" });
    }

    const c = currentClient(req);
    if (!c) return json(res, 401, { error: "Bitte anmelden." });
    if (m !== "GET" && !String(req.headers["content-type"] || "").includes("application/json")) return json(res, 415, { error: "JSON erwartet" });
    db.prepare("UPDATE clients SET last_seen = datetime('now') WHERE id = ?").run(c.id);

    if (p === "/logout" && m === "POST") {
      db.prepare("DELETE FROM client_sessions WHERE token = ?").run(cookies(req)[PORTAL_CK]);
      return json(res, 200, { ok: true }, { "Set-Cookie": `${PORTAL_CK}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (p === "/me") {
      const contact = db.prepare("SELECT author FROM messages WHERE client_id = ? AND sender = 'team' ORDER BY id DESC LIMIT 1").get(c.id)?.author
        || db.prepare("SELECT name FROM users ORDER BY id LIMIT 1").get()?.name || "Ihr Team";
      return json(res, 200, { name: c.name, company: c.company, email: c.email, phone: c.phone || "", created_at: c.created_at, notify_email: !!c.notify_email, contact,
        sessions: db.prepare("SELECT COUNT(*) n FROM client_sessions WHERE client_id = ? AND expires_at > ?").get(c.id, Date.now()).n });
    }
    if (p === "/settings" && m === "PATCH") {
      const d = await readJson(req);
      if (d.notify_email !== undefined) db.prepare("UPDATE clients SET notify_email = ? WHERE id = ?").run(d.notify_email ? 1 : 0, c.id);
      if (d.phone !== undefined) db.prepare("UPDATE clients SET phone = ? WHERE id = ?").run(clean(d.phone, 40), c.id);
      if (d.name !== undefined && clean(d.name, 120)) db.prepare("UPDATE clients SET name = ? WHERE id = ?").run(clean(d.name, 120), c.id);
      return json(res, 200, { ok: true });
    }
    for (const fn of ext) { const r = await fn(req, res, url, p, c, ipOf(req)); if (r !== null && r !== undefined) return r; }
    if (p === "/logout-others" && m === "POST") {
      const n = db.prepare("DELETE FROM client_sessions WHERE client_id = ? AND token != ?").run(c.id, cookies(req)[PORTAL_CK]).changes;
      return json(res, 200, { ok: true, removed: n });
    }
    if (p === "/messages" && m === "GET") {
      const after = Math.max(0, +url.searchParams.get("after") || 0);
      const rows = listMessages(c.id, after);
      db.prepare("UPDATE messages SET read_at = datetime('now') WHERE client_id = ? AND sender = 'team' AND read_at IS NULL").run(c.id);
      return json(res, 200, rows);
    }
    if (p === "/messages" && m === "POST") {
      if (limited("pmsg:" + c.id, 40, 10 * 60000)) return json(res, 429, { error: "Bitte einen Moment warten." });
      const body = clean((await readJson(req)).body, 5000).replace(/\r/g, "");
      if (!body) return json(res, 400, { error: "Die Nachricht ist leer." });
      const r = db.prepare("INSERT INTO messages(client_id, sender, author, body) VALUES(?, 'client', ?, ?)").run(c.id, c.name, body);
      notifyTeam(c, body);
      return json(res, 201, msgOut(db.prepare("SELECT * FROM messages WHERE id = ?").get(r.lastInsertRowid)));
    }
    if (p === "/prototypes" && m === "GET")
      return json(res, 200, db.prepare("SELECT * FROM prototypes WHERE client_id = ? AND active = 1 ORDER BY id DESC").all(c.id).map(protoOut));
    if (p === "/password" && m === "POST") {
      const d = await readJson(req);
      if (!checkPw(String(d.current || ""), c.pw_hash)) return json(res, 400, { error: "Das aktuelle Passwort stimmt nicht." });
      if (String(d.next || "").length < 10) return json(res, 400, { error: "Das neue Passwort braucht mindestens 10 Zeichen." });
      db.prepare("UPDATE clients SET pw_hash = ? WHERE id = ?").run(hashPw(String(d.next)), c.id);
      db.prepare("DELETE FROM client_sessions WHERE client_id = ? AND token != ?").run(c.id, cookies(req)[PORTAL_CK]);
      return json(res, 200, { ok: true });
    }
    if ((await requests.portal(req, res, url, p, c)) !== null) return;
    const pr = await projects.portal(req, res, url, p, c);
    if (pr !== null) return;
    return json(res, 404, { error: "Unbekannt" });
  }
  function login(res, clientId, extra = {}) {
    const token = randomBytes(32).toString("hex"), days = 30;
    db.prepare("INSERT INTO client_sessions(token, client_id, expires_at) VALUES(?, ?, ?)").run(token, clientId, Date.now() + days * 86400000);
    return json(res, 200, { ok: true, ...extra }, { "Set-Cookie": `${PORTAL_CK}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${days * 86400}${secure}` });
  }

  /* ---------- Admin-API: Kunden, Chat, Prototypen ---------- */
  async function adminClientsApi(req, res, url, p, user) {
    const m = req.method;
    if (p === "/clients" && m === "GET") {
      const visible = clientIdsFor(user);
      const rows = db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM messages WHERE client_id = c.id AND sender = 'client' AND read_at IS NULL) unread,
          (SELECT body FROM messages WHERE client_id = c.id ORDER BY id DESC LIMIT 1) last_body,
          (SELECT created_at FROM messages WHERE client_id = c.id ORDER BY id DESC LIMIT 1) last_at,
          (SELECT COUNT(*) FROM prototypes WHERE client_id = c.id AND active = 1) protos,
          (SELECT COUNT(*) FROM appointment_requests WHERE client_id = c.id AND status = 'offen') requests
        FROM clients c ORDER BY c.active DESC, COALESCE(last_at, c.created_at) DESC`).all()
        .filter(r => visible === null || r.stage === "mandant");   // Entwickler sehen nur Mandanten
      const now = new Date().toISOString(), owner = visible === null;
      const extra = r => {
        const projs = db.prepare("SELECT id, title, phase, status, bereich FROM projects WHERE client_id = ?").all(r.id);
        const team = db.prepare("SELECT DISTINCT u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN projects p ON p.id = pm.project_id WHERE p.client_id = ? AND p.status = 'aktiv' ORDER BY u.name").all(r.id);
        const next = db.prepare("SELECT id, title, start FROM appointments WHERE client_id = ? AND start >= ? ORDER BY start LIMIT 1").get(r.id, now) || null;
        const last = r.stage !== "mandant" ? db.prepare("SELECT id, title, start, summary, notes_intern FROM appointments WHERE client_id = ? AND start < ? ORDER BY start DESC LIMIT 1").get(r.id, now) || null : null;
        const o = { projects: projs.map(p => ({ id: p.id, title: p.title, phase: p.phase, status: p.status, bereich: p.bereich || "software" })), team, next, last: last ? { id: last.id, title: last.title, start: last.start, summary: !!(last.summary || "").trim(), notiz: owner ? (last.notes_intern || "") : "" } : null };
        if (owner) {
          o.open_net = db.prepare("SELECT COALESCE(SUM(pay.amount_net),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE p.client_id = ? AND pay.status != 'bezahlt'").get(r.id).s;
          if (r.stage !== "mandant") {
            const q = db.prepare("SELECT description, kinds, budget FROM requests WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(r.id);
            const b = db.prepare("SELECT id, message, start, status, type FROM bookings WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(r.id);
            o.lead = { text: q?.description || b?.message || "", kinds: q?.kinds || "", budget: q?.budget || "", booking: b ? { id: b.id, start: b.start, status: b.status, type: b.type } : null };
            // Hat der Kontakt den Fragebogen schon ausgefüllt? (Onboarding für Software/Hardware, Vorab-Fragebogen für Websites)
            const fb = (b?.id && fragebogenStand(r.id, b.id)) || fragebogenStand(r.id);
            o.lead.fragebogen = fb;
            const ang = db.prepare("SELECT id, number, gross, issue_date, valid_until, title FROM invoices WHERE client_id = ? AND kind = 'angebot' AND locked = 1 AND status = 'versendet' ORDER BY id DESC LIMIT 1").get(r.id);
            const entwurf = ang ? null : db.prepare("SELECT id, title FROM invoices WHERE client_id = ? AND kind = 'angebot' AND locked = 0 ORDER BY id DESC LIMIT 1").get(r.id);
            o.offer = ang ? { id: ang.id, number: ang.number, gross: ang.gross, issue_date: ang.issue_date, valid_until: ang.valid_until, title: ang.title } : null;
            o.offerDraft = entwurf ? { id: entwurf.id, title: entwurf.title } : null;
          }
        }
        return o;
      };
      return json(res, 200, rows.filter(r => visible === null || visible.includes(r.id)).map(r => ({ ...publicClient(r), unread: r.unread, last_body: r.last_body, last_at: r.last_at, protos: r.protos, requests: r.requests, notes: owner ? r.notes || "" : undefined, ...extra(r) })));
    }
    if (p === "/clients" && m === "POST") {
      const d = await readJson(req);
      const c = { company: clean(d.company, 160) || clean(d.name, 120), name: clean(d.name, 120), email: clean(d.email, 160).toLowerCase(), phone: clean(d.phone, 40), stage: d.stage === "anfrage" ? "anfrage" : "mandant" };
      if (!c.company || !c.name || !isEmail(c.email)) return json(res, 400, { error: "Bitte Firma, Ansprechpartner und eine gültige E-Mail angeben." });
      if (db.prepare("SELECT 1 FROM clients WHERE email = ?").get(c.email)) return json(res, 409, { error: "Für diese E-Mail gibt es schon einen Kundenzugang." });
      const id = db.prepare("INSERT INTO clients(company, name, email, phone, stage, source) VALUES(?, ?, ?, ?, ?, 'manuell')").run(c.company, c.name, c.email, c.phone || null, c.stage).lastInsertRowid;
      if (c.stage === "anfrage") return json(res, 201, { client: publicClient(db.prepare("SELECT * FROM clients WHERE id = ?").get(id)) });
      const link = newInvite(id);
      const mailed = d.sendInvite ? await inviteMail(c, link) : null;
      return json(res, 201, { client: publicClient(db.prepare("SELECT * FROM clients WHERE id = ?").get(id)), inviteLink: link, mailed });
    }
    let mm = p.match(/^\/clients\/(\d+)(\/.*)?$/);
    if (!mm) return null;
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+mm[1]);
    if (!c) return json(res, 404, { error: "Kunde nicht gefunden" });
    const sub = mm[2] || "";

    if (sub === "" && m === "GET") return json(res, 200, publicClient(c));
    if (sub === "" && m === "PATCH") {
      const d = await readJson(req);
      const company = clean(d.company, 160) || c.company, name = clean(d.name, 120) || c.name;
      const active = d.active === undefined ? c.active : (d.active ? 1 : 0);
      db.prepare("UPDATE clients SET company = ?, name = ?, active = ? WHERE id = ?").run(company, name, active, c.id);
      if (!active) db.prepare("DELETE FROM client_sessions WHERE client_id = ?").run(c.id);
      return json(res, 200, publicClient(db.prepare("SELECT * FROM clients WHERE id = ?").get(c.id)));
    }
    if (sub === "/stage" && m === "PATCH") {   // Anfrage → Interessent → Mandant (mit Portalzugang) / Archiv
      const d = await readJson(req), stage = ["anfrage", "interessent", "mandant", "archiv"].includes(d.stage) ? d.stage : c.stage;
      db.prepare("UPDATE clients SET stage = ?, company = ?, name = ?, phone = ?, notes = ? WHERE id = ?")
        .run(stage, clean(d.company, 160) || c.company, clean(d.name, 120) || c.name, d.phone !== undefined ? clean(d.phone, 40) : c.phone, d.notes !== undefined ? clean(d.notes, 4000) : c.notes, c.id);
      let inviteLink = null, mailed = null;
      if (stage === "mandant" && c.stage !== "mandant" && !c.pw_hash) { inviteLink = newInvite(c.id); if (d.sendInvite) mailed = await inviteMail(c, inviteLink); }
      if (stage === "mandant" && c.stage !== "mandant") projects.logEvent(c.id, null, "projekt", "Willkommen als Mandant", "", false);
      return json(res, 200, { client: publicClient(db.prepare("SELECT * FROM clients WHERE id = ?").get(c.id)), inviteLink, mailed });
    }
    // Kontakt endgültig löschen (Datenschutz: Recht auf Löschung). Nur für Kontakte ohne Auftrag:
    // Sobald es ein verschicktes Angebot, eine Rechnung oder einen Vertrag gibt, müssen die Unterlagen aufbewahrt werden – dann bleibt nur „Archivieren“.
    if (sub === "/endgueltig" && m === "DELETE") {
      if (clientIdsFor(user) !== null) return json(res, 403, { error: "Nur für Inhaber." });
      if (c.stage === "mandant") return json(res, 409, { error: "Das ist ein Kunde mit Auftrag. Kunden lassen sich nur archivieren, nicht löschen." });
      const fest = db.prepare("SELECT COUNT(*) n FROM invoices WHERE client_id = ? AND locked = 1").get(c.id).n;
      const vertraege = db.prepare("SELECT COUNT(*) n FROM contracts WHERE client_id = ?").get(c.id).n;
      if (fest || vertraege) return json(res, 409, { error: "Zu diesem Kontakt gibt es ein verschicktes Angebot, eine Rechnung oder einen Vertrag. Diese Unterlagen müssen aufbewahrt werden – bitte archivieren statt löschen." });
      const protos = db.prepare("SELECT id, token FROM prototypes WHERE client_id = ?").all(c.id);
      const docs = db.prepare("SELECT file_token FROM documents WHERE client_id = ?").all(c.id);
      const buchungen = db.prepare("SELECT id FROM bookings WHERE client_id = ? OR lower(email) = ?").all(c.id, String(c.email || "").toLowerCase()).map(r => r.id);
      const frageb = db.prepare(`SELECT id FROM onboarding WHERE client_id = ?${buchungen.length ? ` OR booking_id IN (${buchungen.join(",")})` : ""}`).all(c.id).map(r => r.id);
      const inB = buchungen.length ? `(${buchungen.join(",")})` : "(NULL)";
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM invoices WHERE client_id = ? AND locked = 0").run(c.id);                 // Entwürfe; Positionen gehen mit
        db.prepare(`DELETE FROM vorab WHERE client_id = ? OR booking_id IN ${inB}`).run(c.id);
        db.prepare(`DELETE FROM onboarding WHERE client_id = ? OR booking_id IN ${inB}`).run(c.id);
        db.prepare("DELETE FROM requests WHERE client_id = ?").run(c.id);
        for (const t of ["nudges", "job_log"]) db.prepare(`DELETE FROM ${t} WHERE client_id = ?`).run(c.id);
        db.prepare("DELETE FROM password_resets WHERE kind = 'client' AND ref_id = ?").run(c.id);
        db.prepare("DELETE FROM login_log WHERE kind = 'client' AND ref_id = ?").run(c.id);
        for (const pr of protos) for (const t of ["test_shots", "test_cells"]) { try { db.prepare(`DELETE FROM ${t} WHERE prototype_id = ?`).run(pr.id); } catch {} }
        db.prepare(`DELETE FROM bookings WHERE id IN ${inB}`).run();
        db.prepare("DELETE FROM clients WHERE id = ?").run(c.id);                                        // Projekte, Termine, Nachrichten, Entwürfe, Dokumente gehen mit
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); return json(res, 500, { error: "Der Kontakt ließ sich nicht löschen: " + e.message }); }
      // Dateien zu den gelöschten Einträgen entfernen
      const DATA = path.resolve(process.env.DATA_DIR || "data");
      for (const pr of protos) await rm(path.join(PROTO_DIR, pr.token), { recursive: true, force: true }).catch(() => {});
      for (const d of docs) if (d.file_token) await rm(path.join(DATA, "documents", d.file_token), { force: true }).catch(() => {});
      for (const id of frageb) await rm(path.join(DATA, "onboarding", String(id)), { recursive: true, force: true }).catch(() => {});
      console.log(`Kontakt ${c.id} endgültig gelöscht (durch ${user?.name || "Inhaber"})`);
      return json(res, 200, { ok: true });
    }
    if (sub === "/invite" && m === "POST") {
      const d = await readJson(req), link = newInvite(c.id);
      const mailed = d.send ? await inviteMail(c, link) : null;
      return json(res, 200, { inviteLink: link, mailed });
    }
    if (sub === "/messages" && m === "GET") {
      const after = Math.max(0, +url.searchParams.get("after") || 0);
      const rows = listMessages(c.id, after);
      db.prepare("UPDATE messages SET read_at = datetime('now') WHERE client_id = ? AND sender = 'client' AND read_at IS NULL").run(c.id);
      return json(res, 200, rows);
    }
    if (sub === "/messages" && m === "POST") {
      const body = clean((await readJson(req)).body, 5000).replace(/\r/g, "");
      if (!body) return json(res, 400, { error: "Die Nachricht ist leer." });
      const r = db.prepare("INSERT INTO messages(client_id, sender, author, body) VALUES(?, 'team', ?, ?)").run(c.id, user.name, body);
      notifyClient(c);
      return json(res, 201, msgOut(db.prepare("SELECT * FROM messages WHERE id = ?").get(r.lastInsertRowid)));
    }
    if (sub === "/prototypes" && m === "GET") {
      const allowed = memberProjectIds(user);
      return json(res, 200, db.prepare("SELECT * FROM prototypes WHERE client_id = ? ORDER BY id DESC").all(c.id).filter(x => allowed === null || x.project_id == null || allowed.includes(x.project_id)).map(protoOut));
    }
    if (sub === "/prototypes" && m === "POST") {
      const d = await readJson(req, MAX_UPLOAD);
      const title = clean(d.title, 140), note = clean(d.note, 2000);
      if (!title) return json(res, 400, { error: "Bitte einen Titel angeben." });
      const files = Array.isArray(d.files) ? d.files.slice(0, MAX_FILES + 1) : [];
      if (!files.length) return json(res, 400, { error: "Keine Dateien ausgewählt." });
      if (files.length > MAX_FILES) return json(res, 400, { error: `Höchstens ${MAX_FILES} Dateien.` });
      const token = randomBytes(24).toString("hex"), dir = path.join(PROTO_DIR, token);
      const saved = [], skipped = []; let bytes = 0;
      for (const f of files) {
        const rel = safeRel(f.path);
        if (!rel || !PROTO_MIME[path.extname(rel).toLowerCase()]) { skipped.push(String(f.path || "").slice(0, 120)); continue; }
        const buf = Buffer.from(String(f.data || ""), "base64");
        const target = path.join(dir, rel);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, buf);
        saved.push(rel); bytes += buf.length;
      }
      const htmls = saved.filter(s => /\.html?$/i.test(s));
      const wanted = safeRel(d.entry);
      const byDepth = [...htmls].sort((a, b) => a.split("/").length - b.split("/").length);
      const entry = (wanted && htmls.includes(wanted) && wanted) || byDepth.find(s => /(^|\/)index\.html?$/i.test(s)) || byDepth[0];
      if (!entry) { await rm(dir, { recursive: true, force: true }); return json(res, 400, { error: "Es wurde keine HTML-Datei gefunden. Ein Prototyp braucht mindestens eine .html-Datei." }); }
      const prev = d.replaces ? db.prepare("SELECT * FROM prototypes WHERE client_id = ? AND (id = ? OR group_id = ?) ORDER BY version DESC LIMIT 1").get(c.id, +d.replaces, +d.replaces) : null;
      const projectId = prev ? prev.project_id : (d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null);
      const devAllowed = memberProjectIds(user);
      if (devAllowed && (!projectId || !devAllowed.includes(projectId))) return json(res, 403, { error: "Bitte ein Projekt wählen, dem Sie zugewiesen sind." });
      const version = prev ? prev.version + 1 : 1, groupId = prev ? (prev.group_id || prev.id) : null, changes = clean(d.changes, 3000);
      const r = db.prepare("INSERT INTO prototypes(client_id, title, note, token, entry, files, bytes, project_id, group_id, version, changes) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(c.id, title, note, token, entry, saved.length, bytes, projectId, groupId, version, changes);
      if (!groupId) db.prepare("UPDATE prototypes SET group_id = id WHERE id = ?").run(r.lastInsertRowid);
      projects.logEvent(c.id, projectId, "prototyp", version > 1 ? `Version ${version} veröffentlicht` : "Prototyp veröffentlicht", title + (changes ? ` – ${changes}` : ""), d.announce !== false);
      if (d.announce !== false) {
        const text = clean(d.message, 3000) || (version > 1
          ? `Neue Version ${version} von „${title}“ ist online.${changes ? " Das hat sich geändert:\n" + changes : ""}`
          : `Wir haben einen neuen Prototyp für Sie hochgeladen: „${title}“. Klicken Sie sich gern durch und schreiben Sie uns, was Ihnen auffällt.`);
        db.prepare("INSERT INTO messages(client_id, sender, author, body, prototype_id) VALUES(?, 'team', ?, ?, ?)").run(c.id, user.name, text, r.lastInsertRowid);
        /* Mail kommt gebündelt über den Meilenstein */
      }
      return json(res, 201, { prototype: protoOut(db.prepare("SELECT * FROM prototypes WHERE id = ?").get(r.lastInsertRowid)), skipped });
    }
    mm = sub.match(/^\/prototypes\/(\d+)$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM prototypes WHERE id = ? AND client_id = ?").get(+mm[1], c.id);
      if (!pr) return json(res, 404, { error: "Prototyp nicht gefunden" });
      const devAllowed2 = memberProjectIds(user);
      if (devAllowed2 && pr.project_id != null && !devAllowed2.includes(pr.project_id)) return json(res, 404, { error: "Prototyp nicht gefunden" });
      if (m === "PATCH") {
        const d = await readJson(req);
        db.prepare("UPDATE prototypes SET title = ?, note = ?, active = ? WHERE id = ?")
          .run(clean(d.title, 140) || pr.title, d.note !== undefined ? clean(d.note, 2000) : pr.note, d.active === undefined ? pr.active : (d.active ? 1 : 0), pr.id);
        return json(res, 200, protoOut(db.prepare("SELECT * FROM prototypes WHERE id = ?").get(pr.id)));
      }
      if (m === "DELETE") {
        await rm(path.join(PROTO_DIR, pr.token), { recursive: true, force: true });
        db.prepare("DELETE FROM prototypes WHERE id = ?").run(pr.id);
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 404, { error: "Unbekannt" });
  }

  /* ---------- Prototypen ausliefern: /p/<token>/<pfad> ---------- */
  async function servePrototype(req, res, url) {
    const mm = url.pathname.match(/^\/p\/([a-f0-9]{48})(\/.*)?$/);
    if (!mm) return send(res, 404, "Nicht gefunden");
    const pr = db.prepare("SELECT * FROM prototypes WHERE token = ? AND (active = 1 OR state = 'kandidat')").get(mm[1]);   // Kandidaten nur über den (geheimen) Link fürs Team
    if (!pr) return send(res, 404, "Dieser Prototyp ist nicht mehr verfügbar.", { "Content-Type": "text/plain; charset=utf-8" });
    let rel = mm[2] ? safeRel(decodeURIComponent(mm[2].slice(1))) : "";
    if (mm[2] === undefined || mm[2] === "/") return send(res, 302, "", { Location: `/p/${pr.token}/${pr.entry}` });
    if (!rel) return send(res, 404, "Nicht gefunden");
    const base = path.join(PROTO_DIR, pr.token);
    let file = path.join(base, rel);
    try { if ((await stat(file)).isDirectory()) { rel = rel.replace(/\/?$/, "/index.html"); file = path.join(base, rel); } } catch {}
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(base + path.sep) || !PROTO_MIME[ext]) return send(res, 404, "Nicht gefunden");
    let body;
    try { body = await readFile(file); } catch { return send(res, 404, "Nicht gefunden", { "Content-Type": "text/plain; charset=utf-8" }); }
    if (ext === ".html" || ext === ".htm") {
      const html = body.toString("utf8");
      body = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, h => h + SHIM + PICK) : SHIM + PICK + html;
    }
    send(res, 200, body, {
      "Content-Type": PROTO_MIME[ext],
      // Eigener, undurchsichtiger Ursprung: kein Zugriff auf Cookies, Logins oder Speicher – auch nicht im eigenen Tab.
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-modals allow-popups; frame-ancestors 'self'; form-action 'none'",
      "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
    });
  }

  return { extend: fn => ext.push(fn), portalApi, adminClientsApi, servePrototype, projectsAdmin: projects.admin, requestsAdmin: requests.admin, clientLogin: login, currentClient, newInvite, logEvent: projects.logEvent };
}

// Relativer, sauberer Pfad innerhalb eines Prototyps – oder "" bei allem Verdächtigen.
export function safeRel(p) {
  const s = String(p || "").replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (!s || s.length > 300 || /[\u0000-\u001f]/.test(s)) return "";
  const parts = s.split("/");
  if (parts.some(x => !x || x === "." || x === ".." || x.startsWith(".") && x !== ".well-known")) return "";
  if (parts[0] === "__MACOSX") return "";
  return parts.join("/");
}
