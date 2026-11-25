// Software & Verträge: Produktkatalog (eigene Produkte + Leistungen), laufende Verträge (Betreuung, Signature-Lizenz, Hosting …),
// MRR/ARR, Laufzeiten & Kündigungsfristen, Anrechnung für die Kaufoption (Reeder Signature) und wiederkehrende Rechnungen.
import { db } from "./db.mjs";
import { isOwner } from "./access.mjs";

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'eigenprodukt' CHECK (kind IN ('eigenprodukt','leistung')),
  tagline TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'Entwicklung', progress INTEGER NOT NULL DEFAULT 0, version TEXT,
  next_milestone TEXT, milestone_date TEXT, lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, url TEXT,
  price_month INTEGER, setup_fee INTEGER, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, amount_net INTEGER NOT NULL, interval_months INTEGER NOT NULL DEFAULT 1, vat_rate REAL NOT NULL DEFAULT 19,
  start_date TEXT NOT NULL, min_months INTEGER NOT NULL DEFAULT 12, renew_months INTEGER NOT NULL DEFAULT 12, notice_months INTEGER NOT NULL DEFAULT 3,
  next_invoice TEXT, auto_invoice INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','gekuendigt','beendet')),
  cancelled_at TEXT, cancelled_by TEXT, end_date TEXT, buyout_net INTEGER, credit_pct REAL, credit_before INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contracts_client ON contracts(client_id);
