// Arbeitsstand aus dem Claude-Arbeitsordner eines Software- oder Website-Projekts.
// Claude führt im Projektordner die Datei arbeitsstand.json: Wo steht das Projekt, was war in der letzten Sitzung,
// Notizen und offene Fragen an den Kunden. Die Brücke lädt sie hierher (bruecke-software.mjs), die Projektseite zeigt sie
// dem Team. Der Kunde sieht nichts davon – außer den Fragen, die der Inhaber ausdrücklich an ihn schickt.
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { sendMail } from "./mail.mjs";
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
export function workspaceLesen(pid) {
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid); if (!r) return null;
  let g = {}; try { g = JSON.parse(r.gesendet || "{}"); } catch {}
  const d = reihe(r);
  return { ...d, fragen: d.fragen.map(f => ({ ...f, gesendet: g[f.id] || null })), aktualisiert: r.updated_at };
}
/** Fragen im Board selbst anlegen, beantworten oder löschen */
function teamAendern(pid, fn) {
  if (!db.prepare("SELECT 1 FROM project_workspace WHERE project_id = ?").get(pid)) db.prepare("INSERT INTO project_workspace(project_id, daten) VALUES(?, ?)").run(pid, JSON.stringify(sauber({})));
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid), tm = teamVon(r);
  const fehler = fn(tm, reihe(r).fragen); if (fehler) return fehler;
  db.prepare("UPDATE project_workspace SET team = ? WHERE project_id = ?").run(JSON.stringify(tm), pid);
  return null;
}

export function createWorkspace({ json, readJson, clean, SITE_URL }) {
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
        const d = await readJson(req), antwort = clean(d.antwort, 1000) || "geklärt";
        const f = teamAendern(pr.id, (tm, fragen) => { if (!fragen.some(x => x.id === fid)) return "Frage nicht gefunden"; tm.antworten[fid] = antwort; });
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
      // Offene Fragen an den Kunden schicken: als Nachricht im Kundenportal und zusätzlich direkt per E-Mail
      if (!isOwner(user)) return json(res, 403, { error: "Das entscheidet der Inhaber." });
      const w = workspaceLesen(pr.id), d = await readJson(req);
      const ids = Array.isArray(d.ids) ? d.ids.map(String) : null;
      const fragen = (w?.fragen || []).filter(f => f.status === "offen" && (!ids || ids.includes(f.id)));
      if (!fragen.length) return json(res, 400, { error: "Es gibt keine offenen Fragen zum Senden." });
      const einleitung = clean(d.einleitung, 600) || `für Ihr Projekt „${pr.title}“ haben wir noch ${fragen.length === 1 ? "eine Frage" : "ein paar Fragen"}:`;
      const liste = fragen.map((f, i) => `${fragen.length > 1 ? `${i + 1}. ` : ""}${f.text}`).join("\n");
      const text = `Hallo ${pr.client_name},\n\n${einleitung}\n\n${liste}\n\nAntworten Sie gern direkt hier.`;
      db.prepare("INSERT INTO messages(client_id, sender, author, body) VALUES(?, 'team', ?, ?)").run(pr.client_id, user.name, text);
      const cfg = getSetting("mail", DEFAULT_MAIL);
      const mailed = pr.client_email ? await sendMail({ to: pr.client_email, subject: `Rückfragen zu Ihrem Projekt „${pr.title}“`,
        text: `Hallo ${pr.client_name},\n\n${einleitung}\n\n${liste}\n\nSie können einfach auf diese E-Mail antworten oder im Kundenportal schreiben:\n${SITE_URL}/portal/#chat\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` }) : false;
      const r = db.prepare("SELECT gesendet FROM project_workspace WHERE project_id = ?").get(pr.id);
      let g = {}; try { g = JSON.parse(r?.gesendet || "{}"); } catch {}
      const jetzt = new Date().toISOString(); for (const f of fragen) g[f.id] = jetzt;
      db.prepare("UPDATE project_workspace SET gesendet = ? WHERE project_id = ?").run(JSON.stringify(g), pr.id);
      return json(res, 200, { ok: true, anzahl: fragen.length, mailed: !!mailed });
    }
    return null;
  }
  return { admin };
}
