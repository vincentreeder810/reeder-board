/* Board – Prüfstrecke (Baustein H6): Projektkarte mit Funden und Bildschirmfotos, Einstellungen im Reiter KI-Assistent. Nutzt $, $$, esc, api, toast, DD, C. */
(() => {
  const C = window.RSChat;
  let T = null, pid = null, timer = null;
  const SEV = { kritisch: "Kritisch", hoch: "Hoch", mittel: "Mittel", hinweis: "Hinweis" };
  const DEV = { desktop: "Desktop", tablet: "Tablet", phone: "Handy" };
  const num = n => (n || 0).toLocaleString("de-DE");
  const usd = v => (v || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
  const when = s => s ? C.fmt(String(s).replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const pageName = p => (p || "").replace(/\.html?$/i, "").replace(/(^|\/)index$/, "$1Startseite").replace(/\/$/, "") || "Startseite";

  async function load(p) {
    const box = $("#pTests"); if (!box) return;
    pid = p.id; clearTimeout(timer);
    try { T = await api(`/projects/${pid}/pruefung`); } catch { box.innerHTML = ""; return; }
    render();
    if (T.runs.some(r => ["wartet", "laeuft"].includes(r.state))) timer = setTimeout(() => { if ($("#pTests") && pid === p.id) load(p); }, 4000);
  }
  function render() {
    const box = $("#pTests"); if (!box || !T) return;
    const running = T.runs.find(r => ["wartet", "laeuft"].includes(r.state));
    const open = T.findings.filter(f => f.status === "offen"), fixed = T.findings.filter(f => f.status === "behoben"), ign = T.findings.filter(f => f.status === "ignoriert");
    const bySev = Object.keys(SEV).map(k => [k, open.filter(f => f.severity === k).length]).filter(([, n]) => n);
    const l = T.latest;
    box.innerHTML = `<div class="chead" style="margin-bottom:10px"><div><h2 style="font-size:18px">Prüfstrecke</h2>
        <p>${T.totals.checks ? `<b>${num(T.totals.checks)}</b> Prüfungen in ${T.totals.runs} Läufen${l ? ` · zuletzt V${l.version}${l.proto_state === "kandidat" ? " (Kandidat)" : ""} am ${when(l.finished_at)}` : ""}` : "Noch nicht geprüft."}</p></div>
        <div class="acts"><button class="btn btn--ghost btn--sm" data-pt="run" ${T.browser ? "" : "disabled title='Kein Browser gefunden'"}>Jetzt prüfen</button>
          ${T.ai.available ? `<button class="btn btn--ghost btn--sm" data-pt="ai" title="Budget dieses Monats">KI-Prüfer · ${usd(T.ai.spent)} / ${usd(T.ai.cap)}</button>` : ""}
          ${T.totals.runs ? `<a class="btn btn--ghost btn--sm" href="/api/admin/projects/${pid}/pruefbericht" target="_blank" rel="noopener">Prüfbericht (PDF)</a>${ME.owner ? `<button class="btn btn--grad btn--sm" data-pt="report">Bericht an Kunden geben</button>` : ""}` : ""}</div></div>
      ${!T.browser ? `<p class="hint warn">Kein Browser gefunden – Edge oder Chrome installieren oder BROWSER_PATH in der .env setzen.</p>` : ""}
      ${running ? `<div class="ptrun"><span class="ptspin"></span>${running.kind === "ki" ? "KI-Prüfer sehen sich die Seiten an" : "Feste Prüfungen laufen"} (V${running.version}) …</div>` : ""}
      ${bySev.length || T.totals.checks ? `<div class="ptsum">${bySev.length ? bySev.map(([k, n]) => `<span class="sev sev--${k}">${n} ${SEV[k]}</span>`).join("") : `<span class="sev sev--ok">✓ Keine offenen Funde</span>`}
        ${fixed.length ? `<span class="sev sev--fix">✓ ${fixed.length} behoben</span>` : ""}${T.ai.cellsTotal ? `<span class="ptcells">KI-Durchgänge: ${T.ai.cellsDone} von ${T.ai.cellsTotal}</span>` : ""}</div>` : ""}
      ${open.length ? `<div class="ptlist">${open.slice(0, 40).map(row).join("")}</div>${open.length > 40 ? `<p class="hint">… und ${open.length - 40} weitere.</p>` : ""}` : ""}
      ${fixed.length ? `<details class="ptmore"><summary>${fixed.length} behoben</summary><div class="ptlist">${fixed.slice(0, 40).map(row).join("")}</div></details>` : ""}
      ${ign.length ? `<details class="ptmore"><summary>${ign.length} ignoriert</summary><div class="ptlist">${ign.map(row).join("")}</div></details>` : ""}
      ${T.shots.length ? `<details class="ptmore" open><summary>Bildschirmfotos V${l.version} (${T.shots.length})</summary><div class="ptshots">${T.shots.map(s => `<button type="button" class="ptshot" data-pt="shot" data-id="${s.id}" title="${esc(pageName(s.page))} · ${DEV[s.device]}"><img loading="lazy" src="/api/admin/pruefung/bild/${s.id}" alt=""><span>${esc(pageName(s.page))} · ${DEV[s.device]}</span></button>`).join("")}</div></details>` : ""}
      ${T.runs.length ? `<details class="ptmore"><summary>Letzte Läufe</summary><table class="table"><thead><tr><th>Wann</th><th>Version</th><th>Art</th><th class="num">Prüfungen</th><th class="num">Neu</th><th class="num">Behoben</th><th>Hinweis</th></tr></thead>
        <tbody>${T.runs.map(r => `<tr><td>${when(r.finished_at || r.created_at)}</td><td>V${r.version}${r.proto_state === "kandidat" ? " (K)" : ""}</td><td>${r.kind === "ki" ? "KI-Prüfer" : "Fest"}</td><td class="num">${r.state === "fertig" ? num(r.checks) : r.state === "fehler" ? "Fehler" : "läuft"}</td><td class="num">${r.new_found || ""}</td><td class="num">${r.fixed || ""}</td><td><small>${esc(r.note || "")}${r.cost ? ` · ${usd(r.cost)}` : ""}</small></td></tr>`).join("")}</tbody></table></details>` : ""}`;
  }
  const row = f => `<div class="ptf ptf--${f.status}"><span class="sev sev--${f.severity}">${SEV[f.severity]}</span>
    <div><b>${esc(f.title)}</b><p>${esc(f.detail || "")}</p><small>${esc(pageName(f.page))} · ${f.devices.map(d => DEV[d] || d).join(", ")}${f.persona ? ` · KI-Prüfer: ${esc(f.persona)}` : ""}${f.status === "behoben" ? ` · behoben in V${f.fixed_version}` : ` · seit V${f.first_version}`}</small></div>
    <div class="acts">${f.status === "offen" ? `${f.task_id ? `<span class="hint" style="margin:0">Aufgabe ✓</span>` : `<button class="btn btn--ghost btn--sm" data-pt="task" data-id="${f.id}">→ Aufgabe</button>`}<button class="btn btn--ghost btn--sm" data-pt="ignore" data-id="${f.id}" title="Kein Problem – nicht mehr anzeigen">Ignorieren</button>`
      : f.status === "ignoriert" ? `<button class="btn btn--ghost btn--sm" data-pt="reopen" data-id="${f.id}">Wieder anzeigen</button>` : ""}</div></div>`;

  async function act(a, b) {
    if (a === "run" || a === "ai") { const r = await api(`/projects/${pid}/pruefung`, { method: "POST", body: { kind: a === "ai" ? "ki" : "fest" } }); toast(`Prüfung von Version ${r.version} gestartet`); return load({ id: pid }); }
    if (a === "report") {
      if (!(await UI.confirm("Der aktuelle Prüfbericht wird als PDF in den Dokumenten des Kunden abgelegt; er bekommt dazu eine Neuigkeit im Portal und per Mail. Vorher ansehen: „Prüfbericht (PDF)“.", { title: "Prüfbericht an den Kunden geben?", ok: "Bereitstellen" }))) return;
      const r = await api(`/projects/${pid}/pruefbericht`, { method: "POST", body: {} }); toast(`Prüfbericht bereitgestellt (${num(r.checks)} Prüfungen, ${r.fixed} behoben)`); return window.KUNDEN?.openProjectPage(pid, true);
    }
    if (a === "task" || a === "ignore" || a === "reopen") {
      await api(`/pruefung/funde/${b.dataset.id}`, { method: "POST", body: a === "task" ? { task: true } : { status: a === "ignore" ? "ignoriert" : "offen" } });
      toast(a === "task" ? "Aufgabe angelegt" : "Gespeichert"); return load({ id: pid });
    }
    if (a === "shot") {
      const s = T.shots.find(x => x.id === +b.dataset.id), m = document.createElement("div"); m.className = "modal ptbig";
      m.innerHTML = `<div class="card"><div class="ptbig__head"><b>${esc(pageName(s.page))} · ${DEV[s.device]}</b><button class="btn btn--ghost btn--sm" data-x>Schließen</button></div><div class="ptbig__img"><img src="/api/admin/pruefung/bild/${s.id}" alt=""></div></div>`;
      document.body.appendChild(m); m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-pt]"); if (!b || !b.closest("#pTests")) return;
    e.preventDefault(); Promise.resolve(act(b.dataset.pt, b)).catch(err => toast(err.message));
  });

  /* ---------- Einstellungen (unter KI-Assistent) ---------- */
  async function settings() {
    const host = $("#prBody"); if (!host) return;
    const d = await api("/pruefung/einstellungen"), s = d.settings, models = d.models.map(m => ({ v: m.id, l: m.label }));
    host.innerHTML = `<form class="card" id="prForm"><h2>Prüfstrecke</h2>
      <p class="hint" style="margin:-6px 0 12px">${d.browser ? `Browser: <code>${esc(d.browser)}</code>` : `<b class="warn">Kein Browser gefunden</b> – Edge oder Chrome installieren oder BROWSER_PATH in der .env setzen.`}</p>
      <label class="check"><input type="checkbox" name="autoFixed" ${s.autoFixed ? "checked" : ""}> Jeden neuen Stand und Kandidaten automatisch prüfen (feste Prüfungen, kostenlos)</label>
      <label class="check"><input type="checkbox" name="autoAi" ${s.autoAi ? "checked" : ""}> Danach automatisch die KI-Prüfer laufen lassen (kostet, Budget je Projekt)</label>
      <div class="kigrid">
        <label><span>KI-Prüfer</span>${DD.html("prModel", models, s.model, { field: "model" })}<small class="hint">Sieht sich Bildschirmfotos an (${d.personas.length} Personen: ${esc(d.personas.join(", "))}).</small></label>
        <label><span>Gegenprüfung</span>${DD.html("prVerify", models, s.verifyModel, { field: "verifyModel" })}<small class="hint">Bestätigt nur Funde, die auf dem Bild belegt sind.</small></label>
        <label><span>Budget je Projekt und Monat (Dollar)</span><input name="projectCap" type="number" min="1" max="2000" value="${s.projectCap}"></label>
        <label><span>Stopp nach … Durchgängen ohne neuen Fund</span><input name="stopAfter" type="number" min="3" max="100" value="${s.stopAfter}"><small class="hint">„Gesättigt“ – weiteres Prüfen würde nur Geld kosten.</small></label>
      </div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn--grad btn--sm">Speichern</button></div></form>`;
    $("#prForm").addEventListener("submit", async e => { e.preventDefault(); const f = e.target;
      try { await api("/pruefung/einstellungen", { method: "PUT", body: { autoFixed: f.autoFixed.checked, autoAi: f.autoAi.checked, model: f.model.value, verifyModel: f.verifyModel.value, projectCap: f.projectCap.value, stopAfter: f.stopAfter.value } }); toast("Gespeichert"); } catch (err) { toast(err.message); } });
  }
  window.PRUEF = { load, settings };
})();
