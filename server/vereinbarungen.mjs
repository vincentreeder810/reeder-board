// Besondere Vereinbarungen mit Kunden, die über Preis und Leistung eines Angebots hinausgehen –
// zum Beispiel „5 % Umsatzbeteiligung ab Launch, dafür günstigerer Festpreis“.
// Sie stehen im Angebot (Feld vereinbarung), werden mit der Annahme zur gültigen Vereinbarung am Projekt
// und sind danach im Projekt, in „Mein Arbeitsplatz“ und unter „Verträge & Produkte“ zu sehen.
import { db } from "./db.mjs";

db.exec(`CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, invoice_id INTEGER,
  titel TEXT NOT NULL, text TEXT, prozent REAL, status TEXT NOT NULL DEFAULT 'aktiv',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
if (!db.prepare("PRAGMA table_info(invoices)").all().some(c => c.name === "vereinbarung")) db.exec("ALTER TABLE invoices ADD COLUMN vereinbarung TEXT");
// Erinnerung: alle wie viele Monate die Zahlen beim Kunden abgefragt werden (0 = gar nicht) und wann das nächste Mal
{ const sp = db.prepare("PRAGMA table_info(agreements)").all().map(c => c.name);
  if (!sp.includes("rhythmus")) db.exec("ALTER TABLE agreements ADD COLUMN rhythmus INTEGER NOT NULL DEFAULT 0");
  if (!sp.includes("faellig")) db.exec("ALTER TABLE agreements ADD COLUMN faellig TEXT"); }
// Gemeldete Zahlen: Zeitraum, Umsatz des Kunden und der Anteil, der daraus entsteht (Beträge in Cent)
db.exec(`CREATE TABLE IF NOT EXISTS agreement_reports (
  id INTEGER PRIMARY KEY, agreement_id INTEGER NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  zeitraum TEXT NOT NULL, umsatz INTEGER NOT NULL, anteil INTEGER NOT NULL, notiz TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
const heute = () => new Date().toISOString().slice(0, 10);
const inMonaten = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
/** Eine Beteiligung in Prozent wird von selbst jedes Quartal abgefragt – der Rhythmus lässt sich danach ändern */
const erinnern = id => db.prepare("UPDATE agreements SET rhythmus = 3, faellig = ? WHERE id = ? AND prozent > 0").run(inMonaten(3), id);

/** Vereinbarung aus einem Angebot lesen: { titel, text, prozent } oder null */
export function vereinbarungLesen(wert) {
  if (!wert) return null;
  try { const v = typeof wert === "string" ? JSON.parse(wert) : wert; return v && (v.titel || v.text) ? { titel: String(v.titel || "Besondere Vereinbarung"), text: String(v.text || ""), prozent: Number(v.prozent) > 0 ? Number(v.prozent) : null } : null; }
  catch { return null; }
}
/** Eingabe aus dem Angebots-Editor säubern → JSON-Text für die Spalte oder null */
export function vereinbarungSpeichern(d, clean) {
  if (!d || !(String(d.titel || "").trim() || String(d.text || "").trim())) return null;
  const p = Number(String(d.prozent ?? "").replace(",", "."));
  return JSON.stringify({ titel: clean(d.titel, 120) || "Besondere Vereinbarung", text: clean(d.text, 8000), prozent: p > 0 && p <= 100 ? p : null });
}
/** Mit der Annahme des Angebots wird die Vereinbarung gültig und hängt am Projekt */
export function vereinbarungAusAngebot(invoiceId, projectId, wer) {
  const inv = db.prepare("SELECT id, client_id, vereinbarung FROM invoices WHERE id = ?").get(invoiceId), v = vereinbarungLesen(inv?.vereinbarung);
  if (!v || db.prepare("SELECT 1 FROM agreements WHERE invoice_id = ?").get(invoiceId)) return;
  erinnern(db.prepare("INSERT INTO agreements(client_id, project_id, invoice_id, titel, text, prozent, created_by) VALUES(?,?,?,?,?,?,?)").run(inv.client_id, projectId || null, inv.id, v.titel, v.text, v.prozent, wer || "Angebot").lastInsertRowid);
}
/** Kurzform für Karten und Listen */
export const vereinbarungenVonProjekt = pid => db.prepare("SELECT id, titel, text, prozent, status FROM agreements WHERE project_id = ? AND status = 'aktiv' ORDER BY id").all(pid);

export function createVereinbarungen({ json, readJson, clean }) {
  const zeile = `SELECT a.*, c.company, p.title project_title, p.bereich, i.number angebot FROM agreements a JOIN clients c ON c.id = a.client_id LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN invoices i ON i.id = a.invoice_id`;
  const aus = a => ({ ...a, faellig_jetzt: a.status === "aktiv" && a.rhythmus > 0 && !!a.faellig && a.faellig <= heute(),
    meldungen: db.prepare("SELECT id, zeitraum, umsatz, anteil, notiz, created_at FROM agreement_reports WHERE agreement_id = ? ORDER BY id DESC LIMIT 6").all(a.id) });
  async function admin(req, res, p, m, user) {
    if (p === "/vereinbarungen" && m === "GET") return json(res, 200, db.prepare(`${zeile} ORDER BY a.status != 'aktiv', a.id DESC`).all().map(aus));
    let mm = p.match(/^\/projects\/(\d+)\/vereinbarungen$/);
    if (mm) {
      const pr = db.prepare("SELECT id, client_id FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
      if (m === "GET") return json(res, 200, db.prepare(`${zeile} WHERE a.project_id = ? ORDER BY a.status != 'aktiv', a.id DESC`).all(pr.id).map(aus));
      if (m === "POST") {
        const d = await readJson(req), titel = clean(d.titel, 120);
        if (!titel) return json(res, 400, { error: "Bitte kurz benennen, worum es geht – zum Beispiel „Umsatzbeteiligung“." });
        const pz = Number(String(d.prozent ?? "").replace(",", "."));
        const id = db.prepare("INSERT INTO agreements(client_id, project_id, titel, text, prozent, created_by) VALUES(?,?,?,?,?,?)").run(pr.client_id, pr.id, titel, clean(d.text, 1500), pz > 0 && pz <= 100 ? pz : null, user.name).lastInsertRowid;
        erinnern(id);
        return json(res, 201, { id });
      }
    }
    // Zahlen eintragen: Umsatz des Kunden für einen Zeitraum → Anteil ausrechnen, nächste Abfrage vormerken
    mm = p.match(/^\/vereinbarungen\/(\d+)\/meldung$/);
    if (mm && m === "POST") {
      const a = db.prepare("SELECT * FROM agreements WHERE id = ?").get(+mm[1]); if (!a) return json(res, 404, { error: "Vereinbarung nicht gefunden" });
      const d = await readJson(req), zeitraum = clean(d.zeitraum, 60);
      let roh = String(d.umsatz ?? "").replace(/[^0-9.,-]/g, ""); if (roh.includes(",")) roh = roh.replace(/\./g, "").replace(",", ".");
      const umsatz = Math.round(Number(roh) * 100);
      if (!zeitraum) return json(res, 400, { error: "Bitte den Zeitraum angeben, zum Beispiel „3. Quartal 2026“." });
      if (!roh || !Number.isFinite(umsatz) || umsatz < 0) return json(res, 400, { error: "Bitte den Umsatz als Zahl angeben, zum Beispiel 12500." });
      const anteil = a.prozent ? Math.round(umsatz * a.prozent / 100) : 0;
      db.prepare("INSERT INTO agreement_reports(agreement_id, zeitraum, umsatz, anteil, notiz, created_by) VALUES(?,?,?,?,?,?)").run(a.id, zeitraum, umsatz, anteil, clean(d.notiz, 500), user.name);
      if (a.rhythmus > 0) db.prepare("UPDATE agreements SET faellig = ? WHERE id = ?").run(inMonaten(a.rhythmus), a.id);
      return json(res, 201, { anteil, umsatz });
    }
    mm = p.match(/^\/vereinbarungen\/(\d+)$/);
    if (mm) {
      const a = db.prepare("SELECT * FROM agreements WHERE id = ?").get(+mm[1]); if (!a) return json(res, 404, { error: "Vereinbarung nicht gefunden" });
      if (m === "PATCH") { const d = await readJson(req);
        const rh = d.rhythmus !== undefined && [0, 1, 3, 6, 12].includes(+d.rhythmus) ? +d.rhythmus : a.rhythmus;
        let fa = /^\d{4}-\d{2}-\d{2}$/.test(d.faellig || "") ? d.faellig : a.faellig; if (rh > 0 && (!fa || rh !== a.rhythmus && d.faellig === undefined)) fa = inMonaten(rh);
        db.prepare("UPDATE agreements SET titel = ?, text = ?, status = ?, rhythmus = ?, faellig = ? WHERE id = ?").run(clean(d.titel ?? a.titel, 120) || a.titel, d.text !== undefined ? clean(d.text, 1500) : a.text, ["aktiv", "beendet"].includes(d.status) ? d.status : a.status, rh, rh > 0 ? fa : null, a.id);
        return json(res, 200, { ok: true }); }
      if (m === "DELETE") { if (a.invoice_id) return json(res, 409, { error: "Diese Vereinbarung stammt aus einem angenommenen Angebot und lässt sich nur beenden, nicht löschen." });
        db.prepare("DELETE FROM agreements WHERE id = ?").run(a.id); return json(res, 200, { ok: true }); }
    }
    return null;
  }
  return { admin };
}
