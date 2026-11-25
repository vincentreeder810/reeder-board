// Setzt das Passwort eines Admin-Zugangs aus der Datei .env (VINCENT_EMAIL / VINCENT_PASSWORD).
// Aufruf:  npm run passwort
// Danach sind alle bestehenden Anmeldungen dieses Zugangs abgemeldet.
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "./db.mjs";

const email = String(process.env.VINCENT_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const pw = String(process.env.VINCENT_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!email || !pw) { console.error("In der .env fehlen VINCENT_EMAIL und/oder VINCENT_PASSWORD."); process.exit(1); }
if (pw.length < 10) { console.error("Das Passwort in der .env ist kürzer als 10 Zeichen – bitte ein längeres wählen."); process.exit(1); }

const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`;
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (user) {
  db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(hash, user.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  console.log(`Passwort für ${email} gesetzt. Bitte im Admin-Board neu anmelden.`);
} else {
  db.prepare("INSERT INTO users(email, name, pw_hash) VALUES(?, ?, ?)").run(email, "Vincent", hash);
  console.log(`Admin-Zugang für ${email} neu angelegt.`);
}
