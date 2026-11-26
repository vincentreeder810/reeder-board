// Onboarding für Software- und Hardware-Anfragen.
// Nach der Terminbuchung bekommt der Interessent einen Link zu einem kurzen Fragebogen (portal/onboarding.html).
// Sobald er ihn abschickt, entsteht je Bereich ein Projekt im Status "anfrage" mit den Antworten darin.
// Ein KI-Entwurf wird hier bewusst NICHT gebaut – das gibt es nur beim Website-Fragebogen (vorab.mjs).
//
// Die Fragen stehen in FRAGEN. Die Seite zeichnet sie aus dieser Beschreibung, das Board zeigt die Antworten damit an.
// Wer Fragen, Antwortmöglichkeiten oder Budgetstufen ändern will, ändert sie nur hier.
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { projektnamenPflegen, anfrageBeschreiben } from "./projektname.mjs";
import { hardwareKonzeptAnlegen, hardwareDateiOrdner, hardwareKonzeptFelder } from "./hardware.mjs";

const DATA = path.resolve(process.env.DATA_DIR || "data");
const DIR = path.join(DATA, "onboarding");
const DOC_DIR = path.join(DATA, "documents");
const MAX_FILE = 10 * 1024 * 1024;
const DATEI_TYPEN = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

db.exec(`CREATE TABLE IF NOT EXISTS onboarding (
  id INTEGER PRIMARY KEY, booking_id INTEGER, client_id INTEGER, token TEXT UNIQUE NOT NULL,
  kinds TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'eingeladen', answers TEXT, files TEXT, project_ids TEXT,
  invited_at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT
)`);

export const BEREICHE = { software: "Software", hardware: "Hardware" };

/* Jeder Eintrag ist ein Bildschirm mit einem oder mehreren Feldern.
   art: text | lang | wahl (eine Antwort) | mehr (mehrere, optional max) | datei
   schau: Name einer animierten Darstellung auf der Seite (groesse, geraete, inhalt)
   wenn:  Bildschirm erscheint nur, wenn das genannte Feld einen der Werte hat */
