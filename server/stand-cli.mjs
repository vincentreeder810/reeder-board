#!/usr/bin/env node
// Neuen Stand eines Kundenprojekts ins Reeder Board hochladen – ohne Abhängigkeiten, läuft in jedem Projektordner.
//
//   node "<Pfad>/server/stand-cli.mjs"                 liest .reeder-stand.json im aktuellen Ordner
//   node "<Pfad>/server/stand-cli.mjs" --pruefen       zeigt nur, was sich geändert hat
//   node "<Pfad>/server/stand-cli.mjs" --text "Überschrift kleiner, Öffnungszeiten ergänzt"
//   node "<Pfad>/server/stand-cli.mjs" --auftrag      holt den offenen Auftrag (geklärte Kundenwünsche) → REEDER-AUFTRAG.md
//   node "<Pfad>/server/stand-cli.mjs" --kandidat 12  lädt den umgesetzten Stand als Kandidat zu Auftrag 12 hoch (Kunde sieht ihn erst nach Freigabe)
//   Weitere Optionen: --still (Kunden nicht benachrichtigen) · --ordner dist · --url … · --key … · --config datei.json
//
// .reeder-stand.json (gehört NICHT ins Git-Repository):
//   { "url": "http://localhost:5510", "key": "rsk_…", "ordner": "dist" }
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".map", ".txt", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".wav", ".pdf"]);
const args = process.argv.slice(2), flag = n => args.includes("--" + n), opt = n => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const fail = msg => { console.error("✗ " + msg); process.exit(1); };

const BASE = process.env.INIT_CWD || process.cwd();   // bei „npm run stand“ der Ordner, aus dem aufgerufen wurde
const cfgPath = path.resolve(BASE, opt("config") || ".reeder-stand.json");
let cfg = {};
try { cfg = JSON.parse(await readFile(cfgPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") fail(`${cfgPath} ist kein gültiges JSON.`); }
const url = (opt("url") || cfg.url || "http://localhost:5510").replace(/\/+$/, "");
const key = opt("key") || process.env.REEDER_STAND_KEY || cfg.key;
const dir = opt("ordner") ? path.resolve(BASE, opt("ordner")) : path.resolve(path.dirname(cfgPath), cfg.ordner || ".");
if (!key) fail("Kein Stand-Schlüssel. Im Board: Projekt → Täglicher Stand → „Verbindung für Claude Code“.");

// Auftrag abholen: schreibt REEDER-AUFTRAG.md in den Projektordner
if (flag("auftrag")) {
  let r; try { r = await fetch(url + "/api/stand/auftrag", { headers: { Authorization: "Bearer " + key } }); } catch { fail(`Board nicht erreichbar unter ${url} – läuft der Server?`); }
  const d = await r.json().catch(() => ({})); if (!r.ok) fail(d.error || `Fehler ${r.status}`);
  if (!d.job) { console.log("= " + (d.message || "Kein offener Auftrag.")); process.exit(0); }
  const { writeFile } = await import("node:fs/promises"), file = path.join(path.dirname(cfgPath), "REEDER-AUFTRAG.md");
  await writeFile(file, d.markdown, "utf8");
  console.log(`✓ Auftrag #${d.job.id} für „${d.project}“ (${d.job.items} Änderungen) → ${file}

${d.markdown}`);
  process.exit(0);
}

// Schlüssel nicht versehentlich ins Repository
try { const gi = await readFile(path.join(path.dirname(cfgPath), ".gitignore"), "utf8"); if (!/\.reeder-stand\.json/.test(gi)) console.warn("! Hinweis: .reeder-stand.json in die .gitignore eintragen – sie enthält den Schlüssel."); } catch {}

const files = []; let bytes = 0;
async function walk(abs, rel) {
  for (const e of await readdir(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__MACOSX") continue;
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) await walk(path.join(abs, e.name), r);
    else if (e.isFile() && EXT.has(path.extname(e.name).toLowerCase())) { const buf = await readFile(path.join(abs, e.name)); bytes += buf.length; files.push({ path: r, data: buf.toString("base64") }); }
    if (files.length > 600) fail("Mehr als 600 Dateien – bitte den Ausgabe-Ordner der Website angeben (--ordner dist).");
  }
}
try { await walk(dir, ""); } catch { fail(`Ordner nicht lesbar: ${dir}`); }
if (!files.some(f => /\.html?$/i.test(f.path))) fail(`Keine HTML-Datei in ${dir}.`);
console.log(`→ ${files.length} Dateien (${(bytes / 1048576).toFixed(1)} MB) aus ${dir}`);

let res;
try {
  res = await fetch(url + "/api/stand", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ files, changes: opt("text") || "", announce: !flag("still"), dry: flag("pruefen"), job: opt("kandidat") ? +opt("kandidat") : undefined }) });
} catch { fail(`Board nicht erreichbar unter ${url} – läuft der Server?`); }
const d = await res.json().catch(() => ({}));
if (!res.ok) fail(d.error || `Fehler ${res.status}`);
if (d.unchanged) console.log(`= ${d.summary}`);
else if (d.dry) console.log(`○ Prüfung (nichts hochgeladen) – würde Version ${d.version} von „${d.title}“:\n  ${d.summary}`);
else if (d.candidate) console.log(`✓ Kandidat Version ${d.version} zu Auftrag #${opt("kandidat")} hochgeladen.
  Der Kunde sieht ihn erst, wenn er im Board freigegeben ist (Projektseite > Auftrag).
  ${d.changes}`);
else console.log(`✓ Version ${d.version} von „${d.title}“ (${d.project}) ist online.\n  ${d.changes}${flag("still") ? "\n  Kunde wurde nicht benachrichtigt." : ""}`);
