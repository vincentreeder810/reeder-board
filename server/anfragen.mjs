// Eine Anfrage ist ein Projekt – von der Buchung an.
// Für jedes Thema, das bei der Terminbuchung angekreuzt wird (Website, Software, Hardware), entsteht sofort ein Projekt
// im Status „anfrage“. Der Termin, der Fragebogen und (bei Websites) der Vorab-Entwurf hängen an diesem Projekt.
// So zeigen Vertrieb, Kundenseite, Kalender und Kundenportal überall dasselbe: eine Karte je Anfrage.
import { db } from "./db.mjs";
import { hardwareKonzeptAnlegen } from "./hardware.mjs";

{ const sp = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!sp.includes("booking_id")) db.exec("ALTER TABLE projects ADD COLUMN booking_id INTEGER");
  if (!sp.includes("anfrage_art")) db.exec("ALTER TABLE projects ADD COLUMN anfrage_art TEXT"); }

export const ARTEN = {
  website: { kind: "Website", bereich: "software", name: "Website" },
  software: { kind: "Software", bereich: "software", name: "Software" },
  hardware: { kind: "Hardware", bereich: "hardware", name: "Hardware" },
};

/** Themen einer Buchung aus dem Feld „Themen: …“; ohne Angabe gilt Website (wie beim Fragebogen-Versand). */
export function themenDerBuchung(b, hardwareTermin = false) {
  const text = (String(b?.message || "").match(/^Themen: (.*)$/m) || [])[1] || "";
  const arten = new Set(text.split(",").map(t => t.trim().toLowerCase()).filter(Boolean).map(t => t === "website" ? "website" : t === "hardware" ? "hardware" : "software"));
  if (hardwareTermin) arten.add("hardware");
  if (!arten.size) arten.add("website");
  return [...arten];
}

export const projektZurAnfrage = (bookingId, art) => bookingId ? db.prepare("SELECT * FROM projects WHERE booking_id = ? AND anfrage_art = ?").get(bookingId, art) || null : null;

/** Legt je Thema ein Projekt „anfrage“ an (falls noch nicht da) und hängt den Termin der Buchung an das erste Projekt. */
export function projekteFuerBuchung(b, arten) {
  if (!b?.client_id) return [];
  const kunde = db.prepare("SELECT company, name FROM clients WHERE id = ?").get(b.client_id) || {};
  const wer = kunde.company || kunde.name || b.name || "Interessent", ids = [];
  for (const art of arten) {
    const A = ARTEN[art]; if (!A) continue;
    let p = projektZurAnfrage(b.id, art);
    // Gibt es beim Kunden schon eine offene Anfrage derselben Art ohne Buchung (z. B. aus einem früheren Fragebogen)? Dann gehört sie zu dieser Buchung – kein zweites Projekt.
    if (!p) { const lose = db.prepare("SELECT id FROM projects WHERE client_id = ? AND status = 'anfrage' AND booking_id IS NULL AND (anfrage_art = ? OR (anfrage_art IS NULL AND bereich = ? AND ? != 'website')) ORDER BY id DESC LIMIT 1").get(b.client_id, art, A.bereich, art);
      if (lose) { db.prepare("UPDATE projects SET booking_id = ?, anfrage_art = ? WHERE id = ?").run(b.id, art, lose.id); p = lose; } }
    if (!p) {
      const titel = `${A.name} für ${wer}`.slice(0, 110);
      const id = Number(db.prepare("INSERT INTO projects(client_id, title, kind, description, phase, status, bereich, booking_id, anfrage_art) VALUES(?, ?, ?, '', 'Erstgespräch', 'anfrage', ?, ?, ?)")
        .run(b.client_id, titel, A.kind, A.bereich, b.id, art).lastInsertRowid);
      db.prepare("INSERT INTO events(client_id, project_id, kind, title, detail, notify) VALUES(?, ?, 'projekt', ?, ?, 0)").run(b.client_id, id, "Anfrage eingegangen", `${A.name} · über die Terminbuchung`);
      if (art === "hardware") { try { hardwareKonzeptAnlegen(id, { name: titel }); } catch (e) { console.warn("Hardware-Konzept:", e.message); } }
      p = { id };
    }
    ids.push(p.id);
  }
  if (ids.length) db.prepare("UPDATE appointments SET project_id = ? WHERE booking_id = ? AND project_id IS NULL").run(ids[0], b.id);
  return ids;
}

