/* Board – Täglicher Stand (Baustein H1): Ordner verknüpfen, Änderungen sehen, neuen Stand mit einem Klick hochladen,
   Verbindung für Claude Code (Stand-Schlüssel). Nutzt $, esc, api, toast, ME, UI, DD, C. */
(() => {
  const C = window.RSChat;
  let S = null;
  const ago = iso => C.fmt(iso.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const list = (label, a) => a.length ? `<div class="stdiff__g"><b>${label}</b>${a.slice(0, 12).map(p => `<code>${esc(p)}</code>`).join("")}${a.length > 12 ? `<span>+ ${a.length - 12} weitere</span>` : ""}</div>` : "";

  async function projectCard(p) {
    const box = $("#pStand"); if (!box) return;
    box.dataset.pid = p.id;
    try { S = await api(`/projects/${p.id}/stand`); } catch (err) { box.innerHTML = ""; return; }
    BR = ME.owner ? await api("/bruecke").catch(() => null) : null;
    render(box);
  }
  // Brücke zum Rechner des Inhabers: Ordner anlegen, Claude öffnen, neuen Stand hochladen – auch vom Online-Board aus
  const BR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V9a8 8 0 0 1 16 0v8"/><path d="M2 17h20"/><path d="M8 17v-5M12 17V9M16 17v-5"/></svg>`;
  function brueckeKarte() {
    if (!S?.canEdit || !BR) return "";
    const st = BR.verbunden ? `<span style="color:#16774f">● Brücke verbunden</span>` : BR.eingerichtet ? `<span class="warn">● Brücke nicht verbunden</span> – auf deinem Rechner „Bruecke im Hintergrund starten“ ausführen` : `Noch nicht eingerichtet: <a href="#einstellungen/livegang">Einstellungen → Livegang → Brücke zu Claude</a>`;
    return `<div class="stand stand--bruecke"><div class="stand__ic">${BR_ICON}</div>
      <div style="min-width:0"><b>Mit Claude am Projekt arbeiten</b>
        <p>Legt auf deinem Rechner den Projektordner an – mit den Angaben des Kunden und dem bisherigen Entwurf – und öffnet Claude darin. Fertige Arbeit lädst du von hier als neuen Stand hoch.</p>
        <p class="stand__st">${st}</p></div>
      <div class="acts"><button class="btn btn--grad btn--sm" data-br="claude" ${BR.verbunden ? "" : "disabled"}>Mit Claude arbeiten</button>
        <button class="btn btn--ghost btn--sm" data-br="stand" ${BR.verbunden ? "" : "disabled"}>Neuen Stand hochladen</button>
        <button class="btn btn--ghost btn--sm" data-br="ordner" ${BR.verbunden ? "" : "disabled"}>Ordner öffnen</button></div></div>`;
  }
  let BR = null;
  function render(box = $("#pStand")) {
    if (!box || !S) return;
    renderAlt(box);
    box.insertAdjacentHTML("afterbegin", brueckeKarte());
  }
  function renderAlt(box) {
    const linked = S.source_dir || S.key;
    if (!linked) {
      box.innerHTML = S.canEdit ? `<div class="stand stand--empty"><div class="stand__ic">${ICON}</div><div><b>Täglicher Stand</b><p>Projektordner verknüpfen oder Claude Code verbinden – dann genügt ein Klick oder ein Befehl, und der Kunde sieht den neuen Stand mit Änderungsliste.</p></div>
        <div class="acts"><button class="btn btn--ghost btn--sm" data-stand="folder">Ordner verknüpfen</button><button class="btn btn--ghost btn--sm" data-stand="key">Claude Code verbinden</button></div></div>` : "";
      return;
    }
    const pend = S.pending, t = S.target;
    const status = S.folderError ? `<p class="stand__st stand__st--err">${esc(S.folderError)}</p>`
      : pend?.waiting ? `<p class="stand__st">⏳ ${esc(pend.summary)}</p>`
      : pend?.unchanged ? `<p class="stand__st">✓ ${esc(pend.summary)}</p>`
      : pend ? `<p class="stand__st stand__st--new"><b>${t ? `Seit Version ${t.version} geändert` : "Bereit für den ersten Stand"}:</b> ${esc(pend.summary)}</p>` : "";
    const more = [{ v: "refresh", l: "Erneut prüfen" }, ...(S.canEdit ? [{ v: "folder", l: S.source_dir ? "Ordner ändern" : "Ordner verknüpfen" }, { v: "key", l: S.key ? "Neuen Schlüssel erzeugen" : "Claude Code verbinden" },
      ...(S.key ? [{ v: "revoke", l: "Schlüssel widerrufen", danger: true }] : []), ...(S.source_dir ? [{ v: "unlink", l: "Ordner-Verknüpfung lösen", danger: true }] : [])] : [])];
    box.innerHTML = `<div class="stand"><div class="stand__ic">${ICON}</div>
      <div style="min-width:0"><b>Täglicher Stand${t ? ` → „${esc(t.title)}“ <em class="vtag">V${t.version}</em>` : ""}</b>
        <p>${S.source_dir ? `Ordner <code title="${esc(S.source_dir)}">${esc(S.source_dir)}</code>` : "Kein Ordner verknüpft"}${S.key ? ` · Claude Code verbunden (…${esc(S.key.hint)})` : ""}${t ? ` · letzter Stand ${ago(t.created_at)}` : ""}</p>
        ${status}
        ${pend && !pend.unchanged && !pend.waiting ? `<details class="stdiff"><summary>Dateien ansehen</summary>${list("Geändert", pend.diff.changed)}${list("Neu", pend.diff.added)}${list("Entfernt", pend.diff.removed)}</details>` : ""}</div>
      <div class="acts">${S.source_dir ? `<button class="btn btn--grad btn--sm" data-stand="publish" ${pend && !pend.unchanged && !pend.waiting && !S.folderError ? "" : "disabled"}>Neuen Stand hochladen</button>` : ""}
        ${DD.html("stand-" + S.project_id, more, "", { trigger: "Mehr", align: "right" })}</div></div>`;
  }
  const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`;

  function modal(html) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card form-grid" style="width:min(620px,100%);max-height:90vh;overflow:auto">${html}<p class="err span2" hidden></p></form>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) close(); });
    m.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return { m, f: m.querySelector("form"), close, fail: msg => { const p = m.querySelector(".err"); p.textContent = msg; p.hidden = false; } };
  }
  const reloadPage = () => window.KUNDEN?.openProjectPage(S.project_id, true);

  const actions = {
    async refresh() { await projectCard({ id: S.project_id }); toast("Ordner geprüft"); },
    async folder() {
      const d = modal(`<h2 class="span2">Projektordner verknüpfen</h2>
        <p class="hint span2" style="margin:0">Der Ordner, in dem die fertige Website liegt – meist der Ausgabe-Ordner wie <code>dist</code>, <code>build</code> oder <code>public</code>. Versteckte Dateien und <code>node_modules</code> werden nie hochgeladen. Das Board liest den Ordner nur, wenn Sie auf „Neuen Stand hochladen“ klicken.</p>
        <label class="span2"><span>Vollständiger Pfad</span><input name="dir" required value="${esc(S.source_dir || "")}" placeholder="C:\\Projekte\\cafe-mueller\\dist" autocomplete="off" spellcheck="false"></label>
        <p class="hint span2" style="margin:0">Tipp: Im Explorer den Ordner mit gedrückter Umschalttaste rechts anklicken → „Als Pfad kopieren“ und hier einfügen (Anführungszeichen werden entfernt).</p>
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Verknüpfen</button></div>`);
      d.f.dir.focus();
      d.f.addEventListener("submit", async e => { e.preventDefault();
        try { S = { ...S, ...(await api(`/projects/${S.project_id}/stand`, { method: "PUT", body: { source_dir: d.f.dir.value.trim().replace(/^"|"$/g, "") } })) }; d.close(); toast("Ordner verknüpft"); projectCard({ id: S.project_id }); }
        catch (err) { d.fail(err.message); } });
    },
    async unlink() {
      if (!(await UI.confirm("Bisherige Versionen bleiben erhalten. Neue Stände kommen dann nur noch über Claude Code oder das normale Hochladen.", { title: "Ordner-Verknüpfung lösen?", ok: "Lösen", danger: true }))) return;
      await api(`/projects/${S.project_id}/stand`, { method: "PUT", body: { source_dir: "" } }); projectCard({ id: S.project_id });
    },
    async publish() {
      const p = S.pending, t = S.target;
      const d = modal(`<h2 class="span2">${t ? `Neuer Stand: Version ${p.version}` : "Ersten Stand veröffentlichen"}</h2>
        <div class="upsum span2"><b>${p.files} Dateien</b><span>${C.size(p.bytes)}</span><span style="margin-left:auto;color:var(--ink2)">${t ? `nach „${esc(t.title)}“` : "neuer Prototyp für dieses Projekt"}</span></div>
        <p class="span2" style="margin:0"><b>Automatisch erkannt:</b> ${esc(p.summary)}</p>
        <label class="span2">Was hat sich geändert? (sieht der Kunde – leer lassen für die automatische Liste)<textarea name="changes" rows="3" placeholder="z. B. Überschriften ruhiger, Öffnungszeiten ergänzt, Speisekarte als eigene Seite"></textarea></label>
        ${KANAL.html({ hinweis: "Bei „Nicht benachrichtigen“ sieht der Kunde die neue Version nur, wenn er selbst ins Portal schaut." })}
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Hochladen</button></div>`);
      d.f.addEventListener("submit", async e => { e.preventDefault(); const b = d.f.querySelector("button:not([data-close])"); b.disabled = true; b.textContent = "Wird hochgeladen …";
        try { const r = await api(`/projects/${S.project_id}/stand`, { method: "POST", body: { changes: d.f.changes.value, announce: KANAL.werte(d.f).chat, mail: KANAL.werte(d.f).mail, erinnern: KANAL.werte(d.f).erinnern } });
          d.close(); toast(r.unchanged ? r.summary : `Version ${r.version} ist online`); reloadPage(); }
        catch (err) { d.fail(err.message); b.disabled = false; b.textContent = "Hochladen"; } });
    },
    async key() {
      if (S.key && !(await UI.confirm("Der bisherige Schlüssel funktioniert danach nicht mehr – die Datei .reeder-stand.json im Projektordner muss ersetzt werden.", { title: "Neuen Schlüssel erzeugen?", ok: "Neu erzeugen" }))) return;
      const r = await api(`/projects/${S.project_id}/stand/key`, { method: "POST", body: {} }); S = { ...S, ...r };
      const cfg = JSON.stringify({ url: location.origin, key: r.secret, ordner: "dist" }, null, 2);
      const cmd = `node "${CLI}"`;
      const claude = `## Reeder Board\nKundenwünsche abholen: ${cmd} --auftrag  (schreibt REEDER-AUFTRAG.md mit den geklärten Änderungen – genau diese umsetzen, nichts anderes)\nDanach bauen und als Kandidat hochladen: ${cmd} --kandidat <Auftragsnummer> --text "<kurz, für den Kunden verständlich, was umgesetzt wurde>"\nDer Kunde sieht den Kandidaten erst nach der Freigabe im Board.\nEigene Weiterentwicklung ohne Auftrag: erst ${cmd} --pruefen, dann ${cmd} --text "…"\nDie Datei .reeder-stand.json niemals committen.`;
      const d = modal(`<h2 class="span2">Claude Code verbinden</h2>
        <p class="hint span2" style="margin:0">Der Schlüssel erlaubt nur eines: neue Stände für <b>dieses</b> Projekt hochladen. Er wird nur jetzt angezeigt.</p>
        <label class="span2"><span>1. Im Projektordner die Datei <code>.reeder-stand.json</code> anlegen (und in die <code>.gitignore</code> eintragen)</span><textarea readonly rows="5" class="mono" data-copyarea>${esc(cfg)}</textarea></label>
        <p class="hint span2" style="margin:-6px 0 0">„ordner“ ist der Ausgabe-Ordner relativ zur Datei – bei einfachen Seiten ohne Build einfach <code>"."</code>.</p>
        <label class="span2"><span>2. Neuen Stand hochladen – im Projektordner ausführen</span><textarea readonly rows="2" class="mono" data-copyarea>${esc(cmd)}</textarea></label>
        <label class="span2"><span>3. Optional für die CLAUDE.md des Projekts – dann macht Claude Code das selbst</span><textarea readonly rows="5" class="mono" data-copyarea>${esc(claude)}</textarea></label>
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-copyall>Alles kopieren</button><button type="button" class="btn btn--grad" data-close>Fertig</button></div>`);
      d.m.addEventListener("click", e => {
        const ta = e.target.closest("[data-copyarea]"); if (ta) { ta.select(); navigator.clipboard?.writeText(ta.value); toast("Kopiert"); }
        if (e.target.closest("[data-copyall]")) { navigator.clipboard?.writeText(`.reeder-stand.json\n${cfg}\n\nBefehl\n${cmd}\n\nCLAUDE.md\n${claude}`); toast("Alles kopiert"); }
      });
      render();
    },
    async revoke() {
      if (!(await UI.confirm("Claude Code kann danach keine Stände mehr für dieses Projekt hochladen.", { title: "Schlüssel widerrufen?", ok: "Widerrufen", danger: true }))) return;
      S = { ...S, ...(await api(`/projects/${S.project_id}/stand/key`, { method: "DELETE", body: {} })) }; render(); toast("Schlüssel widerrufen");
    },
  };
  let CLI = "server/stand-cli.mjs";
  fetch("/api/admin/stand-cli", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null).then(d => { if (d?.path) CLI = d.path; }).catch(() => {});

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-br]"); if (!b || b.closest(".modal") || !S) return;
    const pid = S.project_id, art = b.dataset.br;
    try {
      if (art === "stand") {
        const d = modal(`<h2 class="span2">Neuen Stand hochladen</h2>
          <p class="hint span2" style="margin:0">Die Brücke lädt den Inhalt des Ordners <code>website</code> aus dem Projektordner auf deinem Rechner hoch. Das Board vergleicht mit der letzten Version; hat sich nichts geändert, entsteht keine neue.</p>
          <label class="span2">Was hat sich geändert? (sieht der Kunde – leer lassen für die automatische Liste)<textarea name="changes" rows="3" placeholder="z. B. Startseite überarbeitet, Leistungen ergänzt, Kontaktformular eingebaut"></textarea></label>
          ${KANAL.html({ hinweis: "Bei „Nicht benachrichtigen“ sieht der Kunde die neue Version nur, wenn er selbst ins Portal schaut." })}
          <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Hochladen</button></div>`);
        d.f.addEventListener("submit", async ev => { ev.preventDefault();
          try { await api(`/bruecke/projekt/${pid}/stand`, { method: "POST", body: { changes: d.f.changes.value, announce: KANAL.werte(d.f).chat, mail: KANAL.werte(d.f).mail, erinnern: KANAL.werte(d.f).erinnern } });
            d.close(); toast("Die Brücke lädt den Stand hoch. Die Seite aktualisiert sich gleich …"); setTimeout(reloadPage, 9000); }
          catch (err) { d.fail(err.message); } });
        return;
      }
      b.disabled = true;
      await api(`/bruecke/projekt/${pid}/${art}`, { method: "POST", body: {} });
      toast(art === "claude" ? "Die Claude-App öffnet sich auf deinem Rechner. Dort den Ordner bestätigen, dann abschicken." : "Der Ordner öffnet sich auf deinem Rechner.");
      setTimeout(() => { b.disabled = false; }, 2500);
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-stand]"); if (!b || b.closest(".modal")) return;
    Promise.resolve(actions[b.dataset.stand]?.()).catch(err => toast(err.message));
  });
  document.addEventListener("click", e => {
    const item = e.target.closest('.dd[data-dd^="stand-"] .dd__menu [data-v]'); if (!item) return;
    Promise.resolve(actions[item.dataset.v]?.()).catch(err => toast(err.message));
  }, true);
  /* ---------- Arbeitsbereich: was Claude im Projektordner in arbeitsstand.json festhält ---------- */
  let W = null;
  const absatz = t => esc(t).replace(/\n+/g, "<br>");
  async function workspace(p) {
    const box = $("#pWs"); if (!box || !p || p.bereich === "hardware") return;
    W = await api(`/projects/${p.id}/workspace`).catch(() => null); if (!W) return;
    box.dataset.pid = p.id; box.hidden = false;
    if (W.leer) W = { leer: true, stand: "", letzteSitzung: "", notizen: [], fragen: [] };
    const offen = W.fragen.filter(f => f.status === "offen"), klar = W.fragen.filter(f => f.status !== "offen");
    const tag = iso => C.fmt(iso, { day: "numeric", month: "short" });
    // Lange Texte werden auf drei Zeilen gekürzt und lassen sich aufklappen
    const kurz = (t, leer) => !t ? `<p><i>${leer}</i></p>` : `<p class="pclamp">${absatz(t)}</p><button type="button" class="link" data-mehr>ganz anzeigen</button>`;
    const frage = f => `<div class="ws__f"><input type="checkbox" value="${esc(f.id)}" aria-label="Zum Senden auswählen"><span>${absatz(f.text)}<small>${f.vonTeam ? "von dir" : "von Claude"} · noch nicht an den Kunden geschickt</small></span>
      <span class="ws__fk"><button type="button" class="link" data-wsf="antwort" data-id="${esc(f.id)}">Antwort eintragen</button><button type="button" class="link link--leise" data-wsf="loeschen" data-id="${esc(f.id)}">Löschen</button></span></div>`;
    // Schon geschickt: klar als „beim Kunden“ markiert, mit Datum und „Erneut schicken“
    const frageWeg = f => `<div class="ws__f ws__f--weg"><span class="ws__bk" title="An den Kunden geschickt">${ICON_PFEIL}</span><span>${absatz(f.text)}<small><b class="ws__ok">An den Kunden geschickt</b> am ${tag(f.gesendet)} · wartet auf Antwort</small></span>
      <span class="ws__fk"><button type="button" class="link" data-wsf="erneut" data-id="${esc(f.id)}">↻ Erneut schicken</button><button type="button" class="link" data-wsf="antwort" data-id="${esc(f.id)}">Antwort eintragen</button><button type="button" class="link link--leise" data-wsf="loeschen" data-id="${esc(f.id)}">Löschen</button></span></div>`;
    const neuF = offen.filter(f => !f.gesendet), wegF = offen.filter(f => f.gesendet);
    const ZEIG_N = 3, ZEIG_F = 4;
    const fragenBlock = `<div class="ws__b ws__fragen"><b>Fragen an den Kunden${offen.length ? ` <em>${offen.length}</em>` : ""}</b>
        ${!offen.length ? `<p>Keine offenen Fragen.</p>` : ""}
        ${wegF.length ? `<p class="ws__gruppe">Beim Kunden – wartet auf Antwort <em>${wegF.length}</em></p>` + wegF.map(frageWeg).join("") : ""}
        ${neuF.length ? `<p class="ws__gruppe">Noch nicht geschickt <em>${neuF.length}</em></p><p class="ws__woher">Von Claude gesammelt oder von dir angelegt. Zum Senden ankreuzen – oder, wenn du die Antwort schon hast, eintragen.</p>`
          + neuF.slice(0, ZEIG_F).map(frage).join("") + weitere(neuF.length - ZEIG_F, neuF.slice(ZEIG_F).map(frage).join(""), ["weitere Frage", "weitere Fragen"]) : ""}
        <form class="ws__neu" data-wsf-neu><input name="text" maxlength="600" placeholder="Eigene Frage an den Kunden hinzufügen …" autocomplete="off"><button class="btn btn--ghost btn--sm">Hinzufügen</button></form>
        ${neuF.length && S?.canEdit ? `<div class="acts" style="margin-top:10px;justify-content:flex-start"><button class="btn btn--grad btn--sm" data-ws="senden">Angekreuzte Fragen an den Kunden senden</button></div>` : ""}
        ${weitere(klar.length, klar.map(f => `<p class="ws__klarf"><s>${esc(f.text)}</s>${f.antwort ? `<br>→ ${absatz(f.antwort)}` : ""}${f.vomKunden ? `<br><small><em>vom Kunden beantwortet am ${tag(f.vomKunden)}</em></small>` : ""}</p>`).join(""), ["geklärte Frage", "geklärte Fragen"])}</div>`;
    const kopf = sub => `<div class="chead" style="margin-bottom:12px"><div><h2 style="font-size:18px">Arbeitsbereich</h2><p>${sub}</p></div></div>`;
    if (W.leer) { box.innerHTML = kopf("Stand, Notizen und Fragen an den Kunden") + `<p class="ws__leer">Von Claude ist noch nichts da. Öffne das Projekt oben mit „Mit Claude arbeiten“ und sag Claude am Ende: <b>„Aktualisiere den Arbeitsstand.“</b> Fragen an den Kunden kannst du schon jetzt selbst anlegen.</p>` + fragenBlock; return; }
    box.innerHTML = kopf(`Aus dem Projektordner · aktualisiert ${ago(W.aktualisiert)} · der Kunde sieht das nicht`) + `
      <div class="ws__zwei"><div class="ws__b"><b>Aktueller Stand</b>${kurz(W.stand, "Noch nicht beschrieben.")}</div>
        <div class="ws__b"><b>Letzte Sitzung</b>${kurz(W.letzteSitzung, "Noch nichts eingetragen.")}</div></div>
      ${W.notizen.length ? `<div class="ws__b"><b>Notizen</b><ul>${W.notizen.slice(0, ZEIG_N).map(n => `<li>${absatz(n)}</li>`).join("")}</ul>
        ${weitere(W.notizen.length - ZEIG_N, `<ul>${W.notizen.slice(ZEIG_N).map(n => `<li>${absatz(n)}</li>`).join("")}</ul>`, ["weitere Notiz", "weitere Notizen"])}</div>` : ""}
      ${fragenBlock}`;
    window.kuerzungPruefen?.();
  }
  // Eigene Fragen: anlegen, Antwort eintragen, löschen
  document.addEventListener("submit", async e => {
    const f = e.target.closest("[data-wsf-neu]"); if (!f) return; e.preventDefault();
    const text = f.text.value.trim(); if (!text) return;
    const pid = +$("#pWs").dataset.pid; f.querySelector("button").disabled = true;
    try { await api(`/projects/${pid}/workspace/fragen`, { method: "POST", body: { text } }); toast("Frage hinzugefügt – Claude bekommt sie im Projektordner."); workspace({ id: pid }); }
    catch (err) { toast(err.message); f.querySelector("button").disabled = false; }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-wsf]"); if (!b) return;
    const pid = +$("#pWs").dataset.pid, id = b.dataset.id, fr = W?.fragen.find(x => x.id === id); if (!fr) return;
    try {
      if (b.dataset.wsf === "erneut") return fragenSenden(pid, [id], true);
      if (b.dataset.wsf === "antwort") {
        const a = await UI.prompt("Antwort eintragen", { text: fr.text, label: "Was hat der Kunde geantwortet? Die Frage gilt danach als geklärt, Claude bekommt die Antwort im Projektordner.", value: "", multiline: true, ok: "Als geklärt speichern" });
        if (a === null) return;
        await api(`/projects/${pid}/workspace/fragen/${encodeURIComponent(id)}`, { method: "PATCH", body: { antwort: a } }); toast("Gespeichert"); return workspace({ id: pid });
      }
      if (!(await UI.confirm(fr.text, { title: "Frage löschen?", ok: "Löschen", danger: true }))) return;
      await api(`/projects/${pid}/workspace/fragen/${encodeURIComponent(id)}`, { method: "DELETE", body: {} }); toast("Gelöscht"); workspace({ id: pid });
    } catch (err) { toast(err.message); }
  });

  /* ---------- Freigabe: Was Claude über die Brücke hochlädt, sieht der Kunde erst nach dem Okay des Inhabers ---------- */
  let F = null;
  async function freigabe(p) {
    const box = $("#pFrei"); if (!box || !p || !ME.owner || p.bereich === "hardware") return;
    F = await api(`/bruecke/projekt/${p.id}/wartend`).catch(() => null);
    const w = F?.wartend; box.hidden = !w; if (!w) return;
    box.dataset.pid = p.id;
    box.innerHTML = `<div class="pfrei__k"><span class="pfrei__ic">${ICON}</span><div><b>Version ${w.version} wartet auf deine Freigabe</b>
        <p>Von Claude hochgeladen ${ago(w.created_at)}. ${F.live ? `Der Kunde sieht noch Version ${F.live.version}.` : "Der Kunde sieht noch nichts."}${w.erledigt ? ` Mit der Freigabe ${w.erledigt === 1 ? "wird 1 Anmerkung" : `werden ${w.erledigt} Anmerkungen`} abgehakt.` : ""}</p>
        ${w.changes ? `<p class="pfrei__t pclamp">„${esc(w.changes)}“</p><button type="button" class="link" data-mehr>ganz anzeigen</button>` : ""}
        ${pbKurz(w.pruefbericht)}</div></div>
      <div class="acts"><button class="btn btn--ghost btn--sm" data-fr="verwerfen">Verwerfen</button><button class="btn btn--ghost btn--sm" data-fr="ansehen">Ansehen</button><button class="btn btn--grad btn--sm" data-fr="freigeben">Freigeben</button></div>`;
    window.kuerzungPruefen?.();
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-fr]"); if (!b || !F?.wartend) return;
    const w = F.wartend, pid = +$("#pFrei").dataset.pid;
    try {
      if (b.dataset.fr === "ansehen") return window.RSViewer.open({ id: w.id, title: w.title, url: w.url, base: w.base, entry: w.entry, version: w.version, created_at: w.created_at });
      if (b.dataset.fr === "verwerfen") {
        if (!(await UI.confirm(`Version ${w.version} wird gelöscht. Der Kunde merkt davon nichts, im Projektordner bleibt alles, wie es ist.`, { title: "Version verwerfen?", ok: "Verwerfen", danger: true }))) return;
        await api(`/bruecke/projekt/${pid}/verwerfen`, { method: "POST", body: {} }); toast("Verworfen"); return window.KUNDEN?.openProjectPage(pid, true);
      }
      const d = modal(`<h2 class="span2">Version ${w.version} freigeben</h2>
        <p class="hint span2" style="margin:0">Mit der Freigabe sieht der Kunde diese Version im Kundenportal.</p>
        <label class="span2">Was ist neu? (sieht der Kunde)<textarea name="text" rows="3">${esc(w.changes || "")}</textarea></label>
        ${KANAL.html({ hinweis: "Bei „Nicht benachrichtigen“ sieht der Kunde die neue Version nur, wenn er selbst ins Portal schaut." })}
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Freigeben</button></div>`);
      d.f.addEventListener("submit", async ev => { ev.preventDefault(); const k = d.f.querySelector("button:not([data-close])"); k.disabled = true;
        try { const r = await api(`/bruecke/projekt/${pid}/freigeben`, { method: "POST", body: { text: d.f.text.value, announce: KANAL.werte(d.f).chat, mail: KANAL.werte(d.f).mail, erinnern: KANAL.werte(d.f).erinnern } });
          d.close(); toast(`Version ${r.version} ist jetzt beim Kunden${r.erledigt ? ` · ${r.erledigt} Anmerkung${r.erledigt === 1 ? "" : "en"} abgehakt` : ""}`); window.KUNDEN?.openProjectPage(pid, true); }
        catch (err) { d.fail(err.message); k.disabled = false; } });
    } catch (err) { toast(err.message); }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-ws]"); if (!b) return;
    if (b.dataset.ws === "website" || b.dataset.ws === "anmerkungen") { const k = $('[data-act="openProto"]'); if (!k) return; k.dataset.liste = b.dataset.ws === "website" ? "0" : "1"; k.click(); delete k.dataset.liste; return; }
    const box = $("#pWs"), pid = +box.dataset.pid, ids = $$(".ws__f input:checked", box).map(i => i.value);
    if (!ids.length) return toast("Bitte mindestens eine Frage ankreuzen.");
    fragenSenden(pid, ids, false);
  });
  function fragenSenden(pid, ids, erneut) {
    const fragen = W.fragen.filter(f => ids.includes(f.id));
    const d = modal(`<h2 class="span2">${erneut ? "Frage erneut an den Kunden schicken" : "Fragen an den Kunden senden"}</h2>
      ${erneut ? `<p class="hint span2" style="margin:0">Zuletzt geschickt am ${C.fmt(fragen[0]?.gesendet, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} Uhr. Die Frage kommt nochmal als Karte in den Projekt-Chat.</p>` : ""}
      <p class="hint span2" style="margin:0">So sieht der Kunde die Fragen – jede mit eigenem Antwortfeld. Sie erscheinen außerdem im Projekt-Chat.</p>
      <div class="span2 wsv" aria-label="Vorschau, wie der Kunde die Fragen sieht">${fragen.map(f => `<div class="wsv__k"><p class="wsv__q">${absatz(f.text)}</p><div class="wsv__feld" aria-hidden="true">Ihre Antwort …</div><span class="wsv__knopf" aria-hidden="true">Antwort senden</span></div>`).join("")}</div>
      ${KANAL.html({ modus: "rueckfragen", titel: "Die Fragen kommen in den Chat – und per E-Mail?", hinweis: "Die E-Mail ist nur ein Hinweis, die Fragen selbst stehen nicht darin." })}
      <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Senden</button></div>`);
    d.f.addEventListener("submit", async ev => { ev.preventDefault(); const k = d.f.querySelector("button:not([data-close])"); k.disabled = true;
      try { const r = await api(`/projects/${pid}/workspace/fragen-senden`, { method: "POST", body: { ids, mail: KANAL.werte(d.f).mail, erinnern: KANAL.werte(d.f).erinnern } });
        d.close(); toast(`${r.anzahl === 1 ? "Frage" : r.anzahl + " Fragen"} gesendet – im Kundenportal unter Rückfragen und im Projekt-Chat${r.mailed ? ", mit E-Mail-Hinweis" : ""}.`);
        if (window.KUNDEN?.openProjectPage && $("#pChat")) window.KUNDEN.openProjectPage(pid, true); else workspace({ id: pid }); }   // neu zeichnen, damit die Karte „Nachrichten“ die Rückfragen gleich zeigt
      catch (err) { d.fail(err.message); k.disabled = false; } });
  }
  const ICON_PFEIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>`;
  /* ---------- Prüfbericht von Claude (pruefbericht.json über die Brücke) ---------- */
  const SCHW = { kritisch: "Kritisch", hoch: "Hoch", mittel: "Mittel", hinweis: "Hinweis" };
  const ZAHLEN = [["zeilenGeaendert", "Zeilen geändert"], ["dateienGeaendert", "Dateien"], ["aenderungen", "Änderungen"], ["testlaeufe", "Testläufe"], ["pruefungen", "Prüfungen"], ["behoben", "Behoben"], ["offen", "Offen"]];
  const n = v => Number(v || 0).toLocaleString("de-DE");
  function pbKurz(b) {
    if (!b) return `<p class="pb__kurz pb__kurz--nix">Kein Prüfbericht von Claude zu dieser Version.</p>`;
    const offen = (b.funde || []).filter(f => f.status === "offen"), krit = offen.filter(f => ["kritisch", "hoch"].includes(f.schwere)).length;
    return `<p class="pb__kurz ${krit ? "pb__kurz--warn" : "pb__kurz--ok"}">${krit ? "⚠" : "✓"} Von Claude geprüft${b.zahlen?.pruefungen ? ` · ${n(b.zahlen.pruefungen)} Prüfungen` : ""}${b.geprueft?.length ? ` · ${b.geprueft.length} Größen` : ""} · ${offen.length ? `${offen.length} offen${krit ? ` (${krit} wichtig)` : ""}` : "nichts offen"}</p>`;
  }
  async function pruefbericht(p) {
    const box = $("#pPruef"); if (!box || !p || !ME.owner || p.bereich === "hardware") return;
    const r = await api(`/bruecke/projekt/${p.id}/pruefbericht`).catch(() => null), b = r?.aktuell;
    box.hidden = false;
    if (!b) { box.innerHTML = `<div class="chead" style="margin-bottom:6px"><div><h2 style="font-size:18px">Prüfbericht</h2><p>Von Claude, vor jedem neuen Stand</p></div></div>
        <p class="hint" style="margin:0">Noch kein Bericht. Claude prüft die Website selbst in allen Größen und legt den Bericht vor dem Hochladen in den Projektordner – die Brücke bringt ihn hierher. Du kannst Claude auch direkt sagen: <b>„Prüfe die Website in allen Größen und schreib den Prüfbericht.“</b></p>`; return; }
    const offen = (b.funde || []).filter(f => f.status === "offen"), behoben = (b.funde || []).filter(f => f.status === "behoben");
    const fund = f => `<li class="pb__f pb__f--${f.schwere}"><span class="pb__s">${SCHW[f.schwere] || f.schwere}</span><span><b>${esc(f.titel)}</b><small>${[f.seite, f.geraet].filter(Boolean).map(esc).join(" · ")}</small></span></li>`;
    const kacheln = ZAHLEN.filter(([k]) => b.zahlen?.[k] != null).map(([k, l]) => `<div class="pb__z ${k === "offen" && b.zahlen[k] ? "pb__z--offen" : ""}"><b>${n(b.zahlen[k])}</b><small>${l}</small></div>`).join("");
    const kosten = [["Claude (Bericht)", b.kiKosten]].concat(r.pruefKosten != null ? [["KI im Board (Projekt gesamt)", { betrag: r.pruefKosten, waehrung: "USD" }]] : []).filter(([, k]) => k);
    const geld = k => Number(k.betrag).toLocaleString("de-DE", { style: "currency", currency: k.waehrung || "USD" });
    const auf = (() => { try { return sessionStorage.getItem("pb-auf") === "1"; } catch { return false; } })();
    box.innerHTML = `<details class="pb__auf" ${auf ? "open" : ""}><summary class="pb__sum"><span class="pb__sumt"><b>Prüfbericht von Claude</b><small>${b.version ? `Version ${b.version} · ` : ""}${ago(b.created_at)}${kosten.length ? ` · KI-Kosten ${kosten.map(([, k]) => geld(k)).join(" + ")}` : ""}</small></span>
        ${pbKurz(b).replace("pb__kurz", "pb__kurz pb__kurz--kopf")}<svg class="pb__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="pb__body">
      ${kacheln ? `<div class="pb__zahlen">${kacheln}</div>` : ""}
      ${kosten.length ? `<p class="pb__kosten">KI-Kosten: ${kosten.map(([l, k]) => `${l} <b>${geld(k)}</b>${k.hinweis ? ` <small>(${esc(k.hinweis)})</small>` : ""}`).join(" · ")}${r.frueher?.length ? ` · ${r.frueher.length} frühere Berichte` : ""}</p>` : ""}
      ${b.zusammenfassung ? `<p class="pb__text">${esc(b.zusammenfassung)}</p>` : ""}
      ${b.geprueft?.length ? `<div class="pb__chips">${b.geprueft.map(g => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
      ${offen.length ? `<p class="pb__h">Offen <em>${offen.length}</em></p><ul class="pb__l">${offen.map(fund).join("")}</ul>` : ""}
      ${behoben.length ? weitere(behoben.length, `<ul class="pb__l pb__l--ok">${behoben.map(fund).join("")}</ul>`, ["behobener Fund", "behobene Funde"]) : ""}</div></details>`;
    box.querySelector("details").addEventListener("toggle", e => { try { sessionStorage.setItem("pb-auf", e.target.open ? "1" : "0"); } catch {} });
  }
  window.STAND = { projectCard, workspace, freigabe, pruefbericht };
})();
