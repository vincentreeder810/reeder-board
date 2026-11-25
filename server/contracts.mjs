// Angebot → Vertrag → Rechnung: Der Kunde nimmt ein Angebot im Portal verbindlich an (Vertragsbedingungen + ggf. AVV),
// das Board legt daraufhin Projekt, Zahlungsplan und den Entwurf der Anzahlungsrechnung an. Der Inhaber gibt nur noch frei.
// Nachweis der Annahme (Name, Zeitpunkt, IP, Fassung der Bedingungen, Prüfsummen) liegt unveränderlich in "acceptances"
// und als PDF „Auftragsbestätigung“ beim Kunden.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { db, getSetting, setSetting, DEFAULT_COMPANY } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { firmaDaten } from "./firmen.mjs";
import { vereinbarungAusAngebot, vereinbarungLesen } from "./vereinbarungen.mjs";
import { isOwner } from "./access.mjs";
import { PHASES } from "./projects.mjs";
import { renderContractPdf } from "./contract-pdf.mjs";

const DOC_DIR = path.resolve(process.env.DATA_DIR || "data", "documents");
const FILE_DIR = path.resolve(process.env.DATA_DIR || "data", "finance");
export const DUE_ON = ["Auftrag", ...PHASES.slice(1)];   // „fällig bei“: Auftragserteilung oder Erreichen einer Phase

