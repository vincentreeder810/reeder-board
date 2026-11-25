// Täglicher Stand (Baustein H1): Ein Projekt wird mit einem Ordner verknüpft (lokal) oder bekommt einen
// Stand-Schlüssel (für Claude Code / nach dem Livegang). Jeder Stand wird mit der Vorversion verglichen –
// nur wenn sich etwas geändert hat, entsteht eine neue Version samt Änderungsliste.
import { readdir, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db.mjs";
import { PROTO_MIME, safeRel } from "./portal.mjs";
import { isOwner, canProject } from "./access.mjs";

const DATA = path.resolve(process.env.DATA_DIR || "data");
const PROTO_DIR = path.join(DATA, "prototypes");
const APP_ROOT = path.resolve(".");
const MAX_FILES = 600, MAX_BYTES = 60 * 1024 * 1024, MAX_WALK = 6000;

{
  const pc = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  for (const [c, t] of [["source_dir", "TEXT"], ["stand_group", "INTEGER"], ["stand_key_hash", "TEXT"], ["stand_key_hint", "TEXT"], ["stand_key_at", "TEXT"], ["stand_key_by", "TEXT"]])
    if (!pc.includes(c)) db.exec(`ALTER TABLE projects ADD COLUMN ${c} ${t}`);
  const rc = db.prepare("PRAGMA table_info(prototypes)").all().map(c => c.name);
  for (const [c, t] of [["manifest", "TEXT"], ["diff", "TEXT"], ["source", "TEXT"], ["state", "TEXT"], ["job_id", "INTEGER"]])
    if (!rc.includes(c)) db.exec(`ALTER TABLE prototypes ADD COLUMN ${c} ${t}`);
}

db.exec(`CREATE TABLE IF NOT EXISTS proto_seen (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, group_id INTEGER NOT NULL,
  version INTEGER NOT NULL, seen_at TEXT NOT NULL, prev_version INTEGER, prev_seen_at TEXT, PRIMARY KEY (client_id, group_id))`);

/** Welche Version hat der Kunde zuletzt geöffnet? (für Board und Portal) */
export function seenOf(clientId, groupId) {
  return db.prepare("SELECT version, seen_at FROM proto_seen WHERE client_id = ? AND group_id = ?").get(clientId, groupId) || null;
}

const err = (code, message) => Object.assign(new Error(message), { code });
const sha = buf => createHash("sha256").update(buf).digest("hex");
const inside = (child, parent) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

/** Alle erlaubten Dateien eines Ordners (ohne versteckte Dateien, node_modules usw.) */
export async function readFolder(dir) {
  const files = []; let bytes = 0, seen = 0;
  async function walk(abs, rel) {
    let entries; try { entries = await readdir(abs, { withFileTypes: true }); } catch { throw err(400, `Ordner nicht lesbar: ${abs}`); }
    for (const e of entries) {
      if (++seen > MAX_WALK) throw err(400, "Der Ordner enthält zu viele Einträge. Bitte den Ausgabe-Ordner der Website wählen (z. B. „dist“ oder „public“).");
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__MACOSX") continue;
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) { await walk(path.join(abs, e.name), r); continue; }
      if (!e.isFile() || !PROTO_MIME[path.extname(e.name).toLowerCase()] || !safeRel(r)) continue;
      const buf = await readFile(path.join(abs, e.name));
      bytes += buf.length;
      if (files.length >= MAX_FILES) throw err(400, `Höchstens ${MAX_FILES} Dateien je Stand.`);
      if (bytes > MAX_BYTES) throw err(400, "Zusammen größer als 60 MB – bitte Bilder verkleinern oder nur den Ausgabe-Ordner wählen.");
      files.push({ path: r, buf });
    }
  }
  await walk(dir, "");
  return files;
}

