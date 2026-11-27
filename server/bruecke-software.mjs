// Brücke für Software- und Website-Projekte (Ergänzung zu bruecke.mjs).
// „Mit Claude arbeiten“ im Online-Board: Die Brücke auf dem Rechner des Inhabers legt unter
// Reeder Software GmbH/Projekte/<Projektname> einen Ordner an – mit den Angaben des Kunden aus dem Fragebogen (anfrage.md),
// dem bisherigen Entwurf bzw. letzten Stand (website/) und einer Anleitung für Claude (CLAUDE.md) – und öffnet Claude darin.
// „Neuen Stand hochladen“: Die Brücke schickt den Inhalt von website/ hierher; daraus wird wie beim täglichen Stand eine neue Version.
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.mjs";
import { brueckeAuftrag, brueckePruefen, brueckeVerbunden, brueckeEingerichtet } from "./bruecke.mjs";
import { hwIntern } from "./hardware.mjs";
import { answersText } from "./vorab.mjs";
import { antwortenView } from "./onboarding.mjs";
import { PROTO_MIME, safeRel } from "./portal.mjs";
import { workspaceSpeichern, workspaceLesen, workspaceFuerBruecke, phaseNachziehen } from "./workspace.mjs";
import { anmerkungenText, anmerkungenStempel, anmerkungenErledigen } from "./anmerkungen.mjs";

const PROTO_DIR = path.resolve(process.env.DATA_DIR || "data", "prototypes");
const MAX_BYTES = 60 * 1024 * 1024, MAX_FILES = 600;
const MARKE = "<!-- Vom Reeder Board erzeugt. Wird bei jedem Öffnen neu geschrieben; eigene Hinweise bitte in notizen/ ablegen. -->";

const projekt = id => db.prepare("SELECT p.*, c.company, c.name client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ? AND COALESCE(p.bereich, 'software') != 'hardware'").get(id);
/** Neuester Entwurf oder Stand des Projekts: veröffentlichte Version oder der Vorab-Entwurf aus dem Fragebogen */
const letzterStand = pid => db.prepare("SELECT id, title, token, entry, version, state, created_at FROM prototypes WHERE project_id = ? AND (state IS NULL OR state = 'kandidat') ORDER BY id DESC LIMIT 1").get(pid) || null;
function dateienVon(token) {
  const wurzel = path.join(PROTO_DIR, token), out = [];
  const lauf = (abs, rel) => { let l = []; try { l = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of l) { const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) lauf(path.join(abs, e.name), r); else if (e.isFile() && out.length < MAX_FILES) out.push({ pfad: r, groesse: fs.statSync(path.join(abs, e.name)).size }); } };
  lauf(wurzel, "");
  return out;
}

/** Die Angaben des Kunden als lesbarer Text: Beschreibung des Projekts und die Antworten aus den Fragebögen */
function anfrageText(x) {
  const teile = [`# Anfrage: ${x.title}`, `Kunde: ${x.company}${x.client_name && x.client_name !== x.company ? ` (${x.client_name})` : ""}`];
  if (x.description) teile.push(`## Beschreibung\n\n${x.description}`);
  if (x.booking_id) {
    try { const v = db.prepare("SELECT answers FROM vorab WHERE booking_id = ? AND answers IS NOT NULL ORDER BY id DESC LIMIT 1").get(x.booking_id);
      const text = v ? answersText(JSON.parse(v.answers)) : "";
      if (text && !String(x.description || "").includes(text)) teile.push(`## Antworten aus dem Website-Fragebogen\n\n${text}`); } catch {}   // nicht doppelt, wenn die Beschreibung sie schon enthält
    try { for (const o of db.prepare("SELECT kinds, answers FROM onboarding WHERE booking_id = ? AND answers IS NOT NULL").all(x.booking_id)) {
      const a = JSON.parse(o.answers);
      for (const k of JSON.parse(o.kinds || "[]").filter(k => k !== "hardware" && a[k])) {
        const gruppen = antwortenView(k, a[k]).map(g => { const z = g.rows.map(r => `- ${r.k}: ${[...(r.chips || []), r.v].filter(Boolean).join(", ")}`).filter(t => !/: $/.test(t)); return z.length ? `### ${g.title}\n\n${z.join("\n")}` : ""; }).filter(Boolean);
        if (gruppen.length) teile.push(`## Antworten aus dem Fragebogen\n\n${gruppen.join("\n\n")}`);
      } } } catch {}
    try { const b = db.prepare("SELECT message, start FROM bookings WHERE id = ?").get(x.booking_id); if (b?.message) teile.push(`## Aus der Terminbuchung\n\n${b.message}`); } catch {}
  }
  return `<!-- Vom Reeder Board erzeugt, wird bei jedem Öffnen neu geschrieben. -->\n${teile.join("\n\n")}\n`;
}

