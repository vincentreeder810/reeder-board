/* Board – Chats mit Kunden, je Projekt ein eigener Chat (aufgebaut wie ein Messenger).
   Links die Kunden mit Portal, rechts der gewählte Chat. Hat ein Kunde mehrere Chats (mehrere Projekte und/oder „Allgemein“),
   klappt seine Zeile auf und zeigt je Projekt eine Unterzeile.
   Dieselbe Chat-Fläche steckt auch in der Kundenakte (Reiter „Nachrichten“, mit Auswahl des Chats) und als Karte „Nachrichten“ auf der Projektseite.
   Adressen: #chats · #chats/<Kunde> · #chats/<Kunde>/<Projekt-Nr. oder allgemein>
   Nutzt $, $$, esc, api, toast, bereichTag, projektHref aus admin.js und window.RSChat (portal/chat.js). */
(() => {
  const C = window.RSChat;
  const thKey = t => t.project_id == null ? "allgemein" : String(t.project_id);
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
    const log = $(".chat__log", host), q = `/clients/${o.cid}/messages?thread=${encodeURIComponent(o.th)}&after=`;
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
      const m = await api(`/clients/${o.cid}/messages`, { method: "POST", body: { body: text, project_id: o.th === "allgemein" ? null : +o.th } }).catch(err => { toast(err.message); throw err; });
      if (!msgs.some(x => x.id === m.id)) msgs.push(m);
      log.dataset.scrolled = ""; draw(); o.onSent?.(m);
    });
    await tick(true);
    if (alive) stopFn = C.poll(() => tick(false));
    return { stop, reload: () => tick(true), focus: () => $("textarea", host)?.focus() };
  }
  const kopfHtml = ({ av, titel, sub, link, back }) => `<div class="chat__head wa__head">
      ${back ? `<button type="button" class="wa__back" data-wa-back aria-label="Zurück zur Liste">‹ Zurück</button>` : ""}
      <span class="avatar">${esc(av)}</span><div class="wa__hm"><h2>${titel}</h2><p>${sub}</p></div>
      ${link ? `<a class="btn btn--ghost btn--sm wa__link" href="${link[0]}">${esc(link[1])}</a>` : ""}</div>`;

  /* ---------- Ansicht „Chats“ ---------- */
  const L = { list: [], cid: null, th: null, open: new Set(), q: "", pane: null, stopList: null };
  const app = () => $("#chatsApp");
  function geruest() {
    if ($("#waList")) return;
    app().innerHTML = `
      <aside class="wa__side" aria-label="Chats">
        <div class="wa__top"><div><p class="kicker">Chats</p><h1>Nachrichten</h1></div></div>
        <input type="search" class="wa__such" id="waSuch" placeholder="Kunde oder Projekt suchen …" autocomplete="off" aria-label="Chats durchsuchen">
        <div class="wa__list" id="waList"></div>
      </aside>
      <div class="wa__main" id="waMain"></div>`;
    $("#waSuch").addEventListener("input", e => { L.q = e.target.value; renderList(); });
    app().addEventListener("click", e => {
      if (e.target.closest("[data-wa-back]")) { zurueck(); return; }
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
          <span class="wa__r1"><b>${esc(t.title)}</b>${t.project_id ? bereichTag(t) : ""}${t.status === "abgeschlossen" ? `<span class="wa__fertig">abgeschlossen</span>` : ""}<time>${kurzZeit(t.last_at)}</time></span>
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
    const proj = t.project_id ? { id: t.project_id, bereich: t.bereich } : null;
    L.pane = await pane($("#waMain"), { cid, th,
      kopf: kopfHtml({ av: initials(c.company), back: true, titel: `${esc(c.company)}${proj ? ` · ${esc(t.title)}` : c.threads.length > 1 ? " · Allgemein" : ""}`,
        sub: `${esc(c.name)} · ${statusText(c.status)}`, link: proj ? [projektHref(proj), "Projekt öffnen"] : [`#kunden/${cid}`, "Kundenakte"] }),
      placeholder: `Antwort an ${c.name}${proj ? ` zu „${t.title}“` : ""} …`,
      onRead: () => gelesen(cid, th), onSent: () => refreshList().catch(() => {}) });
    if (matchMedia("(min-width:761px)").matches) L.pane.focus();
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
    box.innerHTML = `<div class="chead" style="margin-bottom:10px"><div><h2 style="font-size:18px">Nachrichten</h2><p>Chat mit ${esc(client.name)} zu diesem Projekt${client.status !== "aktiv" ? " · Portalzugang noch nicht aktiv" : ""}</p></div>
        <div class="acts"><a class="btn btn--ghost btn--sm" href="#chats/${client.id}/${p.id}">Im Chat öffnen</a></div></div><div class="pchat__pane"></div>`;
    await pane($(".pchat__pane", box), { cid: client.id, th: String(p.id), mini: true, limit: 6, placeholder: `Nachricht an ${client.name} …`,
      empty: `<b>Noch keine Nachrichten zu diesem Projekt.</b>Was Sie hier schreiben, sieht ${esc(client.name)} im Kundenportal im Chat zu „${esc(p.title)}“.`,
      onRead: () => window.updateBadges?.() });
  }

  window.CHATS = { load, kundenTab, projektKarte, pane };
})();
