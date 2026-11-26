// Reeder Hardware – Konzepte für physische Produkte im Admin-Board.
// Ein Hardware-Projekt ist ein normales Projekt (Tabelle projects, bereich = 'hardware') mit einem
// zusätzlichen Konzept: Anforderungen, Varianten, Module, 3D-Modell, Stückliste, Bauanleitung, Prüfung.
//   <Projekte>/<Projektname>/projekt.json   – das Konzept (Format: siehe Reeder Hardware GmbH/konzept-studio/src/types.ts)
//   <Projekte>/<Projektname>/dateien/       – Skizzen, Datenblätter usw. zum Projekt
// <Projekte> ist der Ordner "Reeder Hardware GmbH/Projekte" neben dem Website-Ordner (siehe PROJEKTE unten).
// Das Konzept liegt bewusst als Datei vor: Claude Code arbeitet es direkt in der Datei aus,
// die Oberfläche fragt den Änderungsstand ab und lädt neu.
import path from "node:path";
import fs from "node:fs";
import { db, getSetting, DEFAULT_COMPANY } from "./db.mjs";
import { randomBytes } from "node:crypto";
import { sendMail } from "./mail.mjs";
import { renderKonzeptPdf } from "./konzept-pdf.mjs";
import { isOwner, memberProjectIds, canProject, clientIdsFor } from "./access.mjs";
import { spawn } from "node:child_process";
import { brueckeAuftrag, brueckeVerbunden, brueckeEingerichtet } from "./bruecke.mjs";

// Wo die Projektordner liegen:
//   1. HARDWARE_PROJEKTE_DIR, wenn gesetzt.
//   2. Auf dem eigenen Rechner (DATA_DIR nicht gesetzt): "../Reeder Hardware GmbH/Projekte" neben dem Website-Ordner,
//      damit jedes Projekt als normaler Ordner im Explorer zu finden ist.
//   3. Sonst (Demo-Board, Testinstanz, Server im Internet): DATA_DIR/hardware – dort gibt es den Firmenordner nicht.
const ALT = path.join(path.resolve(process.env.DATA_DIR || "data"), "hardware");   // früherer Ablageort: <ID> als Ordnername
const FIRMA = path.resolve("..", "Reeder Hardware GmbH");
const PROJEKTE = process.env.HARDWARE_PROJEKTE_DIR ? path.resolve(process.env.HARDWARE_PROJEKTE_DIR)
  : !process.env.DATA_DIR && fs.existsSync(FIRMA) ? path.join(FIRMA, "Projekte") : ALT;
const DIR = PROJEKTE;
const MAX_FILE = 30 * 1024 * 1024;

// Jedes Projekt gehört zu einem Bereich. Bestehende Projekte sind Software.
if (!db.prepare("PRAGMA table_info(projects)").all().some(c => c.name === "bereich"))
  db.exec("ALTER TABLE projects ADD COLUMN bereich TEXT NOT NULL DEFAULT 'software'");
// Name des Projektordners. Bleibt stehen, auch wenn das Projekt später umbenannt wird.
if (!db.prepare("PRAGMA table_info(projects)").all().some(c => c.name === "hw_ordner"))
  db.exec("ALTER TABLE projects ADD COLUMN hw_ordner TEXT");

const PHASEN = [
  { id: "anforderungen", name: "Anforderungen klären" },
  { id: "analyse", name: "Analyse & Varianten" },
  { id: "module", name: "Modulkonzept" },
  { id: "detail", name: "Ausarbeitung & 3D" },
  { id: "beschaffung", name: "Stückliste & Bauanleitung" },
  { id: "pruefung", name: "Konzept & Prüfplan" },
];
const leeresKonzept = () => ({
  kurzbeschreibung: "",
  phasen: PHASEN.map((p, i) => ({ ...p, status: i === 0 ? "aktiv" : "offen" })),
  anforderungen: [], entscheidungen: [], module: [],
  konzept: { funktionsprinzip: "", eckdaten: [], risiken: [], offeneFragen: [] },
  ebenen: [], bauteile: [], stueckliste: [], anleitung: [], pruefung: [],
});

const INLINE = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain; charset=utf-8" };
const safeName = raw => (path.basename(String(raw || "")).replace(/[^\w .()\-äöüÄÖÜß]/g, "_").replace(/^\.+/, "").slice(0, 120)) || "datei";

