/* Board – Auftragsliste & Morgenfreigabe (Baustein H5) auf der Projektseite. Nutzt $, $$, esc, api, toast, UI, C (RSChat), RSViewer. */
(() => {
  const C = window.RSChat;
  let A = null, pid = null;
  const when = s => C.fmt(String(s).replace(" ", "T") + (String(s).includes("Z") ? "" : "Z"), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const wish = a => a.change ? window.RSViewer.changeText(a.change) : (a.ai?.summary || a.comment || "(Zeichnung)");
  const kindPill = a => a.ai?.kind ? `<span class="kpill kpill--${esc(a.ai.kind)}">${esc({ klein: "Klein", mittel: "Mittel", gross: "Groß" }[a.ai.kind])}</span>` : "";
  const STATE = { offen: "wartet auf Umsetzung", abgeholt: "von Claude Code abgeholt – in Arbeit", kandidat: "umgesetzt – wartet auf Ihre Freigabe" };

  async function load(p) {
    const box = $("#pAuftrag"); if (!box) return;
    pid = p.id;
    try { A = await api(`/projects/${p.id}/auftrag`); } catch { box.innerHTML = ""; return; }
    render();
  }
  function render() {
    const box = $("#pAuftrag"); if (!box || !A) return;
    const j = A.job;
    if (!j && !A.ready.length && !A.forTeam.length) { box.innerHTML = ""; return; }
    let body = "";
    if (j?.state === "kandidat") {
      body = `<div class="auf auf--kand"><div class="auf__head"><span class="auf__ic">✓</span><div><b>Version ${j.candidate.version} wartet auf Ihre Freigabe</b>
          <p>Auftrag #${j.id} · ${j.items.length} Änderung${j.items.length === 1 ? "" : "en"} umgesetzt · Der Kunde sieht diesen Stand erst nach der Freigabe.</p></div></div>
        ${j.candidate.changes ? `<p class="auf__note">„${esc(j.candidate.changes)}“</p>` : ""}
        ${j.tests ? `<p class="auf__tests">${["wartet", "laeuft"].includes(j.tests.state) ? "⏳ Prüfstrecke läuft …" : `Prüfstrecke: <b>${(j.tests.checks || 0).toLocaleString("de-DE")} Prüfungen</b>${j.tests.fixed ? ` · ${j.tests.fixed} behoben` : ""}${j.tests.newFound ? ` · <b class="warn">${j.tests.newFound} neue Funde</b>` : " · keine neuen Funde"}${j.tests.open.filter(x => ["kritisch", "hoch"].includes(x.severity)).length ? ` · <b class="warn">${j.tests.open.filter(x => ["kritisch", "hoch"].includes(x.severity)).reduce((s, x) => s + x.n, 0)} offen (kritisch/hoch)</b>` : ""} – Details unten bei „Prüfstrecke“`}</p>` : ""}
        <div class="auf__items">${j.items.map(a => `<label class="auf__item"><input type="checkbox" data-done="${a.id}" checked>
          <span><b>${esc(wish(a))}</b><small>${esc(a.page || "")} · ${esc(a.author)}${a.comment && a.change && a.comment !== wish(a) ? ` · „${esc(a.comment)}“` : ""}</small></span>
          <button type="button" class="btn btn--ghost btn--sm" data-af="look" data-id="${a.id}">Ansehen</button></label>`).join("")}</div>
        <p class="hint" style="margin:6px 0 0">Haken weg = nicht richtig umgesetzt → bleibt für den nächsten Auftrag offen.</p>
        <div class="auf__acts"><button class="btn btn--ghost btn--sm" data-af="cand">Kandidat ansehen</button>${j.live ? `<button class="btn btn--ghost btn--sm" data-af="live">Aktuell beim Kunden (V${j.live.version})</button>` : ""}
          <span style="flex:1"></span><button class="btn btn--ghost btn--sm" data-af="reject">Zurückweisen …</button><button class="btn btn--grad btn--sm" data-af="release">Freigeben &amp; Kunde informieren</button></div></div>`;
    } else if (j) {
      body = `<div class="auf"><div class="auf__head"><span class="auf__ic auf__ic--wait">…</span><div><b>Auftrag #${j.id} · ${STATE[j.state]}</b>
          <p>${j.items.length} Änderung${j.items.length === 1 ? "" : "en"} · erstellt ${when(j.created_at)}${j.created_by ? " von " + esc(j.created_by) : ""}${j.picked_at ? ` · abgeholt ${when(j.picked_at)}` : ""}${j.note ? ` · Letzter Kandidat zurückgewiesen: „${esc(j.note)}“` : ""}</p></div></div>
        <div class="auf__items">${j.items.map(a => `<div class="auf__item"><span class="auf__dot"></span><span><b>${esc(wish(a))}</b><small>${esc(a.page || "")} · ${esc(a.author)}</small></span></div>`).join("")}</div>
        <div class="auf__acts"><button class="btn btn--ghost btn--sm" data-af="text">Auftrag für Claude Code anzeigen</button>${$("#pStand .stand code") ? `<button class="btn btn--ghost btn--sm" data-af="fromFolder">Kandidat aus Ordner hochladen</button>` : ""}
          <span style="flex:1"></span><button class="btn btn--ghost btn--sm" data-af="cancel">Auftrag abbrechen</button></div></div>`;
    }
    const pool = !j && (A.ready.length || A.forTeam.length) ? `<div class="auf">
        <div class="auf__head"><span class="auf__ic auf__ic--list">${A.ready.length}</span><div><b>${A.ready.length ? `${A.ready.length} geklärte${A.ready.length === 1 ? "r" : ""} Wunsch${A.ready.length === 1 ? "" : "e"} bereit für den nächsten Auftrag` : "Keine geklärten Wünsche"}</b>
          <p>Wird automatisch um ${A.cutoff} Uhr zum Auftrag gebündelt – oder jetzt sofort. Claude Code holt ihn mit <code>--auftrag</code> ab.</p></div></div>
        <div class="auf__items">${A.ready.map(a => `<label class="auf__item"><input type="checkbox" data-pick="${a.id}" checked><span><b>${esc(wish(a))}</b><small>${kindPill(a)} ${esc(a.page || "")} · ${esc(a.author)}</small></span></label>`).join("")}
          ${A.forTeam.length ? `<p class="auf__sub">Braucht eine Entscheidung des Teams (frei formuliert oder mittlerer Wunsch) – nur bewusst mitnehmen:</p>${A.forTeam.map(a => `<label class="auf__item auf__item--team"><input type="checkbox" data-pick="${a.id}"><span><b>${esc(a.ai?.summary || a.comment || "(Zeichnung)")}</b><small>${kindPill(a)} ${esc(a.page || "")} · ${esc(a.author)}${a.ai?.summary && a.comment ? ` · „${esc(a.comment)}“` : ""}</small></span></label>`).join("")}` : ""}</div>
        <div class="auf__acts"><span style="flex:1"></span><button class="btn btn--grad btn--sm" data-af="create">Auftrag jetzt erstellen</button></div></div>` : "";
    box.innerHTML = `<div class="chead" style="margin:14px 0 8px"><h3 style="margin:0;font-size:15px">Auftrag &amp; Freigabe</h3></div>${body}${pool}`;
  }
  const open = (proto, page) => window.RSViewer.open(proto, { page });

  async function act(a, b) {
    const j = A?.job;
    if (a === "create") {
      const ids = $$("#pAuftrag [data-pick]").filter(x => x.checked).map(x => +x.dataset.pick);
      if (!ids.length) return toast("Bitte mindestens einen Wunsch auswählen.");
      await api(`/projects/${pid}/auftrag`, { method: "POST", body: { ids } }); toast("Auftrag erstellt"); return load({ id: pid });
    }
    if (a === "text") {
      const { markdown } = await api(`/auftrag/${j.id}/text`);
      const m = document.createElement("div"); m.className = "modal";
      m.innerHTML = `<div class="card" style="width:min(760px,100%);max-height:90vh;display:grid;gap:12px"><h2 style="margin:0">Auftrag #${j.id} für Claude Code</h2>
        <p class="hint" style="margin:0">Claude Code holt ihn im Projektordner selbst ab: <code>--auftrag</code>. Oder hier kopieren und einfügen.</p>
        <textarea readonly class="mono" style="min-height:46vh">${esc(markdown)}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn--ghost" data-copy>Kopieren</button><button class="btn btn--grad" data-x>Schließen</button></div></div>`;
      document.body.appendChild(m);
      m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); if (e.target.closest("[data-copy]")) { navigator.clipboard?.writeText(markdown); toast("Kopiert"); } });
      return;
    }
    if (a === "fromFolder") {
      const r = await api(`/projects/${pid}/stand`, { method: "POST", body: { job: j.id, announce: false } });
      toast(r.unchanged ? r.summary : `Kandidat Version ${r.version} hochgeladen`); return window.KUNDEN?.openProjectPage(pid, true);
    }
    if (a === "cancel") {
      if (!(await UI.confirm("Die Wünsche kommen zurück in die Liste und können in einen neuen Auftrag.", { title: "Auftrag abbrechen?", ok: "Abbrechen", danger: true }))) return;
      await api(`/auftrag/${j.id}/abbrechen`, { method: "POST", body: {} }); return load({ id: pid });
    }
    if (a === "cand") return open(j.candidate);
    if (a === "live") return open(j.live);
    if (a === "look") { const it = j.items.find(x => x.id === +b.dataset.id); return open(j.candidate, it?.page); }
    if (a === "reject") {
      const note = await UI.prompt("Kandidat zurückweisen", { text: "Der Kandidat wird gelöscht, der Auftrag bleibt offen – Claude Code kann einen neuen Kandidaten hochladen. Der Kunde merkt davon nichts.", label: "Was stimmt nicht? (steht beim Auftrag)", multiline: true, ok: "Zurückweisen" });
      if (note === null) return;
      await api(`/auftrag/${j.id}/zurueckweisen`, { method: "POST", body: { note } }); toast("Zurückgewiesen"); return window.KUNDEN?.openProjectPage(pid, true);
    }
    if (a === "release") {
      const done = $$("#pAuftrag [data-done]").filter(x => x.checked).map(x => +x.dataset.done);
      const text = await UI.prompt(`Version ${j.candidate.version} freigeben`, { text: `Der Kunde bekommt den neuen Stand mit Nachricht im Chat und in der Neuigkeiten-Mail. ${done.length} von ${j.items.length} Anmerkungen werden als erledigt markiert („Umgesetzt in Version ${j.candidate.version}“).`,
        label: "Text für den Kunden (leer = automatisch)", value: j.candidate.changes || "", multiline: true, ok: "Freigeben" });
      if (text === null) return;
      const r = await api(`/auftrag/${j.id}/freigeben`, { method: "POST", body: { done, text } });
      toast(`Version ${r.version} ist beim Kunden${r.back ? ` · ${r.back} Wunsch zurück in der Liste` : ""}`); return window.KUNDEN?.openProjectPage(pid, true);
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-af]"); if (!b || !b.closest("#pAuftrag")) return;
    e.preventDefault(); Promise.resolve(act(b.dataset.af, b)).catch(err => toast(err.message));
  });
  window.AUFTRAG = { load };
})();
