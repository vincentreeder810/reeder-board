// Sicherheit & Livegang: „Passwort vergessen“ (Team und Kunden), Zwei-Faktor-Anmeldung (TOTP) fürs Team,
// Anmeldeprotokoll und die Checkliste „Livegang“ mit automatischen und manuell bestätigten Punkten.
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { db, getSetting, setSetting, DEFAULT_COMPANY } from "./db.mjs";
import { sendMail, mailStatus } from "./mail.mjs";
import { vorlage } from "./mail-vorlagen.mjs";
import { isOwner } from "./access.mjs";
import { DEFAULT_CONTRACT } from "./contracts.mjs";
import { listBackups } from "./ops.mjs";

{
  const add = (t, col, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("users", "totp_secret", "TEXT"); add("users", "totp_enabled", "INTEGER NOT NULL DEFAULT 0"); add("users", "totp_backup", "TEXT");
}
db.exec(`
CREATE TABLE IF NOT EXISTS password_resets ( token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, expires INTEGER NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE IF NOT EXISTS login_log ( id INTEGER PRIMARY KEY, kind TEXT, ref_id INTEGER, email TEXT, ip TEXT, ok INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX IF NOT EXISTS login_log_ref ON login_log(kind, ref_id, id);
`);
const sha = s => createHash("sha256").update(String(s)).digest("hex");

/* ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 Ziffern) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32enc = buf => { let bits = 0, val = 0, out = ""; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; };
const b32dec = s => { let bits = 0, val = 0; const out = []; for (const ch of s.replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
export function totp(secret, t = Date.now(), step = 0) {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000) + step));
  const h = createHmac("sha1", b32dec(secret)).update(ctr).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
const totpOk = (secret, code) => { const c = String(code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return false; return [-1, 0, 1].some(s => { const a = Buffer.from(totp(secret, Date.now(), s)), b = Buffer.from(c); return timingSafeEqual(a, b); }); };

export function createSecurity({ json, readJson, clean, limited, ipOf, hashPw, checkPw, SITE_URL, issueAdmin, issueClient, ADMIN_CK }) {
  const challenges = new Map();   // Zwischenschritt nach richtigem Passwort, vor dem Code (5 Minuten gültig)
  const log = (kind, ref, email, req, ok, reason = "") => db.prepare("INSERT INTO login_log(kind, ref_id, email, ip, ok, reason) VALUES(?,?,?,?,?,?)").run(kind, ref ?? null, email, ipOf(req), ok ? 1 : 0, reason);
  const company = () => getSetting("company", DEFAULT_COMPANY);

  /** Nach richtigem Passwort eines Team-Zugangs: entweder direkt anmelden oder Code verlangen */
  function afterPassword(req, res, u) {
    if (!u.totp_enabled) { log("team", u.id, u.email, req, true); return issueAdmin(res, u.id); }
    const ch = randomBytes(24).toString("hex"); challenges.set(ch, { uid: u.id, exp: Date.now() + 5 * 60e3, tries: 0 });
    return json(res, 200, { need2fa: true, challenge: ch });
  }
  const failed = (req, kind, ref, email, reason) => log(kind, ref, email, req, false, reason);

  /* ---------- öffentliche Routen ---------- */
  async function publicRoutes(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === "/api/login/2fa" && m === "POST") {
      if (limited("2fa:" + ipOf(req), 10, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." });
      const d = await readJson(req), ch = challenges.get(String(d.challenge || ""));
      if (!ch || ch.exp < Date.now()) return json(res, 401, { error: "Die Anmeldung ist abgelaufen. Bitte noch einmal mit Passwort anmelden." });
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(ch.uid);
      const code = String(d.code || "").replace(/\s|-/g, "");
      let ok = u && totpOk(u.totp_secret, code), viaBackup = false;
      if (u && !ok && /^[a-z0-9]{8,10}$/i.test(code)) { const list = JSON.parse(u.totp_backup || "[]"), h = sha(code.toLowerCase());
        if (list.includes(h)) { ok = viaBackup = true; db.prepare("UPDATE users SET totp_backup = ? WHERE id = ?").run(JSON.stringify(list.filter(x => x !== h)), u.id); } }
      if (!ok) { if (++ch.tries >= 5) challenges.delete(d.challenge); failed(req, "team", u?.id, u?.email, "falscher Code"); return json(res, 401, { error: "Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben." }); }
      challenges.delete(d.challenge); log("team", u.id, u.email, req, true, viaBackup ? "Notfallcode" : "2FA");
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
      return issueAdmin(res, u.id, viaBackup ? { warn: `Notfallcode verwendet – noch ${JSON.parse(db.prepare("SELECT totp_backup FROM users WHERE id = ?").get(u.id).totp_backup || "[]").length} übrig.` } : {});
    }
    if (p === "/api/password/forgot" && m === "POST") {
      const d = await readJson(req), email = clean(d.email, 160).toLowerCase(), generic = { ok: true, message: "Falls es zu dieser Adresse einen Zugang gibt, ist eine E-Mail mit einem Link unterwegs. Er ist eine Stunde gültig." };
      if (limited("forgot:" + ipOf(req), 5, 15 * 60000) || limited("forgot:" + email, 3, 60 * 60000)) return json(res, 200, generic);   // keine Auskunft, ob gedrosselt oder unbekannt
      const u = db.prepare("SELECT id, name, email FROM users WHERE email = ? AND active = 1").get(email);
      const c = !u && db.prepare("SELECT id, name, email FROM clients WHERE email = ? AND active = 1 AND pw_hash IS NOT NULL").get(email);   // jeder Kontakt mit Konto – auch Interessenten, die es beim Fragebogen angelegt haben
      const who = u || c; if (!who) return json(res, 200, generic);
      const token = randomBytes(32).toString("hex"), kind = u ? "team" : "client";
      db.prepare("DELETE FROM password_resets WHERE kind = ? AND ref_id = ? AND used_at IS NULL").run(kind, who.id);
      db.prepare("INSERT INTO password_resets(token_hash, kind, ref_id, expires) VALUES(?,?,?,?)").run(sha(token), kind, who.id, Date.now() + 3600e3);
      const link = `${SITE_URL}/${u ? "admin" : "portal"}/#passwort=${token}`;
      await sendMail({ to: who.email, ...vorlage("passwort_link", { name: who.name, link }) }).catch(e => console.warn(e.message));
      log(kind, who.id, who.email, req, true, "Passwort-Link angefordert");
      return json(res, 200, generic);
    }
    if (p === "/api/password/reset" && m === "POST") {
      if (limited("reset:" + ipOf(req), 10, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte später erneut versuchen." });
      const d = await readJson(req), r = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha(String(d.token || "")));
      if (!r || r.used_at || r.expires < Date.now()) return json(res, 400, { error: "Dieser Link ist abgelaufen oder wurde schon verwendet. Bitte einen neuen anfordern." });
      if (d.check) return json(res, 200, { ok: true });
      const pw = String(d.password || ""); if (pw.length < 10) return json(res, 400, { error: "Das Passwort braucht mindestens 10 Zeichen." });
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(r.token_hash);
      if (r.kind === "team") { db.prepare("UPDATE users SET pw_hash = ?, invite_token = NULL WHERE id = ?").run(hashPw(pw), r.ref_id); db.prepare("DELETE FROM sessions WHERE user_id = ?").run(r.ref_id); }
      else { db.prepare("UPDATE clients SET pw_hash = ?, invite_token = NULL, invite_expires = NULL WHERE id = ?").run(hashPw(pw), r.ref_id); db.prepare("DELETE FROM client_sessions WHERE client_id = ?").run(r.ref_id); }
      log(r.kind, r.ref_id, null, req, true, "Passwort neu gesetzt");
      return json(res, 200, { ok: true, to: r.kind === "team" ? "/admin/" : "/portal/" });
    }
    return null;
  }

  /* ---------- Board ---------- */
  const pending = new Map();   // Einrichtung 2FA: Geheimnis erst nach bestätigtem Code speichern
  async function admin(req, res, url, p, m, user) {
    if (p.startsWith("/security")) {
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      if (p === "/security/me" && m === "GET") return json(res, 200, { totp: !!u.totp_enabled, backupLeft: JSON.parse(u.totp_backup || "[]").length,
        logins: db.prepare("SELECT ip, ok, reason, created_at FROM login_log WHERE kind = 'team' AND ref_id = ? ORDER BY id DESC LIMIT 10").all(user.id) });
      if (p === "/security/2fa/setup" && m === "POST") {
        const secret = b32enc(randomBytes(20)); pending.set(user.id, secret);
        const issuer = encodeURIComponent(company().name || "Reeder Board");
        return json(res, 200, { secret, uri: `otpauth://totp/${issuer}:${encodeURIComponent(u.email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` });
      }
      if (p === "/security/2fa/enable" && m === "POST") {
        const d = await readJson(req), secret = pending.get(user.id);
        if (!secret) return json(res, 400, { error: "Bitte die Einrichtung neu starten." });
        if (!totpOk(secret, d.code)) return json(res, 400, { error: "Der Code stimmt nicht – bitte den aktuellen Code aus der App eingeben (Uhrzeit des Handys prüfen)." });
        const codes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
        db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_backup = ? WHERE id = ?").run(secret, JSON.stringify(codes.map(c => sha(c))), user.id);
        pending.delete(user.id); return json(res, 200, { ok: true, backupCodes: codes });
      }
      if (p === "/security/2fa/disable" && m === "POST") {
        const d = await readJson(req);
        if (!checkPw(String(d.password || ""), u.pw_hash)) return json(res, 400, { error: "Das Passwort stimmt nicht." });
        db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup = NULL WHERE id = ?").run(user.id); return json(res, 200, { ok: true });
      }
      if (p === "/security/logins" && m === "GET") {
        if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
        return json(res, 200, db.prepare("SELECT l.*, COALESCE(u.name, c.company) who FROM login_log l LEFT JOIN users u ON l.kind = 'team' AND u.id = l.ref_id LEFT JOIN clients c ON l.kind = 'client' AND c.id = l.ref_id ORDER BY l.id DESC LIMIT 60").all());
      }
      return json(res, 404, { error: "Nicht gefunden" });
    }
    if (p !== "/livegang") return null;
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
    if (m === "PUT") { const d = await readJson(req), cur = getSetting("golive", {}); const next = { ...cur };
      for (const k of MANUAL.map(x => x.k)) if (k in d) next[k] = d[k] ? { by: user.name, at: new Date().toISOString() } : null;
      setSetting("golive", next); }
    return json(res, 200, await checklist());
  }

  const MANUAL = [
    { k: "legalContract", t: "Vertragsbedingungen und AVV anwaltlich geprüft", d: "Die mitgelieferten Texte sind ein Entwurf. Erst nach Prüfung für echte Aufträge verwenden." },
    { k: "legalSite", t: "Impressum und Datenschutzerklärung geprüft", d: "Inkl. Kundenportal, Terminbuchung, E-Mail-Anbieter und Hosting als Auftragsverarbeiter." },
    { k: "taxAdvisor", t: "Kontenrahmen (SKR04) und DATEV-Export mit dem Steuerberater abgestimmt", d: "Einmal einen Testexport schicken und bestätigen lassen." },
    { k: "hosting", t: "Server mit dauerhaftem Speicher eingerichtet", d: "Die Datenbank und Dateien müssen einen Neustart überleben (bei Render: „Persistent Disk“). Siehe LIVEGANG.txt." },
    { k: "domain", t: "Domain zeigt auf den Server, HTTPS aktiv", d: "Danach SITE_URL auf https://… umstellen – Links in E-Mails und sichere Cookies hängen davon ab." },
    { k: "offsite", t: "Sicherung außerhalb des Servers geregelt", d: "z. B. wöchentlich die Komplettsicherung (Einstellungen → Betrieb) herunterladen und extern ablegen." },
    { k: "testdata", t: "Testzugänge und Demo-Inhalte entfernt", d: "Echte Kunden erst einladen, wenn keine Testdaten mehr im echten Board sind." },
  ];
  async function checklist() {
    const c = company(), man = getSetting("golive", {});
    const missing = [["name", "Firmenname"], ["street", "Straße"], ["zip", "PLZ"], ["city", "Ort"], ["managingDirector", "Geschäftsführer"], ["register", "Handelsregister"], ["iban", "IBAN"]].filter(([k]) => !c[k]).map(([, l]) => l);
    if (!c.taxNumber && !c.vatId) missing.push("Steuernummer oder USt-IdNr.");
    const owners = db.prepare("SELECT name, totp_enabled FROM users WHERE role = 'inhaber' AND active = 1").all();
    const backups = await listBackups(), contract = getSetting("contract", DEFAULT_CONTRACT);
    const testClients = db.prepare("SELECT COUNT(*) n FROM clients WHERE email LIKE '%@example.com'").get().n;
    const outboxErr = db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'fehlgeschlagen' AND created_at >= datetime('now','-7 days')").get().n;
    const site = p => existsSync(p) ? readFileSync(p, "utf8") : "";
    const imp = site("impressum.html"), dse = site("datenschutz.html");
    const auto = [
      { k: "company", t: "Unternehmensdaten vollständig (Pflichtangaben auf Rechnungen)", ok: !missing.length, d: missing.length ? `Es fehlt: ${missing.join(", ")}.` : "Alles da.", href: "#einstellungen/firma" },
      { k: "mail", t: "E-Mail-Versand eingerichtet", ok: !!mailStatus().ready && !outboxErr, d: mailStatus().ready ? (outboxErr ? `${outboxErr} Mails in den letzten 7 Tagen fehlgeschlagen.` : `Versand über ${mailStatus().host}.`) : "Noch nicht eingerichtet – alles landet im Postausgang.", href: "#einstellungen/email" },
      { k: "https", t: "Website-Adresse mit https", ok: SITE_URL.startsWith("https://"), d: `Aktuell: ${SITE_URL}`, href: null },
      { k: "2fa", t: "Zwei-Faktor-Anmeldung für alle Inhaber", ok: owners.length > 0 && owners.every(o => o.totp_enabled), d: owners.filter(o => !o.totp_enabled).length ? `Noch ohne: ${owners.filter(o => !o.totp_enabled).map(o => o.name).join(", ")}.` : "Alle Inhaber geschützt.", href: "#einstellungen/konto" },
      { k: "backup", t: "Tägliche Datensicherung läuft", ok: !!backups.length && Date.now() - Date.parse(backups[0].at) < 30 * 3600e3, d: backups.length ? `Letzte: ${new Date(backups[0].at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : "Noch keine Sicherung.", href: "#einstellungen/betrieb" },
      { k: "contract", t: "Vertragstexte an Ihr Unternehmen angepasst", ok: contract.terms !== DEFAULT_CONTRACT.terms || !!man.legalContract, d: contract.terms === DEFAULT_CONTRACT.terms ? "Noch die mitgelieferte Vorlage." : "Eigene Fassung hinterlegt.", href: "#einstellungen/vertrag" },
      { k: "legal", t: "Impressum und Datenschutzerklärung vorhanden", ok: imp.length > 500 && dse.length > 500 && !/platzhalter|musterstra|lorem/i.test(imp + dse), d: imp && dse ? (/platzhalter|musterstra|lorem/i.test(imp + dse) ? "Seiten vorhanden, enthalten aber noch Platzhalter." : "Beide Seiten vorhanden.") : "Seite fehlt.", href: null },
      { k: "testdata", t: "Keine Test-Kontakte (@example.com)", ok: !testClients, d: testClients ? `${testClients} Kontakte mit @example.com-Adresse.` : "Keine gefunden.", href: "#kunden" },
    ];
    const manual = MANUAL.map(x => ({ ...x, ok: !!man[x.k], by: man[x.k]?.by, at: man[x.k]?.at }));
    const all = [...auto, ...manual];
    return { auto, manual, done: all.filter(x => x.ok).length, total: all.length, ready: all.every(x => x.ok) };
  }
  const recentFails = () => db.prepare("SELECT COUNT(*) n FROM login_log WHERE ok = 0 AND created_at >= datetime('now','-1 day')").get().n;
  return { publicRoutes, admin, afterPassword, failed, log, checklist, recentFails };
}
