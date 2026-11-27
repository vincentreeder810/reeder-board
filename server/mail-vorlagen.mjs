// Alle E-Mails, die der Server verschickt, an einer Stelle: Betreff, Text und Hauptknopf je Anlass.
// Aufruf: sendMail({ to, ...vorlage("termin_erinnerung_tag", { … }), attachments })
// Das Board zeigt aus VORLAGEN (mit den Beispieldaten) eine Vorschau aller Mails.
// Regeln: Kunden werden gesiezt, das Team geduzt. Übersicht als Zeilen „Schlüssel: Wert“ (das Layout macht daraus eine Tabelle).
// Der Hauptlink steht als knopf und zusätzlich als eigene Zeile im Text (für die Klartext-Fassung).
import { db, getSetting, DEFAULT_COMPANY, DEFAULT_AVAILABILITY } from "./db.mjs";
import { firmaDaten, firmaVonProjekt, DEFAULT_HARDWARE } from "./firmen.mjs";   // firmen.mjs importiert nur db.mjs – kein Zirkelimport

const TZ = "Europe/Berlin";
/** Adresse der Seite – dieselbe Regel wie in server.mjs */
export const SEITE = (process.env.SITE_URL || `http://localhost:${Number(process.env.PORT || 5510)}`).replace(/\/$/, "");
const BSP = "https://www.reeder-tech.de";   // nur für die Beispieldaten der Vorschau

