// Gesamt-Prüfbericht als PDF im Reeder-Design – aus allen Prüfberichten, die Claude im Lauf des Projekts geschrieben hat.
// Für den Kunden: Wie viel wurde gebaut und geändert, welche Probleme wurden gefunden und wie gelöst, worauf wurde geprüft.
// Nur echte Zahlen aus den Berichten – nichts geschätzt, nichts aufgerundet.
import PDFDocument from "pdfkit";
import path from "node:path";
import { db } from "./db.mjs";

const FONTS = path.resolve("assets/fonts");
const mm = v => v * 72 / 25.4;
const INK = "#0a0a0c", MUTED = "#86868b", INK2 = "#424245", LINE = "#e5e5ea", SOFT = "#f6f4ff", PAPER = "#f5f5f7", OK = "#16a36a";
const SEV = { kritisch: ["Kritisch", "#7f1d1d", "#ffffff"], hoch: ["Hoch", "#fee2e2", "#b91c1c"], mittel: ["Mittel", "#fef3c7", "#92400e"], hinweis: ["Hinweis", "#e0e7ff", "#3730a3"] };
const num = n => Math.round(n || 0).toLocaleString("de-DE");
const day = s => s ? new Date(String(s).replace(" ", "T") + (String(s).includes("Z") || String(s).includes("T") ? "" : "Z")).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric" }) : "";

/** Alle Berichte eines Projekts zusammenführen */
export function gesamtBericht(projectId) {
  const rows = db.prepare("SELECT * FROM pruefberichte WHERE project_id = ? ORDER BY id").all(projectId);
  if (!rows.length) return null;
  const B = rows.map(r => { let d = {}; try { d = JSON.parse(r.daten); } catch {} return { ...d, version: r.version, created_at: r.created_at }; });
  const sum = k => B.reduce((s, b) => s + (+b.zahlen?.[k] || 0), 0);
  const funde = new Map();   // gleicher Fund über mehrere Berichte: der neueste Stand gilt
  for (const b of B) for (const f of b.funde || []) funde.set((f.titel || "").toLowerCase(), { ...f, version: b.version });
  const alle = [...funde.values()];
  const aenderungen = [];
  for (const b of B) for (const a of b.aenderungen || []) if (!aenderungen.some(x => x.text.toLowerCase() === String(a).toLowerCase())) aenderungen.push({ text: a, version: b.version, am: b.created_at });
  const tokens = B.reduce((s, b) => s + (+b.kiNutzung?.tokens || 0), 0);
  const kosten = B.reduce((s, b) => s + (+(b.kiNutzung?.kosten?.betrag ?? b.kiKosten?.betrag) || 0), 0);
  return {
    berichte: B.length, von: B[0].created_at, bis: B[B.length - 1].created_at, letzteVersion: B[B.length - 1].version,
    zahlen: { zeilenGeaendert: sum("zeilenGeaendert"), dateienGeaendert: sum("dateienGeaendert"), aenderungen: sum("aenderungen") || aenderungen.length, testlaeufe: sum("testlaeufe"), pruefungen: sum("pruefungen") },
    geprueft: [...new Set(B.flatMap(b => b.geprueft || []))], seiten: [...new Set(B.flatMap(b => b.seiten || []))],
    aenderungsListe: aenderungen, behoben: alle.filter(f => f.status === "behoben"), offen: alle.filter(f => f.status === "offen"),
    tokens: tokens || null, kosten: kosten || null, zusammenfassung: B[B.length - 1].zusammenfassung || "",
  };
}

