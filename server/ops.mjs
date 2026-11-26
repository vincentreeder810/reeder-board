// Betrieb: tägliche Datensicherung der Datenbank, Systemstatus und Erreichbarkeitsprüfung für Kundensysteme.
import { mkdir, readdir, stat, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "./db.mjs";
import { isOwner } from "./access.mjs";
import { mailStatus, sendMail } from "./mail.mjs";
import { createZip } from "./zip.mjs";

const DATA = path.resolve(process.env.DATA_DIR || "data"), BACKUPS = path.join(DATA, "backups");
const KEEP = 14;
db.exec(`
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1, interval_min INTEGER NOT NULL DEFAULT 5,
  last_checked TEXT, last_ok INTEGER, last_ms INTEGER, last_error TEXT, down_since TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS monitor_days ( monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, day TEXT NOT NULL, checks INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (monitor_id, day) );
CREATE TABLE IF NOT EXISTS outages ( id INTEGER PRIMARY KEY, monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, started_at TEXT NOT NULL, ended_at TEXT, error TEXT );
`);
const startedAt = Date.now();
const day = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const dirSize = async dir => { let s = 0, n = 0; try { for (const f of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, f.name);
  if (f.isDirectory()) { const r = await dirSize(p); s += r.bytes; n += r.files; } else { s += (await stat(p)).size; n++; } } } catch {} return { bytes: s, files: n }; };