const ordnerName = t => String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim().slice(0, 70);
/** Ordner eines Projekts. Beim ersten Zugriff wird der Name festgelegt; ein Ordner am früheren Ablageort zieht um. */
function ordner(id) {
  const x = db.prepare("SELECT id, title, hw_ordner FROM projects WHERE id = ?").get(id);
  if (!x) return path.join(ALT, String(id));
  if (x.hw_ordner) return path.join(PROJEKTE, x.hw_ordner);
  let name = ordnerName(x.title) || `Projekt ${id}`;
  const frei = n => !fs.existsSync(path.join(PROJEKTE, n)) && !db.prepare("SELECT 1 FROM projects WHERE hw_ordner = ?").get(n);
  if (!frei(name)) name = `${name} (${id})`;
  fs.mkdirSync(PROJEKTE, { recursive: true });
  const alt = path.join(ALT, String(id)), neu = path.join(PROJEKTE, name);
  if (fs.existsSync(alt) && alt !== neu) {
    try { fs.renameSync(alt, neu); }
    catch { fs.cpSync(alt, neu, { recursive: true }); fs.rmSync(alt, { recursive: true, force: true }); }   // z. B. anderes Laufwerk
  }
  db.prepare("UPDATE projects SET hw_ordner = ? WHERE id = ?").run(name, id);
  return neu;
}
const konzeptDatei = id => path.join(ordner(id), "projekt.json");
const dateiOrdner = id => path.join(ordner(id), "dateien");