const manifestOf = files => Object.fromEntries(files.map(f => [f.path, sha(f.buf)]).sort(([a], [b]) => a.localeCompare(b)));
async function manifestOfVersion(pr) {
  if (pr.manifest) { try { return JSON.parse(pr.manifest); } catch {} }
  try { const m = manifestOf(await readFolder(path.join(PROTO_DIR, pr.token))); db.prepare("UPDATE prototypes SET manifest = ? WHERE id = ?").run(JSON.stringify(m), pr.id); return m; }
  catch { return {}; }
}
export function diffOf(prev, next) {
  const added = [], changed = [], removed = [];
  for (const [p, h] of Object.entries(next)) { if (!(p in prev)) added.push(p); else if (prev[p] !== h) changed.push(p); }
  for (const p of Object.keys(prev)) if (!(p in next)) removed.push(p);
  return { added, changed, removed };
}
const isPage = p => /\.html?$/i.test(p);
/** „index.html“ → „Startseite“, „leistungen/index.html“ → „Leistungen“, „kontakt.html“ → „Kontakt“ */
export function pageLabel(p) {
  const parts = p.replace(/\.html?$/i, "").split("/");
  let n = parts.pop(); if (n === "index") n = parts.pop() || "Startseite";
  return n === "Startseite" ? n : n.replace(/[-_]+/g, " ").replace(/^\w|\s\w/g, c => c.toUpperCase());
}
export function describe(d) {
  const pages = k => d[k].filter(isPage).map(pageLabel), other = d.added.length + d.changed.length + d.removed.length - pages("added").length - pages("changed").length - pages("removed").length;
  const list = a => a.length > 4 ? a.slice(0, 4).join(", ") + ` und ${a.length - 4} weitere` : a.join(", ");
  const out = [];
  const ch = pages("changed"), ad = pages("added"), rm = pages("removed");
  if (ch.length) out.push(`${ch.length === 1 ? "Seite" : ch.length + " Seiten"} überarbeitet: ${list(ch)}`);
  if (ad.length) out.push(`${ad.length === 1 ? "Neue Seite" : ad.length + " neue Seiten"}: ${list(ad)}`);
  if (rm.length) out.push(`${rm.length === 1 ? "Seite" : rm.length + " Seiten"} entfernt: ${list(rm)}`);
  if (other) out.push(`${other} weitere Datei${other === 1 ? "" : "en"} (Bilder, Gestaltung, Skripte) aktualisiert`);
  return out.join(" · ");
}

