/* Board – Mein Arbeitsplatz, Aufgaben & Zeiterfassung (nutzt $, $$, esc, api, toast, fmt, ME, DD, UI) */
(() => {
  const hm = m => `${Math.floor((m || 0) / 60)}:${String((m || 0) % 60).padStart(2, "0")}`;
  const hrs = m => (m || 0) >= 60 ? `${String(Math.round(m / 6) / 10).replace(".", ",")} Std.` : `${m || 0} Min.`;
  const de = d => d ? d.split("-").reverse().join(".") : "";
  const money = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format((c || 0) / 100);
  const ini = n => String(n || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const PRIO = { hoch: "hoch", normal: "normal", niedrig: "niedrig" }, ST = { offen: "offen", in_arbeit: "in Arbeit", erledigt: "erledigt" };
  let W = null, tick = null;

  const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const dueLabel = d => { if (!d) return ""; const t = todayStr(); if (d < t) return `<span class="due due--late">überfällig · ${de(d).slice(0, 6)}</span>`; if (d === t) return `<span class="due due--today">heute</span>`; return `<span class="due">${de(d).slice(0, 6)}</span>`; };

  /* ---------- Mein Arbeitsplatz ---------- */
  async function load() {
    W = await api("/arbeitsplatz");
    $("#wpDate").textContent = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" }).format(new Date());
    const t = W.today, end = (() => { const d = new Date(t + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
    const groups = [["Überfällig", x => x.due_date && x.due_date < t], ["Heute", x => x.due_date === t], ["Diese Woche", x => x.due_date > t && x.due_date <= end], ["Später", x => x.due_date > end], ["Ohne Datum", x => !x.due_date]];
    const mine = W.tasks.filter(x => x.assignee_id === ME.id), free = W.tasks.filter(x => !x.assignee_id);
    const max = Math.max(60, ...W.days.map(d => d.minutes));
    $("#wpBody").innerHTML = `
      <div class="wpgrid">
        <div class="stack">
          <div class="card"><div class="chead" style="margin-bottom:6px"><div><h2 style="font-size:18px">Meine Aufgaben</h2><p>${mine.length} offen${W.doneToday ? ` · heute ${W.doneToday} erledigt ✓` : ""}</p></div></div>
            ${mine.length ? groups.map(([l, f]) => { const g = mine.filter(f); return g.length ? `<p class="wpsec ${l === "Überfällig" ? "late" : ""}">${l} <em>${g.length}</em></p>${g.map(t => taskRow(t)).join("")}` : ""; }).join("")
              : `<div class="allclear"><b>Alles erledigt.</b><span>Ihnen ist gerade keine offene Aufgabe zugeordnet.</span></div>`}
            ${free.length ? `<p class="wpsec">Noch niemand zuständig – in Ihren Projekten <em>${free.length}</em></p>${free.map(t => taskRow(t)).join("")}` : ""}</div>
          <div class="card"><div class="chead" style="margin-bottom:6px"><div><h2 style="font-size:18px">Meine Zeiten</h2><p>letzte 14 Tage</p></div><div class="acts"><button class="btn btn--ghost btn--sm" data-wp="log">Nachtragen</button></div></div>
            ${W.entries.length ? `<div class="tlist">${W.entries.map(e => `<div class="tentry"><span class="tentry__d">${de(e.date).slice(0, 6)}</span><span class="tentry__m"><b>${esc(e.project_title || "ohne Projekt")}</b><small>${esc([e.task_title, e.note].filter(Boolean).join(" · ") || "–")}</small></span><b class="tentry__h">${hm(e.minutes)}</b><button class="x" data-del-time="${e.id}" title="Eintrag löschen">✕</button></div>`).join("")}</div>`
              : `<p class="hint" style="margin:0">Noch keine Zeiten erfasst. Starten Sie oben die Stoppuhr oder tragen Sie Zeit nach.</p>`}</div>
        </div>
        <div class="stack">
          <div class="card"><h2 style="font-size:18px">Diese Woche <small class="hint" style="margin:0;font-weight:400">${hm(W.week)} Std.</small></h2>
            <div class="wweek">${W.days.map((d, i) => `<div class="${d.date === t ? "now" : ""}"><em>${d.minutes ? hm(d.minutes) : ""}</em><i><b style="height:${d.minutes / max * 100}%"></b></i><span>${WD[i]}</span></div>`).join("")}</div></div>
          <div class="card"><h2 style="font-size:18px">Meine Projekte</h2>${W.projects.length ? `<div class="wplist">${W.projects.map(p => `<a class="wpproj" href="#projekte/${p.id}"><span><b>${esc(p.title)}</b><small>${esc(p.company)} · ${esc(p.phase)}</small></span>
              <span class="wpproj__k">${p.open_tasks ? `<i>${p.open_tasks} Aufg.</i>` : ""}${p.open_notes ? `<i class="warn">${p.open_notes} Anm.</i>` : ""}${p.my_week ? `<i>${hm(p.my_week)} h</i>` : ""}</span></a>`).join("")}</div>`
              : `<p class="hint" style="margin:0">${ME.owner ? "Sie sind keinem Projekt als Teammitglied zugeordnet – über „Team“ auf der Projektseite können Sie sich selbst eintragen." : "Ihnen ist noch kein Projekt zugewiesen."}</p>`}</div>
          <div class="card"><h2 style="font-size:18px">Termine · nächste 7 Tage</h2>${W.appointments.length ? `<div class="wplist">${W.appointments.map(a => `<div class="wpappt"><div class="date"><span>${fmt(a.start, { weekday: "short" })}</span><b>${fmt(a.start, { day: "numeric" })}</b></div>
              <span><b>${esc(a.title)}</b><small>${fmt(a.start, { hour: "2-digit", minute: "2-digit" })} Uhr · ${esc(a.company)}</small></span>${a.video_url ? `<a class="btn btn--ghost btn--sm" href="${esc(a.video_url)}" target="_blank" rel="noopener">Video</a>` : ""}</div>`).join("")}</div>` : `<p class="hint" style="margin:0">Keine Termine.</p>`}</div>
          ${W.team ? `<div class="card"><h2 style="font-size:18px">Team diese Woche</h2><div class="wplist">${W.team.map(u => `<div class="wpteam"><span class="avatar avatar--sm">${esc(ini(u.name))}</span><span><b>${esc(u.name)}</b>
              <small>${u.timer_project !== undefined && u.timer_since ? `<span class="live">● läuft${u.timer_project ? ": " + esc(u.timer_project) : ""}</span> · ` : ""}${u.open} offene Aufgaben${u.overdue ? ` · <b class="warn">${u.overdue} überfällig</b>` : ""}</small></span><b>${hm(u.week)}</b></div>`).join("")}</div>
              <p class="hint" style="margin:10px 0 0">Stunden aus der Zeiterfassung (Mo–So). <a href="#" data-wp="report">Auswertung &amp; CSV-Export →</a></p></div>` : ""}
          ${W.unassigned?.length ? `<div class="card"><h2 style="font-size:18px">Ohne Zuständigkeit</h2>${W.unassigned.map(t => taskRow(t)).join("")}</div>` : ""}
        </div>
      </div>`;
    // Die Stoppuhr steht ganz oben auf der Seite, über den Vorgängen
    const slot = $("#wpTimerSlot"); if (slot) slot.innerHTML = `<div class="card timer ${W.timer ? "on" : ""}" id="wpTimer">${timerHtml()}</div>`;
    startTick();
  }
  const taskRow = (x, inProj) => `<div class="task task--${x.status} ${x.priority === "hoch" ? "task--hi" : ""}" data-task="${x.id}">
      <button class="tcheck" data-done="${x.id}" title="Als erledigt markieren" aria-label="Erledigt"></button>
      <span class="task__m"><b>${esc(x.title)}</b><small>${inProj ? (x.assignee ? esc(x.assignee) : "noch niemand zuständig") + (x.spent ? ` · ${hm(x.spent)} Std.` : "") : `${esc(x.project_title)} · ${esc(x.company)}`}${x.source === "anmerkung" ? " · aus Kunden-Anmerkung" : x.source === "termin" ? " · aus Termin" : ""}${x.status === "in_arbeit" ? " · <b>in Arbeit</b>" : ""}</small></span>
      <span class="task__r">${dueLabel(x.due_date)}${x.assignee && (inProj || x.assignee_id !== ME.id) ? `<span class="avatar avatar--xs" title="${esc(x.assignee)}">${esc(ini(x.assignee))}</span>` : ""}
        <button class="tplay" data-play="${x.id}" title="Stoppuhr für diese Aufgabe starten">▶</button></span></div>`;

  /* ---------- Stoppuhr ---------- */
  function timerHtml() {
    const tm = W?.timer;
    if (tm) return `<div class="timer__run"><div><small>Stoppuhr läuft</small><b id="tmClock">${clock(tm)}</b><span>${esc(tm.project_title || "ohne Projekt")}${tm.task_title ? " · " + esc(tm.task_title) : ""}${tm.note ? " · " + esc(tm.note) : ""}</span></div>
      <button class="btn timer__stop" data-wp="stop">■ Stoppen &amp; speichern</button></div>`;
    const projs = W?.projects || [];
    return `<div class="timer__idle"><div><small>Stoppuhr</small><b>0:00:00</b></div>
      <div class="timer__form">${DD.html("tmProj", [{ v: "", l: "Projekt wählen …" }, ...projs.map(p => ({ v: p.id, l: p.title }))], "", { field: "project_id" })}
        <input id="tmNote" placeholder="Woran arbeiten Sie? (optional)" maxlength="300"><button class="btn btn--grad" data-wp="start">▶ Start</button></div></div>`;
  }
  const clock = tm => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(tm.started_at)) / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  function startTick() { clearInterval(tick); if (!W?.timer) return; tick = setInterval(() => { const el = $("#tmClock"); if (!el) return clearInterval(tick); el.textContent = clock(W.timer); }, 1000); }
  async function startTimer(body) { const r = await api("/timer", { method: "POST", body }); toast(r.stopped?.minutes ? `Vorherige Zeit gespeichert (${hm(r.stopped.minutes)}) – Stoppuhr läuft.` : "Stoppuhr läuft."); window.updateBadges?.(); zeitNeu(); }
  // Auf der Projektseite nur die Zeit-Karte neu zeichnen – nicht die ganze Seite (sonst springt sie)
  const zeitNeu = () => location.hash.startsWith("#projekte/") ? projectCards({ id: +location.hash.split("/")[1] }) : refreshViews();
  async function stopTimer() { const r = await api("/timer", { method: "DELETE", body: {} }); toast(r.stopped?.minutes ? `${hm(r.stopped.minutes)} Std. gespeichert${r.stopped.capped ? " (auf 12 Std. begrenzt – bitte prüfen)" : ""}.` : "Stoppuhr gestoppt (unter einer Minute, nichts gespeichert)."); window.updateBadges?.(); zeitNeu(); }
  const refreshViews = () => { if (location.hash.startsWith("#arbeitsplatz") || !location.hash) load(); else if (location.hash.startsWith("#projekte/")) window.KUNDEN.openProjectPage(+location.hash.split("/")[1], true); else if (location.hash.startsWith("#cockpit")) window.BOARD.cockpit(); };

  /* ---------- Dialoge ---------- */
  function modal(html, onSave, { ok = "Speichern", extra = "", wide = false } = {}) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card bmodal" style="width:min(${wide ? 720 : 560}px,100%);max-height:92vh;overflow:auto;display:grid;gap:14px">${html}<p class="err" hidden></p>
      <div class="swfoot">${extra || "<span></span>"}<div style="display:flex;gap:8px"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">${esc(ok)}</button></div></div></form>`;
    document.body.appendChild(m);
    const f = $("form", m), close = () => m.remove();
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) close(); });
    f.addEventListener("submit", async e => { e.preventDefault(); const b = $("[type=submit]", f); b.disabled = true;
      try { await onSave(f); close(); } catch (err) { const p = $(".err", f); p.textContent = err.message; p.hidden = false; b.disabled = false; } });
    return { m, f, close };
  }
  async function projectOptions() {
    if (W?.projects?.length && !ME.owner) return W.projects.map(p => ({ v: p.id, l: `${p.title} · ${p.company}` }));
    const list = await api("/projects").catch(() => []);
    return list.filter(p => p.status !== "abgeschlossen").map(p => ({ v: p.id, l: `${p.title} · ${p.client?.company || ""}` }));
  }
  async function editTask(t = {}, projectId = null) {
    const pid = t.project_id || projectId;
    const opts = pid ? null : await projectOptions();
    const members = pid ? await api(`/projects/${pid}`).then(p => p.members || []).catch(() => []) : [];
    const people = [{ v: "", l: "– niemand –" }, { v: ME.id, l: ME.name + " (ich)" }, ...members.filter(m => m.id !== ME.id).map(m => ({ v: m.id, l: m.name }))];
    const { f, m } = modal(`<h2>${t.id ? "Aufgabe" : "Neue Aufgabe"}</h2>
      ${opts ? `<div class="field"><span>Projekt</span>${DD.html("tk-proj", [{ v: "", l: "– Projekt wählen –" }, ...opts], "", { field: "project_id" })}</div>` : ""}
      <label>Titel<input name="title" required maxlength="200" value="${esc(t.title || "")}" placeholder="z. B. Login-Seite an neues Design anpassen"></label>
      <label>Beschreibung<textarea name="description" rows="3">${esc(t.description || "")}</textarea></label>
      <div class="three"><div class="field"><span>Status</span>${DD.html("tk-st", Object.entries(ST).map(([v, l]) => ({ v, l })), t.status || "offen", { field: "status" })}</div>
        <div class="field"><span>Priorität</span>${DD.html("tk-pr", Object.entries(PRIO).map(([v, l]) => ({ v, l })), t.priority || "normal", { field: "priority" })}</div>
        <div class="field"><span>Zuständig</span><div id="tkWho">${DD.html("tk-who", people, t.id ? t.assignee_id || "" : ME.id, { field: "assignee_id" })}</div></div></div>
      <div class="two"><label>Fällig am<input type="date" name="due_date" value="${t.due_date || ""}"></label><label>Geschätzt (z. B. 2 oder 1:30)<input name="estimate" value="${t.estimate_min ? hm(t.estimate_min) : ""}" placeholder="Stunden"></label></div>
      ${t.id ? `<p class="hint" style="margin:0">${esc(t.project_title)} · angelegt von ${esc(t.created_by || "–")}${t.spent ? ` · bisher ${hm(t.spent)} Std. erfasst` : ""}${t.source === "anmerkung" ? " · erledigt sich zusammen mit der Kunden-Anmerkung" : ""}</p>` : ""}`,
      async f => { const body = Object.fromEntries(new FormData(f));
        if (t.id) await api(`/tasks/${t.id}`, { method: "PATCH", body }); else { const p2 = pid || +body.project_id; if (!p2) throw new Error("Bitte ein Projekt wählen."); await api(`/projects/${p2}/tasks`, { method: "POST", body }); }
        toast(t.id ? "Gespeichert" : "Aufgabe angelegt"); refreshViews(); },
      { extra: t.id ? `<div style="display:flex;gap:8px"><button type="button" class="btn btn--ghost btn--sm" data-tplay>▶ Stoppuhr</button><button type="button" class="btn btn--danger btn--sm" data-tdel>Löschen</button></div>` : "" });
    if (opts) f.project_id.addEventListener("change", async () => { const ms = await api(`/projects/${f.project_id.value}`).then(p => p.members || []).catch(() => []);
      $("#tkWho", m).innerHTML = DD.html("tk-who", [{ v: "", l: "– niemand –" }, { v: ME.id, l: ME.name + " (ich)" }, ...ms.filter(x => x.id !== ME.id).map(x => ({ v: x.id, l: x.name }))], ME.id, { field: "assignee_id" }); });
    m.addEventListener("click", async e => {
      if (e.target.closest("[data-tplay]")) { m.remove(); return startTimer({ task_id: t.id }).catch(err => toast(err.message)); }
      if (!e.target.closest("[data-tdel]")) return;
      if (!(await UI.confirm(`„${t.title}“ wird gelöscht. Erfasste Zeiten bleiben erhalten.`, { title: "Aufgabe löschen?", ok: "Löschen", danger: true }))) return;
      try { await api(`/tasks/${t.id}`, { method: "DELETE", body: {} }); m.remove(); toast("Gelöscht"); refreshViews(); } catch (err) { toast(err.message); }
    });
  }
  async function logTime(preset = {}) {
    const opts = await projectOptions();
    modal(`<h2>Zeit nachtragen</h2>
      <div class="field"><span>Projekt</span>${DD.html("lt-proj", [{ v: "", l: "– ohne Projekt (intern) –" }, ...opts], preset.project_id || "", { field: "project_id" })}</div>
      <div class="three"><label>Datum<input type="date" name="date" value="${todayStr()}" required></label><label>Dauer<input name="duration" required placeholder="1:30 oder 45" autofocus></label><span></span></div>
      <label>Was wurde gemacht? (optional)<input name="note" maxlength="300"></label>
      <p class="hint" style="margin:0">Dauer als Stunden:Minuten (1:30), Dezimal (1,5) oder Minuten (45).</p>`,
      async f => { const r = await api("/time", { method: "POST", body: Object.fromEntries(new FormData(f)) }); toast(`${hm(r.minutes)} Std. gespeichert`); refreshViews(); }, { ok: "Speichern" });
  }
  async function report() {
    const to = todayStr(), from = (() => { const d = new Date(to + "T00:00:00Z"); d.setUTCDate(1); return d.toISOString().slice(0, 10); })();
    const show = async (a, b) => {
      const r = await api(`/zeiten?from=${a}&to=${b}`), max = Math.max(1, ...r.byProject.map(x => x.v), ...r.byUser.map(x => x.v));
      return `<div class="swbars">${r.byUser.map(x => `<div><span>${esc(x.k)}</span><i><em style="width:${x.v / max * 100}%"></em></i><b>${hm(x.v)}</b></div>`).join("") || "<p class='hint'>Keine Einträge.</p>"}</div>
        <h3 class="swh3">nach Projekt</h3><div class="swbars swbars--alt">${r.byProject.map(x => `<div><span>${esc(x.k)}</span><i><em style="width:${x.v / max * 100}%"></em></i><b>${hm(x.v)}</b></div>`).join("")}</div>
        <p class="hint" style="margin:12px 0 0">${r.count} Einträge · insgesamt ${hm(r.total)} Std.</p>`;
    };
    const { f, m } = modal(`<h2>Zeiten auswerten</h2><div class="two"><label>von<input type="date" name="from" value="${from}"></label><label>bis<input type="date" name="to" value="${to}"></label></div><div id="rpBody">${await show(from, to)}</div>`,
      async f => { location.href = `/api/admin/zeiten?from=${f.from.value}&to=${f.to.value}&format=csv`; throw new Error("CSV wird heruntergeladen …"); }, { ok: "CSV exportieren", wide: true });
    const upd = async () => { $("#rpBody", m).innerHTML = await show(f.from.value, f.to.value); };
    f.from.addEventListener("change", upd); f.to.addEventListener("change", upd);
  }

  /* ---------- Projektseite: Aufgaben & Zeit ---------- */
  async function projectCards(p) {
    const box = $("#pTasks"), tbox = $("#pTime"); if (!box) return;
    const [tasks, time] = await Promise.all([api(`/projects/${p.id}/tasks`), api(`/projects/${p.id}/time`)]);
    const open = tasks.filter(t => t.status !== "erledigt"), done = tasks.filter(t => t.status === "erledigt");
    box.innerHTML = `<div class="chead" style="margin-bottom:10px"><div><h2 style="font-size:18px">Aufgaben</h2><p>${open.length} offen${done.length ? ` · ${done.length} erledigt` : ""}</p></div>
        <div class="acts"><button class="btn btn--ghost btn--sm" data-ptask-new>Details …</button></div></div>
      <form class="tquick" data-ptask-quick><input name="title" placeholder="Neue Aufgabe – Titel eingeben und Enter" maxlength="200" autocomplete="off"><button class="btn btn--grad btn--sm">Hinzufügen</button></form>
      ${open.map(t => taskRow(t, true)).join("")}
      ${window.weitere(Math.min(30, done.length), done.slice(0, 30).map(t => `<div class="task task--erledigt" data-task="${t.id}"><button class="tcheck on" data-undo="${t.id}" title="Wieder öffnen"></button><span class="task__m"><b>${esc(t.title)}</b><small>${esc(t.done_by || "")}${t.done_at ? " · " + de(t.done_at.slice(0, 10)) : ""}${t.spent ? " · " + hm(t.spent) + " Std." : ""}</small></span></div>`).join(""), "erledigte")}`;
    // Zeiteinträge des Projekts: die letzten fünf sichtbar, ältere zum Aufklappen
    const eintrag = e => `<div class="tentry"><span class="tentry__d">${de(e.date).slice(0, 6)}</span><span class="tentry__m"><b>${esc([e.task_title, e.note].filter(Boolean).join(" · ") || "Ohne Beschreibung")}</b><small>${esc(e.user_name || "")}</small></span><b class="tentry__h">${hm(e.minutes)}</b><button class="x" data-del-time="${e.id}" title="Eintrag löschen">✕</button></div>`;
    const ein = time.entries || [];
    // Laufende Stoppuhr direkt in der Karte: Uhr mit Sekunden und Stopp-Knopf. Läuft sie für ein anderes Projekt, steht das dabei.
    const tm = time.timer, hier = !!tm && +tm.project_id === +p.id;
    const lauf = hier ? `<div class="ptimer"><span class="ptimer__punkt" aria-hidden="true"></span><div><small>Stoppuhr läuft${tm.task_title ? " · " + esc(tm.task_title) : ""}</small><b id="ptClock">${clock(tm)}</b></div><button class="btn btn--sm timer__stop" data-wp="stop">■ Stoppen &amp; speichern</button></div>`
      : tm ? `<p class="ptimer__anders">Deine Stoppuhr läuft gerade für „${esc(tm.project_title || "ohne Projekt")}“ (${clock(tm)}). ▶ Start speichert die bisherige Zeit dort und läuft ab jetzt hier.</p>` : "";
    tbox.innerHTML = `<div class="chead" style="margin-bottom:12px"><h2 style="font-size:18px">Zeit</h2><div class="acts"><button class="btn btn--ghost btn--sm" data-ptime-log>Nachtragen</button>${hier ? "" : `<button class="btn btn--grad btn--sm" data-ptime-start title="Stoppuhr für dieses Projekt starten">▶ Start</button>`}</div></div>
      ${lauf}
      <div class="pmoney"><div><small>Erfasst gesamt</small><b>${hm(time.total)} Std.</b><span>${time.estimate ? `geschätzt ${hm(time.estimate)} Std.` : "ohne Schätzung"}</span></div><div><small>${time.rate !== undefined ? "Effektiver Stundensatz" : "Davon ich"}</small><b>${time.rate !== undefined ? money(time.rate) : hm(time.mine) + " Std."}</b><span>${time.rate !== undefined ? "Auftrag netto ÷ Stunden" : ""}</span></div></div>
      ${time.estimate ? `<div class="pbar"><i style="width:${Math.min(100, time.total / time.estimate * 100)}%;${time.total > time.estimate ? "background:#c4314b" : ""}"></i></div>` : ""}
      ${(time.byUser?.length || 0) > 1 ? `<div class="wplist" style="margin-top:12px">${time.byUser.map(u => `<div class="wpteam"><span class="avatar avatar--sm">${esc(ini(u.name))}</span><span><b>${esc(u.name)}</b></span><b>${hm(u.minutes)}</b></div>`).join("")}</div>` : ""}
      <div class="ptime__eintr">${ein.length ? `<div class="tlist">${ein.slice(0, 5).map(eintrag).join("")}</div>${window.weitere(ein.length - 5, `<div class="tlist">${ein.slice(5).map(eintrag).join("")}</div>`, ["älteren Eintrag", "ältere Einträge"])}`
        : `<p class="hint" style="margin:0">Noch keine Zeit erfasst. ▶ startet die Stoppuhr für dieses Projekt; beim Stoppen landet der Eintrag hier.</p>`}</div>`;
    box.dataset.pid = tbox.dataset.pid = p.id;
    clearInterval(ptTick); if (hier) ptTick = setInterval(() => { const el = $("#ptClock"); if (!el) return clearInterval(ptTick); el.textContent = clock(tm); }, 1000);
  }
  let ptTick = null;

  /* ---------- Klicks ---------- */
  document.addEventListener("click", async e => {
    const el = e.target.closest("[data-wp],[data-done],[data-undo],[data-play],[data-task],[data-del-time],[data-ann-task],[data-appt-tasks],[data-ptask-new],[data-ptime-log],[data-ptime-start]");
    if (!el || el.closest(".modal")) return;
    const pid = +(el.closest("[data-pid]")?.dataset.pid || 0) || +($("#pTasks")?.dataset.pid || 0);
    try {
      const a = el.dataset.wp;
      if (a) { e.preventDefault();
        if (a === "start") { const pr = $("#wpTimer input[name=project_id]")?.value; return startTimer({ project_id: pr, note: $("#tmNote")?.value }); }
        if (a === "stop") return stopTimer();
        if (a === "log") return logTime();
        if (a === "newTask") return editTask();
        if (a === "report") return report();
      }
      if (el.dataset.done || el.dataset.undo) { e.stopPropagation(); const id = +(el.dataset.done || el.dataset.undo); el.classList.toggle("on");
        await api(`/tasks/${id}`, { method: "PATCH", body: { status: el.dataset.done ? "erledigt" : "offen" } }); toast(el.dataset.done ? "Erledigt ✓" : "Wieder geöffnet"); return setTimeout(refreshViews, 250); }
      if (el.dataset.play) { e.stopPropagation(); return startTimer({ task_id: +el.dataset.play }); }
      if (el.dataset.delTime) { if (!(await UI.confirm("Der Zeiteintrag wird gelöscht.", { title: "Eintrag löschen?", ok: "Löschen", danger: true }))) return; await api(`/time/${el.dataset.delTime}`, { method: "DELETE", body: {} }); return refreshViews(); }
      if (el.dataset.annTask) { e.stopPropagation(); const r = await api(`/annotations/${el.dataset.annTask}/task`, { method: "POST", body: {} }); toast(r.existed ? "Gibt es schon als Aufgabe." : "Als Aufgabe übernommen – erledigt sich mit der Aufgabe."); return refreshViews(); }
      if (el.dataset.apptTasks) { e.stopPropagation(); const r = await api(`/appointments/${el.dataset.apptTasks}/tasks`, { method: "POST", body: {} }); toast(r.created ? `${r.created} Aufgabe${r.created === 1 ? "" : "n"} angelegt${r.skipped ? ` (${r.skipped} gab es schon)` : ""}.` : "Alle Schritte gibt es schon als Aufgabe."); return refreshViews(); }
      if (el.hasAttribute("data-ptask-new")) return editTask({}, pid);
      if (el.hasAttribute("data-ptime-log")) return logTime({ project_id: pid });
      if (el.hasAttribute("data-ptime-start")) return startTimer({ project_id: pid });
      if (el.dataset.task) return openTask(+el.dataset.task);
    } catch (err) { toast(err.message); }
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest("[data-ptask-quick]"); if (!f) return; e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    try { await api(`/projects/${$("#pTasks").dataset.pid}/tasks`, { method: "POST", body: { title, assignee_id: ME.id } }); f.title.value = ""; projectCards({ id: +$("#pTasks").dataset.pid, title: "" }); }
    catch (err) { toast(err.message); }
  });
  async function openTask(id) {
    let t = W?.tasks?.find(x => x.id === id);
    if (!t) { const pid = +($("#pTasks")?.dataset.pid || 0); if (pid) t = (await api(`/projects/${pid}/tasks`)).find(x => x.id === id); }
    if (!t) { const all = await api("/arbeitsplatz"); t = [...all.tasks, ...(all.unassigned || [])].find(x => x.id === id); }
    if (!t) return toast("Aufgabe nicht gefunden (vielleicht schon erledigt).");
    editTask(t);
  }
  window.WORK = { load, projectCards, openTask, editTask, logTime };
})();
