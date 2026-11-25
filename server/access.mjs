// Rollen & Zugriff im Admin-Board.
//   inhaber    – sieht und darf alles (Finanzen, Team, Einstellungen, Vertrieb)
//   entwickler – sieht nur Kunden/Projekte, denen er zugewiesen ist; keine Beträge, Rechnungen, Team, Einstellungen
// Geprüft wird hier auf dem Server – die Oberfläche blendet nur zusätzlich aus.
import { db } from "./db.mjs";

export const ROLES = { inhaber: "Inhaber", entwickler: "Entwickler" };
export const isOwner = u => u?.role === "inhaber";
export const FINANCE_DOC_KINDS = ["Angebot", "Rechnung", "Vertrag"];
export const FINANCE_EVENT_KINDS = ["angebot", "zahlung"];

export function memberProjectIds(u) {
  if (isOwner(u)) return null; // null = alle
  return db.prepare("SELECT project_id FROM project_members WHERE user_id = ?").all(u.id).map(r => r.project_id);
}
export function canProject(u, projectId) {
  if (isOwner(u)) return true;
  return !!db.prepare("SELECT 1 FROM project_members WHERE user_id = ? AND project_id = ?").get(u.id, projectId);
}
export function canClient(u, clientId) {
  if (isOwner(u)) return true;
  return !!db.prepare("SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? AND p.client_id = ?").get(u.id, clientId);
}
export function clientIdsFor(u) {
  if (isOwner(u)) return null;
  return db.prepare("SELECT DISTINCT p.client_id id FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ?").all(u.id).map(r => r.id);
}

// Nur für Inhaber (Methode optional)
const OWNER_ONLY = [
  [/^\/settings(\/|$)/], [/^\/outbox$/], [/^\/calendar\/reset$/], [/^\/team(\/|$)/], [/^\/finance(\/|$)/], [/^\/vertraege(\/|$)/], [/^\/zeiten$/], [/^\/kpi$/], [/^\/betrieb(\/|$)/], [/^\/livegang$/],
  [/^\/availability$/, "PUT"], [/^\/bookings(\/|$)/], [/^\/requests(\/\d+)?$/],            // Website-Buchungen & -Anfragen = Vertrieb
  [/^\/clients$/, "POST"], [/^\/clients\/\d+$/, "PATCH"], [/^\/clients\/\d+\/invite$/],
  [/^\/clients\/\d+\/projects$/, "POST"], [/^\/clients\/\d+\/stage$/], [/^\/projects\/\d+$/, "DELETE"], [/^\/projects\/\d+\/members$/],
];
// Zu welchem Kunden gehört eine Ressource? (für die Zugriffsprüfung bei Entwicklern)
// Liefert { c: Kunde, p: Projekt|null }. Hängt eine Ressource an einem Projekt, muss der Entwickler genau diesem Projekt zugewiesen sein.
const RESOLVE = [
  [/^\/clients\/(\d+)/, id => ({ c: +id, p: null })],
  [/^\/projects\/(\d+)/, id => { const r = db.prepare("SELECT client_id c, id p FROM projects WHERE id = ?").get(id); return r && { c: r.c, p: r.p, strict: true }; }],
  [/^\/tasks\/(\d+)/, id => { const r = db.prepare("SELECT p.client_id c, p.id p FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?").get(id); return r && { ...r, strict: true }; }],
  [/^\/appointments\/(\d+)/, id => db.prepare("SELECT client_id c, project_id p FROM appointments WHERE id = ?").get(id)],
  [/^\/documents\/(\d+)/, id => db.prepare("SELECT client_id c, project_id p, kind FROM documents WHERE id = ?").get(id)],
  [/^\/prototypes\/(\d+)/, id => db.prepare("SELECT client_id c, project_id p FROM prototypes WHERE id = ?").get(id)],
  [/^\/annotations\/(\d+)/, id => db.prepare("SELECT a.client_id c, pr.project_id p FROM annotations a JOIN prototypes pr ON pr.id = a.prototype_id WHERE a.id = ?").get(id)],
  [/^\/requests\/(\d+)\/(accept|decline)$/, id => db.prepare("SELECT client_id c, project_id p FROM appointment_requests WHERE id = ?").get(id)],
];

/** null = erlaubt, sonst { code, error } */
export function guard(user, method, p) {
  if (isOwner(user)) return null;
  for (const [re, m] of OWNER_ONLY) if (re.test(p) && (!m || m === method)) return { code: 403, error: "Dafür fehlt Ihnen die Berechtigung." };
  const nf = { code: 404, error: "Nicht gefunden" };
  for (const [re, fn] of RESOLVE) {
    const mm = p.match(re); if (!mm) continue;
    const r = fn(mm[1]); if (!r?.c) return nf;
    if (r.kind && FINANCE_DOC_KINDS.includes(r.kind)) return nf;          // Rechnungen/Angebote/Verträge nie für Entwickler
    if (r.p ? !canProject(user, r.p) : (r.strict || !canClient(user, r.c))) return nf;
    return null;
  }
  return null;
}