export function createStand({ json, readJson, clean, limited, ipOf, logEvent }) {
  const project = id => db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  // Neueste veröffentlichte Version (Kandidaten und verworfene Kandidaten zählen nicht)
  const latestIn = groupId => groupId ? db.prepare("SELECT * FROM prototypes WHERE group_id = ? AND state IS NULL ORDER BY version DESC LIMIT 1").get(groupId) : null;
  const pendingIn = groupId => groupId ? db.prepare("SELECT * FROM prototypes WHERE group_id = ? AND state = 'kandidat' ORDER BY id DESC LIMIT 1").get(groupId) : null;
  function targetGroup(p) {
    if (p.stand_group && latestIn(p.stand_group)) return p.stand_group;
    const groups = db.prepare("SELECT DISTINCT COALESCE(group_id, id) g FROM prototypes WHERE project_id = ?").all(p.id);
    return groups.length === 1 ? groups[0].g : null;                 // mehrere Entwürfe → eigener Strang „Aktueller Stand“
  }
  async function checkDir(dir) {
    const abs = path.resolve(String(dir || ""));
    if (!path.isAbsolute(String(dir || "")) || !dir) throw err(400, "Bitte den vollständigen Pfad angeben, z. B. C:\\Projekte\\cafe-mueller\\dist");
    if (path.parse(abs).root === abs) throw err(400, "Bitte nicht ein ganzes Laufwerk, sondern den Ordner der Website wählen.");
    if (inside(abs, DATA) || inside(abs, APP_ROOT) || inside(APP_ROOT, abs)) throw err(400, "Dieser Ordner gehört zum Board selbst und kann nicht veröffentlicht werden.");
    let st; try { st = await stat(abs); } catch { throw err(400, `Ordner nicht gefunden: ${abs}`); }
    if (!st.isDirectory()) throw err(400, "Das ist eine Datei, kein Ordner.");
    return abs;
  }

  /** Kern: Dateien vergleichen und – wenn geändert – als neue Version veröffentlichen */
  async function publish(p, files, { changes = "", announce = true, dry = false, source = "ordner", author = "Team Reeder", job = null } = {}) {
    const htmls = files.map(f => f.path).filter(isPage).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    if (!htmls.length) throw err(400, "Keine HTML-Datei gefunden. Ein Stand braucht mindestens eine .html-Datei.");
    const groupId = targetGroup(p), prev = latestIn(groupId), next = manifestOf(files);
    const diff = diffOf(prev ? await manifestOfVersion(prev) : {}, next);
    const count = diff.added.length + diff.changed.length + diff.removed.length;
    const summary = prev ? describe(diff) : `Erster Stand mit ${htmls.length} Seite${htmls.length === 1 ? "" : "n"}`;
    const maxV = groupId ? db.prepare("SELECT MAX(version) v FROM prototypes WHERE group_id = ?").get(groupId).v || 0 : 0;
    const base = { diff, summary, files: files.length, bytes: files.reduce((s, f) => s + f.buf.length, 0), version: Math.max(maxV, prev?.version || 0) + 1, title: prev?.title || p.title };
    const waiting = pendingIn(groupId);
    if (!job && waiting) throw err(409, `Version ${waiting.version} wartet noch auf Freigabe – bitte erst freigeben oder zurückweisen (Projektseite > Auftrag).`);
    if (prev && !count) return { unchanged: true, version: prev.version, summary: `Keine Änderungen seit Version ${prev.version}.` };
    if (dry) return { dry: true, ...base };
    if (job && !groupId) throw err(400, "Für einen Kandidaten muss es schon einen veröffentlichten Stand geben.");
    if (job && waiting) await discardCandidate(waiting);           // neuer Kandidat ersetzt den alten
    const entry = (prev && htmls.includes(prev.entry) && prev.entry) || htmls.find(h => /(^|\/)index\.html?$/i.test(h)) || htmls[0];
    const token = randomBytes(24).toString("hex"), dir = path.join(PROTO_DIR, token);
    for (const f of files) { const t = path.join(dir, f.path); await mkdir(path.dirname(t), { recursive: true }); await writeFile(t, f.buf); }
    const text = clean(changes, 3000) || summary;
    const r = db.prepare("INSERT INTO prototypes(client_id, title, note, token, entry, files, bytes, project_id, group_id, version, changes, manifest, diff, source, active, state, job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(p.client_id, base.title, prev?.note || null, token, entry, files.length, base.bytes, p.id, groupId, base.version, text, JSON.stringify(next), JSON.stringify(diff), source, job ? 0 : 1, job ? "kandidat" : null, job || null);
    for (const f of listeners) try { f(Number(r.lastInsertRowid), !!job); } catch {}
    if (job) return { candidate: true, id: Number(r.lastInsertRowid), ...base, changes: text };   // Kunde sieht ihn erst nach der Freigabe
    const gid = groupId || r.lastInsertRowid;
    if (!groupId) db.prepare("UPDATE prototypes SET group_id = id WHERE id = ?").run(gid);
    db.prepare("UPDATE projects SET stand_group = ?, updated_at = datetime('now') WHERE id = ?").run(gid, p.id);
    logEvent(p.client_id, p.id, "prototyp", base.version > 1 ? `Neuer Stand: Version ${base.version}` : "Erster Stand veröffentlicht", `${base.title} – ${text}`, announce);
    if (announce) db.prepare("INSERT INTO messages(client_id, sender, author, body, prototype_id) VALUES(?, 'team', ?, ?, ?)")
      .run(p.client_id, author, base.version > 1 ? `Neuer Stand von „${base.title}“ (Version ${base.version}) ist online.\n${text}` : `Der erste Stand von „${base.title}“ ist online. Klicken Sie sich gern durch und markieren Sie, was Ihnen auffällt.`, r.lastInsertRowid);
    return { published: true, id: Number(r.lastInsertRowid), ...base, changes: text };
  }

  async function discardCandidate(c) {
    db.prepare("UPDATE prototypes SET state = 'verworfen', active = 0 WHERE id = ?").run(c.id);
    await rm(path.join(PROTO_DIR, c.token), { recursive: true, force: true });
  }
  /** Kandidat freigeben: wird zur aktuellen Version, Kunde wird benachrichtigt */
  function releaseCandidate(c, { text, announce = true, author = "Team Reeder" }) {
    db.prepare("UPDATE prototypes SET state = NULL, active = 1, changes = ?, created_at = datetime('now') WHERE id = ?").run(text || c.changes, c.id);
    db.prepare("UPDATE projects SET stand_group = ?, updated_at = datetime('now') WHERE id = ?").run(c.group_id, c.project_id);
    logEvent(c.client_id, c.project_id, "prototyp", `Neuer Stand: Version ${c.version}`, `${c.title} – ${text || c.changes}`, announce);
    if (announce) db.prepare("INSERT INTO messages(client_id, sender, author, body, prototype_id) VALUES(?, 'team', ?, ?, ?)")
      .run(c.client_id, author, `Neuer Stand von „${c.title}“ (Version ${c.version}) ist online – geprüft und freigegeben.\n${text || c.changes}`, c.id);
  }
  const keyHash = k => sha(Buffer.from(String(k)));
  function info(p, user) {
    const g = targetGroup(p), last = latestIn(g);
    return { project_id: p.id, source_dir: p.source_dir || "", canEdit: isOwner(user),
      target: last ? { group_id: g, title: last.title, version: last.version, created_at: last.created_at, source: last.source || "upload" } : null,
      key: p.stand_key_hash ? { hint: p.stand_key_hint, at: p.stand_key_at, by: p.stand_key_by } : null };
  }

  /** Admin-API: /projects/:id/stand[/key] */
  async function admin(req, res, p, m, user) {
    if (p === "/stand-cli") return json(res, 200, { path: path.join(APP_ROOT, "server", "stand-cli.mjs") });
    const mm = p.match(/^\/projects\/(\d+)\/stand(\/key)?$/); if (!mm) return null;
    const pr = project(+mm[1]); if (!pr || !canProject(user, pr.id)) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (mm[2]) {
      if (!isOwner(user)) return json(res, 403, { error: "Nur Inhaber können Stand-Schlüssel verwalten." });
      if (m === "POST") {
        const key = `rsk_${pr.id}_${randomBytes(24).toString("hex")}`;
        db.prepare("UPDATE projects SET stand_key_hash = ?, stand_key_hint = ?, stand_key_at = datetime('now'), stand_key_by = ? WHERE id = ?").run(keyHash(key), key.slice(-4), user.name, pr.id);
        return json(res, 201, { ...info(project(pr.id), user), secret: key });
      }
      if (m === "DELETE") { db.prepare("UPDATE projects SET stand_key_hash = NULL, stand_key_hint = NULL, stand_key_at = NULL, stand_key_by = NULL WHERE id = ?").run(pr.id); return json(res, 200, info(project(pr.id), user)); }
    }
    if (m === "GET") {
      const out = info(pr, user);
      if (pr.source_dir) {
        try { const r = await publish(pr, await readFolder(await checkDir(pr.source_dir)), { dry: true }); out.pending = r.unchanged ? { unchanged: true, summary: r.summary } : { summary: r.summary, diff: r.diff, files: r.files, bytes: r.bytes, version: r.version }; }
        catch (e) { if (e.code === 409) out.pending = { waiting: true, summary: e.message }; else out.folderError = e.message; }
      }
      return json(res, 200, out);
    }
    if (m === "PUT") {
      if (!isOwner(user)) return json(res, 403, { error: "Nur Inhaber können den Ordner festlegen." });
      const d = await readJson(req), dir = clean(d.source_dir, 400);
      const abs = dir ? await checkDir(dir) : null;
      if (abs) { const files = await readFolder(abs); if (!files.some(f => isPage(f.path))) throw err(400, "In diesem Ordner liegt keine HTML-Datei."); }
      db.prepare("UPDATE projects SET source_dir = ? WHERE id = ?").run(abs, pr.id);
      return json(res, 200, info(project(pr.id), user));
    }
    if (m === "POST") {
      if (!pr.source_dir) return json(res, 400, { error: "Für dieses Projekt ist noch kein Ordner verknüpft." });
      const d = await readJson(req);
      const job = d.job ? db.prepare("SELECT id FROM build_jobs WHERE id = ? AND project_id = ? AND state IN ('offen','abgeholt','kandidat')").get(+d.job, pr.id)?.id : null;
      if (d.job && !job) return json(res, 400, { error: "Dieser Auftrag ist nicht mehr offen." });
      const r = await publish(pr, await readFolder(await checkDir(pr.source_dir)), { changes: d.changes, announce: d.announce !== false, dry: !!d.dry, source: "ordner", author: user.name, job });
      if (r.candidate) onCandidate?.(job, r.id);
      return json(res, r.published ? 201 : 200, r);
    }
    return json(res, 405, { error: "Nicht erlaubt" });
  }

  /** Öffentlich mit Stand-Schlüssel: POST /api/stand (für das Kommandozeilen-Werkzeug) */
  async function publicRoute(req, res, url) {
    if (req.method !== "POST" && !(req.method === "GET" && url?.pathname === "/api/stand/auftrag")) return json(res, 405, { error: "Nicht erlaubt" });
    if (limited("stand:" + ipOf(req), 60, 3600000)) return json(res, 429, { error: "Zu viele Anfragen – bitte später erneut versuchen." });
    const key = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(), mm = key.match(/^rsk_(\d+)_[a-f0-9]{48}$/);
    const pr = mm ? project(+mm[1]) : null;
    const ok = pr?.stand_key_hash && timingSafeEqual(Buffer.from(pr.stand_key_hash), Buffer.from(keyHash(key)));
    if (!ok) { await new Promise(r => setTimeout(r, 400)); return json(res, 401, { error: "Stand-Schlüssel ungültig oder widerrufen." }); }
    if (pr.status === "abgeschlossen") return json(res, 409, { error: "Das Projekt ist abgeschlossen – keine neuen Stände mehr." });
    if (url?.pathname === "/api/stand/auftrag") return json(res, 200, { project: pr.title, ...(await getJob?.(pr, url.searchParams.get("neu") !== "0")) });
    const d = await readJson(req, Math.ceil(MAX_BYTES * 1.4) + 1e6);
    const list = Array.isArray(d.files) ? d.files : [];
    if (list.length > MAX_FILES) return json(res, 400, { error: `Höchstens ${MAX_FILES} Dateien je Stand.` });
    const files = []; let bytes = 0;
    for (const f of list) {
      const rel = safeRel(f.path); if (!rel || !PROTO_MIME[path.extname(rel).toLowerCase()]) continue;
      const buf = Buffer.from(String(f.data || ""), "base64"); bytes += buf.length;
      if (bytes > MAX_BYTES) return json(res, 400, { error: "Zusammen größer als 60 MB." });
      files.push({ path: rel, buf });
    }
    const job = d.job ? db.prepare("SELECT id FROM build_jobs WHERE id = ? AND project_id = ? AND state IN ('offen','abgeholt','kandidat')").get(+d.job, pr.id)?.id : null;
    if (d.job && !job) return json(res, 400, { error: `Auftrag #${d.job} ist nicht mehr offen (schon freigegeben oder verworfen).` });
    const r = await publish(pr, files, { changes: d.changes, announce: d.announce !== false, dry: !!d.dry, source: "schluessel", author: pr.stand_key_by || "Team Reeder", job });
    if (r.candidate) onCandidate?.(job, r.id);
    return json(res, r.published ? 201 : 200, { project: pr.title, ...r });
  }

  /* ---------- Portal: „Seit Ihrem letzten Besuch“ ---------- */
  const protoData = r => ({ id: r.id, title: r.title, url: `/p/${r.token}/${r.entry}`, base: `/p/${r.token}/`, entry: r.entry, version: r.version, created_at: r.created_at });
  /** Änderungsliste einer Version (gespeichert oder einmalig aus den Dateien berechnet) */
  async function diffFor(r, prevRow) {
    if (r.diff) { try { return JSON.parse(r.diff); } catch {} }
    if (!prevRow) return null;
    const d = diffOf(await manifestOfVersion(prevRow), await manifestOfVersion(r));
    db.prepare("UPDATE prototypes SET diff = ? WHERE id = ?").run(JSON.stringify(d), r.id);
    return d;
  }
  // Echte Zahlen der Prüfstrecke (Baustein H6) seit dem letzten Besuch – nur abgeschlossene Läufe
  function testCounts(pid, since) {
    try {
      const s = (since || "1970-01-01").replace("T", " ").slice(0, 19);
      const checks = db.prepare("SELECT COALESCE(SUM(checks), 0) n FROM test_runs WHERE project_id = ? AND state = 'fertig' AND finished_at > ?").get(pid, s).n;
      const fixed = db.prepare("SELECT COUNT(*) n FROM test_findings f JOIN test_runs r ON r.id = f.fixed_run WHERE f.project_id = ? AND f.status = 'behoben' AND r.finished_at > ?").get(pid, s).n;
      return { checks, fixed };
    } catch { return { checks: 0, fixed: 0 }; }
  }
  async function news(c) {
    const groups = db.prepare(`SELECT DISTINCT pr.group_id g FROM prototypes pr JOIN projects p ON p.id = pr.project_id
      WHERE pr.client_id = ? AND pr.active = 1 AND pr.group_id IS NOT NULL AND p.status != 'abgeschlossen'`).all(c.id).map(x => x.g);
    const out = [];
    for (const g of groups) {
      const rows = db.prepare("SELECT * FROM prototypes WHERE group_id = ? AND active = 1 ORDER BY version").all(g);
      const latest = rows[rows.length - 1], seen = seenOf(c.id, g);
      const from = seen?.version || 0;
      if (latest.version <= from) continue;
      const fresh = rows.filter(r => r.version > from);
      const versions = [];
      for (const r of fresh.reverse()) {
        const prevRow = rows.filter(x => x.version < r.version).pop();
        const d = r.version === 1 ? null : await diffFor(r, prevRow);
        const pages = d ? [...d.changed.filter(isPage).map(p => ({ path: p, label: pageLabel(p), kind: "überarbeitet" })), ...d.added.filter(isPage).map(p => ({ path: p, label: pageLabel(p), kind: "neu" }))] : [];
        versions.push({ ...protoData(r), changes: r.changes || (r.version === 1 ? "Erste Version" : ""), pages, removed: d ? d.removed.filter(isPage).map(pageLabel) : [], files: d ? d.added.length + d.changed.length + d.removed.length : r.files });
      }
      // Was der Kunde angemerkt hat und inzwischen erledigt ist
      const since = seen?.seen_at || new Date(Date.now() - 14 * 864e5).toISOString();
      const done = db.prepare(`SELECT a.*, pr.token, pr.entry, pr.title pt, pr.version pv, pr.created_at pc FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id
        WHERE pr.group_id = ? AND a.client_id = ? AND a.author_kind = 'client' AND a.status = 'erledigt' AND a.done_at > ? ORDER BY a.done_at DESC LIMIT 20`).all(g, c.id, since)
        .map(a => ({ id: a.id, comment: a.comment, reply: a.reply, page: a.page, device_w: a.device_w, x: a.x, y: a.y, done_at: a.done_at,
          proto: { id: a.prototype_id, title: a.pt, url: `/p/${a.token}/${a.entry}`, base: `/p/${a.token}/`, entry: a.entry, version: a.pv, created_at: a.pc } }));
      const pageSet = k => new Set(versions.flatMap(v => v.pages.filter(x => x.kind === k).map(x => x.path)));
      const p = db.prepare("SELECT id, title FROM projects WHERE id = ?").get(latest.project_id);
      out.push({ group_id: g, project_id: p?.id, project: p?.title, title: latest.title, from, to: latest.version, since: seen?.seen_at || null,
        counts: { versions: fresh.length, pagesChanged: pageSet("überarbeitet").size, pagesNew: pageSet("neu").size, done: done.length, ...testCounts(latest.project_id, seen?.seen_at) },
        versions, done, latest: protoData(latest), all: rows.slice().reverse().map(protoData) });
    }
    return out.sort((a, b) => b.latest.id - a.latest.id);
  }
  async function portal(req, res, url, p, c) {
    if (p === "/neu" && req.method === "GET") return json(res, 200, await news(c));
    const mm = p.match(/^\/prototypes\/(\d+)\/seen$/);
    if (mm && req.method === "POST") {
      const r = db.prepare("SELECT * FROM prototypes WHERE id = ? AND client_id = ? AND active = 1").get(+mm[1], c.id);
      if (!r) return json(res, 404, { error: "Nicht gefunden" });
      const g = r.group_id || r.id, old = seenOf(c.id, g), now = new Date().toISOString();
      if (!old) db.prepare("INSERT INTO proto_seen(client_id, group_id, version, seen_at) VALUES(?,?,?,?)").run(c.id, g, r.version, now);
      else if (r.version > old.version) db.prepare("UPDATE proto_seen SET prev_version = version, prev_seen_at = seen_at, version = ?, seen_at = ? WHERE client_id = ? AND group_id = ?").run(r.version, now, c.id, g);
      return json(res, 200, { ok: true });
    }
    return null;
  }

  let onCandidate = null, getJob = null; const listeners = [];
  return { admin, publicRoute, publish, portal, discardCandidate, releaseCandidate, latestIn, pendingIn,
    hooks: h => { onCandidate = h.onCandidate; getJob = h.getJob; }, subscribe: f => listeners.push(f) };
}
