// Prüfbericht als PDF (Baustein H7): Was wurde geprüft, was gefunden und behoben, was ist offen – mit Bildschirmfotos.
// Alle Zahlen stammen aus der Prüfstrecke (H6); nichts wird geschätzt oder aufgerundet.
import PDFDocument from "pdfkit";
import path from "node:path";

const FONTS = path.resolve("assets/fonts");
const mm = v => v * 72 / 25.4;
const INK = "#0a0a0c", MUTED = "#86868b", INK2 = "#424245", LINE = "#e5e5ea", SOFT = "#f6f4ff", PAPER = "#f5f5f7";
const SEV = { kritisch: ["Kritisch", "#7f1d1d", "#ffffff"], hoch: ["Hoch", "#fee2e2", "#b91c1c"], mittel: ["Mittel", "#fef3c7", "#92400e"], hinweis: ["Hinweis", "#e0e7ff", "#3730a3"] };
const num = n => (n || 0).toLocaleString("de-DE");
const day = s => s ? new Date(String(s).replace(" ", "T") + (String(s).includes("Z") ? "" : "Z")).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric" }) : "";
const pageName = p => { const n = (p || "").replace(/\.html?$/i, "").replace(/(^|\/)index$/, "$1Startseite").replace(/\/$/, "") || "Startseite"; return n.charAt(0).toUpperCase() + n.slice(1).replace(/[-_]+/g, " "); };
const DEV = { desktop: "Desktop", tablet: "Tablet", phone: "Smartphone" };

export const CHECK_GROUPS = [
  ["Funktion", "Jede Seite lädt vollständig, keine Skriptfehler, keine fehlenden Dateien, jeder interne Link führt zu einer vorhandenen Seite."],
  ["Darstellung auf allen Geräten", "Desktop, Tablet und Smartphone: nichts ragt über den Bildschirm hinaus, Schrift ausreichend groß, Links gut antippbar."],
  ["Lesbarkeit & Barrierefreiheit", "Kontrast jedes einzelnen Textes (WCAG AA), Alternativtexte für Bilder, Beschriftung aller Links, Knöpfe und Eingabefelder, Sprache der Seite, sinnvolle Überschriften."],
  ["Inhalte", "Keine vergessenen Platzhalter, funktionierende Telefon- und E-Mail-Links, Seitentitel und Beschreibung für Suchmaschinen."],
  ["Pflichtangaben", "Impressum und Datenschutzerklärung sind von jeder Seite aus erreichbar."],
  ["Sicherheit", "Keine unverschlüsselt eingebundenen Inhalte, Formulare senden verschlüsselt, neue Tabs mit Schutz geöffnet."],
  ["Tempo", "Ladezeit und Datenmenge jeder Seite, unnötig große Bilder."],
];

