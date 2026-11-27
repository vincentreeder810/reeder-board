// Auftragsliste und Morgenfreigabe (Baustein H5).
// Geklärte Kundenwünsche (Anmerkungen mit genauem Änderungswunsch) werden je Projekt zu einem Auftrag gebündelt.
// Claude Code holt den Auftrag mit dem Stand-Schlüssel ab, setzt ihn um und lädt einen KANDIDATEN hoch.
// Der Kunde sieht den Kandidaten erst, wenn ein Mensch ihn im Board freigibt.
import path from "node:path";
import { db, getSetting } from "./db.mjs";
import { isOwner, canProject } from "./access.mjs";
import { DEFAULT_ASSISTANT } from "./assistant.mjs";
import { pageLabel } from "./stand.mjs";

db.exec(`
CREATE TABLE IF NOT EXISTS build_jobs (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'offen' CHECK (state IN ('offen','abgeholt','kandidat','freigegeben','verworfen','abgebrochen')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT, picked_at TEXT, candidate_id INTEGER,
  decided_at TEXT, decided_by TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS build_jobs_project ON build_jobs(project_id, state);
`);
{
  const ac = db.prepare("PRAGMA table_info(annotations)").all().map(c => c.name);
  if (!ac.includes("job_id")) db.exec("ALTER TABLE annotations ADD COLUMN job_id INTEGER");
}

const LABEL = { fontSize: "Schriftgröße", fontWeight: "Schriftstärke", color: "Textfarbe", backgroundColor: "Hintergrundfarbe", textAlign: "Ausrichtung",
  marginTop: "Abstand oben (margin-top)", marginBottom: "Abstand unten (margin-bottom)", paddingTop: "Innenabstand oben", paddingBottom: "Innenabstand unten", borderRadius: "Eckenradius" };
const KIND_DE = { heading: "Überschrift", text: "Text", link: "Link", button: "Knopf", image: "Bild", block: "Bereich" };
const err = (code, message) => Object.assign(new Error(message), { code });
const OPEN = "('offen','abgeholt','kandidat')";

