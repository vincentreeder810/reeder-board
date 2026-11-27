// Automatik im Hintergrund: prüft jede Minute die Regeln, verschickt Erinnerungen und legt „Vorschläge“ fürs Cockpit an.
// Alles wird in job_log festgehalten (Schlüssel = nichts doppelt). Vorschläge erledigen sich selbst, sobald der Anlass weg ist.
import { db, getSetting, setSetting, DEFAULT_COMPANY } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { vorlage, firmaVonTermin } from "./mail-vorlagen.mjs";
import { formatDe, zonedParts } from "./slots.mjs";
import { isOwner, memberProjectIds } from "./access.mjs";
import { draftForPayment } from "./contracts.mjs";
import { draftForContract, contractOut } from "./subscriptions.mjs";
import { PHASES } from "./projects.mjs";

db.exec(`
CREATE TABLE IF NOT EXISTS job_log (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id INTEGER, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS job_log_created ON job_log(created_at);
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, ref_id INTEGER, client_id INTEGER, project_id INTEGER,
  title TEXT NOT NULL, text TEXT, href TEXT, action TEXT, status TEXT NOT NULL DEFAULT 'offen', snooze_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT, done_by TEXT
);
CREATE INDEX IF NOT EXISTS nudges_open ON nudges(status);
`);

