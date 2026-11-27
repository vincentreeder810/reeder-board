// Datenbank: eine Datei auf diesem Rechner (data/reeder.db), Node-eigenes SQLite – kein Zusatzdienst.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

const dataDir = path.resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "reeder.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pw_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, product TEXT, start TEXT NOT NULL, minutes INTEGER NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, channel TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'neu', note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings(start);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, kinds TEXT, model TEXT, budget TEXT, timing TEXT, description TEXT NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT,
  status TEXT NOT NULL DEFAULT 'neu', note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
`);

/* ---------- Einstellungen (JSON) ---------- */
export const DEFAULT_AVAILABILITY = {
  timeZone: "Europe/Berlin",
  step: 30,                 // Raster der angebotenen Startzeiten in Minuten
  leadHours: 12,            // frühestens so viele Stunden im Voraus buchbar
  horizonDays: 56,          // so weit im Voraus buchbar
  weekly: {                 // 1 = Montag … 7 = Sonntag, Zeitfenster "HH:MM"
    1: [["09:00", "12:00"], ["13:00", "17:00"]],
    2: [["09:00", "12:00"], ["13:00", "17:00"]],
    3: [["09:00", "12:00"], ["13:00", "17:00"]],
    4: [["09:00", "12:00"], ["13:00", "17:00"]],
    5: [["09:00", "12:00"], ["13:00", "15:00"]],
    6: [], 7: [],
  },
  blocked: [],              // [{ from: "2026-12-24", to: "2026-12-31", note: "Weihnachten" }]
  types: {
    erstgespraech: { label: "Kostenloses Erstgespräch",            minutes: 30, buffer: 15, active: true },
    produktdemo:   { label: "Produktdemo",                         minutes: 30, buffer: 15, active: true },
    beratung:      { label: "Beratung: Wo Software & KI Ihnen helfen", minutes: 60, buffer: 15, active: true, price: 100 },   // price = Euro netto
    hw_erstgespraech: { label: "Kostenloses Erstgespräch Hardware",  minutes: 30, buffer: 15, active: true, bereich: "hardware" },   // Ist die Produktidee technisch umsetzbar?
    hw_konzept:    { label: "Entwicklungskonzept anfragen",        minutes: 45, buffer: 15, active: true, bereich: "hardware" },   // Umfang eines ausgearbeiteten Konzepts besprechen
    workshop:      { label: "Projekt-Workshop",                    minutes: 90, buffer: 30, active: false },                  // ersetzt durch „Beratung“, bleibt für alte Termine
    abstimmung:    { label: "Projekt-Abstimmung",                  minutes: 30, buffer: 10, active: true, portal: true, desc: "Stand besprechen, Fragen klären, nächste Schritte festlegen." },
    feedback:      { label: "Feedback zum Prototyp",               minutes: 45, buffer: 15, active: true, portal: true, desc: "Wir gehen den Prototyp gemeinsam durch und nehmen Ihre Wünsche auf." },
    rueckfrage:    { label: "Kurze Rückfrage",                     minutes: 15, buffer: 5,  active: true, portal: true, desc: "Eine schnelle Frage, die sich im Gespräch leichter klären lässt." },
    schulung:      { label: "Schulung & Einweisung",               minutes: 60, buffer: 15, active: true, portal: true, desc: "Wir zeigen Ihnen und Ihrem Team, wie alles funktioniert." },
  },
};
export const DEFAULT_MAIL = {
  fromName: "Reeder Software GmbH",
  fromAddress: "hallo@reeder-software.de",
  notifyAddress: "hallo@reeder-software.de",
};

export function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return structuredClone(fallback);
  try {
    const stored = JSON.parse(row.value), out = { ...structuredClone(fallback), ...stored };
    if (fallback?.types && stored.types) { // Terminarten einzeln zusammenführen (neue Standardarten bleiben erhalten)
      out.types = structuredClone(fallback.types);
      for (const [k, v] of Object.entries(stored.types)) out.types[k] = { ...(out.types[k] || {}), ...v };
    }
    return out;
  } catch { return structuredClone(fallback); }
}
export function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
export function calendarToken() {
  let t = getSetting("calendar", { token: "" }).token;
  if (!t) { t = randomBytes(24).toString("hex"); setSetting("calendar", { token: t }); }
  return t;
}
export function resetCalendarToken() {
  const t = randomBytes(24).toString("hex"); setSetting("calendar", { token: t }); return t;
}

/* ---------- Kundenportal: Kunden, Chat, Prototypen ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  pw_hash TEXT, invite_token TEXT UNIQUE, invite_expires INTEGER, active INTEGER NOT NULL DEFAULT 1,
  notified_client_at INTEGER, notified_team_at INTEGER, last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS client_sessions (
  token TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prototypes (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, note TEXT, token TEXT UNIQUE NOT NULL, entry TEXT NOT NULL,
  files INTEGER NOT NULL, bytes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('team','client')), author TEXT NOT NULL, body TEXT NOT NULL,
  prototype_id INTEGER REFERENCES prototypes(id) ON DELETE SET NULL,
  read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_client ON messages(client_id, id);
`);