{
  const add = (t, col, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("invoices", "plan", "TEXT"); add("invoices", "avv", "INTEGER NOT NULL DEFAULT 0"); add("invoices", "accepted_at", "TEXT");
  add("payments", "due_on", "TEXT"); add("payments", "pct", "REAL");
}
db.exec(`
CREATE TABLE IF NOT EXISTS contract_versions (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('terms','avv')), version INTEGER NOT NULL, text TEXT NOT NULL, sha256 TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(kind, version)
);
CREATE TABLE IF NOT EXISTS acceptances (
  id INTEGER PRIMARY KEY, invoice_id INTEGER UNIQUE NOT NULL REFERENCES invoices(id), client_id INTEGER NOT NULL, project_id INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('angenommen','abgelehnt')), name TEXT, position TEXT, email TEXT, ip TEXT, user_agent TEXT,
  terms_version INTEGER, terms_sha TEXT, avv_version INTEGER, avv_sha TEXT, quote_sha TEXT, reason TEXT, doc_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Nachweis der Annahme ist unveränderlich (nur das PDF darf nachträglich verknüpft werden)
CREATE TRIGGER IF NOT EXISTS trg_accept_u BEFORE UPDATE ON acceptances WHEN NEW.decision IS NOT OLD.decision OR NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email
  OR NEW.ip IS NOT OLD.ip OR NEW.created_at IS NOT OLD.created_at OR NEW.terms_sha IS NOT OLD.terms_sha OR NEW.avv_sha IS NOT OLD.avv_sha OR NEW.quote_sha IS NOT OLD.quote_sha
BEGIN SELECT RAISE(ABORT, 'acceptance_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_accept_d BEFORE DELETE ON acceptances BEGIN SELECT RAISE(ABORT, 'acceptance_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_cver_u BEFORE UPDATE ON contract_versions BEGIN SELECT RAISE(ABORT, 'contract_immutable'); END;
`);

/* ---------- Standardtexte (Entwurf – vor dem ersten echten Einsatz anwaltlich prüfen lassen) ---------- */
const TERMS = `Allgemeine Vertragsbedingungen für Softwareentwicklung und Betreuung

§ 1 Geltungsbereich
(1) Diese Bedingungen gelten für alle Verträge zwischen der Reeder Software GmbH („Auftragnehmer“) und dem Kunden („Auftraggeber“) über die Konzeption, Entwicklung, Einführung und Betreuung von Software, Websites und Apps.
(2) Sie gelten ausschließlich gegenüber Unternehmern im Sinne von § 14 BGB. Abweichende Bedingungen des Auftraggebers gelten nur, wenn der Auftragnehmer ihnen ausdrücklich in Textform zustimmt.

§ 2 Vertragsschluss und Leistungsumfang
(1) Der Vertrag kommt zustande, wenn der Auftraggeber das Angebot im Kundenportal annimmt oder in Textform bestätigt.
(2) Der Leistungsumfang ergibt sich aus dem angenommenen Angebot. Änderungen und Erweiterungen werden gesondert vereinbart und – soweit nicht anders vereinbart – nach Aufwand zu den jeweils gültigen Sätzen berechnet.

§ 3 Mitwirkung des Auftraggebers
(1) Der Auftraggeber stellt rechtzeitig die erforderlichen Informationen, Inhalte, Zugänge und Ansprechpartner zur Verfügung und gibt Feedback zu Konzepten und Prototypen in angemessener Frist, in der Regel innerhalb von zehn Werktagen.
(2) Verzögerungen aufgrund fehlender Mitwirkung verschieben vereinbarte Termine entsprechend.

§ 4 Prototypen, Freigaben und Abnahme
(1) Zwischenstände werden dem Auftraggeber im Kundenportal bereitgestellt. Anmerkungen können dort direkt am Prototyp hinterlegt werden.
(2) Nach Fertigstellung zeigt der Auftragnehmer die Abnahmebereitschaft an. Der Auftraggeber prüft innerhalb von 14 Tagen. Die Abnahme gilt als erfolgt, wenn innerhalb dieser Frist keine wesentlichen Mängel in Textform gemeldet werden oder die Software produktiv genutzt wird.

§ 5 Vergütung und Zahlung
(1) Die Vergütung ergibt sich aus dem Angebot. Alle Preise verstehen sich zuzüglich der gesetzlichen Umsatzsteuer.
(2) Die Vergütung wird nach dem im Angebot genannten Zahlungsplan fällig. Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar.
(3) Bei Zahlungsverzug ist der Auftragnehmer berechtigt, weitere Arbeiten bis zum Zahlungseingang zurückzustellen.

§ 6 Nutzungsrechte
(1) Mit vollständiger Bezahlung erhält der Auftraggeber an der individuell für ihn entwickelten Software ein einfaches, zeitlich und räumlich unbeschränktes Nutzungsrecht für eigene Zwecke, sofern im Angebot nichts anderes vereinbart ist.
(2) Vorbestehende Bausteine, Bibliotheken und Werkzeuge des Auftragnehmers sowie Open-Source-Komponenten bleiben unberührt; für Letztere gelten deren Lizenzbedingungen.
(3) Der Auftragnehmer darf das Projekt in allgemeiner Form als Referenz nennen, sofern der Auftraggeber nicht widerspricht.

§ 7 Gewährleistung
Der Auftragnehmer beseitigt Mängel, die innerhalb von zwölf Monaten nach Abnahme gemeldet werden, nach eigener Wahl durch Nachbesserung oder Neuerstellung. Die Gewährleistung entfällt für Mängel, die auf Änderungen durch den Auftraggeber oder Dritte zurückgehen.

§ 8 Haftung
(1) Der Auftragnehmer haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit.
(2) Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt, höchstens auf die Höhe der Auftragssumme. Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.
(3) Für den Verlust von Daten haftet der Auftragnehmer nur, soweit der Schaden auch bei ordnungsgemäßer Datensicherung durch den Auftraggeber eingetreten wäre.

§ 9 Vertraulichkeit und Datenschutz
(1) Beide Seiten behandeln vertrauliche Informationen der anderen Seite auch über das Vertragsende hinaus vertraulich.
(2) Soweit der Auftragnehmer personenbezogene Daten im Auftrag verarbeitet, gilt ergänzend die Vereinbarung zur Auftragsverarbeitung (Anlage).

§ 10 Betreuung und laufende Leistungen
Laufende Leistungen (z. B. Hosting, Wartung, Support) haben, sofern nicht anders vereinbart, eine Mindestlaufzeit von zwölf Monaten und verlängern sich jeweils um zwölf Monate, wenn sie nicht mit einer Frist von drei Monaten zum Laufzeitende in Textform gekündigt werden.

§ 11 Schlussbestimmungen
Es gilt deutsches Recht. Gerichtsstand ist der Sitz des Auftragnehmers. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam.`;

const AVV = `Vereinbarung zur Auftragsverarbeitung nach Art. 28 DSGVO

1. Gegenstand und Dauer
Der Auftragnehmer verarbeitet personenbezogene Daten im Auftrag des Auftraggebers, soweit dies für Entwicklung, Test, Betrieb und Betreuung der beauftragten Software erforderlich ist. Die Vereinbarung gilt für die Dauer des Hauptvertrags.

2. Art der Daten und betroffene Personen
Stammdaten, Kontaktdaten, Nutzungs- und Vertragsdaten der Kunden, Beschäftigten und Nutzer des Auftraggebers – im Umfang, wie sie in der Software verarbeitet werden. Besondere Kategorien (Art. 9 DSGVO), etwa Gesundheitsdaten, nur, wenn dies im Angebot ausdrücklich genannt ist.

3. Weisungen
Der Auftragnehmer verarbeitet die Daten ausschließlich auf dokumentierte Weisung des Auftraggebers. Weisungen erfolgen in Textform, auch über das Kundenportal.

4. Vertraulichkeit
Alle mit der Verarbeitung befassten Personen sind zur Vertraulichkeit verpflichtet.

5. Technische und organisatorische Maßnahmen
Der Auftragnehmer trifft angemessene Maßnahmen nach Art. 32 DSGVO, insbesondere verschlüsselte Übertragung, Zugriffsbeschränkung nach dem Need-to-know-Prinzip, Protokollierung, regelmäßige Datensicherung und getrennte Test- und Produktivdaten. Echte personenbezogene Daten werden zu Testzwecken nur nach Freigabe des Auftraggebers verwendet.

6. Unterauftragsverarbeiter
Der Auftragnehmer setzt Unterauftragsverarbeiter (z. B. Hosting-Anbieter) nur ein, wenn er den Auftraggeber vorher informiert und dieser nicht innerhalb von 14 Tagen widerspricht. Eine aktuelle Liste stellt der Auftragnehmer auf Anfrage bereit.

7. Unterstützung und Meldepflichten
Der Auftragnehmer unterstützt den Auftraggeber bei Anfragen betroffener Personen und meldet Verletzungen des Schutzes personenbezogener Daten unverzüglich, spätestens innerhalb von 48 Stunden nach Kenntnis.

8. Löschung und Rückgabe
Nach Vertragsende gibt der Auftragnehmer die Daten nach Wahl des Auftraggebers zurück oder löscht sie, soweit keine gesetzliche Aufbewahrungspflicht besteht.

9. Kontrollrechte
Der Auftraggeber kann sich nach rechtzeitiger Ankündigung von der Einhaltung dieser Vereinbarung überzeugen; in der Regel durch Auskünfte und Nachweise des Auftragnehmers.`;

export const DEFAULT_CONTRACT = {
  plan: [{ label: "Anzahlung bei Auftrag", pct: 30, on: "Auftrag" }, { label: "Freigabe Prototyp", pct: 40, on: "Umsetzung" }, { label: "Abnahme & Launch", pct: 30, on: "Launch" }],
  terms: TERMS, avv: AVV,
};

const sha = t => createHash("sha256").update(String(t)).digest("hex");
const euro = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((c || 0) / 100);
const dmy = ymd => ymd ? String(ymd).slice(0, 10).split("-").reverse().join(".") : "";
const today = () => new Date().toISOString().slice(0, 10);

/** Zahlungsplan aus Formular/Angebot säubern: [{label, pct, on}] – Summe muss 100 % ergeben */
export function cleanPlan(list) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, 8).map(x => ({ label: String(x?.label || "").trim().slice(0, 120), pct: Math.round(Math.max(0, Math.min(100, Number(String(x?.pct ?? "").replace(",", ".")) || 0)) * 100) / 100,
    on: DUE_ON.includes(x?.on) ? x.on : "Auftrag" })).filter(x => x.label && x.pct > 0);
  if (!out.length) return null;
  const sum = out.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(sum - 100) > 0.01) throw Object.assign(new Error(`Der Zahlungsplan ergibt ${String(sum).replace(".", ",")} % – bitte auf 100 % bringen.`), { code: 400 });
  return out;
}
/** Beträge je Rate (netto/brutto); Rundungsrest landet in der letzten Rate */
export function planAmounts(plan, net, gross) {
  if (!plan?.length) return [];
  let rn = net, rg = gross;
  return plan.map((x, i) => { const last = i === plan.length - 1;
    const n = last ? rn : Math.round(net * x.pct / 100), g = last ? rg : Math.round(gross * x.pct / 100); rn -= n; rg -= g;
    return { ...x, net: n, gross: g }; });
}
const ON_TEXT = on => on === "Auftrag" ? "bei Auftragserteilung" : `zu Beginn der Phase „${on}“`;
export const planText = (plan, net, gross) => plan?.length ? "Zahlungsplan: " + planAmounts(plan, net, gross).map(x => `${String(x.pct).replace(".", ",")} % (${euro(x.gross)} brutto) ${ON_TEXT(x.on)}`).join(" · ") : "";

