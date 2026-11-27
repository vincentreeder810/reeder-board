// E-Mail-Versand über Ihr eigenes Postfach (SMTP). Ohne SMTP-Daten landen Mails nur im Postausgang des Admin-Boards.
// Jede Mail geht zweiteilig raus: Klartext (für Spamfilter und reine Text-Programme) und eine gestaltete HTML-Fassung.
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";
import { firmaDaten } from "./firmen.mjs";   // firmen.mjs importiert nur db.mjs – kein Zirkelimport

// Protokoll: gestaltete Fassung und Vorlagen-Schlüssel mitschreiben (Spalten nachrüsten, wenn sie fehlen)
{
  const oc = db.prepare("PRAGMA table_info(outbox)").all().map(c => c.name);
  if (!oc.includes("html")) db.exec("ALTER TABLE outbox ADD COLUMN html TEXT");
  if (!oc.includes("art")) db.exec("ALTER TABLE outbox ADD COLUMN art TEXT");
}
const protokoll = (to, subject, text, html, status, error = null, art = null) =>
  db.prepare("INSERT INTO outbox(to_addr, subject, body, html, status, error, art) VALUES(?, ?, ?, ?, ?, ?, ?)").run(to, subject, text, html, status, error, art);

let transporter = null, smtpReady = false, smtpHost = null;
// SMTP-Zugang: zuerst aus den Einstellungen im Admin-Board, sonst aus der .env
export async function reloadSmtp() {
  if (process.env.MAIL_DISABLED) { transporter = null; smtpReady = false; smtpHost = null; return false; }   // Demo-Board: niemals echte Mails
  const st = getSetting("smtp", {});
  const cfg = st.host ? st : { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  transporter = null; smtpReady = false; smtpHost = cfg.host || null;
  if (!(cfg.host && cfg.user && cfg.pass)) return false;
  try {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(cfg.port || 587);
    // Zeitgrenzen: Antwortet der Mailserver nicht, gibt es nach wenigen Sekunden eine klare Fehlermeldung statt einer hängenden Anfrage
    transporter = nodemailer.createTransport({ host: cfg.host, port, secure: port === 465, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000 });
    smtpReady = true;
  } catch (e) { console.warn("E-Mail: Paket 'nodemailer' fehlt – bitte einmal 'npm install' ausführen. Mails werden nur gespeichert."); }
  return smtpReady;
}
await reloadSmtp();
export const mailStatus = () => ({ ready: smtpReady, host: smtpHost });
/** Verbindung testen und eine Testmail schicken */
export async function testSmtp(to) {
  if (!smtpReady) return { ok: false, error: "Noch kein vollständiger SMTP-Zugang hinterlegt." };
  try {
    await transporter.verify();
    const cfg = getSetting("mail", DEFAULT_MAIL);
    const betreff = "Ihr Mailversand ist eingerichtet", text = `Hallo,\n\ndiese Nachricht bestätigt, dass Ihr Board E-Mails über das Postfach ${cfg.fromAddress} verschicken kann.\n\nSie müssen nichts weiter tun.\n\nViele Grüße\n${cfg.fromName}`;
    const html = mailHtml({ subject: betreff, text, vorschautext: "Der Versand über Ihr eigenes Postfach funktioniert.", an: "team" });
    await transporter.sendMail({ from: `"${cfg.fromName}" <${cfg.fromAddress}>`, to, subject: betreff, text, html });
    protokoll(to, betreff, text, html, "versendet", null, "testmail");
    return { ok: true };
  } catch (e) {
    const fehler = String(e.message || e);
    try { protokoll(to, "Testmail", "", null, "fehlgeschlagen", fehler, "testmail"); } catch {}
    return { ok: false, error: /sender address|not allowed|550/i.test(fehler) ? `Der Mailserver lehnt die Absenderadresse ab. Unter „Absender“ muss dieselbe Adresse stehen wie beim Benutzer des Postfachs. Bitte dort eintragen und speichern. (${fehler})` : /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(fehler) ? `Der Mailserver ist nicht erreichbar (${fehler}). Bitte Server und Port prüfen.` : /auth|535|credentials/i.test(fehler) ? `Der Mailserver lehnt die Anmeldung ab (${fehler}). Bitte Benutzer und Passwort prüfen.` : fehler };
  }
}

/**
 * Mail verschicken (oder nur protokollieren, wenn kein SMTP eingerichtet ist).
 * text = Klartext; html optional (sonst aus text gebaut); knopf = { label, url } optional; art = Vorlagen-Schlüssel fürs Protokoll;
 * firma = "software" | "hardware" (Absendername, Wortmarke und Fuß; Hardware nur, wenn die Hardware GmbH aktiv ist).
 */
export async function sendMail({ to, subject, text, html, knopf, attachments, art, firma = "software", an = "kunde" }) {
  const cfg = getSetting("mail", DEFAULT_MAIL), f = firmaDaten(firma);
  // Gleiche Absenderadresse, nur der Name wechselt mit der Firma
  const von = `"${String(f.firma === "hardware" ? f.name : cfg.fromName).replace(/["\r\n]/g, "")}" <${cfg.fromAddress}>`;
  text = String(text ?? "");
  // Steht der Knopf-Link nicht im Text, bekommt auch die Klartext-Fassung ihn (vor dem Gruß)
  if (knopf?.url && !text.includes(knopf.url)) text = linkInText(text, knopf);
  let fassung = html || null;
  if (!fassung) { try { fassung = mailHtml({ subject, text, knopf, firma: f, an }); } catch (e) { console.warn("E-Mail: HTML-Fassung nicht erzeugt –", e.message); } }
  text = ohneSternchen(text);   // Klartext ohne **Markierungen**
  if (an !== "team") text = `${text.replace(/\s+$/, "")}\n\n—\n${NICHT_ANTWORTEN}`;   // Kundenmails: gleiche Zeile wie im HTML-Fuß
  if (!smtpReady) { protokoll(to, subject, text, fassung, "nicht versendet – SMTP nicht eingerichtet", null, art || null); return false; }
  try {
    await transporter.sendMail({ from: von, to, subject, text, ...(fassung ? { html: fassung } : {}), attachments });
    protokoll(to, subject, text, fassung, "versendet", null, art || null);
    return true;
  } catch (e) {
    protokoll(to, subject, text, fassung, "fehlgeschlagen", String(e.message || e), art || null);
    return false;
  }
}

/* ======================================================================
   Gestaltete HTML-Fassung
   Tabellen-Layout mit Inline-CSS: Gmail, Outlook (Desktop und Web), Apple Mail, iOS.
   Keine externen Bilder, kein SVG, keine Pflicht-Webfonts.
   ====================================================================== */
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif`;
const F = {   // Farben
  grund: "#f5f5f7", karte: "#ffffff", tinte: "#1d1d1f", tinte2: "#424245", grau: "#86868b", linie: "#e8e8ed",
  knopf: "#8b5cf6", link: "#6d4ae0", akzent: "#8b5cf6", feld: "#f5f5f7",
};
// Wasserzeichen (Segel, blass, transparente PNG). Absolute Adresse, damit Mailprogramme es laden können.
const SEGEL = { breite: 58, hoehe: 80, pfad: "/assets/img/mail-segel.png" };
const siteUrl = () => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 5510}`).replace(/\/$/, "");
const VERLAUF = "linear-gradient(90deg,#4f7cff 0%,#8b5cf6 52%,#ec4899 100%)";

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const NUR_URL = /^\s*(https?:\/\/\S+)\s*$/;
const ANREDE = /^(hallo|guten\s+(tag|morgen|abend)|liebe[rs]?|sehr\s+geehrte[rs]?|hi|hey|moin|servus|grüß\s+gott)\b/i;
const GRUSS = /^((viele|beste|freundliche|herzliche|liebe|schöne|sonnige)\s+grüße|mit\s+(freundlichen|besten|herzlichen|lieben)\s+grüßen|(gruß|grüße|bis\s+bald|danke\s+und\s+viele\s+grüße)\b)/i;
const SCHLUESSEL = /^([A-Za-zÄÖÜäöüß][^:\n]{0,30}?):\s+(\S.*)$/;
const AUFZAEHLUNG = /^\s*[-•–·*]\s+(.+)$/;
const SCHRITT = /^(\d{1,2})\.\s+(\S.*)$/;     // „1. …“ – zählt nur als Block von mindestens zwei Zeilen
const HINWEIS = /^Hinweis:\s+(\S.*)$/;
const FETT = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
/** Klartext-Fassung: **Fett** ohne Sternchen */
export const ohneSternchen = s => String(s ?? "").replace(FETT, "$1");

