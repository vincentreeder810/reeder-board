// Versand an Kunden nachvollziehbar machen und erneut schicken können.
//  · Versandprotokoll: was ging wann über welchen Weg (Chat / E-Mail) an wen – für „hab ich nie bekommen“ und die Buchhaltung.
//  · Erinnerung bei Ungelesenem: Chat-Karten mit „E-Mail nur, wenn ungelesen“ lösen nach ERINNERN_NACH eine einzige Mail aus,
//    falls der Kunde sie bis dahin nicht gelesen hat. Liest er vorher, kommt nichts (keine doppelte Information).
//  · Erneut schicken: aktueller Stand, Dokument, Gesprächs-Zusammenfassung (Angebote/Rechnungen über /finance/invoices/:id/send).
import { db, chatPosten } from "./db.mjs";
import { sendMail } from "./mail.mjs";
import { vorlage } from "./mail-vorlagen.mjs";
import { firmaVonProjekt } from "./firmen.mjs";
import { isOwner, canClient } from "./access.mjs";

const ERINNERN_NACH = Number(process.env.ERINNERN_NACH_MS || 2 * 3600e3);

db.exec(`CREATE TABLE IF NOT EXISTS versand (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, project_id INTEGER,
  art TEXT NOT NULL, ref_id INTEGER, kanal TEXT NOT NULL, anlass TEXT NOT NULL DEFAULT 'versand', von TEXT, an TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS versand_ref ON versand(art, ref_id, id);`);
{ const mc = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
  if (!mc.includes("erinnern_at")) db.exec("ALTER TABLE messages ADD COLUMN erinnern_at INTEGER");
  if (!mc.includes("erinnert")) db.exec("ALTER TABLE messages ADD COLUMN erinnert INTEGER NOT NULL DEFAULT 0"); }

const KANAL_TEXT = { chat: "Chat", mail: "E-Mail", erinnerung: "Erinnerungs-Mail" };
/** Versand merken. art: angebot | rechnung | storno | mahnung | stand | dokument | zusammenfassung | rueckfragen */
export function versandMerken({ clientId, projectId = null, art, refId = null, kanal, anlass = "versand", von = null, an = null }) {
  try { db.prepare("INSERT INTO versand(client_id, project_id, art, ref_id, kanal, anlass, von, an) VALUES(?,?,?,?,?,?,?,?)").run(clientId, projectId, art, refId, kanal, anlass, von, an); } catch (e) { console.warn("Versand:", e.message); }
}
export const versandListe = (art, refId) => db.prepare("SELECT kanal, anlass, von, an, at FROM versand WHERE art = ? AND ref_id = ? ORDER BY id DESC LIMIT 30").all(art, refId)
  .map(v => ({ ...v, kanal_text: KANAL_TEXT[v.kanal] || v.kanal }));
/** Letzter Versand kurz: { at, wege: ["Chat","E-Mail"], anzahl } */
export function letzterVersand(art, refId) {
  const l = versandListe(art, refId); if (!l.length) return null;
  const at = l[0].at, wege = [...new Set(l.filter(v => v.at.slice(0, 16) === at.slice(0, 16)).map(v => v.kanal_text))];
  return { at, wege, anzahl: new Set(l.map(v => v.at.slice(0, 16))).size };
}
/** Chat-Nachricht für „E-Mail nur, wenn ungelesen“ vormerken */
export function erinnerungVormerken(messageId) {
  if (messageId) db.prepare("UPDATE messages SET erinnern_at = ?, erinnert = 0 WHERE id = ?").run(Date.now() + ERINNERN_NACH, Number(messageId));
}

