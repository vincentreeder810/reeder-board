// E-Mail-Versand über Ihr eigenes Postfach (SMTP). Ohne SMTP-Daten landen Mails nur im Postausgang des Admin-Boards.
import { db, getSetting, DEFAULT_MAIL } from "./db.mjs";

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
    await transporter.sendMail({ from: `"${cfg.fromName}" <${cfg.fromAddress}>`, to, subject: betreff, text });
    db.prepare("INSERT INTO outbox(to_addr, subject, body, status) VALUES(?, ?, ?, ?)").run(to, betreff, text, "versendet");
    return { ok: true };
  } catch (e) {
    const fehler = String(e.message || e);
    try { db.prepare("INSERT INTO outbox(to_addr, subject, body, status, error) VALUES(?, ?, ?, ?, ?)").run(to, "Testmail", "", "fehlgeschlagen", fehler); } catch {}
    return { ok: false, error: /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(fehler) ? `Der Mailserver ist nicht erreichbar (${fehler}). Bitte Server und Port prüfen.` : /auth|535|credentials/i.test(fehler) ? `Der Mailserver lehnt die Anmeldung ab (${fehler}). Bitte Benutzer und Passwort prüfen.` : fehler };
  }
}

export async function sendMail({ to, subject, text, attachments }) {
  const cfg = getSetting("mail", DEFAULT_MAIL);
  const ins = db.prepare("INSERT INTO outbox(to_addr, subject, body, status) VALUES(?, ?, ?, ?)");
  if (!smtpReady) { ins.run(to, subject, text, "nicht versendet – SMTP nicht eingerichtet"); return false; }
  try {
    await transporter.sendMail({ from: `"${cfg.fromName}" <${cfg.fromAddress}>`, to, subject, text, attachments });
    ins.run(to, subject, text, "versendet");
    return true;
  } catch (e) {
    db.prepare("INSERT INTO outbox(to_addr, subject, body, status, error) VALUES(?, ?, ?, ?, ?)").run(to, subject, text, "fehlgeschlagen", String(e.message || e));
    return false;
  }
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