/* ---------- Datensicherung ---------- */
export async function listBackups() {
  try { const files = (await readdir(BACKUPS)).filter(f => /^reeder-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/.test(f)).sort().reverse();
    return Promise.all(files.map(async f => ({ name: f, bytes: (await stat(path.join(BACKUPS, f))).size, at: (await stat(path.join(BACKUPS, f))).mtime.toISOString() }))); }
  catch { return []; }
}
/** Konsistente Kopie der Datenbank per VACUUM INTO (auch während des Betriebs sicher); alte Sicherungen über 14 werden entfernt */
export async function backup(manual = false) {
  await mkdir(BACKUPS, { recursive: true });
  const name = `reeder-${day()}${manual ? "-" + new Date().toTimeString().slice(0, 8).replace(/:/g, "") : ""}.db`, file = path.join(BACKUPS, name);
  await rm(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = await listBackups();
  for (const b of all.slice(KEEP)) await rm(path.join(BACKUPS, b.name), { force: true });
  return { name, bytes: (await stat(file)).size };
}

export function createOps({ json, send, readJson, clean, automationStatus = () => null }) {
  /* ---------- Erreichbarkeit ---------- */
  async function check(mon) {
    const t0 = Date.now(); let ok = false, err = null, ms = null;
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(mon.url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "ReederBoard-Monitor/1.0" } });
      clearTimeout(to); ms = Date.now() - t0; ok = r.status < 500; if (!ok) err = `HTTP ${r.status}`;
      r.body?.cancel?.().catch(() => {});
    } catch (e) { err = e.name === "AbortError" ? "Zeitüberschreitung (10 s)" : (e.cause?.code || e.message || "nicht erreichbar"); }
    const d = day();
    db.prepare("INSERT INTO monitor_days(monitor_id, day, checks, ok) VALUES(?,?,1,?) ON CONFLICT(monitor_id, day) DO UPDATE SET checks = checks + 1, ok = ok + excluded.ok").run(mon.id, d, ok ? 1 : 0);
    const was = mon.last_ok;
    db.prepare("UPDATE monitors SET last_checked = datetime('now'), last_ok = ?, last_ms = ?, last_error = ?, down_since = CASE WHEN ? THEN NULL ELSE COALESCE(down_since, datetime('now')) END WHERE id = ?")
      .run(ok ? 1 : 0, ms, err, ok ? 1 : 0, mon.id);
    if (!ok && was !== 0) db.prepare("INSERT INTO outages(monitor_id, started_at, error) VALUES(?, datetime('now'), ?)").run(mon.id, err);
    if (ok && was === 0) db.prepare("UPDATE outages SET ended_at = datetime('now') WHERE monitor_id = ? AND ended_at IS NULL").run(mon.id);
    return { ok, was, err, ms };
  }
  /** Automatik: fällige Prüfungen ausführen; Ausfall → Vorschlag + Mail an Inhaber (einmal pro Ausfall), Wiederherstellung → Mail */
  async function runMonitors({ nudge, settle }) {
    const keys = [];
    for (const mon of db.prepare("SELECT * FROM monitors WHERE active = 1").all()) {
      const due = !mon.last_checked || Date.now() - Date.parse(mon.last_checked.replace(" ", "T") + "Z") >= mon.interval_min * 60e3 - 5000;
      let r = null; if (due) r = await check(mon);
      const cur = db.prepare("SELECT m.*, c.company FROM monitors m LEFT JOIN clients c ON c.id = m.client_id WHERE m.id = ?").get(mon.id);
      if (cur.last_ok === 0) {
        const k = `ausfall:${cur.id}:${cur.down_since}`; keys.push(k);
        nudge({ key: k, kind: "ausfall", ref: cur.id, client: cur.client_id, project: cur.project_id, href: "#einstellungen/betrieb", action: "openOps",
          title: `Nicht erreichbar · ${cur.name}`, text: `${cur.url} – ${cur.last_error || "Fehler"} · seit ${new Date(cur.down_since.replace(" ", "T") + "Z").toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} Uhr${cur.company ? " · " + cur.company : ""}` });
      }
      if (r && r.was !== 0 && !r.ok || r && r.was === 0 && r.ok) for (const u of db.prepare("SELECT email FROM users WHERE role = 'inhaber' AND active = 1").all())
        await sendMail({ to: u.email, subject: r.ok ? `✅ Wieder erreichbar: ${cur.name}` : `🔴 Nicht erreichbar: ${cur.name}`, text: `${cur.url}\n${r.ok ? `Antwortet wieder (${r.ms} ms).` : `Fehler: ${r.err}`}\n\nDas Board prüft alle ${cur.interval_min} Minuten.` }).catch(() => {});
    }
    settle("ausfall", keys);
  }
  const monOut = m => { const days = db.prepare("SELECT SUM(checks) c, SUM(ok) o FROM monitor_days WHERE monitor_id = ? AND day >= ?").get(m.id, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    return { ...m, active: !!m.active, uptime30: days.c ? Math.round(days.o / days.c * 10000) / 100 : null,
      outages: db.prepare("SELECT started_at, ended_at, error FROM outages WHERE monitor_id = ? ORDER BY id DESC LIMIT 5").all(m.id) }; };

  /* ---------- Datensicherung: täglich nach 2 Uhr bzw. beim Start, wenn die letzte älter als 24 Std. ist ---------- */
  let lastBackupErr = null;
  async function dailyBackup() {
    if (process.env.BACKUP_DISABLED) return;
    const list = await listBackups(), today = day();
    const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(new Date());
    if (list.some(b => b.name.startsWith(`reeder-${today}`))) return;
    if (hour < 2 && list.length && Date.now() - Date.parse(list[0].at) < 26 * 3600e3) return;
    try { await backup(false); lastBackupErr = null; } catch (e) { lastBackupErr = e.message; console.warn("Datensicherung:", e.message); }
  }

  async function status() {
    const dbFile = path.join(DATA, "reeder.db"); let dbBytes = 0; try { dbBytes = (await stat(dbFile)).size + ((await stat(dbFile + "-wal").catch(() => ({ size: 0 }))).size); } catch {}
    const docs = await dirSize(path.join(DATA, "documents")), fin = await dirSize(path.join(DATA, "finance")), protos = await dirSize(path.join(DATA, "prototypes"));
    const backups = await listBackups(), mail = mailStatus(), auto = automationStatus();
    const outbox = db.prepare("SELECT COUNT(*) n, SUM(status = 'fehlgeschlagen') err FROM outbox WHERE created_at >= datetime('now', '-7 days')").get();
    const checks = [
      { k: "Datensicherung", ok: !!backups.length && Date.now() - Date.parse(backups[0].at) < 30 * 3600e3, text: backups.length ? `letzte ${new Date(backups[0].at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · ${backups.length} von ${KEEP} vorgehalten` : "noch keine Sicherung" + (lastBackupErr ? " – " + lastBackupErr : "") },
      { k: "E-Mail-Versand", ok: !!mail.ready, text: mail.ready ? `aktiv über ${mail.host}` : "nicht eingerichtet – Mails landen nur im Postausgang" },
      { k: "Automatik", ok: !!auto?.at && Date.now() - Date.parse(auto.at) < 5 * 60e3 && !auto.error, text: auto?.at ? `zuletzt ${new Date(auto.at).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" })} Uhr${auto.error ? " – Fehler: " + auto.error : ""}` : "noch nicht gelaufen" },
      { k: "Kundensysteme", ok: !db.prepare("SELECT 1 FROM monitors WHERE active = 1 AND last_ok = 0").get(), text: (() => { const r = db.prepare("SELECT COUNT(*) n, SUM(last_ok = 0) down FROM monitors WHERE active = 1").get(); return r.n ? `${r.n} überwacht${r.down ? ` · ${r.down} nicht erreichbar` : " · alle erreichbar"}` : "keine Überwachung eingerichtet"; })() },
    ];
    return { checks, uptimeMin: Math.round((Date.now() - startedAt) / 60000), node: process.version, platform: `${os.type()} ${os.release()}`, data: DATA,
      sizes: { db: dbBytes, documents: docs.bytes, documentFiles: docs.files, finance: fin.bytes, prototypes: protos.bytes }, backups, outbox: { week: outbox.n, errors: outbox.err || 0 },
      counts: Object.fromEntries(["clients", "projects", "invoices", "documents", "messages", "tickets", "tasks", "time_entries"].map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])) };
  }

  async function api(req, res, url, p, m, user) {
    if (p !== "/health" && !p.startsWith("/betrieb")) return null;
    if (p === "/health") return json(res, 200, { ok: true, uptimeMin: Math.round((Date.now() - startedAt) / 60000) });
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
    if (p === "/betrieb" && m === "GET") return json(res, 200, { ...(await status()), monitors: db.prepare("SELECT m.*, c.company, pr.title project_title FROM monitors m LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN projects pr ON pr.id = m.project_id ORDER BY m.name").all().map(monOut) });
    if (p === "/betrieb/backup" && m === "POST") return json(res, 200, await backup(true));
    // Testbetrieb: alle Kunden und alles Zugehörige entfernen, um von vorn zu beginnen.
    // Bleibt erhalten: Zugänge des Teams, Einstellungen (Firma, E-Mail, Verfügbarkeit …), Vertragsfassungen, Produkte, Protokolle.
    // Vorher entsteht automatisch eine Sicherung der Datenbank. Nötig ist die ausgeschriebene Bestätigung.
    if (p === "/betrieb/leeren" && m === "POST") {
      const d = await readJson(req);
      if (String(d.bestaetigung || "").trim().toUpperCase() !== "ALLES LÖSCHEN") return json(res, 400, { error: "Bitte zur Bestätigung genau „ALLES LÖSCHEN“ eintippen." });
      const sicherung = await backup(true);
      const LEEREN = ["acceptances", "agreement_reports", "agreements", "annotations", "appointment_requests", "appointments", "assistant_threads", "bookings", "build_jobs", "client_sessions", "clients", "contracts", "covered_sync",
        "documents", "events", "expenses", "firm_locks", "invoice_items", "invoices", "job_log", "messages", "monitor_days", "monitors", "nudges", "number_sequences", "onboarding", "outages", "outbox", "password_resets", "payments",
        "period_locks", "project_members", "projects", "proto_seen", "prototypes", "requests", "tasks", "test_cells", "test_findings", "test_runs", "test_shots", "ticket_messages", "tickets", "time_entries", "timers", "vorab"];
      const da = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(x => x.name)), zahl = {};
      db.exec("PRAGMA foreign_keys = OFF");
      // Die Löschsperren für festgeschriebene Belege legt das Board beim nächsten Start neu an (CREATE TRIGGER IF NOT EXISTS)
      for (const t of ["trg_invoice_nodelete", "trg_items_immutable_d", "trg_accept_d", "trg_expense_nodelete"]) db.exec(`DROP TRIGGER IF EXISTS ${t}`);
      db.exec("BEGIN");
      try { for (const t of LEEREN) if (da.has(t)) { const n = db.prepare(`DELETE FROM "${t}"`).run().changes; if (n) zahl[t] = n; } db.exec("COMMIT"); }
      catch (e) { db.exec("ROLLBACK"); db.exec("PRAGMA foreign_keys = ON"); return json(res, 500, { error: "Das Leeren ist fehlgeschlagen, es wurde nichts gelöscht: " + e.message }); }
      db.exec("PRAGMA foreign_keys = ON");
      // Dateien der gelöschten Einträge: Prototypen, Dokumente, Belege, Fragebogen-Uploads, Hardware-Konzepte, Prüfbilder
      for (const o of ["prototypes", "documents", "finance", "onboarding", "hardware", "pruefung"]) await rm(path.join(DATA, o), { recursive: true, force: true }).catch(() => {});
      db.prepare("INSERT INTO audit_log(actor, action, entity, entity_id, summary) VALUES(?, 'testdaten geleert', 'system', NULL, ?)").run(user.name, `Sicherung ${sicherung.name}`);
      console.log(`Testdaten geleert durch ${user.name} · Sicherung ${sicherung.name}`);
      // Auf dem Server neu starten, damit die Löschsperren sofort wieder gelten
      if (process.env.RENDER) setTimeout(() => process.exit(0), 1200);
      return json(res, 200, { ok: true, sicherung: sicherung.name, geloescht: zahl, neustart: !!process.env.RENDER });
    }
    if (p === "/betrieb/komplett" && m === "GET") {   // Datenbank + alle Dateien als ZIP (für die Sicherung außerhalb des Servers)
      const tmp = path.join(BACKUPS, `export-${Date.now()}.db`); await mkdir(BACKUPS, { recursive: true });
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const files = [{ path: "reeder.db", data: await readFile(tmp) }]; await rm(tmp, { force: true });
      const walk = async (dir, prefix) => { try { for (const f of await readdir(dir, { withFileTypes: true })) { if (f.isDirectory()) await walk(path.join(dir, f.name), `${prefix}/${f.name}`); else files.push({ path: `${prefix}/${f.name}`, data: await readFile(path.join(dir, f.name)) }); } } catch {} };
      for (const d of ["documents", "finance", "prototypes"]) await walk(path.join(DATA, d), d);
      files.push({ path: "LIESMICH.txt", data: `Komplettsicherung Reeder Board vom ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}\r\n\r\nreeder.db = Datenbank, documents/finance/prototypes = Dateien.\r\nWiederherstellen: alles in den Datenordner (DATA_DIR) entpacken und den Server neu starten.\r\n` });
      return send(res, 200, createZip(files), { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Reeder-Komplettsicherung-${day()}.zip"`, "Cache-Control": "no-store" });
    }
    let mm = p.match(/^\/betrieb\/backup\/(reeder-[\d-]+\.db)$/);
    if (mm && m === "GET") { const f = path.join(BACKUPS, mm[1]); try { const buf = await readFile(f);
      return send(res, 200, buf, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${mm[1]}"`, "Cache-Control": "no-store" }); } catch { return json(res, 404, { error: "Sicherung nicht gefunden" }); } }
    if (p === "/betrieb/monitors" && m === "POST") {
      const d = await readJson(req), name = clean(d.name, 80), u = clean(d.url, 300);
      if (!name || !/^https?:\/\/[^\s]+$/i.test(u)) return json(res, 400, { error: "Bitte Namen und eine vollständige Adresse (https://…) angeben." });
      const pid = +d.project_id || null, cid = pid ? db.prepare("SELECT client_id FROM projects WHERE id = ?").get(pid)?.client_id ?? null : (+d.client_id || null);
      const id = db.prepare("INSERT INTO monitors(name, url, client_id, project_id, interval_min) VALUES(?,?,?,?,?)").run(name, u, cid, pid, Math.min(60, Math.max(1, +d.interval_min || 5))).lastInsertRowid;
      await check(db.prepare("SELECT * FROM monitors WHERE id = ?").get(id));
      return json(res, 201, monOut(db.prepare("SELECT * FROM monitors WHERE id = ?").get(id)));
    }
    mm = p.match(/^\/betrieb\/monitors\/(\d+)(\/check)?$/);
    if (mm) { const mon = db.prepare("SELECT * FROM monitors WHERE id = ?").get(+mm[1]); if (!mon) return json(res, 404, { error: "Nicht gefunden" });
      if (mm[2] && m === "POST") { await check(mon); return json(res, 200, monOut(db.prepare("SELECT * FROM monitors WHERE id = ?").get(mon.id))); }
      if (m === "PATCH") { const d = await readJson(req); db.prepare("UPDATE monitors SET active = ? WHERE id = ?").run(d.active ? 1 : 0, mon.id); return json(res, 200, { ok: true }); }
      if (m === "DELETE") { db.prepare("DELETE FROM monitors WHERE id = ?").run(mon.id); return json(res, 200, { ok: true }); } }
    return json(res, 404, { error: "Nicht gefunden" });
  }
  return { api, runMonitors, dailyBackup, status };
}