export const DEFAULT_AUTOMATION = {
  reminders: true, reminder24: true, reminder1: true,          // Terminerinnerungen an Kunden
  leadFollowup: true, leadHours: 48, leadNudgeDays: 7,          // Projektanfragen ohne Gespräch
  bookingNudge: true, bookingNudgeHours: 12,                    // unbestätigte Website-Buchungen
  quoteNudge: true, quoteDays: 7,                               // Angebote ohne Antwort
  dunningNudge: true,                                           // Mahnvorschläge
  summaryNudge: true, summaryHours: 2,                          // fehlende Zusammenfassungen
  inactiveNudge: true, inactiveDays: 10,                        // ruhende Projekte
  autoDrafts: true,                                             // Rechnungsentwürfe laut Zahlungsplan anlegen
  releaseNudge: true,                                           // Rechnungen zur Freigabe vorschlagen
  orderNudge: true,                                             // neue Aufträge: Team zuweisen, Absagen nachfassen
  aboDrafts: true, aboLeadDays: 0,                              // wiederkehrende Rechnungen aus Verträgen vorbereiten
  termNudge: true, termDays: 30,
  taskNudge: true,                                              // überfällige Aufgaben (sieht die zuständige Person)                                // Kündigungsfristen, Vertragsende, Kaufoption
  weekly: true, weeklyDay: 1, weeklyHour: 7,                    // Wochenbericht (1 = Montag)
};
const DUNNING = [{ days: 0, label: "Zahlungserinnerung" }, { days: 14, label: "1. Mahnung" }, { days: 28, label: "2. Mahnung" }, { days: 42, label: "3. Mahnung" }];
const TZ = "Europe/Berlin", H = 3600e3, D = 24 * H;
const ts = s => Date.parse(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z");
const sqlTime = d => new Date(d).toISOString().replace("T", " ").slice(0, 19);
const euro = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format((c || 0) / 100);
const euro0 = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format((c || 0) / 100);
const dmy = ymd => ymd ? ymd.split("-").reverse().join(".") : "";
const hm = iso => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayShort = iso => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

export function createAutomation({ json, readJson, clean, SITE_URL }) {
  const cfg = () => getSetting("automation", DEFAULT_AUTOMATION);
  const company = () => getSetting("company", DEFAULT_COMPANY);
  const logged = key => !!db.prepare("SELECT 1 FROM job_log WHERE key = ?").get(key);
  const log = (key, kind, clientId, detail) => db.prepare("INSERT OR IGNORE INTO job_log(key, kind, client_id, detail) VALUES(?, ?, ?, ?)").run(key, kind, clientId ?? null, detail).changes > 0;
  // Vorschlag anlegen bzw. Text aktualisieren (solange er offen ist)
  const nudge = n => db.prepare(`INSERT INTO nudges(key, kind, ref_id, client_id, project_id, title, text, href, action) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET title = excluded.title, text = excluded.text WHERE status = 'offen'`)
    .run(n.key, n.kind, n.ref ?? null, n.client ?? null, n.project ?? null, n.title, n.text || "", n.href || "", n.action || "");
  // Offene Vorschläge einer Art schließen, deren Anlass nicht mehr besteht
  const settle = (kind, keys, by = "automatisch") => {
    const open = db.prepare("SELECT id, key FROM nudges WHERE kind = ? AND status = 'offen'").all(kind), keep = new Set(keys);
    for (const n of open) if (!keep.has(n.key)) db.prepare("UPDATE nudges SET status = 'erledigt', done_at = datetime('now'), done_by = ? WHERE id = ?").run(by, n.id);
  };

  /* ---------- Regeln ---------- */
  async function reminders(S, out) {
    if (!S.reminders) return;
    const now = Date.now();
    const list = db.prepare(`SELECT a.*, c.email, c.name, c.stage, c.active FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE a.start > ? AND a.start <= ? AND c.stage != 'archiv'`).all(new Date(now).toISOString(), new Date(now + D + 5 * 60e3).toISOString());
    for (const a of list) {
      if (!a.active || !a.email) continue;
      const left = Date.parse(a.start) - now, lead = Date.parse(a.start) - ts(a.created_at);
      const daten = { name: a.name, titel: a.title, start: a.start, videoUrl: a.video_url || "", portalLink: a.stage === "mandant" ? `${SITE_URL}/portal/` : "", firma: firmaVonTermin(a) };
      const send = async (key, art, when) => {
        if (!log(key, "erinnerung", a.client_id, `Terminerinnerung (${when}) an ${a.email}: ${a.title}`)) return;
        await sendMail({ to: a.email, ...vorlage(art, daten) });
        out.mails++;
      };
      if (S.reminder24 && left > 3 * H && left <= D + 5 * 60e3 && lead > 26 * H) await send(`remind24:${a.id}`, "termin_erinnerung_tag", "morgen");
      if (S.reminder1 && left > 5 * 60e3 && left <= 65 * 60e3 && lead > 3 * H) await send(`remind1:${a.id}`, "termin_erinnerung_stunde", "in einer Stunde");
    }
  }
  async function leads(S, out) {
    const now = Date.now(), keys = [], bkeys = [];
    const reqs = db.prepare(`SELECT r.*, c.company cc, c.name cn, c.email ce FROM requests r JOIN clients c ON c.id = r.client_id
      WHERE r.status = 'neu' AND c.stage = 'anfrage' AND r.client_id NOT IN (SELECT client_id FROM appointments)
        AND r.client_id NOT IN (SELECT client_id FROM bookings WHERE client_id IS NOT NULL AND status IN ('neu','bestaetigt'))`).all();
    for (const r of reqs) {
      const age = now - ts(r.created_at);
      if (S.leadFollowup && age >= S.leadHours * H && age < 30 * D && !logged(`lead:${r.id}`)) {
        log(`lead:${r.id}`, "nachfassen", r.client_id, `Nachfass-Mail zur Projektanfrage an ${r.ce}`);
        await sendMail({ to: r.ce, ...vorlage("anfrage_nachfassen", { name: r.cn, arten: r.kinds || "", terminLink: `${SITE_URL}/termin.html` }) });
        out.mails++;
      }
      if (age >= S.leadNudgeDays * D) {
        const k = `lead:${r.id}`; keys.push(k);
        nudge({ key: k, kind: "lead", ref: r.id, client: r.client_id, title: `Anfrage nachfassen · ${r.cc}`, href: `#kunden/${r.client_id}`, action: "schedule",
          text: `Seit ${Math.floor(age / D)} Tagen kein Gespräch vereinbart${logged(`lead:${r.id}`) ? " – die automatische Nachfass-Mail ist schon raus" : ""}. Am besten kurz anrufen oder direkt einen Termin vorschlagen.` });
      }
    }
    settle("lead", keys);
    if (S.bookingNudge) for (const b of db.prepare("SELECT * FROM bookings WHERE status = 'neu' AND start > ?").all(new Date().toISOString())) {
      if (now - ts(b.created_at) < S.bookingNudgeHours * H) continue;
      const k = `booking:${b.id}`; bkeys.push(k);
      nudge({ key: k, kind: "buchung", ref: b.id, client: b.client_id, title: `Website-Termin noch nicht bestätigt · ${b.company || b.name}`, href: "#anfragen", action: "confirm",
        text: `Wunschtermin ${formatDe(b.start)} – seit ${Math.round((now - ts(b.created_at)) / H)} Std. offen. Mit einem Klick bestätigen, die Einladung mit Video-Link geht automatisch raus.` });
    }
    settle("buchung", bkeys);
  }
  function quotes(S) {
    const keys = [];
    if (S.quoteNudge) for (const q of db.prepare(`SELECT i.*, c.company FROM invoices i JOIN clients c ON c.id = i.client_id
        WHERE i.kind = 'angebot' AND i.locked = 1 AND i.status = 'versendet' AND i.issue_date <= date('now', ?)`).all(`-${S.quoteDays} days`)) {
      const days = Math.floor((Date.now() - Date.parse(q.issue_date)) / D), k = `angebot:${q.id}`; keys.push(k);
      const expired = q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10);
      nudge({ key: k, kind: "angebot", ref: q.id, client: q.client_id, project: q.project_id, title: `Angebot nachfassen · ${q.company}`, href: `#kunden/${q.client_id}/finanzen`, action: "quoteReminder",
        text: `${q.number} über ${euro(q.gross)} – seit ${days} Tagen ohne Antwort${expired ? ` (gültig bis ${dmy(q.valid_until)} – abgelaufen)` : ""}. „Erinnern“ schickt eine freundliche Nachfrage per E-Mail.` });
    }
    settle("angebot", keys);
  }
  function dunning(S) {
    const keys = [], today = new Date().toISOString().slice(0, 10);
    if (S.dunningNudge) for (const i of db.prepare(`SELECT i.*, c.company FROM invoices i JOIN clients c ON c.id = i.client_id
        WHERE i.kind = 'rechnung' AND i.locked = 1 AND i.status = 'offen' AND i.due_date < ?`).all(today)) {
      const over = Math.floor((Date.parse(today) - Date.parse(i.due_date)) / D), lvl = i.dunning_level;
      if (lvl >= DUNNING.length || over < DUNNING[lvl].days) continue;
      if (i.last_dunning_at && Date.now() - ts(i.last_dunning_at) < 7 * D) continue;
      const k = `mahnung:${i.id}:${lvl}`; keys.push(k);
      nudge({ key: k, kind: "mahnung", ref: i.id, client: i.client_id, project: i.project_id, title: `${DUNNING[lvl].label} fällig · ${i.company}`, href: `#finanzen/rechnungen`, action: "dunning",
        text: `${i.number} über ${euro(i.gross)} – seit ${over} Tagen überfällig. Ein Klick verschickt die ${DUNNING[lvl].label} mit Rechnung als PDF.` });
    }
    settle("mahnung", keys);
  }
  function summaries(S) {
    const keys = [], now = Date.now();
    if (S.summaryNudge) for (const a of db.prepare(`SELECT a.*, c.company FROM appointments a JOIN clients c ON c.id = a.client_id
        WHERE a.start > ? AND a.start < ? AND (a.summary IS NULL OR trim(a.summary) = '')`).all(new Date(now - 14 * D).toISOString(), new Date(now).toISOString())) {
      if (Date.parse(a.start) + (a.minutes || 30) * 60e3 + S.summaryHours * H > now) continue;
      const k = `summary:${a.id}`; keys.push(k);
      nudge({ key: k, kind: "summary", ref: a.id, client: a.client_id, project: a.project_id, title: `Zusammenfassung fehlt · ${a.company}`, href: `#kunden/${a.client_id}/termine`, action: "openAppt",
        text: `${a.title} am ${dayShort(a.start)} – der Kunde sieht das Protokoll im Portal, sobald es eingetragen ist.` });
    }
    settle("summary", keys);
  }
  function inactive(S) {
    const keys = [];
    if (S.inactiveNudge) for (const p of db.prepare(`SELECT p.*, c.company, (SELECT MAX(id) FROM events WHERE project_id = p.id) last_ev,
        MAX(COALESCE((SELECT MAX(created_at) FROM events WHERE project_id = p.id), p.created_at), COALESCE((SELECT MAX(created_at) FROM messages WHERE client_id = p.client_id), '')) last_at
        FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.status = 'aktiv' AND p.phase != 'Betreuung'`).all()) {
      const days = Math.floor((Date.now() - ts(p.last_at)) / D); if (days < S.inactiveDays) continue;
      const k = `inactive:${p.id}:${p.last_ev || 0}`; keys.push(k);
      nudge({ key: k, kind: "inactive", ref: p.id, client: p.client_id, project: p.id, title: `Projekt ruht seit ${days} Tagen · ${p.title}`, href: `#projekte/${p.id}`, action: "open",
        text: `${p.company} · Phase ${p.phase}. Kurzes Update an den Kunden oder nächsten Termin planen?` });
    }
    settle("inactive", keys);
  }

  // Zahlungsplan: Rate fällig (Auftrag erteilt bzw. Phase erreicht) → Rechnungsentwurf; Entwürfe der Automatik → „Freigeben“
  function billing(S, out) {
    if (S.autoDrafts) for (const pay of db.prepare(`SELECT pay.*, p.phase, p.title ptitle, c.company FROM payments pay JOIN projects p ON p.id = pay.project_id JOIN clients c ON c.id = p.client_id
        WHERE pay.status = 'offen' AND pay.due_on IS NOT NULL AND p.status = 'aktiv'`).all()) {
      const reached = pay.due_on === "Auftrag" || PHASES.indexOf(pay.phase) >= PHASES.indexOf(pay.due_on);
      if (!reached || logged(`entwurf:${pay.id}`)) continue;
      const id = draftForPayment(pay.id);
      log(`entwurf:${pay.id}`, "rechnung", pay.client_id, id ? `Rechnungsentwurf angelegt: ${pay.label} – ${pay.ptitle} (${euro(pay.amount_net)} netto)` : `Rate ${pay.label} – ${pay.ptitle}: Rechnung bestand schon`);
      if (id) out.drafts = (out.drafts || 0) + 1;
    }
    const keys = [];
    if (S.releaseNudge) for (const i of db.prepare(`SELECT i.*, c.company, c.street, c.city, pay.label, pay.due_on FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN payments pay ON pay.id = i.payment_id
        WHERE i.kind = 'rechnung' AND i.locked = 0 AND i.created_by = 'Automatik'`).all()) {
      const k = `freigabe:${i.id}`; keys.push(k);
      const why = i.contract_id ? `Abrechnung ${dmy(i.service_from)} – ${dmy(i.service_to)}` : i.due_on === "Auftrag" ? "Auftrag erteilt" : i.due_on ? `Phase „${i.due_on}“ erreicht` : "laut Zahlungsplan fällig";
      nudge({ key: k, kind: "freigabe", ref: i.id, client: i.client_id, project: i.project_id, title: `Rechnung freigeben · ${i.company}`, href: "#finanzen/rechnungen", action: "release",
        text: `${i.label || i.title} über ${euro(i.gross)} brutto – ${why}. ${i.street && i.city ? "Ein Klick schreibt die Rechnung fest und schickt sie mit PDF an den Kunden." : "Achtung: Rechnungsanschrift des Kunden fehlt noch."}` });
    }
    settle("freigabe", keys);
  }
  // Verträge: fällige Abrechnungen als Entwurf, Fristen und Vertragsende als Vorschlag, abgelaufene Verträge beenden
  function abos(S, out) {
    const now = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + S.termDays * D).toISOString().slice(0, 10);
    db.prepare("UPDATE contracts SET status = 'beendet', updated_at = datetime('now') WHERE status = 'gekuendigt' AND end_date < ?").run(now);
    if (S.aboDrafts) {
      const until = new Date(Date.now() + (S.aboLeadDays || 0) * D).toISOString().slice(0, 10);
      for (const c of db.prepare("SELECT ct.*, cl.company FROM contracts ct JOIN clients cl ON cl.id = ct.client_id WHERE ct.status != 'beendet' AND ct.auto_invoice = 1 AND ct.next_invoice IS NOT NULL AND ct.next_invoice <= ? AND (ct.end_date IS NULL OR ct.next_invoice <= ct.end_date)").all(until)) {
        const key = `abo:${c.id}:${c.next_invoice}`; if (logged(key)) continue;
        const id = draftForContract(c.id);
        log(key, "rechnung", c.client_id, id ? `Abo-Rechnung vorbereitet: ${c.title} ab ${dmy(c.next_invoice)} (${c.company})` : `Vertrag ${c.title}: keine Abrechnung mehr fällig`);
        if (id) out.drafts = (out.drafts || 0) + 1;
      }
    }
    const keys = [];
    if (S.termNudge) for (const c0 of db.prepare("SELECT ct.*, cl.company FROM contracts ct JOIN clients cl ON cl.id = ct.client_id WHERE ct.status != 'beendet'").all()) {
      const c = contractOut(c0);
      if (c.status === "aktiv" && c.noticeBy && c.noticeBy >= now && c.noticeBy <= soon) {
        const k = `frist:${c.id}:${c.noticeBy}`; keys.push(k);
        nudge({ key: k, kind: "frist", ref: c.id, client: c.client_id, project: c.project_id, title: `Vertrag verlängert sich bald · ${c0.company}`, href: "#software/vertraege", action: "openContract",
          text: `${c.title} (${euro(c.amount_net)}/Monat): Kündigungsfrist endet am ${dmy(c.noticeBy)}, danach verlängert er sich um ${c.renew_months} Monate (bis ${dmy(c.periodEnd)} läuft die aktuelle Periode). Guter Zeitpunkt für ein Gespräch über Zufriedenheit und Ausbau.` });
      }
      if (c.status === "gekuendigt" && c.end_date && c.end_date <= soon) {
        const k = `ende:${c.id}`; keys.push(k);
        nudge({ key: k, kind: "frist", ref: c.id, client: c.client_id, project: c.project_id, title: `Vertrag endet am ${dmy(c.end_date)} · ${c0.company}`, href: "#software/vertraege", action: "openContract",
          text: `${c.title} ist gekündigt. Übergabe, Datenexport und Zugänge planen – oder noch einmal das Gespräch suchen.` });
      }
      if (c.buyout_from && c.buyout_from >= now && c.buyout_from <= soon) {
        const k = `kauf:${c.id}`; keys.push(k);
        nudge({ key: k, kind: "frist", ref: c.id, client: c.client_id, project: c.project_id, title: `Kaufoption ab ${dmy(c.buyout_from)} · ${c0.company}`, href: "#software/vertraege", action: "openContract",
          text: `Mindestlaufzeit von ${c.title} endet. Kaufpreis ${euro(c.buyout_net)}, bisher angerechnet ${euro(c.credit)} – Restbetrag ${euro(c.buyout_rest)}.` });
      }
    }
    settle("frist", keys);
  }
  function tasksDue(S) {
    const keys = [], today = new Date().toISOString().slice(0, 10);
    if (S.taskNudge) for (const t of db.prepare(`SELECT t.*, p.title ptitle, p.client_id, u.name uname FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.status != 'erledigt' AND t.due_date < ? AND p.status = 'aktiv'`).all(today)) {
      const k = `aufgabe:${t.id}:${t.due_date}`; keys.push(k);
      nudge({ key: k, kind: "aufgabe", ref: t.id, client: t.client_id, project: t.project_id, title: `Aufgabe überfällig · ${t.title}`, href: `#projekte/${t.project_id}`, action: "openTask",
        text: `${t.ptitle} · fällig ${dmy(t.due_date)} · ${t.uname ? "bei " + t.uname : "noch niemand zuständig"}. Erledigen oder neues Datum setzen.` });
    }
    settle("aufgabe", keys);
  }
  function orders(S) {
    const tk = [], dk = [];
    if (S.orderNudge) {
      for (const a of db.prepare(`SELECT a.*, p.title, c.company, i.number, i.net FROM acceptances a JOIN projects p ON p.id = a.project_id JOIN clients c ON c.id = a.client_id JOIN invoices i ON i.id = a.invoice_id
          WHERE a.decision = 'angenommen' AND p.status = 'aktiv' AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id)`).all()) {
        const k = `team:${a.project_id}`; tk.push(k);
        nudge({ key: k, kind: "team", ref: a.project_id, client: a.client_id, project: a.project_id, title: `Neuer Auftrag – Team zuweisen · ${a.company}`, href: `#projekte/${a.project_id}`, action: "assign",
          text: `${a.name} hat ${a.number} angenommen (${euro0(a.net)} netto) – „${a.title}“. Wer übernimmt das Projekt?` });
      }
      for (const a of db.prepare(`SELECT a.*, c.company, i.number FROM acceptances a JOIN clients c ON c.id = a.client_id JOIN invoices i ON i.id = a.invoice_id
          WHERE a.decision = 'abgelehnt' AND a.created_at >= datetime('now', '-14 days')`).all()) {
        const k = `absage:${a.id}`; dk.push(k);
        nudge({ key: k, kind: "absage", ref: a.client_id, client: a.client_id, project: a.project_id, title: `Angebot abgelehnt · ${a.company}`, href: `#kunden/${a.client_id}`, action: "openClient",
          text: `${a.number}${a.reason ? ` – „${a.reason.slice(0, 160)}“` : " – ohne Begründung"}. Kurz anrufen und nachfragen, was gefehlt hat?` });
      }
    }
    settle("team", tk);
    settle("absage", dk);
  }

  /* ---------- Wochenbericht ---------- */
  function weeklyReport() {
    const one = (sql, ...a) => db.prepare(sql).get(...a).n;
    const since = sqlTime(Date.now() - 7 * D), sinceIso = new Date(Date.now() - 7 * D).toISOString(), now = new Date().toISOString(), in7 = new Date(Date.now() + 7 * D).toISOString();
    const gross = "ROUND(pay.amount_net * (1 + p.vat_rate / 100.0))";
    const sum = (sql, ...a) => db.prepare(sql).get(...a).s || 0;
    // Neue Anfragen = neue Kontakte über die Website (Termin gebucht oder Projektanfrage) – Termine aus Board/Portal zählen nicht
    const bookings = one("SELECT COUNT(*) n FROM clients WHERE created_at >= ? AND source = 'Website-Termin'", since), reqs = one("SELECT COUNT(*) n FROM clients WHERE created_at >= ? AND source = 'Projektanfrage'", since);
    const meetings = one("SELECT COUNT(*) n FROM appointments WHERE start >= ? AND start < ?", sinceIso, now);
    const newClients = db.prepare("SELECT company FROM clients WHERE stage = 'mandant' AND created_at >= ?").all(since);
    const openQuotes = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'angebot' AND locked = 1 AND status = 'versendet'").get();
    const paidWeek = sum(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status = 'bezahlt' AND pay.paid_at >= ?`, since.slice(0, 10));
    const paidMonth = sum(`SELECT COALESCE(SUM(${gross}),0) s FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE pay.status = 'bezahlt' AND substr(pay.paid_at,1,7) = ?`, now.slice(0, 7));
    const openInv = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND status = 'offen'").get();
    const overdue = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND status = 'offen' AND due_date < date('now')").get();
    const phases = db.prepare("SELECT phase, COUNT(*) n FROM projects WHERE status = 'aktiv' GROUP BY phase").all();
    const PH = ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"];
    const active = phases.reduce((s, x) => s + x.n, 0);
    const noTeam = one("SELECT COUNT(*) n FROM projects WHERE status = 'aktiv' AND id NOT IN (SELECT project_id FROM project_members)");
    const notes = one("SELECT COUNT(*) n FROM annotations WHERE status = 'offen' AND author_kind = 'client'");
    const team = db.prepare(`SELECT u.name, COUNT(p.id) n, COALESCE(SUM(p.offer_net),0) v FROM users u LEFT JOIN project_members pm ON pm.user_id = u.id LEFT JOIN projects p ON p.id = pm.project_id AND p.status = 'aktiv'
      WHERE u.active = 1 GROUP BY u.id ORDER BY n DESC`).all();
    const week = db.prepare("SELECT a.title, a.start, c.company FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.start >= ? AND a.start < ? ORDER BY a.start").all(now, in7);
    const top = db.prepare("SELECT title, text FROM nudges WHERE status = 'offen' AND (snooze_until IS NULL OR snooze_until <= datetime('now')) ORDER BY CASE kind WHEN 'mahnung' THEN 0 WHEN 'buchung' THEN 1 WHEN 'angebot' THEN 2 WHEN 'lead' THEN 3 WHEN 'summary' THEN 4 ELSE 5 END, created_at LIMIT 5").all();
    const kw = (() => { const d = new Date(); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / D + 1) / 7); })();
    const L = [];
    L.push("VERTRIEB (letzte 7 Tage)", `· Neue Anfragen: ${bookings + reqs} (Website-Termine ${bookings}, Projektanfragen ${reqs})`, `· Termine geführt: ${meetings}`,
      `· Neue Kunden: ${newClients.length}${newClients.length ? " – " + newClients.map(c => c.company).join(", ") : ""}`, `· Offene Angebote: ${openQuotes.n} über ${euro0(openQuotes.s)}`, "");
    L.push("GELD", `· Eingegangen in den letzten 7 Tagen: ${euro0(paidWeek)} · im laufenden Monat: ${euro0(paidMonth)}`,
      `· Offene Rechnungen: ${openInv.n} über ${euro0(openInv.s)}${overdue.n ? ` – davon überfällig: ${overdue.n} über ${euro0(overdue.s)}` : ""}`,
      ...(() => { const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_net),0) s FROM contracts WHERE status != 'beendet'").get(); return r.n ? [`· Wiederkehrender Umsatz (MRR): ${euro0(r.s)} netto/Monat aus ${r.n} Verträgen · ARR ${euro0(r.s * 12)}`] : []; })(), "");
    const sup = db.prepare("SELECT (SELECT COUNT(*) FROM tickets WHERE created_at >= ?) neu, (SELECT COUNT(*) FROM tickets WHERE status IN ('neu','in_bearbeitung','wartet')) offen, (SELECT COUNT(*) FROM tickets WHERE first_response_at >= ? AND julianday(first_response_at) > julianday(replace(substr(due_at,1,19),'T',' '))) spaet").get(since, since);
    if (sup.neu || sup.offen) L.push("SUPPORT", `· Neue Anfragen: ${sup.neu} · offen: ${sup.offen}${sup.spaet ? ` · ${sup.spaet} Mal Antwortfrist verpasst` : " · alle Fristen eingehalten"}`, "");
    L.push("PROJEKTE", `· Aktiv: ${active} (${PH.filter(ph => phases.find(x => x.phase === ph)).map(ph => `${ph} ${phases.find(x => x.phase === ph).n}`).join(" · ")})`,
      `· Ohne Team: ${noTeam} · Offene Kunden-Anmerkungen: ${notes}`, "");
    const hrs = db.prepare(`SELECT u.name, COALESCE(SUM(e.minutes),0) m, (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status = 'erledigt' AND done_at >= ?) done
      FROM users u LEFT JOIN time_entries e ON e.user_id = u.id AND e.date >= ? WHERE u.active = 1 GROUP BY u.id ORDER BY m DESC`).all(sinceIso, since.slice(0, 10));
    const hfmt = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`;
    L.push("TEAM", ...team.map(u => { const h = hrs.find(x => x.name === u.name); return `· ${u.name}: ${u.n} aktive Projekte · ${euro0(u.v)} Auftragsvolumen${h ? ` · letzte Woche ${hfmt(h.m)} erfasst, ${h.done} Aufgaben erledigt` : ""}`; }), "");
    L.push(`DIESE WOCHE: ${week.length} Termin${week.length === 1 ? "" : "e"}`, ...week.slice(0, 8).map(a => `· ${dayShort(a.start)}, ${hm(a.start)} Uhr – ${a.title} (${a.company})`), ...(week.length > 8 ? [`· … und ${week.length - 8} weitere`] : []), "");
    L.push(top.length ? `DIE ${top.length} WICHTIGSTEN PUNKTE DIESER WOCHE` : "OFFENE PUNKTE", ...(top.length ? top.map((t, i) => `${i + 1}. ${t.title}\n   ${t.text}`) : ["Nichts offen – sehr gut."]));
    return vorlage("wochenbericht", { kw, aktiv: active, offen: openInv.s, zeilen: L, link: `${SITE_URL}/admin/#cockpit` });
  }
  async function weekly(S, out, force) {
    if (!S.weekly && !force) return;
    const { ymd, hm: t } = zonedParts(new Date(), TZ), wd = (new Date(ymd + "T12:00:00Z").getUTCDay() || 7);
    if (!force && (wd !== +S.weeklyDay || +t.slice(0, 2) < +S.weeklyHour)) return;
    if (!force && !log(`weekly:${ymd}`, "bericht", null, "Wochenbericht verschickt")) return;
    const r = weeklyReport();
    for (const u of db.prepare("SELECT email FROM users WHERE role = 'inhaber' AND active = 1").all()) { await sendMail({ to: u.email, ...r }); out.mails++; }
    if (force) log(`weekly-manual:${Date.now()}`, "bericht", null, "Wochenbericht manuell verschickt");
  }

  /* ---------- Ablauf ---------- */
  let running = false, lastRun = null;
  const extras = [];   // weitere Module (Support, Betrieb) hängen sich hier ein
  async function run() {
    if (running) return null;
    running = true; const t0 = Date.now(), out = { mails: 0 };
    try {
      const S = cfg();
      await reminders(S, out); await leads(S, out); quotes(S); abos(S, out); billing(S, out); orders(S); tasksDue(S); dunning(S); summaries(S); inactive(S);
      for (const fn of extras) { try { await fn({ nudge, settle, log, logged, S, out }); } catch (e) { console.warn("Automatik (Zusatz):", e.message); } }
      await weekly(S, out);
      out.open = db.prepare("SELECT COUNT(*) n FROM nudges WHERE status = 'offen'").get().n;
    } catch (e) { console.warn("Automatik:", e.message); out.error = e.message; }
    finally { running = false; lastRun = { at: new Date().toISOString(), ms: Date.now() - t0, ...out }; }
    return lastRun;
  }
  function start() {
    if (process.env.AUTOMATION_DISABLED) return console.log("Automatik: abgeschaltet (AUTOMATION_DISABLED)");
    setTimeout(run, 4000); setInterval(run, +process.env.AUTOMATION_INTERVAL_MS || 60000);
  }

  // Sichtbare Vorschläge: Inhaber alles, Entwickler nur fehlende Zusammenfassungen und ruhende Projekte ihrer Projekte
  function visible(user) {
    const rows = db.prepare("SELECT * FROM nudges WHERE status = 'offen' AND (snooze_until IS NULL OR snooze_until <= datetime('now')) ORDER BY created_at DESC").all();
    if (isOwner(user)) return rows;
    const pids = memberProjectIds(user);
    const mine = new Set(db.prepare("SELECT id FROM tasks WHERE assignee_id = ? OR (assignee_id IS NULL AND project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))").all(user.id, user.id).map(r => r.id));
    const myTickets = new Set(db.prepare("SELECT id FROM tickets WHERE assignee_id = ? OR project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)").all(user.id, user.id).map(r => r.id));
    return rows.filter(n => (["summary", "inactive"].includes(n.kind) && n.project_id && pids.includes(n.project_id)) || (n.kind === "aufgabe" && mine.has(n.ref_id)) || (n.kind === "support" && myTickets.has(n.ref_id)));
  }
  const countFor = user => visible(user).length;

  /* ---------- API ---------- */
  async function api(req, res, p, m, user) {
    if (!p.startsWith("/automation")) return null;
    if (p === "/automation/nudges" && m === "GET") return json(res, 200, visible(user));
    let mm = p.match(/^\/automation\/nudges\/(\d+)\/(done|snooze|send)$/);
    if (mm && m === "POST") {
      const n = visible(user).find(x => x.id === +mm[1]); if (!n) return json(res, 404, { error: "Vorschlag nicht gefunden" });
      if (mm[2] === "done") { db.prepare("UPDATE nudges SET status = 'erledigt', done_at = datetime('now'), done_by = ? WHERE id = ?").run(user.name, n.id); return json(res, 200, { ok: true }); }
      if (mm[2] === "snooze") { const d = await readJson(req); const days = Math.min(30, Math.max(1, +d.days || 3));
        db.prepare("UPDATE nudges SET snooze_until = datetime('now', ?) WHERE id = ?").run(`+${days} days`, n.id); return json(res, 200, { ok: true, days }); }
      if (mm[2] === "send") {
        if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
        if (n.kind === "angebot") {
          const q = db.prepare("SELECT i.*, c.name, c.email, c.stage FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?").get(n.ref_id);
          const mailed = await sendMail({ to: q.email, ...vorlage("angebot_nachfrage", { name: q.name, nummer: q.number, titel: q.title || "", terminLink: `${SITE_URL}/termin.html`,
            portalLink: q.stage === "mandant" ? `${SITE_URL}/portal/` : "", firma: q.firma }) });
          log(`angebot-erinnerung:${q.id}:${Date.now()}`, "nachfassen", q.client_id, `Nachfrage zum Angebot ${q.number} an ${q.email} (von ${user.name})`);
          db.prepare("UPDATE nudges SET status = 'erledigt', done_at = datetime('now'), done_by = ? WHERE id = ?").run(user.name, n.id);
          return json(res, 200, { mailed });
        }
        return json(res, 400, { error: "Für diesen Vorschlag gibt es keine E-Mail." });
      }
    }
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
    if (p === "/automation/settings" && m === "GET") return json(res, 200, { settings: cfg(), lastRun, open: db.prepare("SELECT COUNT(*) n FROM nudges WHERE status = 'offen'").get().n });
    if (p === "/automation/settings" && m === "PUT") {
      const d = await readJson(req), cur = cfg(), next = { ...cur };
      for (const [k, v] of Object.entries(DEFAULT_AUTOMATION)) if (k in d) next[k] = typeof v === "boolean" ? !!d[k] : Math.max(0, Math.min(k === "weeklyDay" ? 7 : k === "weeklyHour" ? 23 : 365, Number(d[k]) || 0));
      if (next.weeklyDay < 1) next.weeklyDay = 1;
      setSetting("automation", next); run(); return json(res, 200, { settings: next });
    }
    if (p === "/automation/log" && m === "GET")
      return json(res, 200, db.prepare("SELECT j.*, c.company FROM job_log j LEFT JOIN clients c ON c.id = j.client_id ORDER BY j.created_at DESC, j.rowid DESC LIMIT 80").all());
    if (p === "/automation/run" && m === "POST") return json(res, 200, await run() || { busy: true });
    if (p === "/automation/weekly" && m === "GET") return json(res, 200, weeklyReport());
    if (p === "/automation/weekly" && m === "POST") { const out = { mails: 0 }; await weekly(cfg(), out, true); return json(res, 200, { mailed: out.mails }); }
    return json(res, 404, { error: "Nicht gefunden" });
  }
  return { api, start, run, countFor, weeklyReport, extend: fn => extras.push(fn), status: () => lastRun };
}