/* ---------- Erinnerungs-Mails für ungelesene Karten ---------- */
function punktFuer(m) {
  let meta = {}; try { meta = JSON.parse(m.meta || "{}"); } catch {}
  if (m.prototype_id) { const p = db.prepare("SELECT title, version FROM prototypes WHERE id = ?").get(m.prototype_id); return p ? `Neuer Stand: ${p.title} (Version ${p.version || 1})` : "Ein neuer Stand"; }
  if (m.art === "dokument") return `${meta.art || "Dokument"}${meta.nummer ? " " + meta.nummer : ""}${meta.titel ? ": " + meta.titel : ""}`;
  if (m.art === "zusammenfassung") return `Zusammenfassung unseres Gesprächs${meta.titel ? " – " + meta.titel : ""}`;
  if (m.art === "rueckfragen") { const n = (meta.fragen || []).length; return n === 1 ? "Eine Rückfrage zu Ihrem Projekt" : `${n} Rückfragen zu Ihrem Projekt`; }
  return String(m.body || "Eine neue Nachricht").split("\n")[0].slice(0, 80);
}
const refVon = m => {
  let meta = {}; try { meta = JSON.parse(m.meta || "{}"); } catch {}
  if (m.prototype_id) return ["stand", m.prototype_id];
  if (m.art === "dokument") return meta.invoice_id ? [String(meta.art || "").toLowerCase() === "angebot" ? "angebot" : "rechnung", meta.invoice_id] : ["dokument", meta.doc_id];
  if (m.art === "zusammenfassung") return ["zusammenfassung", meta.appointment_id || null];
  if (m.art === "rueckfragen") return ["rueckfragen", m.id];
  return ["nachricht", m.id];
};
export async function erinnerungenSenden(SITE_URL) {
  const jetzt = Date.now();
  const faellig = db.prepare("SELECT * FROM messages WHERE sender = 'team' AND erinnert = 0 AND erinnern_at IS NOT NULL AND erinnern_at <= ?").all(jetzt);
  if (!faellig.length) return 0;
  const markiere = db.prepare("UPDATE messages SET erinnert = ? WHERE id = ?");
  const jeKunde = new Map();
  for (const m of faellig) {
    if (m.read_at) { markiere.run(2, m.id); continue; }   // inzwischen gelesen → keine Mail
    (jeKunde.get(m.client_id) || jeKunde.set(m.client_id, []).get(m.client_id)).push(m);
  }
  let n = 0;
  for (const [cid, liste] of jeKunde) {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(cid);
    for (const m of liste) markiere.run(1, m.id);
    if (!c?.pw_hash || !c.active || !c.notify_email) continue;
    const m0 = liste[0], key = m0.thema_id ? `t${m0.thema_id}` : (m0.project_id ?? "allgemein");
    await sendMail({ to: c.email, ...vorlage("portal_erinnerung", { name: c.name, punkte: liste.map(punktFuer), link: `${SITE_URL}/portal/#chat/${key}`, firma: firmaVonProjekt(m0.project_id) }) }).catch(e => console.warn("Erinnerung:", e.message));
    for (const m of liste) { const [art, ref] = refVon(m); versandMerken({ clientId: cid, projectId: m.project_id, art, refId: ref, kanal: "mail", anlass: "erinnerung", von: "automatisch", an: c.email }); }
    n++;
  }
  return n;
}
export function erinnerungenStarten(SITE_URL) {
  const lauf = () => erinnerungenSenden(SITE_URL).catch(e => console.warn("Erinnerungen:", e.message));
  setTimeout(lauf, 20000); setInterval(lauf, Number(process.env.ERINNERN_TAKT_MS || 5 * 60000)).unref?.();
}

