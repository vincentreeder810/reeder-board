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
        <label class="check span2"><input type="checkbox" name="announce" checked> Kunden im Chat und per Neuigkeiten-Mail benachrichtigen</label>
        <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Hochladen</button></div>`);
      d.f.addEventListener("submit", async e => { e.preventDefault(); const b = d.f.querySelector("button:not([data-close])"); b.disabled = true; b.textContent = "Wird hochgeladen …";
        try { const r = await api(`/projects/${S.project_id}/stand`, { method: "POST", body: { changes: d.f.changes.value, announce: d.f.announce.checked } });
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
          <label class="check span2"><input type="checkbox" name="announce" checked> Kunden im Chat und per Neuigkeiten-Mail benachrichtigen</label>
          <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Hochladen</button></div>`);
        d.f.addEventListener("submit", async ev => { ev.preventDefault();
          try { await api(`/bruecke/projekt/${pid}/stand`, { method: "POST", body: { changes: d.f.changes.value, announce: d.f.announce.checked } });
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
    const kopf = sub => `<div class="chead" style="margin-bottom:12px"><div><h2 style="font-size:18px">Arbeitsbereich</h2><p>${sub}</p></div>
      <div class="acts">${$('[data-act="openProto"]') ? `<button class="btn btn--ghost btn--sm" data-ws="website">Website ansehen</button><button class="btn btn--grad btn--sm" data-ws="anmerkungen">Website mit Anmerkungen</button>` : ""}</div></div>`;
    if (W.leer) { box.innerHTML = kopf("Stand, Notizen und offene Fragen aus der Arbeit mit Claude") + `<p class="ws__leer">Noch nichts da. Öffne das Projekt unten mit „Mit Claude arbeiten“ und sag Claude am Ende: <b>„Aktualisiere den Arbeitsstand.“</b> Wenige Sekunden später steht hier, wo das Projekt steht, was zuletzt gemacht wurde und welche Fragen an den Kunden offen sind.</p>`; return; }
    const offen = W.fragen.filter(f => f.status === "offen"), klar = W.fragen.filter(f => f.status !== "offen");
    const tag = iso => C.fmt(iso, { day: "numeric", month: "short" });
    box.innerHTML = kopf(`Von Claude aus dem Projektordner · aktualisiert ${ago(W.aktualisiert)} · der Kunde sieht das nicht`) + `
      <div class="ws__zwei"><div class="ws__b"><b>Aktueller Stand</b><p>${W.stand ? absatz(W.stand) : "<i>Noch nicht beschrieben.</i>"}</p></div>
        <div class="ws__b"><b>Letzte Sitzung</b><p>${W.letzteSitzung ? absatz(W.letzteSitzung) : "<i>Noch nichts eingetragen.</i>"}</p></div></div>
      ${W.notizen.length ? `<div class="ws__b"><b>Notizen</b><ul>${W.notizen.map(n => `<li>${absatz(n)}</li>`).join("")}</ul></div>` : ""}
      <div class="ws__b ws__fragen"><b>Offene Fragen an den Kunden${offen.length ? ` <em>${offen.length}</em>` : ""}</b>
        ${offen.length ? offen.map(f => `<label class="ws__f"><input type="checkbox" value="${esc(f.id)}" ${f.gesendet ? "" : "checked"}><span>${absatz(f.text)}${f.gesendet ? `<small>an den Kunden geschickt am ${tag(f.gesendet)}</small>` : ""}</span></label>`).join("")
          + (S?.canEdit ? `<div class="acts" style="margin-top:10px;justify-content:flex-start"><button class="btn btn--grad btn--sm" data-ws="senden">Angekreuzte Fragen an den Kunden senden</button></div>` : "")
          : `<p>Keine offenen Fragen.</p>`}
        ${klar.length ? `<details class="ws__klar"><summary>${klar.length} geklärt</summary>${klar.map(f => `<p><s>${esc(f.text)}</s>${f.antwort ? `<br>→ ${absatz(f.antwort)}` : ""}</p>`).join("")}</details>` : ""}</div>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-ws]"); if (!b) return;
    if (b.dataset.ws === "website" || b.dataset.ws === "anmerkungen") { const k = $('[data-act="openProto"]'); if (!k) return; k.dataset.liste = b.dataset.ws === "website" ? "0" : "1"; k.click(); delete k.dataset.liste; return; }
    const box = $("#pWs"), pid = +box.dataset.pid, ids = $$(".ws__f input:checked", box).map(i => i.value);
    if (!ids.length) return toast("Bitte mindestens eine Frage ankreuzen.");
    const fragen = W.fragen.filter(f => ids.includes(f.id));
    const d = modal(`<h2 class="span2">Fragen an den Kunden senden</h2>
      <p class="hint span2" style="margin:0">Der Kunde bekommt die Fragen als Nachricht im Kundenportal und per E-Mail. Seine Antwort landet im Chat.</p>
      <label class="span2">Einleitung<textarea name="einleitung" rows="2">für Ihr Projekt haben wir noch ${fragen.length === 1 ? "eine Frage" : "ein paar Fragen"}:</textarea></label>
      <div class="span2 ws__vorschau">${fragen.map((f, i) => `<p>${fragen.length > 1 ? `${i + 1}. ` : ""}${absatz(f.text)}</p>`).join("")}</div>
      <div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad">Senden</button></div>`);
    d.f.addEventListener("submit", async ev => { ev.preventDefault(); const k = d.f.querySelector("button:not([data-close])"); k.disabled = true;
      try { const r = await api(`/projects/${pid}/workspace/fragen-senden`, { method: "POST", body: { ids, einleitung: d.f.einleitung.value } });
        d.close(); toast(`${r.anzahl === 1 ? "Frage" : r.anzahl + " Fragen"} gesendet – im Chat des Kunden${r.mailed ? " und per E-Mail" : ""}.`); workspace({ id: pid }); }
      catch (err) { d.fail(err.message); k.disabled = false; } });
  });
  window.STAND = { projectCard, workspace };
})();
