/* Board – Einstellungen > KI-Assistent (Baustein H4): Status, Modelle, Monatsgrenze, Regeln, Verbrauch. Nutzt $, esc, api, toast, DD. */
(() => {
  const eur = v => (v || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
  const STATUS = { offen: "Varianten angeboten", rueckfrage: "Rückfrage an Kunden", geklaert: "Vom Kunden gewählt", "beim Team": "Ans Team (mittel)", weitergeleitet: "An Inhaber (groß)", fehler: "Fehler", denkt: "Läuft" };
  async function load() {
    const d = await api("/assistant"), s = d.settings, st = d.status;
    const models = d.models.map(m => ({ v: m.id, l: m.label }));
    const prices = d.models.map(m => `${m.label.split(" – ")[0]}: ${String(m.price[0]).replace(".", ",")} $ / ${String(m.price[1]).replace(".", ",")} $`).join(" · ");
    const state = !st.key && !st.mock ? `<span class="pill pill--abgesagt">● Kein API-Schlüssel</span> Tragen Sie in der Datei <code>.env</code> im Projektordner <code>ANTHROPIC_API_KEY=…</code> ein und starten Sie den Server neu. Bis dahin läuft alles wie bisher – nur ohne Assistent.`
      : !st.enabled ? `<span class="pill">● Ausgeschaltet</span> Kunden sehen keinen Assistenten.`
      : st.spent >= st.cap ? `<span class="pill pill--abgesagt">● Monatsgrenze erreicht</span> Der Assistent pausiert bis zum Monatsanfang oder bis Sie die Grenze erhöhen.`
      : `<span class="pill pill--bestaetigt">● Aktiv</span>${st.mock ? " (Testmodus ohne KI)" : ""} Kunden bekommen nach jeder Anmerkung sofort eine Antwort.`;
    const total = d.usage.reduce((x, u) => x + u.cost, 0), calls = d.usage.reduce((x, u) => x + u.calls, 0);
    $("#kiBody").innerHTML = `<div class="autogrid"><form class="card" id="kiForm">
        <h2>KI-Assistent im Kundenportal</h2><p class="hint" style="margin:-6px 0 14px">${state}</p>
        <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> Assistent für Kunden einschalten</label>
        <div class="kigrid">
          <label><span>Element erkennen (Stufe 1)</span>${DD.html("kiRec", models, s.modelRecognize, { field: "modelRecognize" })}<small class="hint">Ordnet grobe Kringel, Pfeile und reine Textwünsche dem richtigen Element zu. Ein kleines Modell reicht.</small></label>
          <label><span>Antworten & Varianten (Stufe 2)</span>${DD.html("kiRep", models, s.modelReply, { field: "modelReply" })}<small class="hint">Formuliert die Antwort an den Kunden und die Vorschläge zum Antippen.</small></label>
          <label><span>Monatsgrenze (Dollar)</span><input name="monthCap" type="number" min="1" max="5000" step="1" value="${s.monthCap}"><small class="hint">Darüber pausiert der Assistent automatisch. Zusätzlich empfohlen: Limit im Anthropic-Konto.</small></label>
          <label><span>Annahmeschluss (Uhr)</span><input name="cutoff" type="number" min="8" max="23" value="${s.cutoff}"><small class="hint">Kleine Wünsche bis dahin: sichtbar „${esc(d.when)}“ (Stand jetzt).</small></label>
          <label><span>Ansprechpartner für große Wünsche</span><input name="contact" maxlength="80" value="${esc(s.contact)}"></label>
          <label><span>Zusage für große Wünsche</span><input name="bigPromise" maxlength="120" value="${esc(s.bigPromise)}"><small class="hint">z. B. „bis zum nächsten Werktag um 12 Uhr“ – große Wünsche werden zusätzlich eine Aufgabe für Sie.</small></label>
        </div>
        <p class="hint" style="margin:12px 0 0;font-size:12px">Preise je 1 Mio. Token (Eingabe / Ausgabe) – ${esc(prices)}. Eine Erkennung kostet mit Haiku etwa 0,05 Cent, eine Antwort mit Opus etwa 2–4 Cent (Schätzung – der echte Verbrauch steht rechts).</p>
        <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn--grad btn--sm">Speichern</button></div>
        <details class="kirules"><summary>So arbeitet der Assistent</summary><ul>
          <li><b>Klein</b> (Texte, Größen, Farben, Abstände): bietet bis zu drei Varianten mit Live-Vorschau an. Gewählt wird ein genauer Änderungswunsch – umgesetzt und freigegeben wird von Ihrem Team.</li>
          <li><b>Mittel</b> (neuer Abschnitt, Layout): bedankt sich, gibt ans Team weiter.</li>
          <li><b>Groß</b> (Funktionen, Preise, Daten, Umfang): keine Zusage, Aufgabe für ${esc(s.contact)} mit Frist morgen.</li>
          <li>Ist unklar, was gemeint ist, fragt er mit Auswahlknöpfen nach. Er nennt nie Preise und ändert nie selbst etwas.</li>
          <li>Kunden sehen immer, dass sie mit einer KI schreiben, und können jederzeit zu einem Menschen wechseln.</li></ul></details>
      </form>
      <div class="stack"><div id="prBody"></div><div class="card"><h2>Verbrauch diesen Monat</h2>
        <div class="pmoney"><div><small>Kosten</small><b>${eur(total)}</b><span>von ${eur(s.monthCap)} Grenze</span></div><div><small>Aufrufe</small><b>${calls}</b><span>Erkennen + Antworten</span></div></div>
        <div class="pbar"><i style="width:${Math.min(100, total / s.monthCap * 100)}%"></i></div>
        ${d.usage.length ? `<table class="table" style="margin-top:12px"><thead><tr><th>Modell</th><th>Stufe</th><th class="num">Aufrufe</th><th class="num">Kosten</th></tr></thead><tbody>${d.usage.map(u => `<tr><td>${esc(u.model)}</td><td>${esc(u.stage)}</td><td class="num">${u.calls}</td><td class="num">${eur(u.cost)}</td></tr>`).join("")}</tbody></table>` : `<p class="hint" style="margin:12px 0 0">Noch keine Aufrufe in diesem Monat.</p>`}
        ${d.threads.length ? `<h3 class="swh3">Gespräche</h3><div class="kistat">${d.threads.map(x => `<span><b>${x.n}</b>${esc(STATUS[x.status] || x.status)}</span>`).join("")}</div>` : ""}
        <p class="hint" style="margin:12px 0 0">Preise laut Anthropic-Liste, Dollar. Abgerechnet wird direkt über Ihr Anthropic-Konto.</p></div></div></div>`;
    $("#kiForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = e.target;
      try { await api("/assistant", { method: "PUT", body: { enabled: f.enabled.checked, modelRecognize: f.modelRecognize.value, modelReply: f.modelReply.value, monthCap: f.monthCap.value, cutoff: f.cutoff.value, contact: f.contact.value, bigPromise: f.bigPromise.value } });
        toast("Gespeichert"); load(); } catch (err) { toast(err.message); }
    });
  }
  window.AIUI = { load: async () => { await load(); window.PRUEF?.settings(); } };
})();
