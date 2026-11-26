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
import { workspaceSpeichern, workspaceLesen } from "./workspace.mjs";
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
  "stand": "Wo steht das Projekt insgesamt? Drei bis sechs Sätze, ohne Fachwörter.",
  "letzteSitzung": "Was wurde in der letzten Sitzung gemacht und was ist als Nächstes dran?",
  "notizen": ["Entscheidungen, Wünsche des Inhabers, Dinge zum Merken – je ein kurzer Eintrag"],
  "fragen": [
    { "id": "f1", "text": "Frage an den Kunden, so formuliert, dass man sie ihm unverändert schicken kann (Sie-Form)", "status": "offen", "antwort": "" }
  ]
}
\`\`\`

- Fragen: nur was wirklich der Kunde beantworten muss. Jede Frage bekommt eine feste \`id\` (f1, f2 …), die sich nie ändert.
- Ist eine Frage geklärt (der Inhaber nennt dir die Antwort oder sie hat sich erledigt): \`status\` auf \`"geklaert"\` setzen und die Antwort in \`antwort\` eintragen. Sie verschwindet dann im Board aus den offenen Fragen. Alte geklärte Fragen darfst du nach einiger Zeit ganz löschen.
- Keine Zugangsdaten und nichts Vertrauliches hineinschreiben.

## Neuen Stand hochladen

Sagt der Inhaber ausdrücklich, dass du den Stand hochladen sollst („lade den aktuellen Stand hoch“), dann:

1. \`arbeitsstand.json\` aktualisieren.
2. Im Projektordner die Datei \`hochladen.json\` anlegen: \`{ "aenderungen": "Ein, zwei Sätze für den Kunden: Was ist neu?", "kundeBenachrichtigen": false, "erledigteAnmerkungen": [12, 15] }\` – in \`erledigteAnmerkungen\` die Nummern der Anmerkungen aus \`anmerkungen.md\`, die in diesem Stand wirklich umgesetzt sind (sonst leere Liste).
3. Die Brücke lädt den Inhalt von \`website/\` innerhalb weniger Sekunden als neue Version hoch, löscht \`hochladen.json\` und schreibt das Ergebnis in \`hochladen-ergebnis.json\`. Lies diese Datei nach etwa zehn Sekunden und sag dem Inhaber, welche Version jetzt online ist (oder was nicht geklappt hat).

Wichtig: Eine hochgeladene Version ist für den Kunden im Kundenportal sichtbar. \`kundeBenachrichtigen\` nur auf \`true\` setzen, wenn der Inhaber sagt, dass der Kunde eine Nachricht dazu bekommen soll. Nie von dir aus hochladen. Der Inhaber kann auch selbst im Board auf „Neuen Stand hochladen“ drücken.
`;

export function createBrueckeSoftware({ json, send, readJson, clean, publish }) {
  /** Board (nur Inhaber): Aufträge für die Brücke anstoßen – /bruecke/projekt/<id>/(claude|ordner|stand) */
  async function admin(req, res, p, m, user) {
    const mm = p.match(/^\/bruecke\/projekt\/(\d+)\/(claude|ordner|stand)$/); if (!mm || m !== "POST") return null;
    const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (!brueckeEingerichtet()) return json(res, 400, { error: "Dafür braucht es die Brücke auf deinem Rechner. Einrichten unter Einstellungen → Livegang → „Brücke zu Claude“." });
    if (!brueckeVerbunden()) return json(res, 400, { error: "Die Brücke auf deinem Rechner ist gerade nicht verbunden. Bitte dort „Bruecke im Hintergrund starten“ ausführen und noch einmal drücken." });
    const d = await readJson(req, 64 * 1024);
    if (mm[2] === "stand") brueckeAuftrag(x.id, "sw-stand", "", { changes: clean(d.changes, 3000), announce: d.announce !== false, author: user?.name || "Team Reeder" });
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
      const r = await publish(db.prepare("SELECT * FROM projects WHERE id = ?").get(x.id), files, { changes: d.changes, announce: d.announce !== false, source: "bruecke", author: clean(d.author, 80) || "Team Reeder" });
      // Von Claude als umgesetzt gemeldete Anmerkungen abhaken – nur wenn wirklich eine neue Version entstanden ist
      const erledigt = r.published ? anmerkungenErledigen(x.id, d.erledigt, r.version) : 0;
      return json(res, r.published ? 201 : 200, { ...r, erledigt });
    }
    mm = p.match(/^\/(\d+)\/anmerkungen$/);
    if (mm && m === "GET") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      return json(res, 200, { stempel: anmerkungenStempel(x.id), text: anmerkungenText(x.id), anleitung: anleitung(x) });
    }
    // Arbeitsstand aus arbeitsstand.json: Stand, letzte Sitzung, Notizen, Fragen an den Kunden
    mm = p.match(/^\/(\d+)\/arbeitsstand$/);
    if (mm && m === "POST") {
      const x = projekt(+mm[1]); if (!x) return json(res, 404, { error: "Projekt nicht gefunden" });
      const s = workspaceSpeichern(x.id, await readJson(req, 512 * 1024));
      return json(res, 200, { ok: true, fragen: s.fragen.filter(f => f.status === "offen").length });
    }
    return json(res, 404, { error: "Unbekannt" });
  }
  return { admin, publicRoute };
}