/* ---------- Projekte, Termine, Finanzen, Dokumente, Anmerkungen, Verlauf ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, kind TEXT, description TEXT, phase TEXT NOT NULL DEFAULT 'Erstgespräch',
  model TEXT, status TEXT NOT NULL DEFAULT 'aktiv', offer_net INTEGER, vat_rate REAL NOT NULL DEFAULT 19, conditions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, start TEXT NOT NULL, minutes INTEGER, kind TEXT, summary TEXT, next_steps TEXT, booking_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, amount_net INTEGER NOT NULL, due TEXT, status TEXT NOT NULL DEFAULT 'offen', paid_at TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, amount_gross INTEGER, doc_date TEXT,
  file_token TEXT UNIQUE NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY, prototype_id INTEGER NOT NULL REFERENCES prototypes(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('client','team')), author TEXT NOT NULL,
  page TEXT NOT NULL, device_w INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, strokes TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'offen', reply TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT
);
CREATE INDEX IF NOT EXISTS annotations_proto ON annotations(prototype_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
{
  const cols = db.prepare("PRAGMA table_info(prototypes)").all().map(c => c.name);
  if (!cols.includes("project_id")) db.exec("ALTER TABLE prototypes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
  if (!cols.includes("group_id")) db.exec("ALTER TABLE prototypes ADD COLUMN group_id INTEGER");
  if (!cols.includes("version")) db.exec("ALTER TABLE prototypes ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("changes")) db.exec("ALTER TABLE prototypes ADD COLUMN changes TEXT");
}
{ // Baustein H3: strukturierter Änderungswunsch an einer Anmerkung (Element + gewünschte Werte)
  const ac = db.prepare("PRAGMA table_info(annotations)").all().map(c => c.name);
  if (!ac.includes("change")) db.exec("ALTER TABLE annotations ADD COLUMN change TEXT");
}
{
  const cols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
  if (!cols.includes("notify_email")) db.exec("ALTER TABLE clients ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("phone")) db.exec("ALTER TABLE clients ADD COLUMN phone TEXT");
}
{
  const ev = db.prepare("PRAGMA table_info(events)").all().map(c => c.name);
  if (!ev.includes("notify")) db.exec("ALTER TABLE events ADD COLUMN notify INTEGER NOT NULL DEFAULT 1");
  const cl = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
  if (!cl.includes("digest_event_id")) { db.exec("ALTER TABLE clients ADD COLUMN digest_event_id INTEGER NOT NULL DEFAULT 0"); db.exec("UPDATE clients SET digest_event_id = COALESCE((SELECT MAX(id) FROM events), 0)"); }
  const pay = db.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
  if (!pay.includes("invoice_doc_id")) db.exec("ALTER TABLE payments ADD COLUMN invoice_doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL");
}
{ // Chats je Projekt: Jede Nachricht gehört zu einem Projekt-Faden (project_id) oder zum Faden „Allgemein“ (NULL).
  // art/meta: Sonderkarten im Chat, z. B. art = 'rueckfragen' mit meta {fragen:[{id,text}]} oder art = 'antwort' mit meta {frage, antwort}.
  const mc = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
  if (!mc.includes("project_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
    // Bestehende Nachrichten einmalig zuordnen: Hat ein Kunde genau ein Projekt, gehören seine alten Nachrichten dorthin – sonst bleiben sie unter „Allgemein“.
    db.exec(`UPDATE messages SET project_id = (SELECT MIN(p.id) FROM projects p WHERE p.client_id = messages.client_id)
      WHERE project_id IS NULL AND (SELECT COUNT(*) FROM projects p WHERE p.client_id = messages.client_id) = 1`);
  }
  if (!mc.includes("art")) db.exec("ALTER TABLE messages ADD COLUMN art TEXT");
  if (!mc.includes("meta")) db.exec("ALTER TABLE messages ADD COLUMN meta TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS messages_thread ON messages(client_id, project_id, id)");
}
/** Chat-Faden für eine neue Nachricht: das genannte Projekt – oder, wenn keins bekannt ist und der Kunde genau ein Projekt hat, dieses. Sonst NULL („Allgemein“). */
export function chatProjekt(clientId, projectId = null) {
  if (projectId) return projectId;
  const r = db.prepare("SELECT COUNT(*) n, MIN(id) id FROM projects WHERE client_id = ?").get(clientId);
  return r.n === 1 ? r.id : null;
}
/** Team-Nachricht in den Chat des Projekts schreiben (z. B. Karte zu Dokument, Rechnung oder Gesprächs-Zusammenfassung).
    Der Kunde sieht sie sofort im Portal; die Mail-Benachrichtigung entscheidet der Aufrufer getrennt davon. */
