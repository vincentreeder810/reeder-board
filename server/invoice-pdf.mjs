// Rechnungs-, Storno- und Angebots-PDF (DIN-5008-nah, Pflichtangaben nach § 14 Abs. 4 UStG).
// Gestaltung: warmer Papierton, Segel als zartes Wasserzeichen in der Blattmitte, durchgehend Inter (frei nutzbar, der Apple-Schrift
// San Francisco sehr ähnlich – diese selbst darf nicht in eigene Dokumente eingebettet werden), Positionen als Liste, viel Weißraum.
// Nichts fließt von selbst auf eine neue Seite: Summen und Hinweise bleiben zusammen, jede Seite trägt Fußzeile und Seitenzahl.
import PDFDocument from "pdfkit";
import path from "node:path";

const FONTS = path.resolve("assets/fonts");
const mm = v => v * 72 / 25.4;
const INK = "#0a0a0c", INK2 = "#3a3a3f", MUTED = "#8a8a90", LINE = "#e3e1da", PAPIER = "#fbfaf6", BAND = "#f3f1ea";
const euro = c => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const dateDe = ymd => ymd ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(ymd + "T00:00:00Z")) : "";
const qtyDe = q => Number(q).toLocaleString("de-DE", { maximumFractionDigits: 3 });
const title = inv => inv.kind === "angebot" ? "Angebot" : inv.kind === "storno" ? "Stornorechnung" : "Rechnung";
const gradientFor = (doc, x1, y1, x2, y2) => { const g = doc.linearGradient(x1, y1, x2, y2); g.stop(0, "#4f7cff").stop(.55, "#8b5cf6").stop(1, "#ec4899"); return g; };
const SEGEL_1 = "M52 10C66 30 75 54 78 80H52Z", SEGEL_2 = "M45 28C37 44 30 62 27 80H45Z";