export const FRAGEN = {
  hardware: [
    { frage: "Ihre Idee in zwei, drei Sätzen", hilfe: "So, wie Sie es einem Freund erzählen würden.",
      felder: [{ id: "idee", art: "lang", pflicht: true, platz: "Zum Beispiel: Eine Matratzenauflage, die im Sommer mit Wasser kühlt." }] },
    { frage: "Was gibt es schon?", hilfe: "Jeder Stand ist in Ordnung.",
      felder: [{ id: "stand", art: "wahl", optionen: [["idee", "Nur die Idee"], ["skizze", "Eine Skizze oder Zeichnung"], ["muster", "Ein selbstgebautes Muster"], ["produkt", "Ein Produkt, das besser werden soll"]] },
        { id: "datei", art: "datei", label: "Skizze oder Foto hochladen (freiwillig)" }] },
    { frage: "Wer benutzt es, und wo?", hilfe: "Mehrere Antworten möglich.",
      felder: [{ id: "ort", art: "mehr", optionen: [["drinnen", "Drinnen"], ["draussen", "Draußen"], ["werkstatt", "Werkstatt oder Industrie"], ["koerper", "Am Körper"], ["medizin", "Im medizinischen Umfeld"]] },
        { id: "nutzer", art: "text", label: "Wer benutzt es?", platz: "Zum Beispiel: Privatkunden, jede Nacht im Schlafzimmer." }] },
    { frage: "Wie groß ungefähr?", hilfe: "Eine grobe Vorstellung reicht.", schau: "groesse",
      felder: [{ id: "groesse", art: "wahl", optionen: [["hand", "Passt in die Hand"], ["tisch", "Passt auf den Tisch"], ["moebel", "So groß wie ein Möbelstück"], ["gross", "Größer"]] },
        { id: "masse", art: "text", label: "Genaue Maße, falls bekannt", platz: "Zum Beispiel: 90 × 200 cm, höchstens 2 cm dick." }] },
    { frage: "Was steckt drin?", hilfe: "Tippen Sie an, was vermutlich dazugehört.", schau: "inhalt",
      felder: [{ id: "inhalt", art: "mehr", optionen: [["mechanik", "Mechanik"], ["elektronik", "Elektronik und Sensoren"], ["motor", "Motoren, Bewegung"], ["medien", "Wasser, Luft oder Wärme"], ["strom", "Akku oder Stromanschluss"], ["app", "App oder Software"], ["unklar", "Weiß ich noch nicht"]] }] },
    { frage: "Was ist am wichtigsten?", hilfe: "Höchstens drei.",
      felder: [{ id: "wichtig", art: "mehr", max: 3, optionen: [["guenstig", "Günstig"], ["leise", "Leise"], ["robust", "Robust"], ["klein", "Klein und leicht"], ["schoen", "Schön"], ["sicher", "Sicher"], ["einfach", "Einfach zu bedienen"], ["langlebig", "Langlebig"]] }] },
    { frage: "Was darf auf keinen Fall passieren?", hilfe: "Das hilft uns, Risiken früh zu sehen.",
      felder: [{ id: "nogo", art: "lang", platz: "Zum Beispiel: Es darf kein Wasser ins Bett laufen." }] },
    { frage: "Wie viele sollen es werden?", hilfe: "",
      felder: [{ id: "stueckzahl", art: "wahl", optionen: [["eins", "Ein Einzelstück"], ["kleinserie", "Erst ein Prototyp, dann eine Kleinserie"], ["serie", "Eine Serie"], ["offen", "Weiß ich noch nicht"]] }] },
    { frage: "In welchem Rahmen bewegen wir uns?", hilfe: "Grobe Angaben genügen.",
      felder: [{ id: "budget", art: "wahl", label: "Budget für Konzept und Prototyp", optionen: [["bis1", "bis 1.000 €"], ["bis5", "1.000 – 5.000 €"], ["bis20", "5.000 – 20.000 €"], ["mehr", "mehr als 20.000 €"], ["offen", "noch offen"]] },
        { id: "zeit", art: "text", label: "Bis wann?", platz: "Zum Beispiel: Prototyp bis zum Sommer." }] },
    { frage: "Was brauchen Sie von uns?", hilfe: "",
      felder: [{ id: "bedarf", art: "wahl", optionen: [["machbarkeit", "Klären, ob es machbar ist"], ["konzept", "Ein ausgearbeitetes Entwicklungskonzept"], ["prototyp", "Den Prototyp bauen"], ["alles", "Alles zusammen"]] },
        { id: "sonst", art: "lang", label: "Möchten Sie uns noch etwas mitgeben?", platz: "" }] },
  ],
  software: [
    { frage: "Was soll entstehen?", hilfe: "Wählen Sie, was am besten passt.",
      felder: [{ id: "art", art: "wahl", pflicht: true, optionen: [["webapp", "Web-App oder Kundenportal"], ["app", "App fürs Smartphone"], ["praxis", "Praxis- oder Patientensystem"], ["telefon", "Telefonassistent, der Anrufe annimmt"], ["ki", "KI, die uns Arbeit abnimmt"], ["anpassen", "Bestehende Software verbessern"], ["offen", "Weiß ich noch nicht"]] }] },
    { frage: "Was soll sie können?", hilfe: "Zwei, drei Sätze reichen.",
      felder: [{ id: "kann", art: "lang", pflicht: true, platz: "Zum Beispiel: Patienten sollen online Termine buchen und vorab einen Fragebogen ausfüllen." }] },
    { frage: "Wie läuft es heute?", hilfe: "",
      felder: [{ id: "heute", art: "wahl", optionen: [["papier", "Auf Papier"], ["excel", "Mit Excel oder Listen"], ["software", "Mit einer anderen Software"], ["garnicht", "Noch gar nicht"]] },
        { id: "nervt", art: "text", label: "Was nervt daran am meisten?", platz: "Zum Beispiel: Wir tippen alles doppelt ab." }] },
    { frage: "Wer benutzt sie?", hilfe: "",
      felder: [{ id: "nutzer", art: "wahl", optionen: [["team", "Wir im Team"], ["kunden", "Unsere Kunden oder Patienten"], ["beide", "Beide"]] },
        { id: "anzahl", art: "wahl", label: "Wie viele Personen ungefähr?", optionen: [["5", "1 – 5"], ["20", "6 – 20"], ["100", "21 – 100"], ["mehr", "mehr"]] }] },
    { frage: "Auf welchen Geräten?", hilfe: "Mehrere Antworten möglich.", schau: "geraete",
      felder: [{ id: "geraete", art: "mehr", optionen: [["computer", "Computer"], ["tablet", "Tablet"], ["handy", "Smartphone"]] }] },
    { frage: "Was ist besonders wichtig?", hilfe: "Tippen Sie an, was dabei sein soll.",
      felder: [{ id: "funktionen", art: "mehr", optionen: [["termine", "Termine buchen"], ["konto", "Kundenkonto mit Anmeldung"], ["zahlung", "Bezahlen"], ["dokumente", "Dokumente hochladen"], ["nachrichten", "Nachrichten"], ["auswertung", "Auswertungen"], ["assistent", "KI-Assistent"], ["hinweise", "Erinnerungen"]] },
        { id: "funktionen_frei", art: "text", label: "Etwas anderes?", platz: "" }] },
    { frage: "Womit muss sie zusammenarbeiten?", hilfe: "Programme, die Sie schon nutzen.",
      felder: [{ id: "systeme", art: "mehr", optionen: [["kalender", "Kalender"], ["buchhaltung", "Buchhaltung"], ["praxissoftware", "Praxissoftware"], ["shop", "Online-Shop"], ["telefon", "Telefonanlage"], ["nichts", "Mit nichts"]] },
        { id: "systeme_frei", art: "text", label: "Welche genau?", platz: "Zum Beispiel: Outlook, DATEV." }] },
    { frage: "Welche Daten sind im Spiel?", hilfe: "Davon hängt ab, wie wir sie schützen.",
      felder: [{ id: "daten", art: "mehr", optionen: [["gesundheit", "Gesundheitsdaten"], ["zahlung", "Zahlungsdaten"], ["kunden", "Kundendaten"], ["keine", "Nichts Sensibles"]] }] },
    // Zusatzfragen je nach Antwort auf "Was soll entstehen?"
    { wenn: { feld: "art", ist: ["telefon"] }, frage: "Zu Ihrem Telefonassistenten", hilfe: "",
      felder: [{ id: "tel_anrufe", art: "wahl", label: "Wie viele Anrufe am Tag?", optionen: [["10", "bis 10"], ["50", "10 – 50"], ["mehr", "mehr als 50"]] },
        { id: "tel_aufgaben", art: "mehr", label: "Was soll er erledigen?", optionen: [["termine", "Termine vergeben"], ["fragen", "Fragen beantworten"], ["weiter", "Weiterleiten"], ["rueckruf", "Rückruf notieren"]] },
        { id: "tel_zeiten", art: "text", label: "Zu welchen Zeiten?", platz: "Zum Beispiel: rund um die Uhr, oder nur außerhalb der Sprechzeiten." }] },
    { wenn: { feld: "art", ist: ["ki"] }, frage: "Zu Ihrem Ablauf", hilfe: "",
      felder: [{ id: "ki_ablauf", art: "lang", label: "Welcher Ablauf kostet am meisten Zeit?", platz: "Zum Beispiel: Angebote aus E-Mails zusammenstellen." },
        { id: "ki_oft", art: "wahl", label: "Wie oft kommt er vor?", optionen: [["taeglich", "Täglich"], ["woche", "Mehrmals pro Woche"], ["selten", "Seltener"]] },
        { id: "ki_daten", art: "text", label: "Mit welchen Dokumenten oder Daten?", platz: "Zum Beispiel: PDFs, E-Mails, Tabellen." }] },
    { wenn: { feld: "art", ist: ["praxis"] }, frage: "Zu Ihrer Praxis", hilfe: "",
      felder: [{ id: "px_fach", art: "text", label: "Welche Fachrichtung?", platz: "Zum Beispiel: Physiotherapie." },
        { id: "px_behandler", art: "wahl", label: "Wie viele Behandler?", optionen: [["1", "1"], ["5", "2 – 5"], ["mehr", "mehr als 5"]] },
        { id: "px_software", art: "text", label: "Welche Praxissoftware nutzen Sie heute?", platz: "" }] },
    { wenn: { feld: "art", ist: ["anpassen"] }, frage: "Zur bestehenden Software", hilfe: "",
      felder: [{ id: "an_welche", art: "text", label: "Welche Software ist es?", platz: "" },
        { id: "an_wer", art: "text", label: "Wer hat sie gebaut?", platz: "Zum Beispiel: eine Agentur, ein früherer Mitarbeiter." },
        { id: "an_code", art: "wahl", label: "Haben Sie Zugriff auf den Quelltext?", optionen: [["ja", "Ja"], ["nein", "Nein"], ["unklar", "Weiß ich nicht"]] }] },
    { frage: "In welchem Rahmen bewegen wir uns?", hilfe: "Grobe Angaben genügen.",
      felder: [{ id: "budget", art: "wahl", label: "Budget", optionen: [["bis5", "bis 5.000 €"], ["bis15", "5.000 – 15.000 €"], ["bis50", "15.000 – 50.000 €"], ["mehr", "mehr als 50.000 €"], ["offen", "noch offen"]] },
        { id: "modell", art: "wahl", label: "Welches Modell interessiert Sie?", optionen: [["festpreis", "Festpreis"], ["signature", "Signature – ohne Entwicklungskosten"], ["offen", "Beraten Sie mich"]] },
        { id: "zeit", art: "text", label: "Bis wann?", platz: "Zum Beispiel: Start im Januar." }] },
    { frage: "Vorbilder und Unterlagen", hilfe: "Alles, was uns ein Bild gibt.",
      felder: [{ id: "vorbild", art: "text", label: "Gibt es etwas, das Ihnen gefällt?", platz: "Zum Beispiel: ein Link oder der Name einer App." },
        { id: "datei", art: "datei", label: "Datei hochladen (freiwillig)" },
        { id: "sonst", art: "lang", label: "Möchten Sie uns noch etwas mitgeben?", platz: "" }] },
  ],
};

