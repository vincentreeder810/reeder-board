// Kurze Projektnamen per KI: Projekte aus dem Fragebogen heißen zunächst wie der Anfang der Idee
// („Ich möchte ein System entwickeln, mit dem ich …“). Ein kleines, günstiges Modell macht daraus
// zwei bis vier Wörter. Läuft im Hintergrund, höchstens einmal je Projekt; ohne API-Schlüssel passiert nichts.
import { db } from "./db.mjs";
import { callModel, assistantStatus } from "./assistant.mjs";

if (!db.prepare("PRAGMA table_info(projects)").all().some(c => c.name === "name_ki")) db.exec("ALTER TABLE projects ADD COLUMN name_ki INTEGER NOT NULL DEFAULT 0");

const MODELL = "claude-haiku-5-5";
/** Sieht der Titel nach einem Satzanfang statt nach einem Namen aus? */
export const brauchtNamen = t => { const s = String(t || "").trim(); return s.split(/\s+/).length > 5 || /^(ich|wir|mein|meine|unser|unsere|ein|eine|es)\s/i.test(s) || /^(hardware-anfrage|anfrage|neues projekt)$/i.test(s); };

let laeuft = false;
/** Bis zu drei offene Projekte benennen. Aufruf ohne await: Fehler bleiben folgenlos. */
export async function projektnamenPflegen() {
  if (laeuft || !assistantStatus().available) return;
  laeuft = true;
  try {
    const offen = db.prepare("SELECT id, title, description, bereich, kind FROM projects WHERE name_ki = 0 AND status IN ('anfrage','aktiv') ORDER BY id DESC LIMIT 20").all().filter(p => brauchtNamen(p.title)).slice(0, 3);
    for (const p of offen) {
      db.prepare("UPDATE projects SET name_ki = 1 WHERE id = ?").run(p.id);   // vorab merken: kein zweiter Versuch, keine Kostenschleife
      try {
        const r = await callModel("name", MODELL,
          "Du vergibst kurze deutsche Projektnamen für eine Firma, die Software und physische Produkte entwickelt. Regeln: zwei bis vier Wörter, Substantive, sagt, was entsteht (z. B. „Füllstandsmessung Bienenstock“, „Klima-Matratzenauflage“, „Terminbuchung Praxis“). Kein Satz, kein Verb am Anfang, kein Kundenname, keine Anführungszeichen, kein Punkt.",
          `Benenne dieses Vorhaben.\n<<DATEN>>\n${JSON.stringify({ bisheriger_titel: p.title, beschreibung: String(p.description || "").slice(0, 1500), bereich: p.bereich || "software", art: p.kind || "" })}`,
          { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" } } }, null, p.id);
        const name = String(r?.name || "").replace(/["„“”.]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (name.length >= 3 && name.split(" ").length <= 6) db.prepare("UPDATE projects SET title = ?, updated_at = datetime('now') WHERE id = ?").run(name, p.id);
      } catch (e) {
        if (e?.code === 503) db.prepare("UPDATE projects SET name_ki = 0 WHERE id = ?").run(p.id);   // Dienst nicht erreichbar: später erneut versuchen
        break;
      }
    }
  } finally { laeuft = false; }
}

/** Nach dem Fragebogen: kurzer Projektname und Zusammenfassung in zwei, drei Sätzen. Der Originaltext des Kunden bleibt darunter stehen.
 *  Aufruf ohne await; ohne API-Schlüssel oder bei einem Fehler bleibt alles, wie es war. Liefert { name, zusammenfassung } oder null. */
export async function anfrageBeschreiben(pid, roh) {
  const text = String(roh || "").trim();
  if (text.length < 40 || !assistantStatus().available) return null;
  try {
    const p = db.prepare("SELECT id, title, bereich, kind FROM projects WHERE id = ?").get(pid); if (!p) return null;
    const r = await callModel("name", MODELL,
      "Du bereitest Kundenanfragen für eine Firma auf, die Software und physische Produkte entwickelt. Der Text stammt vom Kunden, oft eingesprochen: Hörfehler und Füllwörter kommen vor. Liefere zwei Dinge. name: kurzer deutscher Projektname, zwei bis vier Wörter, Substantive, sagt, was entsteht (z. B. „Kameraüberwachung Pferdeboxen“, „Terminbuchung Praxis“); kein Satz, kein Kundenname, keine Anführungszeichen, kein Punkt; die Wörter „Hardware“, „Software“, „Website“, „Projekt“ und „Anfrage“ gehören nicht in den Namen; benenne das Ding selbst, nicht den Vorgang (also „Hüftprothese“ oder „Hüftprothese aus Titan“, nicht „Hüftprothesen-Fertigung“), außer der Kunde will ausdrücklich eine Maschine oder Anlage. zusammenfassung: zwei bis drei sachliche Sätze in der dritten Person – was der Kunde will, wofür, und die wichtigste Randbedingung. Nichts erfinden, nichts bewerten, keine Aufzählung.",
      `Fasse diese Anfrage zusammen.\n<<DATEN>>\n${JSON.stringify({ bereich: p.bereich || "software", art: p.kind || "", text: text.slice(0, 6000) })}`,
      { type: "object", additionalProperties: false, required: ["name", "zusammenfassung"], properties: { name: { type: "string" }, zusammenfassung: { type: "string" } } }, null, pid);
    const name = String(r?.name || "").replace(/["„“”.]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    const zus = String(r?.zusammenfassung || "").replace(/\s+/g, " ").trim().slice(0, 700);
    const nameOk = name.length >= 3 && name.split(" ").length <= 6;
    if (!zus && !nameOk) return null;
    db.prepare("UPDATE projects SET title = ?, description = ?, name_ki = 1, updated_at = datetime('now') WHERE id = ?")
      .run(nameOk ? name : p.title, (zus ? zus + "\n\nOriginal aus dem Fragebogen:\n" : "") + text.slice(0, 3200), pid);
    return { name: nameOk ? name : p.title, zusammenfassung: zus };
  } catch (e) { console.warn("Anfrage zusammenfassen:", e.message); return null; }
}
