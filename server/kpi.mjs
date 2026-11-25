// Kennzahlen-Cockpit für Inhaber: Geld, Vertrieb, Projekte, Team, Kunden – mit Vergleich zur Vorperiode,
// 12-Monats-Verläufen, erwarteten Zahlungseingängen und automatisch abgeleiteten Hinweisen („Worauf achten“).
import { db } from "./db.mjs";
import { isOwner } from "./access.mjs";

const TZ = "Europe/Berlin";
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const t = new Date(d.slice(0, 8) + "01T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
const workdays = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w && w < 6) n++; } return n; };

/** Zeitraum: laufender Monat/Quartal/Jahr bis heute + gleich langer Abschnitt der Vorperiode */
function periods(range) {
  const t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  let from, prevFrom, label;
  if (range === "jahr") { from = `${y}-01-01`; prevFrom = `${y - 1}-01-01`; label = `${y}`; }
  else if (range === "quartal") { const q = Math.floor((m - 1) / 3); from = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`; prevFrom = addMonths(from, -3); label = `Q${q + 1} ${y}`; }
  else { from = t.slice(0, 8) + "01"; prevFrom = addMonths(from, -1); label = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(from + "T00:00:00Z")); }
  const len = Math.round((Date.parse(t) - Date.parse(from)) / 864e5);
  return { range, label, from, to: t, prevFrom, prevTo: addDays(prevFrom, len) };
}

export function createKpi({ json, subs, support }) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? Object.values(r)[0] || 0 : 0; };

  function money(from, to) {
    return {
      revenue: val("SELECT COALESCE(SUM(net),0) FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND issue_date BETWEEN ? AND ?", from, to),
      paidIn: val("SELECT COALESCE(SUM(COALESCE(paid_amount, gross)),0) FROM invoices WHERE kind = 'rechnung' AND status = 'bezahlt' AND paid_at BETWEEN ? AND ?", from, to),
      expenses: val("SELECT COALESCE(SUM(net),0) FROM expenses WHERE status != 'storniert' AND reversal_of IS NULL AND doc_date BETWEEN ? AND ?", from, to),
      newOrders: one("SELECT COUNT(*) n, COALESCE(SUM(offer_net),0) s FROM projects WHERE date(created_at) BETWEEN ? AND ? AND COALESCE(offer_net,0) > 0", from, to),
      quotesSent: one("SELECT COUNT(*) n, COALESCE(SUM(net),0) s FROM invoices WHERE kind = 'angebot' AND locked = 1 AND issue_date BETWEEN ? AND ?", from, to),
      leads: val("SELECT COUNT(*) FROM clients WHERE source IS NOT NULL AND date(created_at) BETWEEN ? AND ?", from, to),
      meetings: val("SELECT COUNT(*) FROM appointments WHERE date(start) BETWEEN ? AND ? AND start < ?", from, to, new Date().toISOString()),
      firstMeetings: val("SELECT COUNT(*) FROM appointments WHERE date(start) BETWEEN ? AND ? AND start < ? AND (title LIKE '%Erstgespräch%' OR kind LIKE '%Erstgespräch%')", from, to, new Date().toISOString()),
      hours: val("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE date BETWEEN ? AND ?", from, to),
      projectHours: val("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE date BETWEEN ? AND ? AND project_id IS NOT NULL", from, to),
      tasksDone: val("SELECT COUNT(*) FROM tasks WHERE status = 'erledigt' AND date(done_at) BETWEEN ? AND ?", from, to),
    };
  }

  function compute(range) {
    const P = periods(range), cur = money(P.from, P.to), prev = money(P.prevFrom, P.prevTo), t = P.to;
    // Geld jetzt
    const open = one("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND status = 'offen'");
    const overdue = one("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND status = 'offen' AND due_date < ?", t);
    const backlog = val(`SELECT COALESCE(SUM(pay.amount_net),0) FROM payments pay JOIN projects p ON p.id = pay.project_id WHERE p.status = 'aktiv' AND pay.status = 'offen'`);
    const drafts = one("SELECT COUNT(*) n, COALESCE(SUM(gross),0) s FROM invoices WHERE kind = 'rechnung' AND locked = 0");
    const sub = subs.overview();
    // Erwartete Eingänge (brutto) in 30/60/90 Tagen: offene Rechnungen nach Fälligkeit + Abo-Umsatz
    const buckets = [30, 60, 90].map((d, i) => {
      const a = i ? addDays(t, [0, 30, 60][i] + 1) : "0000-00-00", b = addDays(t, d);
      const inv = val("SELECT COALESCE(SUM(gross),0) FROM invoices WHERE kind = 'rechnung' AND locked = 1 AND status = 'offen' AND COALESCE(due_date, issue_date) BETWEEN ? AND ?", a, b);
      const abo = Math.round(val("SELECT COALESCE(SUM(amount_net * (1 + vat_rate / 100.0)),0) FROM contracts WHERE status != 'beendet' AND (end_date IS NULL OR end_date >= ?)", a === "0000-00-00" ? t : a));
      return { label: `${[0, 31, 61][i]}–${d} Tage`, invoices: inv, contracts: abo, sum: inv + abo };
    });
    // Vertrieb (rollierend 12 Monate)
    const y1 = addDays(t, -365);
    const quotes12 = one(`SELECT SUM(status = 'angenommen') won, SUM(status = 'abgelehnt' OR (status = 'versendet' AND valid_until < ?)) lost, SUM(status = 'versendet' AND (valid_until IS NULL OR valid_until >= ?)) pending,
      COALESCE(SUM(CASE WHEN status = 'versendet' AND (valid_until IS NULL OR valid_until >= ?) THEN net END),0) pendingNet FROM invoices WHERE kind = 'angebot' AND locked = 1 AND issue_date >= ?`, t, t, t, y1);
    const leads12 = one("SELECT COUNT(*) n, SUM(stage = 'mandant') won FROM clients WHERE source IS NOT NULL AND date(created_at) >= ?", y1);
    const cycle = one(`SELECT AVG(julianday(fp) - julianday(c.created_at)) d, COUNT(*) n FROM clients c JOIN (SELECT client_id, MIN(created_at) fp FROM projects GROUP BY client_id) p ON p.client_id = c.id
      WHERE c.source IS NOT NULL AND date(c.created_at) >= ? AND fp >= c.created_at`, y1);
    const pipeline = one("SELECT SUM(stage = 'anfrage') anfrage, SUM(stage = 'interessent') interessent FROM clients");
    // Projekte
    const phases = db.prepare("SELECT phase, COUNT(*) n, COALESCE(SUM(offer_net),0) v FROM projects WHERE status = 'aktiv' GROUP BY phase").all();
    const projects = db.prepare(`SELECT p.id, p.title, p.phase, p.offer_net, c.company,
        (SELECT COALESCE(SUM(e.minutes),0) FROM time_entries e JOIN tasks k ON k.id = e.task_id WHERE k.project_id = p.id AND k.estimate_min > 0) spent,
        (SELECT COALESCE(SUM(estimate_min),0) FROM tasks WHERE project_id = p.id AND estimate_min > 0) est,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'erledigt' AND due_date < ?) late,
        (SELECT COUNT(*) FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE pr.project_id = p.id AND a.status = 'offen') notes,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) team,
        MAX(COALESCE((SELECT MAX(created_at) FROM events WHERE project_id = p.id), p.created_at), COALESCE((SELECT MAX(date) || ' 12:00:00' FROM time_entries WHERE project_id = p.id), ''),
          COALESCE((SELECT MAX(replace(substr(done_at, 1, 19), 'T', ' ')) FROM tasks WHERE project_id = p.id), '')) last
      FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.status = 'aktiv'`).all(t);
    const risk = projects.map(p => { const why = [];
        if (p.est >= 120 && p.spent > p.est * 1.2) why.push(`${Math.round(p.spent / 60)} Std. erfasst bei ${Math.round(p.est / 60)} Std. Schätzung`);
        if (p.late >= 2) why.push(`${p.late} überfällige Aufgaben`);
        if (p.notes >= 5) why.push(`${p.notes} offene Kunden-Anmerkungen`);
        if (!p.team && p.phase !== "Erstgespräch") why.push("kein Team");
        if (p.phase !== "Betreuung" && Date.now() - Date.parse(String(p.last).replace(" ", "T") + (String(p.last).includes("T") ? "" : "Z")) > 14 * 864e5) why.push("seit 14 Tagen nichts passiert");
        return { ...p, why }; }).filter(p => p.why.length).sort((a, b) => b.why.length - a.why.length).slice(0, 8);
    // Team im Zeitraum
    const firstTime = val("SELECT MIN(date) FROM time_entries") || P.to, tFrom = firstTime > P.from ? firstTime : P.from;
    const wd = workdays(tFrom, P.to);
    const team = db.prepare(`SELECT u.id, u.name, u.role, COALESCE(SUM(e.minutes),0) minutes, COALESCE(SUM(CASE WHEN e.project_id IS NOT NULL THEN e.minutes END),0) project
        FROM users u LEFT JOIN time_entries e ON e.user_id = u.id AND e.date BETWEEN ? AND ? WHERE u.active = 1 AND u.invite_token IS NULL GROUP BY u.id ORDER BY minutes DESC`).all(P.from, P.to)
      .filter(u => u.minutes > 0 || u.role !== "inhaber").map(u => ({ ...u, capacity: wd * 8 * 60, util: wd ? Math.round(u.minutes / (wd * 8 * 60) * 100) : 0,
        open: val("SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status != 'erledigt'", u.id), late: val("SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status != 'erledigt' AND due_date < ?", u.id, t),
        projects: val("SELECT COUNT(*) FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? AND p.status = 'aktiv'", u.id) }));
    // Kunden: Umsatz der letzten 12 Monate + laufende Verträge
    const top = db.prepare(`SELECT c.id, c.company, COALESCE((SELECT SUM(net) FROM invoices WHERE client_id = c.id AND kind IN ('rechnung','storno') AND locked = 1 AND issue_date >= ?),0) revenue,
        COALESCE((SELECT SUM(amount_net) FROM contracts WHERE client_id = c.id AND status != 'beendet'),0) mrr FROM clients c WHERE c.stage = 'mandant'`).all(y1)
      .map(c => ({ ...c, value: c.revenue + c.mrr * 12 })).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
    const topSum = top.reduce((s, c) => s + c.value, 0);
    // 12-Monats-Verläufe
    const months = Array.from({ length: 12 }, (_, i) => { const f = addMonths(t, i - 11), l = i === 11 ? t : addDays(addMonths(f, 1), -1);
      return { month: f.slice(0, 7), revenue: val("SELECT COALESCE(SUM(net),0) FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND issue_date BETWEEN ? AND ?", f, l),
        expenses: val("SELECT COALESCE(SUM(net),0) FROM expenses WHERE status != 'storniert' AND reversal_of IS NULL AND doc_date BETWEEN ? AND ?", f, l),
        leads: val("SELECT COUNT(*) FROM clients WHERE source IS NOT NULL AND date(created_at) BETWEEN ? AND ?", f, l),
        hours: val("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE date BETWEEN ? AND ?", f, l) }; });
    sub.history.forEach((h, i) => { if (months[i]) months[i].mrr = h.mrr; });

    const decided = (quotes12.won || 0) + (quotes12.lost || 0);
    const out = { period: P, cur, prev,
      money: { open, overdue, backlog, drafts, mrr: sub.mrr, arr: sub.arr, contracts: sub.count, buckets,
        perHour: cur.hours >= 600 ? Math.round(val("SELECT COALESCE(SUM(net),0) FROM invoices WHERE kind IN ('rechnung','storno') AND locked = 1 AND issue_date BETWEEN ? AND ?", tFrom, P.to) / (cur.hours / 60)) : null },
      sales: { winRate: decided ? Math.round((quotes12.won || 0) / decided * 100) : null, won: quotes12.won || 0, lost: quotes12.lost || 0, pending: quotes12.pending || 0, pendingNet: quotes12.pendingNet,
        leads12: leads12.n, leadConv: leads12.n ? Math.round((leads12.won || 0) / leads12.n * 100) : null, cycleDays: cycle.n ? Math.round(cycle.d) : null, pipeline },
      projects: { active: projects.length, phases, risk, lateTasks: projects.reduce((s, p) => s + p.late, 0), notes: projects.reduce((s, p) => s + p.notes, 0) },
      support: support ? support.stats(P.from, P.to) : null,
      team: { workdays: wd, since: tFrom > P.from ? tFrom : null, people: team }, clients: { top: top.slice(0, 6), topShare: topSum && top.length ? Math.round(top[0].value / topSum * 100) : null, count: val("SELECT COUNT(*) FROM clients WHERE stage = 'mandant'") },
      months };
    out.hints = hints(out);
    return out;
  }

  /** Worauf achten: wenige, konkrete Hinweise mit Stufe (gut / hinweis / achtung / kritisch) */
  function hints(k) {
    const H = [], eur = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(c / 100);
    if (k.money.overdue.n) H.push({ level: k.money.overdue.s > 1000000 ? "kritisch" : "achtung", title: `${eur(k.money.overdue.s)} überfällig`, text: `${k.money.overdue.n} Rechnung${k.money.overdue.n === 1 ? "" : "en"} über dem Zahlungsziel – Mahnvorschläge stehen im Cockpit.`, href: "#finanzen/rechnungen" });
    if (k.support?.overdue) H.push({ level: "kritisch", title: `${k.support.overdue} Support-Anfrage${k.support.overdue === 1 ? "" : "n"} über der Antwortfrist`, text: "Kunden warten länger als zugesagt – bitte zuerst beantworten.", href: "#support" });
    if (k.support?.critical) H.push({ level: "achtung", title: `${k.support.critical} kritische Support-Anfrage${k.support.critical === 1 ? "" : "n"} offen`, text: "Beim Kunden steht ein System oder eine wichtige Funktion.", href: "#support" });
    if (k.money.drafts.n) H.push({ level: "hinweis", title: k.money.drafts.n === 1 ? "1 Rechnung wartet auf Freigabe" : `${k.money.drafts.n} Rechnungen warten auf Freigabe`, text: `${eur(k.money.drafts.s)} brutto sind vorbereitet, aber noch nicht verschickt.`, href: "#cockpit" });
    const over = k.team.people.filter(u => u.util > 110), idle = k.team.people.filter(u => u.role === "entwickler" && u.util < 50 && k.team.workdays >= 3);
    if (over.length) H.push({ level: "achtung", title: `Überlastet: ${over.map(u => u.name.split(" ")[0]).join(", ")}`, text: `Mehr als 110 % der Sollzeit erfasst. Aufgaben umverteilen oder Fristen schieben.`, href: "#arbeitsplatz" });
    if (idle.length) H.push({ level: "hinweis", title: `Freie Kapazität: ${idle.map(u => u.name.split(" ")[0]).join(", ")}`, text: `Unter 50 % der Sollzeit erfasst – Platz für neue Projekte oder die eigenen Produkte (oder Zeiten werden nicht erfasst).`, href: "#arbeitsplatz" });
    if (k.projects.risk.length) H.push({ level: k.projects.risk.length >= 4 ? "achtung" : "hinweis", title: `${k.projects.risk.length} Projekt${k.projects.risk.length === 1 ? "" : "e"} mit Risiko`, text: k.projects.risk.slice(0, 2).map(p => `${p.title}: ${p.why[0]}`).join(" · "), href: "#projekte" });
    if (k.clients.topShare >= 35) H.push({ level: "hinweis", title: `Klumpenrisiko: ${k.clients.top[0].company}`, text: `${k.clients.topShare} % Ihres Umsatzes (12 Monate inkl. Verträge) hängen an einem Kunden.`, href: `#kunden/${k.clients.top[0].id}` });
    if (k.sales.winRate != null && k.sales.winRate < 30 && (k.sales.won + k.sales.lost) >= 4) H.push({ level: "achtung", title: `Nur ${k.sales.winRate} % der Angebote gewonnen`, text: "Angebote nachfassen und Ablehnungsgründe prüfen (stehen im Verlauf der Kunden).", href: "#finanzen/angebote" });
    if (k.cur.leads < k.prev.leads * .6 && k.prev.leads >= 3) H.push({ level: "hinweis", title: "Weniger neue Anfragen", text: `${k.cur.leads} statt ${k.prev.leads} im Vergleichszeitraum der Vorperiode.`, href: "#anfragen" });
    if (k.cur.revenue > k.prev.revenue * 1.15 && k.prev.revenue > 0) H.push({ level: "gut", title: "Umsatz über Vorperiode", text: `+${Math.round((k.cur.revenue / k.prev.revenue - 1) * 100)} % netto im Vergleich zum gleichen Abschnitt der Vorperiode.` });
    if (k.money.mrr && k.months.length > 1 && k.months[11].mrr > k.months[10].mrr) H.push({ level: "gut", title: "Wiederkehrender Umsatz wächst", text: `MRR ${eur(k.money.mrr)} – planbarer Sockel von ${eur(k.money.arr)} im Jahr.`, href: "#software" });
    const order = { kritisch: 0, achtung: 1, hinweis: 2, gut: 3 };
    return H.sort((a, b) => order[a.level] - order[b.level]);
  }

  async function api(req, res, url, p, m, user) {
    if (p !== "/kpi" || m !== "GET") return null;
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
    const r = url.searchParams.get("range");
    return json(res, 200, compute(["monat", "quartal", "jahr"].includes(r) ? r : "monat"));
  }
  return { api, compute };
}