/** inv: Rechnung inkl. sender/recipient (Objekte) und items[] → Buffer (PDF) */
export function renderInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `${title(inv)} ${inv.number || "Entwurf"}`, Author: inv.sender.name || "Reeder Software GmbH", Creator: "Reeder Board" } });
    const chunks = []; doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("R", path.join(FONTS, "Inter_400Regular.ttf")); doc.registerFont("M", path.join(FONTS, "Inter_500Medium.ttf"));
    doc.registerFont("S", path.join(FONTS, "Inter_600SemiBold.ttf")); doc.registerFont("B", path.join(FONTS, "Inter_700Bold.ttf"));
    
    const s = inv.sender, r = inv.recipient, L = mm(25), R = mm(190), W = R - L, PW = doc.page.width, PH = doc.page.height;
    const UNTEN = mm(263.5);   // Unterkante des Inhalts, darunter steht die Fußzeile

    // Papier: warmer Ton, feiner Farbstreifen oben, das Segel groß und kaum sichtbar unten rechts
    const papier = () => {
      doc.save(); doc.rect(0, 0, PW, PH).fill(PAPIER);
      doc.rect(0, 0, PW, mm(1.6)).fill(gradientFor(doc, 0, 0, PW, 0));
      // Segel unten rechts: Die Grundlinie des Segels liegt auf der Blattunterkante, wie ein Schiff am Horizont
      doc.translate(PW - mm(16), PH).scale(mm(118) / 70).translate(-78, -80);
      doc.fillOpacity(0.045); doc.path(SEGEL_1).fill(gradientFor(doc, 52, 10, 78, 80)); doc.fillOpacity(0.024); doc.path(SEGEL_2).fill(INK);
      doc.restore(); doc.fillOpacity(1);
    };
    papier(); doc.on("pageAdded", papier);
    const klein = (t, x, y, o = {}) => doc.font("S").fontSize(6.8).fillColor(MUTED).text(String(t).toUpperCase(), x, y, { characterSpacing: 0.9, lineBreak: false, ...o });

    // Kopf: Segel und Name links, Anschrift des Absenders rechts
    doc.save().translate(L, mm(15)).scale(mm(13) / 72).translate(-16.5, -9);
    doc.path(SEGEL_1).fill(gradientFor(doc, 52, 10, 78, 80)); doc.path(SEGEL_2).fill(INK); doc.restore();
    doc.font("B").fontSize(15).fillColor(INK).text("Reeder", L + mm(16), mm(18), { continued: true }).font("R").fillColor(MUTED).text(" " + (s.brand || "Software"));
    doc.font("R").fontSize(8.2).fillColor(MUTED).text([s.street, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(" · "), L, mm(17.6), { width: W, align: "right" });
    doc.text([s.email, s.phone, s.website].filter(Boolean).join(" · "), L, mm(21.6), { width: W, align: "right" });
    if (inv.draft) doc.font("B").fontSize(54).fillColor("#ece8dc").text("Entwurf", L, mm(150), { width: W, align: "center", characterSpacing: -1.5 });

    // Anschriftfeld (DIN 5008, Form B)
    doc.font("R").fontSize(6.8).fillColor(MUTED).text([s.name, s.street, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(" · "), L, mm(47), { width: mm(85) });
    doc.moveTo(L, mm(50.4)).lineTo(L + mm(85), mm(50.4)).lineWidth(.4).strokeColor(LINE).stroke();
    doc.font("R").fontSize(10.5).fillColor(INK).text([r.company, r.name && r.name !== r.company ? (r.company ? "z. Hd. " : "") + r.name : "", r.street, [r.zip, r.city].filter(Boolean).join(" "), r.country && r.country !== "Deutschland" ? r.country : ""].filter(Boolean).join("\n"), L, mm(54), { width: mm(85), lineGap: 2 });

    // Angaben rechts: kleine Überschrift, darunter der Wert
    const info = [
      [inv.kind === "angebot" ? "Angebotsnummer" : inv.kind === "storno" ? "Stornonummer" : "Rechnungsnummer", inv.number || "– Entwurf –"],
      [inv.kind === "angebot" ? "Angebotsdatum" : "Rechnungsdatum", dateDe(inv.issue_date)],
      ...(inv.kind !== "angebot" ? [["Leistungszeitraum", inv.service_from ? (inv.service_to && inv.service_to !== inv.service_from ? `${dateDe(inv.service_from)} – ${dateDe(inv.service_to)}` : dateDe(inv.service_from)) : "entspricht Rechnungsdatum"]] : []),
      ...(r.customer_no ? [["Kundennummer", r.customer_no]] : []),
      ...(r.vat_id ? [["Ihre USt-IdNr.", r.vat_id]] : []),
      ...(inv.kind === "angebot" && inv.valid_until ? [["Gültig bis", dateDe(inv.valid_until)]] : []),
    ];
    let y = mm(53);
    for (const [k, v] of info) { klein(k, mm(128), y, { width: mm(62), align: "right" }); doc.font("M").fontSize(9.5).fillColor(INK).text(v, mm(128), y + 8.5, { width: mm(62), align: "right", lineBreak: false }); y += mm(9.2); }

    // Titel in Serifenschrift, Betreff und Einleitung
    y = mm(92);
    doc.font("B").fontSize(26).fillColor(INK).text(title(inv), L, y, { lineBreak: false, characterSpacing: -0.9 });
    const titelBreite = doc.widthOfString(title(inv), { characterSpacing: -0.9 });
    if (inv.number) doc.font("R").fontSize(11).fillColor(MUTED).text(inv.number, L + titelBreite + mm(4), y + 13.5, { lineBreak: false });
    y += mm(13);
    if (inv.title) { doc.font("S").fontSize(11).fillColor(INK).text(inv.title, L, y, { width: W }); y = doc.y + mm(2.5); }
    // Anrede vor der Einleitung: Die Einleitung beginnt klein („vielen Dank …“), weil sie den Satz nach der Anrede fortsetzt
    if (inv.intro) {
      const anrede = r.name && r.name !== r.company ? `Guten Tag ${r.name},` : "Sehr geehrte Damen und Herren,";
      doc.font("R").fontSize(10).fillColor(INK2).text(anrede, L, y + mm(1), { width: W }); y = doc.y + mm(2.2);
      doc.text(inv.intro, L, y, { width: W, lineGap: 2.5 }); y = doc.y + mm(5);
    } else y += mm(4);

    // Folgeseite: kein großer Briefkopf mehr, nur eine schmale Kopfzeile – Segel und Name links, Beleg und Empfänger rechts
    const folge = () => {
      doc.addPage();
      doc.save().translate(L, mm(15)).scale(mm(7.5) / 72).translate(-16.5, -9);
      doc.path(SEGEL_1).fill(gradientFor(doc, 52, 10, 78, 80)); doc.path(SEGEL_2).fill(INK); doc.restore();
      doc.font("B").fontSize(10).fillColor(INK).text("Reeder", L + mm(9.5), mm(16.6), { continued: true, lineBreak: false }).font("R").fillColor(MUTED).text(" " + (s.brand || "Software"), { lineBreak: false });
      doc.font("R").fontSize(8.2).fillColor(MUTED).text(`${title(inv)} ${inv.number || ""}${r.company || r.name ? " · " + (r.company || r.name) : ""}`.trim(), L, mm(17), { width: W, align: "right", lineBreak: false });
      doc.moveTo(L, mm(25)).lineTo(R, mm(25)).lineWidth(.4).strokeColor(LINE).stroke();
      y = mm(33);
    };
    // Positionen als Liste statt Tabelle: links Leistung, Beschreibung und „Menge × Einzelpreis“, rechts der Betrag
    const TW = mm(118);   // Breite der Textspalte
    const header = () => {
      klein("Leistung", L, y); klein("Betrag", L, y, { width: W, align: "right" });
      y += mm(4.5); doc.moveTo(L, y).lineTo(R, y).lineWidth(.8).strokeColor(INK).stroke(); y += mm(4.5);
    };
    // Hinweise vorab zusammenstellen, um ihren Platzbedarf zu kennen
    const notes = [];
    if (inv.kind === "rechnung") notes.push(`Bitte überweisen Sie den Rechnungsbetrag bis zum ${dateDe(inv.due_date)} ohne Abzug${s.iban ? ` auf das unten genannte Konto (IBAN ${s.iban})` : ""}. Verwendungszweck: ${inv.number || "Rechnungsnummer"}.`);
    if (inv.kind === "storno") notes.push(`Diese Stornorechnung hebt die Rechnung ${inv.cancels_number || ""} vom ${dateDe(inv.cancels_date)} vollständig auf.`);
    if (inv.kind === "angebot") notes.push(`Dieses Angebot ist gültig bis ${dateDe(inv.valid_until)}. Sie können es in Ihrem Kundenportal ansehen, unterschreiben und verbindlich annehmen – wir freuen uns auf Ihre Zusage.`);
    if (inv.kind === "angebot" && inv.planText) notes.push(inv.planText + ". Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar.");
    if (inv.kind === "angebot") notes.push(`Es gelten unsere Vertragsbedingungen${inv.avv ? " sowie die Vereinbarung zur Auftragsverarbeitung nach Art. 28 DSGVO; beide sind" : "; sie sind"} bei der Annahme im Kundenportal einsehbar.`);
    { let v = inv.vereinbarung; if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
      if (inv.kind === "angebot" && v && (v.titel || v.text)) notes.push(`Besondere Vereinbarung – ${v.titel || ""}: ${v.text || ""}${v.prozent ? ` (${String(v.prozent).replace(".", ",")} %)` : ""}`.replace(/ – : /, ": ")); }
    if (inv.outro) notes.push(inv.outro);
    doc.font("R").fontSize(9.5);
    const noteH = notes.map(t => doc.heightOfString(t, { width: W, lineGap: 2.5 }));
    const steuern = Object.entries(inv.vatByRate || {});
    const sumH = mm(6) * (1 + steuern.length) + mm(15);
    const restH = sumH + mm(7) + noteH.reduce((x, b) => x + b + mm(3.5), 0) - mm(3.5);   // Platz für Summen und Hinweise
    header();
    inv.items.forEach((it, i) => {
      const menge = `${qtyDe(it.qty)} ${it.unit || ""} × ${euro(it.unit_net)}`.replace(/\s+/g, " ");
      const einzeln = Number(it.qty) === 1 && /pauschal/i.test(it.unit || "");
      const hT = doc.font("S").fontSize(10.5).heightOfString(it.title, { width: TW }), hD = it.description ? doc.font("R").fontSize(9).heightOfString(it.description, { width: TW, lineGap: 2 }) + 3 : 0, hM = einzeln ? 0 : 13;
      const h = hT + hD + hM;
      // Die letzte Position nimmt Summen und Hinweise mit auf die nächste Seite, damit dort nie nur die Summe allein steht
      const letzte = i === inv.items.length - 1 && i > 0;
      if (y + h > UNTEN || (letzte && y + h + mm(6) + restH > UNTEN)) { folge(); header(); }
      doc.font("S").fontSize(10.5).fillColor(INK).text(it.title, L, y, { width: TW });
      if (it.description) doc.font("R").fontSize(9).fillColor(INK2).text(it.description, L, doc.y + 2, { width: TW, lineGap: 2 });
      if (!einzeln) doc.font("R").fontSize(8.5).fillColor(MUTED).text(menge, L, doc.y + 3, { width: TW, lineBreak: false });
      doc.font("S").fontSize(10.5).fillColor(INK).text(euro(it.net), L, y, { width: W, align: "right", lineBreak: false });
      y += h + mm(3.4); doc.moveTo(L, y - mm(1.7)).lineTo(R, y - mm(1.7)).lineWidth(.4).strokeColor(LINE).stroke(); y += mm(1.3);
    });

    // Passen Summen und Hinweise nicht mehr gemeinsam auf dieses Blatt, wandern sie zusammen auf das nächste
    if (y + restH > UNTEN) folge();

    // Summen: Zwischenzeilen schlicht, der Endbetrag groß unter einer kräftigen Linie
    y += mm(1);
    const SX = mm(122), sumRow = (k, v) => { doc.font("R").fontSize(9.5).fillColor(INK2).text(k, SX, y, { width: mm(40), lineBreak: false }); doc.text(v, SX, y, { width: R - SX, align: "right", lineBreak: false }); y += mm(6); };
    sumRow("Summe netto", euro(inv.net));
    for (const [rate, v] of steuern) sumRow(`zzgl. ${String(rate).replace(".", ",")} % USt.`, euro(v));
    y += mm(1); doc.moveTo(SX, y).lineTo(R, y).lineWidth(.8).strokeColor(INK).stroke(); y += mm(3.2);
    klein(inv.kind === "angebot" ? "Angebotssumme" : inv.kind === "storno" ? "Gutschrift gesamt" : "Rechnungsbetrag", SX, y + mm(2.4));
    doc.font("B").fontSize(17).fillColor(INK).text(euro(inv.gross), SX, y, { width: R - SX, align: "right", lineBreak: false, characterSpacing: -0.5 });
    y += mm(8.5);

    // Zahlung / Hinweise: Absatz für Absatz, jeder bleibt ganz auf einem Blatt
    y += mm(7);
    notes.forEach((t, i) => {
      if (y + noteH[i] > UNTEN) folge();
      doc.font("R").fontSize(9.5).fillColor(INK2).text(t, L, y, { width: W, lineGap: 2.5, height: noteH[i] + 4 });
      y += noteH[i] + mm(3.5);
    });

    // Fußzeile und Seitenzahl auf jedem Blatt
    const blaetter = doc.bufferedPageRange();
    for (let i = 0; i < blaetter.count; i++) {
      doc.switchToPage(blaetter.start + i); footer(doc, s, L, R, W);
      if (blaetter.count > 1) doc.font("R").fontSize(7.2).fillColor(MUTED).text(`${title(inv)} ${inv.number || ""} · Seite ${i + 1} von ${blaetter.count}`, L, mm(288), { width: W, align: "right", lineBreak: false, height: 10 });
    }
    doc.end();
  });
}
function footer(doc, s, L, R, W) {
  const y = mm(270), w = W / 3, H = mm(24);   // feste Höhe: die Fußzeile löst nie einen Seitenwechsel aus
  doc.moveTo(L, y - mm(3.5)).lineTo(R, y - mm(3.5)).lineWidth(.4).strokeColor(LINE).stroke();
  doc.font("R").fontSize(7.2).fillColor(MUTED);
  doc.text([s.name, s.street, [s.zip, s.city].filter(Boolean).join(" "), s.managingDirector && `Geschäftsführer: ${s.managingDirector}`].filter(Boolean).join("\n"), L, y, { width: w - 6, lineGap: 1.2, height: H });
  doc.text([s.register, s.taxNumber && `Steuernummer: ${s.taxNumber}`, s.vatId && `USt-IdNr.: ${s.vatId}`, s.website].filter(Boolean).join("\n"), L + w, y, { width: w - 6, lineGap: 1.2, height: H });
  doc.text([s.bank, s.iban && `IBAN: ${s.iban}`, s.bic && `BIC: ${s.bic}`, s.email].filter(Boolean).join("\n"), L + 2 * w, y, { width: w, lineGap: 1.2, height: H });
}
