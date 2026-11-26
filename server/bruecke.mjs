// Brücke zum Rechner des Inhabers: Das Online-Board kann weder auf dessen Festplatte schreiben noch dort die Claude-App starten.
// Ein kleines Hilfsprogramm auf dem Rechner (Reeder Hardware GmbH/bruecke/bruecke.mjs) meldet sich mit einem eigenen Schlüssel
// alle paar Sekunden hier, holt Aufträge ab („Mit Claude besprechen“), legt den Projektordner lokal an und gleicht die
// Konzeptdatei in beide Richtungen ab. Der Schlüssel gibt nur Zugriff auf Hardware-Konzepte, nicht auf Kunden oder Finanzen.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, getSetting, setSetting } from "./db.mjs";
import { hwIntern } from "./hardware.mjs";
import { anfrageBeschreiben } from "./projektname.mjs";

const sha = t => createHash("sha256").update(String(t)).digest("hex");
const FRIST = 15000;          // so lange gilt die Brücke nach der letzten Meldung als verbunden
let gesehen = 0, nr = 0;
const auftraege = [];

export const brueckeEingerichtet = () => !!getSetting("bruecke", {}).keyHash;
export const brueckeVerbunden = () => Date.now() - gesehen < FRIST;
/** Auftrag für die Brücke vormerken: art = "app" | "terminal" | "ordner" */
export function brueckeAuftrag(projekt, art, auftrag = "") {
  auftraege.push({ id: ++nr, projekt, art, auftrag: String(auftrag || "").slice(0, 12000), at: Date.now() });
  return nr;
}

export function createBruecke({ json, send, readJson }) {
  const erlaubt = req => {
    const hash = getSetting("bruecke", {}).keyHash, m = String(req.headers.authorization || "").match(/^Bearer\s+([a-f0-9]{64})$/);
    if (!hash || !m) return false;
    const a = Buffer.from(sha(m[1]), "hex"), b = Buffer.from(hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const projekt = id => db.prepare("SELECT p.id, p.title, p.description, c.company FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ? AND p.bereich = 'hardware'").get(id);

  /** Board (nur Inhaber): Stand ansehen, neuen Schlüssel erzeugen */
  async function admin(req, res, p, m) {
    if (p === "/bruecke" && m === "GET") return json(res, 200, { eingerichtet: brueckeEingerichtet(), verbunden: brueckeVerbunden(), zuletzt: gesehen ? new Date(gesehen).toISOString() : null });
    if (p === "/bruecke/schluessel" && m === "POST") {
      const key = randomBytes(32).toString("hex");
      setSetting("bruecke", { keyHash: sha(key), erzeugt: new Date().toISOString() }); gesehen = 0;
      return json(res, 201, { schluessel: key });   // wird nur dieses eine Mal gezeigt; gespeichert ist nur der Prüfwert
    }
    return null;
  }

  /** Hilfsprogramm: /api/bruecke/… mit dem Schlüssel im Kopf „Authorization: Bearer …“ */
  async function publicRoute(req, res, url) {
    const p = url.pathname.replace(/^\/api\/bruecke/, ""), m = req.method;
    if (!erlaubt(req)) return json(res, 401, { error: "Der Schlüssel der Brücke stimmt nicht." });
    gesehen = Date.now();
    if (p === "/poll" && m === "GET") {
      const jetzt = Date.now(); for (let i = auftraege.length - 1; i >= 0; i--) if (jetzt - auftraege[i].at > 90000) auftraege.splice(i, 1);   // Verfallenes verwerfen
      const ids = String(url.searchParams.get("ids") || "").split(",").map(Number).filter(Boolean).slice(0, 60);
      return json(res, 200, { auftraege: auftraege.splice(0), projekte: ids.filter(id => projekt(id)).map(id => ({ id, stand: hwIntern.stand(id) })) });
    }
    let mm = p.match(/^\/projekt\/(\d+)$/);
    if (mm && m === "GET") {
      let x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Hardware-Projekt nicht gefunden" });
      // Der Ordner auf dem Rechner bekommt seinen Namen beim ersten Anlegen und behält ihn (sonst reißen Claude-Gespräche ab).
      // Deshalb vorher für einen ordentlichen Projektnamen sorgen: Hat die KI das Projekt noch nie benannt, tut sie es jetzt.
      const stand0 = db.prepare("SELECT name_ki, description FROM projects WHERE id = ?").get(x.id);
      if (!stand0.name_ki) {
        const k0 = hwIntern.konzeptLesen(x.id), text = [stand0.description, k0.steckbrief?.zweck].filter(Boolean).join("
");
        const r = await anfrageBeschreiben(x.id, text).catch(() => null);
        if (r) { hwIntern.konzeptSchreiben(x.id, { ...hwIntern.konzeptLesen(x.id), name: r.name, ...(r.zusammenfassung ? { kurzbeschreibung: r.zusammenfassung } : {}) }); x = projekt(x.id); }
      }
      if (!fs.existsSync(hwIntern.konzeptDatei(x.id))) hwIntern.konzeptSchreiben(x.id, { ...hwIntern.konzeptLesen(x.id), name: x.title, kurzbeschreibung: x.description || "" });
      return json(res, 200, { id: x.id, titel: x.title, ordner: hwIntern.ordnerName(x.title) || `Projekt ${x.id}`, konzept: hwIntern.konzeptLesen(x.id), anleitung: hwIntern.anleitung(x), dateien: hwIntern.dateiListe(x.id), stand: hwIntern.stand(x.id) });
    }
    mm = p.match(/^\/projekt\/(\d+)\/datei\/([^/]+)$/);
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Hardware-Projekt nicht gefunden" });
      const name = path.basename(decodeURIComponent(mm[2])), datei = path.join(hwIntern.dateiOrdner(x.id), name);
      if (!fs.existsSync(datei)) return json(res, 404, { error: "Datei nicht gefunden" });
      return send(res, 200, fs.readFileSync(datei), { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" });
    }
    // Änderungen vom Rechner: nur die geänderten Felder der obersten Ebene, damit gleichzeitige Änderungen im Board an anderen Feldern erhalten bleiben
    mm = p.match(/^\/projekt\/(\d+)\/konzept$/);
    if (mm && m === "POST") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Hardware-Projekt nicht gefunden" });
      const d = await readJson(req, 20 * 1024 * 1024), k = hwIntern.konzeptLesen(x.id);
      for (const [feld, wert] of Object.entries(d.setzen || {})) k[feld] = wert;
      for (const feld of Array.isArray(d.entfernen) ? d.entfernen : []) delete k[String(feld)];
      hwIntern.konzeptSchreiben(x.id, k);
      db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(x.id);
      return json(res, 200, { stand: hwIntern.stand(x.id), konzept: hwIntern.konzeptLesen(x.id) });
    }
    return json(res, 404, { error: "Unbekannt" });
  }
  return { admin, publicRoute };
}
