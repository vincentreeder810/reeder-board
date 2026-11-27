// Projektabschluss – Schritt 2: Übergabe-Dateien.
//   Je Projekt eine Liste „Was der Kunde am Ende bekommt“ (Formate je Bereich, zum Ankreuzen).
//   „Übergabe vorbereiten“ schickt Claude über die Brücke den Auftrag, die Dateien im Projektordner zu erzeugen (uebergabe/ + uebergabe.json).
//   Die Brücke lädt sie hoch; sie liegen als Dokumente „Übergabe“ beim Projekt – für den Kunden verborgen, bis die Übergabe gesendet wird (Schritt 3).
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "./db.mjs";
import { brueckeAuftrag, brueckePruefen, brueckeVerbunden, brueckeEingerichtet } from "./bruecke.mjs";
import { isOwner } from "./access.mjs";

const DOC_DIR = path.resolve(process.env.DATA_DIR || "data", "documents");
const MAX = 45 * 1024 * 1024;
const MIME = { ".zip": "application/zip", ".pdf": "application/pdf", ".step": "application/step", ".stp": "application/step", ".stl": "model/stl", ".3mf": "model/3mf", ".iges": "model/iges", ".igs": "model/iges",
  ".dxf": "image/vnd.dxf", ".dwg": "image/vnd.dwg", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv", ".md": "text/markdown", ".txt": "text/plain",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".exe": "application/octet-stream", ".msi": "application/octet-stream", ".dmg": "application/octet-stream", ".apk": "application/vnd.android.package-archive", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

/** Was der Kunde bekommen kann – je Bereich, mit Vorauswahl (an: true) */
export const KATALOG = {
  website: [
    { k: "code_zip", l: "Kompletter Code der Website (ZIP)", h: "zum Selbsthosten, alle Seiten, Bilder und Schriften", an: true },
    { k: "hosting_anleitung", l: "Anleitung „So bringen Sie die Seite online“ (PDF)", an: true },
    { k: "bilder", l: "Bilder in Originalgröße (ZIP)" },
    { k: "pruefbericht_pdf", l: "Letzter Prüfbericht (PDF)", an: true },
  ],
  software: [
    { k: "installer", l: "Installationspaket", h: "z. B. .exe/.msi, .dmg oder .apk – je nach Plattform", an: true },
    { k: "quellcode", l: "Quellcode (ZIP)", an: true },
    { k: "handbuch", l: "Bedienungsanleitung (PDF)", an: true },
    { k: "technik", l: "Technische Dokumentation (PDF)", h: "Aufbau, Betrieb, Updates" },
    { k: "pruefbericht_pdf", l: "Letzter Prüf- bzw. Testbericht (PDF)", an: true },
  ],
  hardware: [
    { k: "step", l: "3D-Modell STEP (.step)", h: "Standard für CAD-Programme", an: true },
    { k: "stl", l: "3D-Druck STL (.stl)", an: true },
    { k: "3mf", l: "3D-Druck 3MF (.3mf)" },
    { k: "iges", l: "3D-Modell IGES (.iges)", h: "für ältere CAD-Programme" },
    { k: "pdf_zeichnung", l: "Technische Zeichnung mit Maßen (PDF)", an: true },
    { k: "dxf", l: "2D-Zeichnung DXF (.dxf)", h: "z. B. für Laserschneiden" },
    { k: "dwg", l: "2D-Zeichnung DWG (.dwg)", h: "AutoCAD" },
    { k: "stueckliste", l: "Stückliste (Excel und CSV)", an: true },
    { k: "bauanleitung", l: "Montage- bzw. Bauanleitung (PDF)", an: true },
    { k: "fotos", l: "Fotos des Prototyps (ZIP)" },
    { k: "pruefprotokoll", l: "Prüfprotokoll des Prototyps (PDF)" },
  ],
};

db.exec(`CREATE TABLE IF NOT EXISTS uebergabe (project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  formate TEXT, angefordert_at TEXT, fertig_at TEXT, hinweis TEXT)`);
{ const dc = db.prepare("PRAGMA table_info(documents)").all().map(c => c.name);
  if (!dc.includes("verborgen")) db.exec("ALTER TABLE documents ADD COLUMN verborgen INTEGER NOT NULL DEFAULT 0");
  if (!dc.includes("format")) db.exec("ALTER TABLE documents ADD COLUMN format TEXT"); }

const bereichVon = pr => ["website", "hardware"].includes(pr.bereich) ? pr.bereich : (pr.kind && /website/i.test(pr.kind) ? "website" : pr.bereich === "hardware" ? "hardware" : "software");
function zeile(pid) { return db.prepare("SELECT * FROM uebergabe WHERE project_id = ?").get(pid) || null; }
function gewaehlt(pr) {
  const z = zeile(pr.id), kat = KATALOG[bereichVon(pr)];
  try { const l = JSON.parse(z?.formate || "null"); if (Array.isArray(l)) return l.filter(k => kat.some(x => x.k === k)); } catch {}
  return kat.filter(x => x.an).map(x => x.k);
}
const dateien = pid => db.prepare("SELECT id, title, file_name, bytes, format, verborgen, created_at FROM documents WHERE project_id = ? AND kind = 'Übergabe' ORDER BY id").all(pid)
  .map(d => ({ ...d, verborgen: !!d.verborgen, url: `/api/admin/documents/${d.id}/file` }));

/** Auftrag an Claude (wird in der Claude-App als erste Nachricht geöffnet) */
function auftragText(pr, formate) {
  const kat = KATALOG[bereichVon(pr)], liste = kat.filter(x => formate.includes(x.k));
  return `Bitte bereite die Übergabe an den Kunden für „${pr.title}“ vor. Gewünscht sind diese Dateien:
${liste.map(x => `- ${x.l} (Schlüssel: ${x.k})${x.h ? ` – ${x.h}` : ""}`).join("\n")}

So gehst du vor:
1. Lege alle Dateien in den Ordner \`uebergabe/\` im Projektordner (neu anlegen, falls er fehlt). Saubere, sprechende Dateinamen, keine Zugangsdaten, keine Entwicklungsreste (z. B. keine .git-Ordner, keine Testdaten).
2. Erzeuge jedes Format wirklich in diesem Format (3D-Formate z. B. mit FreeCAD oder einem passenden Werkzeug). Prüfe jede Datei: lässt sie sich öffnen, ist sie vollständig? Was du nicht erzeugen kannst, lässt du weg und sagst es mir.
3. Schreibe danach \`uebergabe.json\` in den Projektordner:
{ "dateien": [ { "datei": "uebergabe/name.zip", "format": "Schlüssel aus der Liste", "titel": "Kurzer Titel für den Kunden" } ], "hinweis": "Ein Satz für mich: was fehlt oder zu beachten ist" }
4. Die Brücke lädt die Dateien in wenigen Sekunden ins Board und schreibt das Ergebnis in \`uebergabe-ergebnis.json\`. Lies es und sag mir, was angekommen ist. Der Kunde sieht noch nichts – erst wenn ich die Übergabe im Board sende.
Einzelne Datei höchstens 45 MB; größere teilst du auf oder sagst es mir.`;
}

export function createUebergabe({ json, readJson, clean }) {
  async function admin(req, res, p, m, user) {
    const mm = p.match(/^\/projects\/(\d+)\/uebergabe(\/vorbereiten|\/datei\/(\d+))?$/); if (!mm) return null;
    const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
    const out = () => { const z = zeile(pr.id); return { bereich: bereichVon(pr), katalog: KATALOG[bereichVon(pr)], gewaehlt: gewaehlt(pr), dateien: dateien(pr.id), angefordert_at: z?.angefordert_at || null, fertig_at: z?.fertig_at || null, hinweis: z?.hinweis || "" }; };
    if (!mm[2] && m === "GET") return json(res, 200, out());
    if (!isOwner(user)) return json(res, 403, { error: "Das entscheidet der Inhaber." });
    if (!mm[2] && m === "POST") {
      const d = await readJson(req), kat = KATALOG[bereichVon(pr)];
      const l = (Array.isArray(d.formate) ? d.formate : []).map(String).filter(k => kat.some(x => x.k === k));
      db.prepare("INSERT INTO uebergabe(project_id, formate) VALUES(?, ?) ON CONFLICT(project_id) DO UPDATE SET formate = excluded.formate").run(pr.id, JSON.stringify(l));
      return json(res, 200, out());
    }
    if (mm[2] === "/vorbereiten" && m === "POST") {
      const l = gewaehlt(pr); if (!l.length) return json(res, 400, { error: "Bitte mindestens eine Datei auswählen." });
      if (!brueckeEingerichtet()) return json(res, 400, { error: "Dafür braucht es die Brücke auf deinem Rechner (Einstellungen → Livegang → „Brücke zu Claude“)." });
      if (!brueckeVerbunden()) return json(res, 400, { error: "Die Brücke auf deinem Rechner ist gerade nicht verbunden. Bitte „Bruecke im Hintergrund starten“ ausführen." });
      brueckeAuftrag(pr.id, bereichVon(pr) === "hardware" ? "app" : "sw-app", auftragText(pr, l));
      db.prepare("INSERT INTO uebergabe(project_id, formate, angefordert_at) VALUES(?, ?, datetime('now')) ON CONFLICT(project_id) DO UPDATE SET angefordert_at = datetime('now'), fertig_at = NULL").run(pr.id, JSON.stringify(l));
      return json(res, 200, out());
    }
    if (mm[3] && m === "DELETE") {
      const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND project_id = ? AND kind = 'Übergabe'").get(+mm[3], pr.id); if (!doc) return json(res, 404, { error: "Datei nicht gefunden" });
      await rm(path.join(DOC_DIR, doc.file_token), { force: true }); db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
      return json(res, 200, out());
    }
    return null;
  }
  /** Brücke: /api/bruecke/uebergabe/<Projekt>/(datei|fertig) */
  async function publicRoute(req, res, url) {
    if (!brueckePruefen(req)) return json(res, 401, { error: "Der Schlüssel der Brücke stimmt nicht." });
    const mm = url.pathname.match(/^\/api\/bruecke\/uebergabe\/(\d+)\/(datei|fertig)$/); if (!mm || req.method !== "POST") return json(res, 404, { error: "Unbekannt" });
    const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (mm[2] === "fertig") {
      const d = await readJson(req, 64 * 1024);
      db.prepare("INSERT INTO uebergabe(project_id, fertig_at, hinweis) VALUES(?, datetime('now'), ?) ON CONFLICT(project_id) DO UPDATE SET fertig_at = datetime('now'), hinweis = excluded.hinweis").run(pr.id, clean(d.hinweis, 600));
      return json(res, 200, { ok: true, dateien: dateien(pr.id).length });
    }
    const d = await readJson(req, Math.ceil(MAX * 1.4) + 1e5);
    const name = path.basename(clean(d.name, 160) || "datei"), ext = path.extname(name).toLowerCase();
    const buf = Buffer.from(String(d.data || ""), "base64");
    if (!buf.length) return json(res, 400, { error: "Leere Datei" });
    if (buf.length > MAX) return json(res, 400, { error: "Größer als 45 MB" });
    const format = clean(d.format, 40), titel = clean(d.titel, 160) || name;
    // Gleiche Datei erneut hochgeladen → alte ersetzen
    for (const alt of db.prepare("SELECT id, file_token FROM documents WHERE project_id = ? AND kind = 'Übergabe' AND file_name = ?").all(pr.id, name)) {
      await rm(path.join(DOC_DIR, alt.file_token), { force: true }); db.prepare("DELETE FROM documents WHERE id = ?").run(alt.id);
    }
    const token = randomBytes(24).toString("hex");
    await mkdir(DOC_DIR, { recursive: true }); await writeFile(path.join(DOC_DIR, token), buf);
    const r = db.prepare("INSERT INTO documents(client_id, project_id, kind, title, file_token, file_name, mime, bytes, verborgen, format) VALUES(?, ?, 'Übergabe', ?, ?, ?, ?, ?, 1, ?)")
      .run(pr.client_id, pr.id, titel, token, name, MIME[ext] || "application/octet-stream", buf.length, format || null);
    return json(res, 201, { ok: true, id: Number(r.lastInsertRowid) });
  }
  return { admin, publicRoute };
}
