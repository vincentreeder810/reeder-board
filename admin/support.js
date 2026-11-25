/* Board – Support-Anfragen und Einstellungen „Betrieb“ (nutzt $, $$, esc, api, toast, fmt, ME, DD, UI) */
(() => {
  const ST = { neu: "Neu", in_bearbeitung: "In Bearbeitung", wartet: "Wartet auf Kunde", geloest: "Gelöst", geschlossen: "Geschlossen" };
  const STK = { neu: "open", in_bearbeitung: "open", wartet: "draft", geloest: "paid", geschlossen: "void" };
  const PR = { kritisch: "Kritisch", hoch: "Hoch", normal: "Normal" }, CAT = { fehler: "Fehler", frage: "Frage", wunsch: "Wunsch" };
  const ini = n => String(n || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tg.`; };
  const left = t => { if (t.due_left_min == null) return t.sla === "eingehalten" ? `<span class="sla sla--ok">Frist eingehalten</span>` : t.sla === "verfehlt" ? `<span class="sla sla--late">Frist verpasst</span>` : "";
    const m = t.due_left_min, a = Math.abs(m), txt = a < 60 ? `${a} Min.` : a < 1440 ? `${Math.round(a / 60)} Std.` : `${Math.round(a / 1440)} Tg.`;
    return m < 0 ? `<span class="sla sla--late">⏱ ${txt} über der Frist</span>` : `<span class="sla ${m < 120 ? "sla--soon" : ""}">⏱ Antwort in ${txt}</span>`; };
  let filt = { st: "offen", who: "alle" };

  async function load() {
    const id = +location.hash.split("/")[1];
    if (id) return detail(id);
    const d = await api("/support"), all = d.list;
    const list = all.filter(t => (filt.st === "offen" ? ["neu", "in_bearbeitung"].includes(t.status) : filt.st === "alle" ? true : t.status === filt.st) && (filt.who === "alle" || (filt.who === "meine" ? t.assignee_id === ME.id : !t.assignee_id)));
    const cnt = s => all.filter(t => s === "offen" ? ["neu", "in_bearbeitung"].includes(t.status) : t.status === s).length;
    $("#supBody").innerHTML = `<div class="fhead"><div class="pfilters">
        ${DD.html("supSt", [{ v: "offen", l: "Offen", n: cnt("offen") }, { v: "wartet", l: "Wartet auf Kunde", n: cnt("wartet") }, { v: "geloest", l: "Gelöst", n: cnt("geloest") }, { v: "geschlossen", l: "Geschlossen" }, { v: "alle", l: "Alle" }], filt.st, { label: "Status" })}
        ${DD.html("supWho", [{ v: "alle", l: "Alle" }, { v: "meine", l: "Mir zugeordnet" }, { v: "niemand", l: "Niemand zuständig" }], filt.who, { label: "Wer" })}</div>
        <p class="hint" style="margin:0">Kunden melden sich über „Support“ im Kundenportal.</p></div>
      ${list.length ? `<div class="tklist">${list.map(t => `<a class="tk tk--${t.priority} ${t.unread ? "tk--unread" : ""}" href="#support/${t.id}">
          <span class="tk__p" title="${PR[t.priority]}">${t.priority === "kritisch" ? "!" : t.priority === "hoch" ? "↑" : ""}</span>
          <span class="tk__m"><b>${t.unread ? "● " : ""}${esc(t.subject)}</b><small>#${t.id} · ${esc(t.company)}${t.project_title ? " · " + esc(t.project_title) : ""} · ${CAT[t.category]} · ${ago(t.last_at || t.created_at)}</small></span>
          <span class="tk__r">${left(t)}${t.assignee ? `<span class="avatar avatar--xs" title="${esc(t.assignee)}">${esc(ini(t.assignee))}</span>` : `<span class="tk__none">niemand</span>`}<span class="fpill fpill--${STK[t.status]}">${ST[t.status]}</span></span></a>`).join("")}</div>`
        : `<div class="allclear"><b>${filt.st === "offen" ? "Keine offenen Anfragen." : "Keine Anfragen in dieser Ansicht."}</b><span>Neue Meldungen erscheinen hier und im Cockpit – kritische zusätzlich per E-Mail.</span></div>`}`;
  }
  DD.on("supSt", v => { filt.st = v; load(); }); DD.on("supWho", v => { filt.who = v; load(); });

  async function detail(id) {
    const t = await api(`/support/${id}`);
    $("#supBody").innerHTML = `<a class="back" href="#support">← Alle Anfragen</a>
      <div class="supd"><div class="stack">
        <div class="card"><p class="kicker">Support #${t.id} · ${CAT[t.category]} · ${esc(t.company)}</p><h2 style="margin:4px 0 6px">${esc(t.subject)}</h2>
          <p class="hint" style="margin:0">von ${esc(t.client_name)} · ${fmt(t.created_at, { dateStyle: "medium", timeStyle: "short" })} Uhr ${left(t)}</p></div>
        <div class="card tkthread">${t.messages.map(m => m.author_kind === "system" ? `<p class="tksys">${esc(m.body)} · ${esc(m.author)} · ${fmt(m.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>`
          : `<div class="tkmsg tkmsg--${m.author_kind} ${m.internal ? "tkmsg--int" : ""}"><div><b>${esc(m.author)}</b><span>${m.internal ? "interne Notiz · " : ""}${fmt(m.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div><p>${esc(m.body)}</p></div>`).join("")}</div>
        <form class="card tkreply" id="tkReply"><textarea name="body" rows="4" placeholder="Antwort an ${esc(t.client_name)} …" required></textarea>
          <div class="tkreply__a"><label class="check"><input type="checkbox" name="internal"> <span>Interne Notiz (Kunde sieht sie nicht)</span></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" data-send="wartet">Senden &amp; auf Kunde warten</button><button class="btn btn--ghost btn--sm" data-send="geloest">Senden &amp; gelöst</button><button class="btn btn--grad btn--sm" data-send="">Senden</button></div></div></form>
      </div>
      <div class="stack"><div class="card tkside">
        <div class="field"><span>Status</span>${DD.html("tkSt", Object.entries(ST).map(([v, l]) => ({ v, l })), t.status, { field: "status" })}</div>
        <div class="field"><span>Dringlichkeit</span>${DD.html("tkPr", Object.entries(PR).map(([v, l]) => ({ v, l })), t.priority, { field: "priority" })}</div>
        <div class="field"><span>Zuständig</span>${DD.html("tkWho", [{ v: "", l: "– niemand –" }, ...t.people.map(u => ({ v: u.id, l: u.name }))], t.assignee_id || "", { field: "assignee_id" })}</div>
        <div class="field"><span>Projekt</span>${DD.html("tkProj", [{ v: "", l: "– ohne Projekt –" }, ...t.projects.map(p => ({ v: p.id, l: p.title }))], t.project_id || "", { field: "project_id" })}</div>
        <div class="tkacts">${t.project_id ? `<button class="btn btn--ghost btn--sm" data-tk="task">${t.task_id ? "Aufgabe öffnen" : "→ Aufgabe"}</button><button class="btn btn--ghost btn--sm" data-tk="time">Zeit erfassen</button><button class="btn btn--ghost btn--sm" data-tk="timer">▶ Stoppuhr</button>` : `<p class="hint" style="margin:0">Mit Projekt: als Aufgabe übernehmen und Zeit buchen.</p>`}
          <a class="btn btn--ghost btn--sm" href="#kunden/${t.client_id}">Kundenakte</a></div>
      </div></div></div>`;
    const patch = async body => { try { await api(`/support/${id}`, { method: "PATCH", body }); toast("Gespeichert"); detail(id); window.updateBadges?.(); } catch (e) { toast(e.message); } };
    DD.on("tkSt", v => patch({ status: v })); DD.on("tkPr", v => patch({ priority: v })); DD.on("tkWho", v => patch({ assignee_id: v })); DD.on("tkProj", v => patch({ project_id: v }));
    const f = $("#tkReply");
    f.internal.addEventListener("change", () => { f.classList.toggle("int", f.internal.checked); $$("[data-send]", f).forEach(b => b.hidden = f.internal.checked && b.dataset.send); });
    f.addEventListener("submit", async e => { e.preventDefault(); const st = e.submitter?.dataset.send || undefined;
      try { await api(`/support/${id}/reply`, { method: "POST", body: { body: f.body.value, internal: f.internal.checked, status: f.internal.checked ? undefined : st } });
        toast(f.internal.checked ? "Notiz gespeichert" : "Antwort gesendet"); detail(id); window.updateBadges?.(); } catch (err) { toast(err.message); } });
    $(".tkacts").addEventListener("click", async e => { const a = e.target.closest("[data-tk]")?.dataset.tk; if (!a) return;
      try {
        if (a === "task") { const r = t.task_id ? { task_id: t.task_id } : await api(`/support/${id}/task`, { method: "POST", body: {} }); if (!t.task_id) toast("Als Aufgabe übernommen"); return window.WORK.openTask(r.task_id).then(() => !t.task_id && detail(id)); }
        if (a === "time") return window.WORK.logTime({ project_id: t.project_id });
        if (a === "timer") { await api("/timer", { method: "POST", body: { project_id: t.project_id, task_id: t.task_id || undefined, note: `Support #${t.id}` } }); toast("Stoppuhr läuft"); window.updateBadges?.(); }
      } catch (err) { toast(err.message); } });
  }

  /* ---------- Einstellungen: Betrieb ---------- */
  const size = b => b > 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " GB" : b > 1e6 ? (b / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
  async function loadOps() {
    const [o, s] = await Promise.all([api("/betrieb"), api("/support/settings")]);
    $("#opsBody").innerHTML = `<div class="autogrid">
      <div class="stack">
        <div class="card"><h2>Systemstatus</h2><div class="opschecks">${o.checks.map(c => `<div class="${c.ok ? "ok" : "bad"}"><span class="kst kst--${c.ok ? "gut" : "achtung"}"><i>${c.ok ? "✓" : "!"}</i>${c.ok ? "OK" : "Prüfen"}</span><b>${esc(c.k)}</b><p>${esc(c.text)}</p></div>`).join("")}</div>
          <p class="hint" style="margin:12px 0 0">Läuft seit ${o.uptimeMin < 120 ? o.uptimeMin + " Min." : Math.round(o.uptimeMin / 60) + " Std."} · Node ${esc(o.node)} · Daten: ${esc(o.data)}</p></div>
        <div class="card"><h2>Erreichbarkeit von Kundensystemen</h2><p class="hint" style="margin:-6px 0 12px">Das Board ruft die Adressen regelmäßig auf. Fällt ein System aus, erscheint es im Cockpit und Sie bekommen eine E-Mail – auch wenn es wieder läuft.</p>
          ${o.monitors.length ? `<div class="monlist">${o.monitors.map(m => `<div class="mon ${m.last_ok === 0 ? "down" : m.last_ok ? "up" : ""}"><span class="mon__dot"></span><span class="mon__m"><b>${esc(m.name)}</b><small>${esc(m.url)}${m.company ? " · " + esc(m.company) : ""}</small>
              <small>${m.last_ok === 0 ? `<b class="warn">nicht erreichbar seit ${fmt(m.down_since.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – ${esc(m.last_error || "")}</b>` : m.last_ok ? `erreichbar · ${m.last_ms} ms` : "noch nicht geprüft"}${m.uptime30 != null ? ` · 30 Tage: ${String(m.uptime30).replace(".", ",")} %` : ""}${m.active ? "" : " · pausiert"}</small></span>
              <span class="mon__a"><button class="btn btn--ghost btn--sm" data-mon="check" data-id="${m.id}">Jetzt prüfen</button><button class="x" data-mon="del" data-id="${m.id}" title="Entfernen">✕</button></span></div>`).join("")}</div>` : ""}
          <form class="monadd" id="monAdd"><input name="name" placeholder="Name, z. B. Mitglieder-App" required maxlength="80"><input name="url" placeholder="https://app.kunde.de" required><button class="btn btn--grad btn--sm">Hinzufügen</button></form></div>
      </div>
      <div class="stack">
        <div class="card"><h2>Datensicherung</h2><p class="hint" style="margin:-6px 0 12px">Jede Nacht nach 2 Uhr (und beim Start, falls die letzte älter als einen Tag ist) wird die Datenbank gesichert. Die letzten 14 Sicherungen bleiben erhalten.</p>
          <div class="bklist">${o.backups.slice(0, 6).map(b => `<a href="/api/admin/betrieb/backup/${esc(b.name)}" download><span>${esc(b.name)}</span><small>${fmt(b.at, { dateStyle: "short", timeStyle: "short" })} · ${size(b.bytes)}</small></a>`).join("") || `<p class="hint">Noch keine Sicherung.</p>`}</div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" id="bkNow">Jetzt sichern</button></div>
          <p class="hint" style="margin:12px 0 0">Gesichert wird die Datenbank (${size(o.sizes.db)}). Dateien – Dokumente ${size(o.sizes.documents)}, Belege ${size(o.sizes.finance)}, Prototypen ${size(o.sizes.prototypes)} – liegen im Datenordner und müssen beim Umzug auf den Server zusätzlich gesichert werden.</p></div>
        <form class="card slaform" id="slaForm"><h2>Support-Reaktionszeiten</h2><p class="hint" style="margin:-6px 0 12px">Bis wann der Kunde eine erste Antwort bekommt. Werktage = Geschäftszeit Mo–Fr. Der Kunde sieht diese Zeiten beim Anlegen.</p>
          ${Object.entries(PR).map(([k, l]) => `<div class="slarow"><b>${l}</b><label><input name="${k}_hours" inputmode="numeric" value="${s.sla[k].hours}"> Std.</label><label class="check"><input type="checkbox" name="${k}_business" ${s.sla[k].business ? "checked" : ""}> <span>nur Geschäftszeit</span></label></div>`).join("")}
          <div class="slarow"><b>Geschäftszeit</b><label><input name="dayFrom" inputmode="numeric" value="${s.dayFrom}"> bis</label><label><input name="dayTo" inputmode="numeric" value="${s.dayTo}"> Uhr</label></div>
          <div class="slarow"><b>Gelöst → geschlossen nach</b><label><input name="autoCloseDays" inputmode="numeric" value="${s.autoCloseDays}"> Tagen</label><span></span></div>
          <div class="slarow"><b>Kunden erinnern nach</b><label><input name="waitReminderDays" inputmode="numeric" value="${s.waitReminderDays}"> Tagen</label><span class="hint" style="margin:0">bei „Wartet auf Kunde“</span></div>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn--grad btn--sm">Speichern</button></div></form>
      </div></div>`;
    $("#bkNow").addEventListener("click", async e => { e.target.disabled = true; try { const r = await api("/betrieb/backup", { method: "POST", body: {} }); toast(`Gesichert: ${r.name}`); loadOps(); } catch (err) { toast(err.message); e.target.disabled = false; } });
    $("#monAdd").addEventListener("submit", async e => { e.preventDefault(); const b = $("button", e.target); b.disabled = true;
      try { const r = await api("/betrieb/monitors", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast(r.last_ok ? "Hinzugefügt – erreichbar" : "Hinzugefügt – aktuell NICHT erreichbar"); loadOps(); } catch (err) { toast(err.message); b.disabled = false; } });
    $(".monlist")?.addEventListener("click", async e => { const b = e.target.closest("[data-mon]"); if (!b) return;
      try { if (b.dataset.mon === "check") { b.disabled = true; const r = await api(`/betrieb/monitors/${b.dataset.id}/check`, { method: "POST", body: {} }); toast(r.last_ok ? `Erreichbar (${r.last_ms} ms)` : `Nicht erreichbar: ${r.last_error}`); }
        else { if (!(await UI.confirm("Die Überwachung wird entfernt.", { title: "Entfernen?", ok: "Entfernen", danger: true }))) return; await api(`/betrieb/monitors/${b.dataset.id}`, { method: "DELETE", body: {} }); }
        loadOps(); } catch (err) { toast(err.message); } });
    $("#slaForm").addEventListener("submit", async e => { e.preventDefault(); const f = e.target, sla = {};
      for (const k of Object.keys(PR)) sla[k] = { hours: f[`${k}_hours`].value, business: f[`${k}_business`].checked };
      try { await api("/support/settings", { method: "PUT", body: { sla, dayFrom: f.dayFrom.value, dayTo: f.dayTo.value, autoCloseDays: f.autoCloseDays.value, waitReminderDays: f.waitReminderDays.value } }); toast("Gespeichert"); } catch (err) { toast(err.message); } });
  }
  window.SUPPORT = { load, loadOps };
})();