/* ---------- Erneut schicken (Board) ---------- */
export function createVersand({ json, readJson, SITE_URL }) {
  const kunde = id => db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  async function erneutMail(c, punkt, projectId, key) {
    if (!c?.email) return false;
    return sendMail({ to: c.email, ...vorlage("portal_erinnerung", { name: c.name, punkte: [punkt], link: `${SITE_URL}/portal/#chat/${key ?? projectId ?? "allgemein"}`, firma: firmaVonProjekt(projectId) }) });
  }
  async function admin(req, res, url, p, m, user) {
    if (p === "/versand" && m === "GET") {
      const art = String(url.searchParams.get("art") || ""), ref = +url.searchParams.get("ref") || 0;
      const row = db.prepare("SELECT client_id FROM versand WHERE art = ? AND ref_id = ? LIMIT 1").get(art, ref);
      if (row && !isOwner(user) && !canClient(user, row.client_id)) return json(res, 404, { error: "Nicht gefunden" });
      return json(res, 200, versandListe(art, ref));
    }
    let mm = p.match(/^\/projects\/(\d+)\/stand\/erneut$/);
    if (mm && m === "POST") {   // aktuellen Stand erneut schicken
      const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
      const st = db.prepare("SELECT * FROM prototypes WHERE project_id = ? AND active = 1 AND state IS NULL ORDER BY id DESC LIMIT 1").get(pr.id);
      if (!st) return json(res, 404, { error: "Für dieses Projekt gibt es noch keinen Stand." });
      const d = await readJson(req), c = kunde(pr.client_id), punkt = `Ihr aktueller Stand: ${st.title} (Version ${st.version || 1})`;
      if (!d.chat && !d.mail) return json(res, 400, { error: "Bitte Chat oder E-Mail wählen." });
      if (d.chat) {
        const id = db.prepare("INSERT INTO messages(client_id, sender, author, body, prototype_id, project_id, meta, user_id) VALUES(?, 'team', ?, ?, ?, ?, ?, ?)")
          .run(pr.client_id, user.name, `Erinnerung: Version ${st.version || 1} von „${st.title}“ steht für Sie bereit.`, st.id, pr.id, JSON.stringify({ erneut: true }), user.id).lastInsertRowid;
        if (d.erinnern) erinnerungVormerken(id);
        versandMerken({ clientId: pr.client_id, projectId: pr.id, art: "stand", refId: st.id, kanal: "chat", anlass: "erneut", von: user.name });
      }
      let mailed = null;
      if (d.mail) { mailed = await erneutMail(c, punkt, pr.id); versandMerken({ clientId: pr.client_id, projectId: pr.id, art: "stand", refId: st.id, kanal: "mail", anlass: "erneut", von: user.name, an: c?.email }); }
      return json(res, 200, { ok: true, mailed, versand: versandListe("stand", st.id) });
    }
    mm = p.match(/^\/documents\/(\d+)\/erneut$/);
    if (mm && m === "POST") {   // Dokument erneut schicken
      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(+mm[1]); if (!doc) return json(res, 404, { error: "Dokument nicht gefunden" });
      const d = await readJson(req), c = kunde(doc.client_id), punkt = `${doc.kind}: ${doc.title}`;
      if (!d.chat && !d.mail) return json(res, 400, { error: "Bitte Chat oder E-Mail wählen." });
      if (d.chat) {
        const id = chatPosten({ clientId: doc.client_id, projectId: doc.project_id, user, art: "dokument", body: `Erinnerung: ${doc.title} liegt für Sie bereit.`, meta: { doc_id: doc.id, art: doc.kind, titel: doc.title, betrag: doc.amount_gross, erneut: true } });
        if (d.erinnern) erinnerungVormerken(id);
        versandMerken({ clientId: doc.client_id, projectId: doc.project_id, art: "dokument", refId: doc.id, kanal: "chat", anlass: "erneut", von: user.name });
      }
      let mailed = null;
      if (d.mail) { mailed = await erneutMail(c, punkt, doc.project_id); versandMerken({ clientId: doc.client_id, projectId: doc.project_id, art: "dokument", refId: doc.id, kanal: "mail", anlass: "erneut", von: user.name, an: c?.email }); }
      return json(res, 200, { ok: true, mailed, versand: versandListe("dokument", doc.id) });
    }
    return null;
  }
  return { admin };
}