/** Passende Beschriftung für einen Link, je nach Ziel */
export function knopfLabel(url) {
  const u = String(url || "").toLowerCase();
  if (/einladung|invite|passwort|password|reset|zugang-einrichten|setpw/.test(u)) return "Zugang einrichten";
  if (/meet\.google|meet\.jit\.si|jitsi|whereby\.com|zoom\.us|teams\.microsoft|teams\.live|webex/.test(u)) return "Zum Video-Gespräch";
  if (/fragebogen|onboarding/.test(u)) return "Fragebogen öffnen";
  if (/\/termin/.test(u)) return "Termin wählen";
  if (/\.ics(\?|$)|\/calendar\//.test(u)) return "Kalender abonnieren";
  if (/\/p\/[^/]+\//.test(u)) return "Entwurf ansehen";
  if (/\/portal/.test(u)) return "Zum Kundenportal";
  if (/\/admin/.test(u)) return "Im Board öffnen";
  return "Öffnen";
}

// Link-Zeile in den Klartext einfügen – vor dem Gruß, sonst ans Ende
function linkInText(text, knopf) {
  const zeilen = text.split(/\r?\n/), i = zeilen.findIndex(z => GRUSS.test(z.trim()));
  const block = [`${knopf.label || knopfLabel(knopf.url)}:`, knopf.url, ""];
  if (i < 0) return `${text.replace(/\s+$/, "")}\n\n${block.slice(0, 2).join("\n")}`;
  zeilen.splice(i, 0, ...block);
  return zeilen.join("\n");
}

// URLs im (bereits escapten) Fließtext zu Links machen; Satzzeichen am Ende gehören nicht zur Adresse
function verlinke(escaped) {
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, roh => {
    const m = roh.match(/^(.*?)((?:[.,;:!?)\]]|&#39;|&quot;)*)$/);
    const url = m[1], rest = m[2];
    return `<a href="${url}" target="_blank" style="color:${F.link};text-decoration:underline;word-break:break-word">${url}</a>${rest}`;
  });
}
// Escapen, **Fett** setzen, Links erzeugen
const zeile = s => verlinke(esc(s).replace(FETT, `<strong style="font-weight:700;color:${F.tinte}">$1</strong>`));
const normUrl = u => String(u || "").trim().replace(/[.,;:!?)]+$/, "");

/** Text in Bausteine zerlegen: Absatz, Übersicht (Schlüssel: Wert), Aufzählung, Link-Zeile, Gruß */
function zerlege(text) {
  const alle = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  // Gruß: ab der ersten Gruß-Zeile bis zum Ende
  const gi = alle.findIndex(z => GRUSS.test(z.trim()));
  const koerper = gi >= 0 ? alle.slice(0, gi) : alle;
  const gruss = gi >= 0 ? alle.slice(gi).map(z => z.trim()).filter(Boolean) : [];
  const teile = [];
  let absatz = [];
  const absatzEnde = () => { if (absatz.length) teile.push({ typ: "absatz", zeilen: absatz }); absatz = []; };
  // Erst in Blöcke (Leerzeilen), dann zeilenweise gruppieren
  const bloecke = []; let b = [];
  for (const z of koerper) { if (!z.trim()) { if (b.length) bloecke.push(b); b = []; } else b.push(z.trim()); }
  if (b.length) bloecke.push(b);
  bloecke.forEach((blk, bi) => {
    let i = 0;
    // Anrede in der ersten Zeile: eigener Absatz
    if (bi === 0 && blk.length > 1 && ANREDE.test(blk[0]) && blk[0].length < 90) { teile.push({ typ: "absatz", zeilen: [blk[0]] }); i = 1; }
    while (i < blk.length) {
      const z = blk[i];
      const url = z.match(NUR_URL);
      if (url) { absatzEnde(); teile.push({ typ: "link", url: url[1] }); i++; continue; }
      // Hinweis: eigener, dezent hinterlegter Kasten
      const hw = z.match(HINWEIS);
      if (hw) { absatzEnde(); teile.push({ typ: "hinweis", text: hw[1] }); i++; continue; }
      // Schritte: mindestens zwei Zeilen „1. …“, „2. …“ hintereinander
      let j = i; while (j < blk.length && SCHRITT.test(blk[j])) j++;
      if (j - i >= 2) { absatzEnde(); teile.push({ typ: "schritte", schritte: blk.slice(i, j).map(x => { const m = x.match(SCHRITT); return [m[1], m[2]]; }) }); i = j; continue; }
      // Übersicht: mindestens zwei „Schlüssel: Wert“-Zeilen hintereinander (ohne Hinweis-Zeilen)
      j = i; while (j < blk.length && SCHLUESSEL.test(blk[j]) && !HINWEIS.test(blk[j]) && !/^https?$/i.test(blk[j].match(SCHLUESSEL)[1])) j++;
      if (j - i >= 2) { absatzEnde(); teile.push({ typ: "uebersicht", paare: blk.slice(i, j).map(x => { const m = x.match(SCHLUESSEL); return [m[1].trim(), m[2].trim()]; }) }); i = j; continue; }
      // Aufzählung: mindestens zwei Zeilen mit Spiegelstrich
      j = i; while (j < blk.length && AUFZAEHLUNG.test(blk[j])) j++;
      if (j - i >= 2) { absatzEnde(); teile.push({ typ: "liste", punkte: blk.slice(i, j).map(x => x.match(AUFZAEHLUNG)[1]) }); i = j; continue; }
      absatz.push(z); i++;
    }
    absatzEnde();
  });
  return { teile, gruss };
}

/** Vorschautext: der erste Satz nach der Anrede, ohne Links */
function ersterSatz(teile) {
  const texte = [];
  for (const t of teile) {
    if (t.typ === "absatz") texte.push(t.zeilen.join(" "));
    else if (t.typ === "uebersicht") texte.push(t.paare.map(p => `${p[0]}: ${p[1]}`).join(" · "));
    if (texte.length >= 3) break;
  }
  if (texte.length && ANREDE.test(texte[0]) && texte[0].length < 90 && texte.length > 1) texte.shift();
  const s = ohneSternchen(texte.join(" ")).replace(URL_RE, "").replace(/\s+/g, " ").trim();
  const m = s.match(/^(.{20,}?[.!?])(\s|$)/);
  let satz = (m ? m[1] : s);
  if (satz.length > 150) satz = satz.slice(0, 147).replace(/\s+\S*$/, "") + " …";
  return satz.charAt(0).toUpperCase() + satz.slice(1);
}

// Knopf: lila Fläche, weiße Schrift, große Trefferfläche. Outlook bekommt die Polsterung über mso-padding-alt.
function knopfHtml({ label, url }, { haupt = true } = {}) {
  const u = esc(url), l = esc(label || knopfLabel(url));
  const bg = haupt ? F.knopf : F.karte, fg = haupt ? "#ffffff" : F.tinte, rand = haupt ? F.knopf : "#d2d2d7";
  const knopf = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="r-knopf" style="border-collapse:separate;mso-table-lspace:0;mso-table-rspace:0">
<tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border:1px solid ${rand};border-radius:12px;mso-padding-alt:15px 30px">
<a href="${u}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${fg};text-decoration:none;border-radius:12px;mso-padding-alt:0">${l}</a>
</td></tr></table>`;
  const ersatz = haupt ? `<p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${F.grau}">Falls der Knopf nicht funktioniert: <a href="${u}" target="_blank" style="color:${F.grau};text-decoration:underline;word-break:break-all">${u}</a></p>` : "";
  return `<tr><td class="r-pad" style="padding:${haupt ? "10px" : "2px"} 48px ${haupt ? "26px" : "18px"}">${knopf}${ersatz}</td></tr>`;
}

const absatzHtml = (inhalt, { abstand = 18, farbe = F.tinte2 } = {}) =>
  `<tr><td class="r-pad" style="padding:0 48px ${abstand}px;font-family:${FONT};font-size:16px;line-height:26px;color:${farbe}">${inhalt}</td></tr>`;

function uebersichtHtml(paare) {
  const reihen = paare.map(([k, v], i) => `<tr>
<td class="r-k" valign="top" width="34%" style="padding:12px 12px 12px 20px;${i ? `border-top:1px solid ${F.linie};` : ""}font-family:${FONT};font-size:14px;line-height:21px;color:${F.grau}">${esc(k)}</td>
<td class="r-v" valign="top" style="padding:12px 20px 12px 0;${i ? `border-top:1px solid ${F.linie};` : ""}font-family:${FONT};font-size:15px;line-height:21px;font-weight:600;color:${F.tinte}">${zeile(v)}</td></tr>`).join("");
  return `<tr><td class="r-pad" style="padding:4px 48px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${F.feld}" style="background-color:${F.feld};border-radius:14px;border-collapse:separate">${reihen}</table></td></tr>`;
}

function listeHtml(punkte) {
  const reihen = punkte.map(p => `<tr><td valign="top" width="18" style="padding:0 0 8px;font-family:${FONT};font-size:16px;line-height:26px;color:${F.akzent}">•</td><td style="padding:0 0 8px;font-family:${FONT};font-size:16px;line-height:26px;color:${F.tinte2}">${zeile(p)}</td></tr>`).join("");
  return `<tr><td class="r-pad" style="padding:0 48px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${reihen}</table></td></tr>`;
}

// Schritte: lila Kreis mit Ziffer links (Outlook zeigt ein Quadrat), Text rechts
function schritteHtml(schritte) {
  const reihen = schritte.map(([nr, t], i) => {
    const unten = i < schritte.length - 1 ? 14 : 0;
    return `<tr>
<td valign="top" width="26" style="width:26px;padding:0 0 ${unten}px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td width="26" height="26" align="center" valign="middle" bgcolor="${F.akzent}" style="width:26px;height:26px;border-radius:13px;background-color:${F.akzent};font-family:${FONT};font-size:13px;line-height:26px;mso-line-height-rule:exactly;font-weight:700;color:#ffffff;text-align:center">${esc(nr)}</td></tr></table>
</td>
<td valign="top" style="padding:0 0 ${unten}px 14px;font-family:${FONT};font-size:16px;line-height:26px;color:${F.tinte2}">${zeile(t)}</td></tr>`;
  }).join("");
  return `<tr><td class="r-pad" style="padding:2px 48px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${reihen}</table></td></tr>`;
}

// Hinweis: dezenter hellvioletter Kasten
const hinweisHtml = t => `<tr><td class="r-pad" style="padding:0 48px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
<td bgcolor="#f5f3ff" style="background-color:#f5f3ff;border-radius:12px;padding:14px 18px;font-family:${FONT};font-size:15px;line-height:23px;color:#4c1d95"><strong style="font-weight:700">Hinweis:</strong> ${zeile(t).replace(new RegExp(`color:${F.tinte}`, "g"), "color:#4c1d95")}</td>
</tr></table></td></tr>`;

// „Reeder“ fett, Zusatz grau – „Reeder Software“ bzw. „Reeder Hardware“
function wortmarke(f) {
  let erst = "Reeder", zusatz = f.brand;
  if (!zusatz) { const [a, ...rest] = String(f.name || "Reeder").trim().split(/\s+/); erst = a; zusatz = rest.filter(w => !/^(gmbh|ag|ug|kg|e\.k\.)$/i.test(w)).join(" "); }
  return `<span style="font-weight:700;color:${F.tinte};letter-spacing:-0.3px">${esc(erst)}</span>${zusatz ? ` <span style="font-weight:500;color:${F.grau}">${esc(zusatz)}</span>` : ""}`;
}

// Gruß links, Segel-Wasserzeichen rechts (feste Breite; ohne Bilder bleibt die Zelle einfach leer)
function grussHtml(gruss) {
  const [gz, ...name] = gruss;
  const links = gz ? `${zeile(gz)}${name.length ? `<br><span style="color:${F.tinte};font-weight:600">${zeile(name[0])}</span>${name.slice(1).map(z => `<br>${zeile(z)}`).join("")}` : ""}` : "&nbsp;";
  const bild = `<img src="${esc(siteUrl() + SEGEL.pfad)}" width="${SEGEL.breite}" height="${SEGEL.hoehe}" alt="" style="display:block;width:${SEGEL.breite}px;height:${SEGEL.hoehe}px;border:0;outline:none;text-decoration:none">`;
  return `<tr><td class="r-pad" style="padding:8px 48px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom" style="font-family:${FONT};font-size:15px;line-height:24px;color:${F.grau}">${links}</td>
<td valign="bottom" align="right" width="${SEGEL.breite}" style="width:${SEGEL.breite}px;padding-left:16px;font-size:0;line-height:0">${bild}</td>
</tr></table></td></tr>`;
}

/** Fußzeile jeder Kundenmail: Antworten bitte über das Kundenportal, nicht per E-Mail */
export const NICHT_ANTWORTEN = "Bitte antworten Sie nicht auf diese E-Mail – Nachrichten an uns schreiben Sie am besten im Kundenportal.";
function fussHtml(firma, an = "kunde") {
  const adr = [firma.street, [firma.zip, firma.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const web = String(firma.website || "").trim(), webUrl = web && (/^https?:\/\//i.test(web) ? web : `https://${web}`);
  const mail = String(firma.email || "").trim();
  const lnk = (href, t) => `<a href="${esc(href)}" target="_blank" style="color:${F.grau};text-decoration:none">${esc(t)}</a>`;
  const kontakt = [web && lnk(webUrl, web.replace(/^https?:\/\//i, "").replace(/\/$/, "")), mail && lnk(`mailto:${mail}`, mail)].filter(Boolean).join(" &nbsp;·&nbsp; ");
  const st = `font-family:${FONT};font-size:12px;line-height:19px;color:${F.grau}`;
  return `<tr><td class="r-fuss" align="center" style="padding:28px 40px 8px;${st}">
<span style="font-weight:600;color:${F.tinte2}">${esc(firma.name || "")}</span>${adr ? `<br>${esc(adr)}` : ""}${kontakt ? `<br>${kontakt}` : ""}
</td></tr>
<tr><td class="r-fuss" align="center" style="padding:10px 40px 40px;${st}">${an !== "team" ? `${esc(NICHT_ANTWORTEN)}<br>` : ""}Sie erhalten diese Nachricht im Rahmen Ihrer Anfrage bzw. Zusammenarbeit mit ${esc(firma.name || "uns")}.</td></tr>`;
}

/**
 * Vollständiges HTML-Dokument zu einer Mail.
 * subject = Betreff (auch als Überschrift), text = Klartext, knopf = { label, url } optional,
 * vorschautext = unsichtbarer Vorschautext im Posteingang (sonst der erste Satz),
 * firma = "software" | "hardware" (über firmaDaten) oder direkt ein Firmendaten-Objekt (z. B. für die Vorschau).
 * an = "kunde" (Vorgabe; Fuß mit „Bitte antworten Sie nicht …“) | "team" (ohne diese Zeile).
 */
export function mailHtml({ subject, text, knopf = null, vorschautext = "", firma = "software", an = "kunde" }) {
  const f = firma && typeof firma === "object" ? firma : firmaDaten(firma);
  const { teile, gruss } = zerlege(text);
  const vorschau = String(vorschautext || ersterSatz(teile) || "").trim();

  // Knopf platzieren: an der Stelle, wo sein Link im Text steht – sonst vor dem Gruß
  const kUrl = knopf?.url ? normUrl(knopf.url) : null;
  let hauptGesetzt = false;
  const rows = [];
  for (const t of teile) {
    if (t.typ === "absatz") rows.push(absatzHtml(t.zeilen.map(zeile).join("<br>")));
    else if (t.typ === "uebersicht") rows.push(uebersichtHtml(t.paare));
    else if (t.typ === "liste") rows.push(listeHtml(t.punkte));
    else if (t.typ === "schritte") rows.push(schritteHtml(t.schritte));
    else if (t.typ === "hinweis") rows.push(hinweisHtml(t.text));
    else if (t.typ === "link") {
      const u = normUrl(t.url);
      if (kUrl && u === kUrl && !hauptGesetzt) { rows.push(knopfHtml({ label: knopf.label, url: knopf.url })); hauptGesetzt = true; }
      else if (!kUrl && !hauptGesetzt) { rows.push(knopfHtml({ url: u })); hauptGesetzt = true; }
      else rows.push(knopfHtml({ url: u }, { haupt: false }));
    }
  }
  if (kUrl && !hauptGesetzt) rows.push(knopfHtml({ label: knopf.label, url: knopf.url }));
  if (gruss.length) rows.push(grussHtml(gruss));   // ohne Gruß (Team-Mails) auch kein Wasserzeichen – sonst bliebe eine leere Fläche

  const preheader = vorschau ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(vorschau)}${"&#8199;&#847;&zwnj;&nbsp;".repeat(40)}</div>` : "";

  return `<!doctype html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light;supported-color-schemes:light}
html,body{margin:0!important;padding:0!important;width:100%!important;background-color:${F.grund}}
body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{mso-table-lspace:0;mso-table-rspace:0}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
u+#body a{color:inherit;text-decoration:none}
@media only screen and (max-width:599px){
  .r-aussen{padding:0!important}
  .r-karte{border-radius:0!important}
  .r-pad{padding-left:24px!important;padding-right:24px!important}
  .r-kopf{padding:28px 24px 0!important}
  .r-titel{padding:20px 24px 16px!important;font-size:22px!important;line-height:28px!important}
  .r-fuss{padding-left:24px!important;padding-right:24px!important}
  .r-knopf{width:100%!important}
  .r-knopf a{display:block!important}
  .r-k{width:40%!important}
}
</style>
</head>
<body id="body" style="margin:0;padding:0;background-color:${F.grund};word-spacing:normal">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${F.grund}" style="background-color:${F.grund}">
<tr><td align="center" class="r-aussen" style="padding:40px 16px 0">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${F.karte}" class="r-karte" style="background-color:${F.karte};border-radius:20px;border-collapse:separate;overflow:hidden">
<tr><td height="4" bgcolor="${F.akzent}" style="height:4px;font-size:0;line-height:0;background-color:${F.akzent};background-image:${VERLAUF};border-radius:20px 20px 0 0">&nbsp;</td></tr>
<tr><td class="r-kopf" style="padding:36px 48px 0;font-family:${FONT};font-size:17px;line-height:22px">${wortmarke(f)}</td></tr>
<tr><td class="r-titel" style="padding:28px 48px 18px;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.4px;color:${F.tinte}">${esc(subject)}</td></tr>
${rows.join("\n")}
<tr><td height="40" style="height:40px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
</td></tr>
${fussHtml(f, an)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

export function icsFor(b, { method = "PUBLISH", title } = {}) {
  const z = d => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(Date.parse(b.start) + b.minutes * 60000);
  const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
  return [
    "BEGIN:VEVENT", `UID:termin-${b.id}@reeder-software.de`, `DTSTAMP:${z(new Date())}`,
    `DTSTART:${z(b.start)}`, `DTEND:${z(end)}`,
    `SUMMARY:${esc(title || `${b.typeLabel || b.type}${b.product ? " · " + b.product : ""} – ${b.name}`)}`,
    `DESCRIPTION:${esc([b.company && `Unternehmen: ${b.company}`, `E-Mail: ${b.email}`, b.phone && `Telefon: ${b.phone}`, b.channel && `Gespräch: ${b.channel}`, b.message].filter(Boolean).join("\n"))}`,
    b.video_url ? `LOCATION:${esc(b.video_url)}` : null, b.video_url ? `URL:${b.video_url}` : null,
    method === "CANCEL" ? "STATUS:CANCELLED" : `STATUS:${b.status === "bestaetigt" ? "CONFIRMED" : "TENTATIVE"}`,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
export const icsCalendar = (events, name = "Reeder Software – Termine") =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reeder Software GmbH//Admin//DE", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${name}`, "X-WR-TIMEZONE:Europe/Berlin", ...events, "END:VCALENDAR"].join("\r\n");
