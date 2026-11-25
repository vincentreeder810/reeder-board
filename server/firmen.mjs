// Zwei Firmen in einem Board: Reeder Software GmbH und Reeder Hardware GmbH.
// Jedes Angebot und jede Rechnung gehört zu genau einer Firma – mit eigenen Stammdaten, eigenem Nummernkreis
// und eigener Auswertung. Die Zuordnung folgt dem Bereich des Projekts (Hardware-Projekt → Hardware GmbH).
// Solange die Hardware GmbH nicht aktiv geschaltet ist (Einstellungen → Unternehmen), läuft alles über die Software GmbH.
import { db, getSetting, DEFAULT_COMPANY } from "./db.mjs";

export const DEFAULT_HARDWARE = { ...DEFAULT_COMPANY, name: "Reeder Hardware GmbH", email: "", website: "", aktiv: false };
export const hardwareAktiv = () => !!getSetting("companyHardware", DEFAULT_HARDWARE).aktiv;

/** Stammdaten der Firma samt Kennung (firma) und Zusatz im Logo (brand) */
export function firmaDaten(firma) {
  return firma === "hardware" && hardwareAktiv()
    ? { ...getSetting("companyHardware", DEFAULT_HARDWARE), firma: "hardware", brand: "Hardware" }
    : { ...getSetting("company", DEFAULT_COMPANY), firma: "software", brand: "Software" };
}
/** Welche Firma stellt die Belege zu diesem Projekt aus? */
export function firmaVonProjekt(projectId) {
  if (!projectId || !hardwareAktiv()) return "software";
  return db.prepare("SELECT bereich FROM projects WHERE id = ?").get(projectId)?.bereich === "hardware" ? "hardware" : "software";
}
/** SQL-Ausdruck: Firma eines Belegs – festgeschrieben aus der Spalte, im Entwurf aus dem Projekt. alias = Tabellenname der Belege */
export const firmaSql = (alias = "invoices") => hardwareAktiv()
  ? `(CASE WHEN ${alias}.locked = 1 THEN ${alias}.firma ELSE COALESCE((SELECT CASE WHEN pf.bereich = 'hardware' THEN 'hardware' ELSE 'software' END FROM projects pf WHERE pf.id = ${alias}.project_id), 'software') END)`
  : `'software'`;

for (const t of ["invoices", "expenses"])
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === "firma")) db.exec(`ALTER TABLE ${t} ADD COLUMN firma TEXT NOT NULL DEFAULT 'software'`);

// Monatsabschluss je Firma: ein abgeschlossener Monat der Software GmbH sperrt nicht die Hardware GmbH und umgekehrt
db.exec("CREATE TABLE IF NOT EXISTS firm_locks ( period TEXT NOT NULL, firma TEXT NOT NULL DEFAULT 'software', locked_by TEXT, locked_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (period, firma) )");
db.exec("INSERT OR IGNORE INTO firm_locks(period, firma, locked_by, locked_at) SELECT period, 'software', locked_by, locked_at FROM period_locks");