/** Kurze Namen für Projekttitel und Projektart */
const ART_KURZ = { webapp: "Web-App", app: "App", praxis: "Praxissystem", telefon: "Telefonassistent", ki: "KI-Automatisierung", anpassen: "Software-Anpassung", offen: "Software" };
const felder = bereich => FRAGEN[bereich].flatMap(s => s.felder);
const optionsText = (f, wert) => (f.optionen.find(o => o[0] === wert) || [])[1] || "";
/** Antwort eines Feldes als lesbarer Text ("" wenn leer) */
function lesbar(f, a) {
  const w = a?.[f.id];
  if (f.art === "wahl") return optionsText(f, w);
  if (f.art === "mehr") return (Array.isArray(w) ? w : []).map(x => optionsText(f, x)).filter(Boolean).join(", ");
  if (f.art === "datei") return "";
  return String(w || "").trim();
}
/** Antworten gegliedert fürs Board – dieselbe Form wie beim Website-Fragebogen */
/** Stand des Fragebogens eines Kontakts: "ausgefuellt", "offen" (verschickt, noch nicht ausgefüllt) oder null (nie verschickt) */
/** Stand des Fragebogens: "ausgefuellt" | "offen" | null (keiner verschickt).
 *  Mit bookingId zählt nur der Fragebogen zu genau dieser Buchung – ein früher ausgefüllter Fragebogen gilt nicht für einen neuen Termin.
 *  Ohne bookingId zählt der zuletzt verschickte Fragebogen des Kontakts. */
