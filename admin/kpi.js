/* Board – Kennzahlen (nur Inhaber): alle wichtigen Zahlen auf einen Blick, mit Vergleich und Hinweisen (nutzt $, $$, esc, api, toast, DD) */
(() => {
  const eur = c => c == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(c / 100);
  const keur = c => Math.abs(c) >= 1e7 ? (Math.round(c / 1e6) / 10).toLocaleString("de-DE") + " T€" : eur(c);
  const num = n => (n ?? 0).toLocaleString("de-DE");
  const hrs = m => Math.round((m || 0) / 60).toLocaleString("de-DE") + " Std.";
  const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const mon = k => MON[+k.slice(5, 7) - 1] + (k.slice(5, 7) === "01" ? " " + k.slice(2, 4) : "");
  const LV = { kritisch: ["Kritisch", "!"], achtung: ["Achtung", "!"], hinweis: ["Hinweis", "i"], gut: ["Gut", "✓"] };
  let range = "monat";

  // Veränderung zur Vorperiode – Text trägt die Aussage, Farbe nur ergänzend
  const delta = (cur, prev, upGood = true) => {
    if (!prev) return `<span class="kd kd--na">keine Vergleichswerte</span>`;
    const p = Math.round((cur / prev - 1) * 100); if (!p) return `<span class="kd">± 0 % zur Vorperiode</span>`;
    const good = upGood ? p > 0 : p < 0;
    return `<span class="kd ${good ? "kd--good" : "kd--bad"}">${p > 0 ? "▲ +" : "▼ "}${p} % zur Vorperiode</span>`;
  };
  const tile = (label, value, sub, extra = "", cls = "") => `<div class="ktile ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}${extra}</div>`;

  async function load() {
    const k = await api(`/kpi?range=${range}`), c = k.cur, pv = k.prev, P = k.period;
    const maxM = Math.max(1, ...k.months.map(m => Math.max(m.revenue, m.expenses)));
    const maxL = Math.max(1, ...k.months.map(m => m.leads)), maxR = Math.max(1, ...k.months.map(m => m.mrr || 0));
    const bsum = Math.max(1, ...k.money.buckets.map(b => b.sum));
    const vs = `${P.prevFrom.split("-").reverse().join(".")} – ${P.prevTo.split("-").reverse().join(".")}`;
    $("#kpiBody").innerHTML = `
      <div class="khead2"><p class="hint" style="margin:0">${esc(P.label)} bis heute · verglichen mit ${vs}</p>
        ${DD.html("kpiRange", [{ v: "monat", l: "Dieser Monat" }, { v: "quartal", l: "Dieses Quartal" }, { v: "jahr", l: "Dieses Jahr" }], range, { label: "Zeitraum" })}</div>

      ${k.hints.length ? `<div class="khints">${k.hints.map(h => `<${h.href ? `a href="${esc(h.href)}"` : "div"} class="khint khint--${h.level}"><span class="kst kst--${h.level}"><i>${LV[h.level][1]}</i>${LV[h.level][0]}</span><b>${esc(h.title)}</b><p>${esc(h.text)}</p></${h.href ? "a" : "div"}>`).join("")}</div>` : ""}

      <h2 class="ksec">Geld</h2>
      <div class="ktiles">
        ${tile("Umsatz netto", eur(c.revenue), "gestellte Rechnungen", delta(c.revenue, pv.revenue), "ktile--hero")}
        ${tile("Zahlungseingang", eur(c.paidIn), "brutto, bezahlt markiert", delta(c.paidIn, pv.paidIn))}
        ${tile("Ergebnis", eur(c.revenue - c.expenses), `Umsatz − Ausgaben (${eur(c.expenses)})`, delta(c.revenue - c.expenses, pv.revenue - pv.expenses))}
        ${tile("Offene Forderungen", eur(k.money.open.s), k.money.overdue.n ? `<b class="warn">${eur(k.money.overdue.s)} überfällig</b>` : `${k.money.open.n} Rechnung${k.money.open.n === 1 ? "" : "en"}, nichts überfällig`)}
        ${tile("Monatlich aus Verträgen", eur(k.money.mrr), `${eur(k.money.arr)} im Jahr · ${k.money.contracts} Verträge`)}
        ${tile("Auftragsbestand", eur(k.money.backlog), "noch nicht berechnete Raten aktiver Projekte")}
      </div>
      <div class="kgrid2">
        <div class="card"><div class="kch"><h3>Umsatz &amp; Ausgaben · 12 Monate</h3><div class="klegend"><span><i class="k1"></i>Umsatz</span><span><i class="k2"></i>Ausgaben</span></div></div>
          <div class="kbars kbars--pair">${k.months.map(m => `<div class="kcol" data-tip="${mon(m.month)}: Umsatz ${eur(m.revenue)} · Ausgaben ${eur(m.expenses)}"><div class="kcol__bars"><i class="k1" style="height:${m.revenue / maxM * 100}%"></i><i class="k2" style="height:${m.expenses / maxM * 100}%"></i></div><span>${mon(m.month)}</span></div>`).join("")}</div></div>
        <div class="card"><div class="kch"><h3>Erwartete Eingänge</h3><div class="klegend"><span><i class="k1"></i>offene Rechnungen</span><span><i class="k2"></i>Verträge</span></div></div>
          <div class="kflow">${k.money.buckets.map(b => `<div data-tip="${b.label}: Rechnungen ${eur(b.invoices)} · Verträge ${eur(b.contracts)}"><span>${b.label}</span><i><em class="k1" style="width:${b.invoices / bsum * 100}%"></em><em class="k2" style="width:${b.contracts / bsum * 100}%"></em></i><b>${eur(b.sum)}</b></div>`).join("")}</div>
          <p class="hint" style="margin:12px 0 0">Offene Rechnungen nach Fälligkeit (Überfälliges zählt in die ersten 30 Tage) plus ein Monat laufender Verträge je Abschnitt, brutto.${k.money.drafts.n ? ` Dazu ${eur(k.money.drafts.s)} in noch nicht freigegebenen Rechnungen.` : ""}</p></div>
      </div>

      <h2 class="ksec">Vertrieb</h2>
      <div class="ktiles">
        ${tile("Neue Anfragen", num(c.leads), "über Website-Termin und Projektanfrage", delta(c.leads, pv.leads))}
        ${tile("Erstgespräche geführt", num(c.firstMeetings), `${num(c.meetings)} Termine insgesamt`, delta(c.firstMeetings, pv.firstMeetings))}
        ${tile("Neue Aufträge", num(c.newOrders.n), eur(c.newOrders.s) + " Auftragswert", delta(c.newOrders.s, pv.newOrders.s))}
        ${tile("Offene Angebote", eur(k.sales.pendingNet), `${num(k.sales.pending)} Angebot${k.sales.pending === 1 ? "" : "e"} warten auf Antwort`)}
        ${tile("Gewinnquote Angebote", k.sales.winRate == null ? "–" : k.sales.winRate + " %", k.sales.winRate == null ? "noch keine entschiedenen Angebote (12 Monate)" : `${k.sales.won} gewonnen · ${k.sales.lost} verloren (12 Monate)`)}
        ${tile("Anfrage → Kunde", k.sales.leadConv == null ? "–" : k.sales.leadConv + " %", `${num(k.sales.leads12)} Anfragen in 12 Monaten${k.sales.cycleDays != null ? ` · Ø ${k.sales.cycleDays} Tag${k.sales.cycleDays === 1 ? "" : "e"} bis zum Projekt` : ""}`)}
      </div>
      <div class="kgrid2">
        <div class="card"><div class="kch"><h3>Neue Anfragen pro Monat</h3></div>
          <div class="kbars">${k.months.map(m => `<div class="kcol" data-tip="${mon(m.month)}: ${m.leads} Anfrage${m.leads === 1 ? "" : "n"}"><em>${m.leads || ""}</em><div class="kcol__bars"><i class="k1" style="height:${m.leads / maxL * 100}%"></i></div><span>${mon(m.month)}</span></div>`).join("")}</div></div>
        <div class="card"><div class="kch"><h3>Monatliche Einnahmen aus Verträgen</h3></div>
          <div class="kbars">${k.months.map(m => `<div class="kcol" data-tip="${mon(m.month)}: ${eur(m.mrr || 0)} pro Monat"><em>${m.mrr ? keur(m.mrr) : ""}</em><div class="kcol__bars"><i class="k1" style="height:${(m.mrr || 0) / maxR * 100}%"></i></div><span>${mon(m.month)}</span></div>`).join("")}</div></div>
      </div>

      <h2 class="ksec">Projekte &amp; Team</h2>
      <div class="ktiles">
        ${tile("Aktive Projekte", num(k.projects.active), k.projects.phases.sort((a, b) => ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"].indexOf(a.phase) - ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"].indexOf(b.phase)).map(p => `${p.phase} ${p.n}`).join(" · "))}
        ${tile("Erfasste Stunden", hrs(c.hours), k.team.since ? `Zeiterfassung seit ${k.team.since.split("-").reverse().join(".")}` : `${k.team.workdays} Arbeitstage`, delta(c.hours, pv.hours))}
        ${tile("Umsatz je Stunde", k.money.perHour == null ? "–" : eur(k.money.perHour), k.money.perHour == null ? "erst ab 10 erfassten Stunden" : "Umsatz netto ÷ erfasste Stunden")}
        ${tile("Erledigte Aufgaben", num(c.tasksDone), `${num(k.projects.lateTasks)} überfällig · ${num(k.projects.notes)} offene Kunden-Anmerkungen`, delta(c.tasksDone, pv.tasksDone))}
        ${k.support ? tile("Support", `${num(k.support.open)} offen`, `${num(k.support.created)} neu im Zeitraum${k.support.avgResponseH != null ? ` · Ø erste Antwort ${String(k.support.avgResponseH).replace(".", ",")} Std. · ${k.support.slaKept} % in der Frist` : ""}${k.support.overdue ? ` · <b class="warn">${k.support.overdue} über der Frist</b>` : ""}`) : ""}
      </div>
      <div class="kgrid2">
        <div class="card"><div class="kch"><h3>Auslastung im Zeitraum</h3><span class="hint" style="margin:0">Soll: 8 Std. je Arbeitstag</span></div>
          <div class="kutil">${k.team.people.map(u => `<div data-tip="${esc(u.name)}: ${hrs(u.minutes)} von ${hrs(u.capacity)} · ${u.projects} Projekte · ${u.open} offene Aufgaben"><span><b>${esc(u.name)}</b><small>${u.projects} Projekte · ${u.open} Aufgaben${u.late ? ` · <b class="warn">${u.late} überfällig</b>` : ""}</small></span>
            <i><em class="${u.util > 110 ? "over" : ""}" style="width:${Math.min(100, u.util / 1.2)}%"></em><s style="left:${100 / 1.2}%"></s></i><b>${u.util} %</b></div>`).join("")}</div>
          <p class="hint" style="margin:10px 0 0">Die Linie markiert 100 %. ${k.team.since ? "Gerechnet ab Beginn der Zeiterfassung." : ""}</p></div>
        <div class="card"><div class="kch"><h3>Projekte mit Risiko</h3></div>
          ${k.projects.risk.length ? `<div class="krisk">${k.projects.risk.map(p => `<a href="#projekte/${p.id}"><span><b>${esc(p.title)}</b><small>${esc(p.company)} · ${esc(p.phase)}</small></span><span class="krisk__why">${p.why.map(w => `<i>${esc(w)}</i>`).join("")}</span></a>`).join("")}</div>`
            : `<div class="allclear"><b>Alles im grünen Bereich.</b><span>Kein Projekt über der Schätzung, ohne Team oder lange ohne Bewegung.</span></div>`}</div>
      </div>

      <h2 class="ksec">Kunden</h2>
      <div class="kgrid2">
        <div class="card"><div class="kch"><h3>Wichtigste Kunden · 12 Monate</h3><span class="hint" style="margin:0">Umsatz + Verträge aufs Jahr</span></div>
          ${k.clients.top.length ? `<div class="kutil kutil--plain">${k.clients.top.map(cl => `<div data-tip="${esc(cl.company)}: Rechnungen ${eur(cl.revenue)} · Verträge ${eur(cl.mrr)}/Monat"><span><a href="#kunden/${cl.id}"><b>${esc(cl.company)}</b></a><small>${cl.mrr ? eur(cl.mrr) + " MRR" : "ohne Vertrag"}</small></span><i><em style="width:${cl.value / k.clients.top[0].value * 100}%"></em></i><b>${keur(cl.value)}</b></div>`).join("")}</div>` : `<p class="hint">Noch keine Umsätze.</p>`}</div>
        <div class="card"><div class="kch"><h3>Kundenstamm</h3></div>
          <div class="kmini">${[["Kunden (Mandanten)", num(k.clients.count)], ["Interessenten in Gesprächen", num(k.sales.pipeline.interessent || 0)], ["Neue Anfragen offen", num(k.sales.pipeline.anfrage || 0)], ["Größter Kunde", k.clients.topShare != null ? k.clients.topShare + " % vom Umsatz" : "–"]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div></div>
      </div>`;
  }
  DD.on("kpiRange", v => { range = v; load().catch(e => toast(e.message)); });

  // Tooltip für alle Diagramme (Hover und Fokus)
  const tip = document.createElement("div"); tip.className = "ktip"; tip.hidden = true; document.body.appendChild(tip);
  document.addEventListener("mouseover", e => { const t = e.target.closest("#kpiBody [data-tip]"); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
  document.addEventListener("mousemove", e => { if (tip.hidden) return; const w = tip.offsetWidth; tip.style.left = Math.min(innerWidth - w - 12, e.clientX + 14) + "px"; tip.style.top = e.clientY + 16 + "px"; });
  window.loadKpi = load;
})();
