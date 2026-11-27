/* Board – Chats mit Kunden, je Projekt ein eigener Chat (aufgebaut wie ein Messenger).
   Links die Kunden mit Portal, rechts der gewählte Chat. Hat ein Kunde mehrere Chats (mehrere Projekte und/oder „Allgemein“),
   klappt seine Zeile auf und zeigt je Projekt eine Unterzeile.
   Dieselbe Chat-Fläche steckt auch in der Kundenakte (Reiter „Nachrichten“, mit Auswahl des Chats) und als Karte „Nachrichten“ auf der Projektseite.
   Adressen: #chats · #chats/<Kunde> · #chats/<Kunde>/<Projekt-Nr. oder allgemein>
   Nutzt $, $$, esc, api, toast, bereichTag, projektHref aus admin.js und window.RSChat (portal/chat.js). */
(() => {
  const C = window.RSChat;
  const thKey = t => t.key ?? (t.project_id == null ? "allgemein" : String(t.project_id));
  const THEMA = `<span class="wa__thema">Thema</span>`;
  const initials = n => String(n || "").replace(/\b(Dr|Prof|GmbH|AG|KG|UG|e\.V)\b\.?/g, "").split(/[\s&+\-–]+/).filter(w => /^[A-Za-zÄÖÜäöü0-9]/.test(w)).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  const CHEV = `<svg class="wa__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const EMPTY = `<b>Noch keine Nachrichten.</b>Schreiben Sie dem Kunden eine erste Nachricht – er sieht sie sofort im Kundenportal.`;
  const statusText = s => s === "aktiv" ? "sieht Ihre Antwort sofort im Kundenportal" : s === "eingeladen" ? "eingeladen – liest Nachrichten nach dem ersten Login" : "Portalzugang noch nicht aktiv – liest Nachrichten nach dem ersten Login";
  // Zeit wie im Messenger: heute die Uhrzeit, gestern „Gestern“, in dieser Woche der Wochentag, sonst das Datum
  function kurzZeit(s) {
    if (!s) return "";
    const k = C.dayKey(s);
    if (k === C.dayKey(new Date().toISOString())) return C.fmt(s, { hour: "2-digit", minute: "2-digit" });
    if (k === C.dayKey(new Date(Date.now() - 864e5).toISOString())) return "Gestern";
    if (Date.now() - C.toDate(s).getTime() < 6 * 864e5) return C.fmt(s, { weekday: "short" });
    return C.fmt(s, { day: "numeric", month: "short" });
  }
  const vorschau = t => t.last_body ? `${t.last_sender === "team" ? "Sie: " : ""}${esc(t.last_body)}` : `<i>Noch keine Nachrichten</i>`;

  /* ---------- Chat-Fläche (Verlauf + Eingabe) für einen Kunden und einen Faden ----------
     o: { cid, th, kopf (HTML), mini, limit, placeholder, empty, onRead, onSent } */
  async function pane(host, o) {
    host.innerHTML = `<section class="chat ${o.mini ? "chat--mini" : ""}">${o.kopf || ""}<div class="chat__log" aria-live="polite"></div>
      <form class="composer"><textarea rows="1" placeholder="${esc(o.placeholder || "Nachricht …")}" aria-label="Nachricht"></textarea><button type="submit" aria-label="Senden">${SEND}</button></form></section>`;
    const log = $(".chat__log", host), basis = `/chats/${o.cid}/${encodeURIComponent(o.th)}/messages`, q = `${basis}?after=`;
    let msgs = [], stopFn = null, alive = true;
    const weg = () => !alive || !log.isConnected || !!host.closest("[hidden]");
    const draw = () => C.render(log, o.limit ? msgs.slice(-o.limit) : msgs, "team", o.empty || EMPTY);
    function stop() { alive = false; stopFn?.(); }
    async function tick(full) {
      if (weg()) return stop();
      const after = full || !msgs.length ? 0 : msgs[msgs.length - 1].id;
      const fresh = await api(q + after); if (weg()) return;
      if (!after) { msgs = fresh; draw(); }
      else if (fresh.length) { msgs = msgs.concat(fresh); if (fresh.some(m => m.art === "antwort")) msgs = await api(q + 0); draw(); }   // neue Antwort: Rückfragen-Karte auffrischen
      else if (msgs.some(m => m.sender === "team" && !m.read)) { msgs = await api(q + 0); draw(); }                                      // „gelesen“ nachziehen
      if (!after || fresh.some(m => m.sender === "client")) o.onRead?.();
    }
    C.composer($("form", host), async text => {
      const m = await api(basis, { method: "POST", body: { body: text } }).catch(err => { toast(err.message); throw err; });
      if (!msgs.some(x => x.id === m.id)) msgs.push(m);
      log.dataset.scrolled = ""; draw(); o.onSent?.(m);
    });
    await tick(true);
    if (alive) stopFn = C.poll(() => tick(false));
    return { stop, reload: () => tick(true), focus: () => $("textarea", host)?.focus() };
  }
  const kopfHtml = ({ av, titel, sub, link, back, tn }) => `<div class="chat__head wa__head">
      ${back ? `<button type="button" class="wa__back" data-wa-back aria-label="Zurück zur Liste">‹ Zurück</button>` : ""}
      <span class="avatar">${esc(av)}</span><div class="wa__hm"><h2>${titel}</h2><p>${sub}</p></div>
      ${tn || ""}
      ${link ? `<a class="btn btn--ghost btn--sm wa__link" href="${link[0]}">${esc(link[1])}</a>` : ""}</div>`;
  /* Teilnehmer aus dem Team: kleine Gesichter, „Beitreten“ (wenn man noch nicht drin ist) und „+ Einladen“ */
  const tnHtml = t => `<div class="wa__tn" aria-label="Im Chat">
      <span class="wa__tnav">${(t.teilnehmer || []).slice(0, 4).map(x => `<span class="avatar avatar--xs" title="${esc(x.name)} · ${esc(x.rolle)}">${esc(initials(x.name))}</span>`).join("")}${(t.teilnehmer || []).length > 4 ? `<span class="avatar avatar--xs">+${t.teilnehmer.length - 4}</span>` : ""}</span>
      ${t.ich_dabei === false ? `<button type="button" class="btn btn--grad btn--sm" data-wa-join>Beitreten</button>` : ""}
      <button type="button" class="btn btn--ghost btn--sm" data-wa-invite title="Kollegen zum Chat hinzufügen">+ Einladen</button></div>`;
  const tnText = t => (t.teilnehmer || []).length ? `Im Chat: ${t.teilnehmer.map(x => `${esc(x.name)} (${esc(x.rolle)})`).join(", ")}` : "Noch niemand aus dem Team im Chat";

  /* ---------- Ansicht „Chats“ ---------- */
  const L = { list: [], cid: null, th: null, open: new Set(), q: "", pane: null, stopList: null };
  const app = () => $("#chatsApp");
  function geruest() {
    if ($("#waList")) return;
    app().innerHTML = `
      <aside class="wa__side" aria-label="Chats">
        <div class="wa__top"><div><p class="kicker">Chats</p><h1>Nachrichten</h1></div><button type="button" class="btn btn--grad btn--sm" data-wa-neu>+ Neuer Chat</button></div>
        <input type="search" class="wa__such" id="waSuch" placeholder="Kunde oder Projekt suchen …" autocomplete="off" aria-label="Chats durchsuchen">
        <div class="wa__list" id="waList"></div>
      </aside>
      <div class="wa__main" id="waMain"></div>`;
    $("#waSuch").addEventListener("input", e => { L.q = e.target.value; renderList(); });
    app().addEventListener("click", e => {
      if (e.target.closest("[data-wa-back]")) { zurueck(); return; }
      if (e.target.closest("[data-wa-neu]")) { neuerChat().catch(err => toast(err.message)); return; }
      if (e.target.closest("[data-wa-join]")) { teilnehmen(null).catch(err => toast(err.message)); return; }
      if (e.target.closest("[data-wa-invite]")) { einladen().catch(err => toast(err.message)); return; }
      const b = e.target.closest(".wa__c, .wa__t"); if (!b) return;
      const cid = +b.dataset.cid;
      if (b.hasAttribute("data-multi")) { L.open.has(cid) ? L.open.delete(cid) : L.open.add(cid); renderList(); return; }
      openThread(cid, b.dataset.th).catch(err => toast(err.message));
    });
  }
  const leer = (t, s) => `<div class="wa__nichts"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><b>${t}</b><span>${s}</span></div>`;
  function zurueck() {
    L.pane?.stop(); L.pane = null; L.cid = null; L.th = null;
    app().classList.remove("is-open"); history.replaceState(null, "", "#chats");
    $("#waMain").innerHTML = leer("Wählen Sie einen Chat", "Links stehen alle Kunden mit Kundenportal – je Projekt ein eigener Chat.");
    renderList();
  }
  function renderList() {
    const box = $("#waList"); if (!box) return;
    const q = L.q.trim().toLowerCase();
    const passt = c => !q || `${c.company} ${c.name} ${c.threads.map(t => t.title).join(" ")}`.toLowerCase().includes(q);
    const list = L.list.filter(passt);
    box.innerHTML = list.length ? list.map(c => {
      const multi = c.threads.length > 1, auf = multi && (L.open.has(c.id) || (q && c.threads.some(t => t.title.toLowerCase().includes(q))));
      const eins = c.threads[0], on = !multi && L.cid === c.id;
      const zeile = `<button type="button" class="wa__c ${on ? "on" : ""} ${c.unread ? "wa__c--neu" : ""} ${c.stage === "archiv" ? "wa__c--zu" : ""}" data-cid="${c.id}" ${multi ? `data-multi aria-expanded="${auf}"` : `data-th="${thKey(eins)}"`}>
          <span class="avatar">${esc(initials(c.company))}</span>
          <span class="wa__m"><span class="wa__r1"><b>${esc(c.company)}</b><span class="wa__wer">${esc(c.name)}</span><time>${kurzZeit(c.last_at)}</time></span>
            <span class="wa__r2"><small>${multi ? `${c.threads.length} Chats · ` : ""}${vorschau(c)}</small>${c.unread ? `<em class="wa__n">${c.unread}</em>` : ""}${multi ? CHEV : ""}</span></span></button>`;
      const unter = auf ? `<div class="wa__subs">${c.threads.map(t => `<button type="button" class="wa__t ${L.cid === c.id && L.th === thKey(t) ? "on" : ""} ${t.status === "abgeschlossen" ? "wa__t--zu" : ""}" data-cid="${c.id}" data-th="${thKey(t)}">
          <span class="wa__r1"><b>${esc(t.title)}</b>${t.thema ? THEMA : t.project_id ? bereichTag(t) : ""}${t.status === "abgeschlossen" ? `<span class="wa__fertig">abgeschlossen</span>` : ""}<time>${kurzZeit(t.last_at)}</time></span>
          <span class="wa__r2"><small>${vorschau(t)}</small>${t.unread ? `<em class="wa__n">${t.unread}</em>` : ""}</span></button>`).join("")}</div>` : "";
      return `<div class="wa__g ${auf ? "is-auf" : ""}">${zeile}${unter}</div>`;
    }).join("") : `<div class="wa__leer">${q ? "Kein Chat gefunden." : "Noch keine Kunden mit Kundenportal. Sobald ein Kunde Zugang hat, steht sein Chat hier."}</div>`;
  }
  async function refreshList() {
    if (!app() || app().closest("[hidden]")) { L.stopList?.(); L.stopList = null; return; }
    L.list = await api("/chats"); renderList();
  }
  // Gelesen: Zähler des Fadens und des Kunden sofort auf null, Menü-Zähler nachziehen
  function gelesen(cid, th) {
    const c = L.list.find(x => x.id === cid), t = c?.threads.find(x => thKey(x) === th);
    if (t && t.unread) { t.unread = 0; c.unread = c.threads.reduce((s, x) => s + x.unread, 0); renderList(); }
    window.updateBadges?.();
  }
  async function openThread(cid, th) {
    const c = L.list.find(x => x.id === cid);
    if (!c) { $("#waMain").innerHTML = leer("Diesen Chat gibt es nicht (mehr)", "Vielleicht ist der Kunde archiviert oder Ihnen nicht zugewiesen."); app().classList.add("is-open"); return; }
    if (!th || !c.threads.some(t => thKey(t) === th)) th = thKey(c.threads.find(t => t.unread) || c.threads[0]);
    const t = c.threads.find(x => thKey(x) === th);
    L.cid = cid; L.th = th; if (c.threads.length > 1) L.open.add(cid);
    history.replaceState(null, "", `#chats/${cid}/${th}`);
    app().classList.add("is-open"); renderList();
    L.pane?.stop();
    const proj = t.project_id && !t.thema ? { id: t.project_id, bereich: t.bereich } : null;
    L.pane = await pane($("#waMain"), { cid, th,
      kopf: kopfHtml({ av: initials(c.company), back: true, titel: `${esc(c.company)}${proj || t.thema ? ` · ${esc(t.title)}` : c.threads.length > 1 ? " · Allgemein" : ""}`,
        sub: `${esc(c.name)} · ${statusText(c.status)}<br><span class="wa__tntext">${tnText(t)}</span>`, tn: tnHtml(t), link: proj ? [projektHref(proj), "Projekt öffnen"] : [`#kunden/${cid}`, "Kundenakte"] }),
      placeholder: `Antwort an ${c.name}${proj ? ` zu „${t.title}“` : ""} …`,
      onRead: () => gelesen(cid, th), onSent: () => refreshList().catch(() => {}) });
    if (matchMedia("(min-width:761px)").matches) L.pane.focus();
  }
  /* ---------- Neuer Chat, Beitreten, Einladen ---------- */
  function dialog(html, onSave, ok = "Senden") {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card bmodal wa__dlg" style="width:min(560px,100%);max-height:90vh;overflow:auto;display:grid;gap:14px">${html}<p class="err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button>${onSave ? `<button class="btn btn--grad" type="submit">${esc(ok)}</button>` : ""}</div></form>`;
    document.body.appendChild(m);
    const f = $("form", m), zu = () => m.remove();
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) zu(); });
    f.addEventListener("submit", async e => { e.preventDefault(); const k = $("[type=submit]", f); if (k) k.disabled = true;
      try { if (onSave) await onSave(f); zu(); } catch (err) { const p = $(".err", f); p.textContent = err.message; p.hidden = false; if (k) k.disabled = false; } });
    return { f, zu };
  }
  async function neuerChat() {
    const kunden = await api("/chats/kunden");
    if (!kunden.length) return toast("Es gibt noch keine Kunden.");
    const opt = k => `<option value="${k.id}">${esc(k.company)}${k.name && k.name !== k.company ? ` – ${esc(k.name)}` : ""}${k.zugang ? "" : " (noch ohne Portal)"}</option>`;
    const { f } = dialog(`<h2 style="margin:0">Neuer Chat</h2>
      <p class="hint" style="margin:-8px 0 0">Schreiben Sie einem Kunden – zu einem Projekt, allgemein oder zu einem eigenen Thema (z. B. „Rechnung März“).</p>
      <label>Kunde<input type="search" name="such" placeholder="Firma oder Name suchen …" autocomplete="off"><select name="cid" size="5" required class="wa__kwahl">${kunden.map(opt).join("")}</select></label>
      <label>Worum geht es?<select name="ziel"></select></label>
      <label data-titel hidden>Thema<input name="titel" maxlength="120" placeholder="z. B. Offene Rechnung 2026-014"></label>
      <p class="hint" data-zugang hidden style="margin:-4px 0 0"></p>
      <label>Nachricht<textarea name="body" rows="4" required placeholder="Hallo …"></textarea></label>`,
      async f => {
        const cid = +f.cid.value; if (!cid) throw new Error("Bitte einen Kunden auswählen.");
        const z = f.ziel.value, body = { body: f.body.value, project_id: /^\d+$/.test(z) ? +z : null, titel: z === "thema" ? f.titel.value.trim() : "" };
        if (z === "thema" && !body.titel) throw new Error("Bitte ein Thema angeben.");
        const r = await api(`/chats/${cid}/neu`, { method: "POST", body });
        L.list = await api("/chats"); await openThread(cid, r.key);
      });
    const zielFuellen = () => {
      const k = kunden.find(x => x.id === +f.cid.value); if (!k) return;
      f.ziel.innerHTML = k.projekte.map(p => `<option value="${p.id}">Projekt: ${esc(p.title)}</option>`).join("") + `<option value="allgemein">Allgemein</option><option value="thema">Eigenes Thema …</option>`;
      $("[data-titel]", f).hidden = f.ziel.value !== "thema";
      const z = $("[data-zugang]", f); z.hidden = k.zugang; z.textContent = k.zugang ? "" : `${k.name || k.company} hat noch keinen Zugang zum Kundenportal und liest die Nachricht erst nach dem ersten Login. Den Zugang schicken Sie über die Kundenakte.`;
    };
    f.cid.addEventListener("change", zielFuellen);
    f.ziel.addEventListener("change", () => { $("[data-titel]", f).hidden = f.ziel.value !== "thema"; if (f.ziel.value === "thema") f.titel.focus(); });
    f.such.addEventListener("input", () => {
      const q = f.such.value.trim().toLowerCase(), treffer = kunden.filter(k => `${k.company} ${k.name} ${k.email}`.toLowerCase().includes(q));
      f.cid.innerHTML = treffer.map(opt).join(""); if (treffer.length) { f.cid.value = treffer[0].id; zielFuellen(); }
    });
    if (L.cid && kunden.some(k => k.id === L.cid)) f.cid.value = L.cid; else f.cid.selectedIndex = 0;
    zielFuellen(); f.such.focus();
  }
  async function teilnehmen(userId) {
    if (!L.cid || !L.th) return;
    await api(`/chats/${L.cid}/${encodeURIComponent(L.th)}/teilnehmer`, { method: "POST", body: userId ? { user_id: userId } : {} });
    toast(userId ? "Hinzugefügt – die Person sieht den Chat jetzt." : "Sie sind jetzt im Chat.");
    L.list = await api("/chats"); await openThread(L.cid, L.th);
  }
  async function einladen() {
    const team = await api("/chats/team"), c = L.list.find(x => x.id === L.cid), t = c?.threads.find(x => thKey(x) === L.th);
    const drin = new Set((t?.teilnehmer || []).map(x => x.id)), frei = team.filter(u => !drin.has(u.id));
    const { f, zu } = dialog(`<h2 style="margin:0">Zum Chat einladen</h2>
      <p class="hint" style="margin:-8px 0 0">Wer hinzukommt, sieht den ganzen Verlauf dieses Chats und kann mitschreiben. Der Kunde sieht, wer im Chat ist.</p>
      ${frei.length ? `<div class="wa__team">${frei.map(u => `<button type="button" class="wa__tm" data-uid="${u.id}"><span class="avatar">${esc(initials(u.name))}</span><span><b>${esc(u.name)}${u.ich ? " (Sie)" : ""}</b><small>${esc(u.rolle)}</small></span><span class="wa__tmplus">+ Hinzufügen</span></button>`).join("")}</div>`
        : `<p class="hint">Alle aus dem Team sind schon im Chat. Neue Kolleginnen und Kollegen legen Sie unter „Team“ an.</p>`}
      <p class="hint" style="margin:0">Weitere Ansprechpartner des Kunden (z. B. Geschäftsführung und Marketing) kommen im nächsten Schritt dazu.</p>`, null);
    f.addEventListener("click", e => { const b = e.target.closest("[data-uid]"); if (!b) return; b.disabled = true; teilnehmen(+b.dataset.uid).then(zu).catch(err => { toast(err.message); b.disabled = false; }); });
  }

  async function load() {
    geruest();
    const [, hc, hth] = location.hash.slice(1).split("/");
    L.list = await api("/chats");
    if (hc) await openThread(+hc, hth || null);
    else { L.pane?.stop(); L.pane = null; L.cid = null; app().classList.remove("is-open");
      $("#waMain").innerHTML = leer("Wählen Sie einen Chat", "Links stehen alle Kunden mit Kundenportal – je Projekt ein eigener Chat.");
      renderList(); }
    L.stopList?.(); L.stopList = C.poll(refreshList, 8000);
  }

  /* ---------- Kundenakte, Reiter „Nachrichten“: Auswahl des Chats + derselbe Verlauf ---------- */
  async function kundenTab(host, client) {
    const threads = await api(`/clients/${client.id}/threads`);
    let th = thKey(threads.find(t => t.unread) || threads[0] || { project_id: null }), p = null;
    host.innerHTML = `<div class="kchat"><div class="kchat__bar"><div class="thchips" id="kThreads" role="tablist" aria-label="Chat auswählen"></div><a class="btn btn--ghost btn--sm" id="kChatOpen" href="#chats/${client.id}/${th}">In „Chats“ öffnen</a></div><div id="kChatPane"></div></div>`;
    const chips = () => { $("#kThreads").innerHTML = threads.map(t => `<button type="button" role="tab" class="thchip ${thKey(t) === th ? "on" : ""} ${t.status === "abgeschlossen" ? "thchip--zu" : ""}" data-th="${thKey(t)}" aria-selected="${thKey(t) === th}"><span>${esc(t.title)}</span>${t.unread && thKey(t) !== th ? `<em>${t.unread}</em>` : ""}</button>`).join("");
      $("#kThreads").hidden = threads.length < 2; $("#kChatOpen").href = `#chats/${client.id}/${th}`; };
    const oeffnen = async () => {
      p?.stop(); chips();
      const t = threads.find(x => thKey(x) === th);
      p = await pane($("#kChatPane"), { cid: client.id, th,
        kopf: kopfHtml({ av: initials(client.company), titel: `Chat mit ${esc(client.name)}${t?.project_id ? ` · ${esc(t.title)}` : threads.length > 1 ? " · Allgemein" : ""}`, sub: statusText(client.status),
          link: t?.project_id ? [projektHref({ id: t.project_id, bereich: t.bereich }), "Projekt öffnen"] : null }),
        placeholder: `Antwort an ${client.name} …`, onRead: () => { if (t) t.unread = 0; window.updateBadges?.(); } });
    };
    $("#kThreads").addEventListener("click", e => { const b = e.target.closest("[data-th]"); if (!b || b.dataset.th === th) return; th = b.dataset.th; oeffnen().catch(err => toast(err.message)); });
    await oeffnen();
  }

  /* ---------- Projektseite: Karte „Nachrichten“ mit den letzten Nachrichten dieses Projekts ---------- */
  async function projektKarte(p, client) {
    const box = $("#pChat"); if (!box) return;
    if (!client || (client.stage !== "mandant" && client.status !== "aktiv")) { box.hidden = true; return; }   // Interessenten ohne Portalzugang haben keinen Chat
    box.hidden = false;
    /* Kompakt: eine Zeile mit letzter Nachricht und Zähler. Aufgeklappt wird der Verlauf (feste, kleine Höhe).
       Bei ungelesenen Kundennachrichten ist sie hervorgehoben; gelesen wird erst beim Aufklappen. */
    const th = (await api(`/clients/${client.id}/threads`).catch(() => [])).find(t => thKey(t) === String(p.id)) || {};
    const neu = th.unread || 0, auf = sessionStorage.getItem("pchat-auf") === "1";
    box.classList.add("pchat"); box.classList.toggle("pchat--neu", !!neu);
    box.innerHTML = `<button type="button" class="pchat__zeile" aria-expanded="${auf}">
        <span class="pchat__ic">${neu ? `<em>${neu}</em>` : ""}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
        <span class="pchat__t"><b>Nachrichten${neu ? ` · ${neu === 1 ? "1 neue" : `${neu} neue`}` : ""}</b><small>${th.last_body ? `${th.last_sender === "team" ? "Sie: " : `${esc(client.name)}: `}${esc(th.last_body)}` : `Chat mit ${esc(client.name)} zu diesem Projekt`}</small></span>
        <time>${kurzZeit(th.last_at)}</time>${CHEV}</button>
      <div class="pchat__body" ${auf ? "" : "hidden"}><div class="pchat__pane"></div><a class="link pchat__voll" href="#chats/${client.id}/${p.id}">Im großen Chat öffnen →</a></div>`;
    let geladen = false;
    const laden = () => { if (geladen) return; geladen = true;
      pane($(".pchat__pane", box), { cid: client.id, th: String(p.id), mini: true, limit: 4, placeholder: `Nachricht an ${client.name} …`,
        empty: `<b>Noch keine Nachrichten zu diesem Projekt.</b>Was Sie hier schreiben, sieht ${esc(client.name)} im Kundenportal im Chat zu „${esc(p.title)}“.`,
        onRead: () => { box.classList.remove("pchat--neu"); $(".pchat__ic em", box)?.remove(); window.updateBadges?.(); } }).catch(err => toast(err.message)); };
    $(".pchat__zeile", box).addEventListener("click", e => {
      const z = e.currentTarget, offen = z.getAttribute("aria-expanded") !== "true";
      z.setAttribute("aria-expanded", offen); $(".pchat__body", box).hidden = !offen;
      try { sessionStorage.setItem("pchat-auf", offen ? "1" : "0"); } catch {}
      if (offen) laden();
    });
    if (auf) laden();
  }

  window.CHATS = { load, kundenTab, projektKarte, pane };
})();