/* ---------- Fassungen der Vertragstexte ---------- */
function currentVersion(kind) {
  const cfg = getSetting("contract", DEFAULT_CONTRACT), text = cfg[kind] || DEFAULT_CONTRACT[kind], h = sha(text);
  const last = db.prepare("SELECT * FROM contract_versions WHERE kind = ? ORDER BY version DESC LIMIT 1").get(kind);
  if (last && last.sha256 === h) return last;
  const v = (last?.version || 0) + 1;
  db.prepare("INSERT INTO contract_versions(kind, version, text, sha256, created_by) VALUES(?,?,?,?,?)").run(kind, v, text, h, "System");
  return db.prepare("SELECT * FROM contract_versions WHERE kind = ? AND version = ?").get(kind, v);
}

/** Rechnungsentwurf für eine Rate des Zahlungsplans (nur einmal je Rate) */
export function draftForPayment(payId, by = "Automatik") {
  const pay = db.prepare("SELECT pay.*, p.title ptitle, p.client_id, p.vat_rate FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.id = ?").get(payId);
  if (!pay || pay.status !== "offen") return null;
  if (db.prepare("SELECT 1 FROM invoices WHERE payment_id = ? AND kind = 'rechnung' AND status != 'storniert'").get(pay.id)) return null;
  const q = db.prepare("SELECT * FROM invoices WHERE kind = 'angebot' AND status = 'angenommen' AND project_id = ? ORDER BY accepted_at DESC, id DESC LIMIT 1").get(pay.project_id);
  const items = [];
  if (q && q.net) {   // Anteile je Steuersatz wie im Angebot
    const byRate = {}; for (const it of db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(q.id)) byRate[it.vat_rate] = (byRate[it.vat_rate] || 0) + it.net;
    const rates = Object.entries(byRate).filter(([, n]) => n); let rest = pay.amount_net;
    rates.forEach(([r, n], i) => { const part = i === rates.length - 1 ? rest : Math.round(pay.amount_net * n / q.net); rest -= part;
      items.push({ title: pay.label + (pay.pct ? ` (${String(pay.pct).replace(".", ",")} %)` : ""), description: `gemäß Angebot ${q.number} vom ${dmy(q.issue_date)}${rates.length > 1 ? ` – Anteil ${r} % USt.` : ""}`, rate: Number(r), net: part }); });
  } else items.push({ title: pay.label, description: `Projekt ${pay.ptitle}`, rate: pay.vat_rate, net: pay.amount_net });
  let net = 0, vat = 0; for (const it of items) { net += it.net; vat += Math.round(it.net * it.rate / 100); }
  const acc = q ? db.prepare("SELECT created_at FROM acceptances WHERE invoice_id = ?").get(q.id) : null;
  const r = db.prepare("INSERT INTO invoices(kind, client_id, project_id, payment_id, title, intro, outro, net, vat, gross, created_by) VALUES('rechnung',?,?,?,?,?,?,?,?,?,?)")
    .run(pay.client_id, pay.project_id, pay.id, `${pay.label} – ${pay.ptitle}`.slice(0, 200),
      q ? `gemäß unserem Angebot ${q.number}${acc ? ` und Ihrer Beauftragung vom ${dmy(acc.created_at)}` : ""} berechnen wir Ihnen die vereinbarte Rate:` : "für das Projekt berechnen wir Ihnen die vereinbarte Rate:",
      "Vielen Dank für Ihren Auftrag und die gute Zusammenarbeit!", net, vat, net + vat, by);
  const ins = db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,?,?,?,1,'pauschal',?,?,?)");
  items.forEach((it, i) => ins.run(r.lastInsertRowid, i + 1, it.title, it.description, it.net, it.rate, it.net));
  return r.lastInsertRowid;
}

