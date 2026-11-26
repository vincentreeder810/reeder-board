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
   thema: kurzes Stichwort über der Frage · warum: Text für „Warum fragen wir das?“
   stil: "karten" = große Auswahlkarten mit Symbol (sonst Chips) · allein: Antworten, die alle anderen abwählen
   optionen: [Wert, Text, kurze Erklärung (nur für Karten, freiwillig)] – Werte nie umbenennen, gespeicherte Antworten hängen daran
   schau: Name einer Vorschau auf der Seite (groesse, geraete, nutzer, umgebung, verbindung, stueck)
   wenn:  Bildschirm erscheint nur, wenn das genannte Feld einen der Werte hat */
export const FRAGEN = {
  hardware: [
    { thema: "Ihre Idee", frage: "Ihre Idee in zwei, drei Sätzen", hilfe: "So, wie Sie es einem Freund erzählen würden.",
      warum: "Mit Ihren eigenen Worten verstehen wir am schnellsten, worum es geht. Fachbegriffe brauchen Sie nicht.",
      felder: [{ id: "idee", art: "lang", pflicht: true, platz: "Zum Beispiel: Eine Matratzenauflage, die im Sommer mit Wasser kühlt." },
        { id: "funktion", art: "mehr", label: "Was soll das Gerät vor allem tun?", optionen: [["messen", "Messen und überwachen"], ["steuern", "Steuern und regeln"], ["bewegen", "Etwas bewegen"], ["anzeigen", "Etwas anzeigen"], ["temperieren", "Kühlen oder wärmen"], ["schuetzen", "Schützen oder sichern"], ["senden", "Daten senden"], ["halten", "Halten, tragen, aufbewahren"], ["anderes", "Etwas anderes"]] }] },
    { thema: "Ausgangslage", frage: "Was gibt es schon?", hilfe: "Jeder Stand ist in Ordnung.",
      warum: "So wissen wir, ob wir bei null anfangen oder auf etwas aufbauen können.",
      felder: [{ id: "stand", art: "wahl", stil: "karten", optionen: [["idee", "Nur die Idee", "Noch nichts Greifbares"], ["skizze", "Eine Skizze oder Zeichnung", "Auf Papier oder am Computer"], ["muster", "Ein selbstgebautes Muster", "Ein erster Versuch zum Anfassen"], ["produkt", "Ein Produkt, das besser werden soll", "Gibt es schon, soll weiterentwickelt werden"]] },
        { id: "datei", art: "datei", label: "Skizze oder Foto hochladen (freiwillig)" }] },
    { thema: "Nutzer", frage: "Wer benutzt es?", hilfe: "Mehrere Antworten möglich.",
      warum: "Ein Gerät für Kinder, für Pflegekräfte oder für die Werkstatt muss jeweils ganz anders gebaut und bedient werden.",
      felder: [{ id: "nutzergruppe", art: "mehr", label: "Für wen ist es gedacht?", optionen: [["privat", "Privatleute"], ["fach", "Fachleute und Handwerk"], ["firmen", "Firmen und Büros"], ["kinder", "Kinder"], ["senioren", "Ältere Menschen"], ["pflege", "Pflege und Medizin"], ["industrie", "Industrie und Produktion"]] },
        { id: "nutzer", art: "text", label: "Wer benutzt es, und wie oft?", platz: "Zum Beispiel: Privatkunden, jede Nacht im Schlafzimmer." }] },
    { thema: "Einsatzort", frage: "Wo wird es eingesetzt?", hilfe: "Tippen Sie alles an, was zutrifft – die Vorschau zeigt es mit.", schau: "umgebung",
      warum: "Wasser, Staub, Hitze oder Kälte entscheiden über Material, Dichtungen und Elektronik – und damit auch über die Kosten.",
      felder: [{ id: "ort", art: "mehr", stil: "karten", optionen: [["drinnen", "Drinnen"], ["draussen", "Draußen"], ["werkstatt", "Werkstatt oder Industrie"], ["koerper", "Am Körper"], ["medizin", "Im medizinischen Umfeld"], ["fahrzeug", "Im Fahrzeug"]] },
        { id: "umgebung", art: "mehr", label: "Was muss es aushalten?", allein: ["normal"], optionen: [["nass", "Nässe oder Regen"], ["wasser", "Untertauchen"], ["staub", "Staub und Schmutz"], ["hitze", "Hitze"], ["kaelte", "Kälte und Frost"], ["sonne", "Pralle Sonne"], ["stoesse", "Stöße und Erschütterungen"], ["chemie", "Reinigungsmittel oder Chemikalien"], ["normal", "Nichts Besonderes"]] },
        { id: "temperatur", art: "text", label: "Temperaturbereich, falls bekannt", platz: "Zum Beispiel: −10 bis +40 °C." }] },
    { thema: "Größe", frage: "Wie groß ungefähr?", hilfe: "Eine grobe Vorstellung reicht.", schau: "groesse",
      warum: "Größe und Gewicht bestimmen, welche Technik hineinpasst und wie es transportiert und verpackt wird.",
      felder: [{ id: "groesse", art: "wahl", stil: "karten", optionen: [["hand", "Passt in die Hand"], ["tisch", "Passt auf den Tisch"], ["moebel", "So groß wie ein Möbelstück"], ["gross", "Größer"]] },
        { id: "gewicht", art: "wahl", label: "Wie schwer darf es sein?", optionen: [["leicht", "unter 500 g"], ["bis5", "bis 5 kg"], ["bis25", "bis 25 kg"], ["schwer", "schwerer"], ["egal", "Egal"]] },
        { id: "masse", art: "text", label: "Genaue Maße, falls bekannt", platz: "Zum Beispiel: 90 × 200 cm, höchstens 2 cm dick." }] },
    { thema: "Technik", frage: "Was steckt drin?", hilfe: "Tippen Sie an, was vermutlich dazugehört.",
      warum: "Daran sehen wir, welche Fachgebiete wir zusammenbringen – Mechanik, Elektronik, Software.",
      felder: [{ id: "inhalt", art: "mehr", stil: "karten", allein: ["unklar"], optionen: [["mechanik", "Mechanik"], ["elektronik", "Elektronik und Sensoren"], ["motor", "Motoren, Bewegung"], ["medien", "Wasser, Luft oder Wärme"], ["strom", "Akku oder Stromanschluss"], ["app", "App oder Software"], ["unklar", "Weiß ich noch nicht"]] }] },
    { thema: "Strom", frage: "Woher bekommt es seinen Strom?", hilfe: "Mehrere Antworten möglich.",
      warum: "Akku oder Steckdose verändern Größe, Gewicht und Preis eines Geräts deutlich.",
      felder: [{ id: "strom", art: "mehr", stil: "karten", allein: ["keiner", "unklar"], optionen: [["steckdose", "Steckdose", "Immer am Netz"], ["akku", "Akku zum Aufladen", "Unterwegs ohne Kabel"], ["batterie", "Wechselbatterien", "Einfach austauschen"], ["solar", "Sonne", "Lädt sich selbst auf"], ["kabel", "Über ein anderes Gerät", "USB, Fahrzeug, Maschine"], ["keiner", "Braucht keinen Strom", "Rein mechanisch"], ["unklar", "Weiß ich noch nicht", ""]] },
        { id: "laufzeit", art: "text", label: "Wie lange soll es ohne Steckdose durchhalten?", platz: "Zum Beispiel: eine Nacht, eine Woche." }] },
    { thema: "Bedienung", frage: "Wie wird es bedient – und womit verbunden?", hilfe: "Die Vorschau zeigt, was Sie wählen.", schau: "verbindung",
      warum: "Ein Knopf, ein Display oder eine App: Davon hängt ab, wie einfach es für Ihre Nutzer wird – und ob wir Funk oder eine App mitentwickeln.",
      felder: [{ id: "bedienung", art: "mehr", label: "Bedienung", optionen: [["tasten", "Tasten oder Schalter"], ["display", "Display oder Touch"], ["app", "Über eine App"], ["sprache", "Per Sprache"], ["fernbedienung", "Fernbedienung"], ["automatisch", "Läuft von selbst"]] },
        { id: "verbindung", art: "mehr", label: "Verbindung", allein: ["keine"], optionen: [["keine", "Keine – es arbeitet für sich"], ["bluetooth", "Bluetooth zum Handy"], ["wlan", "WLAN"], ["mobilfunk", "Mobilfunk (SIM)"], ["kabel", "Kabel oder USB"], ["cloud", "Daten online abrufbar"]] }] },
    { thema: "Prioritäten", frage: "Was ist am wichtigsten?", hilfe: "Höchstens drei.",
      warum: "Alles gleichzeitig geht selten. Ihre drei Punkte sind unser Maßstab bei jeder Entscheidung.",
      felder: [{ id: "wichtig", art: "mehr", max: 3, optionen: [["guenstig", "Günstig"], ["leise", "Leise"], ["robust", "Robust"], ["klein", "Klein und leicht"], ["schoen", "Schön"], ["sicher", "Sicher"], ["einfach", "Einfach zu bedienen"], ["langlebig", "Langlebig"], ["reparierbar", "Nachhaltig und reparierbar"], ["reinigen", "Leicht zu reinigen"]] }] },
    { thema: "Risiken", frage: "Was darf auf keinen Fall passieren?", hilfe: "Das hilft uns, Risiken früh zu sehen.",
      warum: "Wer die schlimmsten Fälle kennt, kann sie von Anfang an ausschließen – statt später teuer nachzubessern.",
      felder: [{ id: "nogo", art: "lang", platz: "Zum Beispiel: Es darf kein Wasser ins Bett laufen." }] },
    { thema: "Stückzahl", frage: "Wie viele sollen es werden?", hilfe: "", schau: "stueck",
      warum: "Ein Einzelstück bauen wir anders als eine Serie – Material, Fertigung und Werkzeuge hängen an der Stückzahl.",
      felder: [{ id: "stueckzahl", art: "wahl", stil: "karten", optionen: [["eins", "Ein Einzelstück", "Für Sie oder einen Kunden"], ["kleinserie", "Erst ein Prototyp, dann eine Kleinserie", "Erst testen, dann in kleiner Stückzahl"], ["serie", "Eine Serie", "In größerer Stückzahl"], ["offen", "Weiß ich noch nicht", "Das klären wir gemeinsam"]] },
        { id: "zielpreis", art: "text", label: "Was dürfte ein Stück später ungefähr kosten?", platz: "Zum Beispiel: höchstens 150 € im Verkauf." }] },
    { thema: "Vorschriften", frage: "Muss es bestimmte Vorschriften erfüllen?", hilfe: "Wenn Sie es nicht wissen, ist das völlig in Ordnung – wir prüfen das.",
      warum: "Zulassungen wie CE oder Medizinprodukt beeinflussen Zeitplan und Kosten. Je früher wir sie kennen, desto besser.",
      felder: [{ id: "zertifizierung", art: "mehr", label: "Was trifft vermutlich zu?", allein: ["unklar"], optionen: [["ce", "CE-Kennzeichnung"], ["mdr", "Medizinprodukt"], ["ip", "Wasser- und Staubschutz (IP)"], ["lebensmittel", "Kontakt mit Lebensmitteln"], ["funk", "Funkzulassung"], ["spielzeug", "Spielzeug-Sicherheit"], ["ex", "Explosionsschutz"], ["unklar", "Weiß ich nicht – bitte prüfen"]] },
        { id: "patent", art: "wahl", label: "Gibt es ein Patent oder Gebrauchsmuster?", optionen: [["ja", "Ja"], ["angemeldet", "Angemeldet"], ["geplant", "Geplant"], ["nein", "Nein"], ["unklar", "Weiß ich nicht"]] }] },
    { thema: "Zeitrahmen", frage: "Wann soll es so weit sein?", hilfe: "Grobe Angaben genügen.",
      warum: "So planen wir realistisch – und sagen Ihnen ehrlich, was in Ihrem Zeitraum machbar ist.",
      felder: [{ id: "dringlichkeit", art: "wahl", label: "Wie eilig ist es?", optionen: [["sofort", "So bald wie möglich"], ["halbjahr", "Innerhalb eines halben Jahres"], ["jahr", "Innerhalb eines Jahres"], ["offen", "Kein fester Zeitplan"]] },
        { id: "zeit", art: "text", label: "Gibt es einen festen Termin?", platz: "Zum Beispiel: Prototyp bis zur Messe im Mai." }] },
    { thema: "Budget", frage: "In welchem Rahmen bewegen wir uns?", hilfe: "Grobe Angaben genügen.",
      warum: "Mit einem Rahmen schlagen wir den passenden Weg vor – vom schlanken Funktionsmuster bis zum fertigen Prototyp.",
      felder: [{ id: "budget", art: "wahl", label: "Budget für Konzept und Prototyp", optionen: [["bis1", "bis 1.000 €"], ["bis5", "1.000 – 5.000 €"], ["bis20", "5.000 – 20.000 €"], ["mehr", "mehr als 20.000 €"], ["offen", "noch offen"]] },
        { id: "finanzierung", art: "mehr", label: "Wie soll es finanziert werden?", optionen: [["eigen", "Aus eigenen Mitteln"], ["foerderung", "Mit Fördermitteln"], ["investor", "Mit Investoren"], ["crowd", "Über Crowdfunding"], ["offen", "Noch offen"]] }] },
    { thema: "Zum Schluss", frage: "Was brauchen Sie von uns?", hilfe: "",
      warum: "Manche brauchen erst eine ehrliche Einschätzung, andere einen fertigen Prototyp. Beides ist ein guter Anfang.",
      felder: [{ id: "bedarf", art: "wahl", stil: "karten", optionen: [["machbarkeit", "Klären, ob es machbar ist", "Technisch und wirtschaftlich"], ["konzept", "Ein ausgearbeitetes Entwicklungskonzept", "Technik, Bauteile, Kosten und Plan"], ["prototyp", "Den Prototyp bauen", "Ein funktionierendes Muster"], ["alles", "Alles zusammen", "Von der Idee bis zum Prototyp"]] },
        { id: "sonst", art: "lang", label: "Möchten Sie uns noch etwas mitgeben?", platz: "" }] },
  ],
  software: [
    { thema: "Ihr Vorhaben", frage: "Was soll entstehen?", hilfe: "Wählen Sie, was am besten passt – Details klären wir im Gespräch.",
      warum: "Danach richten sich die weiteren Fragen: Zu einem Telefonassistenten fragen wir anderes als zu einer App.",
      felder: [{ id: "art", art: "wahl", pflicht: true, stil: "karten", optionen: [
        ["webapp", "Web-App oder Kundenportal", "Läuft im Browser – Kundenbereich, Verwaltung, Abläufe"],
        ["app", "App fürs Smartphone", "Für iPhone und Android"],
        ["praxis", "Praxis- oder Patientensystem", "Termine, Kartei und Abläufe in der Praxis"],
        ["telefon", "Telefonassistent, der Anrufe annimmt", "Nimmt ab, beantwortet Fragen, vergibt Termine"],
        ["ki", "KI, die uns Arbeit abnimmt", "Wiederkehrende Aufgaben automatisch erledigen"],
        ["verwaltung", "Internes Werkzeug für Ihr Team", "Aufträge, Lager, Personal, Planung"],
        ["buchung", "Buchungs- oder Bestellsystem", "Reservieren, bestellen, abrechnen"],
        ["anpassen", "Bestehende Software verbessern", "Erweitern, modernisieren, Fehler beheben"],
        ["offen", "Weiß ich noch nicht", "Wir finden es gemeinsam heraus"]] }] },
    { thema: "Ziel", frage: "Was soll sie können?", hilfe: "Zwei, drei Sätze reichen – so, wie Sie es einem Kollegen erklären würden.",
      warum: "Das Ziel entscheidet, was in die erste Version gehört und was warten kann.",
      felder: [{ id: "kann", art: "lang", pflicht: true, platz: "Zum Beispiel: Patienten sollen online Termine buchen und vorab einen Fragebogen ausfüllen." },
        { id: "ziel", art: "mehr", label: "Was soll dadurch besser werden?", optionen: [["zeit", "Zeit sparen"], ["fehler", "Weniger Fehler"], ["ueberblick", "Besserer Überblick"], ["service", "Besserer Service für Kunden"], ["umsatz", "Mehr Umsatz"], ["papierlos", "Weg vom Papier"], ["wachstum", "Wachsen ohne mehr Personal"], ["neu", "Ein neues Angebot"]] }] },
    { thema: "Heute", frage: "Wie läuft es heute?", hilfe: "Jeder Stand ist in Ordnung.",
      warum: "Wenn wir wissen, was heute hakt, setzen wir genau dort an – und übernehmen, was schon gut funktioniert.",
      felder: [{ id: "heute", art: "wahl", stil: "karten", optionen: [["papier", "Auf Papier", "Zettel, Ordner, Karteikarten"], ["excel", "Mit Excel oder Listen", "Tabellen, von Hand gepflegt"], ["software", "Mit einer anderen Software", "Die nicht mehr richtig passt"], ["garnicht", "Noch gar nicht", "Es entsteht etwas Neues"]] },
        { id: "nervt", art: "text", label: "Was nervt daran am meisten?", platz: "Zum Beispiel: Wir tippen alles doppelt ab." },
        { id: "aufwand", art: "wahl", label: "Wie viel Zeit kostet das pro Woche?", optionen: [["2", "unter 2 Stunden"], ["5", "2 – 5 Stunden"], ["10", "5 – 10 Stunden"], ["mehr", "mehr als 10 Stunden"], ["unklar", "Schwer zu sagen"]] }] },
    { thema: "Nutzer", frage: "Wer benutzt sie?", hilfe: "", schau: "nutzer",
      warum: "Für Ihr Team gelten andere Anforderungen als für Kunden – bei Anmeldung, Bedienung und Datenschutz.",
      felder: [{ id: "nutzer", art: "wahl", stil: "karten", optionen: [["team", "Wir im Team", "Mitarbeiterinnen und Mitarbeiter"], ["kunden", "Unsere Kunden oder Patienten", "Von außen, mit eigenem Zugang"], ["beide", "Beide", "Team und Kunden gemeinsam"]] },
        { id: "anzahl", art: "wahl", label: "Wie viele Personen ungefähr?", optionen: [["5", "1 – 5"], ["20", "6 – 20"], ["100", "21 – 100"], ["mehr", "mehr"]] },
        { id: "rollen", art: "wahl", label: "Sehen alle dasselbe?", optionen: [["gleich", "Ja, alle sehen dasselbe"], ["rechte", "Nein, es gibt unterschiedliche Rechte"], ["unklar", "Weiß ich noch nicht"]] }] },
    { thema: "Geräte", frage: "Auf welchen Geräten?", hilfe: "Mehrere Antworten möglich.", schau: "geraete",
      warum: "Ob am Schreibtisch oder unterwegs auf dem Handy – das bestimmt Aufbau, Bedienung und Technik.",
      felder: [{ id: "geraete", art: "mehr", stil: "karten", optionen: [["computer", "Computer"], ["tablet", "Tablet"], ["handy", "Smartphone"]] },
        { id: "plattform", art: "mehr", label: "Gibt es Vorgaben?", allein: ["egal"], optionen: [["ios", "iPhone und iPad"], ["android", "Android"], ["windows", "Windows"], ["mac", "Mac"], ["browser", "Nur im Browser"], ["egal", "Keine Vorgaben"]] },
        { id: "offline", art: "wahl", label: "Muss sie auch ohne Internet funktionieren?", optionen: [["ja", "Ja, auch ohne Netz"], ["nein", "Nein, Internet ist immer da"], ["unklar", "Weiß ich nicht"]] }] },
    { thema: "Funktionen", frage: "Was soll alles dabei sein?", hilfe: "Tippen Sie alles an, was Ihnen wichtig ist.",
      warum: "So sehen wir früh den Umfang – und können einschätzen, was in die erste Version gehört.",
      felder: [{ id: "funktionen", art: "mehr", optionen: [["termine", "Termine buchen"], ["konto", "Kundenkonto mit Anmeldung"], ["zahlung", "Bezahlen"], ["dokumente", "Dokumente hochladen"], ["nachrichten", "Nachrichten"], ["auswertung", "Auswertungen"], ["assistent", "KI-Assistent"], ["hinweise", "Erinnerungen"],
          ["formulare", "Formulare und Fragebögen"], ["kartei", "Kunden- oder Patientenkartei"], ["angebote", "Angebote und Rechnungen"], ["aufgaben", "Aufgaben und Planung"], ["zeiterfassung", "Zeiterfassung"], ["lager", "Lager und Bestand"], ["suche", "Suche und Filter"], ["export", "Export nach Excel oder PDF"], ["unterschrift", "Digitale Unterschrift"], ["karte", "Karte und Standorte"], ["sprachen", "Mehrere Sprachen"], ["rechte", "Rollen und Rechte"]] },
        { id: "funktionen_frei", art: "text", label: "Etwas anderes?", platz: "" },
        { id: "erste_version", art: "text", label: "Was muss die erste Version unbedingt können?", platz: "Zum Beispiel: Termine buchen – alles andere kann warten." }] },
    { thema: "Schnittstellen", frage: "Womit muss sie zusammenarbeiten?", hilfe: "Programme, die Sie schon nutzen.",
      warum: "Gut verbundene Programme ersparen doppeltes Abtippen. Jede Verbindung planen wir von Anfang an mit ein.",
      felder: [{ id: "systeme", art: "mehr", allein: ["nichts"], optionen: [["kalender", "Kalender"], ["email", "E-Mail"], ["buchhaltung", "Buchhaltung"], ["praxissoftware", "Praxissoftware"], ["shop", "Online-Shop"], ["telefon", "Telefonanlage"], ["excel", "Excel-Listen"], ["crm", "Kundenverwaltung (CRM)"], ["warenwirtschaft", "Warenwirtschaft"], ["zahlungsanbieter", "Zahlungsanbieter"], ["website", "Unsere Website"], ["nichts", "Mit nichts"]] },
        { id: "systeme_frei", art: "text", label: "Welche genau?", platz: "Zum Beispiel: Outlook, DATEV." },
        { id: "datenuebernahme", art: "wahl", label: "Sollen vorhandene Daten übernommen werden?", optionen: [["ja", "Ja, alles"], ["teilweise", "Teilweise"], ["nein", "Nein, wir fangen neu an"], ["unklar", "Weiß ich nicht"]] }] },
    { thema: "Daten", frage: "Welche Daten sind im Spiel?", hilfe: "Davon hängt ab, wie wir sie schützen.",
      warum: "Gesundheits- oder Zahlungsdaten brauchen besonderen Schutz. Das planen wir von Anfang an ein – nicht erst hinterher.",
      felder: [{ id: "daten", art: "mehr", allein: ["keine"], optionen: [["gesundheit", "Gesundheitsdaten"], ["zahlung", "Zahlungsdaten"], ["kunden", "Kundendaten"], ["personal", "Daten von Mitarbeitern"], ["vertraulich", "Vertrauliche Geschäftsdaten"], ["keine", "Nichts Sensibles"]] },
        { id: "datenmenge", art: "wahl", label: "Wie viele Einträge kommen ungefähr zusammen?", optionen: [["wenig", "Einige Hundert"], ["mittel", "Einige Tausend"], ["viel", "Sehr viele"], ["unklar", "Weiß ich nicht"]] },
        { id: "hosting", art: "wahl", label: "Wo sollen die Daten liegen?", optionen: [["de", "Auf Servern in Deutschland"], ["eigen", "Auf unserem eigenen Server"], ["egal", "Beraten Sie mich"]] }] },
    // Zusatzfragen je nach Antwort auf "Was soll entstehen?"
    { wenn: { feld: "art", ist: ["telefon"] }, thema: "Telefonassistent", frage: "Zu Ihrem Telefonassistenten", hilfe: "",
      warum: "Anrufmenge und Aufgaben bestimmen, wie wir den Assistenten aufsetzen und an Ihre Abläufe anbinden.",
      felder: [{ id: "tel_anrufe", art: "wahl", label: "Wie viele Anrufe am Tag?", optionen: [["10", "bis 10"], ["50", "10 – 50"], ["mehr", "mehr als 50"]] },
        { id: "tel_aufgaben", art: "mehr", label: "Was soll er erledigen?", optionen: [["termine", "Termine vergeben"], ["fragen", "Fragen beantworten"], ["weiter", "Weiterleiten"], ["rueckruf", "Rückruf notieren"]] },
        { id: "tel_zeiten", art: "text", label: "Zu welchen Zeiten?", platz: "Zum Beispiel: rund um die Uhr, oder nur außerhalb der Sprechzeiten." }] },
    { wenn: { feld: "art", ist: ["ki"] }, thema: "Ihr Ablauf", frage: "Zu Ihrem Ablauf", hilfe: "",
      warum: "KI lohnt sich dort am meisten, wo ein Ablauf oft vorkommt und viel Zeit kostet.",
      felder: [{ id: "ki_ablauf", art: "lang", label: "Welcher Ablauf kostet am meisten Zeit?", platz: "Zum Beispiel: Angebote aus E-Mails zusammenstellen." },
        { id: "ki_oft", art: "wahl", label: "Wie oft kommt er vor?", optionen: [["taeglich", "Täglich"], ["woche", "Mehrmals pro Woche"], ["selten", "Seltener"]] },
        { id: "ki_daten", art: "text", label: "Mit welchen Dokumenten oder Daten?", platz: "Zum Beispiel: PDFs, E-Mails, Tabellen." }] },
    { wenn: { feld: "art", ist: ["praxis"] }, thema: "Ihre Praxis", frage: "Zu Ihrer Praxis", hilfe: "",
      warum: "Fachrichtung und Praxisgröße bestimmen, welche Abläufe und welche Praxissoftware wir berücksichtigen.",
      felder: [{ id: "px_fach", art: "text", label: "Welche Fachrichtung?", platz: "Zum Beispiel: Physiotherapie." },
        { id: "px_behandler", art: "wahl", label: "Wie viele Behandler?", optionen: [["1", "1"], ["5", "2 – 5"], ["mehr", "mehr als 5"]] },
        { id: "px_software", art: "text", label: "Welche Praxissoftware nutzen Sie heute?", platz: "" }] },
    { wenn: { feld: "art", ist: ["app"] }, thema: "Ihre App", frage: "Zu Ihrer App", hilfe: "",
      warum: "Ob die App öffentlich in die Stores kommt und welche Handy-Funktionen sie nutzt, verändert Aufwand und Prüfungen deutlich.",
      felder: [{ id: "app_store", art: "wahl", label: "Soll sie im App Store und bei Google Play erscheinen?", optionen: [["ja", "Ja, für alle"], ["intern", "Nur für unser Team"], ["unklar", "Weiß ich nicht"]] },
        { id: "app_funktionen", art: "mehr", label: "Was soll die App vom Handy nutzen?", allein: ["nichts"], optionen: [["kamera", "Kamera"], ["standort", "Standort"], ["push", "Mitteilungen aufs Handy"], ["bluetooth", "Bluetooth-Geräte"], ["offline", "Arbeiten ohne Netz"], ["nichts", "Nichts Besonderes"]] }] },
    { wenn: { feld: "art", ist: ["anpassen"] }, thema: "Bestehende Software", frage: "Zur bestehenden Software", hilfe: "",
      warum: "Ob wir auf dem Vorhandenen aufbauen können, hängt vor allem am Zugriff auf den Quelltext.",
      felder: [{ id: "an_welche", art: "text", label: "Welche Software ist es?", platz: "" },
        { id: "an_wer", art: "text", label: "Wer hat sie gebaut?", platz: "Zum Beispiel: eine Agentur, ein früherer Mitarbeiter." },
        { id: "an_code", art: "wahl", label: "Haben Sie Zugriff auf den Quelltext?", optionen: [["ja", "Ja"], ["nein", "Nein"], ["unklar", "Weiß ich nicht"]] }] },
    { thema: "Zeitrahmen", frage: "Wann soll es losgehen?", hilfe: "Grobe Angaben genügen.",
      warum: "So planen wir realistisch – und sagen Ihnen ehrlich, was bis zu Ihrem Termin machbar ist.",
      felder: [{ id: "start", art: "wahl", label: "Start", optionen: [["sofort", "So bald wie möglich"], ["quartal", "In den nächsten drei Monaten"], ["spaeter", "Später"], ["offen", "Noch offen"]] },
        { id: "zeit", art: "text", label: "Bis wann soll es fertig sein?", platz: "Zum Beispiel: Start im Januar, fertig zur Saison im Mai." }] },
    { thema: "Budget", frage: "In welchem Rahmen bewegen wir uns?", hilfe: "Grobe Angaben genügen.",
      warum: "Mit einem Rahmen schlagen wir den passenden Weg vor – vom schlanken Start bis zur großen Lösung.",
      felder: [{ id: "budget", art: "wahl", label: "Budget", optionen: [["bis5", "bis 5.000 €"], ["bis15", "5.000 – 15.000 €"], ["bis50", "15.000 – 50.000 €"], ["mehr", "mehr als 50.000 €"], ["offen", "noch offen"]] },
        { id: "modell", art: "wahl", label: "Welches Modell interessiert Sie?", optionen: [["festpreis", "Festpreis"], ["signature", "Signature – ohne Entwicklungskosten"], ["offen", "Beraten Sie mich"]] },
        { id: "betreuung", art: "wahl", label: "Wer kümmert sich danach um Pflege und Updates?", optionen: [["reeder", "Das übernehmen Sie für uns"], ["selbst", "Wir selbst"], ["offen", "Beraten Sie mich"]] },
        { id: "entscheidung", art: "wahl", label: "Wer entscheidet mit?", optionen: [["ich", "Ich entscheide allein"], ["gemeinsam", "Wir entscheiden gemeinsam"], ["andere", "Jemand anderes entscheidet"]] }] },
    { thema: "Zum Schluss", frage: "Vorbilder und Unterlagen", hilfe: "Alles, was uns ein Bild gibt. Alles freiwillig.",
      warum: "Ein Beispiel, das Ihnen gefällt – oder eines, das Sie auf keinen Fall möchten – sagt oft mehr als lange Beschreibungen.",
      felder: [{ id: "vorbild", art: "text", label: "Gibt es etwas, das Ihnen gefällt?", platz: "Zum Beispiel: ein Link oder der Name einer App." },
        { id: "nogo", art: "text", label: "Was möchten Sie auf keinen Fall?", platz: "Zum Beispiel: keine App, die man erst installieren muss." },
        { id: "datei", art: "datei", label: "Datei hochladen (freiwillig)" },
        { id: "sonst", art: "lang", label: "Möchten Sie uns noch etwas mitgeben?", platz: "" }] },
  ],
};

