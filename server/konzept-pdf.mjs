// Entwicklungskonzept eines Hardware-Projekts als PDF: Idee, Anforderungen, gewählte Lösung, Aufbau mit Bildern
// aus dem 3D-Modell, Eckdaten, Stückliste, Bauanleitung, Prüfpunkte, offene Punkte.
// Zwei Fassungen: "intern" (alles) und "kunde" (ohne Einzelpreise, Bezugsquellen und Bauanleitung).
// Alle Inhalte stammen aus der projekt.json; nichts wird hier ergänzt oder geschätzt.
import PDFDocument from "pdfkit";
import path from "node:path";

const FONTS = path.resolve("assets/fonts");
const mm = v => v * 72 / 25.4;
const INK = "#0a0a0c", MUTED = "#86868b", INK2 = "#424245", LINE = "#e5e5ea", SOFT = "#f6f4ff", PAPER = "#f5f5f7", VIOLET = "#7c3aed";
const euro = n => (Math.round(n * 100) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const zahl = n => Number(n || 0).toLocaleString("de-DE");
const tag = d => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric" });
const txt = s => String(s ?? "").replace(/\r/g, "").trim();
const PRIO = { muss: ["Muss", "#ede9fe", "#5b21b6"], soll: ["Soll", "#e0f2fe", "#075985"], kann: ["Kann", "#f1f5f9", "#475569"] };
const STECKBRIEF = [["zweck", "Was es können soll"], ["nutzer", "Für wen und wo"], ["groesse", "Größe"], ["budget", "Kostenrahmen"], ["stueckzahl", "Stückzahl"], ["wichtig", "Besonders wichtig"]];

/** d: { company, kunde, name, version, fassung: "intern"|"kunde", k: Konzept (projekt.json), bilder: [{titel, modul, buf}] } */
export function renderKonzeptPdf(d) {
  return new Promise((resolve, reject) => {
    const k = d.k, intern = d.fassung !== "kunde";
    const L = mm(20), R = mm(190), W = R - L;
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: mm(22), bottom: mm(22), left: L, right: mm(20) },
      info: { Title: `Entwicklungskonzept ${d.name}`, Author: d.company.name || "Reeder Hardware", Creator: "Reeder Board" } });
    const chunks = []; doc.on("data", x => chunks.push(x)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("R", path.join(FONTS, "Inter_400Regular.ttf")); doc.registerFont("M", path.join(FONTS, "Inter_500Medium.ttf")); doc.registerFont("S", path.join(FONTS, "Inter_600SemiBold.ttf")); doc.registerFont("B", path.join(FONTS, "Inter_700Bold.ttf"));
    const grad = (x1, y1, x2, y2) => { const g = doc.linearGradient(x1, y1, x2, y2); g.stop(0, "#4f7cff").stop(.55, "#8b5cf6").stop(1, "#ec4899"); return g; };
    const bottom = () => doc.page.height - mm(26);
    const need = h => { if (doc.y + h > bottom()) { doc.addPage(); doc.y = mm(22); } };
    const p = (t, o = {}) => doc.font(o.font || "R").fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, o.x ?? L, o.y ?? doc.y, { width: o.w || W, lineGap: 2, ...o.opts });
    let nr = 0;
    const kapitel = (t, sub) => { nr++; need(mm(34)); doc.y += mm(7);
      doc.font("S").fontSize(8.5).fillColor(VIOLET).text(String(nr).padStart(2, "0"), L, doc.y, { characterSpacing: 1 });
      doc.font("B").fontSize(15).fillColor(INK).text(t, L, doc.y + 1, { width: W });
      if (sub) doc.font("R").fontSize(9).fillColor(MUTED).text(sub, L, doc.y + 2, { width: W, lineGap: 1.5 });
      doc.y += mm(3); };
    const h3 = t => { need(mm(16)); doc.y += mm(2); doc.font("S").fontSize(10.5).fillColor(INK).text(t, L, doc.y, { width: W }); doc.y += 2; };
    const punkte = (liste, o = {}) => { for (const s of liste) { const t = txt(s); if (!t) continue;
      doc.font("R").fontSize(o.size || 9.5); const h = doc.heightOfString(t, { width: W - mm(5), lineGap: 2 }); need(h + 3);
      const y = doc.y; doc.circle(L + 2, y + 5.2, 1.3).fill(o.color || VIOLET);
      doc.font("R").fontSize(o.size || 9.5).fillColor(o.ink || INK2).text(t, L + mm(5), y, { width: W - mm(5), lineGap: 2 }); doc.y += 2; } };
    const schild = (x, y, [label, bg, fg]) => { doc.font("S").fontSize(7.5); const w = doc.widthOfString(label) + 10;
      doc.roundedRect(x, y, w, 13, 6.5).fill(bg); doc.fillColor(fg).text(label, x + 5, y + 3.2, { lineBreak: false }); return w; };
    const linie = () => { doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(.4).strokeColor(LINE).stroke(); doc.y += 5; };
    const bild = (b, breite, maxH) => { try { const im = doc.openImage(b.buf); const h = Math.min(maxH, im.height * (breite / im.width)); return { im, h }; } catch { return null; } };

    const module = k.module || [], modulName = new Map(module.map(m => [m.id, m.name]));
    const material = (k.stueckliste || []).reduce((s, q) => s + (+q.menge || 0) * (+q.einzelpreis || 0), 0);
    const minuten = (k.anleitung || []).reduce((s, q) => s + (+q.dauerMin || 0), 0);

    // ---------- Titel ----------
    doc.save().translate(L, mm(14)).scale(mm(11) / 72).translate(-16.5, -9);
    doc.path("M52 10C66 30 75 54 78 80H52Z").fill(grad(52, 10, 78, 80)); doc.path("M45 28C37 44 30 62 27 80H45Z").fill(INK); doc.restore();
    doc.font("B").fontSize(13).fillColor(INK).text("Reeder", L + mm(14), mm(16.2), { continued: true }).font("R").fillColor(MUTED).text(" Hardware");
    doc.y = mm(38);
    p("ENTWICKLUNGSKONZEPT", { font: "S", size: 9, color: VIOLET, opts: { characterSpacing: 1.5 } });
    p(d.name, { font: "B", size: 26, opts: { lineGap: 0 } });
    p(`${d.kunde ? `für ${d.kunde} · ` : ""}Stand ${tag(new Date())} · Version ${d.version}${intern ? " · interne Fassung" : ""}`, { size: 10.5, color: INK2 });
    doc.y += mm(5);

    const haupt = d.bilder.find(b => !b.modul);
    if (haupt) { const r = bild(haupt, W, mm(92)); if (r) { need(r.h + 8); const y = doc.y; doc.roundedRect(L, y, W, r.h + 8, 10).fill(PAPER);
      doc.image(haupt.buf, L + 4, y + 4, { fit: [W - 8, r.h], align: "center", valign: "center" }); doc.y = y + r.h + 8 + mm(5); } }

    const kacheln = [[String(module.length), module.length === 1 ? "Modul" : "Module"], [String((k.bauteile || []).filter(b => !b.bestand).length), "Bauteile im 3D-Modell"],
      [material ? euro(Math.round(material)).replace(",00", "") : "–", "Material, geschätzt (netto)"], [String((k.pruefung || []).length), "Prüfpunkte vor der Freigabe"]];
    need(mm(30)); const tw = (W - mm(9)) / 4, ty = doc.y;
    kacheln.forEach(([v, l], i) => { const x = L + i * (tw + mm(3));
      doc.roundedRect(x, ty, tw, mm(24), 10).fill(i === 0 ? grad(x, ty, x + tw, ty + mm(24)) : PAPER);
      doc.font("B").fontSize(17).fillColor(i === 0 ? "#ffffff" : INK).text(v, x + mm(4), ty + mm(4), { width: tw - mm(8), lineBreak: false });
      doc.font("R").fontSize(7.8).fillColor(i === 0 ? "#ffffff" : INK2).text(l, x + mm(4), ty + mm(13), { width: tw - mm(8), lineGap: 1 }); });
    doc.y = ty + mm(28);

    // ---------- 1 Die Idee ----------
    kapitel("Die Idee", "Was das Produkt können soll und wie es grundsätzlich funktioniert.");
    if (txt(k.kurzbeschreibung)) p(txt(k.kurzbeschreibung), { size: 10, color: INK2 });
    if (txt(k.konzept?.funktionsprinzip)) { h3("So funktioniert es"); p(txt(k.konzept.funktionsprinzip), { size: 10, color: INK2 }); }
    const sb = STECKBRIEF.filter(([id]) => txt(k.steckbrief?.[id]));
    if (sb.length) { h3("Ausgangslage");
      for (const [id, name] of sb) { const t = txt(k.steckbrief[id]); doc.font("R").fontSize(9.5); const h = Math.max(doc.heightOfString(t, { width: W - mm(46), lineGap: 2 }), 12); need(h + 6);
        const y = doc.y; doc.font("M").fontSize(9).fillColor(MUTED).text(name, L, y, { width: mm(42) });
        doc.font("R").fontSize(9.5).fillColor(INK).text(t, L + mm(46), y, { width: W - mm(46), lineGap: 2 }); doc.y = y + h + 5; } }

    // ---------- 2 Anforderungen ----------
    if ((k.anforderungen || []).length) {
      kapitel("Anforderungen", "Muss ist Pflicht, Soll ist gewünscht, Kann ist ein Zusatz. Der Zielwert sagt, woran die Erfüllung gemessen wird.");
      for (const prio of ["muss", "soll", "kann"]) for (const a of k.anforderungen.filter(x => x.prio === prio)) {
        const t = txt(a.text), z = txt(a.zielwert); doc.font("R").fontSize(9.5);
        const h = doc.heightOfString(t, { width: W - mm(18), lineGap: 2 }) + (z ? doc.fontSize(8.5).heightOfString("Zielwert: " + z, { width: W - mm(18), lineGap: 1.5 }) + 2 : 0);
        need(h + 9); const y = doc.y; schild(L, y, PRIO[prio] || PRIO.kann);
        doc.font("R").fontSize(9.5).fillColor(INK).text(t, L + mm(18), y, { width: W - mm(18), lineGap: 2 });
        if (z) doc.font("R").fontSize(8.5).fillColor(MUTED).text("Zielwert: " + z, L + mm(18), doc.y + 1, { width: W - mm(18), lineGap: 1.5 });
        doc.y = Math.max(doc.y, y + 13) + 4; linie(); }
    }

    // ---------- 3 Gewählte Lösung ----------
    const ents = (k.entscheidungen || []).filter(e => (e.optionen || []).length);
    if (ents.length) {
      kapitel("Gewählte Lösung", "Die Grundsatzfragen, die Entscheidung und die Wege, die geprüft und verworfen wurden.");
      for (const e of ents) {
        const wahl = e.optionen.find(o => o.id === e.gewaehlt), rest = e.optionen.filter(o => o !== wahl);
        h3(txt(e.frage));
        if (wahl) { const beschr = txt(wahl.beschreibung), grund = txt(e.begruendung);
          doc.font("R").fontSize(9.5); const h = 20 + (beschr ? doc.heightOfString(beschr, { width: W - mm(8), lineGap: 2 }) + 3 : 0) + (grund ? doc.heightOfString("Warum: " + grund, { width: W - mm(8), lineGap: 2 }) + 3 : 0) + mm(4);
          need(h + 6); const y = doc.y; doc.roundedRect(L, y, W, h, 9).fill(SOFT);
          doc.font("S").fontSize(10).fillColor(INK).text("✓ " + txt(wahl.name), L + mm(4), y + mm(3), { width: W - mm(8) });
          if (beschr) doc.font("R").fontSize(9.5).fillColor(INK2).text(beschr, L + mm(4), doc.y + 2, { width: W - mm(8), lineGap: 2 });
          if (grund) doc.font("R").fontSize(9.5).fillColor(INK2).text("Warum: " + grund, L + mm(4), doc.y + 3, { width: W - mm(8), lineGap: 2 });
          doc.y = y + h + 5;
        } else p("Noch nicht entschieden.", { color: "#b45309", font: "M" });
        if (rest.length) { p(wahl ? "Geprüft und nicht gewählt:" : "Varianten:", { size: 8.5, color: MUTED }); doc.y += 1;
          punkte(rest.map(o => `${txt(o.name)}${(o.nachteile || []).length ? " – " + o.nachteile.slice(0, 2).map(txt).join("; ") : ""}`), { size: 9, color: MUTED }); }
        doc.y += 3;
      }
    }

    // ---------- 4 Aufbau ----------
    if (module.length) {
      kapitel("Aufbau", `Das Produkt besteht aus ${module.length} Modul${module.length === 1 ? "" : "en"}. Jedes Modul hat eine klare Aufgabe und feste Anschlüsse zu den anderen.`);
      const explo = d.bilder.find(b => b.modul === "explosion");
      if (explo) { const r = bild(explo, W, mm(80)); if (r) { need(r.h + 20); const y = doc.y; doc.roundedRect(L, y, W, r.h + 8, 10).fill(PAPER);
        doc.image(explo.buf, L + 4, y + 4, { fit: [W - 8, r.h], align: "center", valign: "center" }); doc.y = y + r.h + 11;
        p("Explosionsansicht: die Ebenen des Produkts auseinandergezogen.", { size: 8, color: MUTED }); doc.y += 4; } }
      for (const m of module) {
        const b = d.bilder.find(x => x.modul === m.id), bw = mm(58), tw2 = b ? W - bw - mm(5) : W, r = b ? bild(b, bw - 8, mm(50)) : null;
        const fkt = txt(m.funktion), masse = m.huelle?.masse ? `Bauraum ${zahl(m.huelle.masse.breite)} × ${zahl(m.huelle.masse.hoehe)} × ${zahl(m.huelle.masse.tiefe)} mm (B × H × T)` : "";
        doc.font("R").fontSize(9.5); const ht = 16 + (fkt ? doc.heightOfString(fkt, { width: tw2, lineGap: 2 }) : 0) + (masse ? 14 : 0);
        need(Math.max(ht, r ? r.h + 8 : 0) + 10); const y = doc.y;
        doc.font("S").fontSize(10.5).fillColor(INK).text(txt(m.name), L, y, { width: tw2 });
        if (fkt) doc.font("R").fontSize(9.5).fillColor(INK2).text(fkt, L, doc.y + 2, { width: tw2, lineGap: 2 });
        if (masse) doc.font("R").fontSize(8.5).fillColor(MUTED).text(masse, L, doc.y + 3, { width: tw2 });
        let yEnde = doc.y;
        if (r) { doc.roundedRect(R - bw, y, bw, r.h + 8, 8).fill(PAPER); doc.image(b.buf, R - bw + 4, y + 4, { fit: [bw - 8, r.h], align: "center", valign: "center" }); yEnde = Math.max(yEnde, y + r.h + 8); }
        doc.y = yEnde + 3;
        if ((m.schnittstellen || []).length) { p("Anschlüsse", { size: 8.5, color: MUTED, font: "M" }); doc.y += 1; punkte(m.schnittstellen, { size: 9, color: MUTED }); }
        doc.y += 3; linie();
      }
    }

    // ---------- 5 Eckdaten ----------
    const eck = (k.konzept?.eckdaten || []).filter(e => txt(e.label));
    if (eck.length) { kapitel("Eckdaten und Berechnungen", "Gerechnete und geschätzte Werte. Schätzungen sind als solche gekennzeichnet.");
      for (const e of eck) { const w = txt(e.wert); doc.font("M").fontSize(9.5); const h = Math.max(doc.heightOfString(w, { width: W - mm(72), lineGap: 2 }), doc.font("R").heightOfString(txt(e.label), { width: mm(68), lineGap: 2 }), 12); need(h + 8);
        const y = doc.y; doc.font("R").fontSize(9.5).fillColor(INK2).text(txt(e.label), L, y, { width: mm(68), lineGap: 2 });
        doc.font("M").fontSize(9.5).fillColor(INK).text(w, L + mm(72), y, { width: W - mm(72), lineGap: 2 }); doc.y = y + h + 4; linie(); } }

    // ---------- 6 Stückliste / Materialkosten ----------
    const stk = k.stueckliste || [];
    if (stk.length) {
      if (intern) {
        kapitel("Stückliste", `${stk.length} Positionen · Material ${euro(material)} netto. Preise sind Schätzungen, solange nichts anderes vermerkt ist.`);
        const cols = [mm(11), W - mm(11) - mm(24) - mm(22) - mm(24), mm(24), mm(22), mm(24)];
        const kopf = () => { need(mm(12)); let x = L; const hy = doc.y; doc.font("S").fontSize(8).fillColor(MUTED);
          ["Pos", "Bezeichnung", "Menge", "Einzel", "Gesamt"].forEach((h, i) => { doc.text(h, x, hy, { width: cols[i] - 4, lineBreak: false, align: i > 1 ? "right" : "left" }); x += cols[i]; });
          doc.y = hy + 12; linie(); };
        const gruppen = [...module.map(m => [m.id, m.name]), ["", "Ohne Modul"]];
        for (const [mid, mname] of gruppen) { const zeilen = stk.filter(q => (q.modul || "") === mid || (mid === "" && q.modul && !modulName.has(q.modul))); if (!zeilen.length) continue;
          h3(`${mname} · ${euro(zeilen.reduce((s, q) => s + (+q.menge || 0) * (+q.einzelpreis || 0), 0))}`); kopf();
          for (const q of zeilen) { const neben = [txt(q.bezugsquelle), txt(q.notiz)].filter(Boolean).join(" · ");
            doc.font("R").fontSize(9); const h = doc.heightOfString(txt(q.bezeichnung), { width: cols[1] - 6, lineGap: 1.5 }) + (neben ? doc.fontSize(7.8).heightOfString(neben, { width: cols[1] - 6, lineGap: 1 }) + 1 : 0);
            need(h + 8); const y = doc.y; let x = L;
            doc.font("R").fontSize(8.5).fillColor(MUTED).text(txt(q.id), x, y, { width: cols[0] - 4, lineBreak: false }); x += cols[0];
            doc.font("R").fontSize(9).fillColor(INK).text(txt(q.bezeichnung), x, y, { width: cols[1] - 6, lineGap: 1.5 });
            if (neben) doc.font("R").fontSize(7.8).fillColor(MUTED).text(neben, x, doc.y + 1, { width: cols[1] - 6, lineGap: 1 });
            const yE = doc.y; x += cols[1];
            doc.font("R").fontSize(9).fillColor(INK2).text(`${zahl(q.menge)} ${txt(q.einheit)}`, x, y, { width: cols[2] - 4, align: "right", lineBreak: false }); x += cols[2];
            doc.text(euro(+q.einzelpreis || 0), x, y, { width: cols[3] - 4, align: "right", lineBreak: false }); x += cols[3];
            doc.font("M").fillColor(INK).text(euro((+q.menge || 0) * (+q.einzelpreis || 0)), x, y, { width: cols[4] - 4, align: "right", lineBreak: false });
            doc.y = Math.max(yE, y + 11) + 4; linie(); } }
      } else {
        kapitel("Materialkosten", "Grobe Schätzung für einen ersten Aufbau, netto, ohne Arbeitszeit und Werkzeug.");
        for (const m of module) { const s = stk.filter(q => q.modul === m.id).reduce((a, q) => a + (+q.menge || 0) * (+q.einzelpreis || 0), 0); if (!s) continue; need(18);
          const y = doc.y; doc.font("R").fontSize(9.5).fillColor(INK2).text(txt(m.name), L, y, { width: W - mm(40) });
          doc.font("M").fontSize(9.5).fillColor(INK).text(euro(Math.round(s)), R - mm(40), y, { width: mm(40), align: "right", lineBreak: false }); doc.y = y + 15; linie(); }
        need(20); const y = doc.y; doc.font("S").fontSize(10.5).fillColor(INK).text("Material gesamt, geschätzt", L, y, { width: W - mm(40) });
        doc.text(euro(Math.round(material)), R - mm(40), y, { width: mm(40), align: "right", lineBreak: false }); doc.y = y + 18;
      }
    }

    // ---------- 7 Bauanleitung (nur intern) ----------
    if (intern && (k.anleitung || []).length) {
      kapitel("Bauanleitung", `${k.anleitung.length} Schritte${minuten ? ` · ca. ${zahl(Math.round(minuten / 6) / 10)} Stunden` : ""}`);
      k.anleitung.forEach((s, i) => { const t = txt(s.text), neben = [s.dauerMin ? `ca. ${s.dauerMin} min` : "", (s.werkzeug || []).length ? `Werkzeug: ${s.werkzeug.join(", ")}` : "", modulName.get(s.modul) || ""].filter(Boolean).join(" · ");
        doc.font("R").fontSize(9.5); const h = 14 + (t ? doc.heightOfString(t, { width: W - mm(12), lineGap: 2 }) : 0) + (neben ? 12 : 0); need(h + 8);
        const y = doc.y; doc.circle(L + 8, y + 8, 8).fill(INK); doc.font("S").fontSize(8).fillColor("#ffffff").text(String(i + 1), L, y + 4.6, { width: 16, align: "center", lineBreak: false });
        doc.font("S").fontSize(10).fillColor(INK).text(txt(s.titel), L + mm(12), y + 1, { width: W - mm(12) });
        if (t) doc.font("R").fontSize(9.5).fillColor(INK2).text(t, L + mm(12), doc.y + 2, { width: W - mm(12), lineGap: 2 });
        if (neben) doc.font("R").fontSize(8).fillColor(MUTED).text(neben, L + mm(12), doc.y + 2, { width: W - mm(12) });
        doc.y += 7; });
    }

    // ---------- Prüfpunkte ----------
    if ((k.pruefung || []).length) {
      kapitel("Prüfpunkte", "Was sich nur am echten Aufbau oder durch Messen klären lässt. Vor der Freigabe ist jeder Punkt abzuhaken.");
      const ST = { ok: ["in Ordnung", "#dcfce7", "#166534"], problem: ["Problem", "#fee2e2", "#b91c1c"], offen: ["offen", "#f1f5f9", "#475569"] };
      for (const q of k.pruefung) { const t = txt(q.text), n = txt(q.notiz); doc.font("R").fontSize(9.5);
        const h = doc.heightOfString(t, { width: W - mm(34), lineGap: 2 }) + (n ? doc.fontSize(8.5).heightOfString(n, { width: W - mm(34), lineGap: 1.5 }) + 2 : 0); need(h + 9);
        const y = doc.y; doc.roundedRect(L, y + 1, 9, 9, 2).lineWidth(.8).strokeColor(q.status === "ok" ? "#16a34a" : "#a1a1aa").stroke();
        if (q.status === "ok") doc.font("S").fontSize(8).fillColor("#16a34a").text("✓", L + 1.2, y + 1.4, { lineBreak: false });
        doc.font("R").fontSize(9.5).fillColor(INK).text(t, L + mm(6), y, { width: W - mm(34), lineGap: 2 });
        if (n) doc.font("R").fontSize(8.5).fillColor(MUTED).text(n, L + mm(6), doc.y + 1, { width: W - mm(34), lineGap: 1.5 });
        const yE = doc.y; const s = ST[q.status] || ST.offen; doc.font("S").fontSize(7.5); schild(R - doc.widthOfString(s[0]) - 10, y, s);
        doc.y = Math.max(yE, y + 13) + 4; linie(); }
    }

    // ---------- Offene Punkte und Risiken ----------
    const offen = [...module.flatMap(m => (m.offenePunkte || []).map(o => `${m.name}: ${txt(o)}`)), ...(k.konzept?.offeneFragen || []).map(txt)].filter(Boolean);
    const risiken = (k.konzept?.risiken || []).map(txt).filter(Boolean);
    if (offen.length || risiken.length) { kapitel("Offene Punkte und Risiken", "Was vor dem Bau noch zu klären ist und was schiefgehen kann.");
      if (risiken.length) { h3("Risiken"); punkte(risiken, { color: "#dc2626" }); }
      if (offen.length) { h3("Offene Punkte"); punkte(offen, { color: "#d97706" }); } }

    // ---------- Hinweis + Fußzeilen ----------
    need(mm(26)); doc.y += mm(6);
    p("Dieses Dokument ist ein Entwicklungskonzept und keine Fertigungsunterlage. Maße, Leistungen und Preise sind berechnet oder geschätzt und am ersten Aufbau zu überprüfen. Sicherheitsrelevante Punkte (Strom, Wasser, Wärme) sind vor der Nutzung durch eine Fachkraft zu prüfen.", { size: 8, color: MUTED });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); const y = doc.page.height - mm(14), alt = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font("R").fontSize(7.5).fillColor(MUTED).text(`${d.company.name || "Reeder Hardware"} · Entwicklungskonzept „${d.name}“ · V${d.version}${intern ? " · intern, nicht zur Weitergabe" : ""}`, L, y, { width: W - mm(30), lineBreak: false });
      doc.text(`Seite ${i + 1} von ${range.count}`, R - mm(30), y, { width: mm(30), align: "right", lineBreak: false });
      doc.page.margins.bottom = alt;
    }
    doc.end();
  });
}