export function createAuftrag({ json, readJson, clean, stand }) {
  const cutoff = () => ({ ...DEFAULT_ASSISTANT, ...getSetting("assistant", {}) }).cutoff;
  const annRows = where => db.prepare(`SELECT a.*, pr.title proto_title, pr.version proto_version, pr.token proto_token, pr.entry proto_entry,
      t.kind ai_kind, t.status ai_status, t.team_summary ai_summary
    FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id LEFT JOIN assistant_threads t ON t.annotation_id = a.id WHERE ${where} ORDER BY a.id`);
  /** Bereit: offener Kundenwunsch mit genauem Änderungswunsch, kein großer Wunsch, noch in keinem Auftrag */
  const ready = pid => annRows(`pr.project_id = ? AND a.status = 'offen' AND a.change IS NOT NULL AND a.job_id IS NULL AND COALESCE(t.kind, 'klein') = 'klein'`).all(pid);
  /** Für das Team: offene Anmerkungen ohne genauen Wunsch (frei formuliert, mittel) – können bewusst mit in den Auftrag */
  const forTeam = pid => annRows(`pr.project_id = ? AND a.status = 'offen' AND a.job_id IS NULL AND (a.change IS NULL OR t.kind = 'mittel') AND COALESCE(t.kind, '') != 'gross'`).all(pid);
  const itemOut = a => ({ id: a.id, comment: a.comment, page: a.page, author: a.author, author_kind: a.author_kind, change: a.change ? JSON.parse(a.change) : null,
    ai: a.ai_status ? { kind: a.ai_kind, status: a.ai_status, summary: a.ai_summary } : null, proto_version: a.proto_version, created_at: a.created_at, status: a.status });
  const jobOut = j => {
    if (!j) return null;
    const items = annRows("a.job_id = ?").all(j.id).map(itemOut);
    const cand = j.candidate_id ? db.prepare("SELECT * FROM prototypes WHERE id = ?").get(j.candidate_id) : null;
    const live = cand ? stand.latestIn(cand.group_id) : null;
    const pd = r => r && { id: r.id, title: r.title, url: `/p/${r.token}/${r.entry}`, base: `/p/${r.token}/`, entry: r.entry, version: r.version, created_at: r.created_at, changes: r.changes, state: r.state };
    let tests = null;
    try { if (cand) { const r = db.prepare("SELECT * FROM test_runs WHERE prototype_id = ? ORDER BY id DESC LIMIT 1").get(cand.id);
      if (r) tests = { state: r.state, kind: r.kind, checks: db.prepare("SELECT COALESCE(SUM(checks),0) n FROM test_runs WHERE prototype_id = ? AND state = 'fertig'").get(cand.id).n,
        open: db.prepare("SELECT severity, COUNT(*) n FROM test_findings WHERE project_id = ? AND group_id = ? AND status = 'offen' GROUP BY severity").all(j.project_id, cand.group_id),
        fixed: db.prepare("SELECT COUNT(*) n FROM test_findings f JOIN test_runs r ON r.id = f.fixed_run WHERE r.prototype_id = ?").get(cand.id).n,
        newFound: db.prepare("SELECT COALESCE(SUM(new_found),0) n FROM test_runs WHERE prototype_id = ? AND state = 'fertig'").get(cand.id).n }; } } catch {}
    return { ...j, items, candidate: pd(cand), live: pd(live), tests };
  };
  const openJob = pid => db.prepare(`SELECT * FROM build_jobs WHERE project_id = ? AND state IN ${OPEN} ORDER BY id DESC LIMIT 1`).get(pid);

  /** Text des Auftrags für Claude Code (Markdown) */
  function markdown(j, p) {
    const items = annRows("a.job_id = ?").all(j.id), base = p.stand_group ? stand.latestIn(p.stand_group) : null;
    const lines = [`# Auftrag #${j.id} – ${p.title}`, "",
      `Erstellt ${new Date(j.created_at.replace(" ", "T") + "Z").toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · ${items.length} Änderung${items.length === 1 ? "" : "en"}${base ? ` · Grundlage: veröffentlichte Version ${base.version}` : ""}`, "",
      "## Regeln", "- Setze genau diese Änderungen im Quellcode des Projekts um – nichts anderes umbauen, keine anderen Seiten anfassen.",
      "- Die Selektoren beziehen sich auf die gebaute Seite im Entwurf; finde im Quellcode die passende Stelle (Komponente, CSS-Klasse).",
      "- Ist ein Punkt unklar oder würde er etwas anderes beschädigen: überspringen und in --text begründen.",
      "- Danach die Website bauen und den Kandidaten hochladen (der Kunde sieht ihn erst nach der Freigabe im Board):",
      "", "```", `node "${path.resolve("server", "stand-cli.mjs")}" --kandidat ${j.id} --text "<kurz, für den Kunden: was umgesetzt wurde>"`, "```", ""];
    items.forEach((a, i) => {
      const c = a.change ? JSON.parse(a.change) : null;
      lines.push(`## ${i + 1}. ${pageLabel(a.page || "index.html")} (${a.page}) – ${c ? `${KIND_DE[c.target.kind] || "Element"}${c.target.text ? ` „${c.target.text.slice(0, 80)}“` : ""} (<${c.target.tag}>)` : "freier Wunsch"}`);
      if (c) {
        lines.push(`- Selektor im Entwurf: \`${c.target.sel}\``);
        for (const [k, v] of Object.entries(c.css || {})) lines.push(`- ${LABEL[k] || k} (\`${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}\`): ${c.before?.[k] ? `${c.before[k]} → ` : ""}**${v}**`);
        if (c.text) lines.push(`- Neuer Text: „${c.text}“`, `  (bisher: „${c.textBefore || c.target.text}“)`);
      }
      if (a.ai_summary) lines.push(`- Zusammenfassung: ${a.ai_summary}`);
      lines.push(`- Kundenkommentar: „${a.comment || "(nur Zeichnung)"}“`, `- Anmerkung #${a.id}${a.ai_kind === "mittel" ? " · vom Team als mittlerer Wunsch freigegeben" : ""}`, "");
    });
    return lines.join("\n");
  }

  function createJob(p, ids, by) {
    const allowed = new Set([...ready(p.id), ...forTeam(p.id)].map(a => a.id));
    const pick = (ids?.length ? ids : ready(p.id).map(a => a.id)).filter(id => allowed.has(+id));
    if (!pick.length) throw err(400, "Es gibt keine Wünsche für einen Auftrag.");
    if (openJob(p.id)) throw err(409, "Für dieses Projekt läuft schon ein Auftrag – erst freigeben, zurückweisen oder abbrechen.");
    const r = db.prepare("INSERT INTO build_jobs(project_id, created_by) VALUES(?, ?)").run(p.id, by);
    const set = db.prepare("UPDATE annotations SET job_id = ? WHERE id = ?"); for (const id of pick) set.run(r.lastInsertRowid, +id);
    return db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(r.lastInsertRowid);
  }
  const release = jid => db.prepare("UPDATE annotations SET job_id = NULL WHERE job_id = ?").run(jid);

  // Verbindung zum Stand-Modul: Kandidat hochgeladen / Auftrag per Schlüssel abholen
  stand.hooks({
    onCandidate: (jid, protoId) => db.prepare("UPDATE build_jobs SET state = 'kandidat', candidate_id = ? WHERE id = ?").run(protoId, jid),
    getJob: async (p, create) => {
      let j = openJob(p.id);
      if (!j && create && ready(p.id).length) j = createJob(p, null, "Claude Code");
      if (!j) return { job: null, message: "Kein offener Auftrag – es gibt gerade keine geklärten Kundenwünsche." };
      if (j.state === "offen") db.prepare("UPDATE build_jobs SET state = 'abgeholt', picked_at = datetime('now') WHERE id = ?").run(j.id);
      j = db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(j.id);
      return { job: { id: j.id, state: j.state, items: annRows("a.job_id = ?").all(j.id).length }, markdown: markdown(j, p) };
    },
  });

  /** Board: /projects/:id/auftrag[...] und /auftrag/:id/... */
  async function admin(req, res, p, m, user) {
    let mm = p.match(/^\/projects\/(\d+)\/auftrag$/);
    if (mm) {
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr || !canProject(user, pr.id)) return json(res, 404, { error: "Nicht gefunden" });
      if (m === "GET") return json(res, 200, { ready: ready(pr.id).map(itemOut), forTeam: forTeam(pr.id).map(itemOut), job: jobOut(openJob(pr.id)), cutoff: cutoff(),
        history: db.prepare("SELECT * FROM build_jobs WHERE project_id = ? AND state NOT IN ('offen','abgeholt','kandidat') ORDER BY id DESC LIMIT 5").all(pr.id).map(j => ({ ...j, items: db.prepare("SELECT COUNT(*) n FROM annotations WHERE job_id = ?").get(j.id).n })) });
      if (m === "POST") { const d = await readJson(req); const j = createJob(pr, Array.isArray(d.ids) ? d.ids : null, user.name); return json(res, 201, jobOut(j)); }
    }
    mm = p.match(/^\/auftrag\/(\d+)(?:\/(text|freigeben|zurueckweisen|abbrechen))?$/); if (!mm) return null;
    const j = db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(+mm[1]);
    if (!j || !canProject(user, j.project_id)) return json(res, 404, { error: "Nicht gefunden" });
    const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(j.project_id);
    if (!mm[2] && m === "GET") return json(res, 200, jobOut(j));
    if (mm[2] === "text" && m === "GET") return json(res, 200, { markdown: markdown(j, pr) });
    if (m !== "POST") return json(res, 405, { error: "Nicht erlaubt" });
    const d = await readJson(req);
    if (mm[2] === "abbrechen") {
      if (!["offen", "abgeholt"].includes(j.state)) return json(res, 409, { error: "Nur offene Aufträge lassen sich abbrechen." });
      release(j.id); db.prepare("UPDATE build_jobs SET state = 'abgebrochen', decided_at = datetime('now'), decided_by = ? WHERE id = ?").run(user.name, j.id);
      return json(res, 200, { ok: true });
    }
    if (j.state !== "kandidat") return json(res, 409, { error: "Es liegt noch kein Kandidat vor." });
    const cand = db.prepare("SELECT * FROM prototypes WHERE id = ? AND state = 'kandidat'").get(j.candidate_id);
    if (!cand) return json(res, 409, { error: "Der Kandidat ist nicht mehr vorhanden." });
    if (mm[2] === "zurueckweisen") {
      await stand.discardCandidate(cand);
      db.prepare("UPDATE build_jobs SET state = 'abgeholt', candidate_id = NULL, note = ? WHERE id = ?").run(clean(d.note, 1000) || null, j.id);   // Auftrag bleibt offen – neuer Kandidat möglich
      return json(res, 200, jobOut(db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(j.id)));
    }
    if (mm[2] === "freigeben") {
      const items = annRows("a.job_id = ?").all(j.id), done = new Set((Array.isArray(d.done) ? d.done : items.map(a => a.id)).map(Number));
      const ok = items.filter(a => done.has(a.id));
      const text = clean(d.text, 3000) || `${ok.length} Ihrer Anmerkung${ok.length === 1 ? "" : "en"} umgesetzt` + (ok.length ? ": " + ok.slice(0, 5).map(a => (a.comment || "").slice(0, 60)).join(" · ") : "");
      stand.releaseCandidate(cand, { text, announce: d.announce !== false, mail: d.mail === undefined ? undefined : d.mail !== false, erinnern: d.erinnern === true, author: user.name });
      const now = new Date().toISOString();
      for (const a of items) {
        if (done.has(a.id)) db.prepare("UPDATE annotations SET status = 'erledigt', done_at = ?, reply = COALESCE(NULLIF(reply, ''), ?) WHERE id = ?").run(now, `Umgesetzt in Version ${cand.version}.`, a.id);
        else db.prepare("UPDATE annotations SET job_id = NULL WHERE id = ?").run(a.id);         // nicht geschafft → zurück in die Liste
      }
      db.prepare("UPDATE build_jobs SET state = 'freigegeben', decided_at = datetime('now'), decided_by = ?, note = ? WHERE id = ?").run(user.name, clean(d.note, 1000) || null, j.id);
      return json(res, 200, { ok: true, version: cand.version, done: ok.length, back: items.length - ok.length });
    }
    return json(res, 404, { error: "Unbekannt" });
  }

  /** Automatik: zum Annahmeschluss Aufträge bündeln; Hinweis, wenn ein Kandidat auf Freigabe wartet */
  async function automation({ nudge, settle, log, logged }) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const hour = +parts.hour % 24, day = `${parts.year}-${parts.month}-${parts.day}`;
    if (hour >= cutoff()) {
      for (const p of db.prepare("SELECT * FROM projects WHERE status = 'aktiv' AND (source_dir IS NOT NULL OR stand_key_hash IS NOT NULL)").all()) {
        const key = `auftrag:${p.id}:${day}`;
        if (logged(key) || openJob(p.id) || !ready(p.id).length) continue;
        const j = createJob(p, null, "Automatik");
        log(key, "auftrag", p.client_id, `Auftrag #${j.id} für „${p.title}“ gebündelt (${db.prepare("SELECT COUNT(*) n FROM annotations WHERE job_id = ?").get(j.id).n} Wünsche)`);
      }
    }
    const keys = [];
    for (const j of db.prepare("SELECT j.*, p.title, p.client_id, c.company FROM build_jobs j JOIN projects p ON p.id = j.project_id JOIN clients c ON c.id = p.client_id WHERE j.state = 'kandidat'").all()) {
      const k = `stand:${j.id}`; keys.push(k);
      const n = db.prepare("SELECT COUNT(*) n FROM annotations WHERE job_id = ?").get(j.id).n;
      nudge({ key: k, kind: "stand", ref: j.id, client: j.client_id, project: j.project_id, href: `#projekte/${j.project_id}`, action: "open",
        title: `Neuer Stand zur Freigabe · ${j.company}`, text: `${j.title}: Auftrag #${j.id} mit ${n} Änderung${n === 1 ? "" : "en"} ist umgesetzt – bitte ansehen und freigeben. Der Kunde sieht ihn erst danach.` });
    }
    settle("stand", keys);
  }

  return { admin, automation };
}