const anleitung = x => `${MARKE}
# ${x.title}

Software- bzw. Website-Projekt im Reeder Board (Projekt ${x.id}, Kunde: ${x.company || "–"}). Dieser Ordner ist der Arbeitsordner des Projekts.

## Was hier liegt

- \`anfrage.md\` – die Angaben des Kunden aus Terminbuchung und Fragebogen. Wird vom Board geschrieben, nicht bearbeiten.
- \`website/\` – die Website bzw. der Prototyp: statische Dateien (HTML, CSS, JS, Bilder), Einstieg ist \`index.html\`. Hier wird gearbeitet. Liegt schon etwas darin, ist das der bisherige Entwurf oder der letzte veröffentlichte Stand.
- \`notizen/\` – Gesprächsnotizen des Inhabers. Lesen erlaubt, nicht verändern.
- \`arbeitsstand.json\` – dein Arbeitsstand für das Board (siehe unten). Diese Datei pflegst du.
- \`anmerkungen.md\` – die offenen Anmerkungen, die Kunde und Team im Board an der Website angepinnt haben. Wird vom Board laufend neu geschrieben, nicht bearbeiten.

## Wer ist wer

- Du sprichst mit dem Inhaber von Reeder Software. Er entwickelt die Website im Auftrag des Kunden. Sprich ihn mit „du“ an.
- \`anfrage.md\` stammt vom Kunden. Der Kunde liest hier nicht mit. Was nur der Kunde beantworten kann, kläre zuerst mit dem Inhaber und trage den Rest als Frage in \`arbeitsstand.json\` ein.

## Gespräch zuerst

Der Inhaber entwickelt seine Ideen am liebsten im Gespräch und spricht seine Nachrichten oft ein (Diktat – Hörfehler mitdenken, bei Unklarheit nachfragen).

- Erst kurz sagen, wie du die Aufgabe verstehst, eigene Ideen und Einwände einbringen, Rückfragen einzeln stellen. Größere Umbauten erst nach seinem Okay.
- Nach jeder Änderung in zwei, drei Sätzen sagen, was jetzt anders ist und auf welcher Seite er es sieht.

## Arbeitsweise

- Inhalte und Oberfläche der Website sind deutsch, sofern der Kunde nichts anderes wünscht. Der Inhaber ist kein Techniker: Entscheidungen verständlich begründen.
- Nur in \`website/\` arbeiten. Alle Verweise relativ halten (kein führender Schrägstrich), damit die Seite im Kundenportal unter einem Unterpfad läuft.
- Keine erfundenen Angaben zum Kunden (Adresse, Telefon, Preise, Zitate, Auszeichnungen). Was fehlt, sichtbar als Platzhalter kennzeichnen und als Frage an den Kunden notieren.
- Auf dem Handy zuerst prüfen: gut lesbar, nichts ragt seitlich heraus, Schaltflächen gut zu treffen. Bilder klein halten.
- Keine Zugangsdaten, Schlüssel oder persönlichen Daten in die Dateien schreiben.

## Anmerkungen aus dem Board (anmerkungen.md)

Kunde und Inhaber pinnen im Board Anmerkungen direkt an die Website. Alle offenen stehen in \`anmerkungen.md\` – mit Seite, Stelle, Text und, wenn vorhanden, dem genauen Änderungswunsch. Die Datei ist immer aktuell; lies sie zu Beginn jeder Sitzung und wenn der Inhaber von „den Anmerkungen“ spricht. Er muss sie dir nicht diktieren.

- Sag zuerst kurz, welche Anmerkungen du siehst und wie du sie umsetzen würdest. Unklare oder große Wünsche erst mit dem Inhaber klären.
- Die Stelle ist als Seite, Bildschirmbreite und Abstand von links/oben angegeben; ein Selektor bezieht sich auf die Website in \`website/\`.
- Merk dir die Nummern (#) der Anmerkungen, die du umgesetzt hast. Beim Hochladen meldest du sie als erledigt (siehe unten) – dann sind sie im Board abgehakt und der Kunde sieht „Umgesetzt in Version …“.

## Arbeitsstand für das Board (arbeitsstand.json)

Der Inhaber sieht im Board auf der Projektseite den Bereich „Arbeitsbereich“. Er zeigt, was in \`arbeitsstand.json\` steht – die Brücke überträgt die Datei wenige Sekunden nach jedem Speichern. Der Kunde sieht davon nichts; nur die offenen Fragen kann der Inhaber mit einem Knopf an den Kunden schicken.

Halte die Datei aktuell: am Ende jeder Sitzung, nach jedem größeren Schritt und immer, wenn der Inhaber darum bittet („aktualisiere den Stand“). Aufbau (gültiges JSON, nur diese Felder):

\`\`\`json
{
  "stand": "Zwei, höchstens drei kurze Sätze: Was ist fertig, was fehlt noch?",
  "letzteSitzung": "Höchstens drei kurze Sätze: Was wurde zuletzt gemacht, was ist als Nächstes dran?",
  "notizen": ["Höchstens fünf Einträge, je ein Satz: Entscheidungen, die für die weitere Arbeit noch gelten"],
  "fragen": [
    { "id": "f1", "text": "Frage an den Kunden, so formuliert, dass man sie ihm unverändert schicken kann (Sie-Form)", "status": "offen", "antwort": "" }
  ]
}
\`\`\`

- Kurz halten – der Inhaber liest das zwischen Tür und Angel. \`stand\` und \`letzteSitzung\` beschreiben die Arbeit am Projekt, nicht den Kunden: keine Firmengeschichte, keine Namen, Zahlen oder Standorte des Kunden, keine Aufzählung aller Seiten. Bei jedem Aktualisieren neu und knapp schreiben, nicht anhängen.
- \`notizen\`: nichts, was schon erledigt ist, und keine Aufgaben für den Inhaber. Was er selbst tun muss, sagst du ihm im Gespräch. Alte Einträge streichen, sobald sie nicht mehr gebraucht werden.
- Fragen: nur was wirklich der Kunde beantworten muss und was die Arbeit gerade aufhält – höchstens fünf offene. Nimmst du eine Frage neu auf, sag es dem Inhaber im Gespräch, damit er weiß, woher sie kommt. Jede Frage bekommt eine feste \`id\` (f1, f2 …), die sich nie ändert.
- Der Inhaber kann im Board selbst Fragen anlegen (ihre \`id\` beginnt mit \`t\`), Antworten eintragen oder Fragen löschen. Die Brücke schreibt das nach wenigen Sekunden in diese Datei. Lösche keine Frage mit \`t\`-id von dir aus. Steht bei einer Frage \`"status": "geklaert"\` mit einer Antwort, die du noch nicht kennst, berücksichtige sie bei der weiteren Arbeit.
- Der Inhaber schickt offene Fragen an den Kunden; der Kunde beantwortet jede Frage einzeln im Kundenportal. Seine Antworten kommen hier als geklärte Fragen mit \`antwort\` an (die Antwort gehört immer genau zu dieser Frage). Prüfe zu Beginn jeder Sitzung, ob neue Antworten da sind, sag dem Inhaber kurz, was neu ist, und berücksichtige sie in der Arbeit (z. B. eine Umsatzsteuer-ID im Impressum eintragen).
- Ist eine Frage geklärt (der Inhaber nennt dir die Antwort oder sie hat sich erledigt): \`status\` auf \`"geklaert"\` setzen und die Antwort in \`antwort\` eintragen. Sie verschwindet dann im Board aus den offenen Fragen. Alte geklärte Fragen darfst du nach einiger Zeit ganz löschen.
- Keine Zugangsdaten und nichts Vertrauliches hineinschreiben.

## Neuen Stand hochladen

Sagt der Inhaber ausdrücklich, dass du den Stand hochladen sollst („lade den aktuellen Stand hoch“), dann:

1. \`arbeitsstand.json\` aktualisieren.
2. Im Projektordner die Datei \`hochladen.json\` anlegen: \`{ "aenderungen": "Ein, höchstens zwei kurze Sätze für den Kunden: Was ist neu?", "erledigteAnmerkungen": [12, 15] }\` – in \`erledigteAnmerkungen\` die Nummern der Anmerkungen aus \`anmerkungen.md\`, die in diesem Stand wirklich umgesetzt sind (sonst leere Liste).
3. Die Brücke lädt den Inhalt von \`website/\` innerhalb weniger Sekunden hoch, löscht \`hochladen.json\` und schreibt das Ergebnis in \`hochladen-ergebnis.json\`. Lies diese Datei nach etwa zehn Sekunden und sag dem Inhaber, welche Version hochgeladen ist (oder was nicht geklappt hat).

Wichtig: Was du hochlädst, sieht der Kunde noch nicht. Die Version wartet im Board auf die Freigabe des Inhabers: Auf der Projektseite steht oben „Version … wartet auf deine Freigabe“ – dort sieht er sie an und gibt sie frei oder verwirft sie. Erst mit der Freigabe sieht der Kunde die Version, und erst dann werden die gemeldeten Anmerkungen abgehakt. Sag ihm das nach dem Hochladen in einem Satz. Nie von dir aus hochladen.

Eine Anmerkung, die du bewusst nicht umgesetzt hast, meldest du nicht als erledigt. Sag dem Inhaber im Gespräch kurz, welche das ist und warum.

## Prüfbericht für das Board (pruefbericht.json)

Das Board hat keinen eigenen Browser zum Testen – die Prüfung machst du. Immer wenn du an der Website etwas geändert hast und **bevor** du einen Stand hochlädst:

1. Prüfe die Seite in einem echten Browser in diesen Größen: Desktop 1440 px, Tablet 820 px, Handy 390 px und kleines Handy 320 px. Achte auf abgeschnittene oder überlappende Inhalte, waagerechtes Scrollen, kaputte Links und Bilder, Fehler in der Konsole, Lesbarkeit und Kontrast, Tippfehler und widersprüchliche Angaben (z. B. Öffnungszeiten), Impressum und Datenschutz erreichbar.
2. Behebe, was du findest, und prüfe erneut.
3. Schreibe das Ergebnis in \`pruefbericht.json\` im Projektordner (Datei jedes Mal ganz neu schreiben, nur echte Zahlen – nichts schätzen oder erfinden; was du nicht gezählt hast, lässt du weg):

\`\`\`json
{
  "zusammenfassung": "Ein bis zwei Sätze für den Inhaber: Was wurde gemacht und geprüft, wie ist der Zustand?",
  "zahlen": { "zeilenGeaendert": 0, "dateienGeaendert": 0, "aenderungen": 0, "testlaeufe": 0, "pruefungen": 0, "behoben": 0, "offen": 0 },
  "geprueft": ["Desktop 1440", "Tablet 820", "Handy 390", "Handy 320"],
  "seiten": ["Startseite", "Leistungen"],
  "funde": [ { "schwere": "kritisch | hoch | mittel | hinweis", "titel": "Kurz, was nicht stimmt", "seite": "Startseite", "geraet": "Handy 390", "status": "offen | behoben" } ],
  "kiKosten": { "betrag": 0.00, "waehrung": "USD", "hinweis": "z. B. laut /cost dieser Sitzung" }
}
\`\`\`

- \`zeilenGeaendert\` und \`dateienGeaendert\` z. B. aus \`git diff --stat\` seit dem letzten Stand, \`testlaeufe\` = wie oft du die Seiten insgesamt durchgeprüft hast, \`pruefungen\` = Anzahl Einzelprüfungen (Seite × Größe × Prüfpunkt).
- \`kiKosten\`: nur eintragen, wenn du die Kosten dieser Sitzung wirklich kennst (z. B. aus \`/cost\`); sonst ganz weglassen – nie schätzen.
- In \`funde\` gehören alle in dieser Sitzung gefundenen Punkte – behobene mit \`"behoben"\`, nicht behobene mit \`"offen"\` und einem Satz im Gespräch, warum.
- Die Brücke überträgt die Datei wenige Sekunden nach dem Speichern. Der Inhaber sieht den Bericht auf der Projektseite und bei der Freigabe der Version. Der Kunde sieht ihn nicht.
`;