function konzeptLesen(id) {
  try { return JSON.parse(fs.readFileSync(konzeptDatei(id), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return leeresKonzept(); throw Object.assign(new Error("Die Konzeptdatei ist gerade nicht lesbar."), { code: 409 }); }
}
function konzeptSchreiben(id, k) {
  fs.mkdirSync(ordner(id), { recursive: true });
  // Erst in eine Nebendatei schreiben, dann umbenennen: so sieht niemand eine halbe Datei.
  const tmp = konzeptDatei(id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(k, null, 2) + "\n");
  fs.renameSync(tmp, konzeptDatei(id));
}
const stand = id => { try { return Math.round(fs.statSync(konzeptDatei(id)).mtimeMs); } catch { return 0; } };
function dateiListe(id) {
  try {
    return fs.readdirSync(dateiOrdner(id)).map(name => { const s = fs.statSync(path.join(dateiOrdner(id), name)); return s.isFile() ? { name, groesse: s.size, geaendert: s.mtime.toISOString() } : null; }).filter(Boolean);
  } catch { return []; }
}

/* ---------- Arbeitsordner: hier arbeitet Claude Code am Projekt ---------- */
// Der Ordner des Projekts (Reeder Hardware GmbH/Projekte/<Projektname>) ist zugleich der Arbeitsordner. Das Board öffnet Claude Code
// per Link (Claude-App: claude://code/new?folder=…, Terminal: claude-cli://open?cwd=…) direkt darin; alles, was Claude braucht, liegt in diesem Ordner.
const MARKE = "<!-- Vom Reeder Board erzeugt. Wird bei jedem Öffnen neu geschrieben; eigene Hinweise bitte in notizen/ ablegen. -->";
const anleitung = (x) => `${MARKE}
# ${x.title}

Hardware-Projekt im Reeder Board (Projekt ${x.id}, Kunde: ${x.company || "–"}). Dieser Ordner ist der Arbeitsordner des Projekts.

## Was hier liegt

- \`projekt.json\` – das Konzept. Das Board zeigt diese Datei an und lädt Änderungen nach wenigen Sekunden von selbst nach.
- \`dateien/\` – Unterlagen des Kunden (Skizzen, Fotos, Datenblätter). Lesen erlaubt.
- \`notizen/\` – Gesprächsnotizen des Inhabers. Lesen erlaubt, nicht verändern.
- \`ergebnisse/\` – hier Berechnungen, Recherchen und Hilfsskripte ablegen.

## Wer ist wer

- Du sprichst mit dem Inhaber von Reeder Hardware. Er entwickelt das Produkt im Auftrag des Kunden. Sprich ihn mit „du“ an.
- Der Steckbrief in \`projekt.json\` und die Unterlagen in \`dateien/\` stammen vom Kunden (${x.company || "–"}), meist aus einem kurzen Online-Fragebogen. Der Kunde liest hier nicht mit. Schreibe also nicht „Ihr Steckbrief“, sondern „die Angaben des Kunden“.
- Was nur der Kunde beantworten kann, kläre zuerst mit dem Inhaber (vielleicht weiß er es aus dem Gespräch) und sammle den Rest unter \`konzept.offeneFragen\` als Fragen an den Kunden für das nächste Gespräch.
- Bei eigenen Produktideen (Kunde „Reeder intern“) ist der Inhaber selbst der Auftraggeber.

## Gespräch zuerst

Der Inhaber entwickelt seine Ideen am liebsten im Gespräch und spricht seine Nachrichten oft ein (Diktat – Hörfehler mitdenken, bei Unklarheit nachfragen).

- Nicht still alles ausarbeiten. Erst kurz sagen, wie du die Aufgabe verstehst, eigene Ideen und Einwände einbringen und Rückfragen einzeln stellen, nicht als Liste.
- \`projekt.json\` erst ändern, wenn ihr euch einig seid oder er „übernimm das“ sagt. Ausnahme: Der Auftrag sagt ausdrücklich „direkt ausarbeiten“.
- Nach jeder Änderung in zwei, drei Sätzen sagen, was jetzt im Board anders ist und wo er es sieht. Wichtige Zwischenstände eines längeren Gesprächs in \`ergebnisse/gespraech-<Datum>.md\` festhalten.
- Wünsche zu einzelnen Baugruppen („mach das Gehäuse kompakter“) ernst nehmen und nachrechnen, statt den bisherigen Stand zu verteidigen. Sagen, was dadurch an anderen Modulen mitgeändert werden muss.

## Projektname

Heißt das Projekt noch wie der Anfang der Idee (ein halber Satz) oder „Neues Projekt“, dann trage gleich zu Beginn einen kurzen Produktnamen (zwei bis vier Wörter) als \`"namensvorschlag": "…"\` auf oberster Ebene in \`projekt.json\` ein und nenne ihn dem Nutzer. Das Board übernimmt ihn sofort als Projektnamen und entfernt das Feld wieder; der Nutzer kann ihn im Board ändern. Der Ordner behält seinen Namen.

## Arbeitsweise

- Oberfläche und Inhalte sind deutsch. Der Nutzer ist kein Techniker: Entscheidungen verständlich begründen.
- Das Board schreibt selbst in \`projekt.json\` (Status, Entscheidungen, Prüfliste). Deshalb die Datei gezielt bearbeiten und nie aus einem alten Stand neu schreiben. Gültiges JSON hinterlassen.
- Schritt für Schritt arbeiten, nicht alles auf einmal: 1 Anforderungen (\`steckbrief\` → \`anforderungen\`), 2 Varianten (\`entscheidungen\`), 3 Module (\`module\`), 4 3D-Modell (\`ebenen\`, \`bauteile\`), 5 Einkauf & Bau (\`stueckliste\`, \`anleitung\`), 6 Prüfung (\`pruefung\`).
- Erst analysieren, dann bauen: vergleichbare Produkte recherchieren, Physik nachrechnen, Schätzungen als solche kennzeichnen. Entscheidungen zwischen Varianten trifft der Nutzer im Board; nur \`optionen\` und eine Empfehlung liefern.
- Offene Punkte ehrlich in \`module[].offenePunkte\` und \`konzept.risiken\` festhalten.

## Format von projekt.json (Kurzfassung)

- \`steckbrief\`: Antworten des Kunden – \`zweck\`, \`nutzer\`, \`groesse\`, \`budget\`, \`stueckzahl\`, \`wichtig\`.
- \`phasen\`: \`[{id, name, status: "offen"|"aktiv"|"fertig"}]\`.
- \`anforderungen\`: \`[{id, text, prio: "muss"|"soll"|"kann", zielwert, status: "offen"|"erfuellt"|"kritisch", notiz}]\`.
- \`entscheidungen\`: \`[{id, frage, kontext, status: "offen"|"entschieden", gewaehlt, begruendung, optionen: [{id, name, beschreibung, vorteile[], nachteile[], kosten, bewertung 1–5}]}]\`.
- \`module\`: \`[{id, name, funktion, status: "geplant"|"in Arbeit"|"ausgearbeitet"|"geprüft", farbe, huelle: {position, masse: {breite, hoehe, tiefe}}, schnittstellen[], offenePunkte[]}]\`.
- \`konzept\`: \`{funktionsprinzip, eckdaten: [{label, wert}], risiken[], offeneFragen[]}\`.
- \`ebenen\`: \`[{id, name, farbe, explosion: [x, y, z]}]\` – zum Ein- und Ausblenden im 3D-Modell.
- \`bauteile\`: \`[{id, name, ebene, modul, form, masse, position, rotation, farbe, deckkraft, material, beschreibung}]\`. Maße in Millimetern, x = Breite, y = Höhe (Boden bei 0), z = Tiefe.
  - \`quader\`: masse.breite/hoehe/tiefe, position = Mittelpunkt. \`zylinder\`: masse.durchmesser/hoehe, steht senkrecht, mit rotation (Grad) kippen. \`kugel\`: masse.durchmesser.
  - \`rohr\`: masse.durchmesser, masse.biegeradius, \`pfad\` als Punktliste in absoluten Koordinaten. Beide Enden müssen an einem Bauteil oder Rohrende anschließen (Toleranz 12 mm); kein Rohr durch massive Bauteile.
  - \`deckkraft\` unter 1 = durchsichtig (Gehäuse ca. 0,15). \`bestand: true\` für Teile, die der Kunde schon hat.
  - Bauteile eines Moduls müssen in dessen \`huelle\` liegen. Lange Rohrverläufe mit einem Skript in \`ergebnisse/\` erzeugen.
- \`stueckliste\`: \`[{id, modul, bezeichnung, menge, einheit, einzelpreis (Euro netto, Schätzung), bezugsquelle, notiz, bauteile[]}]\`.
- \`anleitung\`: \`[{modul, titel, text, bauteile[], werkzeug[], dauerMin}]\`.
- \`pruefung\`: \`[{id, text, status: "offen"|"ok"|"problem", notiz}]\` – was nur am echten Aufbau messbar ist.

Das Board prüft das Modell automatisch (Seite „Prüfung“): offene Rohrenden, Rohre durch Bauteile, zu enge Bögen, Bauteile außerhalb des Modul-Bauraums, tote Verweise. Nach Änderungen am Modell den Nutzer bitten, dort nachzusehen.
`;
function arbeitsordnerAnlegen(x) {
  for (const d of ["dateien", "notizen", "ergebnisse"]) fs.mkdirSync(path.join(ordner(x.id), d), { recursive: true });
  if (!fs.existsSync(konzeptDatei(x.id))) konzeptSchreiben(x.id, { ...leeresKonzept(), name: x.title, kurzbeschreibung: x.description || "" });
  const datei = path.join(ordner(x.id), "CLAUDE.md");
  // Nur die eigene, automatisch erzeugte Anleitung überschreiben – nie eine von Hand angelegte
  const alt = fs.existsSync(datei) ? fs.readFileSync(datei, "utf8") : null, neu = anleitung(x);
  if (alt === null || (alt.startsWith(MARKE) && alt !== neu)) fs.writeFileSync(datei, neu);
  return ordner(x.id);
}
/** Programmdatei von Claude Code suchen: npm-Installation im Pfad oder die eigenständige Installation im Benutzerordner */
function claudeExe() {
  const win = process.platform === "win32", name = win ? "claude.exe" : "claude";
  const pfade = String(process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  const heim = process.env.USERPROFILE || process.env.HOME || "";
  const orte = [
    // 1. npm-Installation: im Pfad liegt nur ein Starter, die Programmdatei daneben in node_modules
    ...pfade.map(d => path.join(d, "node_modules", "@anthropic-ai", "claude-code", "bin", name)),
    ...(heim ? [path.join(heim, "AppData", "Roaming", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", name), path.join(heim, ".local", "bin", name)] : []),
    // 2. eigenständige Installation im Pfad – aber nicht die Desktop-App, die unter Windows ebenfalls Claude.exe heißt
    ...pfade.filter(d => !/WindowsApps|\app$/i.test(d)).map(d => path.join(d, name)),
  ];
  return orte.find(o => { try { return fs.statSync(o).isFile(); } catch { return false; } }) || null;
}
// HARDWARE_UEBER_BRUECKE=1 behandelt auch den eigenen Rechner wie das Online-Board (zum Testen der Brücke)
const lokal = req => !process.env.HARDWARE_UEBER_BRUECKE && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

/** Für das Onboarding: Konzeptdatei eines neuen Hardware-Projekts mit Startwerten anlegen */
export function hardwareKonzeptAnlegen(id, felder = {}) {
  konzeptSchreiben(id, { ...leeresKonzept(), ...felder });
  fs.mkdirSync(dateiOrdner(id), { recursive: true });
}
export const hardwareDateiOrdner = dateiOrdner;
/** Einzelne Felder des Konzepts setzen (z. B. Name und Kurzbeschreibung aus der KI-Zusammenfassung) */
export function hardwareKonzeptFelder(id, felder) { try { konzeptSchreiben(id, { ...konzeptLesen(id), ...felder }); } catch { /* Datei gerade nicht lesbar */ } }
/** Für die Brücke zum Rechner des Inhabers (bruecke.mjs) */
export const hwIntern = { ordnerName, ordner, konzeptDatei, konzeptLesen, konzeptSchreiben, stand, dateiListe, dateiOrdner, anleitung };

/** Kunde für eigene Produktideen ohne Auftraggeber */
function internerKunde() {
  const mail = "intern@reeder-hardware.invalid";
  const c = db.prepare("SELECT id FROM clients WHERE email = ?").get(mail);
  if (c) return c.id;
  return Number(db.prepare("INSERT INTO clients(company, name, email, active, stage, source) VALUES(?, ?, ?, 0, 'mandant', 'intern')").run("Reeder intern", "Eigene Produktidee", mail).lastInsertRowid);
}

const INTERN_MAIL = "intern@reeder-hardware.invalid";
const DOC_DIR = path.resolve(process.env.DATA_DIR || "data", "documents");
/** Offenes (versendetes, noch nicht beantwortetes) Angebot zu einem Projekt */
const offenesAngebot = pid => db.prepare("SELECT id, number, gross FROM invoices WHERE project_id = ? AND kind = 'angebot' AND locked = 1 AND status = 'versendet' ORDER BY id DESC LIMIT 1").get(pid) || null;

/* ---------- Konzept-Dokument: PDFs liegen im Projektordner unter ergebnisse/ ---------- */
const KONZEPT_RE = /^Konzept V(\d+) (Kundenfassung|intern)\.pdf$/;
const ergebnisOrdner = id => path.join(ordner(id), "ergebnisse");
const versandDatei = id => path.join(ergebnisOrdner(id), "konzept-versand.json");
const versandLesen = id => { try { return JSON.parse(fs.readFileSync(versandDatei(id), "utf8")); } catch { return {}; } };
function konzeptListe(id) {
  let namen = []; try { namen = fs.readdirSync(ergebnisOrdner(id)); } catch {}
  const versand = versandLesen(id);
  return namen.map(name => { const m = name.match(KONZEPT_RE); if (!m) return null; const s = fs.statSync(path.join(ergebnisOrdner(id), name));
    return { name, version: +m[1], fassung: m[2] === "intern" ? "intern" : "kunde", groesse: s.size, erstellt: s.mtime.toISOString(), gesendet: versand[name] || null }; })
    .filter(Boolean).sort((a, b) => b.version - a.version || a.fassung.localeCompare(b.fassung));
}

export function createHardware({ json, send, readJson, clean, logEvent = () => {}, SITE_URL = "" }) {
  const zeile = id => db.prepare("SELECT p.*, c.company, c.name client_name, c.email client_email FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ? AND p.bereich = 'hardware'").get(id);
  const mitglieder = pid => db.prepare("SELECT u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.name").all(pid);
  const kopf = x => ({ id: x.id, name: x.title, status: x.status, archiviert: x.status === "abgeschlossen", erstellt: String(x.created_at || "").slice(0, 10),
    kunde: { id: x.client_id, name: x.company, ansprechpartner: x.client_name }, mitglieder: mitglieder(x.id),
    // Für den Hinweis „noch kein Auftrag“: eigenes Projekt ohne Kunde? Liegt ein Angebot beim Kunden?
    intern: x.client_email === INTERN_MAIL, angebot: offenesAngebot(x.id) });

  async function api(req, res, url, p, m, user) {
    const owner = isOwner(user);

    // Kunden zur Auswahl beim Anlegen
    if (p === "/hardware/kunden" && m === "GET") {
      const erlaubt = clientIdsFor(user);
      return json(res, 200, db.prepare("SELECT id, company, name FROM clients WHERE stage != 'archiv' ORDER BY company").all()
        .filter(c => !erlaubt || erlaubt.includes(c.id)).map(c => ({ id: c.id, name: c.company, ansprechpartner: c.name })));
    }

    if (p === "/hardware/projekte") {
      if (m === "GET") {
        const erlaubt = memberProjectIds(user);
        const rows = db.prepare("SELECT p.*, c.company, c.name client_name, c.email client_email FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.bereich = 'hardware' ORDER BY p.updated_at DESC").all()
          .filter(x => !erlaubt || erlaubt.includes(x.id));
        return json(res, 200, rows.map(x => {
          let k, fehlerhaft = false;
          try { k = konzeptLesen(x.id); } catch { k = leeresKonzept(); fehlerhaft = true; }
          const summe = (k.stueckliste || []).reduce((s, q) => s + (+q.menge || 0) * (+q.einzelpreis || 0), 0);
          return { ...kopf(x), fehlerhaft, naechstesMal: k.naechstesMal || "", kurzbeschreibung: k.kurzbeschreibung || x.description || "",
            aktualisiert: new Date(Math.max(stand(x.id), Date.parse(String(x.updated_at).replace(" ", "T") + "Z") || 0)).toISOString(),
            phasen: (k.phasen || []).map(ph => ({ id: ph.id, name: ph.name, status: ph.status })),
            zahlen: { module: (k.module || []).length, bauteile: (k.bauteile || []).length, material: Math.round(summe),
              offeneEntscheidungen: (k.entscheidungen || []).filter(e => e.status !== "entschieden").length, dateien: dateiListe(x.id).length } };
        }));
      }
      if (m === "POST") {
        if (!owner) return json(res, 403, { error: "Projekte legt der Inhaber an." });
        const d = await readJson(req);
        const name = clean(d.name, 160);
        if (!name) return json(res, 400, { error: "Bitte einen Projektnamen angeben." });
        let kunde = +d.kundeId || 0;
        if (kunde && !db.prepare("SELECT 1 FROM clients WHERE id = ?").get(kunde)) return json(res, 400, { error: "Diesen Kunden gibt es nicht." });
        if (!kunde) kunde = internerKunde();
        const id = Number(db.prepare("INSERT INTO projects(client_id, title, kind, description, phase, bereich) VALUES(?, ?, 'Hardware', ?, 'Konzept', 'hardware')")
          .run(kunde, name, clean(d.kurzbeschreibung, 4000)).lastInsertRowid);
        db.prepare("INSERT OR IGNORE INTO project_members(project_id, user_id) VALUES(?, ?)").run(id, user.id);
        konzeptSchreiben(id, { ...leeresKonzept(), name, kurzbeschreibung: clean(d.kurzbeschreibung, 4000) });
        fs.mkdirSync(dateiOrdner(id), { recursive: true });
        return json(res, 201, { id });
      }
    }

    const mm = p.match(/^\/hardware\/projekte\/(\d+)(?:\/(stand|dateien|arbeitsordner|konzept)(?:\/([^/]+))?(?:\/(senden))?)?$/);
    if (!mm) return null;
    const id = +mm[1], x = zeile(id);
    if (!x || !canProject(user, id)) return json(res, 404, { error: "Projekt nicht gefunden" });

    if (!mm[2]) {
      if (m === "GET") {
        let k = konzeptLesen(id), zeileJetzt = x;
        // Letztes Gespräch mit dem Kunden samt internen Notizen (nur für den Inhaber): steht im Überblick des Projekts
        const g = owner && x.client_email !== INTERN_MAIL ? db.prepare("SELECT id, title, start, notes_intern FROM appointments WHERE client_id = ? AND start < ? ORDER BY start DESC LIMIT 1").get(x.client_id, new Date().toISOString()) : null;
        const gespraech = g ? { id: g.id, title: g.title, start: g.start, notiz: g.notes_intern || "" } : null;
        // Claude schlägt im Gespräch einen kurzen Projektnamen vor (Feld namensvorschlag): übernehmen und das Feld entfernen
        if (typeof k.namensvorschlag === "string") {
          const name = clean(k.namensvorschlag, 160);
          delete k.namensvorschlag;
          if (name) { k.name = name; db.prepare("UPDATE projects SET title = ?, updated_at = datetime('now') WHERE id = ?").run(name, id); zeileJetzt = zeile(id); }
          konzeptSchreiben(id, k);
        }
        // Auf dem eigenen Rechner die Anleitung im Projektordner aktuell halten, auch wenn Claude direkt in der App geöffnet wird
        if (lokal(req) && PROJEKTE !== ALT && fs.existsSync(konzeptDatei(id))) { try { arbeitsordnerAnlegen(zeileJetzt); } catch {} }
        return json(res, 200, { ...k, ...kopf(zeileJetzt), gespraech, geaendert: stand(id) });
      }
      if (m === "PATCH") {
        // Nur die gesendeten Felder ersetzen, damit parallele Änderungen an anderen Feldern erhalten bleiben.
        const d = await readJson(req, 20 * 1024 * 1024);
        for (const k of ["id", "kunde", "mitglieder", "geaendert", "erstellt", "intern", "angebot", "gespraech"]) delete d[k];
        if (typeof d.name === "string") { d.name = clean(d.name, 160) || x.title; db.prepare("UPDATE projects SET title = ? WHERE id = ?").run(d.name, id); }
        if (typeof d.kurzbeschreibung === "string") db.prepare("UPDATE projects SET description = ? WHERE id = ?").run(clean(d.kurzbeschreibung, 4000), id);
        // Aus einer Anfrage wird ein Auftrag: nur der Inhaber, nur in diese Richtung
        if (d.status === "aktiv" && x.status === "anfrage") { if (!owner) return json(res, 403, { error: "Das entscheidet der Inhaber." }); db.prepare("UPDATE projects SET status = 'aktiv' WHERE id = ?").run(id); }
        // Zurück zur Anfrage: nur der Inhaber, und nur solange kein Angebot angenommen und keine Rechnung gestellt ist
        if (d.status === "anfrage" && x.status === "aktiv") {
          if (!owner) return json(res, 403, { error: "Das entscheidet der Inhaber." });
          if (db.prepare("SELECT 1 FROM invoices WHERE project_id = ? AND locked = 1 AND (kind != 'angebot' OR status = 'angenommen')").get(id)) return json(res, 409, { error: "Zu diesem Projekt gibt es ein angenommenes Angebot oder eine Rechnung – es bleibt ein Auftrag." });
          db.prepare("UPDATE projects SET status = 'anfrage' WHERE id = ?").run(id);
        }
        delete d.status;
        if (typeof d.archiviert === "boolean") { db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(d.archiviert ? "abgeschlossen" : "aktiv", id); delete d.archiviert; }
        if (d.kundeId !== undefined) {
          if (!owner) return json(res, 403, { error: "Den Kunden ändert der Inhaber." });
          const kunde = +d.kundeId || internerKunde();
          if (!db.prepare("SELECT 1 FROM clients WHERE id = ?").get(kunde)) return json(res, 400, { error: "Diesen Kunden gibt es nicht." });
          db.prepare("UPDATE projects SET client_id = ? WHERE id = ?").run(kunde, id); delete d.kundeId;
        }
        db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id);
        konzeptSchreiben(id, { ...konzeptLesen(id), ...d });
        return json(res, 200, { ...konzeptLesen(id), ...kopf(zeile(id)), geaendert: stand(id) });
      }
      return null;
    }

    // Arbeitsordner anlegen (liefert den Pfad für den Claude-Link) und auf Wunsch im Explorer öffnen.
    // Beides ergibt nur Sinn, wenn Board und Browser auf demselben Rechner laufen.
    if (mm[2] === "arbeitsordner" && m === "POST") {
      if (!lokal(req)) {
        // Online-Board: Ordner anlegen und Claude starten kann nur die Brücke auf dem Rechner des Inhabers
        if (!owner) return json(res, 403, { error: "Das geht nur am Rechner des Inhabers." });
        if (!brueckeEingerichtet()) return json(res, 400, { error: "Dafür braucht es die Brücke auf deinem Rechner. Einrichten unter Einstellungen → Livegang → „Brücke zu Claude“." });
        if (!brueckeVerbunden()) return json(res, 400, { error: "Die Brücke auf deinem Rechner ist gerade nicht verbunden. Bitte dort „Brücke starten“ ausführen und noch einmal drücken." });
        const d = mm[3] === "claude" ? await readJson(req, 64 * 1024) : {};
        brueckeAuftrag(id, mm[3] === "claude" ? (d.wo === "terminal" ? "terminal" : "app") : mm[3] === "oeffnen" ? "ordner" : "anlegen", d.auftrag);
        return json(res, 200, { pfad: "", gestartet: true, programm: "bruecke" });
      }
      const pfad = arbeitsordnerAnlegen(x);
      if (mm[3] === "claude") {
        // Claude Code im Projektordner öffnen, Auftrag vorbelegt. Der Server ruft den Link selbst auf: Das klappt in jedem Browser,
        // auch in solchen, die fremde Link-Typen nicht an Windows weiterreichen.
        const d = await readJson(req, 64 * 1024);
        if (d.wo !== "terminal") {
          // Claude-App (Reiter Code) mit neuer Sitzung im Projektordner, Auftrag vorbelegt:
          // claude://code/new?folder=…&q=… (Anthropic-Hilfe „Open Claude Desktop with a link“). Die App fragt vor dem Öffnen nach.
          const enc = t => encodeURIComponent(t).replace(/'/g, "%27");
          const auftrag = String(d.auftrag || "").slice(0, 12000);
          const bauen = q => `claude://code/new?folder=${enc(pfad)}&q=${enc(q)}`;
          let link = bauen(auftrag);
          // Windows reicht Links nur bis gut 2000 Zeichen weiter; längere verschwinden ohne Meldung.
          // Dann steht der Auftrag als Datei im Projektordner und der Link verweist nur darauf.
          if (link.length > 1900) {
            fs.writeFileSync(path.join(pfad, "auftrag.md"), `<!-- Vom Reeder Board geschrieben, wird beim nächsten Auftrag ersetzt. -->\n${auftrag}\n`);
            link = bauen("Mein Auftrag steht in der Datei auftrag.md in diesem Ordner. Lies ihn bitte und fang damit an.");
          }
          const [prog, args] = process.platform === "win32" ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${link}'`]]
            : process.platform === "darwin" ? ["open", [link]] : ["xdg-open", [link]];
          try { spawn(prog, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref(); }
          catch { return json(res, 500, { error: "Die Claude-App ließ sich nicht öffnen." }); }
          return json(res, 200, { pfad, gestartet: true, programm: "app" });
        }
        const url = `claude-cli://open?cwd=${encodeURIComponent(pfad)}&q=${encodeURIComponent(String(d.auftrag || "").slice(0, 4800))}`;
        // Claude Code direkt aufrufen (claude --handle-uri <Link>). Der Umweg über den bei Windows registrierten Link-Typ ist
        // unzuverlässig, je nachdem, aus welcher Umgebung Claude Code zuerst gestartet wurde.
        const exe = claudeExe();
        if (!exe) return json(res, 400, { error: "Claude Code wurde auf diesem Rechner nicht gefunden. Bitte installieren und einmal anmelden." });
        try { spawn(exe, ["--handle-uri", url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { return json(res, 500, { error: "Claude Code ließ sich nicht starten." }); }
        return json(res, 200, { pfad, gestartet: true, programm: exe });
      }
      if (mm[3] === "oeffnen") {
        const [prog, args] = process.platform === "win32" ? ["explorer.exe", [pfad]] : process.platform === "darwin" ? ["open", [pfad]] : ["xdg-open", [pfad]];
        try { spawn(prog, args, { detached: true, stdio: "ignore" }).unref(); } catch { return json(res, 500, { error: "Der Ordner ließ sich nicht öffnen." }); }
      }
      return json(res, 200, { pfad });
    }
    /* ---------- Konzept-Dokument ---------- */
    if (mm[2] === "konzept") {
      if (!mm[3]) {
        if (m === "GET") return json(res, 200, konzeptListe(id));
        if (m === "POST") {
          // Neue Version erzeugen: beide Fassungen aus demselben Stand, mit den Bildern aus der 3D-Ansicht des Browsers
          const d = await readJson(req, 40 * 1024 * 1024), k = konzeptLesen(id);
          const bilder = (Array.isArray(d.bilder) ? d.bilder : []).slice(0, 16).map(b => {
            const roh = String(b?.data || "").replace(/^data:image\/(png|jpeg);base64,/, ""), buf = Buffer.from(roh, "base64");
            return buf.length > 200 && buf.length < 6 * 1024 * 1024 ? { titel: clean(b.titel, 120), modul: clean(b.modul, 60), buf } : null; }).filter(Boolean);
          const version = Math.max(0, ...konzeptListe(id).map(e => e.version)) + 1;
          fs.mkdirSync(ergebnisOrdner(id), { recursive: true });
          for (const [fassung, wort] of [["intern", "intern"], ["kunde", "Kundenfassung"]]) {
            const buf = await renderKonzeptPdf({ company: getSetting("company", DEFAULT_COMPANY), kunde: x.client_email === INTERN_MAIL ? "" : x.company, name: x.title, version, fassung, k, bilder });
            fs.writeFileSync(path.join(ergebnisOrdner(id), `Konzept V${version} ${wort}.pdf`), buf);
          }
          return json(res, 201, konzeptListe(id));
        }
        return null;
      }
      const name = decodeURIComponent(mm[3]);
      if (!KONZEPT_RE.test(name)) return json(res, 404, { error: "Dokument nicht gefunden" });
      const ziel = path.join(ergebnisOrdner(id), name);
      if (!fs.existsSync(ziel)) return json(res, 404, { error: "Dokument nicht gefunden" });
      if (!mm[4] && m === "GET") return send(res, 200, fs.readFileSync(ziel), { "Content-Type": "application/pdf", "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${x.title} – ${name}`)}` });
      if (mm[4] === "senden" && m === "POST") {
        // Nur die Kundenfassung geht raus: als Dokument ins Kundenportal und per Mail im Anhang. Immer nur auf Knopfdruck.
        if (!owner) return json(res, 403, { error: "Das Konzept verschickt der Inhaber." });
        if (!/Kundenfassung/.test(name)) return json(res, 400, { error: "An Kunden geht nur die Kundenfassung." });
        const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(x.client_id);
        if (!c || c.email === INTERN_MAIL || !c.email) return json(res, 400, { error: "Dieses Projekt hat keinen Kunden mit E-Mail-Adresse." });
        const buf = fs.readFileSync(ziel), token = randomBytes(24).toString("hex"), version = name.match(KONZEPT_RE)[1];
        fs.mkdirSync(DOC_DIR, { recursive: true }); fs.writeFileSync(path.join(DOC_DIR, token), buf);
        const titel = `Entwicklungskonzept ${x.title} (V${version})`.slice(0, 160), datei = `Entwicklungskonzept-${safeName(x.title)}-V${version}.pdf`;
        db.prepare("INSERT INTO documents(client_id, project_id, kind, title, doc_date, file_token, file_name, mime, bytes) VALUES(?,?,?,?,date('now'),?,?,?,?)")
          .run(c.id, id, "Konzept", titel, token, datei, "application/pdf", buf.length);
        const firma = getSetting("company", DEFAULT_COMPANY);
        const portal = c.stage === "mandant" && SITE_URL ? `\n\nSie finden das Dokument auch in Ihrem Kundenportal: ${SITE_URL}/portal/` : "";
        const text = `Guten Tag ${c.name},\n\nim Anhang finden Sie das Entwicklungskonzept zu „${x.title}“: die Anforderungen, die gewählte Lösung, den Aufbau mit Ansichten aus dem 3D-Modell, die geschätzten Materialkosten sowie die Prüfpunkte und offenen Punkte.\n\nSchauen Sie es in Ruhe durch. Ihre Fragen und Anmerkungen besprechen wir gern in einem Termin.${portal}\n\nFreundliche Grüße\n${firma.name || "Reeder Hardware"}`;
        const mailed = await sendMail({ to: c.email, subject: `Entwicklungskonzept ${x.title}`, text, attachments: [{ filename: datei, content: buf, contentType: "application/pdf" }] });
        try { logEvent(c.id, id, "dokument", "Entwicklungskonzept übersendet", titel, false); } catch {}
        const v = versandLesen(id); v[name] = { am: new Date().toISOString(), an: c.email, mail: !!mailed }; fs.writeFileSync(versandDatei(id), JSON.stringify(v, null, 2));
        return json(res, 200, { mailed: !!mailed, liste: konzeptListe(id) });
      }
      return null;
    }
    if (mm[2] === "stand" && m === "GET") return json(res, 200, { geaendert: stand(id), dateien: dateiListe(id).length });

    if (mm[2] === "dateien") {
      if (!mm[3]) {
        if (m === "GET") return json(res, 200, dateiListe(id));
        if (m === "POST") {
          const d = await readJson(req, Math.ceil(MAX_FILE * 1.4));
          const buf = Buffer.from(String(d.data || ""), "base64");
          if (!buf.length) return json(res, 400, { error: "Die Datei ist leer." });
          if (buf.length > MAX_FILE) return json(res, 413, { error: "Die Datei ist größer als 30 MB." });
          fs.mkdirSync(dateiOrdner(id), { recursive: true });
          const wunsch = safeName(d.name), ext = path.extname(wunsch), stamm = wunsch.slice(0, wunsch.length - ext.length);
          let name = wunsch;
          for (let n = 2; fs.existsSync(path.join(dateiOrdner(id), name)); n++) name = `${stamm} (${n})${ext}`;
          fs.writeFileSync(path.join(dateiOrdner(id), name), buf);
          return json(res, 201, { name });
        }
        return null;
      }
      const name = safeName(decodeURIComponent(mm[3])), ziel = path.join(dateiOrdner(id), name);
      if (name !== decodeURIComponent(mm[3]) || !fs.existsSync(ziel)) return json(res, 404, { error: "Datei nicht gefunden" });
      if (m === "GET") {
        const typ = INLINE[path.extname(name).toLowerCase()];
        return send(res, 200, fs.readFileSync(ziel), { "Content-Type": typ || "application/octet-stream", "Cache-Control": "no-store",
          "Content-Disposition": `${typ ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}` });
      }
      if (m === "DELETE") { fs.unlinkSync(ziel); return json(res, 200, { ok: true }); }
    }
    return null;
  }

  return { api, DIR };
}
