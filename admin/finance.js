/* Board – Finanzen: Übersicht, Rechnungen, Angebote, Belege, Auswertung & Export (nur Inhaber; nutzt $, $$, esc, api, toast, fmt, ME) */
(() => {
  const money = (c, d = 2) => c == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(c / 100);
  const m0 = c => money(c, 0);
  const de = d => d ? d.split("-").reverse().join(".") : "–";
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const euroIn = c => c == null ? "" : (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseEuro = v => { const s = String(v ?? "").trim().replace(/\s|€/g, ""); if (!s) return 0; const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s; return Math.round(Number(n) * 100) || 0; };
  let ftab = "uebersicht", META = null, clientsCache = null;
  const STAT = { entwurf: ["Entwurf", "draft"], offen: ["Offen", "open"], bezahlt: ["Bezahlt", "paid"], storniert: ["Storniert", "void"], storno: ["Storno", "void"], versendet: ["Versendet", "open"], angenommen: ["Angenommen", "paid"], abgelehnt: ["Abgelehnt", "void"] };
  const pill = r => { if (!r.locked) return `<span class="fpill fpill--draft">Entwurf</span>`;
    if (r.dunning && r.dunning.overdue > 0) return `<span class="fpill fpill--late">${r.dunning.overdue} Tage überfällig</span>`;
    const [l, k] = STAT[r.status] || [r.status, "open"]; return `<span class="fpill fpill--${k}">${l}</span>`; };

  async function meta() { META = await api("/finance/meta"); return META; }
  let FIRMA = "";
  const mitFirma = u => FIRMA ? u + (u.includes("?") ? "&" : "?") + "firma=" + FIRMA : u;
  const firmaTag = r => META?.firmen?.hardwareAktiv ? ` <span class="bereich bereich--${r.firma === "hardware" ? "hw" : "sw"}">${r.firma === "hardware" ? "Hardware" : "Software"}</span>` : "";
  $("#finFirma")?.addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (!b) return;
    if (b.dataset.f && !META?.firmen?.hardwareAktiv) { toast("Die Trennung nach Firmen ist noch aus. Aktiviere die Hardware GmbH unter Einstellungen → Unternehmen."); location.hash = "#einstellungen/firma"; return; }
    FIRMA = b.dataset.f; $$("#finFirma button").forEach(x => x.classList.toggle("on", x === b)); window.loadFinance().catch(err => toast(err.message)); });
  async function clients() { return clientsCache ||= await api("/clients"); }

  window.loadFinance = async () => {
    const sub = location.hash.split("/")[1];
    if (sub && (sub === "angebote" || $(`#finTabs [data-t="${sub}"]`))) ftab = sub;
    $$("#finTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === (ftab === "angebote" ? "rechnungen" : ftab)));
    $$("[data-fin]").forEach(d => d.hidden = d.dataset.fin !== ftab);
    await meta();
    // Der Schalter ist immer zu sehen. Solange die Hardware GmbH nicht aktiv ist, führen ihre Knöpfe in die Einstellungen.
    const fw = $("#finFirma"), hwAn = !!META.firmen?.hardwareAktiv; if (!hwAn) FIRMA = "";
    if (fw) { fw.hidden = false; $$("button", fw).forEach(b => { b.classList.toggle("on", b.dataset.f === FIRMA); b.style.opacity = !hwAn && b.dataset.f ? .45 : 1;
      b.title = !hwAn && b.dataset.f ? "Erst nutzbar, wenn die Hardware GmbH unter Einstellungen → Unternehmen aktiviert ist" : ""; }); }
    const c = META.company, missing = [!c.street && "Anschrift", !(c.taxNumber || c.vatId) && "Steuernummer/USt-IdNr.", !c.iban && "IBAN"].filter(Boolean);
    $("#finWarn").hidden = !missing.length;
    $("#finWarn").innerHTML = `Für rechtssichere Rechnungen fehlen noch: <b>${missing.join(", ")}</b>. <a href="#einstellungen/firma">Jetzt unter Einstellungen → Unternehmen eintragen →</a>`;
    if (ftab === "uebersicht") return overview();
    if (ftab === "rechnungen") return list("rechnung");
    if (ftab === "angebote") return list("angebot");
    if (ftab === "belege") return expenses();
    if (ftab === "auswertung") return reportView();
  };
  $("#finTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; history.replaceState(null, "", "#finanzen/" + b.dataset.t); ftab = b.dataset.t; window.loadFinance().catch(err => toast(err.message)); });

  /* ---------- Übersicht ---------- */
  async function overview() {
    const o = await api(mitFirma("/finance/overview"));
    const q = o.quarter;
    const tag = d => d ? d.split("-").reverse().join(".").slice(0, 6) : "";
    const ueberSumme = o.overdue.reduce((x, i) => x + i.gross, 0);
    const zeile = (links, titel, text, knopf) => `<div class="hrow"><span class="hrow__l">${links}</span><div class="hrow__m"><b>${titel}</b>${text ? `<p>${text}</p>` : ""}</div>${knopf}</div>`;
    const gruppen = [
      ["Rechnungen stellen", (o.zuStellen || []).map(x => zeile(ICO("zahlung"), `${esc(x.company)} · ${money(x.gross)}`, `${esc(x.label)} · ${esc(x.project)}${x.due ? " · fällig " + tag(x.due) : ""}`,
        `<button class="btn btn--sm btn--grad" data-rechnung='${esc(JSON.stringify({ client_id: x.client_id, project_id: x.project_id, payment_id: x.id }))}'>Rechnung erstellen</button>`))],
      ["Entwürfe fertigstellen", (o.entwuerfe || []).map(x => zeile(ICO("dokument"), `${x.kind === "angebot" ? "Angebot" : "Rechnung"} · ${esc(x.company)}`, `${esc(x.title || "ohne Titel")} · ${money(x.gross)}`, `<button class="btn btn--sm btn--grad" data-open="${x.id}">Öffnen</button>`))],
      ["Überfällig – mahnen", o.overdue.map(i => zeile(ICO("overdue"), `${esc(i.number)} · ${esc(i.company)}`, `${money(i.gross)} · ${i.dunning.overdue} Tage überfällig · nächste Stufe: ${esc(i.dunning.next || "–")}`, `<button class="btn btn--sm btn--grad" data-open="${i.id}">Öffnen</button>`))],
      ["Zahlungen abhaken", (o.offene || []).filter(i => !o.overdue.some(u => u.id === i.id)).map(i => zeile(ICO("zahlung"), `${esc(i.number)} · ${esc(i.company)}`, `${money(i.gross)}${i.due_date ? " · fällig " + tag(i.due_date) : ""}`, `<button class="btn btn--sm btn--ghost" data-open="${i.id}">Öffnen</button>`))],
      ["Angebote beim Kunden", (o.angeboteOffen || []).map(i => zeile(ICO("angebot"), `${esc(i.number)} · ${esc(i.company)}`, `${esc(i.title || "")} · ${money(i.gross)} · seit ${tag(i.issue_date)}`, `<button class="btn btn--sm btn--ghost" data-open="${i.id}">Öffnen</button>`))],
    ].filter(g => g[1].length);
    $("#finOverview").innerHTML = `
      <div class="tiles">
        <a class="tile tile--dark" href="#finanzen/rechnungen" data-go="rechnungen"><small>Offene Rechnungen</small><b>${m0(o.openSum)}</b><span>${o.openCount} Rechnung${o.openCount === 1 ? "" : "en"} noch nicht bezahlt</span></a>
        <a class="tile ${o.overdue.length ? "tile--warn" : ""}" href="#finanzen/rechnungen" data-go="rechnungen"><small>Überfällig</small><b>${m0(ueberSumme)}</b><span>${o.overdue.length ? `${o.overdue.length} Rechnung${o.overdue.length === 1 ? "" : "en"} über dem Zahlungsziel` : "nichts überfällig"}</span></a>
        <div class="tile tile--grad"><small>Diesen Monat berechnet</small><b>${m0(o.revenueMonth)}</b><span>netto · ${m0(o.revenueYear)} im Jahr · ${m0(o.paidYear)} eingegangen</span></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="heute__kopf"><h2>Was zu tun ist</h2><span>${gruppen.reduce((n, g) => n + g[1].length, 0)} Punkte</span></div>
        ${gruppen.length ? gruppen.map(([name, z], i) => `<div class="hgruppe"><p class="hgruppe__t"><i>${i + 1}</i>${name}<em>${z.length}</em></p>${z.join("")}</div>`).join("")
          : `<div class="allclear"><b>Alles erledigt.</b><span>Keine Rechnung zu stellen, nichts offen, nichts überfällig.</span></div>`}
        <div class="fquick" style="margin-top:16px"><button class="btn btn--grad" data-new="rechnung">Neue Rechnung</button><button class="btn btn--ghost" data-new="angebot">Neues Angebot</button><button class="btn btn--ghost" data-go="belege">Ausgabe erfassen</button></div></div>
      <div class="ckgrid">
        <div class="card"><h2>Umsatz &amp; Ausgaben ${new Date().getFullYear()} <small class="hint" style="font-weight:400;margin:0">netto</small></h2>
          <div class="fchart">${(() => { const max = Math.max(1, ...o.months.map(x => Math.max(x.revenue, x.expenses)));
            return o.months.map((x, i) => `<div class="fchart__col" title="${x.month}: Umsatz ${money(x.revenue)}, Ausgaben ${money(x.expenses)}"><div class="fchart__bars"><i class="rev" style="height:${x.revenue / max * 100}%"></i><i class="exp" style="height:${x.expenses / max * 100}%"></i></div><span>${"JFMAMJJASOND"[i]}</span></div>`).join(""); })()}</div>
          <div class="fchart__legend"><span><i class="rev"></i>Umsatz</span><span><i class="exp"></i>Ausgaben</span><span style="margin-left:auto">Ausgaben ${new Date().getFullYear()}: <b>${m0(o.expensesYear)}</b></span></div></div>
        <div class="stack">
          <a class="card" href="#finanzen/auswertung" data-go="auswertung" style="text-decoration:none;color:inherit"><h2>Umsatzsteuer ${q.label}</h2><p class="kzahl">${m0(q.zahllast)}</p><p class="hint" style="margin:0">voraussichtlich ans Finanzamt · Umsatzsteuer ${m0(q.ust + q.rcUst)} − Vorsteuer ${m0(q.vst)}</p></a>
          <div class="card"><h2>Ergebnis ${q.label}</h2><p class="kzahl">${m0(q.result)}</p><p class="hint" style="margin:0">Umsatz ${m0(q.revenueNet)} − Ausgaben ${m0(q.expensesNet)}, netto</p></div>
        </div>
      </div>`;
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-rechnung]"); if (!b) return; try { editor({ kind: "rechnung", ...JSON.parse(b.dataset.rechnung) }); } catch (x) { toast(x.message); } });
  $("[data-section=finanzen]").addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); ftab = g.dataset.go; history.replaceState(null, "", "#finanzen/" + ftab); window.loadFinance(); return; }
    const n = e.target.closest("[data-new]"); if (n) return editor({ kind: n.dataset.new });
    if (e.target.closest("[data-erneut]")) return;   // ↻ in der Zeile öffnet „Erneut schicken“, nicht die Rechnung
    const o = e.target.closest("[data-open]"); if (o) return openInvoice(+o.dataset.open);
  });
  $("[data-section=finanzen]").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches?.(".ftable__r--akt")) e.target.click(); });

  /* ---------- Rechnungen / Angebote ---------- */
  async function list(kind) {
    const rows = await api(mitFirma(`/finance/invoices?kind=${kind}`)), box = $(kind === "angebot" ? "#finQuotes" : "#finInvoices");
    const label = kind === "angebot" ? "Angebot" : "Rechnung";
    box.innerHTML = `<div class="seg fsub"><button data-go="rechnungen" class="${kind === "angebot" ? "" : "on"}">Rechnungen</button><button data-go="angebote" class="${kind === "angebot" ? "on" : ""}">Angebote</button></div><div class="fhead"><p class="hint" style="margin:0">${kind === "angebot" ? "Angebote mit eigenem Nummernkreis – angenommen, lassen sie sich mit einem Klick in eine Rechnung übernehmen." : "Entwürfe sind frei änderbar. Festgeschriebene Rechnungen sind unveränderlich (GoBD) – Korrekturen laufen über eine Stornorechnung."}</p>
      <button class="btn btn--grad" data-new="${kind}">Neue${kind === "angebot" ? "s Angebot" : " Rechnung"}</button></div>
      ${rows.length ? `<div class="ftable"><div class="ftable__h"><span>Nummer</span><span>Kunde / Titel</span><span>Datum</span><span>${kind === "angebot" ? "Gültig bis" : "Fällig"}</span><span class="num">Brutto</span><span>Status</span><span></span></div>
        ${rows.map(r => `<div class="ftable__r ftable__r--akt" role="button" tabindex="0" data-open="${r.id}"><span class="mono">${r.number ? esc(r.number) : "<em>Entwurf</em>"}</span>
          <span><b>${esc(r.company)}${firmaTag(r)}</b><small>${esc(r.title || r.project || "")}</small></span><span>${de(r.issue_date)}</span><span>${de(kind === "angebot" ? r.valid_until : r.due_date)}</span>
          <span class="num">${money(r.locked ? r.gross : r.draftTotals.gross)}</span><span>${pill(r)}${r.locked && r.kind !== "storno" ? `<small class="fversand ${r.versand ? "" : "fversand--nie"}">${esc(ERNEUT.kurz(r.versand))}</small>` : ""}</span>${r.locked && r.kind !== "storno" ? `<button type="button" class="btn btn--ghost btn--sm fresend" data-erneut data-art="${r.kind}" data-ref="${r.id}" data-url="/finance/invoices/${r.id}/send" data-mailtext="mit PDF im Anhang" data-titel="${esc((r.kind === "angebot" ? "Angebot " : "Rechnung ") + (r.number || ""))} erneut schicken" title="Erneut schicken – mit Versandprotokoll">↻</button>` : "<span></span>"}</div>`).join("")}</div>`
      : `<div class="empty">Noch keine ${label === "Angebot" ? "Angebote" : "Rechnungen"}. Legen Sie die erste an – Positionen, Steuer und PDF erledigt das Board.</div>`}`;
  }

  // Editor für Entwürfe (neu oder bestehend)
  async function editor(inv) {
    const cl = await clients(), kind = inv.kind || "rechnung", isQuote = kind === "angebot";
    const days = META?.company?.paymentDays ?? 14, rate = Number(META?.company?.vatRate ?? 19);
    const items = inv.items?.length ? inv.items : [{ title: "", qty: 1, unit: "pauschal", unit_net: 0, vat_rate: rate }];
    const plan0 = isQuote ? (inv.plan || (inv.id ? [] : (await api("/contracts/settings").catch(() => null))?.plan || [])) : [];
    const m = document.createElement("div"); m.className = "modal fmodal";
    m.innerHTML = `<form class="card fedit">
      <header class="fedit__head"><div><p class="kicker">${isQuote ? "Angebot" : "Rechnung"} · Entwurf</p><h2>${inv.id ? "Entwurf bearbeiten" : isQuote ? "Neues Angebot" : "Neue Rechnung"}</h2></div><button type="button" class="x" data-close>✕</button></header>
      <div class="fedit__body">
        ${isQuote && !inv.locked ? `<div class="fvorl"><label>Vorlage<select id="fVorl"><option value="">– ohne Vorlage –</option></select></label>
          <button type="button" class="btn btn--grad btn--sm" data-ki title="Entwurf aus Gesprächsnotizen, Fragebogen und Vorlagen">KI-Vorschlag</button><button type="button" class="btn btn--ghost btn--sm" data-pakete title="Positionen aus den Paketen des Preis-Baukastens (M / L / XXL)">Pakete wählen</button><button type="button" class="btn btn--ghost btn--sm" data-vsave>Als Vorlage speichern</button><button type="button" class="link" data-vdel hidden>Vorlage löschen</button></div>` : ""}
        ${inv.notizen ? `<details class="fnotes" open><summary>Ihre Gesprächsnotizen <small>nur für Sie, erscheinen nicht im Angebot</small></summary><p>${esc(inv.notizen)}</p></details>` : ""}
        <div class="fki" id="fKi" hidden></div>
        <div class="fhw" id="fHw" hidden><b>Hardware: zuerst nur das Konzept anbieten.</b> Was der Prototyp kostet, steht erst mit Stückliste und Bauanleitung fest. Sein Angebot erstellen Sie danach im Projekt unter „Konzept“ aus der Kalkulation – als Pauschalpreis.</div>
        <div class="fgrid">
          <label>Kunde<select name="client_id" required><option value="">– wählen –</option>${cl.map(c => `<option value="${c.id}" ${c.id === inv.client_id ? "selected" : ""}>${esc(c.company)}</option>`).join("")}</select></label>
          <label>Projekt<select name="project_id"><option value="">– ohne Projekt –</option></select></label>
          ${isQuote ? "" : `<label class="span2">Zu welcher Zahlung aus dem Zahlungsplan? <select name="payment_id"><option value="">– keine Zuordnung –</option></select><small class="hint" style="margin:2px 0 0">Wird übernommen: Position und Betrag. Nach dem Festschreiben springt die Zahlung beim Kunden auf „Rechnung gestellt“.</small></label>`}
          <div class="faddr span2" id="fAddr"></div>
          <label class="span2">Titel / Betreff<input name="title" value="${esc(inv.title || "")}" placeholder="${isQuote ? "z. B. Erweiterung Videosprechstunde" : "z. B. Abnahme Prototyp – Praxissoftware"}"></label>
          <label>${isQuote ? "Angebotsdatum" : "Rechnungsdatum"}<input type="date" name="issue_date" value="${inv.issue_date || today()}"></label>
          ${isQuote ? `<label>Gültig bis<input type="date" name="valid_until" value="${inv.valid_until || addDays(today(), 30)}"></label>`
            : `<label>Zahlbar bis<input type="date" name="due_date" value="${inv.due_date || addDays(today(), days)}"></label>
               <label>Leistung von<input type="date" name="service_from" value="${inv.service_from || ""}"></label><label>Leistung bis<input type="date" name="service_to" value="${inv.service_to || ""}"><small class="hint" style="margin:2px 0 0">leer = Leistungsdatum entspricht Rechnungsdatum</small></label>`}
          <label class="span2">Einleitung<textarea name="intro" rows="2">${esc(inv.intro ?? (isQuote ? "vielen Dank für Ihr Interesse. Gern bieten wir Ihnen folgende Leistungen an:" : "für die erbrachten Leistungen erlauben wir uns, wie folgt zu berechnen:"))}</textarea></label>
        </div>
        <div class="fitems"><div class="fitems__h"><span>Leistung</span><span>Menge</span><span>Einheit</span><span>Einzelpreis netto</span><span>USt</span><span class="num">Gesamt</span><span></span></div>
          <div id="fRows"></div><div class="fitems__neu"><button type="button" class="link" data-addrow>+ Position hinzufügen</button><button type="button" class="link" data-addrabatt>+ Rabatt</button></div></div>
        <div class="ftotals" id="fTotals"></div>
        ${isQuote ? `<div class="fplan"><div class="fplan__h"><b>Zahlungsplan &amp; Vertrag</b><small>Nimmt der Kunde das Angebot im Portal an, übernimmt das Board diesen Plan ins Projekt und legt jede Rechnung als Entwurf an, sobald sie fällig ist – Sie geben nur noch frei.</small></div>
          <div class="fplan__vor"><span>Schnellwahl:</span><button type="button" class="btn btn--ghost btn--sm" data-planvor="100">Einmalig 100 %</button><button type="button" class="btn btn--ghost btn--sm" data-planvor="50">50 / 50</button><button type="button" class="btn btn--ghost btn--sm" data-planvor="30">30 / 40 / 30</button></div>
          <div id="planRows"></div><div class="fplan__foot"><button type="button" class="link" data-addplan>+ Rate hinzufügen</button><span id="planSum"></span></div>
          <label class="check"><input type="checkbox" name="avv" ${inv.avv ? "checked" : ""}> <span>Kunde bestätigt zusätzlich die <b>Vereinbarung zur Auftragsverarbeitung (AVV)</b> – nötig, wenn wir personenbezogene Daten des Kunden verarbeiten oder hosten</span></label></div>` : ""}
        ${isQuote ? `<details class="fverein" ${inv.vereinbarung ? "open" : ""}><summary>Besondere Vereinbarung <small>optional – zum Beispiel eine Umsatzbeteiligung, wenn der Preis dafür niedriger ist</small></summary>
          <div class="fgrid" style="margin-top:10px"><label>Worum geht es?<input name="v_titel" maxlength="120" value="${esc(inv.vereinbarung?.titel || "")}" placeholder="z. B. Umsatzbeteiligung"></label>
            <label>Anteil in % <small class="muted">(falls zutreffend)</small><input name="v_prozent" inputmode="decimal" value="${inv.vereinbarung?.prozent ? String(inv.vereinbarung.prozent).replace(".", ",") : ""}" placeholder="5"></label>
            <label class="span2">Was genau gilt?<textarea name="v_text" rows="${(inv.vereinbarung?.text || "").length > 200 ? 9 : 3}" placeholder="z. B. 5 % des Nettoumsatzes mit dem Produkt ab Markteinführung, für 36 Monate, Abrechnung vierteljährlich.">${esc(inv.vereinbarung?.text || "")}</textarea></label></div>
          <div class="fverein__ki"><button type="button" class="btn btn--ghost btn--sm" data-vki>Mit KI ausformulieren</button><small>Stichpunkte in eigenen Worten eintragen – die KI macht daraus ein sauberes Schreiben in Abschnitten. Bitte prüfen; für die Grundvorlage einmal einen Anwalt draufschauen lassen.</small></div>
          <div class="fki" id="fVki" hidden></div>
          <p class="hint" style="margin:8px 0 0">Längere Vereinbarungen stehen im Angebot als eigene Anlage und werden mit der Annahme im Kundenportal mitunterschrieben. Sie stehen auch in der Auftragsbestätigung. Mit der Annahme hängt die Vereinbarung am Projekt.</p></details>` : ""}
        <label>Schlusstext<textarea name="outro" rows="2">${esc(inv.outro ?? (isQuote ? "Bei Fragen sind wir jederzeit für Sie da." : "Vielen Dank für die gute Zusammenarbeit!"))}</textarea></label>
      </div>
      <footer class="fedit__foot">
        ${inv.id ? `<button type="button" class="btn btn--danger btn--sm" data-del>Entwurf löschen</button>` : "<span></span>"}
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-preview>Vorschau (PDF)</button><button type="submit" class="btn btn--ghost">Entwurf speichern</button><button type="button" class="btn btn--grad" data-issue>Festschreiben &amp; senden …</button></div>
      </footer></form>`;
    document.body.appendChild(m);
    const f = $("form", m), rowsBox = $("#fRows", m);
    const row = it => `<div class="fitem"><div><input data-k="title" value="${esc(it.title || "")}" placeholder="Leistung" required><textarea data-k="description" rows="1" placeholder="Beschreibung (optional)" class="fitem__desc">${esc(it.description || "")}</textarea></div>
      <input data-k="qty" value="${String(it.qty ?? 1).replace(".", ",")}" inputmode="decimal"><input data-k="unit" value="${esc(it.unit || "")}" placeholder="Std."><input data-k="unit_net" value="${euroIn(it.unit_net)}" inputmode="decimal" placeholder="0,00">
      <select data-k="vat_rate">${[19, 7, 0].map(r => `<option value="${r}" ${Number(it.vat_rate ?? rate) === r ? "selected" : ""}>${r} %</option>`).join("")}</select><span class="num" data-sum></span><button type="button" class="x" data-delrow>✕</button></div>`;
    rowsBox.innerHTML = items.map(row).join("");
    const ON = ["Auftrag", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"];
    const planRow = x => `<div class="fplanrow"><input data-p="label" value="${esc(x.label || "")}" placeholder="z. B. Anzahlung bei Auftrag"><span class="fpct"><input data-p="pct" value="${String(x.pct ?? "").replace(".", ",")}" inputmode="decimal" placeholder="30"><i>%</i></span>
      <select data-p="on">${ON.map(o => `<option value="${o}" ${o === (x.on || "Auftrag") ? "selected" : ""}>${o === "Auftrag" ? "fällig bei Auftrag" : "fällig ab Phase " + o}</option>`).join("")}</select><span class="num" data-pamt></span><button type="button" class="x" data-delplan>✕</button></div>`;
    const planBox = $("#planRows", m);
    if (planBox) planBox.innerHTML = plan0.map(planRow).join("");
    const pctOf = r => Number(String($("[data-p=pct]", r).value).replace(",", ".")) || 0;
    const collect = () => ({ kind, client_id: +f.client_id.value || null, project_id: +f.project_id.value || null, payment_id: f.payment_id ? +f.payment_id.value || null : null, title: f.title.value, issue_date: f.issue_date.value,
      due_date: f.due_date?.value, valid_until: f.valid_until?.value, service_from: f.service_from?.value, service_to: f.service_to?.value, intro: f.intro.value, outro: f.outro.value,
      plan: planBox ? $$(".fplanrow", planBox).map(r => ({ label: $("[data-p=label]", r).value, pct: pctOf(r), on: $("[data-p=on]", r).value })).filter(x => x.label.trim() || x.pct) : undefined, avv: f.avv?.checked, vereinbarung: f.v_titel ? { titel: f.v_titel.value, text: f.v_text.value, prozent: f.v_prozent.value } : undefined,
      items: $$(".fitem", rowsBox).map(r => Object.fromEntries($$("[data-k]", r).map(i => [i.dataset.k, i.dataset.k === "unit_net" ? (parseEuro(i.value) / 100).toFixed(2) : i.value]))).filter(x => x.title.trim()) });
    let monatlich = inv.vereinbarung?.titel && /^Betreuung/.test(inv.vereinbarung.titel) ? inv.vereinbarung.titel : "";
    const wachsen = () => $$("textarea.fitem__desc", rowsBox).forEach(x => { x.style.height = "auto"; x.style.height = x.scrollHeight + 2 + "px"; });
    const recalc = () => {
      wachsen();
      const by = {}; let net = 0;
      $$(".fitem", rowsBox).forEach(r => { const q = Number(String($("[data-k=qty]", r).value).replace(",", ".")) || 0, p = parseEuro($("[data-k=unit_net]", r).value), v = +$("[data-k=vat_rate]", r).value, n = Math.round(q * p);
        $("[data-sum]", r).textContent = money(n); net += n; by[v] = (by[v] || 0) + n; });
      let vat = 0; const lines = Object.entries(by).filter(([r]) => +r > 0).map(([r, n]) => { const v = Math.round(n * r / 100); vat += v; return `<div><span>zzgl. ${r} % USt.</span><b>${money(v)}</b></div>`; });
      $("#fTotals", m).innerHTML = `<div><span>Summe netto</span><b>${money(net)}</b></div>${lines.join("")}<div class="ftotals__sum"><span>${isQuote ? "Angebotssumme" : "Rechnungsbetrag"}</span><b>${money(net + vat)}</b></div>${monatlich ? `<div class="ftotals__monat">Laufend dazu: ${esc(monatlich)}${f.v_titel ? " – steht unten als besondere Vereinbarung" : ""}</div>` : ""}`;
      if (planBox) { const rows = $$(".fplanrow", planBox); let sum = 0, rest = net + vat;
        rows.forEach((r, i) => { const pc = pctOf(r); sum += pc; const g = i === rows.length - 1 && Math.abs(sum - 100) < .01 ? rest : Math.round((net + vat) * pc / 100); rest -= g; $("[data-pamt]", r).textContent = money(g) + " brutto"; });
        const ok = !rows.length || Math.abs(sum - 100) < .01; $("#planSum", m).innerHTML = rows.length ? `<b class="${ok ? "ok" : "warn"}">${String(Math.round(sum * 100) / 100).replace(".", ",")} %</b>${ok ? "" : " – muss 100 % ergeben"}` : "ohne Zahlungsplan"; }
    };
    rowsBox.addEventListener("input", recalc); rowsBox.addEventListener("change", recalc); planBox?.addEventListener("input", recalc); recalc();
    const PLAN_VOR = { 100: [{ label: "Gesamtbetrag nach Abnahme", pct: 100, on: "Launch" }],
      50: [{ label: "Anzahlung bei Auftrag", pct: 50, on: "Auftrag" }, { label: "Restzahlung nach Abnahme", pct: 50, on: "Launch" }],
      30: [{ label: "Anzahlung bei Auftrag", pct: 30, on: "Auftrag" }, { label: "Freigabe Prototyp", pct: 40, on: "Prototyp" }, { label: "Abnahme & Launch", pct: 30, on: "Launch" }] };
    $$("[data-planvor]", m).forEach(b => b.addEventListener("click", () => { planBox.innerHTML = PLAN_VOR[b.dataset.planvor].map(planRow).join(""); recalc(); }));
    // KI-Vorschlag: Der Server liest Notizen, Fragebogen, Projekt und Vorlagen und liefert einen Entwurf samt Rückfragen.
    // Übernommen wird in die Felder; verschickt wird nichts.
    $("[data-ki]", m)?.addEventListener("click", async e => {
      const b = e.currentTarget, d = collect();
      if (!d.client_id) return toast("Bitte zuerst den Kunden wählen.");
      const wunsch = await UI.prompt("KI-Vorschlag", { label: "Was soll angeboten werden? Optional – ohne Angabe richtet sich der Vorschlag nach Ihren Gesprächsnotizen und dem Fragebogen. Preise können Sie hier nennen.", value: "", multiline: true, ok: "Vorschlag erstellen" });
      if (wunsch === null) return;
      b.disabled = true; b.textContent = "Entwurf entsteht …";
      try {
        const r = await api("/finance/offer-draft", { method: "POST", body: { client_id: d.client_id, project_id: d.project_id, title: d.title, items: d.items, notizen: inv.notizen || "", wunsch } });
        if (r.title) f.title.value = r.title; if (r.intro) f.intro.value = r.intro; if (r.outro) f.outro.value = r.outro;
        if (r.items?.length) { rowsBox.innerHTML = r.items.map(it => row({ ...it, unit_net: it.unit_net ?? 0 })).join("");
          $$(".fitem", rowsBox).forEach((el, i) => { if (r.items[i].unit_net == null) $("[data-k=unit_net]", el).classList.add("fehlt"); }); recalc(); }
        if (planBox && r.plan?.length) { planBox.innerHTML = r.plan.map(planRow).join(""); recalc(); }
        const box = $("#fKi", m); box.hidden = false;
        box.innerHTML = `<b>Vorschlag der KI übernommen – bitte prüfen</b>${r.hinweis ? `<p>${esc(r.hinweis)}</p>` : ""}${r.fragen?.length ? `<p>Dazu fehlt noch etwas:</p><ul>${r.fragen.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${r.items?.some(it => it.unit_net == null) ? `<p>Rot markierte Preise sind offen.</p>` : ""}`;
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (e2) { toast(e2.message); }
      finally { b.disabled = false; b.textContent = "KI-Vorschlag"; }
    });
    /* Pakete aus dem Preis-Baukasten der Website (assets/data/baukasten.json): Auswahl → Positionen mit Richtwert-Preisen.
       Der Wunsch des Kunden aus der Anfrage ist vorausgewählt. Das Fenster wird einmal aufgebaut; eine Auswahl schaltet nur um (kein Springen).
       Die Auswahl bleibt für dieses Angebot erhalten; erneutes Übernehmen ersetzt nur die Paket-Positionen, eigene Positionen bleiben. */
    let PK = null;
    $("[data-pakete]", m)?.addEventListener("click", async () => {
      let BK;
      try { BK = await (await fetch("/assets/data/baukasten.json", { cache: "no-cache" })).json(); } catch { return toast("Die Preisliste der Website ließ sich nicht laden."); }
      const S = ["M", "L", "XXL"], eur = n => n.toLocaleString("de-DE") + " €";
      const cid = +f.client_id.value, w = cid ? await api(`/finance/clients/${cid}/wunsch`).catch(() => null) : null;
      if (!PK) {
        const n1 = new Date(); n1.setDate(1); n1.setMonth(n1.getMonth() + 1);
        PK = { typ: "website", wahl: { design: 0, umfang: 0, qualitaet: 0, inhalte: 0, betreuung: 0 }, extras: new Set(), aufTitel: "", aufBetrag: "", rabatt: "", rabattArt: "%",
          abr: "voraus", start: `${n1.getFullYear()}-${String(n1.getMonth() + 1).padStart(2, "0")}-01`, monate: 12 };
        if (w?.text) {   // z. B. „Website: Design XXL, Umfang M, …, Online-Terminbuchung · Richtwert ab 4.500 €“
          const [kopf, rest = ""] = w.text.split(":"), teile = rest.split("·")[0].split(",").map(x => x.trim());
          const ty = BK.typen.find(y => kopf.trim() === y.name); if (ty) PK.typ = ty.k;
          for (const tl of teile) {
            const b = [...BK.bausteine, { k: "betreuung", name: "Betreuung" }].find(x => tl.startsWith(x.name + " ")); const s = b && S.indexOf(tl.slice(b.name.length + 1));
            if (b && s >= 0) PK.wahl[b.k] = s; const e = BK.extras.find(x => x.name === tl); if (e) PK.extras.add(e.k);
          }
        }
      }
      const st = PK, typ = () => BK.typen.find(y => y.k === st.typ);
      const d = document.createElement("div"); d.className = "modal";
      d.innerHTML = `<form class="card pkw"><header class="fedit__head"><div><p class="kicker">Angebot</p><h2>Pakete wählen</h2></div><button type="button" class="x" data-zu>✕</button></header>
        <p class="hint" style="margin:0 0 12px">Richtwerte aus dem Preis-Baukasten der Website. Daraus entstehen Positionen, die Sie danach frei ändern können. Eigene Positionen bleiben beim erneuten Übernehmen erhalten.${w?.text ? ` <b>Wunsch aus der Anfrage:</b> ${esc(w.text)}` : ""}</p>
        <div class="pkw__typen">${BK.typen.map(y => `<label class="pkw__t" data-typ="${y.k}"><input type="radio" name="typ" value="${y.k}"><b>${esc(y.name)}</b><small>ab ${eur(y.grund)}</small></label>`).join("")}</div>
        ${BK.bausteine.map(b => `<div class="pkw__z"><b>${esc(b.name)}</b><div class="pkw__st">${b.stufen.map((s, i) => `<label class="pkw__s" data-b="${b.k}" data-i="${i}"><input type="radio" name="${b.k}" value="${i}"><em>${S[i]}</em> ${esc(s[0])}<small data-preis></small></label>`).join("")}</div></div>`).join("")}
        <div class="pkw__z"><b>Extras</b><div class="pkw__st pkw__st--x">${BK.extras.map(e => `<label class="pkw__s" data-x="${e.k}" data-nicht="${(e.nichtBei || []).join(" ")}"><input type="checkbox" name="x" value="${e.k}">${esc(e.name)}<small>${e.preis == null ? "Preis offen" : "+ " + eur(e.preis)}</small></label>`).join("")}</div></div>
        <div class="pkw__z"><b>Betreuung</b><div class="pkw__st">${BK.betreuung.map((s, i) => `<label class="pkw__s" data-b="betreuung" data-i="${i}"><input type="radio" name="betreuung" value="${i}"><em>${S[i]}</em> ${esc(s[0])}<small data-preis></small></label>`).join("")}</div>
          <div class="pkw__abr" data-abr>
            <div class="pkw__seg"><label><input type="radio" name="abr" value="voraus"><span>Vorauszahlung</span></label><label><input type="radio" name="abr" value="monatlich"><span>Monatlich</span></label></div>
            <label>Beginn<input type="date" name="start" value="${esc(st.start)}"></label>
            <label><span data-monate-label>Monate im Voraus</span><input type="number" name="monate" min="1" max="60" value="${st.monate}"></label>
            <p class="pkw__abrtext" data-abrtext></p></div></div>
        <div class="pkw__z"><b>Aufschlag</b><div class="pkw__auf"><input name="aufTitel" placeholder="z. B. Individuelle Mehrarbeit" value="${esc(st.aufTitel)}"><input name="aufBetrag" inputmode="decimal" placeholder="Betrag netto, z. B. 500" value="${esc(st.aufBetrag)}"></div></div>
        <div class="pkw__z"><b>Rabatt</b><div class="pkw__auf pkw__auf--rabatt"><input name="rabatt" inputmode="decimal" placeholder="z. B. 10" value="${esc(st.rabatt)}"><select name="rabattArt"><option value="%" ${st.rabattArt === "%" ? "selected" : ""}>Prozent</option><option value="€" ${st.rabattArt === "€" ? "selected" : ""}>Euro netto</option></select></div></div>
        <footer class="pkw__fuss"><span data-summe></span><button type="submit" class="btn btn--grad">Übernehmen</button></footer></form>`;
      const summe = () => {
        const t = typ(); let s = t.grund;
        for (const b of BK.bausteine) s += t.preise[b.k][st.wahl[b.k]];
        for (const e of BK.extras) if (st.extras.has(e.k) && !(e.nichtBei || []).includes(t.k) && e.preis) s += e.preis;
        s += parseEuro(st.aufBetrag || "") / 100;
        const r = Number(String(st.rabatt || "").replace(",", ".")) || 0, rab = r > 0 ? (st.rabattArt === "%" ? Math.round(s * Math.min(r, 100) / 100) : r) : 0;
        const tb = typ().betreuung[st.wahl.betreuung] || 0, monate = Math.max(1, Math.min(60, +st.monate || 1));
        const vor = st.wahl.betreuung && st.abr === "voraus" ? tb * monate : 0;
        return { s, rab, vor, tb, monate };
      };
      const datumDe = d => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
      const zeitraum = () => { const a = new Date((st.start || "") + "T00:00:00"); if (isNaN(a)) return null; const b = new Date(a); b.setMonth(b.getMonth() + Math.max(1, +st.monate || 1)); b.setDate(b.getDate() - 1); return { von: datumDe(a), bis: datumDe(b) }; };
      // Nur umschalten, nichts neu aufbauen: Auswahl, Preise der Stufen, sichtbare Extras, Summe
      const aktualisieren = () => {
        const t = typ();
        $$("[data-typ]", d).forEach(el => { const on = el.dataset.typ === st.typ; el.classList.toggle("is-on", on); el.querySelector("input").checked = on; });
        $$("[data-b]", d).forEach(el => { const k = el.dataset.b, i = +el.dataset.i, on = st.wahl[k] === i; el.classList.toggle("is-on", on); el.querySelector("input").checked = on;
          const pr = el.querySelector("[data-preis]"); if (pr) pr.textContent = k === "betreuung" ? (i ? `${eur(t.betreuung[i])} / Monat` : "keine") : (t.preise[k][i] ? "+ " + eur(t.preise[k][i]) : "inklusive"); });
        $$("[data-x]", d).forEach(el => { const weg = el.dataset.nicht.split(" ").includes(t.k), on = st.extras.has(el.dataset.x); el.hidden = weg; el.classList.toggle("is-on", on && !weg); el.querySelector("input").checked = on; });
        const { s, rab, vor, tb, monate } = summe(), z = zeitraum(), ab = $("[data-abr]", d);
        ab.hidden = !st.wahl.betreuung;
        $$("input[name=abr]", d).forEach(x => { x.checked = x.value === st.abr; x.parentElement.classList.toggle("is-on", x.checked); });
        $("[data-monate-label]", d).textContent = st.abr === "voraus" ? "Monate im Voraus" : "Mindestlaufzeit (Monate)";
        $("[data-abrtext]", d).textContent = !st.wahl.betreuung ? "" : st.abr === "voraus"
          ? `${monate} × ${eur(tb)} = ${eur(vor)} netto im Voraus${z ? `, Zeitraum ${z.von} – ${z.bis}` : ""}. Steht als Position im Angebot und in der Summe.`
          : `${eur(tb)} netto im Monat${z ? ` ab ${z.von}, mindestens bis ${z.bis}` : ""}, danach monatlich kündbar. Steht als besondere Vereinbarung im Angebot.`;
        $("[data-summe]", d).innerHTML = `Richtwert <b>${eur(s - rab + vor)}</b> netto${rab ? ` <small>(nach ${eur(rab)} Rabatt)</small>` : ""}${st.wahl.betreuung ? (st.abr === "voraus" ? ` <span class="pkw__monat">inkl. ${monate} Monate Betreuung</span>` : ` <span class="pkw__monat">+ ${eur(tb)} / Monat Betreuung</span>`) : ""}`;
      };
      aktualisieren(); document.body.appendChild(d);
      const zu = () => d.remove();
      d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-zu]")) zu(); });
      d.addEventListener("input", e => { const i = e.target; if (["aufTitel", "aufBetrag", "rabatt", "start", "monate"].includes(i.name)) { st[i.name] = i.value; aktualisieren(); } });
      d.addEventListener("change", e => {
        const i = e.target;
        if (i.name === "typ") st.typ = i.value; else if (i.name === "x") i.checked ? st.extras.add(i.value) : st.extras.delete(i.value);
        else if (i.name === "rabattArt") st.rabattArt = i.value; else if (i.name === "abr") st.abr = i.value; else if (i.name === "start" || i.name === "monate") st[i.name] = i.value; else if (st.wahl[i.name] !== undefined) st.wahl[i.name] = +i.value; else return;
        aktualisieren();
      });
      d.addEventListener("submit", e => {
        e.preventDefault(); const t = typ(), pos = [];
        const p = (title, description, euro, unit = "pauschal", qty = 1) => pos.push({ title, description, qty, unit, unit_net: euro == null ? 0 : Math.round(euro * 100), vat_rate: rate, offen: euro == null });
        const b0 = BK.bausteine.find(b => b.k === "design");
        p(`${t.name} – Grundpaket`, `Kleinste Version: ${t.umfang[0]}, Design „${b0.stufen[0][0]}“, Prüfbericht nach jedem Stand, technische Optimierung für Google.`, t.grund);
        for (const b of BK.bausteine) { const i = st.wahl[b.k]; if (i) p(`${b.name} ${S[i]} – ${b.stufen[i][0]}`, b.k === "umfang" ? t.umfang[i] : b.stufen[i][1], t.preise[b.k][i]); }
        for (const x of BK.extras) if (st.extras.has(x.k) && !(x.nichtBei || []).includes(t.k)) p(x.name, x.hinweis ? `Hinweis: ${x.hinweis}.` : "", x.preis);
        const aufB = parseEuro(st.aufBetrag || ""); if ((st.aufTitel || "").trim() && aufB) p(st.aufTitel.trim(), "", aufB / 100);
        const { rab } = summe(), r = Number(String(st.rabatt || "").replace(",", ".")) || 0;
        if (rab) p(st.rabattArt === "%" ? `Rabatt ${String(r).replace(".", ",")} %` : "Rabatt", "", -rab);
        const { tb, monate } = summe(), z = zeitraum() || { von: "Übergabe", bis: "" };
        const betreuung = st.wahl.betreuung ? { s: BK.betreuung[st.wahl.betreuung], preis: tb, stufe: S[st.wahl.betreuung] } : null;
        if (betreuung && (st.abr === "voraus" || !f.v_titel))
          p(st.abr === "voraus" ? `Betreuung ${betreuung.stufe} – ${betreuung.s[0]}, ${monate} Monate im Voraus` : `Betreuung ${betreuung.stufe} – ${betreuung.s[0]}`,
            st.abr === "voraus" ? `Zeitraum ${z.von} – ${z.bis}: ${betreuung.s[1]}.` : `${betreuung.s[1]}, ab ${z.von}.`, tb, "Monat", st.abr === "voraus" ? monate : 1);
        // Nur die früheren Paket-Positionen und leere Zeilen ersetzen; eigene Positionen bleiben
        $$(".fitem", rowsBox).forEach(el => { if (el.dataset.paket || !$("[data-k=title]", el).value.trim()) el.remove(); });
        const tmp = document.createElement("div"); tmp.innerHTML = pos.map(x => row(x)).join("");
        $$(".fitem", tmp).forEach((el, k) => { el.dataset.paket = "1"; if (pos[k].offen) $("[data-k=unit_net]", el).classList.add("fehlt"); });
        rowsBox.prepend(...tmp.children);
        if (!f.title.value.trim()) f.title.value = t.name;
        // Angebot: Betreuung als besondere Vereinbarung (wird mit dem Angebot unterschrieben); bei Vorauszahlung steht der Betrag zusätzlich als Position in der Summe
        if (betreuung && f.v_titel) {
          $(".fverein", m).open = true;
          f.v_titel.value = `Betreuung ${betreuung.stufe} – ${betreuung.s[0]}`;
          f.v_text.value = st.abr === "voraus"
            ? `Nach der Übergabe übernehmen wir die Betreuung: ${betreuung.s[1]}. Vergütung: ${eur(tb)} netto im Monat zzgl. MwSt. Die ersten ${monate} Monate (${z.von} – ${z.bis}) werden mit diesem Angebot im Voraus berechnet. Vor Ablauf melden wir uns wegen der Verlängerung.`
            : `Nach der Übergabe übernehmen wir die Betreuung: ${betreuung.s[1]}. Vergütung: ${eur(tb)} netto im Monat zzgl. MwSt., monatlich im Voraus, ab ${z.von}. Mindestlaufzeit ${monate} Monate (bis ${z.bis}), danach monatlich kündbar.`;
        }
        monatlich = betreuung && st.abr === "monatlich" ? `${eur(tb)} netto im Monat für die Betreuung ${betreuung.stufe}, ab ${z.von}, mindestens ${monate} Monate` : "";
        recalc(); zu(); toast(betreuung && st.abr === "voraus" ? `Pakete übernommen – ${monate} Monate Betreuung stehen als Position in der Summe.` : betreuung && f.v_titel ? "Pakete übernommen – die monatliche Betreuung steht unten als besondere Vereinbarung." : "Pakete übernommen – Positionen und Preise bitte prüfen.");
      });
    });
    $("[data-vki]", m)?.addEventListener("click", async e => {
      const b = e.currentTarget, d = collect();
      if (!d.client_id) return toast("Bitte zuerst den Kunden wählen.");
      if (!f.v_text.value.trim() && !f.v_titel.value.trim()) return toast("Bitte erst in eigenen Worten eintragen, was gelten soll.");
      b.disabled = true; b.textContent = "Wird formuliert …";
      try {
        const r = await api("/finance/agreement-draft", { method: "POST", body: { client_id: d.client_id, project_id: d.project_id, titel: f.v_titel.value, text: f.v_text.value, prozent: f.v_prozent.value, angebot_titel: d.title, positionen: d.items.map(x => x.title) } });
        if (r.titel) f.v_titel.value = r.titel; f.v_text.value = r.text; f.v_text.rows = 12;
        const box = $("#fVki", m); box.hidden = false;
        box.innerHTML = `<b>Ausformuliert – bitte prüfen und bei Bedarf ändern</b>${r.fehlt?.length ? `<p>Dazu fehlt noch etwas:</p><ul>${r.fehlt.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
      } catch (e2) { toast(e2.message); }
      finally { b.disabled = false; b.textContent = "Mit KI ausformulieren"; }
    });
    rowsBox.addEventListener("input", e => e.target.classList?.remove("fehlt"));
    // Vorlagen: füllen Titel, Texte und Positionen; die aktuelle Fassung lässt sich als Vorlage speichern
    const vSel = $("#fVorl", m);
    if (vSel) {
      let vorlagen = [];
      // Der Server liefert Preise in Cent und erwartet sie beim Speichern in Euro (wie bei den Positionen eines Angebots)
      const inEuro = v => ({ ...v, items: (v.items || []).map(it => ({ ...it, unit_net: (Number(it.unit_net || 0) / 100).toFixed(2) })) });
      const fuellen = () => { vSel.innerHTML = `<option value="">– ohne Vorlage –</option>` + vorlagen.map((v, i) => `<option value="${i}">${esc(v.name)}</option>`).join(""); $("[data-vdel]", m).hidden = true; };
      api("/finance/templates").then(v => { vorlagen = v || []; fuellen(); }).catch(() => {});
      vSel.addEventListener("change", () => {
        const v = vorlagen[+vSel.value]; $("[data-vdel]", m).hidden = !v; if (!v) return;
        const zusatz = f.title.value.replace(/^Entwicklungskonzept\s*/, "").trim();
        f.title.value = [v.title, f.project_id.selectedOptions[0]?.value ? f.project_id.selectedOptions[0].textContent : zusatz].filter(Boolean).join(" – ").slice(0, 200);
        if (v.intro) f.intro.value = v.intro; if (v.outro) f.outro.value = v.outro;
        rowsBox.innerHTML = (v.items || []).map(row).join("");
        if (planBox && v.plan?.length) planBox.innerHTML = v.plan.map(planRow).join("");
        recalc();
      });
      $("[data-vsave]", m).addEventListener("click", async () => {
        const d = collect(); if (!d.items.length) return toast("Erst mindestens eine Position eintragen.");
        const name = await UI.prompt("Als Vorlage speichern", { label: "Name der Vorlage. Ein vorhandener Name wird überschrieben. Gespeichert werden Titel, Texte, Positionen, Preise und der Zahlungsplan.", value: vorlagen[+vSel.value]?.name || "", ok: "Speichern" });
        if (!name || !name.trim()) return;
        const neu = { name: name.trim(), title: (vorlagen[+vSel.value]?.title || d.title || "").split(" – ")[0], intro: d.intro, outro: d.outro, items: d.items, plan: d.plan || [] };
        const liste = [...vorlagen.filter(v => v.name !== neu.name).map(inEuro), neu].sort((a, b) => a.name.localeCompare(b.name));
        try { vorlagen = await api("/finance/templates", { method: "PUT", body: { templates: liste } }); fuellen(); toast("Vorlage gespeichert"); } catch (e2) { toast(e2.message); }
      });
      $("[data-vdel]", m).addEventListener("click", async () => {
        const v = vorlagen[+vSel.value]; if (!v || !(await UI.confirm(`Die Vorlage „${v.name}“ wird gelöscht. Bestehende Angebote bleiben unverändert.`, { title: "Vorlage löschen?", ok: "Löschen", danger: true }))) return;
        try { vorlagen = await api("/finance/templates", { method: "PUT", body: { templates: vorlagen.filter(x => x !== v).map(inEuro) } }); fuellen(); toast("Vorlage gelöscht"); } catch (e2) { toast(e2.message); }
      });
    }
    let projects = [];
    // Hardware-Projekt ohne Auftrag: daran erinnern, dass der Prototyp erst nach dem Konzept bepreist wird
    const hwHinweis = () => { const p = projects.find(x => x.id === +f.project_id.value), box = $("#fHw", m); if (box) box.hidden = !(isQuote && p && p.bereich === "hardware" && p.status === "anfrage"); };
    f.project_id.addEventListener("change", hwHinweis);
    async function loadProjects() {
      const cid = +f.client_id.value; projects = cid ? await api(`/clients/${cid}/projects`) : [];
      f.project_id.innerHTML = `<option value="">– ohne Projekt –</option>` + projects.map(p => `<option value="${p.id}" ${p.id === inv.project_id ? "selected" : ""}>${esc(p.title)}</option>`).join("");
      hwHinweis();
      await loadPayments(); await loadAddr();
    }
    async function loadPayments() {
      if (!f.payment_id) return;
      const pid = +f.project_id.value, p = pid ? await api(`/projects/${pid}`) : null;
      f.payment_id.innerHTML = `<option value="">– keine Zuordnung –</option>` + (p?.payments || []).map(x => `<option value="${x.id}" data-label="${esc(x.label)}" data-net="${x.amount_net}" ${x.id === inv.payment_id ? "selected" : ""} ${x.status === "bezahlt" ? "disabled" : ""}>${esc(x.label)} · ${money(x.amount_net)} netto${x.status === "berechnet" ? " (bereits berechnet)" : x.status === "bezahlt" ? " (bezahlt)" : ""}</option>`).join("");
      if (!f.title.value && p) f.title.value = p.title;
    }
    async function loadAddr() {
      const cid = +f.client_id.value, box = $("#fAddr", m);
      if (!cid) { box.innerHTML = ""; return; }
      const a = await api(`/finance/clients/${cid}/billing`);
      const ok = a.street && a.city;
      box.innerHTML = `<div><small>Rechnungsadresse</small>${ok ? `<b>${esc(a.company)}</b><span>${esc(a.name || "")}${a.name ? " · " : ""}${esc(a.street)}, ${esc(a.zip)} ${esc(a.city)}${a.vat_id ? " · USt-IdNr. " + esc(a.vat_id) : ""}</span>` : `<b class="warn">Anschrift fehlt – für die Rechnung erforderlich</b>`}</div><button type="button" class="btn btn--ghost btn--sm" data-addr="${cid}">${ok ? "Ändern" : "Eintragen"}</button>`;
    }
    f.client_id.addEventListener("change", () => { inv.project_id = null; inv.payment_id = null; loadProjects(); });
    f.project_id.addEventListener("change", loadPayments);
    f.payment_id?.addEventListener("change", e => {
      const o = e.target.selectedOptions[0]; if (!o?.dataset.net) return;
      const first = $(".fitem", rowsBox);
      if (first && !$("[data-k=title]", first).value) { $("[data-k=title]", first).value = o.dataset.label; $("[data-k=unit_net]", first).value = euroIn(+o.dataset.net); $("[data-k=qty]", first).value = "1"; $("[data-k=unit]", first).value = "pauschal"; }
      else { rowsBox.insertAdjacentHTML("beforeend", row({ title: o.dataset.label, qty: 1, unit: "pauschal", unit_net: +o.dataset.net, vat_rate: rate })); }
      recalc();
    });
    if (inv.client_id) loadProjects().then(() => { if (inv.prefillPayment && f.payment_id) { f.payment_id.value = inv.prefillPayment; f.payment_id.dispatchEvent(new Event("change")); } });
    const close = () => m.remove();
    const save = async () => { const body = collect(); if (!body.client_id) throw new Error("Bitte einen Kunden wählen."); if (!body.items.length) throw new Error("Bitte mindestens eine Position anlegen.");
      const r = inv.id ? await api(`/finance/invoices/${inv.id}`, { method: "PUT", body }) : await api("/finance/invoices", { method: "POST", body }); inv.id = r.id; return r; };
    m.addEventListener("click", async e => {
      if (e.target === m || e.target.closest("[data-close]")) return close();
      if (e.target.closest("[data-addrow]")) { rowsBox.insertAdjacentHTML("beforeend", row({ qty: 1, unit: "Std.", unit_net: 0, vat_rate: rate })); recalc(); return; }
      if (e.target.closest("[data-delrow]")) { e.target.closest(".fitem").remove(); recalc(); return; }
      if (e.target.closest("[data-addrabatt]")) {
        const v = await UI.prompt("Rabatt", { label: "In Prozent (z. B. 10 %) oder als Betrag in Euro netto (z. B. 250). Prozent beziehen sich auf die Summe der Positionen darüber.", value: "10 %", ok: "Rabatt hinzufügen" });
        if (!v) return;
        const prozent = /%/.test(v), zahl = Number(String(v).replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
        if (!zahl) return toast("Bitte einen Wert eintragen.");
        const basis = $$(".fitem", rowsBox).reduce((s, r) => { const q = Number(String($("[data-k=qty]", r).value).replace(",", ".")) || 0, p = parseEuro($("[data-k=unit_net]", r).value); return p > 0 ? s + Math.round(q * p) : s; }, 0);
        const betrag = prozent ? Math.round(basis * Math.min(zahl, 100) / 100) : Math.round(zahl * 100);
        if (!betrag) return toast("Es gibt noch keine Positionen, auf die sich der Rabatt beziehen kann.");
        rowsBox.insertAdjacentHTML("beforeend", row({ title: prozent ? `Rabatt ${String(zahl).replace(".", ",")} %` : "Rabatt", qty: 1, unit: "pauschal", unit_net: -betrag, vat_rate: rate }));
        recalc(); return;
      }
      if (e.target.closest("[data-addplan]")) { planBox.insertAdjacentHTML("beforeend", planRow({ on: "Launch" })); recalc(); return; }
      if (e.target.closest("[data-delplan]")) { e.target.closest(".fplanrow").remove(); recalc(); return; }
      const ad = e.target.closest("[data-addr]"); if (ad) return addrDialog(+ad.dataset.addr, loadAddr);
      try {
        if (e.target.closest("[data-preview]")) {
          const body = collect(); if (!body.client_id) throw new Error("Bitte einen Kunden wählen.");
          const res = await fetch("/api/admin/finance/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Vorschau fehlgeschlagen");
          window.open(URL.createObjectURL(await res.blob()), "_blank"); return;
        }
        if (e.target.closest("[data-del]")) { if (!(await UI.confirm("Der Entwurf wird gelöscht.", { title: "Entwurf löschen?", ok: "Löschen", danger: true }))) return; await api(`/finance/invoices/${inv.id}`, { method: "DELETE", body: {} }); close(); toast("Entwurf gelöscht"); window.loadFinance(); return; }
        if (e.target.closest("[data-issue]")) { const r = await save(); return issueDialog(r, () => { close(); window.loadFinance(); }); }
      } catch (err) { toast(err.message); }
    });
    f.addEventListener("submit", async e => { e.preventDefault(); try { await save(); toast("Entwurf gespeichert"); close(); window.loadFinance(); } catch (err) { toast(err.message); } });
  }

  function issueDialog(inv, done) {
    const isQuote = inv.kind === "angebot";
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card" style="width:min(520px,100%);display:grid;gap:14px">
      <h2 style="margin:0">${isQuote ? "Angebot" : "Rechnung"} festschreiben</h2>
      <p class="hint" style="margin:0">${isQuote ? "Das Angebot bekommt seine Nummer und wird als PDF im Kundenportal abgelegt." : "Die Rechnung bekommt ihre fortlaufende Nummer und ist danach <b>nicht mehr änderbar</b> (GoBD). Korrekturen nur über eine Stornorechnung. Das PDF liegt anschließend im Kundenportal."}</p>
      <div class="fsum"><span>${esc(inv.client_company)}</span><b>${money(inv.gross)}</b></div>
      ${KANAL.html({ modus: "haken", mailText: "mit PDF im Anhang", span: false, titel: "Dem Kunden schicken", hinweis: `E-Mail mit PDF an ${inv.client_email}. Im Portal liegt das PDF in jedem Fall.` })}
      <label>Persönliche Nachricht (optional)<textarea name="message" rows="3" placeholder="Leer lassen für den Standardtext"></textarea></label>
      <p class="err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">Jetzt festschreiben</button></div></form>`;
    document.body.appendChild(m);
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
    $("form", m).addEventListener("submit", async e => {
      e.preventDefault(); const f = e.target, b = $("[type=submit]", f); b.disabled = true; b.textContent = "Wird erstellt …";
      const k = KANAL.werte(f);
      try { const r = await api(`/finance/invoices/${inv.id}/issue`, { method: "POST", body: { send: k.mail, chat: k.chat, message: f.message.value } });
        m.remove(); done(); toast(`${r.invoice.number} festgeschrieben${k.mail ? (r.mailed ? " und per Mail verschickt" : " – Mail liegt im Postausgang") : ""}${k.chat ? " · im Chat" : ""}.`); openInvoice(r.invoice.id); }
      catch (err) { const p = $(".err", f); p.textContent = err.message; p.hidden = false; b.disabled = false; b.textContent = "Jetzt festschreiben"; }
    });
  }

  // Detailansicht (festgeschrieben) bzw. Editor (Entwurf)
  async function openInvoice(id) {
    const inv = await api(`/finance/invoices/${id}`);
    if (!inv.locked) return editor(inv);
    const isQuote = inv.kind === "angebot", r = inv.recipient;
    const m = document.createElement("div"); m.className = "modal fmodal";
    const acts = [];
    acts.push(`<a class="btn btn--ghost" href="/api/admin/finance/invoices/${id}/pdf" target="_blank" rel="noopener">PDF öffnen</a>`);
    acts.push(`<button class="btn btn--ghost" data-erneut data-art="${inv.kind}" data-ref="${id}" data-url="/finance/invoices/${id}/send" data-mailtext="mit PDF im Anhang" data-titel="${esc(inv.number)} erneut schicken">${inv.versand?.length ? "Erneut schicken …" : "Schicken …"}</button>`);
    if (inv.kind === "rechnung" && inv.status === "offen") {
      acts.push(`<button class="btn btn--grad" data-a="paid">Zahlung eingegangen</button>`);
      if (inv.dunning?.overdue > 0) acts.push(`<button class="btn btn--ghost" data-a="remind">${esc(inv.dunning.next)} senden</button>`);
      acts.push(`<button class="btn btn--danger" data-a="cancel">Stornieren</button>`);
    }
    if (inv.kind === "rechnung" && inv.status === "bezahlt") acts.push(`<button class="btn btn--ghost" data-a="unpaid">Zahlung zurücknehmen</button>`, `<button class="btn btn--danger" data-a="cancel">Stornieren</button>`);
    if (isQuote) { if (inv.status === "versendet") acts.push(`<button class="btn btn--ghost" data-a="accept" title="Nur nutzen, wenn der Kunde außerhalb des Portals zugesagt hat">Zusage außerhalb des Portals</button>`, `<button class="btn btn--ghost" data-a="reject">Abgelehnt</button>`); if (!inv.acceptance) acts.push(`<button class="btn btn--ghost" data-a="convert">In Rechnung übernehmen</button>`); }
    m.innerHTML = `<div class="card fedit fdetail">
      <header class="fedit__head"><div><p class="kicker">${isQuote ? "Angebot" : inv.kind === "storno" ? "Stornorechnung" : "Rechnung"}</p><h2>${esc(inv.number)} ${pill({ ...inv, locked: 1 })}</h2></div><button type="button" class="x" data-close>✕</button></header>
      <div class="fedit__body">
        <div class="fdl"><div><small>Kunde</small><b>${esc(r.company)}</b><span>${esc([r.street, [r.zip, r.city].join(" ")].filter(Boolean).join(", "))}</span></div>
          <div><small>${isQuote ? "Angebotsdatum" : "Rechnungsdatum"}</small><b>${de(inv.issue_date)}</b><span>${isQuote ? "gültig bis " + de(inv.valid_until) : inv.kind === "rechnung" ? "fällig " + de(inv.due_date) : "zu " + esc(inv.cancels_number || "")}</span></div>
          <div><small>Betrag</small><b>${money(inv.gross)}</b><span>${money(inv.net)} netto + ${money(inv.vat)} USt.</span></div>
          <div><small>Status</small><b>${inv.status === "bezahlt" ? "Bezahlt am " + de(inv.paid_at) : (STAT[inv.status] || [inv.status])[0]}</b><span>${inv.versand?.length ? "zuletzt verschickt " + ERNEUT.zeit(inv.versand[0].at) + " · " + inv.versand[0].kanal_text : inv.sent_at ? "versendet " + fmt(inv.sent_at.replace(" ", "T") + "Z", { dateStyle: "short", timeStyle: "short" }) : "noch nicht verschickt"}${inv.dunning_level ? ` · ${inv.dunning_level}× gemahnt` : ""}</span></div></div>
        ${inv.title ? `<p style="margin:0"><b>${esc(inv.title)}</b>${inv.project_title ? ` · Projekt ${esc(inv.project_title)}` : ""}</p>` : ""}
        <div class="ftable ftable--items"><div class="ftable__h"><span>Pos.</span><span>Leistung</span><span>Menge</span><span class="num">Einzelpreis</span><span class="num">Gesamt</span></div>
          ${inv.items.map(it => `<div class="ftable__r"><span>${it.pos}</span><span><b>${esc(it.title)}</b>${it.description ? `<small>${esc(it.description)}</small>` : ""}</span><span>${String(it.qty).replace(".", ",")} ${esc(it.unit || "")}</span><span class="num">${money(it.unit_net)}</span><span class="num">${money(it.net)}</span></div>`).join("")}</div>
        ${isQuote && inv.planText ? `<p class="hint" style="margin:0">${esc(inv.planText)}${inv.avv ? " · mit AVV" : ""}</p>` : ""}
        ${isQuote && inv.acceptance ? `<div class="faccept faccept--${inv.acceptance.decision}"><b>${inv.acceptance.decision === "angenommen" ? "✓ Im Kundenportal angenommen" : "Im Kundenportal abgelehnt"}</b>
          <span>${esc(inv.acceptance.name || "")}${inv.acceptance.position ? ", " + esc(inv.acceptance.position) : ""} · ${fmt(inv.acceptance.created_at.replace(" ", "T") + "Z", { dateStyle: "medium", timeStyle: "short" })} · IP ${esc(inv.acceptance.ip || "–")}</span>
          ${inv.acceptance.reason ? `<span>„${esc(inv.acceptance.reason)}“</span>` : ""}${inv.acceptance.doc_id ? `<a class="link" href="/api/admin/documents/${inv.acceptance.doc_id}/file" target="_blank" rel="noopener">Auftragsbestätigung (PDF) öffnen</a>` : ""}</div>`
          : isQuote && inv.status === "versendet" ? `<p class="hint" style="margin:0">Der Kunde kann dieses Angebot im Kundenportal ansehen und verbindlich annehmen${inv.project_id ? "" : " – ohne Projekt wird bei der Annahme automatisch eins angelegt"}.</p>` : ""}
        <p class="hint" style="margin:0">🔒 Festgeschrieben am ${fmt((inv.issued_at || inv.created_at).replace(" ", "T") + "Z", { dateStyle: "medium", timeStyle: "short" })} · SHA-256 ${esc((inv.pdf_sha256 || "").slice(0, 16))}… · Änderungen nur per Storno.</p>
      </div>
      <footer class="fedit__foot fedit__foot--acts">${acts.join("")}</footer></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", async e => {
      if (e.target === m || e.target.closest("[data-close]")) return m.remove();
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      try {
        if (a === "send") { const r2 = await api(`/finance/invoices/${id}/send`, { method: "POST", body: {} }); toast(r2.mailed ? "Erneut verschickt" : "Mail liegt im Postausgang (E-Mail noch nicht eingerichtet)"); }
        if (a === "paid") { const d = await UI.prompt("Zahlung eingegangen", { label: "Eingang am", type: "date", value: new Date().toISOString().slice(0, 10), ok: "Als bezahlt markieren" }); if (!d) return; await api(`/finance/invoices/${id}/paid`, { method: "POST", body: { date: d } }); toast("Als bezahlt markiert – Zahlungsplan und Kunde sind aktualisiert."); }
        if (a === "unpaid") { if (!(await UI.confirm("Die Rechnung steht danach wieder auf offen.", { title: "Zahlung zurücknehmen?" }))) return; await api(`/finance/invoices/${id}/paid`, { method: "POST", body: { undo: true } }); }
        if (a === "remind") { if (!(await UI.confirm(`Mit Rechnung als PDF an ${inv.client_email}.`, { title: `${inv.dunning.next} senden?`, ok: "Senden" }))) return; const r2 = await api(`/finance/invoices/${id}/remind`, { method: "POST", body: {} }); toast(`${r2.label} ${r2.mailed ? "verschickt" : "im Postausgang"}`); }
        if (a === "cancel") { const reason = await UI.prompt("Rechnung stornieren", { text: "Es wird eine Stornorechnung mit negativem Betrag erstellt.", label: "Grund (erscheint auf der Stornorechnung)", ok: "Weiter" }); if (reason === null) return; const sendSt = await UI.choice("Soll der Kunde die Stornorechnung per E-Mail bekommen?", [{ label: "Nur ablegen", value: false }, { label: "Per E-Mail senden", value: true, primary: true }], { title: "Stornorechnung" }); if (sendSt === null) return; const r2 = await api(`/finance/invoices/${id}/cancel`, { method: "POST", body: { reason, send: sendSt } }); toast(`Storniert durch ${r2.invoice.number}`); }
        if (a === "accept") { const who = await UI.prompt("Zusage außerhalb des Portals", { text: "Projekt, Zahlungsplan und die erste Rechnung (als Entwurf) werden genauso angelegt wie bei einer Annahme im Portal. Der Kunde bekommt die Auftragsbestätigung per E-Mail.", label: "Wer hat zugesagt? (Name)", value: inv.recipient?.name || "", ok: "Auftrag anlegen" }); if (!who) return;
          await api(`/contracts/quote/${id}/accept`, { method: "POST", body: { name: who, via: "Zusage per Telefon/E-Mail" } }); toast("Auftrag angelegt – die erste Rechnung wartet im Cockpit auf Freigabe."); }
        if (a === "reject") await api(`/finance/invoices/${id}/status`, { method: "POST", body: { status: "abgelehnt" } });
        if (a === "convert") { const r2 = await api(`/finance/invoices/${id}/convert`, { method: "POST", body: {} }); m.remove(); ftab = "rechnungen"; history.replaceState(null, "", "#finanzen/rechnungen"); await window.loadFinance(); return editor(r2); }
        m.remove(); await window.loadFinance(); if (!["cancel"].includes(a)) openInvoice(id);
      } catch (err) { toast(err.message); }
    });
  }

  function addrDialog(cid, after) {
    api(`/finance/clients/${cid}/billing`).then(a => {
      const m = document.createElement("div"); m.className = "modal";
      m.innerHTML = `<form class="card form-grid" style="width:min(560px,100%)"><h2>Rechnungsadresse</h2>
        <label class="span2">Firmenname auf der Rechnung<input name="billing_name" value="${esc(a.billing_name || "")}" placeholder="${esc(a.company)}"></label>
        <label class="span2">Straße &amp; Hausnummer<input name="street" value="${esc(a.street)}" required></label>
        <label>PLZ<input name="zip" value="${esc(a.zip)}" required></label><label>Ort<input name="city" value="${esc(a.city)}" required></label>
        <label>Land<input name="country" value="${esc(a.country || "Deutschland")}"></label><label>USt-IdNr. (optional)<input name="vat_id" value="${esc(a.vat_id)}"></label>
        <label>Kundennummer<input name="customer_no" value="${esc(a.customer_no)}"></label>
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">Speichern</button></div></form>`;
      document.body.appendChild(m);
      m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
      $("form", m).addEventListener("submit", async e => { e.preventDefault(); try { await api(`/finance/clients/${cid}/billing`, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); m.remove(); toast("Rechnungsadresse gespeichert"); after?.(); } catch (err) { toast(err.message); } });
    });
  }
  window.FIN = { editor, addrDialog, open: id => openInvoice(id) };

  /* ---------- Belege ---------- */
  let expYear = new Date().getFullYear();
  async function expenses() {
    const [rows, cl] = await Promise.all([api(mitFirma(`/finance/expenses?year=${expYear}`)), clients()]);
    const cur = today().slice(0, 7), hwAn = !!META.firmen?.hardwareAktiv, sicht = hwAn ? (FIRMA ? [FIRMA] : ["software", "hardware"]) : ["software"];
    // Abgeschlossen wird je Firma: „zu“ = alle gezeigten Firmen, „teil“ = erst eine von beiden
    const zu = new Set(META.periods.map(p => p.period + "|" + (p.firma || "software")));
    const abschluss = mo => { const n = sicht.filter(f => zu.has(mo + "|" + f)).length; return n === sicht.length ? "zu" : n ? "teil" : "offen"; };
    const abKnopf = hwAn ? (FIRMA ? `Monat für ${esc(META.firmen[FIRMA])} abschließen` : "Monat für beide Firmen abschließen") : "Monat abschließen";
    const months = [...new Set(rows.map(r => r.doc_date.slice(0, 7)))].sort().reverse();
    $("#finExpenses").innerHTML = `
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.5fr)">
        <form class="card form-grid" id="expForm"><h2>Beleg erfassen</h2>
          <div class="drop span2" id="expDrop"><b>Beleg hierher ziehen</b>PDF, Foto oder E-Rechnung (XML) · <button type="button" class="link" data-pick>Datei wählen</button><input type="file" id="expFile" accept=".pdf,.png,.jpg,.jpeg,.webp,.xml" hidden><span id="expFileName"></span></div>
          <label>Belegdatum<input type="date" name="doc_date" value="${today()}" required></label>
          <label>Lieferant<input name="supplier" required placeholder="z. B. IONOS, Apple, OpenAI"></label>
          <label class="span2">Beschreibung<input name="description" placeholder="z. B. Server November"></label>
          ${META.firmen?.hardwareAktiv ? `<label>Firma<select name="firma"><option value="software">${esc(META.firmen.software)}</option><option value="hardware" ${FIRMA === "hardware" ? "selected" : ""}>${esc(META.firmen.hardware)}</option></select></label>` : ""}
          <label>Kategorie<select name="category">${META.categories.map(c => `<option>${esc(c.label)}</option>`).join("")}</select></label>
          <label>Steuer<select name="tax_mode">${Object.entries(META.taxModes).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></label>
          <label>Betrag brutto (€)<input name="gross" inputmode="decimal" required placeholder="119,00"></label>
          <label>Bezahlt am<input type="date" name="paid_date"></label>
          <p class="hint span2" id="expCalc" style="margin:0"></p>
          <div class="span2"><button class="btn btn--grad" type="submit">Beleg speichern</button></div>
        </form>
        <div class="card"><div class="fhead"><h2 style="margin:0">Belege ${expYear}</h2><div class="seg"><button data-y="${expYear - 1}">${expYear - 1}</button><button class="on">${expYear}</button>${expYear < new Date().getFullYear() ? `<button data-y="${expYear + 1}">${expYear + 1}</button>` : ""}</div></div>
          ${months.length ? months.map(mo => { const list = rows.filter(r => r.doc_date.startsWith(mo)), sum = list.filter(r => r.status !== "storniert" && !r.reversal_of).reduce((s, r) => s + r.gross, 0);
            return `<div class="fmonth"><div class="fmonth__h"><b>${new Date(mo + "-15").toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</b><span>${money(sum)}</span>
              ${abschluss(mo) === "zu" ? `<span class="fpill fpill--paid">🔒 abgeschlossen</span>` : mo < cur ? `${abschluss(mo) === "teil" ? `<span class="fpill">🔒 eine Firma abgeschlossen</span>` : ""}<button class="btn btn--ghost btn--sm" data-lock="${mo}">${abKnopf}</button>` : `<span class="hint" style="margin:0">laufender Monat</span>`}</div>
              ${list.map(r => `<div class="frow ${r.status === "storniert" ? "frow--void" : ""}"><span class="mono">${esc(r.number)}</span><div><b>${esc(r.supplier)}</b><small>${de(r.doc_date)} · ${esc(r.category)} · ${esc(META.taxModes[r.tax_mode]?.label || "")}${r.description ? " · " + esc(r.description) : ""}</small></div>
                <span class="num">${money(r.gross)}</span>
                <span class="frow__acts">${r.has_file ? `<a class="btn btn--ghost btn--sm" href="/api/admin/finance/expenses/${r.id}/file" target="_blank" rel="noopener">Beleg</a>` : `<span class="fpill fpill--late" title="Ohne Belegdatei">ohne Datei</span>`}
                ${r.status === "storniert" ? `<span class="fpill fpill--void">storniert</span>` : r.reversal_of ? `<span class="fpill fpill--void">Gegenbuchung</span>` : `<button class="x" data-expcancel="${r.id}" title="Stornieren">✕</button>`}</span></div>`).join("")}</div>`; }).join("")
          : `<div class="empty">Noch keine Belege in ${expYear}.</div>`}</div>
      </div>`;
    const f = $("#expForm"); let file = null;
    const calc = () => { const g = parseEuro(f.gross.value), tm = META.taxModes[f.tax_mode.value]; if (!g) { $("#expCalc").textContent = ""; return; }
      $("#expCalc").textContent = tm.rc ? `Reverse Charge: ${money(g)} netto · USt und Vorsteuer je ${money(Math.round(g * .19))} (heben sich auf)` : tm.rate ? `= ${money(Math.round(g * 100 / (100 + tm.rate)))} netto + ${money(g - Math.round(g * 100 / (100 + tm.rate)))} Vorsteuer` : `${money(g)} ohne Vorsteuer`; };
    f.addEventListener("input", calc); f.addEventListener("change", calc);
    const take = fl => { file = fl; $("#expFileName").textContent = fl ? " · " + fl.name : ""; if (fl && !f.supplier.value) f.supplier.value = fl.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 60); };
    $("#expDrop").addEventListener("click", e => { if (e.target.closest("[data-pick]")) $("#expFile").click(); });
    $("#expFile").addEventListener("change", e => take(e.target.files[0]));
    $("#expDrop").addEventListener("dragover", e => { e.preventDefault(); e.currentTarget.classList.add("over"); });
    $("#expDrop").addEventListener("dragleave", e => e.currentTarget.classList.remove("over"));
    $("#expDrop").addEventListener("drop", e => { e.preventDefault(); e.currentTarget.classList.remove("over"); take(e.dataTransfer.files[0]); });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const body = Object.fromEntries(new FormData(f));
      if (file) { if (file.size > 15 * 1048576) return toast("Höchstens 15 MB."); const u8 = new Uint8Array(await file.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); body.data = btoa(s); body.file_name = file.name; }
      try { const r = await api("/finance/expenses", { method: "POST", body }); toast(`${r.number} gespeichert`); expenses(); } catch (err) { toast(err.message); }
    });
    $("#finExpenses").onclick = async e => {
      const y = e.target.closest("[data-y]"); if (y) { expYear = +y.dataset.y; return expenses(); }
      const lk = e.target.closest("[data-lock]"); if (lk) { if (!(await UI.confirm("Alle Belege des Monats werden festgeschrieben und sind danach nur noch per Storno korrigierbar.", { title: `${lk.dataset.lock} abschließen?`, ok: "Abschließen" }))) return; try { await api(`/finance/periods/${lk.dataset.lock}/lock`, { method: "POST", body: { firma: FIRMA } }); await meta(); toast("Monat abgeschlossen"); expenses(); } catch (err) { toast(err.message); } return; }
      const c = e.target.closest("[data-expcancel]"); if (c) { if (!(await UI.confirm("Die Belegnummer bleibt erhalten; bei abgeschlossenen Monaten entsteht ein Gegenbeleg.", { title: "Beleg stornieren?", ok: "Stornieren", danger: true }))) return; try { await api(`/finance/expenses/${c.dataset.expcancel}/cancel`, { method: "POST", body: {} }); toast("Storniert"); expenses(); } catch (err) { toast(err.message); } }
    };
  }

  /* ---------- Auswertung & Export ---------- */
  let period = null;
  function presets() { const y = new Date().getFullYear(), mo = new Date().getMonth(), q = Math.floor(mo / 3), p = n => String(n).padStart(2, "0"), end = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    const lm = mo === 0 ? [y - 1, 12] : [y, mo];
    return [["Letzter Monat", `${lm[0]}-${p(lm[1])}-01`, end(lm[0], lm[1])], ["Dieses Quartal", `${y}-${p(q * 3 + 1)}-01`, end(y, q * 3 + 3)], ["Letztes Quartal", q ? `${y}-${p(q * 3 - 2)}-01` : `${y - 1}-10-01`, q ? end(y, q * 3) : `${y - 1}-12-31`], ["Dieses Jahr", `${y}-01-01`, `${y}-12-31`], ["Letztes Jahr", `${y - 1}-01-01`, `${y - 1}-12-31`]]; }
  async function reportView() {
    const ps = presets(); period ||= ps[1];
    const [r, log] = await Promise.all([api(mitFirma(`/finance/report?from=${period[1]}&to=${period[2]}`)), api("/finance/audit")]);
    const maxCat = Math.max(1, ...r.byCategory.map(c => c.net));
    $("#finReport").innerHTML = `
      <div class="fhead"><div class="seg" id="perSeg">${ps.map(p => `<button data-p="${p[0]}" class="${p[0] === period[0] ? "on" : ""}">${p[0]}</button>`).join("")}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="date" id="pFrom" value="${period[1]}" style="width:auto"><span>–</span><input type="date" id="pTo" value="${period[2]}" style="width:auto"><button class="btn btn--ghost btn--sm" id="pApply">Anzeigen</button></div></div>
      <div class="tiles">
        <div class="tile"><small>Umsatz netto</small><b>${m0(r.revenueNet)}</b><span>${r.invoices} Rechnung${r.invoices === 1 ? "" : "en"} · ${esc(r.method)}</span></div>
        <div class="tile"><small>Ausgaben netto</small><b>${m0(r.expensesNet)}</b><span>${r.expenses} Beleg${r.expenses === 1 ? "" : "e"}</span></div>
        <div class="tile tile--grad"><small>Ergebnis (vereinfacht)</small><b>${m0(r.result)}</b><span>Umsatz − Ausgaben, netto</span></div>
      </div>
      <div class="ckgrid">
        <div class="card"><h2>Umsatzsteuer</h2>
          <div class="ftotals ftotals--wide"><div><span>Umsatzsteuer aus Rechnungen</span><b>${money(r.ust)}</b></div><div><span>Umsatzsteuer § 13b (Reverse Charge)</span><b>${money(r.rcUst)}</b></div>
            <div><span>abziehbare Vorsteuer</span><b>− ${money(r.vst)}</b></div><div class="ftotals__sum"><span>${r.zahllast >= 0 ? "Zahllast ans Finanzamt" : "Erstattung vom Finanzamt"}</span><b>${money(Math.abs(r.zahllast))}</b></div></div>
          <p class="hint" style="margin:12px 0 0">Orientierungswerte für die Umsatzsteuer-Voranmeldung. Die Meldung selbst macht Ihr Steuerberater (oder ELSTER).</p></div>
        <div class="card"><h2>Ausgaben nach Kategorie</h2>${r.byCategory.length ? `<div class="phasebars">${r.byCategory.map(c => `<div class="phasebar" style="grid-template-columns:200px 1fr 90px"><span>${esc(c.category)}</span><i><em style="width:${c.net / maxCat * 100}%"></em></i><b>${m0(c.net)}</b></div>`).join("")}</div>` : `<div class="empty">Keine Ausgaben im Zeitraum.</div>`}</div>
      </div>
      <div class="card fexport"><div><h2>Export für den Steuerberater</h2><p class="hint" style="margin:0">ZIP mit Rechnungsausgangsbuch, Belegliste, USt-Übersicht, DATEV-Buchungsstapel (SKR04) und allen PDFs/Belegen inkl. Prüfsummen. Die Kontenzuordnung bitte einmal mit dem Steuerberater abstimmen${META.company.datevBerater ? "" : " – Berater-/Mandantennummer unter Einstellungen → Unternehmen eintragen"}.</p></div>
        <a class="btn btn--grad" href="${mitFirma(`/api/admin/finance/export?from=${period[1]}&to=${period[2]}`)}">ZIP herunterladen</a></div>
      <div class="card"><h2>Protokoll</h2><p class="hint">Jede Festschreibung, Zahlung, Storno, Mahnung und jeder Export – unveränderbar.</p>
        <div class="flog">${log.slice(0, 60).map(l => `<div><span>${fmt(l.at.replace(" ", "T") + "Z", { dateStyle: "short", timeStyle: "short" })}</span><b>${esc(l.action)}</b><span>${esc(l.summary || "")}</span><span class="muted">${esc(l.actor || "")}</span></div>`).join("") || `<div class="empty">Noch keine Einträge.</div>`}</div></div>`;
    $("#perSeg").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { period = ps.find(p => p[0] === b.dataset.p); reportView(); } };
    $("#pApply").onclick = () => { period = ["Eigener Zeitraum", $("#pFrom").value, $("#pTo").value]; reportView(); };
  }

  // Aus dem Projekt heraus: „Rechnung erstellen“ für eine Zahlungsposition
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#finanzen")) { let pre = null; try { pre = JSON.parse(sessionStorage.getItem("rs-new-invoice") || "null"); sessionStorage.removeItem("rs-new-invoice"); } catch {} if (pre) setTimeout(() => editor({ kind: "rechnung", ...pre }), 300); } });
})();