/** Fragebogen zu einem Anfrage-Projekt: { stand: "offen" | "ausgefuellt" | null, link, id, quelle } */
export function fragebogenVonProjekt(p) {
  if (!p?.booking_id || !p.anfrage_art) return { stand: null, link: null };
  if (p.anfrage_art === "website") {
    const v = db.prepare("SELECT id, token, answered_at FROM vorab WHERE booking_id = ? ORDER BY id DESC LIMIT 1").get(p.booking_id);
    return v ? { stand: v.answered_at ? "ausgefuellt" : "offen", link: v.answered_at ? null : `/portal/fragebogen.html#${v.token}`, id: v.id, quelle: "vorab" } : { stand: null, link: null };
  }
  const o = db.prepare("SELECT id, token, status, kinds FROM onboarding WHERE booking_id = ? ORDER BY id DESC").all(p.booking_id).find(x => { try { return JSON.parse(x.kinds).includes(p.anfrage_art); } catch { return false; } });
  return o ? { stand: o.status === "ausgefuellt" ? "ausgefuellt" : "offen", link: o.status === "ausgefuellt" ? null : `/portal/onboarding.html#${o.token}`, id: o.id, quelle: "onboarding" } : { stand: null, link: null };
}

/** Termine eines Anfrage-Projekts: eigene Termine und der Termin aus der Buchung */
export function termineVonProjekt(p, jetzt = new Date().toISOString()) {
  const wo = p.booking_id ? "(project_id = ? OR booking_id = ?)" : "project_id = ?", arg = p.booking_id ? [p.id, p.booking_id] : [p.id];
  return {
    naechster: db.prepare(`SELECT id, title, start, video_url FROM appointments WHERE ${wo} AND start >= ? ORDER BY start LIMIT 1`).get(...arg, jetzt) || null,
    letzter: db.prepare(`SELECT id, title, start, notes_intern FROM appointments WHERE ${wo} AND start < ? ORDER BY start DESC LIMIT 1`).get(...arg, jetzt) || null,
  };
}

/** Einmalig beim Start: Bestehende Anfragen bekommen ihr Projekt, damit nichts fehlt.
 *  1. Projekte aus früheren Fragebögen (Software/Hardware) werden ihrer Buchung zugeordnet.
 *  2. Laufende Buchungen ohne Projekt bekommen je Thema eines. */
export function anfragenNachziehen(hardwareTermin = () => false) {
  let n = 0;
  try {
    for (const o of db.prepare("SELECT booking_id, kinds, project_ids FROM onboarding WHERE booking_id IS NOT NULL AND project_ids IS NOT NULL").all()) {
      let kinds = [], ids = []; try { kinds = JSON.parse(o.kinds || "[]"); ids = JSON.parse(o.project_ids || "[]"); } catch {}
      ids.forEach((id, i) => { if (kinds[i]) n += db.prepare("UPDATE projects SET booking_id = ?, anfrage_art = ? WHERE id = ? AND booking_id IS NULL").run(o.booking_id, kinds[i], id).changes; });
    }
    // Nur kommende Termine: Für vergangene Buchungen entsteht nachträglich kein Projekt mehr
    for (const b of db.prepare("SELECT * FROM bookings WHERE client_id IS NOT NULL AND status IN ('neu','bestaetigt') AND start >= ? ORDER BY id").all(new Date().toISOString())) {
      const kunde = db.prepare("SELECT stage FROM clients WHERE id = ?").get(b.client_id); if (!kunde || !["anfrage", "interessent"].includes(kunde.stage)) continue;
      const arten = themenDerBuchung(b, hardwareTermin(b.type)).filter(a => !projektZurAnfrage(b.id, a));
      if (arten.length) n += projekteFuerBuchung(b, arten).length;
    }
  } catch (e) { console.warn("Anfragen nachziehen:", e.message); }
  if (n) console.log(`Anfragen nachgezogen: ${n} Projekt(e) zugeordnet oder angelegt`);
}
