// Finanzen: Rechnungen, Stornorechnungen, Angebote, Belege/Ausgaben, Zahlungseingang, Mahnwesen,
// Umsatzsteuer-Übersicht und Export für den Steuerberater (CSV + DATEV-Buchungsstapel + PDFs als ZIP).
// GoBD-Grundsätze (aus dem Theraletik-Buchungskern übernommen): Beträge nur in Cent, lückenlose Nummernkreise je Jahr,
// festgeschriebene Rechnungen/Belege unveränderlich (DB-Trigger), Korrektur nur per Storno, Periodensperre, Protokoll.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { db, getSetting, setSetting, DEFAULT_COMPANY, chatPosten } from "./db.mjs";
import { versandMerken, versandListe, letzterVersand } from "./versand.mjs";
import { sendMail } from "./mail.mjs";
import { vorlage } from "./mail-vorlagen.mjs";
import { vereinbarungLesen, vereinbarungSpeichern, vereinbarungAusAngebot, betreuungLesen, betreuungSpeichern, betreuungAusAngebot } from "./vereinbarungen.mjs";
import { firmaDaten, firmaVonProjekt, firmaSql, hardwareAktiv, DEFAULT_HARDWARE } from "./firmen.mjs";
import { callModel, assistantStatus, DEFAULT_ASSISTANT } from "./assistant.mjs";
import { antwortenView } from "./onboarding.mjs";
import { renderInvoicePdf } from "./invoice-pdf.mjs";
import { createZip } from "./zip.mjs";
import { cleanPlan, planText } from "./contracts.mjs";

const FILE_DIR = path.resolve(process.env.DATA_DIR || "data", "finance");
const DOC_DIR = path.resolve(process.env.DATA_DIR || "data", "documents");
const PREFIX = { rechnung: "RE", storno: "ST", angebot: "AN", beleg: "BELEG" };
const DUNNING = [{ days: 0, label: "Zahlungserinnerung" }, { days: 14, label: "1. Mahnung" }, { days: 28, label: "2. Mahnung" }, { days: 42, label: "3. Mahnung" }];

// Ausgaben-Kategorien mit SKR04-Konto (Vorschlag – vor dem ersten Export mit dem Steuerberater abstimmen)
export const CATEGORIES = [
  ["Software & Lizenzen (SaaS)", "6837"], ["Hosting, Server & Domains", "6810"], ["KI-Dienste & APIs", "6837"], ["Hardware bis 800 € (GWG)", "6260"],
  ["Fremdleistungen / Freelancer", "5900"], ["Büromaterial", "6815"], ["Telefon & Internet", "6805"], ["Miete & Raumkosten", "6310"],
  ["Werbung & Marketing", "6600"], ["Reisekosten", "6660"], ["Bewirtung", "6640"], ["Fortbildung & Fachliteratur", "6821"],
  ["Rechts- & Beratungskosten", "6825"], ["Buchführung & Steuerberatung", "6830"], ["Versicherungen", "6400"], ["Bankgebühren", "6855"],
  ["Fahrzeugkosten", "6530"], ["Sonstiges", "6300"],
];
export const TAX_MODES = { v19: { label: "19 % Vorsteuer", rate: 19 }, v7: { label: "7 % Vorsteuer", rate: 7 }, v0: { label: "ohne Umsatzsteuer", rate: 0 }, rc19: { label: "Reverse Charge § 13b (19 %)", rate: 19, rc: true } };

// Startvorlagen ohne Preise: Die Beträge trägt der Inhaber ein und speichert die Vorlage dann neu.
const DEFAULT_TEMPLATES = [
  { name: "Entwicklungskonzept (Einstieg)", title: "Entwicklungskonzept", intro: "vielen Dank für das Gespräch. Gern arbeiten wir Ihre Produktidee zu einem Entwicklungskonzept aus:", outro: "Wird im Anschluss der Prototyp beauftragt, rechnen wir den Betrag für das Entwicklungskonzept vollständig an. Den Prototyp bieten wir Ihnen als Pauschalpreis an, sobald das Konzept vorliegt.",
    items: [{ title: "Entwicklungskonzept", description: "Pauschalpreis für die Ausarbeitung Ihrer Produktidee. Sie erhalten ein Konzeptdokument (PDF) mit Anforderungen, gewählter Lösung, Aufbau mit Ansichten aus dem 3D-Modell, geschätzten Materialkosten und Prüfplan.", qty: 1, unit: "pauschal", unit_net: 30000 }] },   // 300 € netto (Angabe in Cent)
  { name: "Website", title: "Website", intro: "vielen Dank für Ihr Interesse. Gern bieten wir Ihnen die Erstellung Ihrer Website an:", outro: "Bei Fragen sind wir jederzeit für Sie da.",
    items: [{ title: "Konzept und Gestaltung", description: "Seitenstruktur, Gestaltung nach Ihren Vorgaben, Abstimmung am klickbaren Entwurf.", qty: 1, unit: "pauschal", unit_net: 0 },
      { title: "Umsetzung und Veröffentlichung", description: "Programmierung, Inhalte einpflegen, Prüfung auf allen Geräten, Livegang.", qty: 1, unit: "pauschal", unit_net: 0 }] },
  { name: "Software-Projekt", title: "Individuelle Software", intro: "vielen Dank für das Gespräch. Auf Grundlage des Prototyps bieten wir Ihnen die Umsetzung an:", outro: "Bei Fragen sind wir jederzeit für Sie da.",
    items: [{ title: "Konzept", description: "Abläufe, Rollen und Datenmodell, abgestimmt am Prototyp.", qty: 1, unit: "pauschal", unit_net: 0 },
      { title: "Umsetzung", description: "Entwicklung, Prüfung und Abnahme in Etappen.", qty: 1, unit: "pauschal", unit_net: 0 },
      { title: "Einführung", description: "Einrichtung, Datenübernahme und Einweisung.", qty: 1, unit: "pauschal", unit_net: 0 }] },
  { name: "KI-Telefonassistent", title: "KI-Telefonassistent", intro: "vielen Dank für Ihr Interesse. Gern richten wir Ihren Telefonassistenten ein:", outro: "Bei Fragen sind wir jederzeit für Sie da.",
    items: [{ title: "Einrichtung", description: "Gesprächsleitfaden, Stimme, Anbindung an Kalender und Benachrichtigungen, Testanrufe.", qty: 1, unit: "pauschal", unit_net: 0 },
      { title: "Betrieb", description: "Laufender Betrieb und Anpassungen.", qty: 1, unit: "Monat", unit_net: 0 }] },
];

