// Vorschau aller E-Mail-Vorlagen im Board (Einstellungen › E-Mail) und Ansicht verschickter Mails aus dem Postausgang.
// Nur für den Inhaber. Die Vorlagen selbst stehen in ./mail-vorlagen.mjs (VORLAGEN).
import { db, getSetting } from "./db.mjs";
import { isOwner } from "./access.mjs";
import { mailHtml } from "./mail.mjs";
import { firmaDaten, hardwareAktiv, DEFAULT_HARDWARE } from "./firmen.mjs";

// Firmendaten für die Vorschau: Hardware wird auch gezeigt, wenn die Hardware GmbH noch nicht aktiv ist
const vorschauFirma = firma => firma === "hardware"
  ? { ...getSetting("companyHardware", DEFAULT_HARDWARE), firma: "hardware", brand: "Hardware" }
  : firmaDaten("software");

// Vorlagen dynamisch laden: Fehlt die Datei (noch), bleibt die Vorschau leer statt den Server zu stoppen
let MODUL = null;
async function ladeVorlagen() {
  try { MODUL = await import("./mail-vorlagen.mjs"); return MODUL.VORLAGEN || {}; }
  catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && /mail-vorlagen/.test(String(e.message))) return null;
    throw e;
  }
}

// Eine Vorlage mit ihren Beispieldaten durchspielen
// firma: Umschalter im Board („software“/„hardware“); ohne Angabe die Firma, die die Vorlage selbst mitgibt
function rendere(v, firma = null) {
  // Über vorlage() bauen: Dann bekommen Betreff, Text und Gruß die gewählte Firma (auch die noch nicht aktive Hardware GmbH)
  const daten = structuredClone(v.beispiel ?? {}); if (firma) daten.firma = firma;
  const key = MODUL?.VORLAGEN ? Object.keys(MODUL.VORLAGEN).find(k => MODUL.VORLAGEN[k] === v) : null;
  const r = (key && MODUL.vorlage ? MODUL.vorlage(key, daten, { vorschau: true }) : v.baue(daten)) || {};
  const subject = String(r.subject ?? ""), text = String(r.text ?? "");
  const html = mailHtml({ subject, text, knopf: r.knopf || null, vorschautext: r.vorschautext || "", firma: vorschauFirma(firma || r.firma || "software") });
  return { subject, text, html, knopf: r.knopf || null, firma: r.firma || null };
}

// HTML-Antwort für das <iframe sandbox>: keine Skripte, keine fremden Quellen
const HTML_KOPF = {
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox allow-popups allow-popups-to-escape-sandbox",
};

/** vorlagen: nur für Tests – eigene Ladefunktion statt ./mail-vorlagen.mjs */
export function createMailVorschau({ json, send, vorlagen = ladeVorlagen }) {
  async function admin(req, res, p, m, user) {
    const vl = p.match(/^\/mail-vorlagen(?:\/([\w-]{1,60})(\/html)?)?$/);
    const pa = p.match(/^\/postausgang\/(\d+)\/html$/);
    if (!vl && !pa) return null;
    if (m !== "GET") return json(res, 405, { error: "Nicht erlaubt." });
    if (!isOwner(user)) return json(res, 403, { error: "Nur für Inhaber." });
    const q = new URL(req.url || "/", "http://x").searchParams.get("firma");
    const firma = q === "hardware" || q === "software" ? q : null;

    if (pa) {
      const row = db.prepare("SELECT * FROM outbox WHERE id = ?").get(+pa[1]);
      if (!row) return json(res, 404, { error: "Diese E-Mail gibt es nicht (mehr)." });
      const html = row.html || mailHtml({ subject: row.subject, text: row.body || "", firma: firma || "software" });
      return send(res, 200, html, HTML_KOPF);
    }

    const alle = await vorlagen();
    if (!vl[1]) {
      if (!alle) return json(res, 200, []);   // Vorlagen-Datei fehlt noch
      const liste = Object.entries(alle).map(([schluessel, v]) => {
        let subject = "";
        try { subject = rendere(v, firma).subject; } catch (e) { subject = `(Vorschau fehlgeschlagen: ${e.message})`; }
        return { schluessel, gruppe: v.gruppe || "Sonstige", titel: v.titel || schluessel, an: v.an === "team" ? "team" : "kunde", wann: v.wann || "", subject };
      });
      return json(res, 200, liste);
    }
    const v = alle?.[vl[1]];
    if (!v) return json(res, 404, { error: "Diese Vorlage gibt es nicht." });
    let r;
    try { r = rendere(v, firma); }
    catch (e) { return json(res, 500, { error: `Vorschau fehlgeschlagen: ${e.message}` }); }
    if (vl[2]) return send(res, 200, r.html, HTML_KOPF);
    return json(res, 200, { schluessel: vl[1], gruppe: v.gruppe || "Sonstige", titel: v.titel || vl[1], an: v.an === "team" ? "team" : "kunde", wann: v.wann || "", subject: r.subject, text: r.text, html: r.html, firma: firma || r.firma || "software", hardwareAktiv: hardwareAktiv() });
  }
  return { admin };
}