/** Kurze Namen für Projekttitel und Projektart */
const ART_KURZ = { webapp: "Web-App", app: "App", praxis: "Praxissystem", telefon: "Telefonassistent", ki: "KI-Automatisierung", anpassen: "Software-Anpassung", verwaltung: "Verwaltungssoftware", buchung: "Buchungssystem", offen: "Software" };
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
      text: `Hallo ${b.name},\n\nwir freuen uns auf unser Gespräch! Damit wir die Zeit bestmöglich nutzen, haben wir ein paar Fragen zu Ihrem Vorhaben vorbereitet (${kinds.map(k => BEREICHE[k]).join(" und ")}). Das dauert etwa acht Minuten – das meiste tippen Sie einfach an.\n\n${link}\n\nZuerst legen Sie dort mit einem Passwort Ihren persönlichen Bereich an. Dort finden Sie später auch Termine, Unterlagen und unser Angebot.\n\nSie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch.\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` });
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
      // Vorläufiger Titel, bis die KI einen Namen vergibt. Nicht an Punkten mitten im Satz trennen („1. Auflage“, „z. B.“);
      // bleibt nur ein Bruchstück, heißt das Projekt so lange „Hardware für <Kunde>“.
      const ersterSatz = kurz.split(/[!?\n]|\.(?=\s+[A-ZÄÖÜ])/)[0].trim();
      const titel = clean(bereich === "hardware" ? (ersterSatz.length >= 12 ? ersterSatz : `Hardware für ${wer}`) : `${art} für ${wer}`, 110) || "Anfrage";
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
          zweck: [kurz, zeilen(["Soll vor allem", t("funktion")], ["Schon vorhanden", t("stand")], ["Enthält vermutlich", t("inhalt")], ["Strom", [t("strom"), t("laufzeit")].filter(Boolean).join(" – ")],
            ["Bedienung", t("bedienung")], ["Verbindung", t("verbindung")], ["Vorschriften", t("zertifizierung")], ["Patent", t("patent")], ["Gewünscht von uns", t("bedarf")], ["Außerdem", t("sonst")])].filter(Boolean).join("\n\n"),
          nutzer: zeilen(["Für", t("nutzergruppe")], ["Wer", t("nutzer")], ["Wo", t("ort")], ["Muss aushalten", t("umgebung")], ["Temperatur", t("temperatur")]),
          groesse: [t("groesse"), t("masse"), t("gewicht") && `Gewicht: ${t("gewicht")}`].filter(Boolean).join(" – "),
          budget: zeilen(["Budget", t("budget")], ["Finanzierung", t("finanzierung")], ["Wie eilig", t("dringlichkeit")], ["Zeitrahmen", t("zeit")]),
          stueckzahl: [t("stueckzahl"), t("zielpreis") && `Zielpreis: ${t("zielpreis")}`].filter(Boolean).join(" – "),
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
    // Jedes „Weiter“ speichert den Zwischenstand (bis zu ~27 Schritte, auch vor und zurück): Grenze je Fragebogen großzügig,
    // je Anschluss (z. B. mehrere Leute im selben Büro) noch großzügiger – gegen Missbrauch reicht das.
    if (limited("ob:" + ipOf(req), 600, 3600000) || limited("obt:" + m[1], 300, 3600000)) return json(res, 429, { error: "Zu viele Anfragen – bitte später erneut versuchen." });
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
        text: `Hallo ${c.name},\n\ndamit wir uns gut auf unser Gespräch vorbereiten können, fehlen uns noch Ihre Antworten auf ein paar Fragen. Das dauert etwa acht Minuten:\n\n${link}\n\nSie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch.\n\nViele Grüße\n${cfg.fromName || "Reeder Software"}` });
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