export function fragebogenStand(clientId, bookingId = null) {
  const alle = [];
  try { for (const o of db.prepare("SELECT o.status, o.invited_at, o.booking_id FROM onboarding o LEFT JOIN bookings bb ON bb.id = o.booking_id WHERE o.client_id = ? OR bb.client_id = ?").all(clientId, clientId))
    alle.push({ fertig: o.status === "ausgefuellt", zeit: o.invited_at || "", buchung: o.booking_id }); } catch {}
  try { for (const v of db.prepare("SELECT v.answered_at, v.invited_at, v.booking_id FROM vorab v LEFT JOIN bookings bb ON bb.id = v.booking_id WHERE v.client_id = ? OR bb.client_id = ?").all(clientId, clientId))
    alle.push({ fertig: !!v.answered_at, zeit: v.invited_at || "", buchung: v.booking_id }); } catch {}
  if (bookingId) { const l = alle.filter(x => x.buchung === bookingId); return l.length ? (l.every(x => x.fertig) ? "ausgefuellt" : "offen") : null; }
  if (!alle.length) return null;
  alle.sort((x, y) => String(y.zeit).localeCompare(String(x.zeit)));
  return alle[0].fertig ? "ausgefuellt" : "offen";
}

export function antwortenView(bereich, a) {
  return FRAGEN[bereich].map(s => ({ title: s.frage, rows: s.felder.map(f => {
    const w = a?.[f.id];
    if (f.art === "mehr") { const chips = (Array.isArray(w) ? w : []).map(x => optionsText(f, x)).filter(Boolean); return chips.length ? { k: f.label || "Auswahl", chips } : null; }
    const v = lesbar(f, a); return v ? { k: f.label || "Antwort", v } : null;
  }).filter(Boolean) })).filter(g => g.rows.length);
}

// Der Website-Fragebogen liegt in vorab.mjs und wird beim Start des Servers hier eingehängt
let vorabEinladen = null;
export const setVorabEinladen = fn => { vorabEinladen = fn; };

