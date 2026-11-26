// Arbeitsstand aus dem Claude-Arbeitsordner eines Software- oder Website-Projekts.
// Claude führt im Projektordner die Datei arbeitsstand.json: Wo steht das Projekt, was war in der letzten Sitzung,
// Notizen und offene Fragen an den Kunden. Die Brücke lädt sie hierher (bruecke-software.mjs), die Projektseite zeigt sie
// dem Team. Der Kunde sieht nichts davon – außer den Fragen, die der Inhaber ausdrücklich an ihn schickt.
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { isOwner, canProject } from "./access.mjs";

db.exec(`CREATE TABLE IF NOT EXISTS project_workspace (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  daten TEXT NOT NULL, gesendet TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

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
export function workspaceSpeichern(pid, d) {
  const s = sauber(d);
  db.prepare("INSERT INTO project_workspace(project_id, daten) VALUES(?, ?) ON CONFLICT(project_id) DO UPDATE SET daten = excluded.daten, updated_at = datetime('now')").run(pid, JSON.stringify(s));
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(pid);
  return s;
}
export function workspaceLesen(pid) {
  const r = db.prepare("SELECT * FROM project_workspace WHERE project_id = ?").get(pid); if (!r) return null;
  let d = {}, g = {}; try { d = JSON.parse(r.daten); g = JSON.parse(r.gesendet || "{}"); } catch {}
  return { ...sauber(d), fragen: sauber(d).fragen.map(f => ({ ...f, gesendet: g[f.id] || null })), aktualisiert: r.updated_at };
}

export function createWorkspace({ json, readJson, clean, SITE_URL }) {
  async function admin(req, res, p, m, user) {
    const mm = p.match(/^\/projects\/(\d+)\/workspace(\/fragen-senden)?$/); if (!mm) return null;
    const pr = db.prepare("SELECT p.*, c.name client_name, c.email client_email, c.company FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").get(+mm[1]);
    if (!pr || !canProject(user, pr.id)) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (!mm[2] && m === "GET") return json(res, 200, workspaceLesen(pr.id) || { leer: true });
    if (mm[2] && m === "POST") {
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
