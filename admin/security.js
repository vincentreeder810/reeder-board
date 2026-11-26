/* Board – Anmeldung mit Code, Passwort vergessen, Zwei-Faktor-Einrichtung, Checkliste „Livegang“ (nutzt $, $$, esc, api, toast, fmt, ME, UI, start, showLogin) */
(() => {
  const pub = async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Fehler"); return d; };
  const cards = ["loginForm", "codeForm", "forgotForm", "resetForm", "teamInvite"];
  const showCard = id => { $("#app").hidden = true; $("#login").hidden = false; cards.forEach(c => { const el = $("#" + c); if (el) el.hidden = c !== id; }); };
  let challenge = null, resetToken = null;

  function askCode(ch) { challenge = ch; showCard("codeForm"); $("#codeErr").hidden = true; const f = $("#codeForm"); f.reset(); setTimeout(() => f.code.focus(), 50); }
  $("#codeForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target, b = $("button[type=submit]", f); b.disabled = true;
    try { const d = await pub("/api/login/2fa", { challenge, code: f.code.value }); history.replaceState(null, "", "/admin/#cockpit"); showCard("loginForm"); await start(); if (d.warn) toast(d.warn); }
    catch (err) { $("#codeErr").textContent = err.message; $("#codeErr").hidden = false; if (/abgelaufen/.test(err.message)) setTimeout(() => showCard("loginForm"), 1800); }
    finally { b.disabled = false; }
  });
  $("#forgotForm").addEventListener("submit", async e => {
    e.preventDefault(); const b = $("button[type=submit]", e.target); b.disabled = true;
    const d = await pub("/api/password/forgot", { email: e.target.email.value }).catch(err => ({ message: err.message }));
    $("#forgotOk").textContent = d.message; $("#forgotOk").hidden = false; b.disabled = false;
  });
  $("#resetForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target, err = $("#resetErr");
    if (f.password.value !== f.password2.value) { err.textContent = "Die beiden Passwörter stimmen nicht überein."; err.hidden = false; return; }
    try { await pub("/api/password/reset", { token: resetToken, password: f.password.value }); history.replaceState(null, "", "/admin/"); showCard("loginForm"); toast("Passwort gespeichert – bitte jetzt anmelden."); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  document.addEventListener("click", e => { const a = e.target.closest("[data-auth]")?.dataset.auth; if (!a) return;
    if (a === "forgot") { showCard("forgotForm"); $("#forgotOk").hidden = true; $("#forgotForm").email.value = $("#loginForm").email.value; }
    if (a === "back") showCard("loginForm"); });
  /** Links aus E-Mails (#passwort=…) und aus dem Portal (#code=…) – true, wenn behandelt */
  function fromHash() {
    const pw = (location.hash.match(/passwort=([a-f0-9]{64})/) || [])[1], code = (location.hash.match(/code=([a-f0-9]{48})/) || [])[1];
    if (pw) { resetToken = pw; showCard("resetForm"); pub("/api/password/reset", { token: pw, check: true }).catch(err => { $("#resetErr").textContent = err.message; $("#resetErr").hidden = false; }); return true; }
    if (code) { askCode(code); return true; }
    return false;
  }

  /* ---------- Mein Zugang: Zwei-Faktor ---------- */
  async function loadTfa() {
    const box = $("#tfaCard"); if (!box) return;
    const s = await api("/security/me");
    const logins = s.logins.length ? `<h3 style="margin:16px 0 0;font-size:14px">Letzte Anmeldungen</h3><div class="loginlog">${s.logins.map(l => `<div><span>${l.ok ? "✓" : "✕"}</span><span>${esc(l.reason || (l.ok ? "Passwort" : "fehlgeschlagen"))}<small> · ${esc(l.ip || "")}</small></span><small>${fmt(l.created_at.replace(" ", "T") + "Z", { dateStyle: "short", timeStyle: "short" })}</small></div>`).join("")}</div>
      <p class="hint" style="margin:8px 0 0">Eine Anmeldung, die Sie nicht kennen? Sofort Passwort ändern.</p>` : "";
    box.innerHTML = s.totp
      ? `<div class="tfa"><h2 style="margin:0">Zwei-Faktor-Anmeldung</h2><div class="tfa__on"><span class="kst kst--gut"><i>✓</i>Aktiv</span><span class="hint" style="margin:0">Beim Anmelden wird zusätzlich der Code aus Ihrer App abgefragt. Noch ${s.backupLeft} Notfallcode${s.backupLeft === 1 ? "" : "s"} übrig.</span></div>
          <button class="btn btn--ghost btn--sm" style="justify-self:start" data-tfa="off">Ausschalten …</button></div>${logins}`
      : `<div class="tfa"><h2 style="margin:0">Zwei-Faktor-Anmeldung</h2><p class="hint" style="margin:0">Schützt Ihren Zugang, selbst wenn jemand Ihr Passwort kennt: Beim Anmelden geben Sie zusätzlich einen Code aus einer App ein (z. B. Google Authenticator, Microsoft Authenticator, 1Password). <b>Für Inhaber vor dem Livegang dringend empfohlen.</b></p>
          <button class="btn btn--grad btn--sm" style="justify-self:start" data-tfa="setup">Jetzt einrichten</button></div>${logins}`;
  }
  $("#app").addEventListener("click", async e => {
    const a = e.target.closest("[data-tfa]")?.dataset.tfa; if (!a) return;
    try {
      if (a === "setup") {
        const s = await api("/security/2fa/setup", { method: "POST", body: {} });
        $("#tfaCard").innerHTML = `<form class="tfa" id="tfaForm"><h2 style="margin:0">Zwei-Faktor einrichten</h2>
          <ol class="tfa__steps"><li>Authenticator-App auf dem Handy öffnen → „Konto hinzufügen“ → „Schlüssel eingeben“.</li><li>Diesen Schlüssel eintragen (Art: zeitbasiert):</li></ol>
          <div class="tfa__key">${esc(s.secret.match(/.{1,4}/g).join(" "))}</div>
          <p class="hint" style="margin:0">Am Handy geöffnet? <a href="${esc(s.uri)}">Direkt in der App hinzufügen</a></p>
          <label>3. Den angezeigten 6-stelligen Code eingeben<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
          <div style="display:flex;gap:8px"><button type="button" class="btn btn--ghost btn--sm" data-tfa="cancel">Abbrechen</button><button class="btn btn--grad btn--sm">Aktivieren</button></div></form>`;
        $("#tfaForm").addEventListener("submit", async ev => { ev.preventDefault();
          try { const r = await api("/security/2fa/enable", { method: "POST", body: { code: ev.target.code.value } });
            $("#tfaCard").innerHTML = `<div class="tfa"><h2 style="margin:0">Aktiv – bitte Notfallcodes sichern</h2><p class="hint" style="margin:0">Falls das Handy verloren geht: Jeder Code funktioniert genau einmal statt des App-Codes. Ausdrucken oder im Passwort-Manager ablegen – sie werden nur jetzt angezeigt.</p>
              <div class="tfa__codes">${r.backupCodes.map(c => `<span>${esc(c)}</span>`).join("")}</div><button class="btn btn--grad btn--sm" style="justify-self:start" data-tfa="done">Habe ich gesichert</button></div>`; }
          catch (err) { toast(err.message); } });
      }
      if (a === "cancel" || a === "done") loadTfa();
      if (a === "off") { const pw = await UI.prompt("Zwei-Faktor ausschalten", { text: "Danach reicht wieder das Passwort allein.", label: "Ihr Passwort zur Bestätigung", type: "password", ok: "Ausschalten" }); if (!pw) return;
        await api("/security/2fa/disable", { method: "POST", body: { password: pw } }); toast("Zwei-Faktor ausgeschaltet"); loadTfa(); }
    } catch (err) { toast(err.message); }
  });

  /* ---------- Einstellungen: Livegang ---------- */
  async function loadGoLive() {
    const [c, logins] = await Promise.all([api("/livegang"), api("/security/logins").catch(() => [])]);
    const pct = Math.round(c.done / c.total * 100), fails = logins.filter(l => !l.ok && Date.now() - Date.parse(l.created_at.replace(" ", "T") + "Z") < 864e5).length;
    $("#goBody").innerHTML = `<div class="autogrid"><div class="stack">
      <div class="card"><div class="gohead"><div class="goring" style="--p:${pct}%"><span>${c.done}/${c.total}</span></div>
        <div><h2 style="margin:0">${c.ready ? "Bereit für den Livegang" : "Vor dem Livegang"}</h2><p class="hint" style="margin:4px 0 0">Das Board bleibt lokal, bis Sie es ausdrücklich freigeben. Diese Liste zeigt, was vorher erledigt sein sollte. Die Schritte zum Server stehen in <b>LIVEGANG.txt</b> im Projektordner.</p></div></div>
        <h3 class="swh3">Prüft das Board selbst</h3><div class="golist">${c.auto.map(x => `<div class="goitem ${x.ok ? "ok" : "no"}"><span class="gomark">${x.ok ? "✓" : "!"}</span><span><b>${esc(x.t)}</b><p>${esc(x.d)}</p></span>${x.href && !x.ok ? `<a href="${x.href}">Erledigen →</a>` : "<span></span>"}</div>`).join("")}</div>
        <h3 class="swh3">Bestätigen Sie selbst</h3><div class="golist">${c.manual.map(x => `<label class="goitem ${x.ok ? "ok" : ""}" style="cursor:pointer"><span class="gomark">${x.ok ? "✓" : ""}</span><span><b>${esc(x.t)}</b><p>${esc(x.d)}</p>${x.ok ? `<small>bestätigt von ${esc(x.by)} am ${fmt(x.at, { dateStyle: "short" })}</small>` : ""}</span><input type="checkbox" data-go="${x.k}" ${x.ok ? "checked" : ""} style="width:18px;height:18px;accent-color:#7c3aed"></label>`).join("")}</div></div>
    </div><div class="stack">
      <div class="card"><h2>Anmeldungen</h2><p class="hint" style="margin:-6px 0 8px">${fails ? `<b class="warn">${fails} fehlgeschlagene Anmeldungen in den letzten 24 Std.</b>` : "Keine Auffälligkeiten in den letzten 24 Stunden."} Nach 10 Fehlversuchen wird eine Adresse 15 Minuten gesperrt.</p>
        <div class="loginlog">${logins.slice(0, 25).map(l => `<div><span>${l.ok ? "✓" : "✕"}</span><span>${esc(l.who || l.email || "unbekannt")}<small> · ${l.kind === "client" ? "Kunde" : l.kind === "team" ? "Team" : "?"} · ${esc(l.reason || "")} · ${esc(l.ip || "")}</small></span><small>${fmt(l.created_at.replace(" ", "T") + "Z", { dateStyle: "short", timeStyle: "short" })}</small></div>`).join("") || `<p class="hint">Noch keine Einträge.</p>`}</div></div>
      <div class="card"><h2>Komplettsicherung</h2><p class="hint" style="margin:-6px 0 12px">Datenbank und alle Dateien (Dokumente, Belege, Prototypen) in einer ZIP-Datei – zum Ablegen außerhalb des Servers oder für den Umzug.</p>
        <a class="btn btn--ghost btn--sm" href="/api/admin/betrieb/komplett" download>Komplettsicherung herunterladen</a></div>
      <div class="card" id="brueckeKarte"><h2>Brücke zu Claude</h2><p class="hint" style="margin:-6px 0 12px">Damit „Mit Claude besprechen“ auch vom Online-Board aus funktioniert, läuft auf Ihrem Rechner ein kleines Hilfsprogramm. Es legt den Projektordner an, öffnet die Claude-App und gleicht das Konzept ab.</p>
        <p id="brueckeStand" style="margin:0 0 12px;font-weight:600">…</p>
        <button class="btn btn--ghost btn--sm" id="brueckeKey">Schlüssel erzeugen</button></div>
      <div class="card"><h2>Testbetrieb: von vorn beginnen</h2><p class="hint" style="margin:-6px 0 12px">Entfernt alle Kunden, Kontakte, Termine, Fragebögen, Projekte, Angebote, Rechnungen und Dateien. Ihr Zugang, die Einstellungen (Firma, E-Mail, Verfügbarkeit) und die Vertragstexte bleiben. Vorher entsteht automatisch eine Sicherung. Nur für die Testphase – im echten Betrieb müssen Rechnungen aufbewahrt werden.</p>
        <button class="btn btn--danger btn--sm" id="allesLeeren">Alle Testdaten löschen …</button></div>
    </div></div>`;
    const brStand = async () => { try { const b = await api("/bruecke"), el = $("#brueckeStand"); if (!el) return;
      el.innerHTML = b.verbunden ? `<span style="color:#16774f">● Verbunden</span> – Ihr Rechner ist erreichbar.` : b.eingerichtet ? `<span class="warn">● Nicht verbunden</span> – auf Ihrem Rechner „Brücke starten“ ausführen.` : "Noch nicht eingerichtet.";
      $("#brueckeKey").textContent = b.eingerichtet ? "Neuen Schlüssel erzeugen" : "Schlüssel erzeugen"; } catch {} };
    brStand();
    $("#brueckeKey")?.addEventListener("click", async () => {
      if ($("#brueckeKey").textContent.startsWith("Neuen") && !(await UI.confirm("Der bisherige Schlüssel wird ungültig. Die Brücke auf Ihrem Rechner braucht danach den neuen.", { title: "Neuen Schlüssel erzeugen?", ok: "Erzeugen" }))) return;
      try { const r = await api("/bruecke/schluessel", { method: "POST", body: {} });
        UI.link("Schlüssel für die Brücke", "Kopieren Sie den Schlüssel und fügen Sie ihn beim Start der Brücke auf Ihrem Rechner ein. Er wird nur dieses eine Mal angezeigt.", r.schluessel); brStand(); }
      catch (err) { toast(err.message); }
    });
    $("#allesLeeren")?.addEventListener("click", async () => {
      const t = await UI.prompt("Alle Testdaten löschen", { text: "Alle Kunden und alles, was dazugehört, wird entfernt. Das lässt sich nur über die Sicherung rückgängig machen.", label: "Zur Bestätigung bitte eintippen: ALLES LÖSCHEN", value: "", ok: "Endgültig löschen" });
      if (t === null) return;
      try { const r = await api("/betrieb/leeren", { method: "POST", body: { bestaetigung: t } });
        toast(`Geleert. Sicherung: ${r.sicherung}.${r.neustart ? " Der Server startet kurz neu." : ""}`); setTimeout(() => location.reload(), r.neustart ? 9000 : 1200); }
      catch (err) { toast(err.message); }
    });
    $$("#goBody [data-go]").forEach(cb => cb.addEventListener("change", async () => { try { await api("/livegang", { method: "PUT", body: { [cb.dataset.go]: cb.checked } }); loadGoLive(); } catch (err) { toast(err.message); } }));
  }
  window.AUTH = { askCode, fromHash, loadTfa, loadGoLive };
})();