`);
if (!db.prepare("PRAGMA table_info(invoices)").all().some(c => c.name === "contract_id")) db.exec("ALTER TABLE invoices ADD COLUMN contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL");

// Laufende Verträge beider Bereiche: Software (Betreuung, Lizenz, Hosting …) und Hardware (Gerätewartung, Ersatzteile, Serienlieferung)
export const CONTRACT_KINDS = ["IT-Betreuung", "Signature-Lizenz", "Produkt-Lizenz", "Hosting", "Wartung & Support", "KI-Telefonassistent", "Gerätewartung (Hardware)", "Ersatzteile & Verbrauchsmaterial (Hardware)", "Serienlieferung (Hardware)", "Sonstiges"];
export const PRODUCT_STATUS = ["Idee", "Konzept", "Entwicklung", "Beta", "Live", "Pausiert"];

/* ---------- Datumshelfer ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
export function addMonths(d, n) {   // Monatsende sauber behandeln (31.01. + 1 Monat = 28./29.02.)
  const [y, m, day] = d.split("-").map(Number), t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last)); return t.toISOString().slice(0, 10);
}
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monthsBetween = (a, b) => { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0); };

/** Laufzeit: Ende der aktuellen Periode, letzter Tag für eine Kündigung, nächste Verlängerung */
export function term(c, ref = today()) {
  const minEnd = addDays(addMonths(c.start_date, c.min_months || 0), -1);
  let end = minEnd;
  if (c.renew_months > 0) while (addDays(end, -0) < ref && end < "2200-01-01") end = addDays(addMonths(addDays(end, 1), c.renew_months), -1);
  else if (end < ref) end = null;                        // nach Mindestlaufzeit monatlich kündbar
  const monthly = !c.renew_months || c.renew_months <= 0;
  const noticeBy = end ? addDays(addMonths(addDays(end, 1), -(c.notice_months || 0)), -1) : null;
  // Frühestmögliches Vertragsende bei Kündigung heute
  let earliest = end;
  const monthEnd = addDays(addMonths(ref.slice(0, 8) + "01", (c.notice_months || 0) + 1), -1);
  if (end && noticeBy < ref) earliest = c.renew_months > 0 ? addDays(addMonths(addDays(end, 1), c.renew_months), -1) : (monthEnd > end ? monthEnd : end);
  if (!end) earliest = monthEnd;
  return { minEnd, inMinTerm: ref <= minEnd, periodEnd: end, noticeBy: end ? noticeBy : null, earliestEnd: earliest, monthly };
}
export const mrrOf = c => c.amount_net;   // amount_net ist immer der Monatsbetrag (netto)

export function contractOut(c, owner = true) {
  const t = term(c);
  const billedPaid = db.prepare("SELECT COALESCE(SUM(net),0) s FROM invoices WHERE contract_id = ? AND kind = 'rechnung' AND locked = 1 AND status = 'bezahlt'").get(c.id).s;
  const billed = db.prepare("SELECT COALESCE(SUM(net),0) s FROM invoices WHERE contract_id = ? AND kind = 'rechnung' AND locked = 1 AND status != 'storniert'").get(c.id).s;
  const credit = c.credit_pct ? Math.round((billedPaid + (c.credit_before || 0)) * c.credit_pct / 100) : 0;
  const out = { ...c, auto_invoice: !!c.auto_invoice, mrr: c.status === "beendet" ? 0 : mrrOf(c), amount_gross: Math.round(c.amount_net * (1 + c.vat_rate / 100)),
    ...t, months: Math.max(0, monthsBetween(c.start_date, today())), billed, paid: billedPaid,
    credit, buyout_rest: c.buyout_net != null ? Math.max(0, c.buyout_net - credit) : null, buyout_from: c.buyout_net != null ? addDays(t.minEnd, 1) : null };
  if (c.status === "gekuendigt" || c.status === "beendet") { out.periodEnd = c.end_date; out.noticeBy = null; }
  if (!owner) for (const k of ["amount_net", "amount_gross", "mrr", "billed", "paid", "credit", "buyout_net", "buyout_rest", "credit_before"]) delete out[k];
  return out;
}

/** Rechnungsentwurf für die nächste Abrechnungsperiode eines Vertrags */
export function draftForContract(id, by = "Automatik") {
  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id);
  if (!c || c.status === "beendet" || !c.next_invoice) return null;
  const from = c.next_invoice, to = addDays(addMonths(from, c.interval_months), -1);
  if (c.end_date && from > c.end_date) return null;
  const until = c.end_date && to > c.end_date ? c.end_date : to;
  const months = c.end_date && to > c.end_date ? Math.max(1, monthsBetween(from, addDays(c.end_date, 1))) : c.interval_months;
  const net = c.amount_net * months, vat = Math.round(net * c.vat_rate / 100);
  const de = d => d.split("-").reverse().join(".");
  const r = db.prepare(`INSERT INTO invoices(kind, client_id, project_id, contract_id, title, service_from, service_to, intro, outro, net, vat, gross, created_by)
    VALUES('rechnung',?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.client_id, c.project_id, c.id, `${c.title} · ${de(from)} – ${de(until)}`.slice(0, 200), from, until,
      `für den Leistungszeitraum ${de(from)} bis ${de(until)} berechnen wir Ihnen vereinbarungsgemäß:`, c.credit_pct ? `${String(c.credit_pct).replace(".", ",")} % der Lizenzzahlungen werden auf den vereinbarten Kaufpreis angerechnet.` : "Vielen Dank für Ihr Vertrauen!",
      net, vat, net + vat, by);
  db.prepare("INSERT INTO invoice_items(invoice_id, pos, title, description, qty, unit, unit_net, vat_rate, net) VALUES(?,1,?,?,?,?,?,?,?)")
    .run(r.lastInsertRowid, c.title, c.kind, months, months === 1 ? "Monat" : "Monate", c.amount_net, c.vat_rate, net);
  db.prepare("UPDATE contracts SET next_invoice = ?, updated_at = datetime('now') WHERE id = ?").run(addMonths(from, c.interval_months), c.id);
  return r.lastInsertRowid;
}

