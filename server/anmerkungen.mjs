// Offene Anmerkungen eines Projekts als Text für den Claude-Arbeitsordner (anmerkungen.md).
// Die Brücke fragt bei jedem Abgleich den Stempel ab und holt den Text neu, sobald er sich ändert –
// so weiß Claude im Projektordner ohne Diktat, was Kunde und Team an der Website angemerkt haben.
import crypto from "node:crypto";
import { db } from "./db.mjs";

const LABEL = { fontSize: "Schriftgröße", fontWeight: "Schriftstärke", color: "Textfarbe", backgroundColor: "Hintergrundfarbe", textAlign: "Ausrichtung",
  marginTop: "Abstand oben", marginBottom: "Abstand unten", paddingTop: "Innenabstand oben", paddingBottom: "Innenabstand unten", borderRadius: "Eckenradius" };
const KIND_DE = { heading: "Überschrift", text: "Text", link: "Link", button: "Knopf", image: "Bild", block: "Bereich" };
const tag = iso => new Date(String(iso).replace(" ", "T") + "Z").toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

const offene = pid => db.prepare(`SELECT a.*, pr.version proto_version, pr.title proto_title FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id
  WHERE pr.project_id = ? AND a.status = 'offen' ORDER BY a.page, a.id`).all(pid);

export function anmerkungenText(pid) {
  const rows = offene(pid);
  const kopf = ["<!-- Vom Reeder Board erzeugt. Wird automatisch neu geschrieben, sobald sich im Board etwas ändert – nicht bearbeiten. -->", "# Offene Anmerkungen zur Website", ""];
  if (!rows.length) return kopf.concat("Zurzeit gibt es keine offenen Anmerkungen.", "").join("\n");
  const zeilen = kopf.concat(`${rows.length} offene Anmerkung${rows.length === 1 ? "" : "en"} aus dem Board. „Kunde“ = vom Kunden im Kundenportal angepinnt, „Team“ = vom Inhaber oder Entwickler.`,
    "Die Nummer (#) brauchst du, um eine Anmerkung beim Hochladen als erledigt zu melden (siehe CLAUDE.md).", "");
  for (const a of rows) {
    let c = null, striche = 0; try { c = a.change ? JSON.parse(a.change) : null; } catch {} try { striche = JSON.parse(a.strokes || "[]").length; } catch {}
    zeilen.push(`## #${a.id} · Seite ${a.page || "index.html"} · ${a.author_kind === "client" ? "Kunde" : "Team"} (${a.author}) · ${tag(a.created_at)} · zu Version ${a.proto_version}`, "");
    zeilen.push(a.comment ? `„${a.comment}“` : "(ohne Text, nur eingezeichnet)", "");
    if (c?.target) {
      zeilen.push(`- Betrifft: ${KIND_DE[c.target.kind] || "Element"}${c.target.text ? ` „${String(c.target.text).slice(0, 100)}“` : ""}${c.target.tag ? ` (<${c.target.tag}>)` : ""}${c.target.sel ? ` · Selektor \`${c.target.sel}\`` : ""}`);
      for (const [k, v] of Object.entries(c.css || {})) zeilen.push(`- ${LABEL[k] || k}: ${c.before?.[k] ? `${c.before[k]} → ` : ""}**${v}**`);
      if (c.text) zeilen.push(`- Neuer Text: „${c.text}“${c.textBefore || c.target.text ? ` (bisher: „${c.textBefore || c.target.text}“)` : ""}`);
    }
    zeilen.push(`- Stelle: bei ${a.device_w} px Bildschirmbreite (${a.device_w < 700 ? "Handy" : a.device_w < 1100 ? "Tablet" : "Desktop"}) etwa ${Math.round(a.x)} px von links und ${Math.round(a.y)} px von oben${striche ? " · dort wurde etwas eingezeichnet" : ""}`);
    if (a.reply) zeilen.push(`- Antwort des Teams: ${a.reply}`);
    zeilen.push("");
  }
  return zeilen.join("\n");
}
/** Kurzer Stempel: ändert sich, sobald eine Anmerkung dazukommt, geändert oder erledigt wird */
export const anmerkungenStempel = pid => crypto.createHash("sha1").update(JSON.stringify(offene(pid).map(a => [a.id, a.comment, a.change, a.reply]))).digest("hex").slice(0, 12);

/** Beim Hochladen eines Stands als erledigt gemeldete Anmerkungen abhaken */
export function anmerkungenErledigen(pid, ids, version) {
  const nr = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 200); let n = 0;
  const setzen = db.prepare(`UPDATE annotations SET status = 'erledigt', done_at = datetime('now'), reply = COALESCE(NULLIF(reply, ''), ?)
    WHERE id = ? AND status = 'offen' AND prototype_id IN (SELECT id FROM prototypes WHERE project_id = ?)`);
  for (const id of nr) n += setzen.run(`Umgesetzt in Version ${version}.`, id, pid).changes;
  return n;
}