export function createOnboarding({ json, readJson, clean, limited, ipOf, SITE_URL, hashPw, checkPw, currentClient, clientLogin }) {
  const out = o => o && ({ id: o.id, status: o.status, kinds: JSON.parse(o.kinds), invited_at: o.invited_at, answered_at: o.answered_at,
    link: `${SITE_URL}/portal/onboarding.html#${o.token}` });

  /** Nach der Buchung: Fragebogen für die gewählten Bereiche verschicken */
  async function invite(b, kinds) {
    kinds = kinds.filter(k => FRAGEN[k]);
    if (!kinds.length || db.prepare("SELECT 1 FROM onboarding WHERE booking_id = ?").get(b.id)) return null;
    const token = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO onboarding(booking_id, client_id, token, kinds) VALUES(?,?,?,?)").run(b.id, b.client_id || null, token, JSON.stringify(kinds));
    const link = `${SITE_URL}/portal/onboarding.html#${token}`;
    const cfg = getSetting("mail", DEFAULT_MAIL);
    await sendMail({ to: b.email, subject: "Damit wir uns gut vorbereiten können – ein paar Fragen zu Ihrem Vorhaben",
      text: `Hallo ${b.name},\n\nwir freuen uns auf unser Gespräch! Damit wir die Zeit bestmöglich nutzen, haben wir ein paar Fragen zu Ihrem Vorhaben vorbereitet (${kinds.map(k => BEREICHE[k]).join(" und ")}). Das dauert etwa fünf Minuten – das meiste tippen Sie einfach an.\n\n${link}\n\nZuerst legen Sie dort mit einem Passwort Ihren persönlichen Bereich an. Dort finden Sie später auch Termine, Unterlagen und unser Angebot.\n\nSie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch.\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` });
    return token;
  }

  /** Projekt je Bereich im Status "anfrage" anlegen – einmalig beim ersten Abschicken */
  function projekteAnlegen(o, antworten, dateien) {
    const b = o.booking_id ? db.prepare("SELECT * FROM bookings WHERE id = ?").get(o.booking_id) : null;
    const cid = o.client_id || b?.client_id; if (!cid) return [];
    const kunde = db.prepare("SELECT company, name FROM clients WHERE id = ?").get(cid) || {};
    const wer = kunde.company || kunde.name || b?.name || "Interessent";
    const ids = [];
    for (const bereich of JSON.parse(o.kinds)) {
      const a = antworten[bereich] || {}, f = Object.fromEntries(felder(bereich).map(x => [x.id, x])), t = id => lesbar(f[id], a);
      const kurz = (bereich === "hardware" ? t("idee") : t("kann")) || "";
      const art = ART_KURZ[a.art] || "Software";
      const titel = clean(bereich === "hardware" ? (kurz.split(/[.!?\n]/)[0] || "Hardware-Anfrage") : `${art} für ${wer}`, 110) || "Anfrage";
      // Das Projekt gibt es seit der Buchung schon (anfragen.mjs). Der Fragebogen füllt es mit Titel und Beschreibung.
      const da = o.booking_id ? db.prepare("SELECT id FROM projects WHERE booking_id = ? AND anfrage_art = ? AND status = 'anfrage'").get(o.booking_id, bereich) : null;
      let pid;
      if (da) { pid = da.id; db.prepare("UPDATE projects SET title = ?, kind = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(titel, bereich === "hardware" ? "Hardware" : art, clean(kurz, 4000), pid); }
      else pid = Number(db.prepare("INSERT INTO projects(client_id, title, kind, description, phase, status, bereich, booking_id, anfrage_art) VALUES(?, ?, ?, ?, 'Erstgespräch', 'anfrage', ?, ?, ?)")
        .run(cid, titel, bereich === "hardware" ? "Hardware" : art, clean(kurz, 4000), bereich, o.booking_id || null, bereich).lastInsertRowid);
      db.prepare("INSERT INTO events(client_id, project_id, kind, title, detail, notify) VALUES(?, ?, 'projekt', ?, ?, 0)").run(cid, pid, "Onboarding ausgefüllt", clean(kurz, 600));
      const eigene = (dateien || []).filter(d => d.bereich === bereich);
      if (bereich === "hardware") {
        // Die Antworten füllen den Steckbrief in Schritt 1 des Hardware-Projekts
        const zeilen = (...paare) => paare.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
        hardwareKonzeptAnlegen(pid, { name: titel, kurzbeschreibung: kurz, steckbrief: {
          zweck: [kurz, zeilen(["Schon vorhanden", t("stand")], ["Enthält vermutlich", t("inhalt")], ["Gewünscht von uns", t("bedarf")], ["Außerdem", t("sonst")])].filter(Boolean).join("\n\n"),
          nutzer: zeilen(["Wer", t("nutzer")], ["Wo", t("ort")]),
          groesse: [t("groesse"), t("masse")].filter(Boolean).join(" – "),
          budget: zeilen(["Budget", t("budget")], ["Zeitrahmen", t("zeit")]),
          stueckzahl: t("stueckzahl"),
          wichtig: zeilen(["Am wichtigsten", t("wichtig")], ["Darf nicht passieren", t("nogo")]),
        } });
        for (const d of eigene) { try { fs.mkdirSync(hardwareDateiOrdner(pid), { recursive: true }); fs.copyFileSync(path.join(DIR, String(o.id), d.datei), path.join(hardwareDateiOrdner(pid), d.name)); } catch { /* Datei fehlt – Projekt entsteht trotzdem */ } }
      } else {
        for (const d of eigene) {
          try {
            const tk = randomBytes(24).toString("hex"); fs.mkdirSync(DOC_DIR, { recursive: true });
            fs.copyFileSync(path.join(DIR, String(o.id), d.datei), path.join(DOC_DIR, tk));
            db.prepare("INSERT INTO documents(client_id, project_id, kind, title, file_token, file_name, mime, bytes) VALUES(?,?,?,?,?,?,?,?)")
              .run(cid, pid, "Sonstiges", "Unterlage aus dem Onboarding", tk, d.name, DATEI_TYPEN[path.extname(d.name).toLowerCase()] || "application/octet-stream", d.bytes);
          } catch { /* ohne Datei weiter */ }
        }
      }
      ids.push(pid);
      // KI: kurzer Name und Zusammenfassung; bei Hardware stehen beide auch im Konzept
      anfrageBeschreiben(pid, kurz).then(r => { if (r && bereich === "hardware") hardwareKonzeptFelder(pid, { name: r.name, ...(r.zusammenfassung ? { kurzbeschreibung: r.zusammenfassung } : {}) }); }).catch(() => {});
    }
    return ids;
  }

  /** Öffentlich: /api/onboarding/:token (GET Fragen und Stand, POST Antworten) und …/datei (Upload) */
  async function publicRoute(req, res, url) {
    const m = url.pathname.match(/^\/api\/onboarding\/([a-f0-9]{48})(\/datei|\/konto|\/anmelden)?$/);
    if (!m) return null;
    if (limited("ob:" + ipOf(req), 120, 3600000)) return json(res, 429, { error: "Zu viele Anfragen – bitte später erneut versuchen." });
    const o = db.prepare("SELECT * FROM onboarding WHERE token = ?").get(m[1]);
    if (!o) return json(res, 404, { error: "Dieser Link ist nicht gültig." });
    const kinds = JSON.parse(o.kinds);
    const b = o.booking_id ? db.prepare("SELECT name, company, start, client_id FROM bookings WHERE id = ?").get(o.booking_id) : null;
    // Kundenkonto: Der Link aus der Mail belegt die Adresse; vor den Fragen legt der Kontakt nur noch ein Passwort fest
    // (wie beim Website-Fragebogen, vorab.mjs). Ohne zugeordneten Kontakt bleibt der Fragebogen offen wie bisher.
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(o.client_id || b?.client_id || 0) || null;
    const angemeldet = !c || (currentClient && currentClient(req)?.id === c.id);
    if (m[2] === "/konto" || m[2] === "/anmelden") {
      if (req.method !== "POST" || !c) return json(res, 405, { error: "Nicht erlaubt" });
      const d = await readJson(req);
      if (m[2] === "/konto") {
        if (c.pw_hash) return json(res, 409, { error: "Für diese E-Mail-Adresse gibt es schon ein Konto – bitte melden Sie sich an." });
        if (String(d.password || "").length < 10) return json(res, 400, { error: "Das Passwort braucht mindestens 10 Zeichen." });
        if (d.consent !== true) return json(res, 400, { error: "Bitte bestätigen Sie die Datenschutzhinweise." });
        db.prepare("UPDATE clients SET pw_hash = ?, invite_token = NULL, invite_expires = NULL, active = 1 WHERE id = ?").run(hashPw(String(d.password)), c.id);
        return clientLogin(res, c.id);
      }
      if (limited("ob-login:" + ipOf(req), 8, 15 * 60000)) return json(res, 429, { error: "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen." });
      if (!c.pw_hash || !checkPw(String(d.password || ""), c.pw_hash)) return json(res, 401, { error: "Das Passwort stimmt nicht." });
      return clientLogin(res, c.id);
    }
    if (!angemeldet && (m[2] || req.method === "POST")) return json(res, 401, { error: "Bitte legen Sie zuerst Ihr Konto an bzw. melden Sie sich an." });

    if (m[2]) {   // Datei hochladen (Skizze, Foto, PDF)
      if (req.method !== "POST") return json(res, 405, { error: "Nicht erlaubt" });
      const d = await readJson(req, Math.ceil(MAX_FILE * 1.4));
      const name = path.basename(String(d.name || "")).replace(/[^\w .()\-äöüÄÖÜß]/g, "_").replace(/^\.+/, "").slice(0, 100) || "datei";
      const ext = path.extname(name).toLowerCase();
      if (!DATEI_TYPEN[ext]) return json(res, 400, { error: "Bitte ein Bild (PNG, JPG, WebP) oder ein PDF hochladen." });
      const buf = Buffer.from(String(d.data || ""), "base64");
      if (!buf.length || buf.length > MAX_FILE) return json(res, 413, { error: "Die Datei darf höchstens 10 MB groß sein." });
      const liste = JSON.parse(o.files || "[]");
      if (liste.length >= 6) return json(res, 400, { error: "Es sind höchstens sechs Dateien möglich." });
      const datei = randomBytes(8).toString("hex") + ext;
      fs.mkdirSync(path.join(DIR, String(o.id)), { recursive: true });
      fs.writeFileSync(path.join(DIR, String(o.id), datei), buf);
      liste.push({ bereich: kinds.includes(d.bereich) ? d.bereich : kinds[0], name, datei, bytes: buf.length });
      db.prepare("UPDATE onboarding SET files = ? WHERE id = ?").run(JSON.stringify(liste), o.id);
      return json(res, 201, { name });
    }

    if (req.method === "GET")
      return json(res, 200, { name: b?.name || "", firma: b?.company || "", termin: b?.start || null, status: o.status,
        konto: c ? (c.pw_hash ? "vorhanden" : "neu") : null, angemeldet, email: c?.email || "", bereiche: kinds.map(k => ({ id: k, name: BEREICHE[k], fragen: FRAGEN[k] })),
        antworten: o.answers ? JSON.parse(o.answers) : {}, dateien: JSON.parse(o.files || "[]").map(d => ({ bereich: d.bereich, name: d.name })) });

    if (req.method === "POST") {
      const d = await readJson(req, 200 * 1024), antworten = {};
      // Nur bekannte Felder übernehmen, Länge begrenzen
      for (const k of kinds) {
        antworten[k] = {};
        for (const f of felder(k)) {
          const w = d.antworten?.[k]?.[f.id];
          if (f.art === "mehr") antworten[k][f.id] = (Array.isArray(w) ? w : []).filter(x => f.optionen.some(o2 => o2[0] === x)).slice(0, f.max || 20);
          else if (f.art === "wahl") antworten[k][f.id] = f.optionen.some(o2 => o2[0] === w) ? w : "";
          else if (f.art !== "datei") antworten[k][f.id] = clean(w, 2000);
        }
      }
      const fertig = !!d.fertig;
      db.prepare("UPDATE onboarding SET answers = ?" + (fertig ? ", status = 'ausgefuellt', answered_at = datetime('now')" : "") + " WHERE id = ?").run(JSON.stringify(antworten), o.id);
      if (!fertig) return json(res, 200, { ok: true });
      let ids = JSON.parse(o.project_ids || "[]");
      if (!ids.length) {
        ids = projekteAnlegen(o, antworten, JSON.parse(db.prepare("SELECT files FROM onboarding WHERE id = ?").get(o.id).files || "[]"));
        projektnamenPflegen().catch(() => {});   // gleich einen kurzen Projektnamen vergeben
        db.prepare("UPDATE onboarding SET project_ids = ? WHERE id = ?").run(JSON.stringify(ids), o.id);
        const cfg = getSetting("mail", DEFAULT_MAIL);
        sendMail({ to: cfg.notifyAddress, subject: `Onboarding ausgefüllt: ${b?.name || "Interessent"}${b?.company ? " (" + b.company + ")" : ""}`,
          text: `${b?.name || "Ein Interessent"} hat das Onboarding ausgefüllt (${kinds.map(k => BEREICHE[k]).join(", ")}).\n\n${ids.length ? `Im Board ist dazu ${ids.length === 1 ? "ein Projekt" : ids.length + " Projekte"} im Status „Anfrage“ entstanden:\n${SITE_URL}/admin/#projekte` : "Es konnte kein Projekt angelegt werden, weil kein Kontakt zugeordnet ist."}` }).catch(e => console.warn("Mail:", e.message));
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "Nicht erlaubt" });
  }

  /** Fragebogen noch einmal schicken: offenen Fragebogen erinnern oder, wenn nie einer verschickt wurde, jetzt einladen */
  async function erneutSenden(clientId, kinds) {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId);
    if (!c?.email) return { error: "Zu diesem Kontakt ist keine E-Mail-Adresse hinterlegt." };
    const o = db.prepare("SELECT o.* FROM onboarding o LEFT JOIN bookings b ON b.id = o.booking_id WHERE (o.client_id = ? OR b.client_id = ?) AND o.status != 'ausgefuellt' ORDER BY o.id DESC LIMIT 1").get(clientId, clientId);
    const cfg = getSetting("mail", DEFAULT_MAIL);
    if (o) {
      const link = `${SITE_URL}/portal/onboarding.html#${o.token}`;
      const mailed = await sendMail({ to: c.email, subject: "Kurze Erinnerung: ein paar Fragen zu Ihrem Vorhaben",
        text: `Hallo ${c.name},\n\ndamit wir uns gut auf unser Gespräch vorbereiten können, fehlen uns noch Ihre Antworten auf ein paar Fragen. Das dauert etwa fünf Minuten:\n\n${link}\n\nSie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch.\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` });
      return { mailed: !!mailed, link };
    }
    // Website-Buchung: Dazu gehört der bildhafte Website-Fragebogen (vorab.mjs), nicht die Software-Fragen.
    // Ist er noch offen, geht die Erinnerung an genau diesen Fragebogen.
    const offenWeb = db.prepare("SELECT v.token FROM vorab v JOIN bookings bb ON bb.id = v.booking_id WHERE bb.client_id = ? AND v.answered_at IS NULL ORDER BY v.id DESC LIMIT 1").get(clientId);
    if (offenWeb) {
      const link = `${SITE_URL}/portal/fragebogen.html#${offenWeb.token}`;
      const mailed = await sendMail({ to: c.email, subject: "Kurze Erinnerung: Ihr Fragebogen zur Website",
        text: `Hallo ${c.name},\n\ndamit wir uns gut auf unser Gespräch vorbereiten können, fehlen uns noch Ihre Angaben zur Website. Sie klicken einfach an, was Ihnen gefällt – das dauert etwa sechs Minuten:\n\n${link}\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` });
      return { mailed: !!mailed, link };
    }
    const b = db.prepare("SELECT * FROM bookings WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(clientId);
    // Wurde bei der Buchung nur „Website“ gewählt, wird nie der Software-Fragebogen verschickt
    const themen = (String(b?.message || "").match(/^Themen: (.*)$/m) || [])[1] || "";
    if (b && /website/i.test(themen) && !/software|hardware/i.test(themen)) {
      const t = vorabEinladen ? await vorabEinladen(b) : null;
      return t ? { mailed: null, link: `${SITE_URL}/portal/fragebogen.html#${t}` } : { error: "Der Website-Fragebogen zu dieser Buchung ist schon ausgefüllt." };
    }
    if (db.prepare("SELECT 1 FROM onboarding o LEFT JOIN bookings b ON b.id = o.booking_id WHERE o.client_id = ? OR b.client_id = ?").get(clientId, clientId)) return { error: "Der Fragebogen ist schon ausgefüllt." };
    if (!b) return { error: "Zu diesem Kontakt gibt es keine Buchung, an die der Fragebogen angehängt werden kann." };
    const token = await invite(b, (kinds || []).filter(k => FRAGEN[k]).length ? kinds : ["software"]);
    return token ? { mailed: null, link: `${SITE_URL}/portal/onboarding.html#${token}` } : { error: "Der Fragebogen ließ sich nicht verschicken." };
  }

  /** Board: Onboardings eines Kontakts mit gegliederten Antworten */
  async function admin(req, res, p, m) {
    const me = p.match(/^\/onboarding\/kunde\/(\d+)\/erneut$/);
    if (me && m === "POST") { const d = await readJson(req), r = await erneutSenden(+me[1], Array.isArray(d.kinds) ? d.kinds : null); return json(res, r.error ? 400 : 200, r); }
    const mm = p.match(/^\/onboarding\/kunde\/(\d+)$/);
    if (!mm || m !== "GET") return null;
    const rows = db.prepare("SELECT o.* FROM onboarding o LEFT JOIN bookings b ON b.id = o.booking_id WHERE o.client_id = ? OR b.client_id = ? ORDER BY o.id DESC").all(+mm[1], +mm[1]);
    return json(res, 200, rows.map(o => {
      const a = o.answers ? JSON.parse(o.answers) : {}, ids = JSON.parse(o.project_ids || "[]");
      return { ...out(o), bereiche: JSON.parse(o.kinds).map(k => ({ id: k, name: BEREICHE[k], antworten: antwortenView(k, a[k]) })),
        dateien: JSON.parse(o.files || "[]").length,
        projekte: ids.map(id => db.prepare("SELECT id, title, bereich, status FROM projects WHERE id = ?").get(id)).filter(Boolean) };
    }));
  }

  return { invite, publicRoute, admin };
}
