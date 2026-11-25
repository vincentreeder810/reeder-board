// Support: Kunden melden Fehler, Fragen und Änderungswünsche im Portal. Jede Meldung bekommt eine Reaktionsfrist
// nach Dringlichkeit (Geschäftszeiten Mo–Fr), eine zuständige Person und einen Verlauf mit Antworten und internen Notizen.
import { db, getSetting, setSetting } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { isOwner, memberProjectIds, clientIdsFor } from "./access.mjs";

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'frage', priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','in_bearbeitung','wartet','geloest','geschlossen')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, task_id INTEGER, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), due_at TEXT, first_response_at TEXT, solved_at TEXT, closed_at TEXT,
  client_seen_id INTEGER NOT NULL DEFAULT 0, team_seen_id INTEGER NOT NULL DEFAULT 0, reminded_at TEXT
);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('client','team','system')), author TEXT NOT NULL, body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tmsg_ticket ON ticket_messages(ticket_id, id);
`);

export const CATEGORIES = { fehler: "Fehler", frage: "Frage", wunsch: "Änderungswunsch" };
export const PRIORITIES = { kritisch: "Kritisch – System steht", hoch: "Hoch – wichtige Funktion gestört", normal: "Normal" };
export const STATUS = { neu: "Neu", in_bearbeitung: "In Bearbeitung", wartet: "Wartet auf Kunde", geloest: "Gelöst", geschlossen: "Geschlossen" };
export const DEFAULT_SUPPORT = {
  sla: { kritisch: { hours: 4, business: false }, hoch: { hours: 8, business: true }, normal: { hours: 16, business: true } },
  dayFrom: 9, dayTo: 17, autoCloseDays: 7, waitReminderDays: 4,
};
export const supportCfg = () => { const s = getSetting("support", DEFAULT_SUPPORT); return { ...DEFAULT_SUPPORT, ...s, sla: { ...DEFAULT_SUPPORT.sla, ...(s.sla || {}) } }; };

// Berliner Wochentag/Stunde für einen Zeitpunkt
const bParts = ms => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1, h: +p.hour }; };
/** Frist: Kalenderstunden oder Geschäftsstunden (Mo–Fr, dayFrom–dayTo Uhr Berlin) ab Start */
export function dueFrom(startMs, priority, cfg = supportCfg()) {
  const s = cfg.sla[priority] || cfg.sla.normal;
  if (!s.business) return new Date(startMs + s.hours * 3600e3).toISOString();
  let left = s.hours * 60, t = Math.ceil(startMs / 300e3) * 300e3;
  for (let guard = 0; left > 0 && guard < 20000; guard++, t += 300e3) { const { wd, h } = bParts(t); if (wd <= 5 && h >= cfg.dayFrom && h < cfg.dayTo) left -= 5; }
  return new Date(t).toISOString();
}
const iso = s => s ? (String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z") : null;

export function createSupport({ json, readJson, clean, SITE_URL, onChange = () => {} }) {
  const sel = `SELECT t.*, c.company, c.name client_name, c.email client_email, p.title project_title, u.name assignee,
    (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id AND internal = 0) msgs,
    (SELECT MAX(id) FROM ticket_messages WHERE ticket_id = t.id AND internal = 0) last_id,
    (SELECT MAX(id) FROM ticket_messages WHERE ticket_id = t.id AND author_kind = 'client') last_client_id,
    (SELECT MAX(id) FROM ticket_messages WHERE ticket_id = t.id AND author_kind = 'team' AND internal = 0) last_team_id,
    (SELECT created_at FROM ticket_messages WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) last_at
    FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id`;
  const out = t => { if (!t) return t; const open = ["neu", "in_bearbeitung"].includes(t.status) && !t.first_response_at;
    const left = open && t.due_at ? Math.round((Date.parse(t.due_at) - Date.now()) / 60000) : null;
    return { ...t, created_at: iso(t.created_at), first_response_at: iso(t.first_response_at), last_at: iso(t.last_at), sla: open ? (left < 0 ? "ueberfaellig" : left < 120 ? "knapp" : "ok") : t.first_response_at ? (Date.parse(iso(t.first_response_at)) <= Date.parse(t.due_at) ? "eingehalten" : "verfehlt") : null, due_left_min: left }; };
  const byId = id => out(db.prepare(`${sel} WHERE t.id = ?`).get(id));
  const msgs = (id, internal) => db.prepare(`SELECT id, author_kind, author, body, internal, created_at FROM ticket_messages WHERE ticket_id = ? ${internal ? "" : "AND internal = 0"} ORDER BY id`).all(id).map(m => ({ ...m, internal: !!m.internal, created_at: iso(m.created_at) }));
  const addMsg = (tid, kind, author, body, internal = 0) => db.prepare("INSERT INTO ticket_messages(ticket_id, author_kind, author, body, internal) VALUES(?,?,?,?,?)").run(tid, kind, author, body, internal ? 1 : 0).lastInsertRowid;
  const owners = () => db.prepare("SELECT id, name, email FROM users WHERE role = 'inhaber' AND active = 1").all();
  const mailTeam = async (t, subject, text) => { const to = new Map(owners().map(u => [u.email, u]));
    if (t.assignee_id) { const a = db.prepare("SELECT email, name FROM users WHERE id = ? AND active = 1").get(t.assignee_id); if (a) to.set(a.email, a); }
    for (const u of to.values()) await sendMail({ to: u.email, subject, text: `${text}\n\n${SITE_URL}/admin/#support/${t.id}` }).catch(e => console.warn(e.message)); };
  const visibleFor = user => { if (isOwner(user)) return () => true; const pids = memberProjectIds(user), cids = clientIdsFor(user);
    return t => t.assignee_id === user.id || (t.project_id ? pids.includes(t.project_id) : cids.includes(t.client_id)); };

  /* ---------- Kundenportal ---------- */
  async function portal(req, res, url, p, c) {
    const m = req.method;
    if (p === "/support" && m === "GET") {
      const list = db.prepare(`${sel} WHERE t.client_id = ? ORDER BY t.status = 'geschlossen', COALESCE(last_at, t.created_at) DESC`).all(c.id).map(out);
      return json(res, 200, { list: list.map(t => ({ id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, project: t.project_title, created_at: t.created_at, last_at: t.last_at, msgs: t.msgs, unread: (t.last_team_id || 0) > t.client_seen_id })),
        projects: db.prepare("SELECT id, title FROM projects WHERE client_id = ? AND status != 'abgeschlossen' ORDER BY updated_at DESC").all(c.id), sla: supportCfg().sla, categories: CATEGORIES, priorities: PRIORITIES });
    }
    if (p === "/support" && m === "POST") {
      const d = await readJson(req, 64 * 1024), subject = clean(d.subject, 160), body = clean(d.body, 8000).replace(/\r/g, "");
      if (subject.length < 3 || body.length < 5) return json(res, 400, { error: "Bitte Betreff und eine kurze Beschreibung angeben." });
      const pid = +d.project_id && db.prepare("SELECT 1 FROM projects WHERE id = ? AND client_id = ?").get(+d.project_id, c.id) ? +d.project_id : null;
      const prio = PRIORITIES[d.priority] ? d.priority : "normal", cat = CATEGORIES[d.category] ? d.category : "frage";
      // Zuständig: wer im Projekt arbeitet (erstes Teammitglied), sonst offen
      const assignee = pid ? db.prepare("SELECT user_id FROM project_members WHERE project_id = ? ORDER BY user_id DESC LIMIT 1").get(pid)?.user_id ?? null : null;
      const id = db.prepare("INSERT INTO tickets(client_id, project_id, subject, category, priority, assignee_id, created_by, due_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(c.id, pid, subject, cat, prio, assignee, c.name, dueFrom(Date.now(), prio)).lastInsertRowid;
      const mid = addMsg(id, "client", c.name, body); db.prepare("UPDATE tickets SET client_seen_id = ? WHERE id = ?").run(mid, id);
      const t = byId(id);
      await mailTeam(t, `${prio === "kritisch" ? "🔴 KRITISCH: " : ""}Support-Anfrage #${id} · ${c.company}: ${subject}`,
        `${c.name} (${c.company}) hat eine ${CATEGORIES[cat]}-Meldung erstellt${t.project_title ? ` zum Projekt „${t.project_title}“` : ""}.\nDringlichkeit: ${PRIORITIES[prio]}\nAntwort fällig bis: ${new Date(t.due_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}\n\n${body}`);
      onChange(); return json(res, 201, { id });
    }
    let mm = p.match(/^\/support\/(\d+)(?:\/(reply|solved|reopen))?$/);
    if (!mm) return null;
    const t = byId(+mm[1]); if (!t || t.client_id !== c.id) return json(res, 404, { error: "Anfrage nicht gefunden" });
    if (!mm[2] && m === "GET") {
      const list = msgs(t.id, false); db.prepare("UPDATE tickets SET client_seen_id = ? WHERE id = ?").run(list.at(-1)?.id || 0, t.id);
      return json(res, 200, { ...{ id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, project: t.project_title, created_at: t.created_at, assignee: t.assignee }, messages: list });
    }
    if (m !== "POST") return json(res, 405, { error: "Nicht erlaubt" });
    const d = await readJson(req, 64 * 1024);
    if (mm[2] === "reply") {
      const body = clean(d.body, 8000).replace(/\r/g, ""); if (!body) return json(res, 400, { error: "Bitte eine Nachricht eingeben." });
      if (t.status === "geschlossen") return json(res, 409, { error: "Diese Anfrage ist geschlossen – bitte eine neue erstellen." });
      const mid = addMsg(t.id, "client", c.name, body);
      db.prepare("UPDATE tickets SET client_seen_id = ?, status = CASE WHEN status IN ('wartet','geloest') THEN 'in_bearbeitung' ELSE status END, solved_at = CASE WHEN status = 'geloest' THEN NULL ELSE solved_at END, reminded_at = NULL WHERE id = ?").run(mid, t.id);
      await mailTeam(t, `Antwort zu Support #${t.id} · ${t.company}: ${t.subject}`, `${c.name} hat geantwortet:\n\n${body}`);
      onChange(); return json(res, 200, { ok: true });
    }
    if (mm[2] === "solved") { db.prepare("UPDATE tickets SET status = 'geschlossen', closed_at = datetime('now'), solved_at = COALESCE(solved_at, datetime('now')) WHERE id = ?").run(t.id);
      addMsg(t.id, "system", "System", `${c.name} hat die Anfrage als erledigt markiert.`); onChange(); return json(res, 200, { ok: true }); }
    if (mm[2] === "reopen") { db.prepare("UPDATE tickets SET status = 'in_bearbeitung', closed_at = NULL, solved_at = NULL WHERE id = ?").run(t.id);
      addMsg(t.id, "system", "System", `${c.name} hat die Anfrage wieder geöffnet.`); onChange(); return json(res, 200, { ok: true }); }
    return null;
  }

  /* ---------- Board ---------- */
  async function admin(req, res, url, p, m, user) {
    if (!p.startsWith("/support")) return null;
    const can = visibleFor(user);
    if (p === "/support" && m === "GET") {
      const list = db.prepare(`${sel} ORDER BY CASE t.status WHEN 'neu' THEN 0 WHEN 'in_bearbeitung' THEN 1 WHEN 'wartet' THEN 2 WHEN 'geloest' THEN 3 ELSE 4 END,
        CASE t.priority WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 ELSE 2 END, t.due_at`).all().map(out).filter(can)
        .map(t => ({ ...t, unread: (t.last_client_id || 0) > t.team_seen_id }));
      return json(res, 200, { list, categories: CATEGORIES, priorities: PRIORITIES, status: STATUS });
    }
    if (p === "/support/settings") {
      if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber" });
      if (m === "GET") return json(res, 200, supportCfg());
      if (m === "PUT") { const d = await readJson(req), cur = supportCfg(), n = (v, lo, hi, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def; };
        const sla = {}; for (const k of Object.keys(DEFAULT_SUPPORT.sla)) sla[k] = { hours: n(d.sla?.[k]?.hours, 1, 240, cur.sla[k].hours), business: d.sla?.[k]?.business !== undefined ? !!d.sla[k].business : cur.sla[k].business };
        const next = { sla, dayFrom: n(d.dayFrom, 0, 23, cur.dayFrom), dayTo: n(d.dayTo, 1, 24, cur.dayTo), autoCloseDays: n(d.autoCloseDays, 1, 60, cur.autoCloseDays), waitReminderDays: n(d.waitReminderDays, 1, 60, cur.waitReminderDays) };
        if (next.dayTo <= next.dayFrom) return json(res, 400, { error: "Die Geschäftszeit muss nach dem Beginn enden." });
        setSetting("support", next); return json(res, 200, next); }
    }
    let mm = p.match(/^\/support\/(\d+)(?:\/(reply|task))?$/);
    if (!mm) return json(res, 404, { error: "Nicht gefunden" });
    const t = byId(+mm[1]); if (!t || !can(t)) return json(res, 404, { error: "Anfrage nicht gefunden" });
    if (!mm[2] && m === "GET") {
      const list = msgs(t.id, true); db.prepare("UPDATE tickets SET team_seen_id = ? WHERE id = ?").run(list.filter(x => x.author_kind === "client").at(-1)?.id || t.team_seen_id, t.id);
      const people = db.prepare(`SELECT id, name FROM users WHERE active = 1 AND invite_token IS NULL AND (role = 'inhaber' OR id IN (SELECT user_id FROM project_members WHERE project_id = ?)) ORDER BY name`).all(t.project_id || 0);
      return json(res, 200, { ...t, messages: list, people, projects: db.prepare("SELECT id, title FROM projects WHERE client_id = ? ORDER BY updated_at DESC").all(t.client_id) });
    }
    if (!mm[2] && m === "PATCH") {
      const d = await readJson(req), changes = [];
      if (d.status && STATUS[d.status] && d.status !== t.status) { db.prepare("UPDATE tickets SET status = ?, solved_at = CASE WHEN ? = 'geloest' THEN datetime('now') ELSE solved_at END, closed_at = CASE WHEN ? = 'geschlossen' THEN datetime('now') ELSE NULL END WHERE id = ?").run(d.status, d.status, d.status, t.id); changes.push(`Status: ${STATUS[d.status]}`); }
      if (d.priority && PRIORITIES[d.priority] && d.priority !== t.priority) { db.prepare("UPDATE tickets SET priority = ?, due_at = CASE WHEN first_response_at IS NULL THEN ? ELSE due_at END WHERE id = ?").run(d.priority, dueFrom(Date.parse(t.created_at), d.priority), t.id); changes.push(`Dringlichkeit: ${PRIORITIES[d.priority].split(" –")[0]}`); }
      if (d.assignee_id !== undefined && (+d.assignee_id || null) !== t.assignee_id) { db.prepare("UPDATE tickets SET assignee_id = ? WHERE id = ?").run(+d.assignee_id || null, t.id);
        const nm = +d.assignee_id ? db.prepare("SELECT name, email FROM users WHERE id = ?").get(+d.assignee_id) : null; changes.push(`Zuständig: ${nm?.name || "niemand"}`);
        if (nm && +d.assignee_id !== user.id) await sendMail({ to: nm.email, subject: `Support #${t.id} an dich übergeben: ${t.subject}`, text: `${user.name} hat dir die Anfrage von ${t.company} zugewiesen.\n\n${SITE_URL}/admin/#support/${t.id}` }).catch(() => {}); }
      if (d.project_id !== undefined && (+d.project_id || null) !== t.project_id) { db.prepare("UPDATE tickets SET project_id = ? WHERE id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ? AND client_id = ?))").run(+d.project_id || null, t.id, +d.project_id || null, +d.project_id || null, t.client_id); changes.push("Projekt geändert"); }
      if (changes.length) addMsg(t.id, "system", user.name, changes.join(" · "), 1);
      onChange(); return json(res, 200, byId(t.id));
    }
    if (mm[2] === "reply" && m === "POST") {
      const d = await readJson(req, 64 * 1024), body = clean(d.body, 8000).replace(/\r/g, ""); if (!body) return json(res, 400, { error: "Bitte eine Nachricht eingeben." });
      const internal = !!d.internal; addMsg(t.id, "team", user.name, body, internal);
      if (!internal) {
        const next = STATUS[d.status] ? d.status : t.status === "neu" ? "in_bearbeitung" : t.status;
        db.prepare("UPDATE tickets SET first_response_at = COALESCE(first_response_at, datetime('now')), status = ?, assignee_id = COALESCE(assignee_id, ?), solved_at = CASE WHEN ? = 'geloest' THEN datetime('now') ELSE solved_at END, reminded_at = NULL WHERE id = ?").run(next, user.id, next, t.id);
        const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(t.client_id);
        if (c?.email && c.active) await sendMail({ to: c.email, subject: `Re: ${t.subject} [Support #${t.id}]`,
          text: `Guten Tag ${c.name},\n\n${body}\n\n${next === "geloest" ? "Wir haben die Anfrage als gelöst markiert. Falls doch noch etwas ist, antworten Sie einfach im Kundenportal – dann öffnet sie sich wieder.\n\n" : ""}Antworten und den ganzen Verlauf finden Sie im Kundenportal: ${SITE_URL}/portal/#support/${t.id}\n\nViele Grüße\n${user.name}` }).catch(e => console.warn(e.message));
      }
      onChange(); return json(res, 200, byId(t.id));
    }
    if (mm[2] === "task" && m === "POST") {
      if (!t.project_id) return json(res, 400, { error: "Bitte die Anfrage zuerst einem Projekt zuordnen." });
      if (t.task_id && db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(t.task_id)) return json(res, 200, { task_id: t.task_id, existed: true });
      const first = db.prepare("SELECT body FROM ticket_messages WHERE ticket_id = ? AND author_kind = 'client' ORDER BY id LIMIT 1").get(t.id)?.body || "";
      const tid = db.prepare("INSERT INTO tasks(project_id, title, description, priority, assignee_id, due_date, source, source_id, created_by) VALUES(?,?,?,?,?,?,'support',?,?)")
        .run(t.project_id, `${t.category === "fehler" ? "Fehler" : t.category === "wunsch" ? "Wunsch" : "Support"}: ${t.subject}`.slice(0, 200), `Support #${t.id} von ${t.client_name} (${t.company})\n\n${first}`.slice(0, 4000),
          t.priority === "normal" ? "normal" : "hoch", t.assignee_id || user.id, t.priority === "kritisch" ? new Date().toISOString().slice(0, 10) : null, t.id, user.name).lastInsertRowid;
      db.prepare("UPDATE tickets SET task_id = ? WHERE id = ?").run(tid, t.id); addMsg(t.id, "system", user.name, "Als Aufgabe übernommen", 1);
      return json(res, 201, { task_id: tid });
    }
    return json(res, 404, { error: "Nicht gefunden" });
  }

  /** Automatik: Fristen-Vorschläge, Erinnerung bei „wartet auf Kunde“, automatisches Schließen gelöster Anfragen */
  async function housekeeping({ nudge, settle, log, logged }) {
    const cfg = supportCfg(), keys = [];
    for (const t of db.prepare(`${sel} WHERE t.status IN ('neu','in_bearbeitung') AND t.first_response_at IS NULL`).all().map(out)) {
      if (t.sla === "ok") continue;
      const k = `support:${t.id}`; keys.push(k);
      nudge({ key: k, kind: "support", ref: t.id, client: t.client_id, project: t.project_id, href: `#support/${t.id}`, action: "openTicket",
        title: `${t.sla === "ueberfaellig" ? "Antwortfrist überschritten" : "Antwort bald fällig"} · ${t.company}`,
        text: `#${t.id} ${t.subject} · ${PRIORITIES[t.priority].split(" –")[0]} · fällig ${new Date(t.due_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" })} Uhr${t.assignee ? " · " + t.assignee : " · noch niemand zuständig"}` });
    }
    settle("support", keys);
    for (const t of db.prepare(`${sel} WHERE t.status = 'wartet' AND t.reminded_at IS NULL`).all()) {
      const lastTeam = db.prepare("SELECT created_at FROM ticket_messages WHERE ticket_id = ? AND author_kind = 'team' AND internal = 0 ORDER BY id DESC LIMIT 1").get(t.id)?.created_at;
      if (!lastTeam || Date.now() - Date.parse(iso(lastTeam)) < cfg.waitReminderDays * 864e5) continue;
      db.prepare("UPDATE tickets SET reminded_at = datetime('now') WHERE id = ?").run(t.id);
      if (log(`support-erinnerung:${t.id}:${lastTeam}`, "nachfassen", t.client_id, `Erinnerung an Kunden zu Support #${t.id}`))
        await sendMail({ to: t.client_email, subject: `Wir warten auf Ihre Rückmeldung [Support #${t.id}]`, text: `Guten Tag ${t.client_name},\n\nzu Ihrer Anfrage „${t.subject}“ brauchen wir noch eine kurze Rückmeldung von Ihnen. Antworten Sie einfach im Kundenportal:\n${SITE_URL}/portal/#support/${t.id}\n\nViele Grüße\nIhr Team der Reeder Software GmbH` }).catch(() => {});
    }
    for (const t of db.prepare("SELECT * FROM tickets WHERE status = 'geloest' AND solved_at < datetime('now', ?)").all(`-${cfg.autoCloseDays} days`)) {
      db.prepare("UPDATE tickets SET status = 'geschlossen', closed_at = datetime('now') WHERE id = ?").run(t.id);
      addMsg(t.id, "system", "System", `Automatisch geschlossen (${cfg.autoCloseDays} Tage nach „Gelöst“ ohne Rückmeldung).`);
      log(`support-zu:${t.id}`, "support", t.client_id, `Support #${t.id} automatisch geschlossen`);
    }
  }

  /** Kennzahlen für Cockpit/KPI/Wochenbericht */
  function stats(from, to) {
    const open = db.prepare("SELECT COUNT(*) n, SUM(priority = 'kritisch') krit FROM tickets WHERE status IN ('neu','in_bearbeitung','wartet')").get();
    const resp = db.prepare(`SELECT COUNT(*) n, AVG((julianday(first_response_at) - julianday(created_at)) * 24) h, SUM(julianday(first_response_at) <= julianday(replace(substr(due_at,1,19),'T',' '))) kept
      FROM tickets WHERE first_response_at IS NOT NULL AND date(created_at) BETWEEN ? AND ?`).get(from, to);
    return { open: open.n, critical: open.krit || 0, created: db.prepare("SELECT COUNT(*) n FROM tickets WHERE date(created_at) BETWEEN ? AND ?").get(from, to).n,
      answered: resp.n, avgResponseH: resp.n ? Math.round(resp.h * 10) / 10 : null, slaKept: resp.n ? Math.round((resp.kept || 0) / resp.n * 100) : null,
      overdue: db.prepare(`${sel} WHERE t.status IN ('neu','in_bearbeitung') AND t.first_response_at IS NULL`).all().map(out).filter(t => t.sla === "ueberfaellig").length };
  }
  const unreadFor = user => { const can = visibleFor(user); return db.prepare(`${sel} WHERE t.status != 'geschlossen'`).all().map(out).filter(can).filter(t => (t.last_client_id || 0) > t.team_seen_id).length; };
  return { portal, admin, housekeeping, stats, unreadFor };
}
