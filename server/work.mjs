// Aufgaben & Zeiterfassung: Aufgaben je Projekt (auch aus Kunden-Anmerkungen und Termin-„Nächsten Schritten“),
// Stoppuhr pro Person, Zeiteinträge, „Mein Arbeitsplatz“ und Auswertung für Inhaber.
// Sichtbarkeit: Entwickler sehen eigene Zeiteinträge und die Projektsumme; Inhaber sehen alles inkl. Stundensatz.
import { db } from "./db.mjs";
import { isOwner, memberProjectIds, canProject } from "./access.mjs";

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('niedrig','normal','hoch')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, due_date TEXT, estimate_min INTEGER,
  source TEXT, source_id INTEGER, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT, done_by TEXT
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id, status);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK (minutes > 0), note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS time_user_date ON time_entries(user_id, date);
CREATE INDEX IF NOT EXISTS time_project ON time_entries(project_id);
CREATE TABLE IF NOT EXISTS timers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, task_id INTEGER, note TEXT, started_at TEXT NOT NULL
);
`);

const TZ = "Europe/Berlin";
const berlinDay = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monday = d => { const w = new Date(d + "T12:00:00Z").getUTCDay() || 7; return addDays(d, 1 - w); };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
/** „1:30“, „1,5“, „90“ (Minuten), „1h 15m“ → Minuten */
export function parseMinutes(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{1,2})$/); if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m(?:in)?)?$/); if (m && (m[1] || m[2])) return Math.round(Number((m[1] || "0").replace(",", ".")) * 60) + +(m[2] || 0);
  m = s.match(/^(\d+[.,]\d+)$/); if (m) return Math.round(Number(m[1].replace(",", ".")) * 60);
  m = s.match(/^\d+$/); if (m) return +s <= 12 ? +s * 60 : +s;   // „2“ = 2 Stunden, „45“ = 45 Minuten
  return null;
}

export function createWork({ json, readJson, clean, logEvent }) {
  const PRIOS = ["niedrig", "normal", "hoch"], STATES = ["offen", "in_arbeit", "erledigt"];
  const taskSel = `SELECT t.*, u.name assignee, p.title project_title, p.client_id, c.company,
    (SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE task_id = t.id) spent FROM tasks t JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = t.assignee_id`;
  const taskById = id => db.prepare(`${taskSel} WHERE t.id = ?`).get(id);
  const projAllowed = (user, pid) => pid && canProject(user, pid);
  const timerOut = uid => { const t = db.prepare("SELECT tm.*, p.title project_title, k.title task_title FROM timers tm LEFT JOIN projects p ON p.id = tm.project_id LEFT JOIN tasks k ON k.id = tm.task_id WHERE tm.user_id = ?").get(uid);
    return t ? { ...t, running_min: Math.max(0, Math.round((Date.now() - Date.parse(t.started_at)) / 60000)) } : null; };

  function readTask(d, cur = {}) {
    return { title: d.title !== undefined ? clean(d.title, 200) : cur.title, description: d.description !== undefined ? clean(d.description, 4000) : cur.description ?? null,
      status: STATES.includes(d.status) ? d.status : cur.status || "offen", priority: PRIOS.includes(d.priority) ? d.priority : cur.priority || "normal",
      assignee_id: d.assignee_id !== undefined ? (+d.assignee_id || null) : cur.assignee_id ?? null, due_date: d.due_date !== undefined ? ymd(d.due_date) : cur.due_date ?? null,
      estimate_min: d.estimate !== undefined ? parseMinutes(d.estimate) : cur.estimate_min ?? null };
  }
  const insertTask = (pid, o, user, source = "manuell", sourceId = null) => db.prepare(`INSERT INTO tasks(project_id, title, description, status, priority, assignee_id, due_date, estimate_min, source, source_id, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, o.title, o.description, o.status, o.priority, o.assignee_id, o.due_date, o.estimate_min, source, sourceId, user.name).lastInsertRowid;
  // Eine erledigte Aufgabe aus einer Kunden-Anmerkung erledigt auch die Anmerkung (der Kunde sieht den Haken im Portal)
  function afterDone(t, user) {
    if (t.source === "anmerkung" && t.source_id) db.prepare("UPDATE annotations SET status = 'erledigt', done_at = COALESCE(done_at, ?) WHERE id = ? AND status = 'offen'").run(new Date().toISOString(), t.source_id);
  }

  function stopTimer(user) {
    const t = db.prepare("SELECT * FROM timers WHERE user_id = ?").get(user.id); if (!t) return null;
    db.prepare("DELETE FROM timers WHERE user_id = ?").run(user.id);
    let min = Math.round((Date.now() - Date.parse(t.started_at)) / 60000);
    if (min < 1) return { discarded: true };
    const capped = min > 12 * 60; if (capped) min = 12 * 60;
    const id = db.prepare("INSERT INTO time_entries(user_id, project_id, task_id, date, minutes, note) VALUES(?,?,?,?,?,?)")
      .run(user.id, t.project_id, t.task_id, berlinDay(new Date(t.started_at)), min, (t.note || "") + (capped ? " (Stoppuhr lief über 12 Std. – bitte prüfen)" : "")).lastInsertRowid;
    return { id, minutes: min, capped };
  }

  function workplace(user) {
    const owner = isOwner(user), today = berlinDay(), mon = monday(today), pids = memberProjectIds(user);
    const myProjects = db.prepare(`SELECT p.id, p.title, p.phase, p.client_id, c.company,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'erledigt') open_tasks,
        (SELECT COUNT(*) FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE pr.project_id = p.id AND a.status = 'offen') open_notes,
        (SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE project_id = p.id AND user_id = ? AND date >= ?) my_week
      FROM projects p JOIN clients c ON c.id = p.client_id JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? WHERE p.status = 'aktiv' ORDER BY p.updated_at DESC`).all(user.id, mon, user.id);
    const tasks = db.prepare(`${taskSel} WHERE t.status != 'erledigt' AND (t.assignee_id = ? OR (t.assignee_id IS NULL AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)))
      ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id`).all(user.id, user.id);
    const doneToday = db.prepare("SELECT COUNT(*) n FROM tasks WHERE assignee_id = ? AND status = 'erledigt' AND date(done_at) = ?").get(user.id, today).n;
    const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, i); return { date: d, minutes: db.prepare("SELECT COALESCE(SUM(minutes),0) s FROM time_entries WHERE user_id = ? AND date = ?").get(user.id, d).s }; });
    const entries = db.prepare(`SELECT e.*, p.title project_title, t.title task_title FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.user_id = ? AND e.date >= ? ORDER BY e.date DESC, e.id DESC LIMIT 40`).all(user.id, addDays(today, -13));
    const apptPids = owner ? null : pids;
    const appts = db.prepare(`SELECT a.id, a.title, a.start, a.minutes, a.project_id, a.client_id, a.video_url, c.company FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE a.start >= ? AND a.start < ? ORDER BY a.start`).all(new Date().toISOString(), new Date(Date.now() + 7 * 864e5).toISOString())
      .filter(a => !apptPids || apptPids.includes(a.project_id) || myProjects.some(p => p.client_id === a.client_id));
    const out = { today, monday: mon, timer: timerOut(user.id), tasks, doneToday, days, week: days.reduce((s, d) => s + d.minutes, 0), entries, projects: myProjects, appointments: appts };
    if (owner) {
      out.team = db.prepare(`SELECT u.id, u.name, u.role, (SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE user_id = u.id AND date >= ?) week,
          (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status != 'erledigt') open, (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status != 'erledigt' AND due_date < ?) overdue,
          (SELECT p.title FROM timers tm LEFT JOIN projects p ON p.id = tm.project_id WHERE tm.user_id = u.id) timer_project, (SELECT started_at FROM timers WHERE user_id = u.id) timer_since
        FROM users u WHERE u.active = 1 AND u.invite_token IS NULL ORDER BY u.role DESC, u.name`).all(mon, today);
      out.unassigned = db.prepare(`${taskSel} WHERE t.status != 'erledigt' AND t.assignee_id IS NULL ORDER BY t.due_date IS NULL, t.due_date LIMIT 20`).all();
    }
    return out;
  }

  function projectTime(user, pid) {
    const owner = isOwner(user);
    const total = db.prepare("SELECT COALESCE(SUM(minutes),0) s FROM time_entries WHERE project_id = ?").get(pid).s;
    const byUser = db.prepare("SELECT u.id, u.name, COALESCE(SUM(e.minutes),0) minutes FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.project_id = ? GROUP BY u.id ORDER BY minutes DESC").all(pid);
    const est = db.prepare("SELECT COALESCE(SUM(estimate_min),0) s FROM tasks WHERE project_id = ?").get(pid).s;
    const p0 = db.prepare("SELECT offer_net, phase, status FROM projects WHERE id = ?").get(pid);
    // Stundensatz erst aussagekräftig, wenn der Großteil der Arbeit getan ist
    const p = p0 && (["Launch", "Betreuung"].includes(p0.phase) || p0.status === "abgeschlossen") ? p0 : null;
    const entries = db.prepare(`SELECT e.*, u.name user_name, t.title task_title FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.project_id = ? ${owner ? "" : "AND e.user_id = " + Number(user.id)} ORDER BY e.date DESC, e.id DESC LIMIT 60`).all(pid);
    return { total, estimate: est, mine: byUser.find(x => x.id === user.id)?.minutes || 0, byUser: owner ? byUser : undefined, entries, timer: timerOut(user.id),
      rate: owner && p?.offer_net && total ? Math.round(p.offer_net / (total / 60)) : undefined };
  }

  /* ================= API ================= */
  async function api(req, res, url, p, m, user) {
    const owner = isOwner(user);
    if (p === "/arbeitsplatz" && m === "GET") return json(res, 200, workplace(user));

    let mm = p.match(/^\/projects\/(\d+)\/(tasks|time)$/);
    if (mm) {
      const pid = +mm[1]; if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(pid)) return json(res, 404, { error: "Projekt nicht gefunden" });
      if (mm[2] === "tasks" && m === "GET") return json(res, 200, db.prepare(`${taskSel} WHERE t.project_id = ? ORDER BY t.status = 'erledigt', t.status != 'in_arbeit', t.due_date IS NULL, t.due_date, t.id DESC`).all(pid));
      if (mm[2] === "tasks" && m === "POST") {
        const d = await readJson(req), o = readTask(d); if (!o.title) return json(res, 400, { error: "Bitte einen Titel angeben." });
        if (d.assignee_id === undefined) o.assignee_id = user.id;   // ohne Angabe: wer anlegt, ist zuständig
        if (!owner && o.assignee_id && o.assignee_id !== user.id && !db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(pid, o.assignee_id)) o.assignee_id = user.id;
        return json(res, 201, taskById(insertTask(pid, o, user)));
      }
      if (mm[2] === "time" && m === "GET") return json(res, 200, projectTime(user, pid));
    }
    mm = p.match(/^\/tasks\/(\d+)$/);
    if (mm) {
      const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(+mm[1]); if (!t) return json(res, 404, { error: "Aufgabe nicht gefunden" });
      if (m === "PATCH") {
        const o = readTask(await readJson(req), t); if (!o.title) return json(res, 400, { error: "Bitte einen Titel angeben." });
        const done = o.status === "erledigt" && t.status !== "erledigt";
        db.prepare("UPDATE tasks SET title=?, description=?, status=?, priority=?, assignee_id=?, due_date=?, estimate_min=?, done_at=?, done_by=? WHERE id=?")
          .run(o.title, o.description, o.status, o.priority, o.assignee_id, o.due_date, o.estimate_min, o.status === "erledigt" ? (t.done_at || new Date().toISOString()) : null, o.status === "erledigt" ? (t.done_by || user.name) : null, t.id);
        if (done) afterDone(t, user);
        return json(res, 200, taskById(t.id));
      }
      if (m === "DELETE") {
        if (!owner && t.created_by !== user.name) return json(res, 403, { error: "Nur eigene Aufgaben können gelöscht werden." });
        db.prepare("DELETE FROM tasks WHERE id = ?").run(t.id); return json(res, 200, { ok: true });
      }
    }
    // Kunden-Anmerkung → Aufgabe
    mm = p.match(/^\/annotations\/(\d+)\/task$/);
    if (mm && m === "POST") {
      const a = db.prepare("SELECT a.*, pr.project_id, pr.title proto_title, pr.version FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE a.id = ?").get(+mm[1]);
      if (!a?.project_id) return json(res, 400, { error: "Die Anmerkung gehört zu keinem Projekt." });
      const ex = db.prepare("SELECT id FROM tasks WHERE source = 'anmerkung' AND source_id = ?").get(a.id); if (ex) return json(res, 200, { ...taskById(ex.id), existed: true });
      const d = await readJson(req);
      const title = clean(d.title, 200) || (a.comment ? a.comment.split("\n")[0].slice(0, 120) : `Zeichnung auf ${a.page || "Startseite"}`);
      const id = insertTask(a.project_id, readTask({ title, description: `Anmerkung von ${a.author} an ${a.proto_title} V${a.version} · ${a.page || "Startseite"}${a.comment ? "\n\n" + a.comment : ""}`, assignee_id: d.assignee_id ?? user.id, priority: d.priority }), user, "anmerkung", a.id);
      return json(res, 201, taskById(id));
    }
    // „Nächste Schritte“ eines Termins → Aufgaben (eine je Zeile)
    mm = p.match(/^\/appointments\/(\d+)\/tasks$/);
    if (mm && m === "POST") {
      const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(+mm[1]);
      if (!a?.project_id) return json(res, 400, { error: "Bitte den Termin zuerst einem Projekt zuordnen." });
      const lines = String(a.next_steps || "").split(/\n+/).map(l => l.replace(/^\s*([-•*–]|\d+[.)])\s*/, "").trim()).filter(l => l.length > 2);
      if (!lines.length) return json(res, 400, { error: "Bei diesem Termin sind keine nächsten Schritte eingetragen." });
      const have = new Set(db.prepare("SELECT title FROM tasks WHERE source = 'termin' AND source_id = ?").all(a.id).map(r => r.title));
      const ids = lines.filter(l => !have.has(l.slice(0, 200))).map(l => insertTask(a.project_id, readTask({ title: l, description: `Aus dem Termin „${a.title}“` }), user, "termin", a.id));
      return json(res, 201, { created: ids.length, skipped: lines.length - ids.length });
    }
    // Stoppuhr
    if (p === "/timer" && m === "POST") {
      const d = await readJson(req), pid = +d.project_id || null;
      if (pid && !projAllowed(user, pid)) return json(res, 403, { error: "Kein Zugriff auf dieses Projekt." });
      const task = +d.task_id ? db.prepare("SELECT id, project_id FROM tasks WHERE id = ?").get(+d.task_id) : null;
      const stopped = stopTimer(user);
      db.prepare("INSERT INTO timers(user_id, project_id, task_id, note, started_at) VALUES(?,?,?,?,?)").run(user.id, task?.project_id || pid, task?.id || null, clean(d.note, 300), new Date().toISOString());
      if (task) db.prepare("UPDATE tasks SET status = 'in_arbeit' WHERE id = ? AND status = 'offen'").run(task.id);
      return json(res, 200, { timer: timerOut(user.id), stopped });
    }
    if (p === "/timer" && m === "DELETE") { const r = stopTimer(user); return json(res, 200, { stopped: r }); }
    // Zeiteinträge
    if (p === "/time" && m === "POST") {
      const d = await readJson(req), min = parseMinutes(d.duration ?? d.minutes), pid = +d.project_id || null;
      if (!min || min > 24 * 60) return json(res, 400, { error: "Bitte die Dauer angeben, z. B. 1:30 oder 45 (Minuten)." });
      if (pid && !projAllowed(user, pid)) return json(res, 403, { error: "Kein Zugriff auf dieses Projekt." });
      const task = +d.task_id ? db.prepare("SELECT id, project_id FROM tasks WHERE id = ?").get(+d.task_id) : null;
      const id = db.prepare("INSERT INTO time_entries(user_id, project_id, task_id, date, minutes, note) VALUES(?,?,?,?,?,?)").run(user.id, task?.project_id || pid, task?.id || null, ymd(d.date) || berlinDay(), min, clean(d.note, 300)).lastInsertRowid;
      return json(res, 201, { id, minutes: min });
    }
    mm = p.match(/^\/time\/(\d+)$/);
    if (mm) {
      const e = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(+mm[1]);
      if (!e || (!owner && e.user_id !== user.id)) return json(res, 404, { error: "Eintrag nicht gefunden" });
      if (m === "DELETE") { db.prepare("DELETE FROM time_entries WHERE id = ?").run(e.id); return json(res, 200, { ok: true }); }
      if (m === "PATCH") { const d = await readJson(req), min = d.duration !== undefined ? parseMinutes(d.duration) : e.minutes;
        if (!min) return json(res, 400, { error: "Ungültige Dauer" });
        db.prepare("UPDATE time_entries SET minutes = ?, note = ?, date = ? WHERE id = ?").run(min, d.note !== undefined ? clean(d.note, 300) : e.note, ymd(d.date) || e.date, e.id); return json(res, 200, { ok: true }); }
    }
    // Auswertung (nur Inhaber)
    if (p === "/zeiten" && m === "GET") {
      if (!owner) return json(res, 403, { error: "Nur für Inhaber" });
      const from = ymd(url.searchParams.get("from")) || addDays(berlinDay(), -29), to = ymd(url.searchParams.get("to")) || berlinDay();
      const rows = db.prepare(`SELECT e.*, u.name user_name, p.title project_title, c.company, t.title task_title FROM time_entries e JOIN users u ON u.id = e.user_id
        LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN tasks t ON t.id = e.task_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date, u.name`).all(from, to);
      if (url.searchParams.get("format") === "csv") {
        const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = "﻿" + [["Datum", "Person", "Kunde", "Projekt", "Aufgabe", "Minuten", "Stunden", "Notiz"].map(q).join(";"),
          ...rows.map(r => [r.date.split("-").reverse().join("."), r.user_name, r.company, r.project_title, r.task_title, r.minutes, (r.minutes / 60).toFixed(2).replace(".", ","), r.note].map(q).join(";"))].join("\r\n");
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Zeiten_${from}_${to}.csv"`, "Cache-Control": "no-store" }); return res.end(csv);
      }
      const sum = key => { const o = {}; for (const r of rows) { const k = r[key] || "ohne Projekt"; o[k] = (o[k] || 0) + r.minutes; } return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })); };
      return json(res, 200, { from, to, total: rows.reduce((s, r) => s + r.minutes, 0), byUser: sum("user_name"), byProject: sum("project_title"), count: rows.length });
    }
    return null;
  }
  return { api, workplace };
}
