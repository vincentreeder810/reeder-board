/* Board – Software & Verträge: MRR-Übersicht, laufende Verträge, Produktkatalog (nutzt $, $$, esc, api, toast, fmt, ME, DD, UI) */
(() => {
  const money = (c, d = 0) => c == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(c / 100);
  const money2 = c => money(c, c % 100 ? 2 : 0);
  const de = d => d ? d.split("-").reverse().join(".") : "–";
  const euroIn = c => c == null ? "" : (c / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const ST = { aktiv: ["aktiv", "paid"], gekuendigt: ["gekündigt", "late"], beendet: ["beendet", "void"] };
  const PST = { Idee: "idee", Konzept: "konzept", Entwicklung: "dev", Beta: "beta", Live: "live", Pausiert: "pause" };
  let tab = "uebersicht", KINDS = [], filt = { kind: "", status: "laufend" };

  window.loadSoftware = async () => {
    const sub = location.hash.split("/")[1];
    if (!ME.owner) tab = "produkte"; else if (sub && $(`#swTabs [data-t="${sub}"]`)) tab = sub;
    $$("#swTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
    $$("[data-sw]").forEach(d => d.hidden = d.dataset.sw !== tab);
    if (tab === "uebersicht") return overview();
    if (tab === "vertraege") return contracts();
    return products();
  };
  $("#swTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.t; history.replaceState(null, "", "#software/" + tab); window.loadSoftware().catch(err => toast(err.message)); });

  /* ---------- Übersicht ---------- */
  async function overview() {
    const o = await api("/vertraege/uebersicht"), max = Math.max(1, ...o.history.map(h => h.mrr));
    const row = (c, right, sub) => `<button class="swrow" data-c="${c.id}"><span class="swrow__m"><b>${esc(c.company)}</b><small>${esc(c.title)}</small></span><span class="swrow__r">${right}<small>${sub}</small></span></button>`;
    $("#swOverview").innerHTML = `
      <div class="tiles">
        <div class="tile tile--grad"><small>Monatliche Einnahmen aus Verträgen</small><b>${money(o.mrr)}</b><span>netto pro Monat${o.growth != null ? ` · ${o.growth >= 0 ? "+" : ""}${String(o.growth).replace(".", ",")} % zum Vormonat` : ""}</span></div>
        <div class="tile"><small>Hochgerechnet aufs Jahr</small><b>${money(o.arr)}</b><span>Monatsbetrag × 12</span></div>
        <a class="tile" href="#software/vertraege" data-go="vertraege"><small>Laufende Verträge</small><b>${o.count}</b><span>bei ${o.customers} Kunde${o.customers === 1 ? "" : "n"} · Ø ${money(o.avg)} pro Kunde</span></a>
        <div class="tile"><small>Letzte 12 Monate</small><b>+${money(o.new12)}</b><span>neu gewonnen · ${o.churn12 ? "−" + money(o.churn12) + " gekündigt" : "nichts verloren"}</span></div>
      </div>
      <div class="ckgrid">
        <div class="stack">
          <div class="card"><h2>Verlauf der monatlichen Einnahmen <small class="hint" style="font-weight:400;margin:0">netto, Stand Monatsende</small></h2>
            <div class="mrrchart">${o.history.map(h => `<div class="mrrchart__col" title="${MON[+h.month.slice(5) - 1]} ${h.month.slice(0, 4)}: ${money(h.mrr)} · ${h.count} Verträge${h.added ? " · +" + money(h.added) : ""}${h.lost ? " · −" + money(h.lost) : ""}">
              <em>${h.mrr ? (h.mrr >= 100000 ? (Math.round(h.mrr / 10000) / 10).toLocaleString("de-DE") + " T€" : money(h.mrr)) : ""}</em><div class="mrrchart__bar"><i style="height:${h.mrr / max * 100}%"></i></div><span>${MON[+h.month.slice(5) - 1]}</span></div>`).join("")}</div></div>
          <div class="card"><h2>Woher die monatlichen Einnahmen kommen</h2><div class="swbars">${o.byKind.map(x => `<div><span>${esc(x.k)}</span><i><em style="width:${x.v / Math.max(1, o.mrr) * 100}%"></em></i><b>${money(x.v)}</b></div>`).join("") || `<div class="empty">Noch keine Verträge.</div>`}</div>
            ${o.byProduct.length > 1 ? `<h3 class="swh3">nach Produkt</h3><div class="swbars swbars--alt">${o.byProduct.map(x => `<div><span>${esc(x.k)}</span><i><em style="width:${x.v / Math.max(1, o.mrr) * 100}%"></em></i><b>${money(x.v)}</b></div>`).join("")}</div>` : ""}</div>
        </div>
        <div class="stack">
          <div class="card"><h2>Fristen in den nächsten 60 Tagen</h2>${o.deadlines.length ? `<div class="swlist">${o.deadlines.map(c => row(c, `Frist ${de(c.noticeBy).slice(0, 6)}`, `${money(c.mrr)}/Monat`)).join("")}</div>`
            : `<div class="allclear"><b>Keine Fristen in Sicht.</b><span>Kein Vertrag kann in den nächsten 60 Tagen gekündigt werden.</span></div>`}</div>
          ${o.ending.length ? `<div class="card"><h2>Gekündigt</h2><div class="swlist">${o.ending.map(c => row(c, `endet ${de(c.end_date)}`, `−${money(c.mrr)}/Monat`)).join("")}</div></div>` : ""}
          <div class="card"><h2>Signature: Kaufoptionen</h2>${o.buyouts.length ? `<div class="swlist">${o.buyouts.map(c => `<button class="swrow" data-c="${c.id}"><span class="swrow__m"><b>${esc(c.company)}</b><small>Kaufoption ab ${de(c.buyout_from)}</small>
              <span class="swprog"><i style="width:${Math.min(100, c.credit / Math.max(1, c.buyout_net) * 100)}%"></i></span></span><span class="swrow__r">${money(c.buyout_rest)}<small>Rest von ${money(c.buyout_net)}</small></span></button>`).join("")}</div>`
            : `<p class="hint" style="margin:0">Bei Signature-Verträgen mit Kaufpreis sehen Sie hier, wie viel schon angerechnet ist und ab wann der Kunde kaufen kann.</p>`}</div>
        </div>
      </div>`;
  }

  /* ---------- Verträge ---------- */
  async function contracts() {
    const d = await api("/vertraege"); KINDS = d.kinds;
    const list = d.list.filter(c => (!filt.kind || c.kind === filt.kind) && (filt.status === "alle" || (filt.status === "laufend" ? c.status !== "beendet" : c.status === filt.status)));
    const sum = list.filter(c => c.status !== "beendet").reduce((s, c) => s + c.mrr, 0);
    $("#swContracts").innerHTML = `<div class="fhead"><div class="pfilters">
        ${DD.html("swKind", [{ v: "", l: "Alle Arten" }, ...KINDS.map(k => ({ v: k, l: k, n: d.list.filter(c => c.kind === k && c.status !== "beendet").length || null }))], filt.kind, { label: "Art" })}
        ${DD.html("swStatus", [{ v: "laufend", l: "Laufend" }, { v: "aktiv", l: "Aktiv" }, { v: "gekuendigt", l: "Gekündigt" }, { v: "beendet", l: "Beendet" }, { v: "alle", l: "Alle" }], filt.status, { label: "Status" })}
        <span class="hint" style="margin:0">${list.length} Vertr${list.length === 1 ? "ag" : "äge"} · ${money(sum)} pro Monat</span></div>
        <button class="btn btn--grad" data-newc>Neuer Vertrag</button></div>
      ${list.length ? `<div class="ftable swtable"><div class="ftable__h"><span>Kunde / Vertrag</span><span>Art</span><span class="num">pro Monat</span><span>Laufzeit</span><span>Nächste Rechnung</span><span>Status</span></div>
        ${list.map(c => `<button class="ftable__r" data-c="${c.id}"><span><b>${esc(c.company)}</b><small>${esc(c.title)}${c.product_name && c.product_name !== c.kind ? " · " + esc(c.product_name) : ""}</small></span><span>${esc(c.kind)}</span>
          <span class="num"><b>${money2(c.amount_net)}</b><small>${c.interval_months > 1 ? `Abrechnung alle ${c.interval_months} Mon.` : "monatlich"}</small></span>
          <span>${c.status === "aktiv" ? (c.inMinTerm ? `Mindestlaufzeit bis ${de(c.minEnd)}` : c.periodEnd ? `bis ${de(c.periodEnd)}` : "monatlich kündbar") : c.end_date ? `endet ${de(c.end_date)}` : "–"}<small>${c.status === "aktiv" && c.noticeBy ? `kündbar bis ${de(c.noticeBy)}` : c.cancelled_at ? `gekündigt am ${de(c.cancelled_at)}` : ""}</small></span>
          <span>${c.status === "beendet" ? "–" : c.auto_invoice ? de(c.next_invoice) : "manuell"}<small>${c.buyout_net != null ? `angerechnet ${money(c.credit)}` : ""}</small></span>
          <span><span class="fpill fpill--${ST[c.status][1]}">${ST[c.status][0]}</span></span></button>`).join("")}</div>`
        : `<div class="empty">${d.list.length ? "Kein Vertrag passt zum Filter." : "Noch keine Verträge. Legen Sie laufende Verträge an – Betreuung, Lizenz und Hosting für Software, Wartung, Ersatzteile und Serienlieferung für Hardware – das Board rechnet sie dann automatisch ab."}</div>`}`;
  }
  DD.on("swKind", v => { filt.kind = v; contracts(); });
  DD.on("swStatus", v => { filt.status = v; contracts(); });

  /* ---------- Produkte ---------- */
  async function products() {
    const list = await api("/produkte"), own = list.filter(p => p.kind === "eigenprodukt"), svc = list.filter(p => p.kind === "leistung");
    const card = p => `<button class="swprod" data-p="${p.id}"><div class="swprod__h"><b>${esc(p.name)} <span class="ptag ptag--${p.bereich === "hardware" ? "hw" : "sw"}">${p.bereich === "hardware" ? "Hardware" : "Software"}</span></b><span class="pst pst--${PST[p.status] || "dev"}">${esc(p.status)}</span></div>
      ${p.tagline ? `<p>${esc(p.tagline)}</p>` : ""}
      ${p.kind === "eigenprodukt" ? `<div class="swprod__prog"><span class="swprog"><i style="width:${p.progress}%"></i></span><small>${p.progress} %${p.version ? " · v" + esc(p.version.replace(/^v/i, "")) : ""}</small></div>
        ${p.next_milestone ? `<div class="swprod__ms"><small>Nächster Meilenstein</small><b>${esc(p.next_milestone)}</b>${p.milestone_date ? `<span class="${p.milestone_date < today() ? "late" : ""}">${de(p.milestone_date)}</span>` : ""}</div>` : ""}` : ""}
      <div class="swprod__f"><span>${p.lead ? `<span class="avatar avatar--xs">${esc(p.lead.split(/\s+/).map(w => w[0]).slice(0, 2).join(""))}</span>${esc(p.lead.split(" ")[0])}` : `<span class="muted">ohne Verantwortliche</span>`}</span>
        <span>${p.customers ? `${p.customers} Kunde${p.customers === 1 ? "" : "n"}` : "noch keine Kunden"}${ME.owner && p.mrr ? ` · <b>${money(p.mrr)}</b>/Monat` : ""}</span></div></button>`;
    $("#swProducts").innerHTML = `<div class="fhead"><p class="hint" style="margin:0">Eigene Produkte mit Entwicklungsstand – und die Leistungen, die Sie als Vertrag verkaufen.${ME.owner ? "" : " Ändern können nur Inhaber."}</p>${ME.owner ? `<button class="btn btn--grad" data-newp>Neues Produkt</button>` : ""}</div>
      <h2 class="swsec">Eigene Produkte</h2><div class="swprods">${own.map(card).join("") || `<div class="empty">Noch keine eigenen Produkte angelegt.</div>`}</div>
      <h2 class="swsec">Leistungen &amp; Pakete</h2><div class="swprods">${svc.map(card).join("") || `<div class="empty">Noch keine Leistungen angelegt.</div>`}</div>`;
  }

  /* ---------- Dialoge ---------- */
  function modal(html, onSave, { wide = false, ok = "Speichern", extra = "" } = {}) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card bmodal" style="width:min(${wide ? 800 : 560}px,100%);max-height:92vh;overflow:auto;display:grid;gap:14px">${html}<p class="err" hidden></p>
      <div class="swfoot">${extra || "<span></span>"}<div style="display:flex;gap:8px">${onSave ? `<button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">${esc(ok)}</button>` : `<button type="button" class="btn btn--ghost" data-close>Schließen</button>`}</div></div></form>`;
    document.body.appendChild(m);
    const f = $("form", m), close = () => m.remove();
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) close(); });
    f.addEventListener("submit", async e => { e.preventDefault(); const b = $("[type=submit]", f); b.disabled = true;
      try { await onSave(f, close); close(); } catch (err) { const p = $(".err", f); p.textContent = err.message; p.hidden = false; b.disabled = false; } });
    return { m, f, close };
  }
  const refresh = () => { if (location.hash.startsWith("#software")) window.loadSoftware(); else if (location.hash.startsWith("#cockpit")) window.BOARD?.cockpit(); window.updateBadges?.(); };

  async function editContract(c = {}) {
    if (!KINDS.length) KINDS = (await api("/vertraege")).kinds;
    const [clients, prods] = await Promise.all([api("/clients"), api("/produkte")]);
    const mand = clients.filter(x => x.stage === "mandant" || x.id === c.client_id);
    const isNew = !c.id, sig = k => k === "Signature-Lizenz";
    const kind0 = c.kind || "IT-Betreuung";
    const { f, m } = modal(`<h2>${isNew ? "Neuer Vertrag" : "Vertrag bearbeiten"}</h2>
      <div class="two"><div class="field"><span>Kunde</span>${DD.html("ce-client", [{ v: "", l: "– Kunde wählen –" }, ...mand.map(x => ({ v: x.id, l: x.company }))], c.client_id || "", { field: "client_id" })}</div>
        <div class="field"><span>Projekt (optional)</span><div id="ceProj"></div></div></div>
      <div class="two"><div class="field"><span>Art</span>${DD.html("ce-kind", KINDS.map(k => ({ v: k, l: k })), kind0, { field: "kind" })}</div>
        <div class="field"><span>Produkt / Leistung (optional)</span>${DD.html("ce-prod", [{ v: "", l: "– keins –" }, ...prods.map(p => ({ v: p.id, l: p.name }))], c.product_id || "", { field: "product_id" })}</div></div>
      <label>Bezeichnung (steht so auf der Rechnung)<input name="title" required maxlength="160" value="${esc(c.title || "")}" placeholder="z. B. IT-Betreuung Praxissoftware"></label>
      <div class="three"><label>Betrag pro Monat netto (€)<input name="amount_net" required inputmode="decimal" value="${euroIn(c.amount_net)}" placeholder="450"></label>
        <div class="field"><span>Abrechnung</span>${DD.html("ce-int", [1, 3, 6, 12].map(n => ({ v: n, l: n === 1 ? "monatlich" : n === 12 ? "jährlich" : `alle ${n} Monate` })), c.interval_months || 1, { field: "interval_months" })}</div>
        <div class="field"><span>USt.</span>${DD.html("ce-vat", [19, 7, 0].map(n => ({ v: n, l: n + " %" })), c.vat_rate ?? 19, { field: "vat_rate" })}</div></div>
      <div class="three"><label>Vertragsbeginn<input type="date" name="start_date" required value="${c.start_date || today()}"></label>
        <label>Mindestlaufzeit (Monate)<input name="min_months" inputmode="numeric" value="${c.min_months ?? (sig(kind0) ? 24 : 12)}"></label>
        <label>Kündigungsfrist (Monate)<input name="notice_months" inputmode="numeric" value="${c.notice_months ?? 3}"></label></div>
      <div class="three"><label>Danach Verlängerung um (Monate)<input name="renew_months" inputmode="numeric" value="${c.renew_months ?? 12}"><small class="hint" style="margin:2px 0 0">0 = danach monatlich kündbar</small></label>
        <label>Nächste Rechnung ab<input type="date" name="next_invoice" value="${c.next_invoice || c.start_date || today()}"></label>
        <label class="check" style="align-self:center"><input type="checkbox" name="auto_invoice" ${c.auto_invoice !== false ? "checked" : ""}> <span>Rechnung automatisch vorbereiten</span></label></div>
      <fieldset class="swsig" ${sig(kind0) || c.buyout_net != null ? "" : "hidden"}><legend>Reeder Signature: Kaufoption</legend>
        <div class="three"><label>Kaufpreis netto (€)<input name="buyout_net" inputmode="decimal" value="${euroIn(c.buyout_net)}" placeholder="40.000"></label>
          <label>Anrechnung der Zahlungen (%)<input name="credit_pct" inputmode="decimal" value="${c.credit_pct ?? (sig(kind0) ? 50 : "")}"></label>
          <label>Schon gezahlt vor dem Board (€ netto)<input name="credit_before" inputmode="decimal" value="${euroIn(c.credit_before || 0)}"></label></div>
        <small class="hint" style="margin:0">Angerechnet wird der Anteil aller bezahlten Rechnungen dieses Vertrags. Kaufoption ab Ende der Mindestlaufzeit.</small></fieldset>
      <label>Notizen (intern)<textarea name="notes" rows="2">${esc(c.notes || "")}</textarea></label>`,
      async f => { const body = Object.fromEntries(new FormData(f)); body.auto_invoice = f.auto_invoice.checked;
        const r = isNew ? await api("/vertraege", { method: "POST", body }) : await api(`/vertraege/${c.id}`, { method: "PUT", body });
        toast(isNew ? "Vertrag angelegt" : "Gespeichert"); refresh(); if (isNew) setTimeout(() => openContract(r.id), 50); }, { wide: true });
    const projBox = $("#ceProj", m);
    const loadProj = async cid => { const ps = cid ? await api(`/clients/${cid}/projects`) : [];
      projBox.innerHTML = DD.html("ce-proj", [{ v: "", l: ps.length ? "– ohne Projekt –" : "– keine Projekte –" }, ...ps.map(p => ({ v: p.id, l: p.title }))], c.project_id || "", { field: "project_id" }); };
    loadProj(c.client_id);
    f.client_id.addEventListener("change", () => { c.project_id = null; loadProj(+f.client_id.value); });
    f.kind.addEventListener("change", () => { const s = sig(f.kind.value); $(".swsig", m).hidden = !s && !f.buyout_net.value;
      if (s) { if (+f.min_months.value === 12) f.min_months.value = 24; if (!f.credit_pct.value) f.credit_pct.value = 50; } });
    f.product_id.addEventListener("change", () => { const p = prods.find(x => x.id === +f.product_id.value); if (!p) return;
      if (!f.title.value) f.title.value = p.name; if (!f.amount_net.value && p.price_month) f.amount_net.value = euroIn(p.price_month); });
    f.start_date.addEventListener("change", () => { if (isNew) f.next_invoice.value = f.start_date.value; });
  }

  async function openContract(id) {
    const c = await api(`/vertraege/${id}`), sig = c.buyout_net != null;
    const extra = `<div style="display:flex;gap:8px;flex-wrap:wrap">${c.status === "aktiv" ? `<button type="button" class="btn btn--ghost btn--sm" data-a="cancel">Kündigung erfassen</button>` : c.status === "gekuendigt" ? `<button type="button" class="btn btn--ghost btn--sm" data-a="undo">Kündigung zurücknehmen</button>` : ""}
      ${c.status !== "beendet" ? `<button type="button" class="btn btn--ghost btn--sm" data-a="bill">Nächste Rechnung jetzt vorbereiten</button>` : ""}<button type="button" class="btn btn--ghost btn--sm" data-a="edit">Bearbeiten</button>
      ${!c.invoices.some(i => i.locked) ? `<button type="button" class="btn btn--danger btn--sm" data-a="del">Löschen</button>` : ""}</div>`;
    const { m, close } = modal(`<header class="swdh"><div><p class="kicker">${esc(c.kind)}${c.product_name && c.product_name !== c.kind ? " · " + esc(c.product_name) : ""}</p><h2>${esc(c.title)}</h2>
        <p class="hint" style="margin:2px 0 0"><a href="#kunden/${c.client_id}" data-close>${esc(c.company)}</a>${c.project_title ? ` · Projekt <a href="#projekte/${c.project_id}" data-close>${esc(c.project_title)}</a>` : ""}</p></div><span class="fpill fpill--${ST[c.status][1]}">${ST[c.status][0]}</span></header>
      <div class="fdl">
        <div><small>Betrag</small><b>${money2(c.amount_net)} / Monat</b><span>${money2(c.amount_gross)} brutto · ${c.interval_months === 1 ? "monatliche" : c.interval_months === 12 ? "jährliche" : `${c.interval_months}-monatliche`} Rechnung</span></div>
        <div><small>Laufzeit</small><b>seit ${de(c.start_date)}</b><span>${c.months} Monate · Mindestlaufzeit bis ${de(c.minEnd)}</span></div>
        <div><small>${c.status === "aktiv" ? "Kündigung möglich bis" : "Vertragsende"}</small><b>${c.status === "aktiv" ? (c.noticeBy ? de(c.noticeBy) : "jederzeit") : de(c.end_date)}</b><span>${c.status === "aktiv" ? (c.periodEnd ? `zum ${de(c.periodEnd)} · ${c.notice_months} Mon. Frist` : `zum Monatsende · ${c.notice_months} Mon. Frist`) : esc(c.cancelled_by ? "gekündigt von " + c.cancelled_by : "")}</span></div>
        <div><small>Nächste Rechnung</small><b>${c.status === "beendet" ? "–" : de(c.next_invoice)}</b><span>${c.auto_invoice ? "wird automatisch vorbereitet – Sie geben im Cockpit frei" : "manuell"}</span></div></div>
      ${sig ? `<div class="swbuy"><div><small>Kaufoption ab ${de(c.buyout_from)}</small><b>Restbetrag ${money(c.buyout_rest)}</b><span>Kaufpreis ${money(c.buyout_net)} − angerechnet ${money(c.credit)} (${String(c.credit_pct || 0).replace(".", ",")} % der bezahlten Zahlungen)</span></div>
        <span class="swprog swprog--big"><i style="width:${Math.min(100, c.credit / Math.max(1, c.buyout_net) * 100)}%"></i></span></div>` : ""}
      <div><h3 class="swh3">Rechnungen zu diesem Vertrag <small>${money(c.billed)} berechnet · ${money(c.paid)} bezahlt</small></h3>
        ${c.invoices.length ? `<div class="swlist">${c.invoices.map(i => `<button type="button" class="swrow" data-inv="${i.id}"><span class="swrow__m"><b>${esc(i.number || "Entwurf")}</b><small>${de(i.service_from)} – ${de(i.service_to)}</small></span><span class="swrow__r">${money2(i.gross)}<small>${!i.locked ? "wartet auf Freigabe" : i.status}</small></span></button>`).join("")}</div>` : `<p class="hint" style="margin:0">Noch keine Rechnungen.</p>`}</div>
      ${c.notes ? `<p class="cond" style="margin:0">${esc(c.notes)}</p>` : ""}`, null, { wide: true, extra });
    m.addEventListener("click", async e => {
      const inv = e.target.closest("[data-inv]"); if (inv) { close(); return window.FIN.open(+inv.dataset.inv); }
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      try {
        if (a === "edit") { close(); return editContract(c); }
        if (a === "bill") { const r = await api(`/vertraege/${c.id}/rechnung`, { method: "POST", body: {} }); close(); toast("Rechnungsentwurf angelegt"); refresh(); return window.FIN.open(r.id); }
        if (a === "undo") { await api(`/vertraege/${c.id}/reaktivieren`, { method: "POST", body: {} }); toast("Kündigung zurückgenommen"); }
        if (a === "del") { if (!(await UI.confirm("Der Vertrag und seine Rechnungsentwürfe werden gelöscht.", { title: "Vertrag löschen?", ok: "Löschen", danger: true }))) return; await api(`/vertraege/${c.id}`, { method: "DELETE", body: {} }); close(); toast("Gelöscht"); return refresh(); }
        if (a === "cancel") { close(); return cancelDialog(c); }
        close(); refresh(); openContract(c.id);
      } catch (err) { toast(err.message); }
    });
  }
  function cancelDialog(c) {
    modal(`<h2>Kündigung erfassen</h2><p class="hint" style="margin:0">${esc(c.company)} · ${esc(c.title)}. Bei einer Kündigung heute endet der Vertrag frühestens am <b>${de(c.earliestEnd)}</b>.</p>
      <div class="two"><div class="field"><span>Gekündigt von</span>${DD.html("cc-by", [{ v: "Kunde", l: "Kunde" }, { v: "Reeder Software", l: "uns" }, { v: "einvernehmlich", l: "einvernehmlich" }], "Kunde", { field: "by" })}</div>
        <label>Vertragsende<input type="date" name="end_date" value="${c.earliestEnd}" required></label></div>
      <label>Grund (intern, optional)<input name="reason" maxlength="300" placeholder="z. B. Budget, Wechsel, Projekt beendet"></label>`,
      async f => { await api(`/vertraege/${c.id}/kuendigen`, { method: "POST", body: Object.fromEntries(new FormData(f)) }); toast(`Gekündigt zum ${de(f.end_date.value)} – bis dahin wird weiter abgerechnet.`); refresh(); }, { ok: "Kündigung speichern" });
  }

  async function editProduct(p = { kind: "eigenprodukt", status: "Entwicklung", progress: 0 }) {
    const team = ME.owner ? (await api("/team")).filter(u => u.active && !u.invited) : [];
    if (!ME.owner) return modal(`<header class="swdh"><div><p class="kicker">${p.kind === "leistung" ? "Leistung" : "Eigenes Produkt"}</p><h2>${esc(p.name)}</h2></div><span class="pst pst--${PST[p.status]}">${esc(p.status)}</span></header>
      ${p.description ? `<p style="margin:0;white-space:pre-wrap">${esc(p.description)}</p>` : ""}<div class="fdl"><div><small>Fortschritt</small><b>${p.progress} %</b><span>${p.version ? "Version " + esc(p.version) : ""}</span></div><div><small>Nächster Meilenstein</small><b>${esc(p.next_milestone || "–")}</b><span>${p.milestone_date ? de(p.milestone_date) : ""}</span></div></div>`, null);
    const { f } = modal(`<h2>${p.id ? esc(p.name) : "Neues Produkt"}</h2>
      <div class="three"><label>Name<input name="name" required maxlength="80" value="${esc(p.name || "")}"></label>
        <div class="field"><span>Art</span>${DD.html("pe-kind", [{ v: "eigenprodukt", l: "Eigenes Produkt" }, { v: "leistung", l: "Leistung / Paket" }], p.kind, { field: "kind" })}</div>
        <div class="field"><span>Bereich</span>${DD.html("pe-ber", [{ v: "software", l: "Software" }, { v: "hardware", l: "Hardware" }], p.bereich || "software", { field: "bereich" })}</div></div>
      <label>Kurzbeschreibung<input name="tagline" maxlength="160" value="${esc(p.tagline || "")}" placeholder="Ein Satz, worum es geht"></label>
      <div class="three"><div class="field"><span>Status</span>${DD.html("pe-st", Object.keys(PST).map(s => ({ v: s, l: s })), p.status, { field: "status" })}</div>
        <label>Fortschritt (%)<input name="progress" inputmode="numeric" value="${p.progress ?? 0}"></label><label>Version<input name="version" maxlength="30" value="${esc(p.version || "")}" placeholder="z. B. 0.8"></label></div>
      <div class="two"><label>Nächster Meilenstein<input name="next_milestone" maxlength="160" value="${esc(p.next_milestone || "")}" placeholder="z. B. Beta-Test mit 20 Nutzern"></label><label>bis<input type="date" name="milestone_date" value="${p.milestone_date || ""}"></label></div>
      <div class="two"><div class="field"><span>Verantwortlich</span>${DD.html("pe-lead", [{ v: "", l: "– niemand –" }, ...team.map(u => ({ v: u.id, l: u.name }))], p.lead_user_id || "", { field: "lead_user_id" })}</div>
        <label>Link (optional)<input name="url" maxlength="300" value="${esc(p.url || "")}" placeholder="https://"></label></div>
      <div class="two"><label>Listenpreis pro Monat netto (€)<input name="price_month" inputmode="decimal" value="${euroIn(p.price_month)}"></label><label>Einrichtung netto (€)<input name="setup_fee" inputmode="decimal" value="${euroIn(p.setup_fee)}"></label></div>
      <label>Beschreibung / Stand (intern)<textarea name="description" rows="4">${esc(p.description || "")}</textarea></label>`,
      async f => { const body = Object.fromEntries(new FormData(f)); p.id ? await api(`/produkte/${p.id}`, { method: "PUT", body }) : await api("/produkte", { method: "POST", body }); toast("Gespeichert"); refresh(); },
      { wide: true, extra: p.id && !p.customers ? `<button type="button" class="btn btn--danger btn--sm" data-delp>Löschen</button>` : "" });
    f.closest(".modal").addEventListener("click", async e => { if (!e.target.closest("[data-delp]")) return;
      if (!(await UI.confirm(`„${p.name}“ wird aus dem Katalog entfernt.`, { title: "Produkt löschen?", ok: "Löschen", danger: true }))) return;
      try { await api(`/produkte/${p.id}`, { method: "DELETE", body: {} }); f.closest(".modal").remove(); toast("Gelöscht"); refresh(); } catch (err) { toast(err.message); } });
  }

  $("[data-section=software]").addEventListener("click", async e => {
    const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); tab = g.dataset.go; history.replaceState(null, "", "#software/" + tab); return window.loadSoftware(); }
    try {
      if (e.target.closest("[data-newc]")) return editContract();
      if (e.target.closest("[data-newp]")) return editProduct();
      const c = e.target.closest("[data-c]"); if (c) return openContract(+c.dataset.c);
      const p = e.target.closest("[data-p]"); if (p) { const list = await api("/produkte"); return editProduct(list.find(x => x.id === +p.dataset.p)); }
    } catch (err) { toast(err.message); }
  });
  window.SOFT = { newContract: d => editContract(d || {}), open: openContract };
})();