export function chatPosten({ clientId, projectId = null, user = null, body, art = null, meta = null }) {
  const pid = chatProjekt(clientId, projectId);
  return db.prepare("INSERT INTO messages(client_id, sender, author, body, project_id, art, meta, user_id) VALUES(?, 'team', ?, ?, ?, ?, ?, ?)")
    .run(clientId, user?.name || "Team Reeder", String(body || "").slice(0, 5000), pid, art, meta ? JSON.stringify(meta) : null, user?.id ?? null).lastInsertRowid;
}

/* ---------- Terminanfragen von Bestandskunden ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS appointment_requests (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  type TEXT NOT NULL, minutes INTEGER NOT NULL, slots TEXT NOT NULL DEFAULT '[]', flexible INTEGER NOT NULL DEFAULT 0,
  message TEXT, status TEXT NOT NULL DEFAULT 'offen', answer TEXT, appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT
);
`);

/* ---------- Team: Rollen, Einladungen, Projektzuweisung ---------- */
{
  const u = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!u.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'inhaber'");
  if (!u.includes("active")) db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  if (!u.includes("invite_token")) db.exec("ALTER TABLE users ADD COLUMN invite_token TEXT");
  if (!u.includes("invite_expires")) db.exec("ALTER TABLE users ADD COLUMN invite_expires INTEGER");
  if (!u.includes("last_login")) db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
}
db.exec(`CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);`);
export const DEFAULT_COMPANY = {
  name: "Reeder Software GmbH", street: "", zip: "", city: "", country: "Deutschland",
  email: "kontakt@reeder-software.de", phone: "", website: "www.reeder-software.de",
  managingDirector: "", register: "", taxNumber: "", vatId: "",
  bank: "", iban: "", bic: "", paymentDays: 14, vatRate: 19,
  taxMethod: "soll", datevBerater: "", datevMandant: "",
};

/* ---------- Finanzen: Rechnungen, Angebote, Belege (GoBD-orientiert) ---------- */
{
  const cl = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
  for (const col of ["billing_name", "street", "zip", "city", "country", "vat_id", "customer_no"])
    if (!cl.includes(col)) db.exec(`ALTER TABLE clients ADD COLUMN ${col} TEXT`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS number_sequences ( kind TEXT NOT NULL, year INTEGER NOT NULL, next INTEGER NOT NULL, PRIMARY KEY (kind, year) );
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('rechnung','storno','angebot')),
  number TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'entwurf',
  client_id INTEGER NOT NULL REFERENCES clients(id), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL, cancels_id INTEGER REFERENCES invoices(id),
  title TEXT, issue_date TEXT, service_from TEXT, service_to TEXT, due_date TEXT, valid_until TEXT,
  recipient TEXT NOT NULL DEFAULT '{}', sender TEXT NOT NULL DEFAULT '{}', intro TEXT, outro TEXT,
  net INTEGER NOT NULL DEFAULT 0, vat INTEGER NOT NULL DEFAULT 0, gross INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0, pdf_doc_id INTEGER, pdf_token TEXT, pdf_sha256 TEXT,
  sent_at TEXT, paid_at TEXT, paid_amount INTEGER, dunning_level INTEGER NOT NULL DEFAULT 0, last_dunning_at TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), issued_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, pos INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT, qty REAL NOT NULL DEFAULT 1, unit TEXT, unit_net INTEGER NOT NULL, vat_rate REAL NOT NULL, net INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'erfasst' CHECK (status IN ('erfasst','festgeschrieben','storniert')),
  doc_date TEXT NOT NULL, supplier TEXT NOT NULL, description TEXT, category TEXT NOT NULL, account TEXT,
  tax_mode TEXT NOT NULL DEFAULT 'v19', net INTEGER NOT NULL, vat INTEGER NOT NULL, gross INTEGER NOT NULL,
  paid_date TEXT, payment_method TEXT, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  file_token TEXT, file_name TEXT, mime TEXT, sha256 TEXT, reversal_of INTEGER REFERENCES expenses(id),
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS period_locks ( period TEXT PRIMARY KEY, locked_by TEXT, locked_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, summary TEXT
);
-- GoBD: festgeschriebene Rechnungen sind unveränderlich (nur Zahlungs-/Versand-/Mahnstatus darf sich ändern), Löschen verboten.
CREATE TRIGGER IF NOT EXISTS trg_invoice_immutable BEFORE UPDATE ON invoices WHEN OLD.locked = 1 AND (
  NEW.number IS NOT OLD.number OR NEW.kind IS NOT OLD.kind OR NEW.client_id IS NOT OLD.client_id OR NEW.issue_date IS NOT OLD.issue_date OR
  NEW.service_from IS NOT OLD.service_from OR NEW.service_to IS NOT OLD.service_to OR NEW.due_date IS NOT OLD.due_date OR
  NEW.recipient IS NOT OLD.recipient OR NEW.sender IS NOT OLD.sender OR NEW.intro IS NOT OLD.intro OR NEW.outro IS NOT OLD.outro OR
  NEW.net IS NOT OLD.net OR NEW.vat IS NOT OLD.vat OR NEW.gross IS NOT OLD.gross OR NEW.locked IS NOT OLD.locked OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256)