// Anmerkungen, die mit einer wartenden Version als erledigt gemeldet wurden – abgehakt wird erst bei der Freigabe
if (!db.prepare("PRAGMA table_info(prototypes)").all().some(c => c.name === "erledigt_ids")) db.exec("ALTER TABLE prototypes ADD COLUMN erledigt_ids TEXT");
/** Version dieses Projekts, die auf die Freigabe des Inhabers wartet (von Claude über die Brücke hochgeladen) */
const wartend = pid => db.prepare("SELECT * FROM prototypes WHERE project_id = ? AND state = 'kandidat' AND job_id IS NULL AND COALESCE(source, '') = 'bruecke' ORDER BY id DESC LIMIT 1").get(pid) || null;
const idListe = t => { try { return JSON.parse(t || "[]"); } catch { return []; } };
/* Prüfberichte von Claude (pruefbericht.json über die Brücke) */
db.exec(`CREATE TABLE IF NOT EXISTS pruefberichte (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prototype_id INTEGER, version INTEGER, daten TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
const txt = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const zahl = v => Number.isFinite(+v) && +v >= 0 ? Math.min(Math.round(+v), 1e7) : null;
const SCHWERE = ["kritisch", "hoch", "mittel", "hinweis"];
function berichtSaeubern(d) {
  const z = d?.zahlen || {}, zahlen = {};
  for (const k of ["zeilenGeaendert", "dateienGeaendert", "aenderungen", "testlaeufe", "pruefungen", "behoben", "offen"]) { const n = zahl(z[k]); if (n !== null) zahlen[k] = n; }
  const funde = (Array.isArray(d?.funde) ? d.funde : []).slice(0, 80).map(f => ({ schwere: SCHWERE.includes(f?.schwere) ? f.schwere : "hinweis", titel: txt(f?.titel, 200), seite: txt(f?.seite, 80), geraet: txt(f?.geraet, 40), status: f?.status === "behoben" ? "behoben" : "offen" })).filter(f => f.titel);
  const k = d?.kiKosten, kiKosten = k && Number.isFinite(+k.betrag) && +k.betrag >= 0 ? { betrag: Math.round(+k.betrag * 100) / 100, waehrung: /^(EUR|USD)$/.test(k.waehrung) ? k.waehrung : "USD", hinweis: txt(k.hinweis, 80) } : null;
  return { kiKosten, zusammenfassung: txt(d?.zusammenfassung, 600), zahlen, geprueft: (Array.isArray(d?.geprueft) ? d.geprueft : []).slice(0, 10).map(x => txt(x, 30)).filter(Boolean),
    seiten: (Array.isArray(d?.seiten) ? d.seiten : []).slice(0, 40).map(x => txt(x, 60)).filter(Boolean), funde };
}
const berichtOut = r => { if (!r) return null; let d = {}; try { d = JSON.parse(r.daten); } catch {} return { id: r.id, version: r.version, prototype_id: r.prototype_id, created_at: r.created_at, ...d }; };

export function createBrueckeSoftware({ json, send, readJson, clean, publish, stand }) {
  /** Board (nur Inhaber): Aufträge für die Brücke anstoßen – /bruecke/projekt/<id>/(claude|ordner|stand) */
  async function admin(req, res, p, m, user) {
    // Freigabe einer wartenden Version – braucht die Brücke nicht
    const fm = p.match(/^\/bruecke\/projekt\/(\d+)\/(wartend|freigeben|verwerfen|pruefbericht)$/);
    if (fm) {
      const x = projekt(+fm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const c = wartend(x.id);
      if (fm[2] === "pruefbericht" && m === "GET") return json(res, 200, { aktuell: berichtOut(db.prepare("SELECT * FROM pruefberichte WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(x.id)),
        frueher: db.prepare("SELECT * FROM pruefberichte WHERE project_id = ? ORDER BY id DESC LIMIT 6 OFFSET 1").all(x.id).map(berichtOut),
        pruefKosten: (() => { try { return Math.round(db.prepare("SELECT COALESCE(SUM(cost_usd), 0) s FROM assistant_usage WHERE project_id = ?").get(x.id).s * 100) / 100 || null; } catch { return null; } })() });   // KI im Board für dieses Projekt (alle Stufen, gesamt)
      if (fm[2] === "wartend" && m === "GET") {
        const live = db.prepare("SELECT version, created_at FROM prototypes WHERE project_id = ? AND state IS NULL AND active = 1 ORDER BY id DESC LIMIT 1").get(x.id) || null;
        return json(res, 200, { wartend: c ? { id: c.id, version: c.version, changes: c.changes, created_at: c.created_at, url: `/p/${c.token}/${c.entry}`, base: `/p/${c.token}/`, entry: c.entry, title: c.title, erledigt: idListe(c.erledigt_ids).length, pruefbericht: berichtOut(db.prepare("SELECT * FROM pruefberichte WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(x.id)) } : null, live });
      }
      if (m !== "POST") return null;
      if (!c) return json(res, 404, { error: "Es wartet keine Version auf Freigabe." });
      if (fm[2] === "verwerfen") { await stand.discardCandidate(c); return json(res, 200, { ok: true }); }
      const d = await readJson(req, 64 * 1024);
      stand.releaseCandidate(c, { text: clean(d.text, 3000) || c.changes, announce: d.announce !== false, mail: d.mail === undefined ? undefined : d.mail !== false, erinnern: d.erinnern === true, author: user?.name || "Team Reeder" });
      const erledigt = anmerkungenErledigen(x.id, idListe(c.erledigt_ids), c.version);
      phaseNachziehen(x.id);
      return json(res, 200, { ok: true, version: c.version, erledigt });
    }
    const mm = p.match(/^\/bruecke\/projekt\/(\d+)\/(claude|ordner|stand)$/); if (!mm || m !== "POST") return null;
    const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (!brueckeEingerichtet()) return json(res, 400, { error: "Dafür braucht es die Brücke auf deinem Rechner. Einrichten unter Einstellungen → Livegang → „Brücke zu Claude“." });
    if (!brueckeVerbunden()) return json(res, 400, { error: "Die Brücke auf deinem Rechner ist gerade nicht verbunden. Bitte dort „Bruecke im Hintergrund starten“ ausführen und noch einmal drücken." });
    const d = await readJson(req, 64 * 1024);
    if (mm[2] === "stand") brueckeAuftrag(x.id, "sw-stand", "", { changes: clean(d.changes, 3000), announce: d.announce !== false, mail: d.mail === undefined ? undefined : d.mail !== false, author: user?.name || "Team Reeder" });
    else brueckeAuftrag(x.id, mm[2] === "claude" ? "sw-app" : "sw-ordner", d.auftrag);
    return json(res, 200, { ok: true });
  }

  /** Hilfsprogramm: /api/bruecke/software/<id>[/datei/<pfad>|/stand] */
  async function publicRoute(req, res, url) {
    const p = url.pathname.replace(/^\/api\/bruecke\/software/, ""), m = req.method;
    if (!brueckePruefen(req)) return json(res, 401, { error: "Der Schlüssel der Brücke stimmt nicht." });
    let mm = p.match(/^\/(\d+)$/);
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const st = letzterStand(x.id);
      return json(res, 200, { id: x.id, titel: x.title, ordner: hwIntern.ordnerName(x.title) || `Projekt ${x.id}`, anleitung: anleitung(x), anfrage: anfrageText(x), arbeitsstand: (w => w ? { stand: w.stand, letzteSitzung: w.letzteSitzung, notizen: w.notizen, fragen: w.fragen.map(f => ({ id: f.id, text: f.text, status: f.status, antwort: f.antwort })) } : null)(workspaceLesen(x.id)),
        stand: st ? { id: st.id, version: st.version, titel: st.title, einstieg: st.entry, veroeffentlicht: st.state === null, dateien: dateienVon(st.token) } : null });
    }
    mm = p.match(/^\/(\d+)\/datei\/(\d+)$/);
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const st = db.prepare("SELECT token FROM prototypes WHERE id = ? AND project_id = ?").get(+mm[2], x.id), rel = safeRel(String(url.searchParams.get("pfad") || ""));
      if (!st || !rel) return json(res, 404, { error: "Datei nicht gefunden" });
      const basis = path.join(PROTO_DIR, st.token), datei = path.join(basis, rel);
      if (!datei.startsWith(basis + path.sep) || !fs.existsSync(datei)) return json(res, 404, { error: "Datei nicht gefunden" });
      return send(res, 200, fs.readFileSync(datei), { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" });
    }
    // Neuer Stand vom Rechner: Dateien aus website/ → neue Version (wie beim täglichen Stand)
    mm = p.match(/^\/(\d+)\/stand$/);
    if (mm && m === "POST") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      if (x.status === "abgeschlossen") return json(res, 409, { error: "Das Projekt ist abgeschlossen – keine neuen Stände mehr." });
      const d = await readJson(req, Math.ceil(MAX_BYTES * 1.4) + 1e6), files = []; let bytes = 0;
      for (const f of (Array.isArray(d.files) ? d.files : []).slice(0, MAX_FILES)) {
        const rel = safeRel(f.path); if (!rel || !PROTO_MIME[path.extname(rel).toLowerCase()]) continue;
        const buf = Buffer.from(String(f.data || ""), "base64"); bytes += buf.length;
        if (bytes > MAX_BYTES) return json(res, 400, { error: "Zusammen größer als 60 MB – bitte Bilder verkleinern." });
        files.push({ path: rel, buf });
      }
      const r = await publish(db.prepare("SELECT * FROM projects WHERE id = ?").get(x.id), files, { changes: d.changes, announce: d.announce !== false, mail: d.mail === undefined ? undefined : d.mail !== false, source: "bruecke", author: clean(d.author, 80) || "Team Reeder", kandidat: d.freigabe === true });
      // Von Claude als umgesetzt gemeldete Anmerkungen: sofort abhaken, wenn die Version gleich online ist – sonst erst bei der Freigabe
      const ids = [...new Set((Array.isArray(d.erledigt) ? d.erledigt : []).map(Number).filter(Number.isInteger))].slice(0, 200);
      if (r.candidate) db.prepare("UPDATE prototypes SET erledigt_ids = ? WHERE id = ?").run(JSON.stringify(ids), r.id);
      const erledigt = r.published ? anmerkungenErledigen(x.id, ids, r.version) : 0;
      if (r.published) phaseNachziehen(x.id);
      return json(res, r.published || r.candidate ? 201 : 200, { ...r, erledigt, gemeldet: ids.length });
    }
    mm = p.match(/^\/(\d+)\/anmerkungen$/);
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      return json(res, 200, { stempel: anmerkungenStempel(x.id), text: anmerkungenText(x.id), anleitung: anleitung(x) });
    }
    // Prüfbericht aus pruefbericht.json (Claude prüft die Website selbst in allen Größen)
    mm = p.match(/^\/(\d+)\/pruefbericht$/);
    if (mm && m === "POST") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const daten = berichtSaeubern(await readJson(req, 256 * 1024));
      const bezug = wartend(x.id) || letzterStand(x.id);
      const r = db.prepare("INSERT INTO pruefberichte(project_id, prototype_id, version, daten) VALUES(?, ?, ?, ?)").run(x.id, bezug?.id ?? null, bezug?.version ?? null, JSON.stringify(daten));
      return json(res, 200, { ok: true, id: Number(r.lastInsertRowid), offen: daten.funde.filter(f => f.status === "offen").length });
    }
    // Arbeitsstand aus arbeitsstand.json: Stand, letzte Sitzung, Notizen, Fragen an den Kunden
    mm = p.match(/^\/(\d+)\/arbeitsstand$/);
    if (mm && m === "POST") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const s = workspaceSpeichern(x.id, await readJson(req, 512 * 1024));
      // „anders“: Im Board wurden Fragen angelegt, beantwortet oder gelöscht, die in Claudes Datei noch fehlen – die Brücke schreibt sie zurück
      return json(res, 200, { ok: true, fragen: s.gemischt.fragen.filter(f => f.status === "offen").length, anders: s.anders, stempel: s.stempel, daten: workspaceFuerBruecke(x.id)?.daten });
    }
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      return json(res, 200, workspaceFuerBruecke(x.id) || { daten: null, stempel: "" });
    }
    return json(res, 404, { error: "Unbekannt" });
  }
  return { admin, publicRoute };
}