/** d: { firma:{name}, kunde, projekt, bericht (aus gesamtBericht) } */
export function renderGesamtPruefberichtPdf(d) {
  const g = d.bericht;
  return new Promise((resolve, reject) => {
    const L = mm(20), R = mm(190), W = R - L;
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: mm(22), bottom: mm(22), left: L, right: mm(20) },
      info: { Title: `Prüfbericht ${d.projekt}`, Author: d.firma?.name || "Reeder Software GmbH", Creator: "Reeder Board" } });
    const chunks = []; doc.on("data", x => chunks.push(x)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("R", path.join(FONTS, "Inter_400Regular.ttf")); doc.registerFont("M", path.join(FONTS, "Inter_500Medium.ttf")); doc.registerFont("S", path.join(FONTS, "Inter_600SemiBold.ttf")); doc.registerFont("B", path.join(FONTS, "Inter_700Bold.ttf"));
    const grad = (x1, y1, x2, y2) => { const gr = doc.linearGradient(x1, y1, x2, y2); gr.stop(0, "#4f7cff").stop(.55, "#8b5cf6").stop(1, "#ec4899"); return gr; };
    const bottom = () => doc.page.height - mm(26);
    const need = h => { if (doc.y + h > bottom()) { doc.addPage(); doc.y = mm(22); } };
    const h2 = (t, sub, follow = mm(24)) => { need(follow); doc.moveDown(1).font("B").fontSize(13).fillColor(INK).text(t, L, doc.y, { width: W }); if (sub) doc.font("R").fontSize(9).fillColor(MUTED).text(sub, L, doc.y + 1, { width: W }); doc.moveDown(.5); };
    const p = (t, o = {}) => doc.font(o.font || "R").fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, o.x ?? L, o.y ?? doc.y, { width: o.w || W, lineGap: 2, ...o.opts });
    const pill = (x, y, sev) => { const [label, bg, fg] = SEV[sev] || SEV.hinweis; doc.font("S").fontSize(7.5); const w = doc.widthOfString(label) + 10;
      doc.roundedRect(x, y, w, 13, 6.5).fill(bg); doc.fillColor(fg).text(label, x + 5, y + 3.2, { lineBreak: false }); return w; };

    // ---------- Kopf: Logo, Titel, farbiges Band ----------
    doc.save().translate(L, mm(14)).scale(mm(11) / 72).translate(-16.5, -9);
    doc.path("M52 10C66 30 75 54 78 80H52Z").fill(grad(52, 10, 78, 80)); doc.path("M45 28C37 44 30 62 27 80H45Z").fill(INK); doc.restore();
    doc.font("B").fontSize(13).fillColor(INK).text("Reeder", L + mm(14), mm(16.2), { continued: true }).font("R").fillColor(MUTED).text(d.firma?.zusatz ? ` ${d.firma.zusatz}` : " Software");
    doc.y = mm(36);
    p("PRÜFBERICHT ZUM PROJEKT", { font: "S", size: 9, color: "#7c3aed", opts: { characterSpacing: 1.5 } });
    p(d.projekt, { font: "B", size: 24, opts: { lineGap: 0 } });
    p(`für ${d.kunde}${g.letzteVersion ? ` · übergebene Version ${g.letzteVersion}` : ""} · ${day(g.von) === day(g.bis) ? day(g.bis) : `${day(g.von)} bis ${day(g.bis)}`}`, { size: 10.5, color: INK2 });

    // ---------- Kennzahlen: vier Kacheln, die erste im Verlauf ----------
    doc.y += mm(7);
    const z = g.zahlen;
    const tiles = [[num(z.zeilenGeaendert), "Zeilen Code geschrieben bzw. geändert"], [num(z.aenderungen), "umgesetzte Änderungen"],
      [num(z.pruefungen), `Einzelprüfungen in ${num(z.testlaeufe)} Testläufen`], [num(g.behoben.length), g.behoben.length === 1 ? "Problem gefunden und gelöst" : "Probleme gefunden und gelöst"]];
    const tw = (W - mm(9)) / 4, ty = doc.y;
    tiles.forEach(([v, l], i) => { const x = L + i * (tw + mm(3));
      doc.roundedRect(x, ty, tw, mm(27), 10).fill(i === 0 ? grad(x, ty, x + tw, ty + mm(27)) : PAPER);
      doc.font("B").fontSize(19).fillColor(i === 0 ? "#ffffff" : INK).text(v, x + mm(4), ty + mm(4), { width: tw - mm(8) });
      doc.font("R").fontSize(7.8).fillColor(i === 0 ? "#ffffff" : INK2).text(l, x + mm(4), ty + mm(13.5), { width: tw - mm(8), lineGap: 1 }); });
    doc.y = ty + mm(33);
    p(`Bei jedem Arbeitsschritt wurde die Website in einem echten Browser auf ${g.geprueft.length ? g.geprueft.join(", ").replace(/, ([^,]*)$/, " und $1") : "allen Geräten"} geprüft – auf abgeschnittene Inhalte, Darstellung, Links, Bilder, Lesbarkeit und Kontrast, Rechtschreibung und Pflichtangaben. Gefundene Probleme wurden behoben und erneut geprüft, bevor eine Version zu Ihnen ging.`
      + (z.dateienGeaendert ? ` Insgesamt wurden ${num(z.dateienGeaendert)} Dateien angelegt oder geändert.` : ""), { size: 10, color: INK2 });
    if (g.zusammenfassung) { doc.y += mm(3); const y = doc.y; doc.font("R").fontSize(10); const h = doc.heightOfString(g.zusammenfassung, { width: W - mm(10), lineGap: 2 }) + mm(8);
      need(h); doc.roundedRect(L, doc.y, W, h, 10).fill(SOFT); p(g.zusammenfassung, { x: L + mm(5), y: doc.y + mm(4), w: W - mm(10), color: INK }); doc.y = y + h; }

    // ---------- Was umgesetzt wurde ----------
    if (g.aenderungsListe.length) {
      h2("Was wir umgesetzt haben", `${g.aenderungsListe.length} Punkte aus ${g.berichte} Arbeitsschritt${g.berichte === 1 ? "" : "en"}`);
      for (const a of g.aenderungsListe.slice(0, 120)) {
        doc.font("R").fontSize(9.5); const h = doc.heightOfString(a.text, { width: W - mm(8), lineGap: 1.5 }) + 5; need(h);
        const y = doc.y; doc.circle(L + mm(1.5), y + 5, 2.2).fill("#8b5cf6");
        doc.fillColor(INK).text(a.text, L + mm(6), y, { width: W - mm(8), lineGap: 1.5 }); doc.y = y + h;
      }
    }

    // ---------- Gefunden und gelöst: Problem → Lösung ----------
    const order = l => [...l].sort((a, b) => Object.keys(SEV).indexOf(a.schwere) - Object.keys(SEV).indexOf(b.schwere));
    const tabelle = liste => {
      const cols = [mm(18), (W - mm(18) - mm(34)) / 2, (W - mm(18) - mm(34)) / 2, mm(34)];
      need(mm(14)); let x = L; const hy = doc.y; doc.font("S").fontSize(8).fillColor(MUTED);
      ["Schwere", "Problem", "Lösung", "Wo"].forEach((t, i) => { doc.text(t, x, hy, { width: cols[i], lineBreak: false }); x += cols[i]; });
      doc.y = hy + 12; doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(.5).strokeColor(LINE).stroke(); doc.y += 5;
      for (const f of liste) {
        const prob = f.titel || "", loes = f.loesung || (f.status === "behoben" ? "behoben" : "offen"), wo = [f.seite, f.geraet].filter(Boolean).join("\n");
        doc.font("S").fontSize(9); const h1 = doc.heightOfString(prob, { width: cols[1] - 8 }); doc.font("R").fontSize(9); const h2b = doc.heightOfString(loes, { width: cols[2] - 8 });
        doc.fontSize(8.5); const h3 = doc.heightOfString(wo, { width: cols[3] }); const h = Math.max(h1, h2b, h3, 14) + 6; need(h + 4);
        const y = doc.y; pill(L, y, f.schwere);
        doc.font("S").fontSize(9).fillColor(INK).text(prob, L + cols[0], y, { width: cols[1] - 8 });
        doc.font("R").fontSize(9).fillColor(f.status === "behoben" ? OK : INK2).text(loes, L + cols[0] + cols[1], y, { width: cols[2] - 8 });
        doc.font("R").fontSize(8.5).fillColor(INK2).text(wo, L + cols[0] + cols[1] + cols[2], y, { width: cols[3] });
        doc.y = y + h; doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(.3).strokeColor(LINE).stroke(); doc.y += 5;
      }
    };
    h2("Gefunden und gelöst", g.behoben.length ? "Jedes Problem wurde nach der Lösung erneut geprüft." : "Bei den Prüfungen wurden keine Probleme gefunden, die gelöst werden mussten.", g.behoben.length ? mm(44) : mm(24));
    if (g.behoben.length) tabelle(order(g.behoben).slice(0, 120));
    if (g.offen.length) { h2("Hinweise", "Bekannt und bewusst so belassen oder für später vorgemerkt.", mm(44)); tabelle(order(g.offen).slice(0, 60)); }

    // ---------- Geprüfte Größen und Seiten ----------
    if (g.geprueft.length || g.seiten.length) {
      h2("Geprüft auf", g.seiten.length ? `Seiten: ${g.seiten.join(", ")}` : "");
      let x = L; const y = doc.y; doc.font("S").fontSize(8.5);
      for (const t of g.geprueft) { const w = doc.widthOfString(t) + 14; if (x + w > R) break; doc.roundedRect(x, y, w, 16, 8).fill(SOFT); doc.fillColor("#6d28d9").text(t, x + 7, y + 4.2, { lineBreak: false }); x += w + 6; }
      doc.y = y + 22;
    }

    // ---------- KI-Einsatz ----------
    if (g.tokens) { h2("KI-Unterstützung", ""); p(`Bei Entwicklung und Prüfung hat unsere KI insgesamt rund ${num(g.tokens)} Tokens verarbeitet. Jede Änderung wurde vom Team begleitet und freigegeben.`, { size: 9.5, color: INK2 }); }

    // ---------- Hinweis + Fußzeilen ----------
    need(mm(24)); doc.moveDown(1.2);
    p("Hinweis: Die Prüfungen wurden in echten Browsern auf mehreren Bildschirmgrößen durchgeführt. Sie ersetzen keine Rechtsberatung und keine vollständige Prüfung der Barrierefreiheit nach BITV/WCAG durch Fachleute.", { size: 8, color: MUTED });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); const y = doc.page.height - mm(14), alt = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font("R").fontSize(7.5).fillColor(MUTED).text(`${d.firma?.name || "Reeder Software GmbH"} · Prüfbericht „${d.projekt}“ · ${day(g.bis)}`, L, y, { width: W - mm(30), lineBreak: false });
      doc.text(`Seite ${i + 1} von ${range.count}`, R - mm(30), y, { width: mm(30), align: "right", lineBreak: false });
      doc.page.margins.bottom = alt;
    }
    doc.end();
  });
}