// Unterschrift des Kunden (auf dem Bildschirm gezeichnet, PNG als Base64) samt Prüfwert
for (const [col, typ] of [["signature", "TEXT"], ["signature_sha", "TEXT"]])
  if (!db.prepare("PRAGMA table_info(acceptances)").all().some(c => c.name === col)) db.exec(`ALTER TABLE acceptances ADD COLUMN ${col} ${typ}`);
/** Unterschrift aus dem Formular prüfen: PNG-Daten-URL, nicht leer, höchstens 400 KB */
export function cleanSignature(v) {
  const m = String(v || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.length > 600 && buf.length < 400 * 1024 && buf.subarray(1, 4).toString() === "PNG" ? m[1] : null;
}

export function createContracts({ json, readJson, clean, logEvent, SITE_URL }) {
  const company = () => getSetting("company", DEFAULT_COMPANY);
  const cfg = () => getSetting("contract", DEFAULT_CONTRACT);
  let onChange = () => {};
  const audit = (actor, action, entity, id, summary) => db.prepare("INSERT INTO audit_log(actor, action, entity, entity_id, summary) VALUES(?,?,?,?,?)").run(actor, action, entity, id, clean(summary, 500));
  const docUrl = (base, id) => id ? `${base}/documents/${id}/file` : null;

  function quoteOut(inv, c, base) {
    const items = db.prepare("SELECT pos, title, description, qty, unit, unit_net, vat_rate, net FROM invoice_items WHERE invoice_id = ? ORDER BY pos").all(inv.id);
    const plan = JSON.parse(inv.plan || "null");
    const acc = db.prepare("SELECT * FROM acceptances WHERE invoice_id = ?").get(inv.id);
    const terms = currentVersion("terms"), avv = inv.avv ? currentVersion("avv") : null;
    const vatByRate = {}; for (const it of items) if (it.vat_rate > 0) vatByRate[it.vat_rate] = (vatByRate[it.vat_rate] || 0) + Math.round(it.net * it.vat_rate / 100);
    return { id: inv.id, number: inv.number, title: inv.title, status: inv.status, issue_date: inv.issue_date, valid_until: inv.valid_until,
      expired: inv.status === "versendet" && !!inv.valid_until && inv.valid_until < today(),
      project_id: inv.project_id, project: inv.project_id ? db.prepare("SELECT title FROM projects WHERE id = ?").get(inv.project_id)?.title : null,
      intro: inv.intro, outro: inv.outro, items, net: inv.net, vat: inv.vat, gross: inv.gross, vatByRate, pdf_url: docUrl(base, inv.pdf_doc_id),
      plan: planAmounts(plan, inv.net, inv.gross), avv: !!inv.avv,
      terms: { version: terms.version, text: terms.text }, avvText: avv ? { version: avv.version, text: avv.text } : null,
      needAddress: !(c.street && c.city), billing: { billing_name: c.billing_name || c.company, street: c.street || "", zip: c.zip || "", city: c.city || "" },
      acceptance: acc ? { decision: acc.decision, name: acc.name, position: acc.position, at: acc.created_at, reason: acc.reason, doc_url: docUrl(base, acc.doc_id) } : null };
  }

  async function storeDoc(clientId, projectId, title, buf, name) {
    const token = randomBytes(24).toString("hex"); await mkdir(DOC_DIR, { recursive: true }); await writeFile(path.join(DOC_DIR, token), buf);
    return db.prepare("INSERT INTO documents(client_id, project_id, kind, title, doc_date, file_token, file_name, mime, bytes) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(clientId, projectId, "Vertrag", title.slice(0, 160), today(), token, name, "application/pdf", buf.length).lastInsertRowid;
  }

  /** Annahme durch den Kunden */
  async function accept(inv, c, d, meta) {
    const terms = currentVersion("terms"), avv = inv.avv ? currentVersion("avv") : null;
    let quoteSha = inv.pdf_sha256 || null;
    const plan = JSON.parse(inv.plan || "null");
    const name = clean(d.name, 120), position = clean(d.position, 80);
    const sig = cleanSignature(d.signature), sigSha = sig ? createHash("sha256").update(Buffer.from(sig, "base64")).digest("hex") : null;
    const result = (() => { db.exec("BEGIN IMMEDIATE"); try {
      // Rechnungsadresse ergänzen, falls noch nicht vorhanden (wird für die Anzahlungsrechnung gebraucht)
      if (d.address && (!c.street || !c.city)) db.prepare("UPDATE clients SET billing_name = COALESCE(NULLIF(?, ''), billing_name), street = ?, zip = ?, city = ? WHERE id = ?")
        .run(clean(d.address.billing_name, 160), clean(d.address.street, 160), clean(d.address.zip, 12), clean(d.address.city, 80), c.id);
      // Projekt: vorhandenes nehmen oder aus dem Angebot anlegen
      let pid = inv.project_id;
      if (!pid) {
        pid = db.prepare("INSERT INTO projects(client_id, title, phase) VALUES(?, ?, 'Konzept')").run(c.id, (inv.title || `Projekt ${inv.number}`).slice(0, 160)).lastInsertRowid;
        db.prepare("UPDATE invoices SET project_id = ? WHERE id = ?").run(pid, inv.id);
        if (inv.pdf_doc_id) db.prepare("UPDATE documents SET project_id = ? WHERE id = ?").run(pid, inv.pdf_doc_id);
      }
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(pid);
      const byRate = {}; for (const it of db.prepare("SELECT vat_rate, net FROM invoice_items WHERE invoice_id = ?").all(inv.id)) byRate[it.vat_rate] = (byRate[it.vat_rate] || 0) + it.net;
      const mainRate = Number(Object.entries(byRate).sort((a, b) => b[1] - a[1])[0]?.[0] ?? pr.vat_rate);
      const cond = `Beauftragt durch Annahme von Angebot ${inv.number} am ${dmy(today())} (${name}).${plan ? " " + planText(plan, inv.net, inv.gross) + "." : ""}`;
      db.prepare("UPDATE projects SET offer_net = ?, vat_rate = ?, conditions = CASE WHEN conditions IS NULL OR trim(conditions) = '' THEN ? ELSE conditions || char(10) || ? END, phase = CASE WHEN phase = 'Erstgespräch' THEN 'Konzept' ELSE phase END, status = 'aktiv', updated_at = datetime('now') WHERE id = ?")
        .run(inv.net, mainRate, cond, cond, pid);
      // Zahlungsplan übernehmen, solange noch nichts berechnet oder bezahlt ist
      const pays = db.prepare("SELECT * FROM payments WHERE project_id = ?").all(pid);
      let planned = false;
      if (plan?.length && pays.every(x => x.status === "offen" && !x.invoice_doc_id) && !db.prepare("SELECT 1 FROM invoices WHERE payment_id IN (SELECT id FROM payments WHERE project_id = ?) AND locked = 1").get(pid)) {
        db.prepare("DELETE FROM invoices WHERE locked = 0 AND payment_id IN (SELECT id FROM payments WHERE project_id = ?)").run(pid);
        db.prepare("DELETE FROM payments WHERE project_id = ?").run(pid);
        const ins = db.prepare("INSERT INTO payments(project_id, label, amount_net, due, status, sort, due_on, pct) VALUES(?,?,?,NULL,'offen',?,?,?)");
        planAmounts(plan, inv.net, inv.gross).forEach((x, i) => ins.run(pid, x.label, x.net, i, x.on, x.pct));
        planned = true;
      }
      if (c.stage !== "mandant") db.prepare("UPDATE clients SET stage = 'mandant' WHERE id = ?").run(c.id);
      db.prepare("UPDATE invoices SET status = 'angenommen', accepted_at = datetime('now') WHERE id = ?").run(inv.id);
      const accId = db.prepare(`INSERT INTO acceptances(invoice_id, client_id, project_id, decision, name, position, email, ip, user_agent, terms_version, terms_sha, avv_version, avv_sha, quote_sha, signature, signature_sha)
        VALUES(?,?,?,'angenommen',?,?,?,?,?,?,?,?,?,?,?,?)`).run(inv.id, c.id, pid, name, position, c.email, meta.ip, clean(meta.ua, 300), terms.version, terms.sha256, avv?.version ?? null, avv?.sha256 ?? null, quoteSha, sig, sigSha).lastInsertRowid;
      db.exec("COMMIT"); return { pid, accId, planned, phaseMoved: pr.phase === "Erstgespräch" };
    } catch (e) { db.exec("ROLLBACK"); throw e; } })();

    vereinbarungAusAngebot(inv.id, result.pid, name);   // besondere Vereinbarung aus dem Angebot gilt ab jetzt am Projekt
    audit(`Kunde: ${name}`, "angebot angenommen", "angebot", inv.id, `${inv.number} · ${euro(inv.gross)} · ${c.company}`);
    logEvent(c.id, result.pid, "angebot", "Auftrag erteilt", `Angebot ${inv.number} angenommen · ${euro(inv.net)} netto`, false);
    if (result.phaseMoved) logEvent(c.id, result.pid, "phase", "Phase: Konzept", "Das Projekt ist gestartet.", false);

    // Auftragsbestätigung als PDF (mit Nachweis und vollständigen Bedingungen)
    const c2 = db.prepare("SELECT * FROM clients WHERE id = ?").get(c.id), acc = db.prepare("SELECT * FROM acceptances WHERE id = ?").get(result.accId);
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY pos").all(inv.id);
    let docId = null, buf = null;
    try {
      buf = await renderContractPdf({ company: firmaDaten(inv.firma), client: c2, quote: { ...inv, items, vereinbarung: vereinbarungLesen(inv.vereinbarung) }, plan: planAmounts(plan, inv.net, inv.gross), acceptance: acc, terms, avv });
      docId = await storeDoc(c.id, result.pid, `Auftragsbestätigung ${inv.number}${inv.title ? " – " + inv.title : ""}`, buf, `Auftragsbestaetigung-${inv.number}.pdf`);
      db.prepare("UPDATE acceptances SET doc_id = ? WHERE id = ?").run(docId, acc.id);
    } catch (e) { console.warn("Auftragsbestätigung:", e.message); }

    // Chat-Nachricht + Mails
    const owner = db.prepare("SELECT name FROM users WHERE role = 'inhaber' AND active = 1 ORDER BY id LIMIT 1").get()?.name || "Ihr Team";
    db.prepare("INSERT INTO messages(client_id, sender, author, body) VALUES(?, 'team', ?, ?)").run(c.id, owner,
      `Vielen Dank für Ihren Auftrag, ${c.name.split(" ")[0]}! Wir haben die Annahme von Angebot ${inv.number} erhalten. Die Auftragsbestätigung liegt unter „Dokumente“. Wir melden uns in Kürze mit den nächsten Schritten.`);
    const s = company();
    await sendMail({ to: c.email, subject: `Auftragsbestätigung ${inv.number} – ${s.name}`,
      text: `Guten Tag ${c.name},\n\nvielen Dank für Ihren Auftrag! Sie haben unser Angebot ${inv.number}${inv.title ? ` („${inv.title}“)` : ""} über ${euro(inv.gross)} brutto am ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} angenommen.\n\nIm Anhang finden Sie die Auftragsbestätigung mit den vereinbarten Bedingungen${inv.avv ? " und der Vereinbarung zur Auftragsverarbeitung" : ""}. Alles liegt außerdem in Ihrem Kundenportal: ${SITE_URL}/portal/#dokumente\n\nViele Grüße\n${s.name}`,
      attachments: buf ? [{ filename: `Auftragsbestaetigung-${inv.number}.pdf`, content: buf, contentType: "application/pdf" }] : [] }).catch(e => console.warn(e.message));
    for (const u of db.prepare("SELECT email FROM users WHERE role = 'inhaber' AND active = 1").all())
      await sendMail({ to: u.email, subject: `Auftrag erhalten: ${c.company} – ${euro(inv.net)} netto`,
        text: `${name}${position ? ` (${position})` : ""} hat Angebot ${inv.number}${inv.title ? ` „${inv.title}“` : ""} im Kundenportal angenommen.\n\nAuftragswert: ${euro(inv.net)} netto / ${euro(inv.gross)} brutto\n${result.planned ? "Zahlungsplan und Rechnungsentwurf für die erste Rate sind angelegt – bitte im Board freigeben." : "Hinweis: Der Projekt-Zahlungsplan war schon in Bearbeitung und wurde nicht überschrieben."}\n\n${SITE_URL}/admin/#projekte/${result.pid}` }).catch(e => console.warn(e.message));
    try { await onChange(); } catch {}
    return { ok: true, project_id: result.pid, doc_id: docId };
  }

  async function decline(inv, c, d, meta) {
    const reason = clean(d.reason, 2000);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE invoices SET status = 'abgelehnt' WHERE id = ?").run(inv.id);
      db.prepare("INSERT INTO acceptances(invoice_id, client_id, project_id, decision, name, email, ip, user_agent, reason) VALUES(?,?,?,'abgelehnt',?,?,?,?,?)")
        .run(inv.id, c.id, inv.project_id, c.name, c.email, meta.ip, clean(meta.ua, 300), reason);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    audit(`Kunde: ${c.name}`, "angebot abgelehnt", "angebot", inv.id, `${inv.number}${reason ? " · " + reason : ""}`);
    logEvent(c.id, inv.project_id, "angebot", "Angebot abgelehnt", `${inv.number}${reason ? " – " + reason : ""}`, false);
    db.prepare("INSERT INTO messages(client_id, sender, author, body) VALUES(?, 'client', ?, ?)").run(c.id, c.name, `Ich habe das Angebot ${inv.number} abgelehnt.${reason ? "\n\nGrund: " + reason : ""}`);
    for (const u of db.prepare("SELECT email FROM users WHERE role = 'inhaber' AND active = 1").all())
      await sendMail({ to: u.email, subject: `Angebot abgelehnt: ${c.company} – ${inv.number}`, text: `${c.name} hat Angebot ${inv.number} im Kundenportal abgelehnt.${reason ? `\n\nBegründung:\n${reason}` : "\n\n(ohne Begründung)"}\n\n${SITE_URL}/admin/#kunden/${c.id}` }).catch(e => console.warn(e.message));
    try { await onChange(); } catch {}
    return { ok: true };
  }

  /* ---------- Kundenportal ---------- */
  async function portal(req, res, url, p, c, ip) {
    const m = req.method, base = "/api/portal";
    if (p === "/quotes" && m === "GET")
      return json(res, 200, db.prepare("SELECT * FROM invoices WHERE client_id = ? AND kind = 'angebot' AND locked = 1 AND status IN ('versendet','angenommen','abgelehnt') ORDER BY status != 'versendet', issue_date DESC, id DESC").all(c.id).map(i => quoteOut(i, c, base)));
    const mm = p.match(/^\/quotes\/(\d+)(?:\/(accept|decline))?$/);
    if (!mm) return null;
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND client_id = ? AND kind = 'angebot' AND locked = 1").get(+mm[1], c.id);
    if (!inv) return json(res, 404, { error: "Angebot nicht gefunden" });
    if (!mm[2] && m === "GET") return json(res, 200, quoteOut(inv, c, base));
    if (m !== "POST") return json(res, 405, { error: "Nicht erlaubt" });
    if (inv.status !== "versendet") return json(res, 409, { error: inv.status === "angenommen" ? "Dieses Angebot haben Sie bereits angenommen." : "Dieses Angebot ist nicht mehr offen." });
    const d = await readJson(req), meta = { ip, ua: req.headers["user-agent"] || "" };
    if (mm[2] === "decline") return json(res, 200, await decline(inv, c, d, meta));
    if (inv.valid_until && inv.valid_until < today()) return json(res, 409, { error: `Das Angebot war bis ${dmy(inv.valid_until)} gültig. Bitte schreiben Sie uns kurz – wir schicken Ihnen gern ein aktuelles.` });
    if (clean(d.name, 120).length < 3) return json(res, 400, { error: "Bitte geben Sie Ihren vollständigen Namen ein." });
    if (!d.terms) return json(res, 400, { error: "Bitte bestätigen Sie die Vertragsbedingungen." });
    if (!cleanSignature(d.signature)) return json(res, 400, { error: "Bitte unterschreiben Sie im Unterschriftsfeld." });
    if (inv.avv && !d.avv) return json(res, 400, { error: "Bitte bestätigen Sie die Vereinbarung zur Auftragsverarbeitung." });
    if (!(c.street && c.city) && !(clean(d.address?.street, 160) && clean(d.address?.zip, 12) && clean(d.address?.city, 80))) return json(res, 400, { error: "Bitte ergänzen Sie Ihre Rechnungsanschrift." });
    return json(res, 200, await accept(inv, c, d, meta));
  }

  /* ---------- Board (nur Inhaber) ---------- */
  async function admin(req, res, p, m, user) {
    if (!p.startsWith("/contracts")) return null;
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
    if (p === "/contracts/settings" && m === "GET") {
      const c = cfg();
      return json(res, 200, { plan: c.plan, terms: c.terms, avv: c.avv, dueOn: DUE_ON, versions: db.prepare("SELECT kind, version, created_by, created_at FROM contract_versions ORDER BY id DESC LIMIT 20").all(),
        defaults: { terms: DEFAULT_CONTRACT.terms, avv: DEFAULT_CONTRACT.avv } });
    }
    if (p === "/contracts/settings" && m === "PUT") {
      const d = await readJson(req, 256 * 1024), cur = cfg();
      const next = { plan: d.plan !== undefined ? (cleanPlan(d.plan) || []) : cur.plan,
        terms: d.terms !== undefined ? String(d.terms).replace(/\r/g, "").slice(0, 60000).trim() || DEFAULT_CONTRACT.terms : cur.terms,
        avv: d.avv !== undefined ? String(d.avv).replace(/\r/g, "").slice(0, 60000).trim() || DEFAULT_CONTRACT.avv : cur.avv };
      setSetting("contract", next);
      for (const k of ["terms", "avv"]) if (next[k] !== cur[k]) { const v = currentVersion(k); audit(user.name, "vertragstext geändert", k, v.id, `${k === "terms" ? "Vertragsbedingungen" : "AVV"} Fassung ${v.version}`); }
      return json(res, 200, { ok: true });
    }
    let mm = p.match(/^\/contracts\/quote\/(\d+)$/);
    if (mm && m === "GET") {
      const acc = db.prepare("SELECT * FROM acceptances WHERE invoice_id = ?").get(+mm[1]);
      return json(res, 200, acc ? { ...acc, doc_url: acc.doc_id ? `/api/admin/documents/${acc.doc_id}/file` : null } : null);
    }
    mm = p.match(/^\/contracts\/quote\/(\d+)\/accept$/);
    if (mm && m === "POST") {   // Zusage per Telefon/E-Mail: gleicher Ablauf wie im Portal, Nachweis vermerkt den Weg
      const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND kind = 'angebot' AND locked = 1").get(+mm[1]);
      if (!inv) return json(res, 404, { error: "Angebot nicht gefunden" });
      if (inv.status !== "versendet") return json(res, 409, { error: "Dieses Angebot ist nicht mehr offen." });
      const d = await readJson(req), c = db.prepare("SELECT * FROM clients WHERE id = ?").get(inv.client_id);
      if (clean(d.name, 120).length < 3) return json(res, 400, { error: "Bitte angeben, wer zugesagt hat." });
      return json(res, 200, await accept(inv, c, { name: d.name, position: clean(d.via, 60) || "Zusage außerhalb des Portals", terms: true, avv: true }, { ip: `Board (${user.name})`, ua: "erfasst im Board" }));
    }
    mm = p.match(/^\/contracts\/payment\/(\d+)\/draft$/);
    if (mm && m === "POST") {
      const id = draftForPayment(+mm[1], user.name);
      if (!id) return json(res, 409, { error: "Für diese Rate gibt es schon eine Rechnung oder sie ist nicht mehr offen." });
      return json(res, 201, { id });
    }
    return json(res, 404, { error: "Nicht gefunden" });
  }

  return { portal, admin, set onChange(fn) { onChange = fn; }, currentVersion };
}