export function createFinance({ json, send, readJson, clean, logEvent, SITE_URL, inviteLink }) {
  /* ---------- Helfer ---------- */
  const cents = v => { if (v === "" || v == null) return null; const str = typeof v === "number" ? String(v) : String(v).trim().replace(/\s|€/g, "");
    const norm = typeof v === "number" ? str : str.includes(",") ? str.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(str) ? str.replace(/\./g, "") : str;
    const n = Math.round(Number(norm) * 100); return Number.isFinite(n) && Math.abs(n) < 1e13 ? n : null; };
  const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const euro = c => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const company = () => getSetting("company", DEFAULT_COMPANY);
  const audit = (actor, action, entity, id, summary) => db.prepare("INSERT INTO audit_log(actor, action, entity, entity_id, summary) VALUES(?,?,?,?,?)").run(actor, action, entity, id, clean(summary, 500));
  const locked = (period, firma) => !!db.prepare("SELECT 1 FROM firm_locks WHERE period = ? AND firma = ?").get(String(period).slice(0, 7), firma === "hardware" && hardwareAktiv() ? "hardware" : "software");

  // Firmenfilter aus der Adresse (?firma=software|hardware). Ohne Angabe oder solange es nur eine Firma gibt: alles.
  const firmaWahl = url => { const f = url.searchParams.get("firma"); return hardwareAktiv() && (f === "software" || f === "hardware") ? f : ""; };
  const FI = url => firmaWahl(url) ? ` AND firma = '${firmaWahl(url)}'` : "";                                   // festgeschriebene Belege
  const FE = FI;                                                                                              // Ausgaben
  const FL = url => firmaWahl(url) ? ` AND ${firmaSql("invoices")} = '${firmaWahl(url)}'` : "";                // auch Entwürfe
  // Lückenloser Nummernkreis je Art und Jahr (innerhalb einer Transaktion vergeben)
  function nextNumber(kind, year, firma = "software") {
    const hw = firma === "hardware", kreis = hw ? kind + "-hw" : kind;
    db.prepare("INSERT OR IGNORE INTO number_sequences(kind, year, next) VALUES(?, ?, 1)").run(kreis, year);
    const n = db.prepare("UPDATE number_sequences SET next = next + 1 WHERE kind = ? AND year = ? RETURNING next - 1 AS n").get(kreis, year).n;
    return `${PREFIX[kind]}${hw ? "H" : ""}-${year}-${String(n).padStart(5, "0")}`;
  }
  const tx = fn => { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };

  // Summen: Netto je Position, USt je Steuersatz auf die Netto-Summe (übliches Verfahren)
  function totals(items) {
    const byRate = {}; let net = 0;
    for (const it of items) { net += it.net; byRate[it.vat_rate] = (byRate[it.vat_rate] || 0) + it.net; }
    const vatByRate = {}; let vat = 0;
    for (const [r, n] of Object.entries(byRate)) { const v = Math.round(n * Number(r) / 100); if (Number(r) > 0) vatByRate[r] = v; vat += v; }
    return { net, vat, gross: net + vat, vatByRate };
  }
  function cleanItems(list, defaultRate) {
    return (Array.isArray(list) ? list : []).slice(0, 100).map((x, i) => {
      const qty = Math.round((Number(String(x.qty ?? 1).replace(",", ".")) || 0) * 1000) / 1000, unit_net = cents(x.unit_net) ?? 0;
      const vat_rate = [0, 7, 19].includes(Number(x.vat_rate)) ? Number(x.vat_rate) : defaultRate;
      return { pos: i + 1, title: clean(x.title, 300), description: clean(x.description, 1200), qty, unit: clean(x.unit, 20), unit_net, vat_rate, net: Math.round(qty * unit_net) };
    }).filter(x => x.title && x.qty !== 0);
  }
  const recipientOf = c => ({ company: c.billing_name || c.company, name: c.name, street: c.street || "", zip: c.zip || "", city: c.city || "", country: c.country || "Deutschland", vat_id: c.vat_id || "", customer_no: c.customer_no || `K-${String(c.id).padStart(4, "0")}` });
  const senderOf = (firma = "software") => { const s = firmaDaten(firma); return { brand: s.brand, name: s.name, street: s.street, zip: s.zip, city: s.city, email: s.email, phone: s.phone, website: s.website, managingDirector: s.managingDirector, register: s.register, taxNumber: s.taxNumber, vatId: s.vatId, bank: s.bank, iban: s.iban, bic: s.bic }; };

  function invoiceFull(id) {
    const inv = db.prepare("SELECT i.*, c.company client_company, c.name client_name, c.email client_email, p.title project_title FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?").get(id);
    if (!inv) return null;
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY pos").all(id);
    const t = totals(items);
    const plan = JSON.parse(inv.plan || "null");
    const out = { ...inv, recipient: JSON.parse(inv.recipient || "{}"), sender: JSON.parse(inv.sender || "{}"), items, vatByRate: t.vatByRate, plan, avv: !!inv.avv,
      planText: inv.kind === "angebot" ? planText(plan, inv.locked ? inv.net : t.net, inv.locked ? inv.gross : t.gross) : "" };
    if (inv.kind === "angebot") { const a = db.prepare("SELECT decision, name, position, created_at, ip, doc_id, reason FROM acceptances WHERE invoice_id = ?").get(id); out.acceptance = a || null; }
    out.vereinbarung = vereinbarungLesen(inv.vereinbarung);
    out.betreuung = betreuungLesen(inv.betreuung);
    if (inv.cancels_id) { const o = db.prepare("SELECT number, issue_date FROM invoices WHERE id = ?").get(inv.cancels_id); out.cancels_number = o?.number; out.cancels_date = o?.issue_date; }
    if (inv.kind === "rechnung" && inv.status === "offen") out.dunning = dunningOf(inv);
    out.versand = versandListe(inv.kind, inv.id);
    return out;
  }
  function dunningOf(inv) {
    if (!inv.due_date) return null;
    const over = Math.floor((Date.now() - Date.parse(inv.due_date + "T23:59:59Z")) / 86400000);
    if (over < 0) return { overdue: 0, next: null };
    const stage = DUNNING.filter(d => over >= d.days).length - 1;
    return { overdue: over, suggested: DUNNING[stage].label, next: DUNNING[Math.min(inv.dunning_level, DUNNING.length - 1)].label, level: inv.dunning_level };
  }
  const draftView = inv => {   // für Vorschau eines Entwurfs: aktuelle Absender-/Empfängerdaten einsetzen
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(inv.client_id);
    return { ...inv, draft: true, sender: senderOf(), recipient: recipientOf(c), ...totals(inv.items) };
  };

  async function storePdf(buf) {
    const token = randomBytes(24).toString("hex"); await mkdir(FILE_DIR, { recursive: true });
    await writeFile(path.join(FILE_DIR, token + ".pdf"), buf, { flag: "wx" });   // einmal schreiben, nie überschreiben
    return { token, sha: createHash("sha256").update(buf).digest("hex") };
  }
  // PDF zusätzlich als Dokument beim Kunden (Portal) ablegen
  async function toPortal(inv, buf, kind) {
    const token = randomBytes(24).toString("hex"); await mkdir(DOC_DIR, { recursive: true }); await writeFile(path.join(DOC_DIR, token), buf);
    const r = db.prepare("INSERT INTO documents(client_id, project_id, kind, title, amount_gross, doc_date, file_token, file_name, mime, bytes) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(inv.client_id, inv.project_id, kind, `${kind === "Angebot" ? "Angebot" : inv.kind === "storno" ? "Stornorechnung" : "Rechnung"} ${inv.number}${inv.title ? " – " + inv.title : ""}`.slice(0, 160),
        inv.gross, inv.issue_date, token, `${inv.number}.pdf`, "application/pdf", buf.length);
    return r.lastInsertRowid;
  }
  async function mailInvoice(inv, buf, kind, extraText = "") {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(inv.client_id), firma = firmaDaten(inv.locked ? inv.firma : firmaVonProjekt(inv.project_id)).firma;
    const basis = { name: c.name, nummer: inv.number, titel: inv.title || "", freitext: extraText || "", anhang: !!buf, firma };
    if (!buf) console.warn(`${inv.number}: PDF fehlt – Mail ohne Anhang.`);
    const mail = kind === "angebot"
      ? vorlage("angebot_versand", { ...basis, betrag: Math.abs(inv.gross), gueltigBis: inv.valid_until || "", ...(c.pw_hash || !inviteLink ? { portalLink: `${SITE_URL}/portal/#angebot/${inv.id}` } : { zugangLink: inviteLink(c.id) }) })
      : kind === "storno"
        ? vorlage("storno_versand", { ...basis, betrag: inv.gross, storniert: inv.cancels_number || "", portalLink: `${SITE_URL}/portal/#dokumente` })
        : vorlage("rechnung_versand", { ...basis, betrag: Math.abs(inv.gross), faellig: inv.due_date || "", portalLink: `${SITE_URL}/portal/#dokumente` });
    return sendMail({ to: c.email, ...mail,
      attachments: buf ? [{ filename: `${inv.number}.pdf`, content: buf, contentType: "application/pdf" }] : [] });
  }
  /** Angebot/Rechnung als Karte in den Projekt-Chat (der Kunde öffnet sie im Portal) */
  const docImChat = (inv, user) => chatPosten({ clientId: inv.client_id, projectId: inv.project_id, user, art: "dokument",
    body: `${inv.kind === "angebot" ? "Ihr Angebot" : inv.kind === "storno" ? "Stornorechnung" : "Ihre Rechnung"} ${inv.number} liegt im Kundenportal bereit.`,
    meta: { doc_id: inv.pdf_doc_id || null, invoice_id: inv.id, art: inv.kind === "angebot" ? "Angebot" : inv.kind === "storno" ? "Storno" : "Rechnung", titel: inv.title || "", nummer: inv.number,
      betrag: Math.abs(inv.gross), faellig: inv.kind === "rechnung" ? inv.due_date : null, gueltig: inv.kind === "angebot" ? inv.valid_until : null } });
  const pdfOf = async inv => inv.pdf_token ? readFile(path.join(FILE_DIR, inv.pdf_token + ".pdf")) : renderInvoicePdf(draftView(inv));

  /** Rechnung/Angebot festschreiben: Nummer, Daten-Schnappschuss, PDF, Portal, Zahlungsplan, Verlauf, ggf. Mail */
  async function issue(id, { send: doSend, message, chat }, user) {
    const inv0 = invoiceFull(id);
    if (!inv0 || inv0.locked) throw Object.assign(new Error("Bereits festgeschrieben"), { code: 409 });
    if (!inv0.items.length) throw Object.assign(new Error("Bitte mindestens eine Position anlegen."), { code: 400 });
    const firma = inv0.cancels_id ? (db.prepare("SELECT firma FROM invoices WHERE id = ?").get(inv0.cancels_id)?.firma || "software") : firmaVonProjekt(inv0.project_id);
    const s = firmaDaten(firma);
    if (inv0.kind !== "angebot" && (!s.street || !s.city || !(s.taxNumber || s.vatId))) throw Object.assign(new Error(`Für Rechnungen der ${s.name} fehlen Pflichtangaben: Anschrift sowie Steuernummer oder USt-IdNr. – bitte unter Einstellungen → Unternehmen eintragen.`), { code: 400 });
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(inv0.client_id);
    if (inv0.kind !== "angebot" && (!c.street || !c.city)) throw Object.assign(new Error("Für die Rechnung fehlt die Anschrift des Kunden – bitte beim Kunden unter „Rechnungsadresse“ eintragen."), { code: 400 });
    const issueDate = inv0.issue_date || today();
    if (inv0.kind !== "angebot" && locked(issueDate, firma)) throw Object.assign(new Error(`Der Zeitraum ${issueDate.slice(0, 7)} ist abgeschlossen. Bitte ein aktuelles Rechnungsdatum wählen.`), { code: 409 });
    const t = totals(inv0.items);
    const number = tx(() => {
      const n = nextNumber(inv0.kind, Number(issueDate.slice(0, 4)), firma);
      db.prepare("UPDATE invoices SET firma = ? WHERE id = ?").run(firma, id);
      db.prepare(`UPDATE invoices SET number = ?, issue_date = ?, due_date = ?, valid_until = ?, recipient = ?, sender = ?, net = ?, vat = ?, gross = ?, status = ?, issued_at = datetime('now') WHERE id = ?`)
        .run(n, issueDate, inv0.kind === "rechnung" ? (inv0.due_date || addDays(issueDate, s.paymentDays || 14)) : inv0.due_date,
          inv0.kind === "angebot" ? (inv0.valid_until || addDays(issueDate, 30)) : null,
          JSON.stringify(recipientOf(c)), JSON.stringify(senderOf(firma)), t.net, t.vat, t.gross, inv0.kind === "angebot" ? "versendet" : inv0.kind === "storno" ? "storno" : "offen", id);
      return n;
    });
    const inv = invoiceFull(id);
    const buf = await renderInvoicePdf(inv);
    const { token, sha } = await storePdf(buf);
    const kindLabel = inv.kind === "angebot" ? "Angebot" : "Rechnung";
    const docId = await toPortal(inv, buf, kindLabel);
    db.prepare("UPDATE invoices SET pdf_token = ?, pdf_sha256 = ?, pdf_doc_id = ?, locked = 1 WHERE id = ?").run(token, sha, docId, id);
    if (inv.payment_id && inv.kind === "rechnung") db.prepare("UPDATE payments SET invoice_doc_id = ?, status = CASE WHEN status = 'offen' THEN 'berechnet' ELSE status END WHERE id = ?").run(docId, inv.payment_id);
    audit(user.name, "festgeschrieben", inv.kind, id, `${number} · ${euro(inv.gross)} · ${inv.recipient.company}`);
    logEvent(inv.client_id, inv.project_id, "dokument", inv.kind === "angebot" ? "Angebot übersendet" : inv.kind === "storno" ? "Rechnung storniert" : "Rechnung gestellt",
      `${number}${inv.title ? " – " + inv.title : ""} · ${euro(Math.abs(inv.gross))} brutto`, false);   // Mail entscheidet allein der Haken „Per E-Mail“ (dann mit PDF)
    if (chat) { docImChat(invoiceFull(id), user); versandMerken({ clientId: inv.client_id, projectId: inv.project_id, art: inv.kind, refId: id, kanal: "chat", von: user.name }); }
    let mailed = null;
    if (doSend) { mailed = await mailInvoice(invoiceFull(id), buf, inv.kind, clean(message, 3000)); db.prepare("UPDATE invoices SET sent_at = datetime('now') WHERE id = ?").run(id);
      versandMerken({ clientId: inv.client_id, projectId: inv.project_id, art: inv.kind, refId: id, kanal: "mail", von: user.name, an: c.email }); }
    return { invoice: invoiceFull(id), mailed };
  }

  /* ---------- Auswertung ---------- */
  function report(from, to, firma = "") {
    const fi = firma ? ` AND firma = '${firma}'` : "";
    const soll = ((firma ? firmaDaten(firma) : company()).taxMethod || "soll") !== "ist";
    // Soll-Versteuerung: Umsatzsteuer mit Rechnungsdatum; Ist-Versteuerung: mit Zahlungseingang
    const inv = soll
      ? db.prepare("SELECT * FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND issue_date BETWEEN ? AND ?" + fi).all(from, to)
      : db.prepare("SELECT * FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND paid_at BETWEEN ? AND ? AND status = 'bezahlt'" + fi).all(from, to);
    const exp = db.prepare("SELECT * FROM expenses WHERE status != 'storniert' AND doc_date BETWEEN ? AND ? AND reversal_of IS NULL" + fi).all(from, to);
    const revenueNet = inv.reduce((s, i) => s + i.net, 0), ust = inv.reduce((s, i) => s + i.vat, 0);
    const rc = exp.filter(e => e.tax_mode === "rc19").reduce((s, e) => s + Math.round(e.net * .19), 0);
    const vst = exp.reduce((s, e) => s + e.vat, 0) + rc;
    const byCat = {}; for (const e of exp) byCat[e.category] = (byCat[e.category] || 0) + e.net;
    const paidIn = db.prepare("SELECT COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND status = 'bezahlt' AND paid_at BETWEEN ? AND ?" + fi).get(from, to).s;
    return { from, to, method: soll ? "Soll-Versteuerung (nach Rechnungsdatum)" : "Ist-Versteuerung (nach Zahlungseingang)",
      revenueNet, ust, rcUst: rc, vst, zahllast: ust + rc - vst, expensesNet: exp.reduce((s, e) => s + e.net, 0), expensesGross: exp.reduce((s, e) => s + e.gross, 0),
      result: revenueNet - exp.reduce((s, e) => s + e.net, 0), paidIn, invoices: inv.length, expenses: exp.length,
      byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ category: k, net: v })) };
  }

  /* ---------- Export für den Steuerberater ---------- */
  const csvCell = v => v == null ? "" : typeof v === "number" ? (v / 100).toFixed(2).replace(".", ",") : `"${String(v).replace(/"/g, '""')}"`;
  const csv = (head, rows) => "﻿" + [head.map(h => `"${h}"`).join(";"), ...rows.map(r => r.map(csvCell).join(";"))].join("\r\n") + "\r\n";
  const de = d => d ? d.split("-").reverse().join(".") : "";
  async function exportZip(from, to, user, firma = "") {
    const s = firma ? firmaDaten(firma) : company(), files = [], sums = [], fi = firma ? ` AND firma = '${firma}'` : "";
    const invs = db.prepare("SELECT i.*, c.company FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.kind IN ('rechnung','storno') AND i.locked = 1 AND i.issue_date BETWEEN ? AND ?" + fi.replace("firma", "i.firma") + " ORDER BY i.number").all(from, to);
    const exps = db.prepare("SELECT * FROM expenses WHERE doc_date BETWEEN ? AND ?" + fi + " ORDER BY number").all(from, to);
    files.push({ path: "Rechnungsausgangsbuch.csv", data: csv(["Rechnungsnummer", "Art", "Datum", "Leistungszeitraum", "Kunde", "Netto", "USt", "Brutto", "Status", "Bezahlt am", "Storno zu"],
      invs.map(i => [i.number, i.kind === "storno" ? "Stornorechnung" : "Rechnung", de(i.issue_date), [de(i.service_from), de(i.service_to)].filter(Boolean).join(" – "), i.company, i.net, i.vat, i.gross, i.status, de(i.paid_at), i.cancels_id ? db.prepare("SELECT number FROM invoices WHERE id = ?").get(i.cancels_id)?.number : ""])) });
    files.push({ path: "Belege_Ausgaben.csv", data: csv(["Belegnummer", "Belegdatum", "Lieferant", "Beschreibung", "Kategorie", "Konto (SKR04)", "Steuer", "Netto", "Vorsteuer", "Brutto", "Bezahlt am", "Zahlart", "Status", "Datei", "SHA-256"],
      exps.map(e => [e.number, de(e.doc_date), e.supplier, e.description, e.category, e.account, TAX_MODES[e.tax_mode]?.label, e.net, e.vat, e.gross, de(e.paid_date), e.payment_method, e.status, e.file_name ? `Belege/${e.number}${path.extname(e.file_name)}` : "", e.sha256])) });
    const r = report(from, to, firma);
    files.push({ path: "Umsatzsteuer_Uebersicht.csv", data: csv(["Zeitraum", "Verfahren", "Umsatz netto", "Umsatzsteuer", "USt § 13b", "Vorsteuer", "Zahllast"], [[`${de(from)} – ${de(to)}`, r.method, r.revenueNet, r.ust, r.rcUst, r.vst, r.zahllast]]) });
    // DATEV-Buchungsstapel (Format EXTF 700) – Vorschau, vor dem ersten Import mit dem Steuerberater testen
    const dd = d => d.slice(8, 10) + d.slice(5, 7);
    const lines = [];
    for (const i of invs) lines.push([Math.abs(i.gross), i.kind === "storno" ? "H" : "S", 10000 + i.client_id, "4400", "", dd(i.issue_date), i.number, `${i.kind === "storno" ? "Storno " : "Rechnung "}${i.company}`.slice(0, 60)]);
    for (const i of invs.filter(x => x.status === "bezahlt" && x.paid_at && x.paid_at >= from && x.paid_at <= to)) lines.push([i.paid_amount ?? i.gross, "S", "1800", 10000 + i.client_id, "", dd(i.paid_at), i.number, `Zahlung ${i.company}`.slice(0, 60)]);
    for (const e of exps.filter(x => x.status !== "storniert" && !x.reversal_of)) lines.push([e.gross, "S", e.account || "6300", e.paid_date ? "1800" : "3300", { v19: "9", v7: "8", v0: "", rc19: "94" }[e.tax_mode] || "", dd(e.doc_date), e.number, `${e.supplier} ${e.description || ""}`.trim().slice(0, 60)]);
    const now = new Date(), stamp = now.toISOString().replace(/\D/g, "").slice(0, 17);
    const fy = `${from.slice(0, 4)}0101`;
    const header = `"EXTF";700;21;"Buchungsstapel";12;${stamp};;"RB";"";"";${s.datevBerater || ""};${s.datevMandant || ""};${fy};4;${from.replace(/-/g, "")};${to.replace(/-/g, "")};"Reeder Board ${de(from)}-${de(to)}";"";1;0;0;"EUR";;"";;;"04";;;"";""`;
    const cols = '"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";"Konto";"Gegenkonto (ohne BU-Schlüssel)";"BU-Schlüssel";"Belegdatum";"Belegfeld 1";"Buchungstext"';
    files.push({ path: "DATEV/EXTF_Buchungsstapel.csv", data: datevAnsi([header, cols, ...lines.map(l => [(l[0] / 100).toFixed(2).replace(".", ","), `"${l[1]}"`, l[2], l[3], l[4] ? `"${l[4]}"` : "", l[5], `"${l[6]}"`, `"${String(l[7]).replace(/"/g, "'")}"`].join(";"))].join("\r\n") + "\r\n") });
    for (const i of invs) if (i.pdf_token) { const b = await readFile(path.join(FILE_DIR, i.pdf_token + ".pdf")); files.push({ path: `Rechnungen/${i.number}.pdf`, data: b }); sums.push(`${createHash("sha256").update(b).digest("hex")}  Rechnungen/${i.number}.pdf`); }
    for (const e of exps) if (e.file_token) { try { const b = await readFile(path.join(FILE_DIR, e.file_token)); const p = `Belege/${e.number}${path.extname(e.file_name || "")}`; files.push({ path: p, data: b }); sums.push(`${createHash("sha256").update(b).digest("hex")}  ${p}`); } catch {} }
    files.push({ path: "LIESMICH.txt", data: [`Export ${s.name} · Zeitraum ${de(from)} – ${de(to)} · erstellt ${now.toLocaleString("de-DE")} von ${user.name}`, "",
      "Inhalt:", "- Rechnungsausgangsbuch.csv  (alle festgeschriebenen Rechnungen und Stornorechnungen)", "- Belege_Ausgaben.csv  (Eingangsbelege mit Kategorie und SKR04-Kontovorschlag)",
      "- Umsatzsteuer_Uebersicht.csv", "- DATEV/EXTF_Buchungsstapel.csv  (Debitoren 10000 + Kunden-ID, Erlöse 4400, Bank 1800, Verbindlichkeiten 3300)",
      "  HINWEIS: Kontenzuordnung und BU-Schlüssel sind Vorschläge. Bitte vor dem ersten Import mit dem Steuerberater abstimmen.",
      "- Rechnungen/*.pdf, Belege/*  (Originaldateien)", "", "Prüfsummen (SHA-256):", ...sums].join("\r\n") });
    audit(user.name, "export", "zeitraum", null, `${from} bis ${to} · ${invs.length} Rechnungen · ${exps.length} Belege`);
    return createZip(files);
  }

  // DATEV erwartet ANSI (Windows-1252) ohne BOM – Zeichen außerhalb von Latin-1 werden ersetzt
  const datevAnsi = t => Buffer.from(t.replace(/[–—]/g, "-").replace(/[„“”]/g, '"').replace(/[^\x00-\xff]/g, "?"), "latin1");

  /* ================= API ================= */
  async function api(req, res, url, p, user) {
    const m = req.method;
    if (!p.startsWith("/finance")) return null;
    const q = p.slice(8);
    if (q === "/meta" && m === "GET") return json(res, 200, { categories: CATEGORIES.map(([label, account]) => ({ label, account })), taxModes: TAX_MODES, company: company(), firmen: { hardwareAktiv: hardwareAktiv(), software: company().name, hardware: getSetting("companyHardware", DEFAULT_HARDWARE).name },
      periods: db.prepare("SELECT * FROM firm_locks ORDER BY period DESC").all() });

    if (q === "/overview" && m === "GET") {
      const fi = FI(url), fe = FE(url);   // Filter auf eine Firma (leer = beide zusammen)
      const y = String(new Date().getFullYear()), mo = today().slice(0, 7), qn = Math.floor(new Date().getMonth() / 3);
      const qFrom = `${y}-${String(qn * 3 + 1).padStart(2, "0")}-01`, qTo = addDays(`${qn === 3 ? +y + 1 : y}-${String(qn === 3 ? 1 : qn * 3 + 4).padStart(2, "0")}-01`, -1);
      const open = db.prepare("SELECT i.*, c.company FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.kind = 'rechnung' AND i.status = 'offen'" + fi.replace(/firma/, "i.firma") + " ORDER BY i.due_date").all();
      const sum = sql => db.prepare(sql).get().s;
      return json(res, 200, {
        openSum: open.reduce((s, i) => s + i.gross, 0), openCount: open.length,
        overdue: open.filter(i => i.due_date && i.due_date < today()).map(i => ({ id: i.id, number: i.number, company: i.company, gross: i.gross, due_date: i.due_date, dunning: dunningOf(i) })),
        revenueMonth: sum(`SELECT COALESCE(SUM(net),0) s FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND substr(issue_date,1,7) = '${mo}'${fi}`),
        revenueYear: sum(`SELECT COALESCE(SUM(net),0) s FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND substr(issue_date,1,4) = '${y}'${fi}`),
        paidYear: sum(`SELECT COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND status = 'bezahlt' AND substr(paid_at,1,4) = '${y}'${fi}`),
        expensesYear: sum(`SELECT COALESCE(SUM(net),0) s FROM expenses WHERE status != 'storniert' AND reversal_of IS NULL AND substr(doc_date,1,4) = '${y}'${fe}`),
        quarter: { label: `Q${qn + 1} ${y}`, ...report(qFrom, qTo, firmaWahl(url)) },
        // Aufgaben für die Übersicht: fällige Raten ohne Rechnung, Entwürfe, offene Rechnungen, offene Angebote
        zuStellen: db.prepare(`SELECT pay.id, pay.label, pay.amount_net, pay.due, p.id project_id, p.title project, p.vat_rate, p.bereich, c.id client_id, c.company FROM payments pay JOIN projects p ON p.id = pay.project_id JOIN clients c ON c.id = p.client_id
            WHERE pay.status = 'offen' AND pay.invoice_doc_id IS NULL AND p.status = 'aktiv' AND pay.id NOT IN (SELECT payment_id FROM invoices WHERE payment_id IS NOT NULL) AND (pay.due IS NULL OR pay.due <= date('now','+14 days')) ORDER BY pay.due IS NULL, pay.due LIMIT 12`).all()
          .filter(x => !firmaWahl(url) || firmaVonProjekt(x.project_id) === firmaWahl(url)).map(x => ({ ...x, gross: Math.round(x.amount_net * (1 + x.vat_rate / 100)) })),
        entwuerfe: db.prepare(`SELECT i.id, i.kind, i.title, i.gross, c.company FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.locked = 0${FL(url).replace(/invoices\./g, "i.")} ORDER BY i.id DESC LIMIT 8`).all(),
        offene: open.slice(0, 8).map(i => ({ id: i.id, number: i.number, company: i.company, gross: i.gross, due_date: i.due_date })),
        angeboteOffen: db.prepare(`SELECT i.id, i.number, i.title, i.gross, i.issue_date, c.company FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.kind = 'angebot' AND i.status = 'versendet'${fi.replace("firma", "i.firma")} ORDER BY i.id DESC LIMIT 8`).all(),
        drafts: db.prepare(`SELECT COUNT(*) n FROM invoices WHERE locked = 0${FL(url)}`).get().n,
        openQuotes: db.prepare(`SELECT COUNT(*) n FROM invoices WHERE kind = 'angebot' AND status = 'versendet'${fi}`).get().n,
        months: Array.from({ length: 12 }, (_, i) => { const k = `${y}-${String(i + 1).padStart(2, "0")}`;
          return { month: k, revenue: sum(`SELECT COALESCE(SUM(net),0) s FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND substr(issue_date,1,7) = '${k}'${fi}`),
            expenses: sum(`SELECT COALESCE(SUM(net),0) s FROM expenses WHERE status != 'storniert' AND reversal_of IS NULL AND substr(doc_date,1,7) = '${k}'${fe}`) }; }),
      });
    }

    /* --- Angebotsvorschlag per KI: liest Notizen, Fragebogen, Projekt und Vorlagen; der Inhaber prüft und verschickt selbst --- */
    if (q === "/offer-draft" && m === "POST") {
      const st = assistantStatus();
      if (!st.key && !st.mock) return json(res, 503, { error: "Für KI-Vorschläge fehlt der API-Schlüssel. Tragen Sie ANTHROPIC_API_KEY in die Datei .env ein und starten Sie das Board neu." });
      if (!st.available) return json(res, 503, { error: st.enabled ? `Das Monatslimit für KI-Kosten (${st.cap} $) ist erreicht. Es lässt sich in den Einstellungen anheben.` : "Der KI-Assistent ist in den Einstellungen ausgeschaltet." });
      const d = await readJson(req, 128 * 1024);
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+d.client_id); if (!c) return json(res, 400, { error: "Bitte zuerst einen Kunden wählen." });
      const pr = d.project_id ? db.prepare("SELECT id, title, kind, description, bereich FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id) : null;
      // Alles, was über das Vorhaben bekannt ist
      const termine = db.prepare("SELECT title, start, summary, next_steps, notes_intern FROM appointments WHERE client_id = ? AND start < ? ORDER BY start DESC LIMIT 3").all(c.id, new Date().toISOString());
      const anfrage = db.prepare("SELECT description, kinds, budget FROM requests WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(c.id);
      const buchung = db.prepare("SELECT message, type FROM bookings WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(c.id);
      const ob = db.prepare("SELECT o.* FROM onboarding o LEFT JOIN bookings b ON b.id = o.booking_id WHERE (o.client_id = ? OR b.client_id = ?) AND o.answers IS NOT NULL ORDER BY o.id DESC LIMIT 1").get(c.id, c.id);
      let fragebogen = [];
      try { if (ob) { const a = JSON.parse(ob.answers); fragebogen = JSON.parse(ob.kinds).flatMap(k => antwortenView(k, a[k]).flatMap(g => g.rows.map(r => `${r.k}: ${[...(r.chips || []), r.v].filter(Boolean).join(", ")}`))); } } catch {}
      const vorlagen = (getSetting("offerTemplates", { list: DEFAULT_TEMPLATES }).list || []).map(v => ({ name: v.name, titel: v.title, einleitung: v.intro, schlusstext: v.outro,
        positionen: (v.items || []).map(it => ({ titel: it.title, beschreibung: it.description, menge: it.qty, einheit: it.unit, einzelpreis_euro: it.unit_net ? it.unit_net / 100 : null })),
        zahlungsplan: (v.plan || []).map(p => ({ bezeichnung: p.label, prozent: p.pct, faellig: p.on })) }));
      const daten = {
        kunde: { firma: c.company, ansprechpartner: c.name },
        projekt: pr ? { titel: pr.title, bereich: pr.bereich || "software", art: pr.kind || "", beschreibung: clean(pr.description, 1500) } : null,
        gespraechsnotizen: [clean(d.notizen, 6000), ...termine.map(t => t.notes_intern)].filter((x, i, l) => x && l.indexOf(x) === i),
        zusammenfassungen: termine.filter(t => t.summary).map(t => `${t.title}: ${t.summary}${t.next_steps ? " Nächste Schritte: " + t.next_steps : ""}`),
        anfrage: [anfrage?.description, anfrage?.kinds && "Themen: " + anfrage.kinds, anfrage?.budget && "Budget laut Anfrage: " + anfrage.budget, buchung?.message].filter(Boolean),
        fragebogen: fragebogen.slice(0, 60),
        wunsch_des_inhabers: clean(d.wunsch, 2000),
        bisheriger_entwurf: { titel: clean(d.title, 200), positionen: (Array.isArray(d.items) ? d.items : []).slice(0, 20).map(it => ({ titel: clean(it.title, 300), beschreibung: clean(it.description, 600), einzelpreis_euro: Number(it.unit_net) || null })) },
        bisheriger_zahlungsplan: (Array.isArray(d.plan) ? d.plan : []).slice(0, 6).map(p => ({ bezeichnung: clean(p.label, 80), prozent: Number(p.pct) || 0, faellig: clean(p.on, 20) })),
        vorlagen,
      };
      const system = `Du bereitest für den Inhaber einer kleinen deutschen Firma (Software, KI-Lösungen und Entwicklung physischer Produkte) den Entwurf eines Angebots vor. Der Inhaber prüft jeden Entwurf selbst, bevor er ihn verschickt.

Regeln:
- Biete nur an, was aus Gesprächsnotizen, Wunsch des Inhabers, Fragebogen oder Anfrage hervorgeht. Erfinde keine Leistungen, Termine oder Zusagen.
- Passt eine Vorlage, übernimm ihre Positionen und Texte und passe sie an das Vorhaben an. Sonst formuliere eigene Positionen im selben Stil.
- Preise: Übernimm einen Preis nur, wenn er in einer Vorlage steht oder in den Notizen bzw. im Wunsch des Inhabers ausdrücklich genannt ist. Das Budget des Kunden ist kein Preis. Kennst du den Preis nicht, setze preis_bekannt auf false und einzelpreis auf 0 und stelle dazu eine Rückfrage.
- Hardware (Projekt mit bereich "hardware"): Solange kein fertiges Entwicklungskonzept vorliegt, biete ausschließlich das Entwicklungskonzept an. Prototyp, Bau oder Serie bekommen keinen Preis und keine Position, denn ihre Kosten stehen erst mit der Stückliste fest; erwähne im hinweis, dass der Prototyp danach als Pauschalpreis aus der Kalkulation angeboten wird.
- Alle Preise sind Nettobeträge in Euro. Zur Umsatzsteuer schreibst du nichts, sie wird automatisch ergänzt.
- Einleitung und Schlusstext: höflich, Anrede mit „Sie“, ohne Anrede-Zeile und ohne Grußformel (beides setzt das Dokument selbst), je ein bis zwei Sätze. Die Einleitung beginnt klein geschrieben, weil die Anrede davor steht.
- Beschreibungen der Positionen: ein bis zwei kurze Sätze (höchstens etwa 200 Zeichen), konkret, verständlich für Nicht-Techniker. Lieber eine Position mehr als eine sehr lange Beschreibung.
- zahlungsplan: Raten, die zusammen genau 100 % ergeben; faellig ist eines von Auftrag, Konzept, Prototyp, Umsetzung, Launch, Betreuung. Hat der Inhaber eine Zahlungsweise genannt, gilt sie. Sonst: kleine Projekte (unter etwa 5.000 € netto) eine Rate mit 100 % bei Launch oder 50 % bei Auftrag und 50 % bei Launch; größere Projekte 30 % bei Auftrag, 40 % bei Prototyp, 30 % bei Launch. Hat eine passende Vorlage einen Zahlungsplan, übernimm ihn.
- rueckfragen: höchstens fünf kurze Fragen an den Inhaber zu allem, was für ein verbindliches Angebot fehlt (Preis, Umfang, Zahlungsweise, Frist). Leer, wenn nichts fehlt.
- hinweis: ein Satz dazu, worauf du den Entwurf gestützt hast, oder leer.`;
      const schema = { type: "object", additionalProperties: false, required: ["titel", "einleitung", "positionen", "schlusstext", "rueckfragen", "hinweis", "zahlungsplan"], properties: {
        zahlungsplan: { type: "array", items: { type: "object", additionalProperties: false, required: ["bezeichnung", "prozent", "faellig"], properties: { bezeichnung: { type: "string" }, prozent: { type: "number" }, faellig: { type: "string", enum: ["Auftrag", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"] } } } },
        titel: { type: "string" }, einleitung: { type: "string" }, schlusstext: { type: "string" }, hinweis: { type: "string" }, rueckfragen: { type: "array", items: { type: "string" } },
        positionen: { type: "array", items: { type: "object", additionalProperties: false, required: ["titel", "beschreibung", "menge", "einheit", "preis_bekannt", "einzelpreis"],
          properties: { titel: { type: "string" }, beschreibung: { type: "string" }, menge: { type: "number" }, einheit: { type: "string" }, preis_bekannt: { type: "boolean" }, einzelpreis: { type: "number" } } } } } };
      const modell = getSetting("assistant", {}).modelReply || DEFAULT_ASSISTANT.modelReply;
      let r;
      try { r = await callModel("angebot", modell, system, `Erstelle den Angebotsentwurf.\n<<DATEN>>\n${JSON.stringify(daten)}`, schema, null, pr?.id ?? null); }
      catch (e) { return json(res, e.code === 503 ? 503 : 500, { error: e.message || "Der Vorschlag ließ sich nicht erstellen." }); }
      audit(user.name, "ki-vorschlag", "angebot", 0, c.company);
      return json(res, 200, { title: clean(r.titel, 200), intro: clean(r.einleitung, 3000), outro: clean(r.schlusstext, 3000), hinweis: clean(r.hinweis, 400),
        fragen: (Array.isArray(r.rueckfragen) ? r.rueckfragen : []).slice(0, 5).map(x => clean(x, 300)).filter(Boolean),
        plan: cleanPlan((Array.isArray(r.zahlungsplan) ? r.zahlungsplan : []).map(p => ({ label: p.bezeichnung, pct: p.prozent, on: p.faellig }))) || [],
        items: (Array.isArray(r.positionen) ? r.positionen : []).slice(0, 20).map(it => ({ title: clean(it.titel, 300), description: clean(it.beschreibung, 1200), qty: Number(it.menge) > 0 ? Number(it.menge) : 1, unit: clean(it.einheit, 20) || "pauschal",
          unit_net: it.preis_bekannt && Number(it.einzelpreis) > 0 ? Math.round(Number(it.einzelpreis) * 100) : null })).filter(it => it.title) });
    }

    /* --- Besondere Vereinbarung: aus Stichpunkten des Inhabers ein sauberes Schreiben (zum Mitunterschreiben mit dem Angebot) --- */
    if (q === "/agreement-draft" && m === "POST") {
      const st = assistantStatus();
      if (!st.key && !st.mock) return json(res, 503, { error: "Für KI-Vorschläge fehlt der API-Schlüssel (ANTHROPIC_API_KEY in der .env)." });
      if (!st.available) return json(res, 503, { error: st.enabled ? `Das Monatslimit für KI-Kosten (${st.cap} $) ist erreicht.` : "Der KI-Assistent ist in den Einstellungen ausgeschaltet." });
      const d = await readJson(req, 64 * 1024);
      const c = db.prepare("SELECT company, name FROM clients WHERE id = ?").get(+d.client_id); if (!c) return json(res, 400, { error: "Bitte zuerst einen Kunden wählen." });
      const stichpunkte = clean(d.text, 4000); if (!stichpunkte && !clean(d.titel, 120)) return json(res, 400, { error: "Bitte erst in eigenen Worten eintragen, was gelten soll." });
      const firma = company();
      const daten = { auftragnehmer: firma.name || "Reeder Software GmbH", auftraggeber: c.company || c.name, worum: clean(d.titel, 120), stichpunkte, anteil_prozent: clean(String(d.prozent || ""), 10),
        angebot: { titel: clean(d.angebot_titel, 200), positionen: (Array.isArray(d.positionen) ? d.positionen : []).slice(0, 15).map(x => clean(x, 200)) } };
      const system = `Du formulierst für den Inhaber einer kleinen deutschen Firma aus seinen Stichpunkten eine „Besondere Vereinbarung“, die als Anlage zum Angebot vom Kunden mitunterschrieben wird.
Regeln:
- Nur regeln, was in den Stichpunkten steht. Nichts erfinden: keine Beträge, Fristen, Laufzeiten oder Pflichten, die nicht genannt sind. Fehlt etwas Wichtiges (z. B. Laufzeit, Kündigung, Vergütung), nenne es in fehlt.
- Aufbau als nummerierte Abschnitte, jeweils eine Zeile „§ n Überschrift“ und darunter ein bis drei kurze Sätze: Gegenstand, Leistungen, Vergütung, Laufzeit und Kündigung, Sonstiges – nur die Abschnitte, für die es Inhalt gibt.
- Klare, verständliche Sprache ohne Juristendeutsch, Parteien als „Auftragnehmer“ (${daten.auftragnehmer}) und „Auftraggeber“ (${daten.auftraggeber}). Beträge netto zzgl. MwSt.
- Der Text ergänzt das Angebot und die Vertragsbedingungen; im Zweifel gelten diese. Füge am Ende keinen Unterschriftenblock ein, unterschrieben wird mit der Annahme des Angebots.
- titel: kurz, z. B. „Betreuung der Website“.`;
      const schema = { type: "object", additionalProperties: false, required: ["titel", "text", "fehlt"], properties: { titel: { type: "string" }, text: { type: "string" }, fehlt: { type: "array", items: { type: "string" } } } };
      const modell = getSetting("assistant", {}).modelReply || DEFAULT_ASSISTANT.modelReply;
      let r;
      try { r = await callModel("vereinbarung", modell, system, `Formuliere die Vereinbarung.\n<<DATEN>>\n${JSON.stringify(daten)}`, schema, null, +d.project_id || null); }
      catch (e) { return json(res, e.code === 503 ? 503 : 500, { error: e.message || "Die Vereinbarung ließ sich nicht formulieren." }); }
      audit(user.name, "ki-vorschlag", "vereinbarung", 0, c.company || c.name);
      return json(res, 200, { titel: clean(r.titel, 120), text: clean(r.text, 8000), fehlt: (Array.isArray(r.fehlt) ? r.fehlt : []).slice(0, 5).map(x => clean(x, 200)).filter(Boolean) });
    }

    /* --- Angebotsvorlagen: Titel, Texte und Positionen zum Wiederverwenden --- */
    if (q === "/templates" && m === "GET") return json(res, 200, getSetting("offerTemplates", { list: DEFAULT_TEMPLATES }).list || []);   // als Objekt abgelegt: getSetting mischt Vorgabe und Gespeichertes feldweise
    if (q === "/templates" && m === "PUT") {
      const d = await readJson(req, 256 * 1024), rate = Number(company().vatRate ?? 19);
      const liste = (Array.isArray(d.templates) ? d.templates : []).slice(0, 40).map(t => ({ name: clean(t.name, 80), title: clean(t.title, 200), intro: clean(t.intro, 3000), outro: clean(t.outro, 3000),
        items: cleanItems(t.items, rate).map(it => ({ title: it.title, description: it.description, qty: it.qty, unit: it.unit, unit_net: it.unit_net, vat_rate: it.vat_rate })),
        plan: cleanPlan(t.plan) || [] })).filter(t => t.name);
      setSetting("offerTemplates", { list: liste }); audit(user.name, "vorlagen", "angebot", 0, `${liste.length} Vorlagen`);
      return json(res, 200, liste);
    }

    /* --- Rechnungen & Angebote --- */
    if (q === "/invoices" && m === "GET") {
      const kind = url.searchParams.get("kind") === "angebot" ? ["angebot"] : ["rechnung", "storno"];
      const rows = db.prepare(`SELECT i.*, c.company, p.title project_title FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id WHERE i.kind IN (${kind.map(() => "?").join(",")})${firmaWahl(url) ? ` AND ${firmaSql("i")} = '${firmaWahl(url)}'` : ""} ORDER BY i.locked, COALESCE(i.issue_date, i.created_at) DESC, i.id DESC LIMIT 500`).all(...kind);
      return json(res, 200, rows.map(r => ({ firma: r.locked ? r.firma : firmaVonProjekt(r.project_id), id: r.id, kind: r.kind, number: r.number, status: r.status, title: r.title, company: r.company, client_id: r.client_id, project: r.project_title, issue_date: r.issue_date, due_date: r.due_date, valid_until: r.valid_until,
        net: r.net, gross: r.gross, locked: !!r.locked, sent_at: r.sent_at, paid_at: r.paid_at, versand: r.locked ? letzterVersand(r.kind, r.id) : null, dunning: r.kind === "rechnung" && r.status === "offen" ? dunningOf(r) : null,
        draftTotals: r.locked ? null : totals(db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(r.id)) })));
    }
    if (q === "/invoices" && m === "POST") {
      const d = await readJson(req, 256 * 1024), kind = ["rechnung", "angebot"].includes(d.kind) ? d.kind : "rechnung";
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+d.client_id); if (!c) return json(res, 400, { error: "Bitte einen Kunden wählen." });
      const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id)?.id ?? null : null;
      const paymentId = d.payment_id && projectId ? db.prepare("SELECT id FROM payments WHERE id = ? AND project_id = ?").get(+d.payment_id, projectId)?.id ?? null : null;
      const rate = Number(company().vatRate ?? 19);
      const plan = kind === "angebot" ? cleanPlan(d.plan) : null;
      const r = db.prepare("INSERT INTO invoices(kind, client_id, project_id, payment_id, title, issue_date, service_from, service_to, due_date, valid_until, intro, outro, created_by, plan, avv) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(kind, c.id, projectId, paymentId, clean(d.title, 200), ymd(d.issue_date), ymd(d.service_from), ymd(d.service_to), ymd(d.due_date), ymd(d.valid_until), clean(d.intro, 3000), clean(d.outro, 3000), user.name, plan ? JSON.stringify(plan) : null, kind === "angebot" && d.avv ? 1 : 0);
      if (kind === "angebot") db.prepare("UPDATE invoices SET vereinbarung = ?, betreuung = ? WHERE id = ?").run(vereinbarungSpeichern(d.vereinbarung, clean), betreuungSpeichern(d.betreuung, clean), r.lastInsertRowid);
      const items = cleanItems(d.items, rate), ins = db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const it of items) ins.run(r.lastInsertRowid, it.pos, it.title, it.description, it.qty, it.unit, it.unit_net, it.vat_rate, it.net);
      const t = totals(items); db.prepare("UPDATE invoices SET net = ?, vat = ?, gross = ? WHERE id = ?").run(t.net, t.vat, t.gross, r.lastInsertRowid);
      audit(user.name, "entwurf", kind, r.lastInsertRowid, `${c.company} · ${euro(t.gross)}`);
      return json(res, 201, invoiceFull(r.lastInsertRowid));
    }
    // Alle Angebote, Rechnungen und Stornos eines Projekts (nur lesen) – für die Karte „Angebote und Rechnungen“ auf der Projektseite
    let pd = q.match(/^\/projects\/(\d+)\/dokumente$/);
    if (pd && m === "GET") {
      const rows = db.prepare("SELECT * FROM invoices WHERE project_id = ? AND kind IN ('angebot','rechnung','storno') ORDER BY COALESCE(issue_date, created_at) DESC, id DESC").all(+pd[1]);
      return json(res, 200, rows.map(r => {
        const acc = r.kind === "angebot" ? db.prepare("SELECT decision, created_at, doc_id FROM acceptances WHERE invoice_id = ?").get(r.id) : null;
        const storniert = r.cancels_id ? db.prepare("SELECT number FROM invoices WHERE id = ?").get(r.cancels_id)?.number : null;
        return { id: r.id, kind: r.kind, number: r.number, status: r.status, title: r.title, locked: !!r.locked, issue_date: r.issue_date, due_date: r.due_date, valid_until: r.valid_until,
          gross: r.locked ? r.gross : totals(db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(r.id)).gross, payment_id: r.payment_id, sent_at: r.sent_at, paid_at: r.paid_at,
          dunning: r.kind === "rechnung" && r.status === "offen" ? dunningOf(r) : null, cancels_number: storniert,
          acceptance: acc ? { decision: acc.decision, at: acc.created_at, doc_id: acc.doc_id } : null, versand: r.locked ? letzterVersand(r.kind, r.id) : null };
      }));
    }
    let mm = q.match(/^\/invoices\/(\d+)(\/(pdf|issue|send|paid|cancel|remind|convert|status))?$/);
    if (mm) {
      const id = +mm[1], act = mm[3], inv = invoiceFull(id);
      if (!inv) return json(res, 404, { error: "Nicht gefunden" });
      if (!act && m === "GET") return json(res, 200, inv);
      if (!act && m === "PUT") {
        if (inv.locked) return json(res, 409, { error: "Festgeschriebene Dokumente können nicht mehr geändert werden – bitte stornieren." });
        const d = await readJson(req, 256 * 1024), rate = Number(company().vatRate ?? 19);
        const projectId = d.project_id ? db.prepare("SELECT id FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, inv.client_id)?.id ?? null : null;
        const paymentId = d.payment_id && projectId ? db.prepare("SELECT id FROM payments WHERE id = ? AND project_id = ?").get(+d.payment_id, projectId)?.id ?? null : null;
        const items = cleanItems(d.items, rate), t = totals(items), plan = inv.kind === "angebot" ? cleanPlan(d.plan) : null;
        tx(() => {
          db.prepare("UPDATE invoices SET plan = ?, avv = ? WHERE id = ?").run(plan ? JSON.stringify(plan) : null, inv.kind === "angebot" && d.avv ? 1 : 0, id);
          if (inv.kind === "angebot") db.prepare("UPDATE invoices SET vereinbarung = ?, betreuung = ? WHERE id = ?").run(vereinbarungSpeichern(d.vereinbarung, clean), betreuungSpeichern(d.betreuung, clean), id);
          db.prepare("UPDATE invoices SET project_id = ?, payment_id = ?, title = ?, issue_date = ?, service_from = ?, service_to = ?, due_date = ?, valid_until = ?, intro = ?, outro = ?, net = ?, vat = ?, gross = ? WHERE id = ?")
            .run(projectId, paymentId, clean(d.title, 200), ymd(d.issue_date), ymd(d.service_from), ymd(d.service_to), ymd(d.due_date), ymd(d.valid_until), clean(d.intro, 3000), clean(d.outro, 3000), t.net, t.vat, t.gross, id);
          db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(id);
          const ins = db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,?,?,?,?,?,?,?,?)");
          for (const it of items) ins.run(id, it.pos, it.title, it.description, it.qty, it.unit, it.unit_net, it.vat_rate, it.net);
        });
        return json(res, 200, invoiceFull(id));
      }
      if (!act && m === "DELETE") {
        if (inv.locked) return json(res, 409, { error: "Festgeschriebene Dokumente dürfen nicht gelöscht werden (GoBD) – bitte stornieren." });
        db.prepare("DELETE FROM invoices WHERE id = ?").run(id); audit(user.name, "entwurf gelöscht", inv.kind, id, inv.title || ""); return json(res, 200, { ok: true });
      }
      if (act === "pdf" && m === "GET") {
        const buf = await pdfOf(inv);
        return send(res, 200, buf, { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${inv.number || "Entwurf"}.pdf"` });
      }
      if (act === "issue" && m === "POST") { const d = await readJson(req); return json(res, 200, await issue(id, d, user)); }
      if (act === "send" && m === "POST") {
        if (!inv.locked) return json(res, 409, { error: "Bitte zuerst festschreiben." });
        const d = await readJson(req), buf = await pdfOf(inv).catch(e => { console.warn(`${inv.number}: PDF nicht verfügbar (${e.message})`); return null; });
        if (d.chat) { docImChat(inv, user); versandMerken({ clientId: inv.client_id, projectId: inv.project_id, art: inv.kind, refId: id, kanal: "chat", anlass: "erneut", von: user.name }); }
        const mailed = d.mail === false ? null : await mailInvoice(inv, buf, inv.kind, clean(d.message, 3000));
        if (d.mail !== false) { db.prepare("UPDATE invoices SET sent_at = datetime('now') WHERE id = ?").run(id); audit(user.name, "versendet", inv.kind, id, inv.number);
          versandMerken({ clientId: inv.client_id, projectId: inv.project_id, art: inv.kind, refId: id, kanal: "mail", anlass: inv.sent_at ? "erneut" : "versand", von: user.name, an: inv.client_email }); }
        return json(res, 200, { mailed, versand: versandListe(inv.kind, id) });
      }
      if (act === "paid" && m === "POST") {
        if (inv.kind !== "rechnung" || !inv.locked) return json(res, 409, { error: "Nur festgeschriebene Rechnungen können bezahlt werden." });
        const d = await readJson(req), date = ymd(d.date) || today(), amount = cents(d.amount) ?? inv.gross;
        if (d.undo) { db.prepare("UPDATE invoices SET status = 'offen', paid_at = NULL, paid_amount = NULL WHERE id = ?").run(id); if (inv.payment_id) db.prepare("UPDATE payments SET status = 'berechnet', paid_at = NULL WHERE id = ?").run(inv.payment_id); audit(user.name, "zahlung zurückgenommen", "rechnung", id, inv.number); return json(res, 200, invoiceFull(id)); }
        db.prepare("UPDATE invoices SET status = 'bezahlt', paid_at = ?, paid_amount = ? WHERE id = ?").run(date, amount, id);
        if (inv.payment_id) db.prepare("UPDATE payments SET status = 'bezahlt', paid_at = ? WHERE id = ?").run(date, inv.payment_id);
        audit(user.name, "bezahlt", "rechnung", id, `${inv.number} · ${euro(amount)} am ${date}`);
        logEvent(inv.client_id, inv.project_id, "zahlung", "Zahlungseingang bestätigt", `${inv.number} · ${euro(amount)}`, d.notify !== false);
        return json(res, 200, invoiceFull(id));
      }
      if (act === "cancel" && m === "POST") {
        if (inv.kind !== "rechnung" || !inv.locked || inv.status === "storniert") return json(res, 409, { error: "Diese Rechnung kann nicht storniert werden." });
        const d = await readJson(req);
        const r = db.prepare("INSERT INTO invoices(kind, client_id, project_id, cancels_id, title, issue_date, service_from, service_to, intro, outro, created_by) VALUES('storno',?,?,?,?,?,?,?,?,?,?)")
          .run(inv.client_id, inv.project_id, id, inv.title, today(), inv.service_from, inv.service_to, `Hiermit stornieren wir die Rechnung ${inv.number} vom ${inv.issue_date.split("-").reverse().join(".")}.`, clean(d.reason, 1000) ? `Grund: ${clean(d.reason, 1000)}` : "", user.name);
        const ins = db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,?,?,?,?,?,?,?,?)");
        for (const it of inv.items) ins.run(r.lastInsertRowid, it.pos, it.title, it.description, -it.qty, it.unit, it.unit_net, it.vat_rate, -it.net);
        const out = await issue(r.lastInsertRowid, { send: !!d.send, message: d.message, chat: !!d.chat }, user);
        db.prepare("UPDATE invoices SET status = 'storniert' WHERE id = ?").run(id);
        if (inv.payment_id) db.prepare("UPDATE payments SET status = 'offen', invoice_doc_id = NULL, paid_at = NULL WHERE id = ?").run(inv.payment_id);
        audit(user.name, "storniert", "rechnung", id, `${inv.number} durch ${out.invoice.number}${d.reason ? " · " + clean(d.reason, 200) : ""}`);
        return json(res, 200, out);
      }
      if (act === "remind" && m === "POST") {
        if (inv.kind !== "rechnung" || inv.status !== "offen") return json(res, 409, { error: "Nur offene Rechnungen können gemahnt werden." });
        const level = Math.min(inv.dunning_level, DUNNING.length - 1), label = DUNNING[level].label, buf = await pdfOf(inv).catch(e => { console.warn(`${inv.number}: PDF nicht verfügbar (${e.message}) – ${DUNNING[level].label} ohne Anhang.`); return null; });
        const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(inv.client_id), s = firmaDaten(inv.firma);   // Absender und Konto der Firma, die die Rechnung gestellt hat
        const frist = addDays(today(), 7);
        const mail = level === 0
          ? vorlage("zahlungserinnerung", { name: c.name, nummer: inv.number, datum: inv.issue_date, betrag: inv.gross, faellig: inv.due_date, frist, anhang: !!buf, firma: s.firma })
          : vorlage("mahnung", { name: c.name, stufe: label, nummer: inv.number, betrag: inv.gross, frist, iban: s.iban || "", anhang: !!buf, firma: s.firma });
        const mailed = await sendMail({ to: c.email, ...mail, attachments: buf ? [{ filename: `${inv.number}.pdf`, content: buf, contentType: "application/pdf" }] : [] });
        db.prepare("UPDATE invoices SET dunning_level = dunning_level + 1, last_dunning_at = datetime('now') WHERE id = ?").run(id);
        audit(user.name, label, "rechnung", id, inv.number);
        versandMerken({ clientId: inv.client_id, projectId: inv.project_id, art: "rechnung", refId: id, kanal: "mail", anlass: label, von: user.name, an: c.email });
        return json(res, 200, { mailed, label });
      }
      if (act === "status" && m === "POST") {   // Angebot angenommen/abgelehnt
        if (inv.kind !== "angebot" || !inv.locked) return json(res, 409, { error: "Nur für versendete Angebote." });
        const d = await readJson(req), st = ["angenommen", "abgelehnt", "versendet"].includes(d.status) ? d.status : inv.status;
        db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(st, id); audit(user.name, `angebot ${st}`, "angebot", id, inv.number);
        if (st === "angenommen") {
          logEvent(inv.client_id, inv.project_id, "angebot", "Angebot angenommen", inv.number, false);
          // Mündliche oder schriftliche Zusage: derselbe Schritt wie bei der Annahme im Portal
          db.prepare("UPDATE clients SET stage = 'mandant' WHERE id = ? AND stage IN ('anfrage','interessent')").run(inv.client_id);
          vereinbarungAusAngebot(inv.id, inv.project_id, user.name);
          betreuungAusAngebot(inv.id, inv.project_id, user.name);   // Betreuung aus dem Pakete-Fenster wird ein laufender Vertrag
          if (inv.project_id) db.prepare("UPDATE projects SET status = 'aktiv', offer_net = COALESCE(offer_net, ?), updated_at = datetime('now') WHERE id = ? AND status = 'anfrage'").run(inv.net, inv.project_id);
        }
        return json(res, 200, invoiceFull(id));
      }
      if (act === "convert" && m === "POST") {   // Angebot → Rechnungsentwurf
        if (inv.kind !== "angebot") return json(res, 409, { error: "Nur Angebote können übernommen werden." });
        const r = db.prepare("INSERT INTO invoices(kind, client_id, project_id, title, intro, outro, created_by) VALUES('rechnung',?,?,?,?,?,?)")
          .run(inv.client_id, inv.project_id, inv.title, `Gemäß unserem Angebot ${inv.number || ""} berechnen wir Ihnen folgende Leistungen:`, "", user.name);
        const ins = db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,?,?,?,?,?,?,?,?)");
        for (const it of inv.items) ins.run(r.lastInsertRowid, it.pos, it.title, it.description, it.qty, it.unit, it.unit_net, it.vat_rate, it.net);
        const t = totals(inv.items); db.prepare("UPDATE invoices SET net = ?, vat = ?, gross = ? WHERE id = ?").run(t.net, t.vat, t.gross, r.lastInsertRowid);
        return json(res, 201, invoiceFull(r.lastInsertRowid));
      }
    }
    // Vorschau eines ungespeicherten Entwurfs
    if (q === "/preview" && m === "POST") {
      const d = await readJson(req, 256 * 1024), c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+d.client_id);
      if (!c) return json(res, 400, { error: "Bitte einen Kunden wählen." });
      const items = cleanItems(d.items, Number(company().vatRate ?? 19));
      const buf = await renderInvoicePdf({ kind: d.kind === "angebot" ? "angebot" : "rechnung", draft: true, number: null, title: clean(d.title, 200), issue_date: ymd(d.issue_date) || today(),
        service_from: ymd(d.service_from), service_to: ymd(d.service_to), due_date: ymd(d.due_date) || addDays(ymd(d.issue_date) || today(), company().paymentDays || 14), valid_until: ymd(d.valid_until) || addDays(today(), 30),
        intro: clean(d.intro, 3000), outro: clean(d.outro, 3000), sender: senderOf(), recipient: recipientOf(c), items, ...totals(items) });
      return send(res, 200, buf, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
    }

    /* --- Wunsch aus dem Preis-Baukasten der Website (steht in der Nachricht der letzten Terminbuchung) --- */
    mm = q.match(/^\/clients\/(\d+)\/wunsch$/);
    if (mm && m === "GET") {
      const b = db.prepare("SELECT message FROM bookings WHERE client_id = ? AND message LIKE '%Preis-Baukasten:%' ORDER BY id DESC LIMIT 1").get(+mm[1]);
      const z = String(b?.message || "").match(/Preis-Baukasten:\s*([^\n]+)/);
      return json(res, 200, { text: z ? z[1].trim().slice(0, 600) : "" });
    }

    /* --- Kunden-Rechnungsadresse --- */
    mm = q.match(/^\/clients\/(\d+)\/billing$/);
    if (mm) {
      const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(+mm[1]); if (!c) return json(res, 404, { error: "Kunde nicht gefunden" });
      if (m === "GET") return json(res, 200, { ...recipientOf(c), billing_name: c.billing_name || "" });
      if (m === "PUT") {
        const d = await readJson(req);
        db.prepare("UPDATE clients SET billing_name = ?, street = ?, zip = ?, city = ?, country = ?, vat_id = ?, customer_no = ? WHERE id = ?")
          .run(clean(d.billing_name, 160), clean(d.street, 160), clean(d.zip, 12), clean(d.city, 80), clean(d.country, 60) || "Deutschland", clean(d.vat_id, 20).toUpperCase(), clean(d.customer_no, 20) || null, c.id);
        return json(res, 200, recipientOf(db.prepare("SELECT * FROM clients WHERE id = ?").get(c.id)));
      }
    }

    /* --- Belege / Ausgaben --- */
    if (q === "/expenses" && m === "GET") {
      const y = /^\d{4}$/.test(url.searchParams.get("year") || "") ? url.searchParams.get("year") : String(new Date().getFullYear());
      return json(res, 200, db.prepare("SELECT e.*, p.title project_title FROM expenses e LEFT JOIN projects p ON p.id = e.project_id WHERE substr(e.doc_date,1,4) = ?" + FE(url).replace(/firma/, "e.firma") + " ORDER BY e.doc_date DESC, e.id DESC").all(y)
        .map(e => ({ ...e, file_token: undefined, has_file: !!e.file_token, locked_period: locked(e.doc_date, e.firma) })));
    }
    const expenseFrom = (d) => {
      const mode = TAX_MODES[d.tax_mode] ? d.tax_mode : "v19", rate = TAX_MODES[mode].rate, rc = TAX_MODES[mode].rc;
      let gross = cents(d.gross), net = cents(d.net);
      if (gross == null && net == null) throw Object.assign(new Error("Bitte einen Betrag angeben."), { code: 400 });
      if (rc || rate === 0) { net = gross ?? net; gross = net; return { mode, net, vat: 0, gross }; }
      if (gross != null) { net = Math.round(gross * 100 / (100 + rate)); return { mode, net, vat: gross - net, gross }; }
      const vat = Math.round(net * rate / 100); return { mode, net, vat, gross: net + vat };
    };
    if (q === "/expenses" && m === "POST") {
      const d = await readJson(req, 25 * 1024 * 1024), date = ymd(d.doc_date);
      if (!date) return json(res, 400, { error: "Bitte das Belegdatum angeben." });
      const belegFirma = hardwareAktiv() && d.firma === "hardware" ? "hardware" : "software";
      if (locked(date, belegFirma)) return json(res, 409, { error: `Der Monat ${date.slice(0, 7)} ist abgeschlossen. Belege dafür können nicht mehr erfasst werden.` });
      const supplier = clean(d.supplier, 160); if (!supplier) return json(res, 400, { error: "Bitte den Lieferanten angeben." });
      const amt = expenseFrom(d), cat = CATEGORIES.find(c => c[0] === d.category) || CATEGORIES.at(-1);
      let file = {};
      if (d.data && d.file_name) {
        const buf = Buffer.from(String(d.data), "base64"), ext = path.extname(String(d.file_name)).toLowerCase();
        if (![".pdf", ".png", ".jpg", ".jpeg", ".webp", ".xml"].includes(ext)) return json(res, 400, { error: "Belege bitte als PDF, Bild oder XML (E-Rechnung)." });
        const token = randomBytes(24).toString("hex") + ext; await mkdir(FILE_DIR, { recursive: true }); await writeFile(path.join(FILE_DIR, token), buf, { flag: "wx" });
        file = { token, name: clean(d.file_name, 160), mime: { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml" }[ext], sha: createHash("sha256").update(buf).digest("hex") };
      }
      const id = tx(() => {
        const number = nextNumber("beleg", Number(date.slice(0, 4)));
        return db.prepare("INSERT INTO expenses(number, doc_date, supplier, description, category, account, tax_mode, net, vat, gross, paid_date, payment_method, project_id, file_token, file_name, mime, sha256, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(number, date, supplier, clean(d.description, 500), cat[0], cat[1], amt.mode, amt.net, amt.vat, amt.gross, ymd(d.paid_date), clean(d.payment_method, 40), d.project_id ? +d.project_id || null : null, file.token || null, file.name || null, file.mime || null, file.sha || null, user.name).lastInsertRowid;
      });
      db.prepare("UPDATE expenses SET firma = ? WHERE id = ?").run(belegFirma, id);
      audit(user.name, "beleg erfasst", "beleg", id, `${supplier} · ${euro(amt.gross)}`);
      return json(res, 201, db.prepare("SELECT * FROM expenses WHERE id = ?").get(id));
    }
    mm = q.match(/^\/expenses\/(\d+)(\/(file|cancel))?$/);
    if (mm) {
      const e = db.prepare("SELECT * FROM expenses WHERE id = ?").get(+mm[1]); if (!e) return json(res, 404, { error: "Nicht gefunden" });
      if (mm[3] === "file" && m === "GET") {
        if (!e.file_token) return json(res, 404, { error: "Keine Datei" });
        return send(res, 200, await readFile(path.join(FILE_DIR, e.file_token)), { "Content-Type": e.mime || "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${e.number}${path.extname(e.file_name || "")}"` });
      }
      if (!mm[3] && m === "PUT") {
        if (e.status !== "erfasst" || locked(e.doc_date, e.firma)) return json(res, 409, { error: "Dieser Beleg ist festgeschrieben – Korrektur nur per Storno." });
        const d = await readJson(req), date = ymd(d.doc_date) || e.doc_date;
        if (locked(date, e.firma)) return json(res, 409, { error: "Der Zielmonat ist abgeschlossen." });
        if (date.slice(0, 4) !== e.doc_date.slice(0, 4)) return json(res, 400, { error: "Das Belegjahr kann nicht geändert werden (Nummernkreis). Bitte stornieren und neu erfassen." });
        const amt = expenseFrom(d), cat = CATEGORIES.find(c => c[0] === d.category) || CATEGORIES.find(c => c[0] === e.category);
        db.prepare("UPDATE expenses SET doc_date = ?, supplier = ?, description = ?, category = ?, account = ?, tax_mode = ?, net = ?, vat = ?, gross = ?, paid_date = ?, payment_method = ?, project_id = ? WHERE id = ?")
          .run(date, clean(d.supplier, 160) || e.supplier, clean(d.description, 500), cat[0], cat[1], amt.mode, amt.net, amt.vat, amt.gross, ymd(d.paid_date), clean(d.payment_method, 40), d.project_id ? +d.project_id || null : null, e.id);
        audit(user.name, "beleg geändert", "beleg", e.id, e.number); return json(res, 200, db.prepare("SELECT * FROM expenses WHERE id = ?").get(e.id));
      }
      if (!mm[3] && m === "DELETE") {
        if (e.status !== "erfasst" || locked(e.doc_date, e.firma)) return json(res, 409, { error: "Festgeschriebene Belege können nicht gelöscht werden – bitte stornieren." });
        // Nummer bleibt lückenlos nachvollziehbar: statt Löschen als storniert markieren
        db.prepare("UPDATE expenses SET status = 'storniert' WHERE id = ?").run(e.id); audit(user.name, "beleg storniert", "beleg", e.id, e.number); return json(res, 200, { ok: true });
      }
      if (mm[3] === "cancel" && m === "POST") {
        if (e.status === "storniert") return json(res, 409, { error: "Bereits storniert." });
        if (e.status === "festgeschrieben") {   // Gegenbeleg im offenen Monat
          const date = today(); if (locked(date, e.firma)) return json(res, 409, { error: "Der aktuelle Monat ist abgeschlossen." });
          tx(() => { const number = nextNumber("beleg", Number(date.slice(0, 4)));
            db.prepare("INSERT INTO expenses(number, status, doc_date, supplier, description, category, account, tax_mode, net, vat, gross, reversal_of, created_by, firma) VALUES(?, 'festgeschrieben', ?,?,?,?,?,?,?,?,?,?,?,?)")
              .run(number, date, e.supplier, `Storno zu ${e.number}`, e.category, e.account, e.tax_mode, -e.net, -e.vat, -e.gross, e.id, user.name, e.firma || "software"); });
        }
        db.prepare("UPDATE expenses SET status = 'storniert' WHERE id = ?").run(e.id); audit(user.name, "beleg storniert", "beleg", e.id, e.number);
        return json(res, 200, { ok: true });
      }
    }

    /* --- Monatsabschluss (Periodensperre) --- */
    mm = q.match(/^\/periods\/(\d{4}-\d{2})\/lock$/);
    if (mm && m === "POST") {
      // Abgeschlossen wird je Firma. Ohne Angabe (Ansicht „Gesamt“) alle Firmen, die noch offen sind.
      const d = await readJson(req).catch(() => ({})), zwei = hardwareAktiv(), alle = zwei ? ["software", "hardware"] : ["software"];
      const ziel = (alle.includes(d?.firma) ? [d.firma] : alle).filter(f => !locked(mm[1], f));
      if (!ziel.length) return json(res, 409, { error: "Bereits abgeschlossen." });
      if (mm[1] >= today().slice(0, 7)) return json(res, 400, { error: "Abschließen geht erst nach Monatsende." });
      tx(() => { for (const f of ziel) {
        db.prepare("UPDATE expenses SET status = 'festgeschrieben' WHERE status = 'erfasst' AND substr(doc_date,1,7) = ? AND (firma = ? OR ? = 0)").run(mm[1], f, zwei ? 1 : 0);
        db.prepare("INSERT INTO firm_locks(period, firma, locked_by) VALUES(?, ?, ?)").run(mm[1], f, user.name); } });
      audit(user.name, "monat abgeschlossen", "zeitraum", null, mm[1] + (zwei ? " · " + ziel.join(" + ") : "")); return json(res, 200, { ok: true });
    }
    if (q === "/report" && m === "GET") {
      const from = ymd(url.searchParams.get("from")), to = ymd(url.searchParams.get("to"));
      if (!from || !to) return json(res, 400, { error: "Zeitraum fehlt" });
      return json(res, 200, report(from, to, firmaWahl(url)));
    }
    if (q === "/export" && m === "GET") {
      const from = ymd(url.searchParams.get("from")), to = ymd(url.searchParams.get("to"));
      if (!from || !to || from > to) return json(res, 400, { error: "Zeitraum fehlt" });
      const fw = firmaWahl(url), zip = await exportZip(from, to, user, fw);
      return send(res, 200, zip, { "Content-Type": "application/zip", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="Reeder${fw === "hardware" ? "_Hardware" : fw === "software" ? "_Software" : ""}_Export_${from}_${to}.zip"` });
    }
    if (q === "/audit" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300").all());
    return json(res, 404, { error: "Unbekannt" });
  }

  return { api };
}
