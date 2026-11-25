// Auftragsbestätigung als PDF: Parteien, Leistungen, Zahlungsplan, Nachweis der Annahme und die vollständigen Vertragstexte als Anlagen.
import PDFDocument from "pdfkit";
import path from "node:path";

const FONTS = path.resolve("assets/fonts");
const mm = v => v * 72 / 25.4;
const INK = "#0a0a0c", MUTED = "#86868b", LINE = "#e5e5ea", SOFT = "#f6f4ff";
const euro = c => ((c || 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const dmy = s => s ? String(s).slice(0, 10).split("-").reverse().join(".") : "";
const stamp = s => new Date(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z").toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "medium" }) + " Uhr (Berlin)";
const ON = on => on === "Auftrag" ? "bei Auftragserteilung" : `zu Beginn der Phase „${on}“`;

export function renderContractPdf({ company: s, client: c, quote: q, plan, acceptance: a, terms, avv }) {
  return new Promise((resolve, reject) => {
    const L = mm(25), R = mm(190), W = R - L;
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: mm(24), bottom: mm(22), left: L, right: mm(20) },
      info: { Title: `Auftragsbestätigung ${q.number}`, Author: s.name || "Reeder Software GmbH", Creator: "Reeder Board" } });
    const chunks = []; doc.on("data", x => chunks.push(x)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("R", path.join(FONTS, "Inter_400Regular.ttf")); doc.registerFont("M", path.join(FONTS, "Inter_500Medium.ttf")); doc.registerFont("B", path.join(FONTS, "Inter_700Bold.ttf"));
    const grad = (x1, y1, x2, y2) => { const g = doc.linearGradient(x1, y1, x2, y2); g.stop(0, "#4f7cff").stop(.55, "#8b5cf6").stop(1, "#ec4899"); return g; };
    const h2 = t => { if (doc.y > doc.page.height - mm(50)) doc.addPage(); doc.moveDown(.8).font("B").fontSize(11.5).fillColor(INK).text(t, L, doc.y, { width: W }); doc.moveDown(.35); };
    const p = (t, o = {}) => doc.font(o.font || "R").fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, L, doc.y, { width: W, lineGap: 2, ...o });
    const kv = rows => { for (const [k, v] of rows) { const y = doc.y; doc.font("R").fontSize(9).fillColor(MUTED).text(k, L, y, { width: mm(48) });
      doc.font("M").fontSize(9).fillColor(INK).text(v || "–", L + mm(50), y, { width: W - mm(50) }); doc.moveDown(.25); } };

    // Kopf
    doc.save().translate(L, mm(14)).scale(mm(11) / 72).translate(-16.5, -9);
    doc.path("M52 10C66 30 75 54 78 80H52Z").fill(grad(52, 10, 78, 80)); doc.path("M45 28C37 44 30 62 27 80H45Z").fill(INK); doc.restore();
    doc.font("B").fontSize(13).fillColor(INK).text("Reeder", L + mm(14), mm(16.2), { continued: true }).font("R").fillColor(MUTED).text(" " + (s.brand || "Software"));
    doc.y = mm(34);
    doc.font("R").fontSize(9).fillColor(MUTED).text("Auftragsbestätigung & Vertrag", L, doc.y);
    doc.font("B").fontSize(20).fillColor(INK).text(q.title || `Angebot ${q.number}`, L, doc.y + 2, { width: W });
    doc.font("R").fontSize(9.5).fillColor(MUTED).text(`zu Angebot ${q.number} vom ${dmy(q.issue_date)} · angenommen am ${stamp(a.created_at)}`, L, doc.y + 2, { width: W });

    h2("Vertragsparteien");
    const y0 = doc.y, half = W / 2 - mm(4);
    doc.font("R").fontSize(8.5).fillColor(MUTED).text("Auftragnehmer", L, y0);
    doc.font("M").fontSize(9.5).fillColor(INK).text([s.name, s.street, [s.zip, s.city].filter(Boolean).join(" "), s.managingDirector && `vertreten durch ${s.managingDirector}`].filter(Boolean).join("\n"), L, doc.y + 1, { width: half, lineGap: 1.5 });
    const yA = doc.y;
    doc.font("R").fontSize(8.5).fillColor(MUTED).text("Auftraggeber", L + W / 2, y0);
    doc.font("M").fontSize(9.5).fillColor(INK).text([c.billing_name || c.company, c.street, [c.zip, c.city].filter(Boolean).join(" "), c.vat_id && `USt-IdNr. ${c.vat_id}`].filter(Boolean).join("\n"), L + W / 2, doc.y + 1, { width: half, lineGap: 1.5 });
    doc.y = Math.max(yA, doc.y); doc.x = L;

    h2("Leistungen laut Angebot");
    for (const it of q.items) {
      if (doc.y > doc.page.height - mm(40)) doc.addPage();
      const y = doc.y;
      doc.font("M").fontSize(9.5).fillColor(INK).text(`${it.pos}. ${it.title}`, L, y, { width: W - mm(34) });
      if (it.description) doc.font("R").fontSize(8.5).fillColor(MUTED).text(it.description, L + mm(4), doc.y, { width: W - mm(38) });
      const yEnd = doc.y; doc.font("M").fontSize(9.5).fillColor(INK).text(euro(it.net), R - mm(32), y, { width: mm(32), align: "right" });
      doc.y = yEnd + 3;
    }
    doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).lineWidth(.4).strokeColor(LINE).stroke(); doc.y += 8;
    const tot = (k, v, b) => { const y = doc.y; doc.font(b ? "B" : "R").fontSize(b ? 10.5 : 9.5).fillColor(INK).text(k, L, y, { width: W - mm(34) }); doc.text(v, R - mm(40), y, { width: mm(40), align: "right" }); doc.moveDown(.2); };
    tot("Summe netto", euro(q.net)); tot("Umsatzsteuer", euro(q.vat)); tot("Auftragssumme brutto", euro(q.gross), true);

    if (plan?.length) {
      h2("Zahlungsplan");
      for (const x of plan) { const y = doc.y;
        doc.font("M").fontSize(9.5).fillColor(INK).text(`${x.label} – ${String(x.pct).replace(".", ",")} %`, L, y, { width: W - mm(46), continued: true })
          .font("R").fillColor(MUTED).text(`  ·  ${ON(x.on)}`);
        const yEnd = doc.y;
        doc.font("M").fontSize(9.5).fillColor(INK).text(`${euro(x.gross)} brutto`, R - mm(44), y, { width: mm(44), align: "right" });
        doc.y = yEnd + 3; doc.x = L; }
      p("Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar.", { color: MUTED, size: 8.5 });
    }

    if (q.vereinbarung) { h2("Besondere Vereinbarung"); p(`${q.vereinbarung.titel}${q.vereinbarung.prozent ? ` (${String(q.vereinbarung.prozent).replace(".", ",")} %)` : ""}`, { font: "M" }); if (q.vereinbarung.text) p(q.vereinbarung.text); }
    h2("Nachweis der Annahme");
    const box = doc.y;
    const sigH = a.signature ? mm(30) : 0;   // Platz für die Unterschrift
    // Technische Angaben lesbar machen: keine rohe Loopback-Adresse, Prüfwerte gekürzt in einer Zeile darunter
    const ipText = /^(::1|127\.|::ffff:127\.)/.test(String(a.ip || "")) ? "dieser Rechner (lokaler Zugriff)" : a.ip;
    const kurz = h => h ? String(h).slice(0, 12) + "…" : "–";
    const boxH = mm(40) + sigH;
    doc.roundedRect(L, box, W, boxH, 8).fill(SOFT); doc.y = box + mm(4);
    doc.x = L + mm(4);
    const kv2 = rows => { for (const [k, v] of rows) { const y = doc.y; doc.font("R").fontSize(8.5).fillColor(MUTED).text(k, L + mm(4), y, { width: mm(46) });
      doc.font("M").fontSize(8.5).fillColor(INK).text(v || "–", L + mm(52), y, { width: W - mm(56) }); doc.moveDown(.2); } };
    kv2([["Angenommen von", `${a.name}${a.position ? ", " + a.position : ""}`], ["Für", c.billing_name || c.company], ["Angemeldet als", a.email], ["Zeitpunkt", stamp(a.created_at)],
      ["Weg", a.signature ? "Kundenportal (passwortgeschützter Zugang), eigenhändige Unterschrift auf dem Bildschirm, Schaltfläche „Verbindlich beauftragen“" : "Kundenportal (passwortgeschützter Zugang), Schaltfläche „Verbindlich beauftragen“"], ...(ipText ? [["Zugriff von", ipText]] : [])]);
    if (a.signature) {
      const y = Math.max(doc.y, box + mm(38)) + mm(1);
      doc.font("R").fontSize(8.5).fillColor(MUTED).text("Unterschrift", L + mm(4), y + mm(8), { width: mm(46) });
      doc.rect(L + mm(52), y, mm(78), mm(24)).fill("#ffffff");
      try { doc.image(Buffer.from(a.signature, "base64"), L + mm(53), y + mm(1), { fit: [mm(76), mm(22)], align: "center", valign: "center" }); } catch {}
    }
    doc.y = Math.max(doc.y, box + boxH) + mm(3); doc.x = L;
    p(`Prüfwerte zur Nachvollziehbarkeit (SHA-256, gekürzt): Angebot ${kurz(a.quote_sha)} · Vertragsbedingungen Fassung ${terms.version} ${kurz(terms.sha256)}${avv ? ` · Auftragsverarbeitung Fassung ${avv.version} ${kurz(avv.sha256)}` : ""}${a.signature_sha ? ` · Unterschrift ${kurz(a.signature_sha)}` : ""}. Die vollständigen Werte sind bei uns gespeichert.`, { color: MUTED, size: 7 });
    doc.moveDown(.4);
    p(`Mit der Annahme wurden die Vertragsbedingungen (Anlage 1)${avv ? " und die Vereinbarung zur Auftragsverarbeitung (Anlage 2)" : ""} ausdrücklich bestätigt. ${a.signature ? "Die Unterschrift wurde im passwortgeschützten Kundenportal auf dem Bildschirm geleistet (einfache elektronische Signatur)." : "Dieses Dokument wurde automatisch erstellt und ist ohne Unterschrift gültig."}`, { color: MUTED, size: 8.5 });

    // Anlagen
    const annex = (t, text) => { doc.addPage(); doc.font("R").fontSize(9).fillColor(MUTED).text(t, L, doc.y); doc.moveDown(.4);
      const [head, ...rest] = text.split("\n");
      doc.font("B").fontSize(14).fillColor(INK).text(head, L, doc.y, { width: W }); doc.moveDown(.6);
      for (const line of rest) {
        if (!line.trim()) { doc.moveDown(.45); continue; }
        const heading = /^(§\s*\d+|\d+\.)\s/.test(line);
        if (heading && doc.y > doc.page.height - mm(45)) doc.addPage();
        doc.font(heading ? "B" : "R").fontSize(heading ? 10 : 9).fillColor(INK).text(line, L, doc.y, { width: W, lineGap: 1.8 });
      } };
    annex(`Anlage 1 · Fassung ${terms.version}`, terms.text);
    if (avv) annex(`Anlage 2 · Fassung ${avv.version}`, avv.text);

    // Fußzeile mit Seitenzahlen
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font("R").fontSize(7.5).fillColor(MUTED).text(`${s.name || "Reeder Software GmbH"} · Auftragsbestätigung ${q.number} · Seite ${i + 1} von ${range.count}`, L, doc.page.height - mm(12), { width: W, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
