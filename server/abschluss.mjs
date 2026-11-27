// Projektabschluss – Schritt 1: Abnahme, Endrechnung, wann die Übergabe freigegeben wird.
//   Abnahmetermin (Terminart „Abnahme“, bei Software auch „Installation & Übergabe“) → „Abgenommen“ → Endrechnung
//   (letzte Rate aus dem Zahlungsplan) → Übergabe: nach Zahlungseingang (Standard) oder sofort mit der Endrechnung.
//   Übergabe-Paket, Abschluss-Mail und „Abgeschlossen“ folgen in Schritt 2 und 3.
import { db } from "./db.mjs";
import { isOwner } from "./access.mjs";

{ const pc = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  for (const [c, t] of [["abgenommen_at", "TEXT"], ["abgenommen_von", "TEXT"], ["uebergabe_nach", "TEXT NOT NULL DEFAULT 'zahlung'"]]) if (!pc.includes(c)) db.exec(`ALTER TABLE projects ADD COLUMN ${c} ${t}`); }

export function createAbschluss({ json, readJson, logEvent }) {
  function stand(pr) {
    const termine = art => db.prepare("SELECT id, title, start, minutes, kind, summary FROM appointments WHERE project_id = ? AND (kind LIKE ? OR title LIKE ?) ORDER BY start DESC").all(pr.id, `${art}%`, `${art}%`);
    const zahlungen = db.prepare("SELECT * FROM payments WHERE project_id = ? ORDER BY sort, id").all(pr.id);
    const letzte = zahlungen[zahlungen.length - 1] || null;
    const rechnungZu = p => p ? db.prepare("SELECT id, number, status, locked, sent_at, paid_at, gross FROM invoices WHERE payment_id = ? AND kind = 'rechnung' ORDER BY id DESC LIMIT 1").get(p.id) || null : null;
    const end = rechnungZu(letzte);
    const versandt = !!(end?.locked && (end.sent_at || db.prepare("SELECT 1 FROM versand WHERE art = 'rechnung' AND ref_id = ? LIMIT 1").get(end.id)));
    const bezahlt = letzte?.status === "bezahlt" || end?.status === "bezahlt";
    const nach = pr.uebergabe_nach === "rechnung" ? "rechnung" : "zahlung";
    return {
      bereich: pr.bereich || "software", status: pr.status,
      abnahme: termine("Abnahme"), installation: termine("Installation"),
      abgenommen_at: pr.abgenommen_at || null, abgenommen_von: pr.abgenommen_von || null,
      zahlungen: zahlungen.map(p => ({ id: p.id, label: p.label, status: p.status, paid_at: p.paid_at, netto: p.amount_net })),
      endzahlung: letzte ? { id: letzte.id, label: letzte.label, status: letzte.status, netto: letzte.amount_net, paid_at: letzte.paid_at } : null,
      offeneVorher: zahlungen.slice(0, -1).filter(p => p.status !== "bezahlt").length,
      endrechnung: end ? { ...end, locked: !!end.locked, versandt } : null,
      uebergabe_nach: nach,
      uebergabeBereit: !!pr.abgenommen_at && (nach === "zahlung" ? bezahlt : versandt || bezahlt),
    };
  }
  async function admin(req, res, p, m, user) {
    const mm = p.match(/^\/projects\/(\d+)\/abschluss$/); if (!mm) return null;
    const pr = db.prepare("SELECT * FROM projects WHERE id = ?").get(+mm[1]); if (!pr) return json(res, 404, { error: "Projekt nicht gefunden" });
    if (m === "GET") return json(res, 200, stand(pr));
    if (m !== "POST") return null;
    if (!isOwner(user)) return json(res, 403, { error: "Das entscheidet der Inhaber." });
    const d = await readJson(req);
    if (d.aktion === "abgenommen") {
      if (pr.abgenommen_at) return json(res, 409, { error: "Das Projekt ist schon als abgenommen eingetragen." });
      db.prepare("UPDATE projects SET abgenommen_at = datetime('now'), abgenommen_von = ?, updated_at = datetime('now') WHERE id = ?").run(user.name, pr.id);
      logEvent(pr.client_id, pr.id, "projekt", "Projekt abgenommen", d.notiz ? String(d.notiz).slice(0, 300) : "", d.notify !== false);
    } else if (d.aktion === "zuruecknehmen") {
      db.prepare("UPDATE projects SET abgenommen_at = NULL, abgenommen_von = NULL WHERE id = ?").run(pr.id);
      logEvent(pr.client_id, pr.id, "projekt", "Abnahme zurückgenommen", "", false);
    } else if (d.aktion === "uebergabe_nach") {
      db.prepare("UPDATE projects SET uebergabe_nach = ? WHERE id = ?").run(d.wert === "rechnung" ? "rechnung" : "zahlung", pr.id);
    } else return json(res, 400, { error: "Unbekannte Aktion" });
    return json(res, 200, stand(db.prepare("SELECT * FROM projects WHERE id = ?").get(pr.id)));
  }
  return { admin };
}
