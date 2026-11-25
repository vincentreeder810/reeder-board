/* Board – Einstellungen „Nova (Covered)“ (nutzt $, esc, api, toast, fmt) */
(() => {
  const KIND = { appointment: "Termin", abgesagt: "Absage", briefing: "Briefing", message: "Meldung" };
  const when = iso => iso ? fmt(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
  const pill = (good, text) => `<span class="kst kst--${good ? "gut" : "achtung"}"><i>${good ? "✓" : "!"}</i>${esc(text)}</span>`;

  async function load() {
    const s = await api("/covered"), box = $("#covBody");
    const sum = Object.entries(s.counts || {}).map(([k, n]) => `${n} ${KIND[k] || k}${n === 1 ? "" : k === "abgesagt" ? "n" : k === "message" ? "en" : "e"}`).join(" · ");
    const status = !s.configured
      ? (s.disabled ? pill(false, "Im Demo-Board abgeschaltet") : pill(false, "Noch nicht eingerichtet"))
      : !s.enabled ? pill(false, "Pausiert")
      : s.lastError && (!s.lastOk || s.lastError.at > s.lastOk) ? pill(false, `Zuletzt fehlgeschlagen: ${s.lastError.error}`)
      : pill(true, s.lastOk ? "Verbunden" : "Eingerichtet – wartet auf erste Übertragung");
    box.innerHTML = `<div class="autogrid">
      <div class="stack">
        <div class="card"><h2>Verbindung zu Nova</h2>
          <p class="hint" style="margin:-6px 0 14px">Das Board meldet neue Termine, Anfragen, Kundennachrichten und Briefings an Nova in der Covered-App. Termine landen in Ihrem Kalender, Wichtiges kommt als Push aufs Handy. Ist Covered nicht erreichbar, läuft das Board ganz normal weiter und holt die Meldungen später nach.</p>
          <p style="margin:0 0 12px">${status}</p>
          ${s.configured ? `<p class="hint" style="margin:0 0 12px">Adresse: ${esc(s.url)}${s.pausedUntil ? ` · nächster Versuch ab ${when(s.pausedUntil)}` : ""}</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button class="btn btn--ghost btn--sm" id="covTest" type="button">Verbindung testen</button>
              <button class="btn btn--ghost btn--sm" id="covSync" type="button">Jetzt abgleichen</button>
              <label class="check" style="margin-left:auto"><input type="checkbox" id="covOn" ${s.enabled ? "checked" : ""}> <span>Meldungen senden</span></label></div>
            <p id="covResult" class="hint" style="margin:12px 0 0"></p>`
          : s.disabled ? `<p class="hint" style="margin:0">Das Demo-Board sendet absichtlich nichts an Covered – sonst kämen Demo-Termine in Ihren echten Kalender.</p>`
          : `<ol class="hint" style="margin:0;padding-left:18px;line-height:1.7">
              <li>In der Covered-App: Menü › Kalender und Verbindungen › Andere Programme › neuen Schlüssel anlegen (Erlaubnisse calendar, inbox, notify, nova).</li>
              <li>In der Datei <code>.env</code> eintragen:<br><code>COVERED_API_URL=https://nova-9zlg.onrender.com/api/connect/v1</code><br><code>COVERED_API_KEY=cov_…</code></li>
              <li>Board neu starten, dann hier „Verbindung testen“.</li></ol>`}
        </div>
      </div>
      <div class="stack">
        <div class="card"><h2>Was gemeldet wird</h2>
          <ul class="hint" style="margin:0;padding-left:18px;line-height:1.7">
            <li><b>Termine</b> – bestätigt, verschoben oder abgesagt: direkt in Ihren Kalender, mit Videolink.</li>
            <li><b>Neue Buchungen, Projekt- und Terminanfragen</b> – als Meldung mit Push.</li>
            <li><b>Kundennachrichten und Anmerkungen</b> – gesammelt, eine Meldung je Kunde und Stunde, ohne Push.</li>
            <li><b>Nach dem Termin</b> – Zusammenfassung und nächste Schritte als Briefing am Termin.</li></ul>
          <p class="hint" style="margin:12px 0 0">Ältere Anfragen und Nachrichten von vor der Einrichtung werden nicht nachgemeldet, kommende Termine schon.</p></div>
        ${s.configured ? `<div class="card"><h2>Zuletzt übertragen</h2>
          ${sum ? `<p class="hint" style="margin:-6px 0 10px">Insgesamt: ${esc(sum)}</p>` : ""}
          ${(s.recent || []).length ? `<div class="autolog">${s.recent.map(r => `<div class="alog"><span class="alog__k">${esc(KIND[r.kind] || r.kind)}</span><div><p>${esc(r.key)}${r.error ? ` <span class="warn">– abgelehnt: ${esc(r.error)}</span>` : ""}</p><small>${when(r.sent_at)}</small></div></div>`).join("")}</div>` : `<p class="hint" style="margin:0">Noch nichts übertragen.</p>`}</div>` : ""}
      </div></div>`;
    $("#covTest")?.addEventListener("click", async e => { e.target.disabled = true; const out = $("#covResult"); out.textContent = "Prüfe …";
      try { const r = await api("/covered/test", { method: "POST", body: {} });
        out.innerHTML = r.ok ? `✓ Verbunden${r.firstName ? ` mit ${esc(r.firstName)}s` : ""} ${esc(r.assistantName)} · Erlaubnisse: ${esc((r.scopes || []).join(", ") || "–")}` : `<span class="warn">Nicht verbunden: ${esc(r.error)}</span>`;
      } catch (err) { out.innerHTML = `<span class="warn">${esc(err.message)}</span>`; } e.target.disabled = false; });
    $("#covSync")?.addEventListener("click", async e => { e.target.disabled = true;
      try { const r = await api("/covered/sync", { method: "POST", body: {} }); toast(r.lastError && !r.sent ? `Nicht übertragen: ${r.lastError.error}` : `${r.sent} Meldung${r.sent === 1 ? "" : "en"} übertragen`); load(); } catch (err) { toast(err.message); e.target.disabled = false; } });
    $("#covOn")?.addEventListener("change", async e => { try { await api("/covered", { method: "PUT", body: { enabled: e.target.checked } }); toast(e.target.checked ? "Meldungen an" : "Meldungen pausiert"); load(); } catch (err) { toast(err.message); } });
  }
  window.COVUI = { load };
})();