/** data: { company, client, project, version, period:{from,to}, totals:{checks, fixedChecks, aiCells, runs}, pages:[], devices:[], fixed:[], open:[], ignored:[], personas:[], shots:[{page, device, file}] } */
export function renderTestReportPdf(d) {
  return new Promise((resolve, reject) => {
    const L = mm(20), R = mm(190), W = R - L;
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: mm(22), bottom: mm(22), left: L, right: mm(20) },
      info: { Title: `Prüfbericht ${d.project.title}`, Author: d.company.name || "Reeder Software GmbH", Creator: "Reeder Board" } });
    const chunks = []; doc.on("data", x => chunks.push(x)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("R", path.join(FONTS, "Inter_400Regular.ttf")); doc.registerFont("M", path.join(FONTS, "Inter_500Medium.ttf")); doc.registerFont("S", path.join(FONTS, "Inter_600SemiBold.ttf")); doc.registerFont("B", path.join(FONTS, "Inter_700Bold.ttf"));
    const grad = (x1, y1, x2, y2) => { const g = doc.linearGradient(x1, y1, x2, y2); g.stop(0, "#4f7cff").stop(.55, "#8b5cf6").stop(1, "#ec4899"); return g; };
    const bottom = () => doc.page.height - mm(26);
    const need = h => { if (doc.y + h > bottom()) { doc.addPage(); doc.y = mm(22); } };
    const h2 = (t, sub, follow = mm(24)) => { need(follow); doc.moveDown(.9).font("B").fontSize(13).fillColor(INK).text(t, L, doc.y, { width: W }); if (sub) doc.font("R").fontSize(9).fillColor(MUTED).text(sub, L, doc.y + 1, { width: W }); doc.moveDown(.5); };
    const p = (t, o = {}) => doc.font(o.font || "R").fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, o.x ?? L, o.y ?? doc.y, { width: o.w || W, lineGap: 2, ...o.opts });
    const pill = (x, y, sev) => { const [label, bg, fg] = SEV[sev] || SEV.hinweis; doc.font("S").fontSize(7.5); const w = doc.widthOfString(label) + 10;
      doc.roundedRect(x, y, w, 13, 6.5).fill(bg); doc.fillColor(fg).text(label, x + 5, y + 3.2, { lineBreak: false }); return w; };

    // ---------- Kopf ----------
    doc.save().translate(L, mm(14)).scale(mm(11) / 72).translate(-16.5, -9);
    doc.path("M52 10C66 30 75 54 78 80H52Z").fill(grad(52, 10, 78, 80)); doc.path("M45 28C37 44 30 62 27 80H45Z").fill(INK); doc.restore();
    doc.font("B").fontSize(13).fillColor(INK).text("Reeder", L + mm(14), mm(16.2), { continued: true }).font("R").fillColor(MUTED).text(" Software");
    doc.y = mm(36);
    p("PRÜFBERICHT", { font: "S", size: 9, color: "#7c3aed", opts: { characterSpacing: 1.5 } });
    p(d.project.title, { font: "B", size: 24, opts: { lineGap: 0 } });
    p(`für ${d.client.company}${d.version ? ` · geprüfte Version ${d.version}` : ""} · Stand ${day(d.period.to)}`, { size: 10.5, color: INK2 });

    // ---------- Kennzahlen ----------
    doc.y += mm(7);
    const tiles = [[num(d.totals.checks), "automatische Prüfungen"], [num(d.fixed.length), d.fixed.length === 1 ? "Schwachstelle gefunden und behoben" : "Schwachstellen gefunden und behoben"],
      [num(d.pages.length * d.devices.length), `Seiten-Ansichten (${d.pages.length} Seite${d.pages.length === 1 ? "" : "n"} × ${d.devices.length} Geräte)`], [num(d.open.filter(f => ["kritisch", "hoch"].includes(f.severity)).length), "offen mit Schwere „hoch“ oder „kritisch“"]];
    const tw = (W - mm(9)) / 4, ty = doc.y;
    tiles.forEach(([v, l], i) => { const x = L + i * (tw + mm(3));
      doc.roundedRect(x, ty, tw, mm(26), 10).fill(i === 0 ? grad(x, ty, x + tw, ty + mm(26)) : PAPER);
      doc.font("B").fontSize(19).fillColor(i === 0 ? "#ffffff" : INK).text(v, x + mm(4), ty + mm(4), { width: tw - mm(8) });
      doc.font("R").fontSize(7.8).fillColor(i === 0 ? "#ffffff" : INK2).text(l, x + mm(4), ty + mm(13.5), { width: tw - mm(8), lineGap: 1 }); });
    doc.y = ty + mm(32);
    p(`${day(d.period.from) === day(d.period.to) ? `Am ${day(d.period.to)}` : `Zwischen dem ${day(d.period.from)} und dem ${day(d.period.to)}`} wurde „${d.project.title}“ in ${d.totals.runs} Prüfläufen automatisch geprüft – nach jeder neuen Version, bevor sie freigegeben wurde. ` +
      `Jede Seite wurde dabei in einem echten Browser auf ${d.devices.map(x => DEV[x] || x).join(", ").replace(/, ([^,]*)$/, " und $1")} geöffnet.` +
      (d.totals.aiCells ? ` Zusätzlich haben KI-Prüfer die Seiten in ${num(d.totals.aiCells)} Durchgängen aus Sicht typischer Besucher begutachtet; jeder ihrer Funde wurde von einem zweiten Modell gegengeprüft.` : ""), { size: 10, color: INK2 });

    // ---------- Was geprüft wurde ----------
    h2("Was geprüft wurde", `${num(d.totals.fixedChecks)} feste Einzelprüfungen${d.totals.aiCells ? ` · ${num(d.totals.aiCells)} KI-Durchgänge` : ""} · Seiten: ${d.pages.map(pageName).join(", ")}`);
    const colW = (W - mm(6)) / 2; let col = 0, rowY = doc.y, rowH = 0;
    for (const [t, desc] of CHECK_GROUPS) {
      const x = L + col * (colW + mm(6));
      doc.font("S").fontSize(9.5); const h = doc.heightOfString(t, { width: colW - mm(6) }) + doc.font("R").fontSize(8.5).heightOfString(desc, { width: colW - mm(6), lineGap: 1.5 }) + mm(6);
      if (col === 0) need(h + 4), rowY = doc.y;
      doc.roundedRect(x, rowY, colW, h, 8).fill(SOFT);
      doc.font("S").fontSize(9.5).fillColor(INK).text("✓ " + t, x + mm(3), rowY + mm(2.5), { width: colW - mm(6) });
      doc.font("R").fontSize(8.5).fillColor(INK2).text(desc, x + mm(3), doc.y + 1, { width: colW - mm(6), lineGap: 1.5 });
      rowH = Math.max(rowH, h); col++;
      if (col === 2) { col = 0; doc.y = rowY + rowH + mm(3); rowH = 0; }
    }
    if (col === 1) doc.y = rowY + rowH + mm(3);
    if (d.personas.length && d.totals.aiCells) p(`KI-Prüfer: ${d.personas.join(" · ")}.`, { size: 8.5, color: MUTED });

    // ---------- Funde ----------
    const table = (list, showFix) => {
      const cols = showFix ? [mm(18), W - mm(18) - mm(30) - mm(32), mm(30), mm(32)] : [mm(18), W - mm(18) - mm(30) - mm(22), mm(30), mm(22)];
      need(mm(12));
      const head = showFix ? ["Schwere", "Fund", "Seite", "Gefunden → behoben"] : ["Schwere", "Fund", "Seite", "Seit"];
      let x = L; const hy = doc.y; doc.font("S").fontSize(8).fillColor(MUTED); head.forEach((h, i) => { doc.text(h, x, hy, { width: cols[i], lineBreak: false }); x += cols[i]; });
      doc.y = hy + 12; doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(.5).strokeColor(LINE).stroke(); doc.y += 5;
      for (const f of list) {
        const detail = f.detail ? (f.detail.length > 170 ? f.detail.slice(0, 170) + " …" : f.detail) : "";
        doc.font("S").fontSize(9); const h1 = doc.heightOfString(f.title, { width: cols[1] - 6 }); doc.font("R").fontSize(8); const h2b = detail ? doc.heightOfString(detail, { width: cols[1] - 6, lineGap: 1 }) : 0;
        const h = Math.max(h1 + h2b + 6, 18); need(h + 4);
        const y = doc.y; pill(L, y, f.severity);
        doc.font("S").fontSize(9).fillColor(INK).text(f.title, L + cols[0], y, { width: cols[1] - 6 });
        if (detail) doc.font("R").fontSize(8).fillColor(INK2).text(detail, L + cols[0], doc.y + 1, { width: cols[1] - 6, lineGap: 1 });
        doc.font("R").fontSize(8.5).fillColor(INK2).text(`${pageName(f.page)}${f.devices?.length && f.devices.length < 3 ? `\n${f.devices.map(x => DEV[x] || x).join(", ")}` : ""}`, L + cols[0] + cols[1], y, { width: cols[2] - 4 });
        doc.font("M").fontSize(8.5).fillColor(INK).text(showFix ? `V${f.first_version} → V${f.fixed_version}` : `V${f.first_version}`, L + cols[0] + cols[1] + cols[2], y, { width: cols[3] });
        doc.y = y + h; doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(.3).strokeColor(LINE).stroke(); doc.y += 5;
      }
    };
    const order = l => [...l].sort((a, b) => Object.keys(SEV).indexOf(a.severity) - Object.keys(SEV).indexOf(b.severity));
    h2("Gefunden und behoben", d.fixed.length ? `${d.fixed.length} Schwachstelle${d.fixed.length === 1 ? "" : "n"} – jede wurde in einer späteren Version erneut geprüft und nicht mehr gefunden.` : "In den Prüfläufen wurden keine Schwachstellen gefunden, die behoben werden mussten.", d.fixed.length ? mm(48) : mm(24));
    if (d.fixed.length) table(order(d.fixed).slice(0, 80), true);
    if (d.fixed.length > 80) p(`… und ${d.fixed.length - 80} weitere.`, { size: 8.5, color: MUTED });
    if (d.open.length) { h2("Noch offen", "Diese Punkte sind bekannt und werden im Rahmen der Betreuung bearbeitet.", mm(48)); table(order(d.open).slice(0, 60), false); }
    if (d.ignored.length) { h2("Geprüft und bewusst belassen", "Vom Team begutachtet und als unkritisch oder gewollt eingestuft.", mm(48)); table(order(d.ignored).slice(0, 40), false); }

    // ---------- Bildschirmfotos ----------
    if (d.shots.length) {
      doc.addPage(); doc.y = mm(22);
      h2(`So sieht die geprüfte Version ${d.version} aus`, "Aufnahmen aus dem letzten Prüflauf – Desktop und Smartphone.");
      const byPage = {}; for (const s of d.shots) (byPage[s.page] ||= {})[s.device] = s;
      const hOf = (s, w, max) => { try { const im = doc.openImage(s.buf); return Math.min(max, im.height * (w / im.width)); } catch { return max; } };
      for (const pg of Object.keys(byPage).sort((a, b) => (/(^|\/)index\.html?$/i.test(a) ? -1 : /(^|\/)index\.html?$/i.test(b) ? 1 : a.localeCompare(b))).slice(0, 8)) {
        const desk = byPage[pg].desktop, phone = byPage[pg].phone, dw = mm(118) - 8, pw = mm(46) - 8;
        const hBox = Math.max(desk ? hOf(desk, dw, mm(95)) : 0, phone ? hOf(phone, pw, mm(95)) : 0, mm(30)) + 8;
        need(hBox + mm(10));
        p(pageName(pg), { font: "S", size: 10 }); const y = doc.y + 3;
        try { if (desk) { doc.roundedRect(L, y, mm(118), hBox, 6).fill(PAPER); doc.image(desk.buf, L + 4, y + 4, { fit: [dw, hBox - 8], align: "center", valign: "top" }); } } catch {}
        try { if (phone) { doc.roundedRect(L + mm(124), y, mm(46), hBox, 6).fill(PAPER); doc.image(phone.buf, L + mm(124) + 4, y + 4, { fit: [pw, hBox - 8], align: "center", valign: "top" }); } } catch {}
        doc.y = y + hBox + mm(6);
      }
    }

    // ---------- Hinweis + Fußzeilen ----------
    need(mm(30)); doc.moveDown(1);
    p("Hinweis: Die Prüfungen laufen automatisch in echten Browsern und mit KI-Unterstützung; jeder KI-Fund wird gegengeprüft, das Team entscheidet über jede Änderung. Automatische Prüfungen ersetzen keine Rechtsberatung und keine vollständige Prüfung der Barrierefreiheit nach BITV/WCAG durch Fachleute.", { size: 8, color: MUTED });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); const y = doc.page.height - mm(14), oldBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font("R").fontSize(7.5).fillColor(MUTED).text(`${d.company.name || "Reeder Software GmbH"} · Prüfbericht „${d.project.title}“ · ${day(d.period.to)}`, L, y, { width: W - mm(30), lineBreak: false });
      doc.text(`Seite ${i + 1} von ${range.count}`, R - mm(30), y, { width: mm(30), align: "right", lineBreak: false });
      doc.page.margins.bottom = oldBottom;
    }
    doc.end();
  });
}