/** MRR-Verlauf: Stand am Monatsende der letzten n Monate */
function mrrHistory(n = 12) {
  const all = db.prepare("SELECT * FROM contracts").all(), out = [];
  const now = today();
  for (let i = n - 1; i >= 0; i--) {
    const first = addMonths(now.slice(0, 8) + "01", -i), last = i === 0 ? now : addDays(addMonths(first, 1), -1);
    const live = all.filter(c => c.start_date <= last && (!c.end_date || c.end_date > last || (i === 0 && c.end_date >= last)) && !(c.status === "beendet" && !c.end_date));
    const added = all.filter(c => c.start_date >= first && c.start_date <= last).reduce((s, c) => s + c.amount_net, 0);
    const lost = all.filter(c => c.end_date && c.end_date >= first && c.end_date <= last && (i > 0 || c.end_date < last)).reduce((s, c) => s + c.amount_net, 0);
    out.push({ month: first.slice(0, 7), mrr: live.reduce((s, c) => s + c.amount_net, 0), added, lost, count: live.length });
  }
  return out;
}

export function createSubscriptions({ json, readJson, clean }) {
  const cents = v => { if (v === "" || v == null) return null; const s = String(v).trim().replace(/\s|€/g, "");
    const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
    const x = Math.round(Number(n) * 100); return Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null; };
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const audit = (actor, action, id, summary) => db.prepare("INSERT INTO audit_log(actor, action, entity, entity_id, summary) VALUES(?,?,?,?,?)").run(actor, action, "vertrag", id, clean(summary, 500));
  const productStats = id => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_net),0) mrr FROM contracts WHERE product_id = ? AND status != 'beendet'").get(id);
  const productOut = (p, owner) => { const s = productStats(p.id), lead = p.lead_user_id ? db.prepare("SELECT name FROM users WHERE id = ?").get(p.lead_user_id)?.name : null;
    const o = { ...p, active: !!p.active, lead, customers: s.n, mrr: s.mrr };
    if (!owner) { delete o.mrr; delete o.price_month; delete o.setup_fee; } return o; };
  const listContracts = (where = "1=1", ...a) => db.prepare(`SELECT ct.*, c.company, c.name client_name, p.title project_title, pr.name product_name FROM contracts ct JOIN clients c ON c.id = ct.client_id
    LEFT JOIN projects p ON p.id = ct.project_id LEFT JOIN products pr ON pr.id = ct.product_id WHERE ${where} ORDER BY ct.status = 'beendet', c.company, ct.start_date`).all(...a);

  function readContract(d, cur = {}) {
    const start = ymd(d.start_date) || cur.start_date || today();
    const o = {
      client_id: +d.client_id || cur.client_id, project_id: d.project_id !== undefined ? (+d.project_id || null) : cur.project_id ?? null,
      product_id: d.product_id !== undefined ? (+d.product_id || null) : cur.product_id ?? null,
      kind: CONTRACT_KINDS.includes(d.kind) ? d.kind : cur.kind || "IT-Betreuung", title: clean(d.title ?? cur.title, 160),
      amount_net: d.amount_net !== undefined ? cents(d.amount_net) : cur.amount_net, interval_months: [1, 3, 6, 12].includes(+d.interval_months) ? +d.interval_months : cur.interval_months || 1,
      vat_rate: d.vat_rate !== undefined ? int(d.vat_rate, 0, 30, 19) : cur.vat_rate ?? 19, start_date: start,
      min_months: d.min_months !== undefined ? int(d.min_months, 0, 120, 12) : cur.min_months ?? 12, renew_months: d.renew_months !== undefined ? int(d.renew_months, 0, 60, 12) : cur.renew_months ?? 12,
      notice_months: d.notice_months !== undefined ? int(d.notice_months, 0, 24, 3) : cur.notice_months ?? 3,
      next_invoice: d.next_invoice !== undefined ? ymd(d.next_invoice) : cur.next_invoice ?? start, auto_invoice: d.auto_invoice !== undefined ? (d.auto_invoice ? 1 : 0) : cur.auto_invoice ?? 1,
      buyout_net: d.buyout_net !== undefined ? cents(d.buyout_net) : cur.buyout_net ?? null, credit_pct: d.credit_pct !== undefined ? (d.credit_pct === "" || d.credit_pct == null ? null : int(String(d.credit_pct).replace(",", "."), 0, 100, null)) : cur.credit_pct ?? null,
      credit_before: d.credit_before !== undefined ? cents(d.credit_before) || 0 : cur.credit_before || 0, notes: d.notes !== undefined ? clean(d.notes, 2000) : cur.notes ?? null };
    if (!o.client_id || !db.prepare("SELECT 1 FROM clients WHERE id = ?").get(o.client_id)) throw Object.assign(new Error("Bitte einen Kunden wählen."), { code: 400 });
    if (!o.title) throw Object.assign(new Error("Bitte eine Bezeichnung angeben."), { code: 400 });
    if (o.amount_net == null || o.amount_net <= 0) throw Object.assign(new Error("Bitte den Monatsbetrag angeben."), { code: 400 });
    if (o.project_id && !db.prepare("SELECT 1 FROM projects WHERE id = ? AND client_id = ?").get(o.project_id, o.client_id)) o.project_id = null;
    return o;
  }
  const COLS = ["client_id", "project_id", "product_id", "kind", "title", "amount_net", "interval_months", "vat_rate", "start_date", "min_months", "renew_months", "notice_months", "next_invoice", "auto_invoice", "buyout_net", "credit_pct", "credit_before", "notes"];

  function overview() {
    const live = listContracts("ct.status != 'beendet'").map(c => contractOut(c));
    const mrr = live.reduce((s, c) => s + c.mrr, 0), hist = mrrHistory(12), now = today(), in60 = addDays(now, 60);
    const byKind = {}, byProduct = {};
    for (const c of live) { byKind[c.kind] = (byKind[c.kind] || 0) + c.mrr; const k = c.product_name || "ohne Produkt"; byProduct[k] = (byProduct[k] || 0) + c.mrr; }
    const prev = hist[hist.length - 2]?.mrr || 0;
    return { mrr, arr: mrr * 12, count: live.length, customers: new Set(live.map(c => c.client_id)).size, avg: live.length ? Math.round(mrr / new Set(live.map(c => c.client_id)).size) : 0,
      growth: prev ? Math.round((mrr - prev) / prev * 1000) / 10 : null, history: hist,
      byKind: Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })), byProduct: Object.entries(byProduct).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })),
      deadlines: live.filter(c => c.status === "aktiv" && c.noticeBy && c.noticeBy >= now && c.noticeBy <= in60).sort((a, b) => a.noticeBy.localeCompare(b.noticeBy)),
      ending: live.filter(c => c.status === "gekuendigt").sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))),
      buyouts: live.filter(c => c.buyout_net != null).sort((a, b) => a.buyout_from.localeCompare(b.buyout_from)),
      churn12: hist.reduce((s, h) => s + h.lost, 0), new12: hist.reduce((s, h) => s + h.added, 0) };
  }

  /* ---------- Board ---------- */
  async function admin(req, res, p, m, url, user) {
    const owner = isOwner(user);
    if (p === "/produkte" && m === "GET") return json(res, 200, db.prepare("SELECT * FROM products ORDER BY kind, sort, name").all().map(x => productOut(x, owner)));
    if (p.startsWith("/produkte")) {
      if (!owner) return json(res, 403, { error: "Nur für Inhaber" });
      const read = (d, cur = {}) => ({ name: clean(d.name ?? cur.name, 80), kind: d.kind === "leistung" ? "leistung" : d.kind === "eigenprodukt" ? "eigenprodukt" : cur.kind || "eigenprodukt",
        tagline: clean(d.tagline ?? cur.tagline, 160), description: clean(d.description ?? cur.description, 3000), status: PRODUCT_STATUS.includes(d.status) ? d.status : cur.status || "Entwicklung",
        progress: d.progress !== undefined ? int(d.progress, 0, 100, 0) : cur.progress ?? 0, version: clean(d.version ?? cur.version, 30), next_milestone: clean(d.next_milestone ?? cur.next_milestone, 160),
        milestone_date: d.milestone_date !== undefined ? ymd(d.milestone_date) : cur.milestone_date ?? null, lead_user_id: d.lead_user_id !== undefined ? (+d.lead_user_id || null) : cur.lead_user_id ?? null,
        url: clean(d.url ?? cur.url, 300), price_month: d.price_month !== undefined ? cents(d.price_month) : cur.price_month ?? null, setup_fee: d.setup_fee !== undefined ? cents(d.setup_fee) : cur.setup_fee ?? null,
        bereich: ["software", "hardware"].includes(d.bereich) ? d.bereich : cur.bereich || "software" });
      const K = ["name", "kind", "tagline", "description", "status", "progress", "version", "next_milestone", "milestone_date", "lead_user_id", "url", "price_month", "setup_fee", "bereich"];
      if (p === "/produkte" && m === "POST") { const o = read(await readJson(req)); if (!o.name) return json(res, 400, { error: "Bitte einen Namen angeben." });
        const id = db.prepare(`INSERT INTO products(${K.join(",")}) VALUES(${K.map(() => "?").join(",")})`).run(...K.map(k => o[k])).lastInsertRowid;
        return json(res, 201, productOut(db.prepare("SELECT * FROM products WHERE id = ?").get(id), true)); }
      const mm = p.match(/^\/produkte\/(\d+)$/), cur = mm && db.prepare("SELECT * FROM products WHERE id = ?").get(+mm[1]);
      if (!cur) return json(res, 404, { error: "Produkt nicht gefunden" });
      if (m === "PUT") { const o = read(await readJson(req), cur);
        db.prepare(`UPDATE products SET ${K.map(k => k + " = ?").join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...K.map(k => o[k]), cur.id);
        return json(res, 200, productOut(db.prepare("SELECT * FROM products WHERE id = ?").get(cur.id), true)); }
      if (m === "DELETE") { if (productStats(cur.id).n) return json(res, 409, { error: "Es laufen noch Verträge zu diesem Produkt." }); db.prepare("DELETE FROM products WHERE id = ?").run(cur.id); return json(res, 200, { ok: true }); }
    }
    if (!p.startsWith("/vertraege")) return null;
    if (!owner) return json(res, 403, { error: "Nur für Inhaber" });
    if (p === "/vertraege/uebersicht" && m === "GET") return json(res, 200, overview());
    if (p === "/vertraege" && m === "GET") {
      const cid = +url.searchParams.get("client_id") || null;
      return json(res, 200, { kinds: CONTRACT_KINDS, list: (cid ? listContracts("ct.client_id = ?", cid) : listContracts()).map(c => contractOut(c)) });
    }
    if (p === "/vertraege" && m === "POST") {
      const o = readContract(await readJson(req));
      const id = db.prepare(`INSERT INTO contracts(${COLS.join(",")}) VALUES(${COLS.map(() => "?").join(",")})`).run(...COLS.map(k => o[k])).lastInsertRowid;
      audit(user.name, "vertrag angelegt", id, `${o.title} · ${(o.amount_net / 100).toLocaleString("de-DE")} €/Monat`);
      return json(res, 201, contractOut(listContracts("ct.id = ?", id)[0]));
    }
    const mm = p.match(/^\/vertraege\/(\d+)(?:\/(kuendigen|reaktivieren|rechnung))?$/);
    if (!mm) return json(res, 404, { error: "Nicht gefunden" });
    const cur = db.prepare("SELECT * FROM contracts WHERE id = ?").get(+mm[1]); if (!cur) return json(res, 404, { error: "Vertrag nicht gefunden" });
    const act = mm[2];
    if (!act && m === "GET") return json(res, 200, { ...contractOut(listContracts("ct.id = ?", cur.id)[0]),
      invoices: db.prepare("SELECT id, number, title, gross, status, locked, issue_date, service_from, service_to FROM invoices WHERE contract_id = ? ORDER BY COALESCE(service_from, created_at) DESC").all(cur.id) });
    if (!act && m === "PUT") {
      const o = readContract(await readJson(req), cur);
      db.prepare(`UPDATE contracts SET ${COLS.map(k => k + " = ?").join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...COLS.map(k => o[k]), cur.id);
      if (o.amount_net !== cur.amount_net) audit(user.name, "vertrag geändert", cur.id, `${cur.title}: ${(cur.amount_net / 100).toLocaleString("de-DE")} → ${(o.amount_net / 100).toLocaleString("de-DE")} €/Monat`);
      return json(res, 200, contractOut(listContracts("ct.id = ?", cur.id)[0]));
    }
    if (!act && m === "DELETE") {
      if (db.prepare("SELECT 1 FROM invoices WHERE contract_id = ? AND locked = 1").get(cur.id)) return json(res, 409, { error: "Zu diesem Vertrag gibt es schon Rechnungen – bitte kündigen statt löschen." });
      db.prepare("DELETE FROM invoices WHERE contract_id = ? AND locked = 0").run(cur.id); db.prepare("DELETE FROM contracts WHERE id = ?").run(cur.id);
      audit(user.name, "vertrag gelöscht", cur.id, cur.title); return json(res, 200, { ok: true });
    }
    if (act === "kuendigen" && m === "POST") {
      if (cur.status !== "aktiv") return json(res, 409, { error: "Der Vertrag ist bereits gekündigt." });
      const d = await readJson(req), t = term(cur), end = ymd(d.end_date) || t.earliestEnd;
      db.prepare("UPDATE contracts SET status = 'gekuendigt', cancelled_at = date('now'), cancelled_by = ?, end_date = ?, notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?")
        .run(clean(d.by, 40) || "Kunde", end, `Kündigung (${clean(d.by, 40) || "Kunde"}) am ${today().split("-").reverse().join(".")} zum ${end.split("-").reverse().join(".")}${clean(d.reason, 300) ? ": " + clean(d.reason, 300) : ""}`, cur.id);
      audit(user.name, "vertrag gekündigt", cur.id, `${cur.title} zum ${end}`);
      return json(res, 200, contractOut(listContracts("ct.id = ?", cur.id)[0]));
    }
    if (act === "reaktivieren" && m === "POST") {
      db.prepare("UPDATE contracts SET status = 'aktiv', cancelled_at = NULL, cancelled_by = NULL, end_date = NULL, updated_at = datetime('now') WHERE id = ?").run(cur.id);
      audit(user.name, "kündigung zurückgenommen", cur.id, cur.title); return json(res, 200, contractOut(listContracts("ct.id = ?", cur.id)[0]));
    }
    if (act === "rechnung" && m === "POST") {
      const id = draftForContract(cur.id, user.name);
      return id ? json(res, 201, { id }) : json(res, 409, { error: "Für diesen Vertrag ist keine weitere Abrechnung fällig (Vertragsende erreicht)." });
    }
    return json(res, 404, { error: "Nicht gefunden" });
  }

  /* ---------- Kundenportal ---------- */
  function portal(req, res, url, p, c) {
    if (p !== "/vertraege" || req.method !== "GET") return null;
    return json(res, 200, listContracts("ct.client_id = ? AND ct.status != 'beendet'", c.id).map(x => { const o = contractOut(x);
      return { id: o.id, kind: o.kind, title: o.title, product: o.product_name, project: o.project_title, amount_net: o.amount_net, amount_gross: o.amount_gross, vat_rate: o.vat_rate,
        interval_months: o.interval_months, start_date: o.start_date, minEnd: o.minEnd, inMinTerm: o.inMinTerm, periodEnd: o.periodEnd, noticeBy: o.noticeBy, notice_months: o.notice_months,
        renew_months: o.renew_months, status: o.status, end_date: o.end_date, credit: o.credit_pct ? o.credit : null, credit_pct: o.credit_pct, buyout_net: o.buyout_net, buyout_rest: o.buyout_rest, buyout_from: o.buyout_from }; }));
  }
  return { admin, portal, overview };
}

// Jedes Produkt gehört zu einem Bereich: Software oder Hardware
if (!db.prepare("PRAGMA table_info(products)").all().some(c => c.name === "bereich")) db.exec("ALTER TABLE products ADD COLUMN bereich TEXT NOT NULL DEFAULT 'software'");
