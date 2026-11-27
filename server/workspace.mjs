// Arbeitsstand aus dem Claude-Arbeitsordner eines Software- oder Website-Projekts.
// Claude führt im Projektordner die Datei arbeitsstand.json: Wo steht das Projekt, was war in der letzten Sitzung,
// Notizen und offene Fragen an den Kunden. Die Brücke lädt sie hierher (bruecke-software.mjs), die Projektseite zeigt sie
// dem Team. Der Kunde sieht nichts davon – außer den Fragen, die der Inhaber ausdrücklich an ihn schickt.
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { vorlage } from "./mail-vorlagen.mjs";
import { firmaVonProjekt } from "./firmen.mjs";
import { isOwner, canProject } from "./access.mjs";
import crypto from "node:crypto";

db.exec(`CREATE TABLE IF NOT EXISTS project_workspace (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  daten TEXT NOT NULL, gesendet TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Aufgaben, die der abgeschaltete Assistent im Kundenportal angelegt hat („Großer Kundenwunsch – persönlich melden“), abschließen:
// Die Anmerkung selbst steht weiter in der Anmerkungsliste des Projekts.
try { db.prepare("UPDATE tasks SET status = 'erledigt', done_at = datetime('now'), done_by = 'System' WHERE source = 'assistent' AND status != 'erledigt'").run(); } catch {}

/** Phase nachziehen: Ein beauftragtes Projekt, für das schon eine Website-Version beim Kunden liegt, ist in der Umsetzung */
export function phaseNachziehen(pid) {
  try {
    const p = db.prepare("SELECT id, phase, status FROM projects WHERE id = ?").get(pid);
    if (!p || p.status !== "aktiv" || !["Erstgespräch", "Konzept", "Prototyp"].includes(p.phase)) return;
    const live = db.prepare("SELECT 1 FROM prototypes WHERE project_id = ? AND state IS NULL AND active = 1 LIMIT 1").get(pid);
    if (live) db.prepare("UPDATE projects SET phase = 'Umsetzung', updated_at = datetime('now') WHERE id = ?").run(pid);
  } catch {}
}
try { for (const r of db.prepare("SELECT id FROM projects WHERE status = 'aktiv'").all()) phaseNachziehen(r.id); } catch {}

const kurz = (t, n) => String(t ?? "").replace(/\r/g, "").trim().slice(0, n);
/** Eingabe aus arbeitsstand.json säubern: nur bekannte Felder, begrenzte Längen */
function sauber(d) {
  const liste = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
  return {
    stand: kurz(d?.stand, 4000),
    letzteSitzung: kurz(d?.letzteSitzung, 3000),
    notizen: liste(d?.notizen, 40).map(x => kurz(typeof x === "string" ? x : x?.text, 1000)).filter(Boolean),
    fragen: liste(d?.fragen, 40).map((f, i) => ({ id: kurz(f?.id, 40) || `f${i + 1}`, text: kurz(f?.text ?? f, 600), status: f?.status === "geklaert" ? "geklaert" : "offen", antwort: kurz(f?.antwort, 1000) })).filter(f => f.text),
  };
}
/* Fragen, die der Inhaber im Board selbst anlegt, beantwortet oder löscht. Sie liegen getrennt von Claudes Daten („team“)
   und werden beim Lesen darübergelegt. Die Brücke trägt sie in arbeitsstand.json ein; sobald Claudes Datei sie enthält,
   wird der Eintrag hier gestrichen. So überschreibt weder Claude das Board noch das Board Claude. */
if (!db.prepare("PRAGMA table_info(project_workspace)").all().some(c => c.name === "team")) db.exec("ALTER TABLE project_workspace ADD COLUMN team TEXT");
const teamVon = r => { let x = {}; try { x = JSON.parse(r?.team || "{}"); } catch {} return { neu: Array.isArray(x.neu) ? x.neu : [], antworten: x.antworten && typeof x.antworten === "object" ? x.antworten : {}, geloescht: Array.isArray(x.geloescht) ? x.geloescht : [] }; };
function mischen(fragen, tm) {
  const weg = new Set(tm.geloescht), out = fragen.filter(f => !weg.has(f.id)).map(f => ({ ...f }));
  for (const n of tm.neu) if (!weg.has(n.id) && !out.some(f => f.id === n.id)) out.push({ id: n.id, text: n.text, status: "offen", antwort: "", vonTeam: true });
  for (const f of out) { if (tm.antworten[f.id] !== undefined) { f.status = "geklaert"; f.antwort = tm.antworten[f.id]; } if (/^t[a-z0-9]+$/.test(f.id)) f.vonTeam = true; }
  return out;
}
const reihe = r => { const d = (() => { try { return sauber(JSON.parse(r?.daten || "{}")); } catch { return sauber({}); } })(); return { ...d, fragen: mischen(d.fragen, teamVon(r)) }; };
const stempelVon = fragen => crypto.createHash("sha1").update(JSON.stringify(fragen.map(f => [f.id, f.text, f.status, f.antwort]))).digest("hex").slice(0, 12);

export function workspaceSpeichern(pid, d) {
  const s = sauber(d), alt = db.prepare("SELECT team FROM project_workspace WHERE project_id = ?").get(pid), tm = teamVon(alt), ids = new Set(s.fragen.map(f => f.id));
  tm.neu = tm.neu.filter(n => !ids.has(n.id));
  tm.geloescht = tm.geloescht.filter(id => ids.has(id));
  for (const f of s.fragen) if (f.status === "geklaert" && tm.antworten[f.id] !== undefined) delete tm.antworten[f.id];
  db.prepare("INSERT INTO project_workspace(project_id, daten, team) VALUES(?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET daten = excluded.daten, team = excluded.team, updated_at = datetime('now')").run(pid, JSON.stringify(s), JSON.stringify(tm));
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(pid);
  const gemischt = reihe(db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid));
  return { ...s, gemischt, anders: stempelVon(gemischt.fragen) !== stempelVon(s.fragen), stempel: stempelVon(gemischt.fragen) };
}
/** Für die Brücke: Arbeitsstand mit den Änderungen des Teams und ein Stempel, der sich mit jeder Änderung an den Fragen ändert */
export function workspaceFuerBruecke(pid) {
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid); if (!r) return null;
  const d = reihe(r); return { daten: { ...d, fragen: d.fragen.map(({ vonTeam, ...f }) => f) }, stempel: stempelVon(d.fragen) };
}
export const workspaceStempel = pid => workspaceFuerBruecke(pid)?.stempel || "";
/* Rückfragen, die an den Kunden gegangen sind: Je Projekt und Frage ein Eintrag. Der Kunde beantwortet sie im Kundenportal,
   die Antwort wird wie „Antwort eintragen“ im Board gespeichert (tm.antworten) und landet so über die Brücke bei Claude. */
db.exec(`CREATE TABLE IF NOT EXISTS kunden_fragen (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, frage_id TEXT NOT NULL, text TEXT NOT NULL,
  antwort TEXT, gesendet_at TEXT NOT NULL, beantwortet_at TEXT, message_id INTEGER,
  UNIQUE(project_id, frage_id)
)`);
db.exec("CREATE INDEX IF NOT EXISTS kunden_fragen_client ON kunden_fragen(client_id)");
const ANTWORT_MAX = 1000;   // wie „Antwort eintragen“ im Board und arbeitsstand.json

export function workspaceLesen(pid) {
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid); if (!r) return null;
  let g = {}; try { g = JSON.parse(r.gesendet || "{}"); } catch {}
  const kb = Object.fromEntries(db.prepare("SELECT frage_id, beantwortet_at FROM kunden_fragen WHERE project_id = ? AND beantwortet_at IS NOT NULL").all(pid).map(x => [x.frage_id, x.beantwortet_at]));
  const d = reihe(r);
  return { ...d, fragen: d.fragen.map(f => ({ ...f, gesendet: g[f.id] || null, vomKunden: kb[f.id] || null })), aktualisiert: r.updated_at };
}
/** Fragen im Board selbst anlegen, beantworten oder löschen */
function teamAendern(pid, fn) {
  if (!db.prepare("SELECT 1 FROM project_workspace WHERE project_id = ?").get(pid)) db.prepare("INSERT INTO project_workspace(project_id, daten) VALUES(?, ?)").run(pid, JSON.stringify(sauber({})));
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid), tm = teamVon(r);
  const fehler = fn(tm, reihe(r).fragen); if (fehler) return fehler;
  db.prepare("UPDATE project_workspace SET team = ? WHERE project_id = ?").run(JSON.stringify(tm), pid);
  return null;
}
/** Antwort zu einer Frage eintragen – die Frage gilt dann als geklärt, die Brücke schreibt sie in arbeitsstand.json.
 *  Gibt eine Fehlermeldung zurück oder null. Wird vom Board („Antwort eintragen“) und vom Kundenportal benutzt. */
export function antwortEintragen(pid, fid, antwort) {
  return teamAendern(pid, (tm, fragen) => { if (!fragen.some(x => x.id === fid)) return "Frage nicht gefunden"; tm.antworten[fid] = antwort; });
}

export function createWorkspace({ json, readJson, clean, limited, SITE_URL }) {
  async function admin(req, res, p, m, user) {
    const mm = p.match(/^\/projects\/(\d+)\/workspace(\/fragen-senden|\/fragen(?:\/([\w-]{1,40}))?)?$/); if (!mm) return null;
    const pr = db.prepare("SELECT p.*, c.name client_name, c.email client_email, c.company FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").get(+mm[1]);
    if (!pr || !canProject(user, pr.id)) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (!mm[2] && m === "GET") phaseNachziehen(pr.id);
    // Eigene Fragen: anlegen (POST …/fragen), Antwort eintragen (PATCH …/fragen/<id>), löschen (DELETE …/fragen/<id>)
    if (mm[2] && mm[2].startsWith("/fragen") && mm[2] !== "/fragen-senden") {
      const fid = mm[3] || null;
      if (!fid && m === "POST") {
        const d = await readJson(req), text = clean(d.text, 600); if (!text) return json(res, 400, { error: "Bitte eine Frage eintragen." });
        const id = "t" + Date.now().toString(36);
        teamAendern(pr.id, tm => { tm.neu.push({ id, text }); });
        return json(res, 201, { ok: true, id });
      }
      if (fid && m === "PATCH") {
        const d = await readJson(req), antwort = clean(d.antwort, ANTWORT_MAX) || "geklärt";
        const f = antwortEintragen(pr.id, fid, antwort);
        return f ? json(res, 404, { error: f }) : json(res, 200, { ok: true });
      }
      if (fid && m === "DELETE") {
        const f = teamAendern(pr.id, (tm, fragen) => { if (!fragen.some(x => x.id === fid)) return "Frage nicht gefunden";
          const vorher = tm.neu.length; tm.neu = tm.neu.filter(n => n.id !== fid); delete tm.antworten[fid];
          if (tm.neu.length === vorher && !tm.geloescht.includes(fid)) tm.geloescht.push(fid); });
        return f ? json(res, 404, { error: f }) : json(res, 200, { ok: true });
      }
      return null;
    }
    if (!mm[2] && m === "GET") return json(res, 200,workspaceLesen(pr.id) || { leer: true });
    if (mm[2] === "/fragen-senden" && m === "POST") {
      // Offene Fragen an den Kunden schicken: als Nachricht im Kundenportal, zum Beantworten unter „Rückfragen“ im Portal
      // und – wenn der Inhaber das Häkchen lässt (Standard) – zusätzlich per E-Mail
      if (!isOwner(user)) return json(res, 403, { error: "Das entscheidet der Inhaber." });
      const w = workspaceLesen(pr.id), d = await readJson(req);
      const ids = Array.isArray(d.ids) ? d.ids.map(String) : null;
      const fragen = (w?.fragen || []).filter(f => f.status === "offen" && (!ids || ids.includes(f.id)));
      if (!fragen.length) return json(res, 400, { error: "Es gibt keine offenen Fragen zum Senden." });
      // Im Projekt-Chat erscheinen die Fragen als Karte (art = 'rueckfragen'); beantwortet wird jede Frage einzeln im Portal unter „Rückfragen“,
      // damit jede Antwort genau ihrer Frage zugeordnet ist. Der Text ist nur der Rückfall für Stellen, die keine Karten zeigen (Vorschau, Benachrichtigungen).
      const n = fragen.length;
      const text = `Rückfragen zu Ihrem Projekt „${pr.title}“: ${n === 1 ? "eine Frage" : `${n} Fragen`}. Bitte beantworten Sie ${n === 1 ? "sie" : "jede Frage"} im Kundenportal unter „Rückfragen“ – jede Frage hat ein eigenes Antwortfeld.`;
      const msgId = db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id, art) VALUES(?, 'team', ?, ?, ?, 'rueckfragen')").run(pr.client_id, user.name, text, pr.id).lastInsertRowid;
      const jetzt = new Date().toISOString();
      // Merken, welche Fragen an welchen Kunden gingen. Erneutes Senden aktualisiert den Eintrag (auch eine frühere Antwort wird zurückgesetzt,
      // denn gesendet werden nur offene Fragen).
      const merke = db.prepare(`INSERT INTO kunden_fragen(project_id, client_id, frage_id, text, gesendet_at, message_id) VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, frage_id) DO UPDATE SET client_id = excluded.client_id, text = excluded.text, gesendet_at = excluded.gesendet_at,
          message_id = excluded.message_id, antwort = NULL, beantwortet_at = NULL`);
      for (const f of fragen) merke.run(pr.id, pr.client_id, f.id, f.text, jetzt, msgId);
      // Karte im Chat: je Frage die Nummer aus kunden_fragen (dieselbe wie unter „Rückfragen“ im Portal), Stand und Antwort kommen beim Lesen live dazu
      const ids2 = db.prepare("SELECT id, frage_id FROM kunden_fragen WHERE project_id = ? AND message_id = ?").all(pr.id, msgId);
      const meta = { fragen: fragen.map(f => ({ id: ids2.find(x => x.frage_id === f.id)?.id ?? null, text: f.text })).filter(f => f.id) };
      db.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(JSON.stringify(meta), msgId);
      const mitMail = d.mail !== false;
      const mailed = mitMail && pr.client_email ? await sendMail({ to: pr.client_email, ...vorlage("rueckfragen", { name: pr.client_name, projekt: pr.title, anzahl: n,
        link: `${SITE_URL}/portal/#rueckfragen`, firma: firmaVonProjekt(pr.id) }) }) : false;
      const r = db.prepare("SELECT gesendet FROM project_workspace WHERE project_id = ?").get(pr.id);
      let g = {}; try { g = JSON.parse(r?.gesendet || "{}"); } catch {}
      for (const f of fragen) g[f.id] = jetzt;
      db.prepare("UPDATE project_workspace SET gesendet = ? WHERE project_id = ?").run(JSON.stringify(g), pr.id);
      return json(res, 200, { ok: true, anzahl: fragen.length, mailed: !!mailed });
    }
    return null;
  }

  /* ---------- Kundenportal: Rückfragen beantworten (nur eigene Fragen des eingeloggten Kunden) ---------- */
  // Offen ist eine Frage nur, solange sie im Arbeitsbereich noch offen ist – hat der Inhaber sie inzwischen selbst geklärt oder gelöscht, fällt sie weg.
  function offenImBoard(row, cache) {
    if (!cache.has(row.project_id)) cache.set(row.project_id, workspaceLesen(row.project_id));
    return !!cache.get(row.project_id)?.fragen.some(f => f.id === row.frage_id && f.status === "offen");
  }
  async function portal(req, res, url, p, c) {
    const m = req.method;
    if (p === "/rueckfragen" && m === "GET") {
      const rows = db.prepare("SELECT k.*, p.title projekt FROM kunden_fragen k JOIN projects p ON p.id = k.project_id WHERE k.client_id = ? ORDER BY k.gesendet_at, k.id").all(c.id);
      const cache = new Map();
      const offen = rows.filter(r => !r.beantwortet_at && offenImBoard(r, cache))
        .map(r => ({ id: r.id, project_id: r.project_id, projekt: r.projekt, text: r.text, gesendet_at: r.gesendet_at }));
      const grenze = new Date(Date.now() - 30 * 86400000).toISOString();
      const beantwortet = rows.filter(r => r.beantwortet_at && r.beantwortet_at >= grenze).sort((a, b) => b.beantwortet_at.localeCompare(a.beantwortet_at)).slice(0, 10)
        .map(r => ({ id: r.id, project_id: r.project_id, projekt: r.projekt, text: r.text, antwort: r.antwort, beantwortet_at: r.beantwortet_at }));
      return json(res, 200, { offen, beantwortet });
    }
    const mm = p.match(/^\/rueckfragen\/(\d+)$/); if (!mm) return null;
    if (m !== "POST") return json(res, 405, { error: "Nicht erlaubt" });
    if (limited?.("prf:" + c.id, 30, 10 * 60000)) return json(res, 429, { error: "Bitte einen Moment warten." });
    const r = db.prepare("SELECT k.*, p.title projekt FROM kunden_fragen k JOIN projects p ON p.id = k.project_id WHERE k.id = ? AND k.client_id = ?").get(+mm[1], c.id);
    if (!r) return json(res, 404, { error: "Diese Rückfrage gibt es nicht (mehr)." });
    if (r.beantwortet_at) return json(res, 409, { error: "Diese Frage haben Sie bereits beantwortet – vielen Dank." });
    if (!offenImBoard(r, new Map())) return json(res, 409, { error: "Diese Frage hat sich inzwischen erledigt – vielen Dank." });
    const roh = String((await readJson(req)).antwort ?? "").replace(/\r/g, "").trim();
    if (!roh) return json(res, 400, { error: "Bitte schreiben Sie eine Antwort." });
    if (roh.length > ANTWORT_MAX) return json(res, 400, { error: `Die Antwort ist zu lang (höchstens ${ANTWORT_MAX} Zeichen). Längeres schreiben Sie uns gern im Chat.` });
    const antwort = clean(roh, ANTWORT_MAX);
    // Im Arbeitsbereich als geklärt eintragen – derselbe Weg wie „Antwort eintragen“ im Board, die Brücke bringt es in Claudes Projektordner
    const fehler = antwortEintragen(r.project_id, r.frage_id, antwort);
    if (fehler) return json(res, 409, { error: "Diese Frage hat sich inzwischen erledigt – vielen Dank." });
    const jetzt = new Date().toISOString();
    db.prepare("UPDATE kunden_fragen SET antwort = ?, beantwortet_at = ? WHERE id = ?").run(antwort, jetzt, r.id);
    db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(r.project_id);
    // Im Chat festhalten, damit der Verlauf vollständig ist
    db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id, art, meta) VALUES(?, 'client', ?, ?, ?, 'antwort', ?)")
      .run(c.id, c.name, `Antwort auf: ${r.text} → ${antwort}`, r.project_id, JSON.stringify({ frage: r.text, antwort, rueckfrage_id: r.id }));
    sendMail({ to: getSetting("mail", DEFAULT_MAIL).notifyAddress, ...vorlage("rueckfrage_beantwortet_team", { name: c.name, unternehmen: c.company, projekt: r.projekt,
      frage: r.text, antwort, link: `${SITE_URL}/admin/#projekte/${r.project_id}` }) }).catch(e => console.warn("Mail:", e.message));
    return json(res, 200, { ok: true, id: r.id, antwort, beantwortet_at: jetzt });
  }
  return { admin, portal };
}
