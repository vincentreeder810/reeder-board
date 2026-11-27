/* Chat + Prototyp-Viewer – gemeinsam für Kundenportal und Admin-Board */
(() => {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TZ = "Europe/Berlin";
  const toDate = s => new Date(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z");
  const fmt = (s, o) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, ...o }).format(toDate(s));
  const dayKey = s => fmt(s, { year: "numeric", month: "2-digit", day: "2-digit" });
  function dayLabel(s) {
    const k = dayKey(s), now = new Date().toISOString();
    if (k === dayKey(now)) return "Heute";
    if (k === dayKey(new Date(Date.now() - 86400000).toISOString())) return "Gestern";
    return fmt(s, { weekday: "long", day: "numeric", month: "long" });
  }
  // Text sicher darstellen, Links klickbar machen
  const linkify = t => esc(t).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const size = b => b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2.5"/><path d="M3 8h18M8 21h8M12 18v3"/></svg>`;

  const protoData = p => ({ id: p.id, title: p.title, url: p.url, base: p.base, entry: p.entry, version: p.version || 1, created_at: p.created_at });
  function protoCard(p, gone) {
    if (!p) return `<div class="proto proto--gone"><div class="proto__thumb">${ICON}</div><div><b>Prototyp</b><span>nicht mehr verfügbar</span></div></div>`;
    return `<button class="proto" data-proto='${esc(JSON.stringify(protoData(p)))}'>
      <div class="proto__thumb">${ICON}</div><div><b>${esc(p.title)}${p.version > 1 ? ` <em class="vtag">V${p.version}</em>` : ""}</b><span>Prototyp öffnen · zum Durchklicken</span></div></button>`;
  }

  /* ---------- Sonderkarten: Rückfragen und Antworten ----------
     Rückfragen (art = 'rueckfragen'): jede Frage als eigene Zeile mit Stand; im Kundenportal mit „Jetzt beantworten“.
     Antwort (art = 'antwort'): kleine Karte „Frage → Antwort“. */
  const absatz = t => esc(t).replace(/\n/g, "<br>");
  const FRAGE_IC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.8 9.4a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.3"/><path d="M12 16.6h.01"/></svg>`;
  const ST = { offen: ["offen", "wartet auf Antwort"], beantwortet: ["beantwortet", "beantwortet"], erledigt: ["geklärt", "inzwischen geklärt"] };
  function rueckfragenCard(m, me) {
    const fr = m.meta.fragen, offen = fr.filter(f => f.status === "offen").length, kunde = me === "client";
    const unter = offen ? (kunde ? `${offen === 1 ? "Eine Frage wartet" : `${offen} Fragen warten`} auf Ihre Antwort. Tippen Sie bei einer Frage auf „Antworten“ und schreiben Sie unten ganz normal.` : `${offen} von ${fr.length} offen · der Kunde antwortet im Chat auf jede Frage einzeln`)
      : (kunde ? "Vielen Dank – alles beantwortet." : "Alle Fragen sind beantwortet oder geklärt.");
    // Im Kundenportal hat jede offene Frage „Antworten“: setzt die Frage als Zitat über das Eingabefeld – geantwortet wird im normalen Chat
    return `<div class="rqk">
      <div class="rqk__h"><span class="rqk__ic">${FRAGE_IC}</span><div><b>Rückfragen zu Ihrem Projekt</b><small>${unter}</small></div></div>
      <ol class="rqk__l">${fr.map((f, i) => `<li class="rqk__f rqk__f--${f.status}"><p>${absatz(f.text)}</p>${f.status === "offen" && kunde
        ? `<button type="button" class="rqk__ant" data-antworten="${esc(f.id)}" data-frage="${esc(f.text)}" data-nr="${i + 1}">↩ Antworten</button>`
        : `<span class="rqk__st">${(ST[f.status] || ST.offen)[kunde ? 0 : 1]}</span>`}${f.status === "beantwortet" && f.antwort ? `<p class="rqk__a">${absatz(f.antwort)}</p>` : ""}</li>`).join("")}</ol></div>`;
  }
  // Antwort auf eine Rückfrage: ganz normale Chat-Blase mit der Frage als Zitat darüber (wie „Antworten“ bei WhatsApp)
  const antwortCard = m => `<div class="msg__bubble msg__bubble--zitat"><span class="msg__zitat"><small>Rückfrage</small>${absatz(m.meta.frage || "")}</span>${linkify(m.meta.antwort || "").replace(/\n/g, "<br>")}</div>`;
  function inhalt(m, me) {
    if (m.art === "rueckfragen" && m.meta?.fragen?.length) return rueckfragenCard(m, me);
    if (m.art === "antwort" && m.meta?.frage) return antwortCard(m);
    return `<div class="msg__bubble">${linkify(m.body)}</div>`;
  }

  /** Chat-Verlauf in ein Element rendern. me = "client" | "team" (eigene Nachrichten rechts) */
  function render(log, msgs, me, emptyHtml) {
    if (!msgs.length) { log.innerHTML = `<div class="chat__empty">${emptyHtml}</div>`; return; }
    let html = "", lastDay = "", lastSender = "", lastTime = 0;
    for (const m of msgs) {
      const d = dayKey(m.created_at), t = toDate(m.created_at).getTime();
      if (d !== lastDay) { html += `<div class="chat__day">${dayLabel(m.created_at)}</div>`; lastDay = d; lastSender = ""; }
      const same = m.sender === lastSender && t - lastTime < 5 * 60000;
      const mine = m.sender === me;
      const who = m.sender === "team" ? `${esc(m.author)} · Reeder Software` : esc(m.author);
      html += `<div class="msg ${mine ? "msg--mine" : "msg--theirs"} msg--${m.sender} ${same ? "msg--same" : ""} ${m.art === "rueckfragen" ? "msg--karte" : ""}">
        <span class="msg__who">${who}</span>
        ${inhalt(m, me)}
        ${m.has_prototype ? protoCard(m.prototype) : ""}
        <span class="msg__meta">${fmt(m.created_at, { hour: "2-digit", minute: "2-digit" })}${mine && m.read ? " · gelesen" : ""}</span></div>`;
      lastSender = m.sender; lastTime = t;
    }
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    log.innerHTML = html;
    if (nearBottom || !log.dataset.scrolled) { log.scrollTop = log.scrollHeight; log.dataset.scrolled = "1"; }
  }

  // Klick auf eine Prototyp-Karte öffnet den Viewer (portal/viewer.js)
  document.addEventListener("click", e => {
    const p = e.target.closest("[data-proto]"); if (!p) return;
    e.preventDefault(); window.RSViewer?.open(JSON.parse(p.dataset.proto));
  });

  /* ---------- Eingabefeld ---------- */
  function composer(form, onSend) {
    const ta = form.querySelector("textarea"), btn = form.querySelector("button");
    const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 3) + "px"; ta.style.overflowY = ta.scrollHeight > 160 ? "auto" : "hidden"; btn.disabled = !ta.value.trim(); };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async e => {
      e.preventDefault(); const text = ta.value.trim(); if (!text) return;
      btn.disabled = true;
      try { await onSend(text); ta.value = ""; } finally { fit(); ta.focus(); }
    });
    fit();
  }

  /** Regelmäßig nachladen, solange der Tab sichtbar ist */
  function poll(fn, ms = 4000) {
    let h = null, stopped = false;
    const tick = async () => { if (stopped) return; if (!document.hidden) { try { await fn(); } catch {} } h = setTimeout(tick, ms); };
    const vis = () => { if (!document.hidden && !stopped) { clearTimeout(h); tick(); } };
    document.addEventListener("visibilitychange", vis);
    h = setTimeout(tick, ms);
    return () => { stopped = true; clearTimeout(h); document.removeEventListener("visibilitychange", vis); };
  }

  window.RSChat = { esc, fmt, size, render, composer, poll, protoCard, protoData, ICON, toDate, dayLabel, dayKey };
})();
