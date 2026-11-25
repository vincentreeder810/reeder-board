// Demo-Board: dieselbe Software mit eigener Datenbank (data-demo/) auf Port 5520.
// E-Mails sind hier grundsätzlich abgeschaltet – sie landen nur im Postausgang.
// Start: npm run demo   →   http://localhost:5520/admin
process.env.PORT ||= "5520";
process.env.DATA_DIR = "data-demo";
process.env.MAIL_DISABLED = "1";
process.env.COOKIE_PREFIX = "rsdemo";   // eigene Anmeldung – stört das echte Board (5510) nicht
process.env.COVERED_DISABLED = "1";     // Demo-Daten nie an Covered melden
process.env.SITE_URL ||= `http://localhost:${process.env.PORT}`;
await import("./server.mjs");