/* ---------- Helfer: Text ---------- */
const einzeilig = s => String(s ?? "").replace(/\s+/g, " ").trim();
const kurz = (s, n) => { const t = einzeilig(s); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const absaetze = (...teile) => teile.filter(x => x && String(x).trim()).join("\n\n");
/** Übersicht: nur Zeilen mit Wert */
const zeilen = paare => paare.filter(([, v]) => v !== undefined && v !== null && v !== false && String(v).trim() !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
const liste = punkte => (punkte || []).filter(Boolean).map(p => `• ${p}`).join("\n");
const wer = (name, unternehmen) => unternehmen && unternehmen !== name ? `${name} (${unternehmen})` : (name || unternehmen || "");

/* ---------- Helfer: Zahlen und Zeiten ---------- */
const zahl = (c, stellen) => (Math.abs(c || 0) / 100 * Math.sign(c || 0)).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
export const euro = c => `${zahl(c, 2)} €`;          // 553,00 €
export const euro0 = c => `${zahl(c, 0)} €`;         // 553 €
const teile = (iso, o) => Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: TZ, ...o }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
const fremdesJahr = iso => teile(iso, { year: "numeric" }).year !== teile(new Date().toISOString(), { year: "numeric" }).year;
export const uhr = iso => { const p = teile(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); return `${p.hour}:${p.minute}`; };
/** Donnerstag, 3. Dezember (Jahr nur, wenn nicht das laufende) */
export const tagLang = iso => { const p = teile(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); return `${p.weekday}, ${p.day}. ${p.month}${fremdesJahr(iso) ? " " + p.year : ""}`; };
/** Donnerstag, 3. Dezember, 10:00 Uhr */
export const terminLang = iso => `${tagLang(iso)}, ${uhr(iso)} Uhr`;
/** Do, 3. Dezember */
const tagMittel = iso => { const p = teile(iso, { weekday: "short", day: "numeric", month: "long" }); return `${p.weekday.replace(".", "")}, ${p.day}. ${p.month}`; };
/** Do 3. Dez., 10:00 – für sortierbare Team-Betreffzeilen */
export const terminKurz = iso => { const p = teile(iso, { weekday: "short", day: "numeric", month: "short" }); return `${p.weekday.replace(".", "")} ${p.day}. ${p.month}, ${uhr(iso)}`; };
/** 3. Dezember 2026, 14:05 Uhr */
const zeitpunkt = iso => { const p = teile(iso, { day: "numeric", month: "long", year: "numeric" }); return `${p.day}. ${p.month} ${p.year}, ${uhr(iso)} Uhr`; };
/** 2026-12-17 → 17.12.2026 */
const datum = ymd => /^\d{4}-\d{2}-\d{2}/.test(String(ymd || "")) ? String(ymd).slice(0, 10).split("-").reverse().join(".") : "";

/* ---------- Anrede und Gruß ---------- */
/** „Guten Tag Frau Krüger,“ nur mit bekannter Anrede, sonst „Guten Tag Sabine Krüger,“ */
const anrede = d => {
  const name = einzeilig(d?.name);
  if (name && ["Frau", "Herr"].includes(d?.anrede)) return `Guten Tag ${d.anrede} ${name.split(" ").at(-1)},`;
  return name ? `Guten Tag ${name},` : "Guten Tag,";
};
/** Firma der Mail: "software" oder "hardware" – Hardware nur, wenn die Hardware GmbH in den Einstellungen aktiv ist */
// In der Vorschau (vorlage(…, …, { vorschau: true })) zeigt "hardware" die Hardware GmbH auch, solange sie noch nicht aktiv ist.
let vorschauLaeuft = false;
const firmaKey = firma => { if (firma !== "hardware") return "software"; if (vorschauLaeuft) return "hardware"; try { return firmaDaten("hardware").firma; } catch { return "software"; } };
const firmenname = firma => {
  try {
    const k = firmaKey(firma);
    if (k === "hardware" && vorschauLaeuft) return getSetting("companyHardware", DEFAULT_HARDWARE).name || DEFAULT_HARDWARE.name;
    return firmaDaten(k).name || DEFAULT_COMPANY.name;
  } catch { return DEFAULT_COMPANY.name; }
};
/** Firma einer Website-Buchung: Hardware bei einer Hardware-Terminart, wenn nur „Hardware“ als Thema gewählt ist
 *  oder alle Projekte der Buchung Hardware-Projekte sind. Gemischt oder unklar: Software. */
export function firmaVonBuchung(b) {
  try {
    if (!b) return "software";
    if (getSetting("availability", DEFAULT_AVAILABILITY).types?.[b.type]?.bereich === "hardware") return firmaKey("hardware");
    const themen = ((String(b.message || "").match(/^Themen: (.*)$/m) || [])[1] || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    if (themen.length && themen.every(t => t === "hardware")) return firmaKey("hardware");
    if (b.id) { const bereiche = [...new Set(db.prepare("SELECT bereich FROM projects WHERE booking_id = ?").all(b.id).map(r => r.bereich || "software"))];
      if (bereiche.length === 1 && bereiche[0] === "hardware") return firmaKey("hardware"); }
  } catch {}
  return "software";
}
/** Firma eines Termins (appointments): über das Projekt, sonst über die Buchung */
export function firmaVonTermin(a) {
  try {
    if (a?.project_id) return firmaVonProjekt(a.project_id);
    if (a?.booking_id) return firmaVonBuchung(db.prepare("SELECT * FROM bookings WHERE id = ?").get(a.booking_id));
  } catch {}
  return "software";
}
/** „Reeder Software“ aus „Reeder Software GmbH“ */
export const marke = firma => firmenname(firma).replace(/\s+(GmbH|UG|AG|KG|e\.K\.)(\s.*)?$/i, "");
/** Name des Inhabers: aktiver Benutzer mit Rolle „inhaber“ (der Platzhalter „Admin“ zählt nicht) */
function inhaberName() {
  try { const u = db.prepare("SELECT name FROM users WHERE role = 'inhaber' AND active = 1 ORDER BY id LIMIT 1").get(); return u?.name && u.name !== "Admin" ? u.name : ""; }
  catch { return ""; }
}
/** Einheitlicher Gruß: „Viele Grüße\nVincent Reeder\n<Firmenname>“. firma = "software" | "hardware"; name überschreibt den Inhaber (z. B. Teammitglied). */
export function gruss(firma = "software", name) {
  const person = name === undefined || name === null || name === "" ? inhaberName() : einzeilig(name);
  const f = firmenname(firma);
  return ["Viele Grüße", person && person !== f ? person : "", f].filter(Boolean).join("\n");
}

/* ---------- Bausteine, die mehrere Vorlagen teilen ----------
   Einheitlicher Aufbau einer Kundenmail:
     Anrede · ein Satz, worum es geht · Übersicht („Schlüssel: Wert“) oder nummerierte Schritte („1. **Schlagwort** – …“)
     · Hauptlink als eigene Zeile (dort steht der Knopf) · Kleingedrucktes als „Hinweis: …“ · Gruß.
   **fett** setzt das Layout fett (Klartext ohne Sternchen) – sparsam, höchstens 2–4 Stellen je Mail. */
const fett = t => `**${t}**`;
const schritte = liste => liste.filter(Boolean).map(([wort, rest], i) => `${i + 1}. ${fett(wort)}${rest ? ` – ${rest}` : ""}`).join("\n");
const hinweis = t => t ? `Hinweis: ${t}` : "";
/** „Das Angebot finden Sie als PDF im Anhang und im Kundenportal.“ – ohne Anhang nur der Portal-Hinweis */
const pdfSatz = (was, anhang, portal = true) => anhang
  ? `${was} finden Sie ${fett("als PDF im Anhang")}${portal ? " und im Kundenportal" : ""}.`
  : portal ? `${was} finden Sie in Ihrem Kundenportal.` : "";
const mitAnhang = d => d.anhang !== false;
const videoSatz = url => `Zum Video-Gespräch klicken Sie zur Uhrzeit einfach auf diesen Link – ohne Anmeldung, ohne Installation:\n${url}`;
const videoKnopf = url => url ? { label: "Zum Video-Gespräch", url } : undefined;
const kalenderSatz = "Den Termin finden Sie als Kalendereintrag im Anhang.";
const aenderungHinweis = d => hinweis(d.portalLink
  ? "Falls etwas dazwischenkommt, schreiben Sie uns einfach über die Nachrichten in Ihrem Kundenportal."
  : "Falls etwas dazwischenkommt, geben Sie uns bitte kurz Bescheid – unsere Kontaktdaten finden Sie unten in dieser E-Mail.");
/** Übersicht eines Termins – in allen Termin-Mails gleich */
const terminZeilen = (d, start = d.start) => zeilen([["Termin", d.titel || [d.art, d.produkt].filter(Boolean).join(" – ")], ["Datum", terminLang(start)],
  ["Dauer", d.minuten ? `${d.minuten} Minuten` : ""], ["Gespräch", d.videoUrl ? "Video-Gespräch" : d.kanal]]);
function erinnerung(d, wann) {
  return absaetze(anrede(d), `eine kurze Erinnerung an unseren Termin ${fett(wann)}.`,
    terminZeilen(d),
    d.videoUrl && videoSatz(d.videoUrl),
    aenderungHinweis(d),
    gruss(d.firma));
}

/* ---------- Fragebögen: gleicher Aufbau für Website, Software, Hardware und beides ---------- */
const FB = {
  website: { betreff: "Ihr Fragebogen zur Website", minuten: 6, worum: "Ihrer Website", knopf: "Zum Fragebogen",
    warum: "haben wir einen Fragebogen mit Beispielen vorbereitet: erster Eindruck, Bilder, Farben, Schrift, Bewegung und die Funktionen, die Ihnen wichtig sind",
    ausfuellen: "ca. 6 Minuten, Sie klicken einfach an, was Ihnen gefällt.",
    fertig: "aus Ihren Angaben bereiten wir vor dem Termin einen ersten Eindruck vor, den wir Ihnen im Gespräch zeigen.",
    hinweis: "Ihre Angaben sind in Ihrem Kundenkonto sicher gespeichert. Später finden Sie dort alles zu Ihrem Projekt an einem Ort." },
  software: { betreff: "Ein paar Fragen zu Ihrer Software", minuten: 8, worum: "Ihrer Software", knopf: "Zu den Fragen",
    warum: "haben wir ein paar Fragen zu Ihrer Software vorbereitet: welche Abläufe sie erleichtern soll, wer damit arbeitet und was die erste Version unbedingt können muss",
    ausfuellen: "ca. 8 Minuten, das meiste tippen Sie einfach an.",
    fertig: "wir bereiten das Gespräch gezielt darauf vor.",
    hinweis: "Sie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch. Im Kundenkonto finden Sie später auch Termine, Unterlagen und unser Angebot." },
  hardware: { betreff: "Ein paar Fragen zu Ihrem Gerät", minuten: 8, worum: "Ihrem Gerät", knopf: "Zu den Fragen",
    warum: "haben wir ein paar Fragen zu Ihrer Produktidee vorbereitet: was das Gerät tun soll, wo und von wem es eingesetzt wird, welche Stückzahl und welchen Stückpreis Sie anpeilen und welches Budget für Konzept und Prototyp vorgesehen ist",
    ausfuellen: "ca. 8 Minuten, das meiste tippen Sie einfach an. Eine Skizze oder ein Foto können Sie gern hochladen.",
    fertig: "wir bereiten das Gespräch gezielt darauf vor.",
    hinweis: "Sie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch. Im Kundenkonto finden Sie später auch Termine, Unterlagen und unser Angebot." },
  beides: { betreff: "Ein paar Fragen zu Ihrer Software und Hardware", minuten: 0, worum: "Ihrer Software und Hardware", knopf: "Zu den Fragen",
    warum: "haben wir Fragen zu beiden Teilen Ihres Vorhabens vorbereitet: bei der Software zu Abläufen, Nutzern und Funktionen, bei der Hardware zu Gerät, Einsatzort, Stückzahl und Prototyp",
    ausfuellen: "ca. 8 Minuten je Bereich, das meiste tippen Sie einfach an. Eine Skizze oder ein Foto können Sie gern hochladen.",
    fertig: "wir bereiten das Gespräch gezielt darauf vor.",
    hinweis: "Sie müssen nicht alles wissen. Was offen bleibt, klären wir im Gespräch. Im Kundenkonto finden Sie später auch Termine, Unterlagen und unser Angebot." },
};
function fragebogenMail(d, f, istErinnerung) {
  const dauer = f.minuten ? ` (ca. ${f.minuten} Minuten)` : "";
  return {
    subject: istErinnerung ? `Erinnerung: ${f.betreff}${dauer}` : `Vor unserem Gespräch: ${f.betreff}${dauer}`,
    text: absaetze(anrede(d),
      istErinnerung
        ? `damit wir uns gut auf unser Gespräch vorbereiten können, fehlen uns noch Ihre Angaben zu ${f.worum}.`
        : `damit wir die Zeit in unserem Gespräch bestmöglich nutzen, ${f.warum}.`,
      schritte([
        istErinnerung ? ["Anmelden", "mit Ihrem Passwort oder, falls noch nicht geschehen, jetzt einmalig eins festlegen."]
          : ["Kundenkonto anlegen", "einmalig mit einem Passwort, dauert etwa 20 Sekunden. Haben Sie schon eines, melden Sie sich einfach an."],
        ["Fragebogen ausfüllen", f.ausfuellen],
        ["Fertig", f.fertig]]),
      d.link,
      hinweis(f.hinweis),
      gruss(d.firma)),
    knopf: { label: f.knopf, url: d.link },
  };
}

/** Kalenderdatei als Anhang: method "PUBLISH" (Termin eintragen/aktualisieren) oder "CANCEL" (Termin streichen).
 *  ics = Text aus icsCalendar([icsFor(…)]) aus mail.mjs; die METHOD-Zeile wird hier ergänzt, weil der Inhaltstyp sie nennt. */
export function kalenderAnhang(ics, method = "PUBLISH") {
  const m = method === "CANCEL" ? "CANCEL" : "PUBLISH";
  const content = /\r\nMETHOD:/.test(ics) ? ics : String(ics).replace("VERSION:2.0", `VERSION:2.0\r\nMETHOD:${m}`);
  return { filename: "termin.ics", content, contentType: `text/calendar; charset=utf-8; method=${m}` };
}

/* ---------- Beispieldaten (frei erfunden, nur für die Vorschau) ---------- */
const B = { name: "Sabine Krüger", unternehmen: "Physiotherapie Am Park", email: "s.krueger@physio-am-park.example", telefon: "0341 123 45 67" };
const IN_7 = "2026-12-03T09:00:00.000Z";   // Donnerstag, 3. Dezember 2026, 10:00 Uhr Berliner Zeit
const VIDEO = "https://meet.jit.si/Reeder-3f9a1c2b7d4e";

/* ================================================================ */
export const VORLAGEN = {
  /* ---------- Termine ---------- */
  termin_bestaetigt: {
    gruppe: "Termine", titel: "Termin bestätigt", an: "kunde",
    wann: "Direkt nach einer Buchung über die Website oder wenn das Team eine Buchung bestätigt; mit Kalendereintrag (termin.ics) im Anhang.",
    baue: d => {
      const video = !!d.videoUrl && String(d.kanal || "Video").includes("Video");
      // Hinweis auf die folgenden Fragebögen: Website → Entwurf vorab, Software/Hardware → Fragen zum Vorhaben
      const fb = Array.isArray(d.fragebogen) ? d.fragebogen : [], web = fb.includes("website"), andere = fb.filter(k => k !== "website");
      const fbSatz = !fb.length ? "" : `${fb.length > 1 ? "In zwei weiteren E-Mails schicken wir Ihnen gleich kurze Fragebögen" : "In einer zweiten E-Mail schicken wir Ihnen gleich einen kurzen Fragebogen"}${web ? " – daraus bereiten wir schon vor dem Termin einen ersten Entwurf Ihrer Website vor" : ""}${andere.length ? `${web ? ", und mit den Fragen zu Ihrem Vorhaben" : " – damit"} können wir uns gezielt auf das Gespräch vorbereiten` : ""}.`;
      return {
        subject: `Ihr Termin ist bestätigt – ${tagMittel(d.start)}, ${uhr(d.start)} Uhr`,
        text: absaetze(anrede(d), `Ihr Termin ist ${fett("bestätigt")}. Wir freuen uns auf das Gespräch.`,
          zeilen([["Termin", [d.art, d.produkt].filter(Boolean).join(" – ")], ["Datum", terminLang(d.start)], ["Dauer", d.minuten ? `${d.minuten} Minuten` : ""],
            ["Gespräch", video ? "Video-Gespräch" : d.kanal], ["Kosten", d.preis ? `${d.preis} € zzgl. MwSt., die Rechnung erhalten Sie nach dem Termin` : ""]]),
          video && videoSatz(d.videoUrl),
          fbSatz,
          kalenderSatz,
          aenderungHinweis(d),
          gruss(d.firma)),
        knopf: video ? videoKnopf(d.videoUrl) : undefined,
      };
    },
    beispiel: { name: B.name, art: "Kostenloses Erstgespräch", produkt: "Website", start: IN_7, minuten: 30, kanal: "Video", videoUrl: VIDEO, preis: 0, fragebogen: ["website"] },
  },
  termin_einladung: {
    gruppe: "Termine", titel: "Einladung zu einem Termin", an: "kunde",
    wann: "Wenn das Team im Board einen Termin einplant oder eine Terminanfrage aus dem Kundenportal annimmt; mit Kalendereintrag (termin.ics) im Anhang.",
    baue: d => ({
      subject: `Einladung: ${kurz(d.titel, 40)} am ${tagMittel(d.start)}, ${uhr(d.start)} Uhr`,
      text: absaetze(anrede(d), `wir haben einen ${fett("Termin")} für Sie eingetragen und freuen uns auf das Gespräch.`,
        terminZeilen(d),
        d.videoUrl && videoSatz(d.videoUrl),
        d.notiz,
        kalenderSatz,
        aenderungHinweis(d),
        gruss(d.firma, d.absender)),
      knopf: videoKnopf(d.videoUrl),
    }),
    beispiel: { firma: "hardware", name: B.name, titel: "Kostenloses Erstgespräch Hardware", start: IN_7, minuten: 30, kanal: "Video", videoUrl: VIDEO, notiz: "Wir besprechen, ob sich der Therapie-Timer technisch umsetzen lässt.", absender: "Vincent Reeder" },
  },
  termin_erinnerung_tag: {
    gruppe: "Termine", titel: "Erinnerung einen Tag vorher", an: "kunde",
    wann: "Automatisch etwa 24 Stunden vor einem Termin (nur, wenn er länger als einen Tag im Voraus vereinbart wurde).",
    baue: d => ({ subject: `Erinnerung: ${kurz(d.titel, 45)} – morgen um ${uhr(d.start)} Uhr`, text: erinnerung(d, "morgen"), knopf: videoKnopf(d.videoUrl) }),
    beispiel: { name: B.name, titel: "Kostenloses Erstgespräch – Website", start: IN_7, videoUrl: VIDEO, portalLink: `${BSP}/portal/` },
  },
  termin_erinnerung_stunde: {
    gruppe: "Termine", titel: "Erinnerung eine Stunde vorher", an: "kunde",
    wann: "Automatisch etwa eine Stunde vor einem Termin.",
    baue: d => ({ subject: `In einer Stunde: ${kurz(d.titel, 45)} um ${uhr(d.start)} Uhr`, text: erinnerung(d, "in einer Stunde"), knopf: videoKnopf(d.videoUrl) }),
    beispiel: { name: B.name, titel: "Projekt-Abstimmung", start: IN_7, videoUrl: VIDEO },
  },
  termin_verschoben: {
    gruppe: "Termine", titel: "Termin verlegt", an: "kunde",
    wann: "Wenn der Inhaber einen bestätigten Termin im Board verschiebt; mit aktualisiertem Kalendereintrag (termin.ics) im Anhang.",
    baue: d => ({
      subject: `Ihr Termin wurde verlegt – neu: ${tagMittel(d.neu)}, ${uhr(d.neu)} Uhr`,
      text: absaetze(anrede(d), `wir müssen den Termin „${d.titel}“ leider verlegen – neu ist ${fett(terminLang(d.neu))}. Bitte entschuldigen Sie die Umstände.`,
        zeilen([["Termin", d.titel], ["Bisher", terminLang(d.alt)], ["Neu", terminLang(d.neu)], ["Dauer", d.minuten ? `${d.minuten} Minuten` : ""], ["Gespräch", d.videoUrl ? "Video-Gespräch (Link bleibt gleich)" : ""]]),
        d.videoUrl && videoSatz(d.videoUrl),
        kalenderSatz,
        hinweis(`Passt Ihnen der neue Termin nicht? Dann wählen Sie einfach einen anderen unter ${d.terminLink}`),
        gruss(d.firma)),
      knopf: d.videoUrl ? videoKnopf(d.videoUrl) : { label: "Anderen Termin wählen", url: d.terminLink },
    }),
    beispiel: { name: B.name, titel: "Projekt-Abstimmung", alt: "2026-12-02T13:00:00.000Z", neu: IN_7, minuten: 30, videoUrl: VIDEO, terminLink: `${BSP}/termin.html` },
  },
  termin_abgesagt: {
    gruppe: "Termine", titel: "Termin abgesagt", an: "kunde",
    wann: "Wenn das Team eine Website-Buchung oder einen vereinbarten Termin im Board absagt; mit Kalender-Absage (termin.ics, CANCEL) im Anhang.",
    baue: d => ({
      subject: `Ihr Termin am ${tagMittel(d.start)} entfällt leider`,
      text: absaetze(anrede(d), `leider können wir den Termin${d.titel ? ` „${d.titel}“` : ""} am ${fett(terminLang(d.start))} nicht wahrnehmen. Bitte entschuldigen Sie die Umstände.`,
        d.grund,
        `${fett("Neuen Termin wählen")} – suchen Sie sich einfach einen freien Termin aus:\n${d.terminLink}`,
        d.kalender !== false && "Im Anhang finden Sie die Absage für Ihren Kalender – damit verschwindet der Termin dort.",
        gruss(d.firma)),
      knopf: { label: "Neuen Termin wählen", url: d.terminLink },
    }),
    beispiel: { name: B.name, titel: "Kostenloses Erstgespräch – Website", start: IN_7, grund: "Ich bin an diesem Tag leider kurzfristig auf einem Kundentermin.", terminLink: `${BSP}/termin.html` },
  },
  anfrage_nachfassen: {
    gruppe: "Termine", titel: "Nachfrage zur Projektanfrage", an: "kunde",
    wann: "Automatisch, wenn nach einer Projektanfrage einige Zeit (Standard 48 Stunden) kein Gespräch vereinbart wurde.",
    baue: d => ({
      subject: `Ihre Anfrage bei ${marke(d.firma)}: Wann passt Ihnen ein kurzes Gespräch?`,
      text: absaetze(anrede(d), `vielen Dank noch einmal für Ihre Anfrage${d.arten ? ` (${d.arten})` : ""}. Am schnellsten kommen wir in einem ${fett("kostenlosen Erstgespräch")} weiter – 30 Minuten per Video, ganz unverbindlich.`,
        `Hier können Sie sich direkt einen freien Termin aussuchen:\n${d.terminLink}`,
        hinweis("Lieber erst telefonieren oder vorab etwas fragen? Buchen Sie dafür einfach einen kurzen Termin über den Link oben."),
        gruss(d.firma)),
      knopf: { label: "Termin auswählen", url: d.terminLink },
    }),
    beispiel: { name: B.name, arten: "Website, Online-Terminbuchung", terminLink: `${BSP}/termin.html` },
  },
  termin_neu_team: {
    gruppe: "Termine", titel: "Neuer Termin (an dich)", an: "team",
    wann: "Sobald jemand über die Website einen Termin bucht (ist sofort bestätigt).",
    baue: d => {
      const rest = ` · ${terminKurz(d.start)}`;
      return {
        subject: `Neuer Termin · ${kurz(wer(d.name, d.unternehmen), 78 - 15 - rest.length)}${rest}`,
        text: absaetze(`${d.name} hat über die Website einen Termin gebucht. Er ist bereits bestätigt und steht im Kalender.`,
          zeilen([["Termin", [d.art, d.produkt].filter(Boolean).join(" – ")], ["Datum", terminLang(d.start)], ["Dauer", d.minuten ? `${d.minuten} Minuten` : ""],
            ["Kosten", d.preis ? `${d.preis} € zzgl. MwSt. – Rechnung nach dem Termin` : ""],
            ["Name", d.name], ["Unternehmen", d.unternehmen], ["E-Mail", d.email], ["Telefon", d.telefon], ["Gespräch", d.kanal], ["Video", d.videoUrl]]),
          d.nachricht,
          `Im Board:\n${d.link}`),
        knopf: { label: "Im Kalender öffnen", url: d.link },
      };
    },
    beispiel: { ...B, art: "Kostenloses Erstgespräch", produkt: "Website", start: IN_7, minuten: 30, preis: 0, kanal: "Video", videoUrl: VIDEO,
      nachricht: "Themen: Website, Online-Terminbuchung\n\nWir möchten, dass Patienten ihre Termine online buchen können.", link: `${BSP}/admin/#termine` },
  },
  terminanfrage_team: {
    gruppe: "Termine", titel: "Terminanfrage aus dem Kundenportal (an dich)", an: "team",
    wann: "Wenn ein Kunde im Kundenportal einen Termin anfragt.",
    baue: d => {
      const slots = (d.wunsch || []).filter(Boolean);
      return {
        subject: `Terminanfrage · ${kurz(wer(d.name, d.unternehmen), 45)} · ${kurz(d.art, 25)}`,
        text: absaetze(`${wer(d.name, d.unternehmen)} möchte einen Termin vereinbaren.`,
          zeilen([["Anliegen", d.art], ["Dauer", d.minuten ? `${d.minuten} Minuten` : ""], ["Projekt", d.projekt]]),
          slots.length ? `Wunschtermine:\n${liste(slots.map(terminLang))}` : "Flexibel – bitte einen Termin vorschlagen.",
          d.nachricht,
          `Annehmen kannst du die Anfrage im Board:\n${d.link}`),
        knopf: { label: "Anfrage im Board öffnen", url: d.link },
      };
    },
    beispiel: { ...B, art: "Feedback zum Prototyp", minuten: 45, projekt: "Website Physiotherapie Am Park", wunsch: [IN_7, "2026-12-04T13:30:00.000Z"],
      nachricht: "Am liebsten vormittags, nachmittags habe ich Patienten.", link: `${BSP}/admin/#kunden/12/termine` },
  },

  /* ---------- Fragebögen ---------- */
  fragebogen_website: {
    gruppe: "Fragebögen", titel: "Fragebogen zur Website", an: "kunde",
    wann: "Gleich nach der Terminbestätigung, wenn es um eine Website geht (zweite Mail).",
    baue: d => fragebogenMail(d, FB.website, false),
    beispiel: { name: B.name, link: `${BSP}/portal/fragebogen.html#beispiel` },
  },
  fragebogen_website_erinnerung: {
    gruppe: "Fragebögen", titel: "Erinnerung: Fragebogen zur Website", an: "kunde",
    wann: "Wenn das Team im Board „Fragebogen erneut senden“ wählt und der Website-Fragebogen noch offen ist.",
    baue: d => fragebogenMail(d, FB.website, true),
    beispiel: { name: B.name, link: `${BSP}/portal/fragebogen.html#beispiel` },
  },
  fragebogen_software: {
    gruppe: "Fragebögen", titel: "Fragebogen zur Software", an: "kunde",
    wann: "Gleich nach der Terminbestätigung, wenn es nur um Software geht.",
    baue: d => fragebogenMail(d, FB.software, false),
    beispiel: { name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_software_erinnerung: {
    gruppe: "Fragebögen", titel: "Erinnerung: Fragebogen zur Software", an: "kunde",
    wann: "Wenn das Team im Board „Fragebogen erneut senden“ wählt und der Software-Fragebogen noch offen ist.",
    baue: d => fragebogenMail(d, FB.software, true),
    beispiel: { name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_hardware: {
    gruppe: "Fragebögen", titel: "Fragebogen zur Hardware", an: "kunde",
    wann: "Gleich nach der Terminbestätigung, wenn es nur um Hardware geht (Absender: Hardware GmbH, sobald aktiv).",
    baue: d => fragebogenMail(d, FB.hardware, false),
    beispiel: { firma: "hardware", name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_hardware_erinnerung: {
    gruppe: "Fragebögen", titel: "Erinnerung: Fragebogen zur Hardware", an: "kunde",
    wann: "Wenn das Team im Board „Fragebogen erneut senden“ wählt und der Hardware-Fragebogen noch offen ist.",
    baue: d => fragebogenMail(d, FB.hardware, true),
    beispiel: { firma: "hardware", name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_software_hardware: {
    gruppe: "Fragebögen", titel: "Fragebogen zu Software und Hardware", an: "kunde",
    wann: "Gleich nach der Terminbestätigung, wenn bei der Buchung Software und Hardware gewählt wurden.",
    baue: d => fragebogenMail(d, FB.beides, false),
    beispiel: { name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_software_hardware_erinnerung: {
    gruppe: "Fragebögen", titel: "Erinnerung: Fragebogen zu Software und Hardware", an: "kunde",
    wann: "Wenn das Team im Board „Fragebogen erneut senden“ wählt und der Fragebogen zu Software und Hardware noch offen ist.",
    baue: d => fragebogenMail(d, FB.beides, true),
    beispiel: { name: B.name, link: `${BSP}/portal/onboarding.html#beispiel` },
  },
  fragebogen_ausgefuellt_team: {
    gruppe: "Fragebögen", titel: "Fragebogen ausgefüllt (an dich)", an: "team",
    wann: "Wenn ein Interessent die Fragen zum Vorhaben (Software/Hardware) abschickt.",
    baue: d => ({
      subject: `Fragebogen ausgefüllt · ${kurz(wer(d.name || "Interessent", d.unternehmen), 48)}${d.bereiche ? ` · ${kurz(d.bereiche, 20)}` : ""}`,
      text: absaetze(`${d.name || "Ein Interessent"} hat den Fragebogen ausgefüllt${d.bereiche ? ` (${d.bereiche})` : ""}.`,
        d.projekte ? `Im Board ist dazu ${d.projekte === 1 ? "ein Projekt" : d.projekte + " Projekte"} im Status „Anfrage“ entstanden:\n${d.link}` : "Es konnte kein Projekt angelegt werden, weil kein Kontakt zugeordnet ist."),
      knopf: d.projekte ? { label: d.projekte === 1 ? "Projekt öffnen" : "Projekte öffnen", url: d.link } : undefined,
    }),
    beispiel: { name: B.name, unternehmen: B.unternehmen, bereiche: "Software", projekte: 1, link: `${BSP}/admin/#projekte/27` },
  },
  vorab_entwurf_team: {
    gruppe: "Fragebögen", titel: "Vorab-Entwurf fertig (an dich)", an: "team",
    wann: "Wenn aus dem Website-Fragebogen automatisch ein Vorab-Entwurf für das Erstgespräch gebaut wurde.",
    baue: d => {
      const rest = d.start ? ` · Gespräch ${terminKurz(d.start)}` : "";
      return {
        subject: `Vorab-Entwurf bereit · ${kurz(d.titel || d.unternehmen || d.name, 78 - 22 - rest.length)}${rest}`,
        text: absaetze(`Der Vorab-Entwurf für das Gespräch mit ${wer(d.name, d.unternehmen)} ist fertig:\n${d.url}`,
          d.start && zeilen([["Gespräch", terminLang(d.start)]]),
          d.angaben && `Angaben aus dem Fragebogen:\n${d.angaben}`),
        knopf: { label: "Entwurf ansehen", url: d.url },
      };
    },
    beispiel: { name: B.name, unternehmen: B.unternehmen, titel: B.unternehmen, start: IN_7, url: `${BSP}/p/beispiel/index.html`,
      angaben: "Branche: Physiotherapie\nErster Eindruck: ruhig, hell, vertrauenswürdig\nFarben: Salbeigrün, Weiß\nFunktionen: Online-Terminbuchung, Team, Leistungen" },
  },

  /* ---------- Angebote & Rechnungen ---------- */
  angebot_versand: {
    gruppe: "Angebote & Rechnungen", titel: "Angebot verschickt", an: "kunde",
    wann: "Wenn ein Angebot im Board festgeschrieben und verschickt wird; das Angebot hängt als PDF an.",
    baue: d => ({
      subject: kurz(`Ihr Angebot von ${marke(d.firma)}: ${d.titel || d.nummer}`, 90),
      text: absaetze(anrede(d),
        d.freitext || `${mitAnhang(d) ? "anbei" : "hiermit"} erhalten Sie unser Angebot${d.titel ? ` für „${d.titel}“` : ""}.`,
        zeilen([["Angebot", d.nummer], ["Projekt", d.titel], ["Betrag", `${euro(d.betrag)} brutto`], ["Gültig bis", datum(d.gueltigBis)]]),
        d.zugangLink
          ? schritte([["Zugang anlegen", "über den Link unten, das dauert etwa eine Minute (14 Tage gültig)."], ["Angebot ansehen und unterschreiben", "verbindlich annehmen direkt online."]])
          : `${fett("Angebot ansehen und unterschreiben")} – im Kundenportal nehmen Sie es verbindlich an:
${d.portalLink}`,
        d.zugangLink,
        pdfSatz("Das Angebot", mitAnhang(d)),
        hinweis("Fragen beantworten wir Ihnen gern über die Nachrichten in Ihrem Kundenportal."),
        gruss(d.firma)),
      knopf: d.zugangLink ? { label: "Zugang anlegen und Angebot ansehen", url: d.zugangLink } : { label: "Angebot ansehen und unterschreiben", url: d.portalLink },
    }),
    beispiel: { name: B.name, nummer: "A-2026-00014", titel: "Website Physiotherapie Am Park", betrag: 65807, gueltigBis: "2026-12-27", portalLink: `${BSP}/portal/#angebot/14` },
  },
  angebot_nachfrage: {
    gruppe: "Angebote & Rechnungen", titel: "Nachfrage zum Angebot", an: "kunde",
    wann: "Wenn der Inhaber im Cockpit beim Vorschlag „Angebot nachfassen“ auf „Erinnern“ klickt; das Angebot hängt noch einmal als PDF an.",
    baue: d => ({
      subject: `Kurze Nachfrage zu unserem Angebot ${d.nummer}`,
      text: absaetze(anrede(d),
        `vor ein paar Tagen haben wir Ihnen unser Angebot ${d.nummer}${d.titel ? ` für „${d.titel}“` : ""} geschickt. Passt alles für Sie, oder gibt es noch offene Fragen?`,
        `Gern gehen wir alles in einem ${fett("kurzen Gespräch")} durch. Einen Termin suchen Sie sich hier aus:\n${d.terminLink}`,
        pdfSatz("Das Angebot", mitAnhang(d), !!d.portalLink),
        d.portalLink && d.portalLink,
        gruss(d.firma)),
      knopf: { label: "Termin auswählen", url: d.terminLink },
    }),
    beispiel: { name: B.name, nummer: "A-2026-00014", titel: "Website Physiotherapie Am Park", terminLink: `${BSP}/termin.html`, portalLink: `${BSP}/portal/` },
  },
  auftrag_bestaetigung: {
    gruppe: "Angebote & Rechnungen", titel: "Auftragsbestätigung", an: "kunde",
    wann: "Sobald der Kunde ein Angebot im Kundenportal annimmt; die Auftragsbestätigung (mit Bedingungen und ggf. AVV) hängt als PDF an.",
    baue: d => ({
      subject: kurz(`Ihre Auftragsbestätigung von ${marke(d.firma)}: ${d.titel || d.nummer}`, 90),
      text: absaetze(anrede(d),
        `vielen Dank für Ihren Auftrag. Sie haben unser Angebot ${d.nummer}${d.titel ? ` („${d.titel}“)` : ""} über ${euro(d.betrag)} brutto am ${zeitpunkt(d.angenommenAm)} ${fett("angenommen")}.`,
        zeilen([["Angebot", d.nummer], ["Projekt", d.titel], ["Betrag", `${euro(d.betrag)} brutto`], ["Angenommen am", zeitpunkt(d.angenommenAm)]]),
        pdfSatz(`Die Auftragsbestätigung mit den vereinbarten Bedingungen${d.avv ? " und der Vereinbarung zur Auftragsverarbeitung" : ""}`, mitAnhang(d)),
        d.portalLink,
        hinweis("Wir melden uns in Kürze mit den nächsten Schritten."),
        gruss(d.firma)),
      knopf: { label: "Dokumente im Kundenportal", url: d.portalLink },
    }),
    beispiel: { name: B.name, nummer: "A-2026-00014", titel: "Website Physiotherapie Am Park", betrag: 65807, angenommenAm: "2026-11-27T13:05:00.000Z", avv: true, portalLink: `${BSP}/portal/#dokumente` },
  },
  auftrag_team: {
    gruppe: "Angebote & Rechnungen", titel: "Zusage: Angebot angenommen (an dich)", an: "team",
    wann: "Sobald ein Kunde ein Angebot im Kundenportal annimmt.",
    baue: d => {
      const rest = ` hat Angebot ${d.nummer} angenommen · ${euro0(d.netto)} netto`;
      return {
        subject: `Zusage · ${kurz(d.unternehmen, Math.max(18, 86 - 9 - rest.length))}${rest}`,
        text: absaetze(`${d.name}${d.position ? ` (${d.position})` : ""} hat Angebot ${d.nummer}${d.titel ? ` „${d.titel}“` : ""} im Kundenportal angenommen.`,
          zeilen([["Kunde", d.unternehmen], ["Angebot", d.nummer], ["Auftragswert", `${euro(d.netto)} netto / ${euro(d.brutto)} brutto`]]),
          d.geplant ? "Zahlungsplan und Rechnungsentwurf für die erste Rate sind angelegt – bitte im Board freigeben." : "Hinweis: Der Zahlungsplan des Projekts war schon in Bearbeitung und wurde nicht überschrieben.",
          `Zum Projekt:\n${d.link}`),
        knopf: { label: "Projekt öffnen", url: d.link },
      };
    },
    beispiel: { name: B.name, position: "Inhaberin", unternehmen: B.unternehmen, nummer: "A-2026-00014", titel: "Website Physiotherapie Am Park", netto: 55300, brutto: 65807, geplant: true, link: `${BSP}/admin/#projekte/27` },
  },
  angebot_abgelehnt_team: {
    gruppe: "Angebote & Rechnungen", titel: "Angebot abgelehnt (an dich)", an: "team",
    wann: "Wenn ein Kunde ein Angebot im Kundenportal ablehnt.",
    baue: d => {
      const kopf = `Abgelehnt · ${kurz(d.unternehmen, 35)} · ${d.nummer}`;
      return {
        subject: d.grund ? `${kopf}: „${kurz(d.grund, Math.max(12, 76 - kopf.length))}“` : kopf,
        text: absaetze(`${d.name} hat Angebot ${d.nummer} im Kundenportal abgelehnt.`,
          d.grund ? `Begründung:\n${d.grund}` : "(ohne Begründung)",
          `Zum Kunden:\n${d.link}`),
        knopf: { label: "Kunde öffnen", url: d.link },
      };
    },
    beispiel: { name: B.name, unternehmen: B.unternehmen, nummer: "A-2026-00014", grund: "Wir möchten das Projekt erst im Frühjahr angehen.", link: `${BSP}/admin/#kunden/12` },
  },
  rechnung_versand: {
    gruppe: "Angebote & Rechnungen", titel: "Rechnung verschickt", an: "kunde",
    wann: "Wenn eine Rechnung im Board festgeschrieben und verschickt wird; die Rechnung hängt als PDF an.",
    baue: d => ({
      subject: `Ihre Rechnung ${d.nummer} von ${marke(d.firma)}`,
      text: absaetze(anrede(d),
        d.freitext || `${mitAnhang(d) ? "anbei" : "hiermit"} erhalten Sie unsere Rechnung${d.titel ? ` für „${d.titel}“` : ""}.${datum(d.faellig) ? ` Bitte überweisen Sie den Betrag ${fett("bis " + datum(d.faellig))}.` : ""}`,
        zeilen([["Rechnung", d.nummer], ["Projekt", d.titel], ["Betrag", euro(d.betrag)], ["Zahlbar bis", datum(d.faellig)]]),
        pdfSatz("Die Rechnung", mitAnhang(d)),
        d.portalLink,
        hinweis("Fragen zur Rechnung beantworten wir Ihnen gern über die Nachrichten in Ihrem Kundenportal."),
        gruss(d.firma)),
      knopf: { label: "Im Kundenportal ansehen", url: d.portalLink },
    }),
    beispiel: { name: B.name, nummer: "R-2026-00031", titel: "Website Physiotherapie Am Park – Anzahlung", betrag: 32904, faellig: "2026-12-11", portalLink: `${BSP}/portal/#dokumente` },
  },
  storno_versand: {
    gruppe: "Angebote & Rechnungen", titel: "Stornorechnung verschickt", an: "kunde",
    wann: "Wenn eine Rechnung im Board storniert und die Stornorechnung verschickt wird; sie hängt als PDF an.",
    baue: d => ({
      subject: `Stornorechnung ${d.nummer} von ${marke(d.firma)}`,
      text: absaetze(anrede(d),
        d.freitext || `${mitAnhang(d) ? "anbei" : "hiermit"} erhalten Sie die Stornorechnung${d.storniert ? ` zu unserer Rechnung ${fett(d.storniert)}` : ""}.`,
        zeilen([["Stornorechnung", d.nummer], ["Storniert wird", d.storniert ? `Rechnung ${d.storniert}` : ""], ["Projekt", d.titel], ["Betrag", euro(Math.abs(d.betrag || 0))]]),
        pdfSatz("Die Stornorechnung", mitAnhang(d)),
        d.portalLink,
        hinweis("Fragen beantworten wir Ihnen gern über die Nachrichten in Ihrem Kundenportal."),
        gruss(d.firma)),
      knopf: { label: "Im Kundenportal ansehen", url: d.portalLink },
    }),
    beispiel: { name: B.name, nummer: "S-2026-00002", titel: "Website Physiotherapie Am Park – Anzahlung", storniert: "R-2026-00031", betrag: -32904, portalLink: `${BSP}/portal/#dokumente` },
  },
  zahlungserinnerung: {
    gruppe: "Angebote & Rechnungen", titel: "Zahlungserinnerung", an: "kunde",
    wann: "Wenn im Board bei einer überfälligen Rechnung die erste Erinnerung verschickt wird; die Rechnung hängt als PDF an.",
    baue: d => ({
      subject: `Zahlungserinnerung: Rechnung ${d.nummer}`,
      text: absaetze(anrede(d),
        `sicher ist es Ihnen im Alltag nur durchgerutscht: Unsere Rechnung ${d.nummer} vom ${datum(d.datum)} über ${euro(d.betrag)} war am ${datum(d.faellig)} fällig. Wir bitten Sie, den Betrag ${fett("bis zum " + datum(d.frist))} zu überweisen.`,
        zeilen([["Rechnung", d.nummer], ["Betrag", euro(d.betrag)], ["Bitte überweisen bis", datum(d.frist)]]),
        pdfSatz("Die Rechnung", mitAnhang(d), false),
        hinweis("Sollte sich Ihre Zahlung mit dieser Nachricht überschnitten haben, betrachten Sie sie bitte als gegenstandslos."),
        gruss(d.firma)),
    }),
    beispiel: { name: B.name, nummer: "R-2026-00031", datum: "2026-11-06", betrag: 32904, faellig: "2026-11-20", frist: "2026-12-04" },
  },
  mahnung: {
    gruppe: "Angebote & Rechnungen", titel: "Mahnung (1. bis 3.)", an: "kunde",
    wann: "Wenn im Board nach der Zahlungserinnerung eine Mahnung verschickt wird; die Rechnung hängt als PDF an.",
    baue: d => ({
      subject: `${d.stufe || "Mahnung"}: Rechnung ${d.nummer}`,
      text: absaetze(anrede(d),
        `trotz unserer Zahlungserinnerung ist der Betrag aus Rechnung ${d.nummer} über ${euro(d.betrag)} bisher nicht bei uns eingegangen. Bitte überweisen Sie den offenen Betrag ${fett("bis spätestens " + datum(d.frist))}${d.iban ? ` auf das Konto IBAN ${d.iban}` : ""}.`,
        zeilen([["Rechnung", d.nummer], ["Offener Betrag", euro(d.betrag)], ["Zahlbar bis spätestens", datum(d.frist)], ["IBAN", d.iban]]),
        pdfSatz("Die Rechnung", mitAnhang(d), false),
        hinweis("Fragen beantworten wir Ihnen gern über die Nachrichten in Ihrem Kundenportal."),
        gruss(d.firma)),
    }),
    beispiel: { name: B.name, stufe: "1. Mahnung", nummer: "R-2026-00031", betrag: 32904, frist: "2026-12-04", iban: "DE00 0000 0000 0000 0000 00" },
  },
  /* ---------- Projekt & Portal ---------- */
  projektanfrage_eingang: {
    gruppe: "Projekt & Portal", titel: "Eingangsbestätigung Projektanfrage", an: "kunde",
    wann: "Direkt nachdem jemand das Projektformular auf der Website abgeschickt hat.",
    baue: d => ({
      subject: `Ihre Projektanfrage bei ${marke(d.firma)} ist angekommen`,
      text: absaetze(anrede(d),
        "vielen Dank für Ihre Anfrage. Wir melden uns innerhalb eines Werktags mit ersten Gedanken und einem Terminvorschlag.",
        zeilen([["Art", d.arten], ["Modell", d.modell]]),
        d.beschreibung && `Ihre Beschreibung:\n${d.beschreibung}`,
        gruss(d.firma)),
    }),
    beispiel: { name: B.name, arten: "Website, Online-Terminbuchung", modell: "Einmalpreis", beschreibung: "Unsere Praxis braucht eine neue Website, auf der Patienten auch direkt Termine buchen können." },
  },
  projektanfrage_team: {
    gruppe: "Projekt & Portal", titel: "Neue Projektanfrage (an dich)", an: "team",
    wann: "Wenn jemand das Projektformular auf der Website abschickt.",
    baue: d => ({
      subject: `Neue Projektanfrage · ${kurz(wer(d.name, d.unternehmen), 45)}${d.arten ? ` · ${kurz(d.arten, 20)}` : ""}`,
      text: absaetze(`${wer(d.name, d.unternehmen)} hat über die Website eine Projektanfrage geschickt.`,
        zeilen([["Art", d.arten], ["Modell", d.modell], ["Budget", d.budget], ["Start", d.start], ["Name", d.name], ["E-Mail", d.email], ["Telefon", d.telefon], ["Unternehmen", d.unternehmen]]),
        d.beschreibung,
        `Im Vertrieb:\n${d.link}`),
      knopf: { label: "Im Vertrieb öffnen", url: d.link },
    }),
    beispiel: { ...B, arten: "Website, Online-Terminbuchung", modell: "Einmalpreis", budget: "3.000–6.000 €", start: "in den nächsten 3 Monaten",
      beschreibung: "Unsere Praxis braucht eine neue Website, auf der Patienten auch direkt Termine buchen können.", link: `${BSP}/admin/#anfragen` },
  },
  portal_nachricht: {
    gruppe: "Projekt & Portal", titel: "Neue Nachricht im Kundenportal", an: "kunde",
    wann: "Wenn das Team im Kundenportal schreibt (höchstens eine Mail je 30 Minuten; nur bei eingeschalteter Benachrichtigung).",
    baue: d => ({
      subject: `Neue Nachricht von ${marke(d.firma)} in Ihrem Kundenportal`,
      text: absaetze(anrede(d), "in Ihrem Kundenportal wartet eine neue Nachricht von unserem Team.", `Zur Nachricht:\n${d.link}`, gruss(d.firma)),
      knopf: { label: "Nachricht lesen", url: d.link },
    }),
    beispiel: { name: B.name, link: `${BSP}/portal/` },
  },
  portal_erinnerung: {
    gruppe: "Projekt & Portal", titel: "Erinnerung: liegt im Kundenportal bereit", an: "kunde",
    wann: "Wenn eine Chat-Karte (neuer Stand, Dokument, Zusammenfassung, Rückfragen) nach zwei Stunden noch ungelesen ist – oder wenn du etwas über „Erneut schicken“ per E-Mail nachschickst.",
    baue: d => {
      const liste = (d.punkte || []).filter(Boolean);
      return {
        subject: liste.length === 1 ? `Für Sie bereit: ${kurz(liste[0], 60)}` : `${liste.length || "Neue"} Neuigkeiten in Ihrem Kundenportal`,
        text: absaetze(anrede(d),
          liste.length === 1 ? `in Ihrem Kundenportal liegt für Sie bereit: ${fett(einzeilig(liste[0]))}.` : "in Ihrem Kundenportal liegt Folgendes für Sie bereit:",
          liste.length > 1 ? liste.map(p => `- ${einzeilig(p)}`).join("\n") : "",
          d.link, gruss(d.firma)),
        knopf: { label: "Im Kundenportal ansehen", url: d.link },
      };
    },
    beispiel: { name: B.name, punkte: ["Neuer Stand: Website Physiotherapie Am Park (Version 3)"], link: `${BSP}/portal/#chat/27` },
  },
  chat_team: {
    gruppe: "Projekt & Portal", titel: "Neue Nachricht eines Kunden (an dich)", an: "team",
    wann: "Wenn ein Kunde im Kundenportal schreibt (höchstens eine Mail je 30 Minuten).",
    baue: d => ({
      subject: `Neue Nachricht · ${kurz(d.name, 30)}: „${kurz(d.nachricht, 40)}“`,
      text: absaetze(`${wer(d.name, d.unternehmen)} schreibt:`, d.nachricht, `Antworten im Board:\n${d.link}`),
      knopf: { label: "Im Board antworten", url: d.link },
    }),
    beispiel: { ...B, nachricht: "Können wir auf der Startseite noch ein Foto vom Team einbauen? Die Bilder schicke ich Ihnen bis Freitag.", link: `${BSP}/admin/#kunden/12/chat` },
  },
  projekt_neuigkeiten: {
    gruppe: "Projekt & Portal", titel: "Neuigkeiten zum Projekt", an: "kunde",
    wann: "Gebündelt kurz nach neuen Meilensteinen im Projekt (nur bei eingeschalteter Benachrichtigung).",
    baue: d => ({
      subject: d.projekt ? `Neuigkeiten zu Ihrem Projekt „${kurz(d.projekt, 50)}“` : "Neuigkeiten in Ihrem Kundenportal",
      text: absaetze(anrede(d), "es gibt Neuigkeiten in Ihrem Kundenportal:", liste(d.punkte),
        `Alle Details finden Sie hier:\n${d.link}`, gruss(d.firma),
        "—\nDiese Benachrichtigungen können Sie im Kundenportal unter „Konto“ abschalten."),
      knopf: { label: "Im Kundenportal ansehen", url: d.link },
    }),
    beispiel: { name: B.name, projekt: "Website Physiotherapie Am Park", punkte: ["Phase: Prototyp – Der klickbare Entwurf steht bereit.", "Neuer Prototyp – Startseite und Leistungen, Version 2"], link: `${BSP}/portal/#projekt/27` },
  },
  rueckfragen: {
    gruppe: "Projekt & Portal", titel: "Rückfragen zum Projekt", an: "kunde",
    wann: "Wenn der Inhaber im Arbeitsbereich eines Projekts offene Fragen an den Kunden schickt und „Zusätzlich per E-Mail benachrichtigen“ angehakt lässt. Nur eine Benachrichtigung – die Fragen selbst stehen im Kundenportal unter „Rückfragen“.",
    baue: d => {
      // Die Fragen stehen bewusst nicht in der Mail: Beantwortet werden sie einzeln im Portal, sonst kommt die Antwort nicht im Board an
      const n = (d.fragen || []).filter(Boolean).length || +d.anzahl || 0;
      const was = n > 1 ? `${n} Rückfragen` : n === 1 ? "eine Rückfrage" : "Rückfragen";
      return {
        subject: `${n === 1 ? "Eine Rückfrage" : "Rückfragen"} zu Ihrem Projekt „${kurz(d.projekt, 50)}“`,
        text: absaetze(anrede(d),
          `in Ihrem Kundenportal ${n === 1 ? "wartet" : "warten"} ${fett(`${was} zu Ihrem Projekt „${einzeilig(d.projekt)}“`)} auf Sie. Sie finden sie im Chat zu Ihrem Projekt und können dort direkt antworten – Ihre Antwort kommt sofort bei uns an.`,
          d.link,
          gruss(d.firma)),
        knopf: { label: "Im Chat beantworten", url: d.link },
      };
    },
    beispiel: { name: B.name, projekt: "Website Physiotherapie Am Park", fragen: ["Sollen die Öffnungszeiten auf jeder Seite unten stehen?", "Haben Sie Fotos der Praxisräume, oder sollen wir einen Fotografen vorschlagen?", "Wie lautet Ihre Umsatzsteuer-ID für das Impressum?"], link: `${BSP}/portal/#chat/27` },
  },
  rueckfrage_beantwortet_team: {
    gruppe: "Projekt & Portal", titel: "Kunde hat eine Rückfrage beantwortet (an dich)", an: "team",
    wann: "Wenn ein Kunde im Kundenportal unter „Rückfragen“ eine Frage beantwortet. Die Antwort steht dann schon als geklärt im Arbeitsbereich und kommt über die Brücke in Claudes Projektordner.",
    baue: d => ({
      subject: `Antwort · ${kurz(d.unternehmen || d.name, 30)} · ${kurz(d.frage, 40)}`,
      text: absaetze(`${wer(d.name, d.unternehmen)} hat im Kundenportal eine Rückfrage beantwortet.`,
        zeilen([["Projekt", einzeilig(d.projekt)], ["Frage", einzeilig(d.frage)]]),
        d.antwort && `Antwort:\n${d.antwort}`,
        "Die Frage ist im Arbeitsbereich als geklärt eingetragen, Claude bekommt die Antwort im Projektordner.",
        `Zum Projekt:\n${d.link}`),
      knopf: { label: "Projekt öffnen", url: d.link },
    }),
    beispiel: { ...B, projekt: "Website Physiotherapie Am Park", frage: "Wie lautet Ihre Umsatzsteuer-ID für das Impressum?", antwort: "DE123456789", link: `${BSP}/admin/#projekte/27` },
  },
  konzept_versand: {
    gruppe: "Projekt & Portal", titel: "Entwicklungskonzept (Hardware)", an: "kunde",
    wann: "Wenn der Inhaber im Hardware-Projekt die Kundenfassung des Konzepts verschickt; das Konzept hängt als PDF an.",
    baue: d => ({
      subject: `Ihr Entwicklungskonzept: ${kurz(d.titel, 50)}${d.version ? ` (Version ${d.version})` : ""}`,
      text: absaetze(anrede(d),
        `hier ist das ${fett("Entwicklungskonzept")} zu „${d.titel}“: die Anforderungen, die gewählte Lösung, den Aufbau mit Ansichten aus dem 3D-Modell, die geschätzten Materialkosten sowie die Prüfpunkte und offenen Punkte.`,
        zeilen([["Konzept", d.titel], ["Version", d.version]]),
        pdfSatz("Das Konzept", mitAnhang(d), !!d.portalLink),
        d.portalLink,
        hinweis("Schauen Sie es in Ruhe durch. Ihre Fragen und Anmerkungen besprechen wir gern in einem Termin."),
        gruss(d.firma)),
      knopf: d.portalLink ? { label: "Im Kundenportal ansehen", url: d.portalLink } : undefined,
    }),
    beispiel: { firma: "hardware", name: B.name, titel: "Therapie-Timer mit Tastenfeld", version: 2, portalLink: `${BSP}/portal/` },
  },
  /* ---------- Support ---------- */
  support_neu_team: {
    gruppe: "Support", titel: "Neue Support-Anfrage (an dich)", an: "team",
    wann: "Wenn ein Kunde im Kundenportal eine Support-Anfrage stellt (an Inhaber und zuständige Person).",
    baue: d => {
      const kopf = `${d.kritisch ? "Kritisch · " : ""}Support #${d.id} · ${kurz(d.unternehmen, 30)}`;
      return {
        subject: `${kopf}: ${kurz(d.betreff, Math.max(15, 80 - kopf.length))}`,
        text: absaetze(`${wer(d.name, d.unternehmen)} hat eine neue Support-Anfrage gestellt.`,
          zeilen([["Betreff", d.betreff], ["Art", d.kategorie], ["Projekt", d.projekt], ["Dringlichkeit", d.prioritaet], ["Antwort fällig bis", d.faellig ? zeitpunkt(d.faellig) : ""]]),
          d.nachricht,
          `Zur Anfrage:\n${d.link}`),
        knopf: { label: "Anfrage öffnen", url: d.link },
      };
    },
    beispiel: { ...B, id: 42, betreff: "Kontaktformular verschickt keine Mails", kategorie: "Fehler", projekt: "Website Physiotherapie Am Park", prioritaet: "Hoch – wichtige Funktion gestört",
      kritisch: false, faellig: "2026-11-30T15:00:00.000Z", nachricht: "Seit gestern kommen über das Kontaktformular keine Anfragen mehr bei uns an.", link: `${BSP}/admin/#support/42` },
  },
  support_antwort_team: {
    gruppe: "Support", titel: "Kunde hat im Support geantwortet (an dich)", an: "team",
    wann: "Wenn ein Kunde auf eine Support-Anfrage antwortet.",
    baue: d => {
      const kopf = `Kundenantwort · Support #${d.id} · ${kurz(d.unternehmen, 28)}`;
      return {
        subject: `${kopf}: ${kurz(d.betreff, Math.max(15, 80 - kopf.length))}`,
        text: absaetze(`${d.name} hat geantwortet:`, d.nachricht, `Zur Anfrage:\n${d.link}`),
        knopf: { label: "Anfrage öffnen", url: d.link },
      };
    },
    beispiel: { ...B, id: 42, betreff: "Kontaktformular verschickt keine Mails", nachricht: "Danke, jetzt kommt alles wieder an.", link: `${BSP}/admin/#support/42` },
  },
  support_zugewiesen: {
    gruppe: "Support", titel: "Support-Anfrage an dich übergeben", an: "team",
    wann: "Wenn jemand im Board eine Support-Anfrage einer anderen Person zuweist.",
    baue: d => {
      const kopf = `Für dich · Support #${d.id} · ${kurz(d.unternehmen, 28)}`;
      return {
        subject: `${kopf}: ${kurz(d.betreff, Math.max(15, 80 - kopf.length))}`,
        text: absaetze(`${d.von} hat dir die Anfrage von ${d.unternehmen} zugewiesen.`, zeilen([["Betreff", d.betreff]]), `Zur Anfrage:\n${d.link}`),
        knopf: { label: "Anfrage öffnen", url: d.link },
      };
    },
    beispiel: { id: 42, unternehmen: B.unternehmen, betreff: "Kontaktformular verschickt keine Mails", von: "Vincent Reeder", link: `${BSP}/admin/#support/42` },
  },
  support_antwort: {
    gruppe: "Support", titel: "Antwort des Teams auf eine Support-Anfrage", an: "kunde",
    wann: "Wenn das Team im Board auf eine Support-Anfrage antwortet (keine internen Notizen).",
    baue: d => ({
      subject: `Re: ${kurz(d.betreff, 60)} [Support #${d.id}]`,
      text: absaetze(anrede(d), d.nachricht,
        `Antworten und den ganzen Verlauf finden Sie im Kundenportal:\n${d.link}`,
        d.geloest && hinweis("Wir haben die Anfrage als gelöst markiert. Falls doch noch etwas ist, antworten Sie einfach im Kundenportal – dann öffnet sie sich wieder."),
        gruss(d.firma, d.absender)),
      knopf: { label: "Verlauf im Kundenportal", url: d.link },
    }),
    beispiel: { name: B.name, id: 42, betreff: "Kontaktformular verschickt keine Mails", nachricht: "der Fehler lag an einer abgelaufenen Mail-Einstellung. Wir haben sie erneuert, Anfragen kommen wieder an.", geloest: true, link: `${BSP}/portal/#support/42`, absender: "Vincent Reeder" },
  },
  support_erinnerung: {
    gruppe: "Support", titel: "Erinnerung: Rückmeldung zur Support-Anfrage", an: "kunde",
    wann: "Automatisch, wenn eine Anfrage einige Tage (Standard 4) auf eine Rückmeldung des Kunden wartet.",
    baue: d => ({
      subject: `Wir warten noch auf Ihre Rückmeldung [Support #${d.id}]`,
      text: absaetze(anrede(d), `zu Ihrer Anfrage „${d.betreff}“ brauchen wir noch eine ${fett("kurze Rückmeldung")} von Ihnen.`,
        `Antworten Sie einfach im Kundenportal:\n${d.link}`,
        hinweis("Hat sich die Sache schon erledigt? Dann markieren Sie die Anfrage im Kundenportal einfach als erledigt."),
        gruss(d.firma)),
      knopf: { label: "Im Kundenportal antworten", url: d.link },
    }),
    beispiel: { name: B.name, id: 42, betreff: "Kontaktformular verschickt keine Mails", link: `${BSP}/portal/#support/42` },
  },
  /* ---------- Konto & Zugang ---------- */
  portal_zugang: {
    gruppe: "Konto & Zugang", titel: "Zugang zum Kundenportal", an: "kunde",
    wann: "Wenn das Team im Board einen Kundenzugang einrichtet oder die Einladung erneut schickt.",
    baue: d => ({
      subject: `Ihr Zugang zum Kundenportal von ${marke(d.firma)}`,
      text: absaetze(anrede(d),
        `für ${d.unternehmen || "Sie"} haben wir einen Zugang zu unserem Kundenportal eingerichtet. Dort schreiben Sie direkt mit unserem Team und klicken sich durch die Prototypen, die wir für Sie bauen.`,
        schritte([["Passwort festlegen", `über den Link unten (${d.tage || 14} Tage gültig).`], ["Anmelden", "ab dann jederzeit mit Ihrer E-Mail-Adresse und dem Passwort."]]),
        d.link,
        gruss(d.firma)),
      knopf: { label: "Passwort festlegen", url: d.link },
    }),
    beispiel: { name: B.name, unternehmen: B.unternehmen, tage: 14, link: `${BSP}/portal/#einladung=beispiel` },
  },
  passwort_link: {
    gruppe: "Konto & Zugang", titel: "Neues Passwort festlegen", an: "kunde",
    wann: "Wenn jemand auf der Anmeldeseite (Board oder Kundenportal) „Passwort vergessen“ wählt.",
    baue: d => ({
      subject: `Ihr Link für ein neues Passwort – ${marke(d.firma)}`,
      text: absaetze(anrede(d),
        `für Ihren Zugang wurde ein neues Passwort angefordert. Über diesen Link ${fett("legen Sie es fest")} (eine Stunde gültig):\n${d.link}`,
        hinweis("Wenn Sie das nicht waren, ignorieren Sie diese E-Mail einfach – Ihr bisheriges Passwort bleibt gültig."),
        gruss(d.firma)),
      knopf: { label: "Neues Passwort festlegen", url: d.link },
    }),
    beispiel: { name: B.name, link: `${BSP}/portal/#passwort=beispiel` },
  },
  team_einladung: {
    gruppe: "Konto & Zugang", titel: "Einladung ins Team-Board", an: "team",
    wann: "Wenn der Inhaber im Board jemanden ins Team einlädt.",
    baue: d => ({
      subject: `Einladung ins Board von ${marke(d.firma)}`,
      text: absaetze(`Hallo ${d.name},`,
        `du wurdest als ${d.rolle} ins Board der ${firmenname(d.firma)} eingeladen. Über diesen Link legst du dein Passwort fest (14 Tage gültig):\n${d.link}`,
        gruss(d.firma, d.von)),
      knopf: { label: "Passwort festlegen", url: d.link },
    }),
    beispiel: { name: "Jonas Weber", rolle: "Entwickler", von: "Vincent Reeder", link: `${BSP}/admin/#einladung=beispiel` },
  },

  /* ---------- Intern ---------- */
  wochenbericht: {
    gruppe: "Intern", titel: "Wochenbericht", an: "team",
    wann: "Einmal pro Woche (Standard Montag, 7 Uhr) an den Inhaber; auch von Hand im Board.",
    baue: d => ({
      subject: `Wochenbericht KW ${d.kw} · ${d.aktiv} aktive Projekte · ${euro0(d.offen)} offen`,
      text: absaetze(`Wochenbericht ${firmenname(d.firma)} · KW ${d.kw}`, (d.zeilen || []).join("\n").trim(), `Alles im Board:\n${d.link}`),
      knopf: { label: "Cockpit öffnen", url: d.link },
    }),
    beispiel: { kw: 49, aktiv: 6, offen: 1240000, link: `${BSP}/admin/#cockpit`, zeilen: [
      "VERTRIEB (letzte 7 Tage)", "· Neue Anfragen: 3 (Website-Termine 2, Projektanfragen 1)", "· Termine geführt: 4", "· Neue Kunden: 1 – Physiotherapie Am Park", "· Offene Angebote: 2 über 9.800 €", "",
      "GELD", "· Eingegangen in den letzten 7 Tagen: 3.290 € · im laufenden Monat: 7.450 €", "· Offene Rechnungen: 3 über 12.400 €", "",
      "PROJEKTE", "· Aktiv: 6 (Konzept 2 · Prototyp 2 · Umsetzung 2)", "· Ohne Team: 0 · Offene Kunden-Anmerkungen: 3", "",
      "DIESE WOCHE: 2 Termine", "· Do., 3. Dez., 10:00 Uhr – Projekt-Abstimmung (Physiotherapie Am Park)", "· Fr., 4. Dez., 14:30 Uhr – Feedback zum Prototyp (Bäckerei Sonnenkorn)", "",
      "DIE 2 WICHTIGSTEN PUNKTE DIESER WOCHE", "1. Angebot nachfassen · Bäckerei Sonnenkorn\n   A-2026-00012 über 4.200,00 € – seit 8 Tagen ohne Antwort."] },
  },
  status_ausfall: {
    gruppe: "Intern", titel: "Seite nicht erreichbar (an dich)", an: "team",
    wann: "Wenn eine überwachte Website oder App nicht mehr antwortet (einmal pro Ausfall).",
    baue: d => ({
      subject: `🔴 Nicht erreichbar · ${kurz(d.name, 60)}`,
      text: absaetze(`${d.name} antwortet nicht.`, zeilen([["Adresse", d.url], ["Fehler", d.fehler], ["Kunde", d.unternehmen]]),
        d.intervall ? `Das Board prüft alle ${d.intervall} Minuten.` : "", `Im Board:\n${d.link}`),
      knopf: { label: "Betrieb öffnen", url: d.link },
    }),
    beispiel: { name: "Website Physiotherapie Am Park", url: "https://www.physio-am-park.example", fehler: "Zeitüberschreitung nach 10 Sekunden", unternehmen: B.unternehmen, intervall: 5, link: `${BSP}/admin/#einstellungen/betrieb` },
  },
  status_wieder: {
    gruppe: "Intern", titel: "Seite wieder erreichbar (an dich)", an: "team",
    wann: "Wenn eine überwachte Website oder App nach einem Ausfall wieder antwortet.",
    baue: d => ({
      subject: `✅ Wieder erreichbar · ${kurz(d.name, 60)}`,
      text: absaetze(`${d.name} antwortet wieder${d.ms != null ? ` (${d.ms} ms)` : ""}.`, zeilen([["Adresse", d.url], ["Kunde", d.unternehmen]]),
        d.intervall ? `Das Board prüft alle ${d.intervall} Minuten.` : "", `Im Board:\n${d.link}`),
      knopf: { label: "Betrieb öffnen", url: d.link },
    }),
    beispiel: { name: "Website Physiotherapie Am Park", url: "https://www.physio-am-park.example", ms: 412, unternehmen: B.unternehmen, intervall: 5, link: `${BSP}/admin/#einstellungen/betrieb` },
  },
};

/** Fertige Mail-Felder für sendMail: { subject, text, knopf, art, firma }.
 *  daten.firma = "software" (Vorgabe) | "hardware". Mit { vorschau: true } gilt "hardware" auch bei noch nicht aktiver Hardware GmbH. */
export function vorlage(schluessel, daten = {}, { vorschau = false } = {}) {
  const v = VORLAGEN[schluessel];
  if (!v) throw new Error(`Unbekannte Mail-Vorlage: ${schluessel}`);
  vorschauLaeuft = !!vorschau;
  let d, r;
  try { d = { ...(daten || {}) }; d.firma = firmaKey(d.firma); r = v.baue(d); }
  finally { vorschauLaeuft = false; }
  return { subject: einzeilig(r.subject), text: r.text, knopf: r.knopf?.url ? r.knopf : undefined, art: schluessel, firma: d.firma, an: v.an === "team" ? "team" : "kunde" };
}