BEGIN SELECT RAISE(ABORT, 'invoice_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_invoice_nodelete BEFORE DELETE ON invoices WHEN OLD.locked = 1 BEGIN SELECT RAISE(ABORT, 'invoice_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_items_immutable_u BEFORE UPDATE ON invoice_items WHEN (SELECT locked FROM invoices WHERE id = OLD.invoice_id) = 1 BEGIN SELECT RAISE(ABORT, 'invoice_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_items_immutable_d BEFORE DELETE ON invoice_items WHEN (SELECT locked FROM invoices WHERE id = OLD.invoice_id) = 1 BEGIN SELECT RAISE(ABORT, 'invoice_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_items_immutable_i BEFORE INSERT ON invoice_items WHEN (SELECT locked FROM invoices WHERE id = NEW.invoice_id) = 1 BEGIN SELECT RAISE(ABORT, 'invoice_immutable'); END;
-- Festgeschriebene Belege: nur noch Storno-Markierung erlaubt
CREATE TRIGGER IF NOT EXISTS trg_expense_immutable BEFORE UPDATE ON expenses WHEN OLD.status != 'erfasst' AND NOT (OLD.status = 'festgeschrieben' AND NEW.status = 'storniert' AND
  NEW.net IS OLD.net AND NEW.vat IS OLD.vat AND NEW.gross IS OLD.gross AND NEW.doc_date IS OLD.doc_date AND NEW.supplier IS OLD.supplier AND NEW.category IS OLD.category AND NEW.tax_mode IS OLD.tax_mode AND NEW.number IS OLD.number)
BEGIN SELECT RAISE(ABORT, 'expense_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_expense_nodelete BEFORE DELETE ON expenses WHEN OLD.status != 'erfasst' BEGIN SELECT RAISE(ABORT, 'expense_immutable'); END;
-- Protokoll ist nur fortschreibbar
CREATE TRIGGER IF NOT EXISTS trg_audit_u BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_d BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
`);

/* ---------- Kundenprozess: Anfrage → Interessent → Mandant ---------- */
{
  const add = (t, col, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("clients", "stage", "TEXT NOT NULL DEFAULT 'mandant'"); add("clients", "source", "TEXT"); add("clients", "notes", "TEXT"); add("clients", "phone", "TEXT");
  add("bookings", "client_id", "INTEGER"); add("bookings", "video_url", "TEXT"); add("requests", "client_id", "INTEGER"); add("appointments", "video_url", "TEXT");
}
export const STAGES = { anfrage: "Anfrage", interessent: "Interessent", mandant: "Mandant", archiv: "Archiv" };
/** Kontakt zu einer E-Mail finden oder als Anfrage anlegen (ohne Portalzugang) */
export function upsertLead({ email, name, company, phone, source }) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return null;
  const c = db.prepare("SELECT id, phone FROM clients WHERE email = ?").get(e);
  if (c) { if (phone && !c.phone) db.prepare("UPDATE clients SET phone = ? WHERE id = ?").run(phone, c.id); return c.id; }
  return db.prepare("INSERT INTO clients(company, name, email, phone, stage, source) VALUES(?, ?, ?, ?, 'anfrage', ?)")
    .run(String(company || name || e).slice(0, 160), String(name || e).slice(0, 120), e, phone || null, source || null).lastInsertRowid;
}
/** Video-Link für einen Termin: fester Raum aus den Einstellungen oder ein neuer Jitsi-Raum */
export function videoUrl() {
  const m = getSetting("meeting", { mode: "jitsi", url: "" });
  if (m.mode === "fixed" && m.url) return m.url;
  return `https://meet.jit.si/Reeder-${randomBytes(6).toString("hex")}`;
}
// Bestehende Website-Buchungen und -Anfragen einmalig ihren Kontakten zuordnen
for (const t of ["bookings", "requests"]) {
  for (const r of db.prepare(`SELECT * FROM ${t} WHERE client_id IS NULL`).all()) {
    const id = upsertLead({ email: r.email, name: r.name, company: r.company, phone: r.phone, source: t === "bookings" ? "Website-Termin" : "Projektanfrage" });
    if (id) db.prepare(`UPDATE ${t} SET client_id = ? WHERE id = ?`).run(id, r.id);
  }
}
