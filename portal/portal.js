/* Reeder Software – Kundenportal */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const { esc, fmt, render, composer, poll, protoCard, protoData, size, ICON } = window.RSChat;
const money = c => c == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(c / 100);
const dateLong = s => fmt(s, { day: "numeric", month: "long", year: "numeric" });
const ymd = s => s ? new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(s + "T00:00:00Z")) : "";
const initials = n => String(n || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 3200); }
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api/portal" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login" && !path.startsWith("/invite")) { show("login"); throw new Error("Bitte anmelden."); }
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}
function show(id) { ["login", "invite", "app"].forEach(x => $("#" + x).hidden = x !== id); document.title = (id === "app" ? "Kundenportal" : "Anmelden") + " · Reeder Software"; }

// Anmerkungen im Viewer: Kunden dürfen eigene, noch offene Anmerkungen löschen
window.RS_VIEWER_API = {
  mode: "client",
  list: id => api(`/prototypes/${id}/annotations`),
  create: (id, body) => api(`/prototypes/${id}/annotations`, { method: "POST", body }),
  patch: (id, body) => api(`/annotations/${id}`, { method: "PATCH", body }),
  remove: id => api(`/annotations/${id}`, { method: "DELETE", body: {} }),
  // KI-Assistent (Baustein H4)
  assistStatus: () => api("/assist/status"),
  assist: (id, body) => api(`/annotations/${id}/assist`, { method: "POST", body }),
  assistGet: id => api(`/annotations/${id}/assist`),
  clarify: (id, index) => api(`/annotations/${id}/assist/clarify`, { method: "POST", body: { index } }),
  choose: (id, variant) => api(`/annotations/${id}/assist/choose`, { method: "POST", body: { variant } }),
  message: (id, text) => api(`/annotations/${id}/assist/message`, { method: "POST", body: { text } }),
  human: () => { location.hash = "#chat"; },
};

/* ---------- Anmeldung & Einladung ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = new FormData(e.target), btn = $("button[type=submit]", e.target);
  btn.disabled = true;
  try {
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Anmeldung fehlgeschlagen");
    $("#loginErr").hidden = true;
    if (d.need2fa) { location.href = "/admin/#code=" + d.challenge; return; }   // Team mit Zwei-Faktor → Code im Board
    if (d.to && d.to !== "/portal/") { location.href = d.to; return; }   // Team → Admin-Board
    start();
  }
  catch (err) { $("#loginErr").textContent = err.message; $("#loginErr").hidden = false; }
  finally { btn.disabled = false; }
});
const inviteToken = (location.hash.match(/einladung=([a-f0-9]{48})/) || [])[1];
async function showInvite() {
  show("invite");
  try {
    const i = await api("/invite/" + inviteToken);
    $("#inviteHello").textContent = `Willkommen, ${i.name.split(" ")[0]}.`;
    $("#inviteSub").textContent = `Ihr Zugang für ${i.company}. Legen Sie Ihr Passwort fest – danach sind Sie direkt angemeldet.`;
    $("#inviteEmail").value = i.email;
  } catch (err) {
    $("#inviteHello").textContent = "Link nicht mehr gültig."; $("#inviteSub").textContent = err.message;
    $$("#inviteForm label, #inviteForm button").forEach(x => x.hidden = true);
  }
}
$("#inviteForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = new FormData(e.target);
  if (f.get("password") !== f.get("password2")) { $("#inviteErr").textContent = "Die beiden Passwörter stimmen nicht überein."; $("#inviteErr").hidden = false; return; }
  try { await api("/invite/" + inviteToken, { method: "POST", body: { password: f.get("password") } }); history.replaceState(null, "", "/portal/#uebersicht"); start(); }
  catch (err) { $("#inviteErr").textContent = err.message; $("#inviteErr").hidden = false; }
});

/* ---------- Start & Navigation ---------- */
let me = null, stopChat = null, stopBadge = null;
async function start() {
  me = await api("/me");
  show("app");
  $("#meAvatar").textContent = initials(me.name); $("#meName").textContent = me.name; $("#meCo").textContent = me.company;
  if (!location.hash || location.hash.includes("einladung")) history.replaceState(null, "", "#uebersicht");
  route();
  stopBadge?.(); stopBadge = poll(refreshBadge, 15000); refreshBadge();
  api("/vertraege").then(l => { $("#navVertraege").hidden = !l.length; }).catch(() => {});
}
async function refreshBadge() {
  const o = await api("/overview"); const b = $("#bChat");
  b.hidden = !o.unread || location.hash === "#chat" || location.hash.startsWith("#chat/"); b.textContent = o.unread;
  api("/support").then(s => { const n = s.list.filter(t => t.unread).length, bs = $("#bSupport"); bs.hidden = !n; bs.textContent = n; }).catch(() => {});
  return o;
}
const VIEWS = { rueckfragen: viewRueckfragen, support: viewSupport, vertraege: viewContracts, angebot: viewQuote, uebersicht: viewOverview, projekte: viewProjects, projekt: viewProject, chat: viewChat, termine: viewAppointments, dokumente: viewDocuments, konto: viewAccount };
function route() {
  if (!me) return;
  const [name, arg] = location.hash.slice(1).split("/");
  const v = VIEWS[name] ? name : "uebersicht";
  const bereich = v === "rueckfragen" ? "uebersicht" : v;   // Rückfragen stehen oben auf der Startseite
  $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== bereich);
  $$(".nav nav a").forEach(a => a.classList.toggle("on", a.dataset.v === bereich || ((v === "projekt" || v === "angebot") && a.dataset.v === "projekte")));
  // Schmale Fenster: Der Menüknopf zeigt, wo man gerade ist; nach der Auswahl klappt das Menü wieder zu
  { const an = $(".nav nav a.on span"), jetzt = $("#navNow"); if (an && jetzt) jetzt.textContent = an.textContent; menuZu(); }
  if (v !== "chat") { stopChat?.(); stopChat = null; }
  scrollTo(0, 0);
  VIEWS[v](arg).catch(err => toast(err.message));
}
addEventListener("hashchange", route);
function menuZu() { $(".nav")?.classList.remove("is-open"); $("#navToggle")?.setAttribute("aria-expanded", "false"); }
$("#navToggle")?.addEventListener("click", e => { e.stopPropagation(); const auf = $(".nav").classList.toggle("is-open"); $("#navToggle").setAttribute("aria-expanded", String(auf)); });
document.addEventListener("click", e => { if (!e.target.closest(".nav nav") || e.target.closest(".nav nav a")) menuZu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") menuZu(); });
// Zähler am Menüknopf: zeigt, ob in Chat oder Support etwas Neues wartet, auch wenn das Menü zu ist
new MutationObserver(() => { const n = ["#bChat", "#bSupport"].map(s => $(s)).filter(b => b && !b.hidden).reduce((s, b) => s + (+b.textContent || 0), 0), m = $("#bMenu"); if (m) { m.hidden = !n; m.textContent = n; } })
  .observe($(".nav nav"), { subtree: true, attributes: true, childList: true, characterData: true });

/* ---------- Bausteine ---------- */
// Vor dem Auftrag zeigt jede Karte denselben Weg in fünf Schritten – egal ob Website, Software oder Hardware.
// Erst mit dem Auftrag kommen die Projektphasen.
const WEG = ["Anfrage", "Fragebogen", "Erstgespräch", "Angebot", "Auftrag"];
function wegBar(i) {
  return `<div class="steps steps--5">${WEG.map((_, k) => `<i class="${k < i ? "done" : k === i ? "now" : ""}"></i>`).join("")}</div>
    <div class="steps__label"><span>Schritt ${i + 1} von ${WEG.length}</span><b>${WEG[i]}</b></div>`;
}
function stepsBar(p) {
  if (p.status === "anfrage") return wegBar(p.fragebogen?.stand === "offen" ? 1 : p.offerOpen ? 3 : 2);   // Fragebogen offen → Schritt 2, sonst Gespräch, mit Angebot Schritt 4
  const i = p.phaseIndex;
  return `<div class="steps">${p.phases.map((_, k) => `<i class="${k < i ? "done" : k === i ? "now" : ""}"></i>`).join("")}</div>
    <div class="steps__label"><span>Phase ${i + 1} von ${p.phases.length}</span><b>${esc(p.phase)}</b></div>`;
}
const STATUS_TXT = { anfrage: "Angefragt", aktiv: "Läuft", pausiert: "Pausiert", abgeschlossen: "Abgeschlossen" };
function projectCard(p) {
  const fbOffen = p.status === "anfrage" && p.fragebogen?.link;
  return `<a class="pcard" href="${fbOffen ? esc(p.fragebogen.link) : "#projekt/" + p.id}">
    <div class="pcard__top"><div><h3>${esc(p.title)}</h3><div class="pcard__kind">${esc(p.kind || "Projekt")}${p.model ? " · " + esc(p.model) : ""}</div></div><span class="pill pill--${p.status}">${esc(STATUS_TXT[p.status] || p.status)}</span></div>
    ${stepsBar(p)}
    <div class="pcard__meta">
      ${p.status === "anfrage" ? `<span>${fbOffen ? "Uns fehlen noch Ihre Angaben (etwa fünf Minuten)." : "Ihre Angaben liegen uns vor."}</span>` : ""}
      ${p.next ? `<span>Nächster Termin: <b>${fmt(p.next.start, { day: "numeric", month: "short" })}</b></span>` : ""}
      ${p.latest ? `<span>Prototyp: <b>V${p.latest.version}</b></span>` : ""}
      ${p.open_net ? `<span>Offen: <b>${money(p.open_gross)}</b></span>` : ""}
    </div>${fbOffen ? `<span class="btn btn--grad btn--sm" style="justify-self:start">Fragebogen ausfüllen</span>` : ""}</a>`;
}
// Anfrage, zu der es noch kein Projekt gibt (Fragebogen offen, oder Website-Fragebogen ausgefüllt): gleiche Karte wie ein Projekt
function anfrageCard(a) {
  return `<div class="pcard pcard--anfrage">
    <div class="pcard__top"><div><h3>${esc(a.art)}</h3><div class="pcard__kind">Ihre Anfrage</div></div><span class="pill pill--anfrage">Angefragt</span></div>
    ${wegBar(a.fertig ? 2 : 1)}
    <div class="pcard__meta">
      <span>${a.fertig ? "Ihre Angaben liegen uns vor." : "Uns fehlen noch Ihre Angaben (etwa fünf Minuten)."}</span>
      ${a.termin ? `<span>Erstgespräch: <b>${fmt(a.termin, { day: "numeric", month: "short" })}, ${fmt(a.termin, { hour: "2-digit", minute: "2-digit" })} Uhr</b></span>` : ""}
    </div>
    ${a.link ? `<a class="btn btn--grad btn--sm" href="${esc(a.link)}">Fragebogen ausfüllen</a>` : ""}</div>`;
}
function eventsList(events) {
  return events.length ? events.map(e => `<li><b>${esc(e.title)}</b><span>${fmt(e.created_at, { day: "numeric", month: "long", year: "numeric" })}${e.project_title ? " · " + esc(e.project_title) : ""}</span>${e.detail ? `<p>${esc(e.detail)}</p>` : ""}</li>`).join("")
    : `<li><b>Noch nichts passiert</b><span>Sobald es Neuigkeiten gibt, sehen Sie sie hier.</span></li>`;
}
function apptCard(a, next) {
  const has = a.summary || a.next_steps, future = new Date(a.start) > new Date();
  const state = future ? "plan" : has ? "done" : "past";
  const pill = { plan: next ? "Nächster Termin" : "Geplant", done: "✓ Zusammenfassung", past: "Stattgefunden" }[state];
  return `<details class="appt appt--${state} ${next ? "appt--next" : ""}" ${next ? "open" : ""}>
    <summary><div class="date"><span>${fmt(a.start, { month: "short" })}</span><b>${fmt(a.start, { day: "numeric" })}</b></div>
      <div><h3>${esc(a.title)}</h3><p>${fmt(a.start, { weekday: "long", hour: "2-digit", minute: "2-digit" })} Uhr${a.minutes ? ` · ${a.minutes} Min.` : ""}${a.kind ? " · " + esc(a.kind) : ""}${a.project ? " · " + esc(a.project) : ""}</p></div>
      <span class="pill apill apill--${state}">${pill}</span></summary>
    <div class="appt__body">
      ${a.video_url && new Date(a.start).getTime() + 3 * 3600e3 > Date.now() ? `<div class="appt__video"><a class="btn btn--grad btn--sm" href="${esc(a.video_url)}" target="_blank" rel="noopener">Zum Videogespräch</a><span>Einfach zur Uhrzeit anklicken – ohne Anmeldung, ohne Installation.</span></div>` : ""}
      <div><h4>Zusammenfassung</h4><p>${a.summary ? esc(a.summary) : `<span class="muted">${new Date(a.start) > new Date() ? "Nach dem Termin finden Sie hier unsere Zusammenfassung." : "Noch keine Zusammenfassung hinterlegt."}</span>`}</p></div>
      <div><h4>Nächste Schritte</h4><p>${a.next_steps ? esc(a.next_steps) : `<span class="muted">–</span>`}</p></div>
    </div></details>`;
}
function docRow(d) {
  const ext = (d.file_name.split(".").pop() || "").toUpperCase().slice(0, 4);
  return `<a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener">
    <span class="doc__ico">${esc(ext)}</span>
    <div><b>${esc(d.title)}</b><span>${esc(d.kind)}${d.doc_date ? " · " + ymd(d.doc_date) : ""}${d.project ? " · " + esc(d.project) : ""} · ${size(d.bytes)}</span></div>
    <span class="doc__amt">${d.amount_gross != null ? money(d.amount_gross) : ""}</span>
    <span class="btn btn--ghost btn--sm">Öffnen</span></a>`;
}

/* ---------- „Seit Ihrem letzten Besuch“ (neue Stände, erledigte Anmerkungen) ---------- */
let NEWS = [];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function renderNews(list) {
  NEWS = list.slice(0, 3);
  $("#ovNews").innerHTML = NEWS.map((n, i) => {
    const first = !n.from, c = n.counts;
    const stats = [[c.versions > 1 || !first ? c.versions : 0, c.versions === 1 ? "neue Version" : "neue Versionen"], [c.pagesChanged, c.pagesChanged === 1 ? "Seite überarbeitet" : "Seiten überarbeitet"],
      [c.pagesNew, c.pagesNew === 1 ? "neue Seite" : "neue Seiten"], [c.done, c.done === 1 ? "Ihrer Anmerkungen umgesetzt" : "Ihrer Anmerkungen umgesetzt"],
      [c.checks ? c.checks.toLocaleString("de-DE") : 0, "automatische Prüfungen"], [c.fixed, c.fixed === 1 ? "Schwachstelle behoben" : "Schwachstellen behoben"]].filter(([v]) => v);
    return `<div class="news" data-n="${i}">
      <div class="news__head"><span class="news__ic">${ICON}</span><div>
        <small>${n.since ? "Seit Ihrem letzten Besuch · " + fmt(n.since, { weekday: "long", day: "numeric", month: "long" }) : "Neu für Sie"}</small>
        <h2>${first && n.to === 1 ? `Der erste Stand von „${esc(n.title)}“ ist da` : `„${esc(n.title)}“ ist jetzt bei Version ${n.to}`}</h2>
        <p>${esc(n.project || "")}${n.from ? ` · Sie kannten Version ${n.from}` : ""}</p></div></div>
      ${stats.length ? `<div class="news__stats">${stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>` : ""}
      <div class="news__acts"><button class="btn btn--grad btn--sm" data-news="open">${first && n.to === 1 ? "Jetzt ansehen" : "Neuen Stand ansehen"}</button>
        ${n.versions.some(v => v.pages.length || v.changes) || n.done.length ? `<button class="btn btn--ghost btn--sm" data-news="toggle" aria-expanded="false">Was hat sich geändert?</button>` : ""}</div>
      <div class="news__more" hidden>
        ${n.versions.map((v, vi) => `<div class="nver"><div class="nver__h"><em class="vtag">V${v.version}</em><span><b>${esc(v.changes || "Aktualisiert")}</b><small>${fmt(v.created_at, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} Uhr</small></span>
            <button class="btn btn--ghost btn--sm" data-news="ver" data-v="${vi}">Ansehen</button></div>
          ${v.pages.length ? `<div class="nver__pages">${v.pages.map(pg => `<button class="pchip" data-news="page" data-v="${vi}" data-page="${esc(pg.path)}">${esc(pg.label)}<em>${pg.kind}</em></button>`).join("")}</div>` : ""}
          ${v.removed.length ? `<p class="nver__rm">Entfernt: ${v.removed.map(esc).join(", ")}</p>` : ""}</div>`).join("")}
        ${n.done.length ? `<h3 class="news__h3">Ihre Anmerkungen – erledigt</h3>${n.done.map((a, ai) => `<div class="ndone"><span class="ndone__ok">✓</span><span><b>„${esc(a.comment || "Zeichnung")}“</b>${a.reply ? `<small>Unsere Antwort: ${esc(a.reply)}</small>` : ""}</span><button class="btn btn--ghost btn--sm" data-news="ann" data-a="${ai}">Zur Stelle</button></div>`).join("")}` : ""}
      </div></div>`;
  }).join("");
}
$("#ovNews").addEventListener("click", e => {
  const b = e.target.closest("[data-news]"); if (!b) return;
  const n = NEWS[+b.closest(".news").dataset.n], a = b.dataset.news;
  if (a === "toggle") { const m = $(".news__more", b.closest(".news")); m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); b.textContent = m.hidden ? "Was hat sich geändert?" : "Weniger anzeigen"; return; }
  if (a === "open") window.RSViewer.open(n.latest, { versions: n.all });
  if (a === "ver") window.RSViewer.open(n.versions[+b.dataset.v], { versions: n.all });
  if (a === "page") window.RSViewer.open(n.latest, { versions: n.all, page: b.dataset.page });   // immer der aktuelle Stand dieser Seite
  if (a === "ann") { const x = n.done[+b.dataset.a]; window.RSViewer.open(x.proto, { versions: n.all, focus: x }); }
});
// Geöffnete Version merken – Grundlage für „Seit Ihrem letzten Besuch“ und für die Anzeige im Board
window.addEventListener("rs:viewer-open", e => { if (e.detail?.id) api(`/prototypes/${e.detail.id}/seen`, { method: "POST", body: {} }).catch(() => {}); });

/* ---------- Rückfragen: jede Frage einzeln beantworten, mit eigenem Antwortfeld ---------- */
// Auf der Startseite nur, solange etwas offen ist. Über #rueckfragen (Link aus Mail und Chat) springt die Seite zur Karte
// und zeigt auch, wenn schon alles beantwortet ist, eine kurze Bestätigung.
let RQ = { offen: [], beantwortet: [] }, rqFrisch = new Set();
const absatz = t => esc(t).replace(/\n/g, "<br>");
function renderRueck(direkt) {
  const el = $("#ovRueck"), offen = RQ.offen, fertig = RQ.beantwortet.filter(b => rqFrisch.has(b.id));
  if (!offen.length && !fertig.length && !direkt) { el.innerHTML = ""; return; }
  const projekte = new Set([...offen, ...fertig].map(x => x.project_id)), mitProjekt = projekte.size > 1;
  const eins = [...offen, ...fertig][0];
  const unter = offen.length
    ? `${offen.length === 1 ? "Wir haben noch eine Frage" : `Wir haben noch ${offen.length} Fragen`}${!mitProjekt && eins ? ` zu Ihrem Projekt „${esc(eins.projekt)}“` : ""}. Jede Frage hat ein eigenes Antwortfeld – Ihre Antwort kommt sofort bei uns an.`
    : fertig.length ? "Vielen Dank – alle Rückfragen sind beantwortet. Wir arbeiten mit Ihren Antworten weiter."
    : "Zurzeit gibt es keine offenen Rückfragen. Vielen Dank!";
  const q = x => `<p class="rq__q">${mitProjekt ? `<small>${esc(x.projekt)}</small>` : ""}<b>${absatz(x.text)}</b></p>`;
  el.innerHTML = `<section class="rq" id="rueckfragen" aria-labelledby="rqTitel">
    <div class="rq__head"><span class="rq__ic">${ICON_FRAGE}</span><div><h2 id="rqTitel">Rückfragen von Reeder Software</h2><p>${unter}</p></div></div>
    ${offen.length || fertig.length ? `<div class="rq__list">
      ${offen.map(x => `<form class="rq__item" data-rq="${x.id}">${q(x)}
        <label class="rq__lbl"><span class="sr">Ihre Antwort</span><textarea name="antwort" rows="3" maxlength="1000" required placeholder="Ihre Antwort …"></textarea></label>
        <p class="err" hidden></p>
        <div class="rq__acts"><button class="btn btn--grad btn--sm" type="submit">Antwort senden</button></div></form>`).join("")}
      ${fertig.map(x => `<div class="rq__item rq__item--ok">${q(x)}<span class="rq__ok">beantwortet ✓</span><p class="rq__a">${absatz(x.antwort)}</p></div>`).join("")}
    </div>` : ""}</section>`;
}
const ICON_FRAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.8 9.4a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.3"/><path d="M12 16.6h.01"/></svg>`;
async function ladeRueck(direkt) {
  RQ = await api("/rueckfragen").catch(() => ({ offen: [], beantwortet: [] }));
  renderRueck(direkt);
}
async function viewRueckfragen() {
  await viewOverview(true);
  const k = $("#rueckfragen"); if (!k) return;
  k.scrollIntoView({ behavior: "smooth", block: "start" });
  const erstes = $("textarea", k); if (erstes) setTimeout(() => erstes.focus({ preventScroll: true }), 400);
}
$("#ovRueck").addEventListener("submit", async e => {
  const f = e.target.closest("[data-rq]"); if (!f) return; e.preventDefault();
  const id = +f.dataset.rq, antwort = f.antwort.value.trim(), err = $(".err", f), b = $("button", f);
  const fehler = m => { err.textContent = m; err.hidden = !m; };
  if (!antwort) return fehler("Bitte schreiben Sie eine Antwort.");
  b.disabled = true; b.textContent = "Wird gesendet …"; fehler("");
  try {
    const r = await api(`/rueckfragen/${id}`, { method: "POST", body: { antwort } });
    const x = RQ.offen.find(y => y.id === id);
    RQ.offen = RQ.offen.filter(y => y.id !== id);
    if (x) { RQ.beantwortet.unshift({ ...x, antwort: r.antwort, beantwortet_at: r.beantwortet_at }); rqFrisch.add(id); }
    renderRueck(true); toast("Danke – Ihre Antwort ist bei uns angekommen.");
    $("#ovRueck textarea")?.focus({ preventScroll: true });
  } catch (e2) {
    fehler(e2.message); b.disabled = false; b.textContent = "Antwort senden";
    if (/erledigt|bereits/.test(e2.message)) setTimeout(() => ladeRueck(true), 2500);
  }
});

/* ---------- Übersicht ---------- */
async function viewOverview(direkt = false) {
  rqFrisch = new Set();
  const [o, quotes, news, anfragen] = await Promise.all([api("/overview"), api("/quotes").catch(() => []), api("/neu").catch(() => []), api("/anfragen").catch(() => []), ladeRueck(direkt === true)]);
  renderNews(news);
  const h = new Date().getHours();
  const pending = quotes.filter(q => q.status === "versendet");
  $("#ovQuotes").innerHTML = pending.map(q => `<a class="qbanner" href="#angebot/${q.id}"><span class="qbanner__ico">${ICO_DOC}</span>
    <span class="qbanner__m"><small>${q.expired ? "Angebot abgelaufen" : "Wartet auf Ihre Freigabe"}</small><b>${esc(q.title || "Angebot " + q.number)}</b><span>${esc(q.number)} · ${money(q.gross)} brutto${q.valid_until ? ` · gültig bis ${ymd(q.valid_until)}` : ""}</span></span>
    <span class="btn ${q.expired ? "btn--ghost" : "btn--grad"} btn--sm">${q.expired ? "Ansehen" : "Ansehen & annehmen"}</span></a>`).join("");
  $("#ovHello").textContent = `${h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend"}, ${me.name.split(" ")[0]}.`;
  $("#ovCo").textContent = me.company;
  const open = o.projects.reduce((s, p) => s + (p.open_gross || 0), 0);
  $("#ovTiles").innerHTML = `
    <a class="tile tile--grad" href="#termine"><small>Nächster Termin</small><b>${o.next ? fmt(o.next.start, { weekday: "short", day: "numeric", month: "short" }) + ", " + fmt(o.next.start, { hour: "2-digit", minute: "2-digit" }) : "–"}</b><span>${o.next ? esc(o.next.title) : "Kein Termin geplant"}</span></a>
    <a class="tile" href="#chat"><small>Nachrichten</small><b>${o.unread || "Keine"} neu</b><span>im Chat mit unserem Team</span></a>
    <a class="tile" href="#projekte"><small>Ihre Anmerkungen</small><b>${o.openNotes} offen</b><span>an Prototypen</span></a>
    <a class="tile" href="#dokumente"><small>Offener Betrag</small><b>${money(open)}</b><span>laut Zahlungsplan, brutto</span></a>`;
  // Höchstens 5 Projekte, der Rest hinter „Alle anzeigen“
  const MAXP = 5, extra = Math.max(0, o.projects.length - MAXP);
  $("#ovProjects").innerHTML = (anfragen.map(anfrageCard).join("") + o.projects.map((p, i) => i < MAXP ? projectCard(p) : projectCard(p).replace('class="pcard"', 'class="pcard pcard--extra"')).join("")) || `<div class="empty">Sobald wir gemeinsam starten, finden Sie Ihr Projekt hier.</div>`;
  $("#ovProjects").classList.remove("open");
  $("#projMore").hidden = !extra; $("#projMore").classList.remove("open");
  $("span", $("#projMore")).textContent = `${extra} weitere${extra === 1 ? "s" : ""} Projekt${extra === 1 ? "" : "e"} anzeigen`;
  // „Zuletzt passiert“ endet auf Höhe der Projektspalte
  $("#ovEvents").innerHTML = eventsList(o.events);
  $("#evClip").classList.remove("open");
  $("span", $("#evMore")).textContent = `Alle ${o.events.length} Ereignisse anzeigen`;
  fitEvents();
}
function fitEvents() {
  const clip = $("#evClip"); if (!clip || clip.classList.contains("open")) return;
  const wide = innerWidth > 1080, colH = $("#ovProjects").offsetHeight;
  const max = Math.max(wide ? colH : 0, 340);
  clip.style.maxHeight = max + "px";
  const overflow = $("#ovEvents").scrollHeight + 44 > max;
  clip.classList.toggle("clipped", overflow); $("#evMore").hidden = !overflow;
}
addEventListener("resize", () => { if (!$("[data-view=uebersicht]").hidden) fitEvents(); });
$("#evMore").addEventListener("click", () => {
  const clip = $("#evClip"), open = !clip.classList.contains("open");
  clip.classList.toggle("open", open); $("#evMore").classList.toggle("open", open);
  clip.style.maxHeight = open ? clip.scrollHeight + 80 + "px" : "";
  $("span", $("#evMore")).textContent = open ? "Weniger anzeigen" : `Alle ${$$("#ovEvents li").length} Ereignisse anzeigen`;
  if (!open) { fitEvents(); clip.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
});
$("#projMore").addEventListener("click", () => {
  const open = !$("#ovProjects").classList.contains("open"), n = $$("#ovProjects .pcard--extra").length;
  $("#ovProjects").classList.toggle("open", open); $("#projMore").classList.toggle("open", open);
  $("span", $("#projMore")).textContent = open ? "Weniger anzeigen" : `${n} weitere${n === 1 ? "s" : ""} Projekt${n === 1 ? "" : "e"} anzeigen`;
  fitEvents();
});

/* ---------- Angebot ansehen & annehmen ---------- */
const ICO_DOC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>`;
const ON_LABEL = on => on === "Auftrag" ? "bei Auftragserteilung" : `zu Beginn der Phase „${on}“`;
const pct = n => String(n).replace(".", ",") + " %";
async function viewQuote(id) {
  const q = await api("/quotes/" + (+id || 0)), el = $("#quoteView");
  $("#quoteBack").href = q.project_id ? `#projekt/${q.project_id}` : "#uebersicht";
  $("#quoteBack").textContent = q.project_id ? `← ${q.project || "Projekt"}` : "← Übersicht";
  const acc = q.acceptance, open = q.status === "versendet" && !q.expired;
  const side = acc?.decision === "angenommen" ? `<div class="card qside qside--ok"><span class="qok">✓</span><h2>Vielen Dank für Ihren Auftrag!</h2>
      <p>Beauftragt am ${dateLong(acc.at.replace(" ", "T") + "Z")} um ${fmt(acc.at.replace(" ", "T") + "Z", { hour: "2-digit", minute: "2-digit" })} Uhr von ${esc(acc.name)}${acc.position ? ", " + esc(acc.position) : ""}.</p>
      ${acc.doc_url ? `<a class="btn btn--ghost btn--sm" href="${esc(acc.doc_url)}" target="_blank" rel="noopener">Auftragsbestätigung (PDF)</a>` : ""}
      <h4>So geht es weiter</h4><ol class="qnext"><li>Die Auftragsbestätigung mit allen Bedingungen liegt unter „Dokumente“ und in Ihrem Postfach.</li>
        ${q.plan.length ? `<li>Die Rechnung für „${esc(q.plan[0].label)}“ (${money(q.plan[0].gross)}) erhalten Sie in Kürze per E-Mail.</li>` : ""}<li>Wir melden uns mit dem Termin für den Projektstart.</li></ol></div>`
    : acc?.decision === "abgelehnt" ? `<div class="card qside"><h2>Angebot abgelehnt</h2><p class="muted">Sie haben dieses Angebot am ${dateLong(acc.at.replace(" ", "T") + "Z")} abgelehnt. Wenn sich etwas ändert, schreiben Sie uns gern im Chat.</p><a class="btn btn--ghost btn--sm" href="#chat">Zum Chat</a></div>`
    : q.expired ? `<div class="card qside"><h2>Angebot abgelaufen</h2><p class="muted">Dieses Angebot war bis ${ymd(q.valid_until)} gültig. Schreiben Sie uns kurz – wir schicken Ihnen gern ein aktuelles.</p><a class="btn btn--grad btn--sm" href="#chat">Nachricht schreiben</a></div>`
    : `<form class="card qside" id="qForm"><h2>Angebot annehmen</h2>
        <p class="muted" style="margin:-4px 0 14px">Mit Ihrer Annahme kommt der Vertrag zustande. Sie erhalten sofort eine Auftragsbestätigung.</p>
        ${q.needAddress ? `<fieldset class="qaddr"><legend>Rechnungsanschrift</legend><label>Firma<input name="billing_name" value="${esc(q.billing.billing_name || me.company)}" required></label>
          <label>Straße &amp; Hausnummer<input name="street" required autocomplete="street-address"></label><div class="two"><label>PLZ<input name="zip" required inputmode="numeric" autocomplete="postal-code"></label><label>Ort<input name="city" required autocomplete="address-level2"></label></div></fieldset>` : ""}
        <label>Ihr vollständiger Name<input name="name" value="${esc(me.name)}" required minlength="3" autocomplete="name"></label>
        <label><span>Funktion <span class="muted">(optional)</span></span><input name="position" placeholder="z. B. Geschäftsführer" autocomplete="organization-title"></label>
        <label class="qcheck"><input type="checkbox" name="auth" required><span>Ich bin berechtigt, für ${esc(me.company)} Aufträge zu erteilen.</span></label>
        <label class="qcheck"><input type="checkbox" name="terms" required><span>Ich habe die <a href="#qTerms" data-open="qTerms">Vertragsbedingungen</a> (Fassung ${q.terms.version}) gelesen und akzeptiere sie.</span></label>
        ${q.avv ? `<label class="qcheck"><input type="checkbox" name="avv" required><span>Ich schließe die <a href="#qAvv" data-open="qAvv">Vereinbarung zur Auftragsverarbeitung</a> (Fassung ${q.avvText.version}) ab.</span></label>` : ""}
        <div class="qsig"><div class="qsig__h"><b>Ihre Unterschrift</b><button type="button" class="link" id="qSigClear">Löschen</button></div>
          <canvas id="qSig" width="640" height="220" aria-label="Unterschriftsfeld"></canvas><small>Mit dem Finger oder der Maus unterschreiben.</small></div>
        <p class="err" id="qErr" hidden></p>
        <button class="btn btn--grad qgo" type="submit">Verbindlich beauftragen · ${money(q.gross)}</button>
        <div class="qalt"><a href="#chat">Frage stellen</a><button type="button" class="link" id="qNo">Angebot ablehnen</button></div>
        <div id="qNoBox" hidden><label><span>Was hat nicht gepasst? <span class="muted">(optional, hilft uns sehr)</span></span><textarea name="reason" rows="3"></textarea></label>
          <button type="button" class="btn btn--ghost btn--sm" id="qNoGo">Ablehnung senden</button></div></form>`;
  el.innerHTML = `<header class="phead"><p class="kick">Angebot ${esc(q.number)}</p><h1>${esc(q.title || "Ihr Angebot")}</h1>
      <p class="muted" style="margin:6px 0 0">vom ${ymd(q.issue_date)}${q.valid_until ? ` · gültig bis ${ymd(q.valid_until)}` : ""}${q.pdf_url ? ` · <a href="${esc(q.pdf_url)}" target="_blank" rel="noopener">als PDF öffnen</a>` : ""}</p></header>
    <div class="qgrid"><div class="qmain">
      <div class="card">${q.intro ? `<p class="qintro">${esc(q.intro)}</p>` : ""}
        <div class="qitems">${q.items.map(it => `<div class="qitem"><span class="qpos">${it.pos}</span><div><b>${esc(it.title)}</b>${it.description ? `<p>${esc(it.description)}</p>` : ""}<small>${String(it.qty).replace(".", ",")} ${esc(it.unit || "")} × ${money(it.unit_net)}</small></div><span class="num">${money(it.net)}</span></div>`).join("")}</div>
        <div class="qtot"><div><span>Summe netto</span><b>${money(q.net)}</b></div>${Object.entries(q.vatByRate).map(([r, v]) => `<div><span>zzgl. ${r} % USt.</span><b>${money(v)}</b></div>`).join("")}<div class="qtot__sum"><span>Gesamt</span><b>${money(q.gross)}</b></div></div>
        ${q.outro ? `<p class="muted" style="margin:16px 0 0">${esc(q.outro)}</p>` : ""}</div>
      ${q.plan.length ? `<div class="card"><h2 class="h2">Zahlungsplan</h2><div class="qplan">${q.plan.map((x, i) => `<div class="qrate"><span class="qrate__n">${i + 1}</span><div><b>${esc(x.label)}</b><small>${pct(x.pct)} · ${ON_LABEL(x.on)}</small></div><span class="num">${money(x.gross)}<small>brutto</small></span></div>`).join("")}</div>
        <p class="muted" style="margin:12px 0 0;font-size:13px">Jede Rate stellen wir erst in Rechnung, wenn sie fällig ist – zahlbar innerhalb von 14 Tagen.</p></div>` : ""}
      <details class="card qdoc" id="qTerms"><summary><b>Vertragsbedingungen</b><span>Fassung ${q.terms.version}</span></summary><div class="qtext">${esc(q.terms.text)}</div></details>
      ${q.avvText ? `<details class="card qdoc" id="qAvv"><summary><b>Vereinbarung zur Auftragsverarbeitung</b><span>Fassung ${q.avvText.version}</span></summary><div class="qtext">${esc(q.avvText.text)}</div></details>` : ""}
    </div><aside class="qaside">${side}</aside></div>`;
  el.querySelectorAll("[data-open]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); const d = $("#" + a.dataset.open); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }));
  const f = $("#qForm"); if (!f || !open) return;
  const err = m => { $("#qErr").textContent = m; $("#qErr").hidden = !m; };
  $("#qNo").addEventListener("click", () => { $("#qNoBox").hidden = !$("#qNoBox").hidden; });
  $("#qNoGo").addEventListener("click", async () => {
    try { await api(`/quotes/${q.id}/decline`, { method: "POST", body: { reason: f.reason.value } }); toast("Danke für Ihre Rückmeldung – wir melden uns."); viewQuote(q.id); } catch (e) { err(e.message); }
  });
  // Unterschriftsfeld: Linien mit Finger, Stift oder Maus; "gezeichnet" merkt, ob überhaupt unterschrieben wurde
  const sig = $("#qSig"), sx = sig.getContext("2d"); let zieht = false, gezeichnet = false, lx = 0, ly = 0;
  sx.lineWidth = 2.6; sx.lineCap = "round"; sx.lineJoin = "round"; sx.strokeStyle = "#0a0a0c";
  const ort = e2 => { const r = sig.getBoundingClientRect(); return [(e2.clientX - r.left) * sig.width / r.width, (e2.clientY - r.top) * sig.height / r.height]; };
  sig.addEventListener("pointerdown", e2 => { e2.preventDefault(); sig.setPointerCapture(e2.pointerId); zieht = true; [lx, ly] = ort(e2); sx.beginPath(); sx.arc(lx, ly, 1.2, 0, 7); sx.fill(); });
  sig.addEventListener("pointermove", e2 => { if (!zieht) return; const [x, y] = ort(e2); sx.beginPath(); sx.moveTo(lx, ly); sx.lineTo(x, y); sx.stroke(); if (Math.hypot(x - lx, y - ly) > 2) gezeichnet = true; [lx, ly] = [x, y]; });
  ["pointerup", "pointercancel", "pointerleave"].forEach(n => sig.addEventListener(n, () => { zieht = false; }));
  $("#qSigClear").addEventListener("click", () => { sx.clearRect(0, 0, sig.width, sig.height); gezeichnet = false; });
  f.addEventListener("submit", async e => {
    e.preventDefault(); err("");
    if (!gezeichnet) { err("Bitte unterschreiben Sie im Unterschriftsfeld."); sig.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const b = $(".qgo", f); b.disabled = true; b.textContent = "Wird übermittelt …";
    try {
      await api(`/quotes/${q.id}/accept`, { method: "POST", body: { name: f.name.value, position: f.position.value, terms: f.terms.checked && f.auth.checked, avv: !!f.avv?.checked, signature: sig.toDataURL("image/png"),
        address: q.needAddress ? { billing_name: f.billing_name.value, street: f.street.value, zip: f.zip.value, city: f.city.value } : undefined } });
      toast("Vielen Dank – Ihr Auftrag ist bei uns eingegangen."); await viewQuote(q.id); scrollTo({ top: 0, behavior: "smooth" }); refreshBadge();
    } catch (e2) { err(e2.message); b.disabled = false; b.textContent = `Verbindlich beauftragen · ${money(q.gross)}`; }
  });
}

/* ---------- Projekte ---------- */
async function viewProjects() {
  const [list, anfragen] = await Promise.all([api("/projects"), api("/anfragen").catch(() => [])]);
  // Eine Liste: zuerst, wo noch etwas von Ihnen fehlt, dann die übrigen Anfragen, dann die Projekte
  const offen = anfragen.filter(a => !a.fertig), fertig = anfragen.filter(a => a.fertig);
  $("#projList").innerHTML = [...offen.map(anfrageCard), ...fertig.map(anfrageCard), ...list.map(projectCard)].join("")
    || `<div class="empty">Noch keine Projekte. Sobald Sie etwas bei uns anfragen, sehen Sie es hier.</div>`;
}
let project = null, ptab = "ueberblick";
async function viewProject(id) {
  const [pr, quotes] = await Promise.all([api("/projects/" + (+id || 0)), api("/quotes").catch(() => [])]);
  project = pr; project.quotes = quotes.filter(q => q.project_id === pr.id);
  renderProject();
}
function renderProject() {
  const p = project;
  $("#projDetail").innerHTML = `
    <div class="phero"><p class="kick">${esc(p.kind || "Projekt")}</p><h1>${esc(p.title)}</h1>${p.description ? `<p>${esc(p.description)}</p>` : ""}
      <div class="phero__row"><span class="pill">${esc(p.status)}</span>${p.model ? `<span class="pill">Modell: ${esc(p.model)}</span>` : ""}${p.openNotes ? `<span class="pill">${p.openNotes} offene Anmerkung${p.openNotes === 1 ? "" : "en"}</span>` : ""}</div>
      <div class="stepper">${p.phases.map((ph, k) => `<div class="${k < p.phaseIndex ? "done" : k === p.phaseIndex ? "now" : ""}"><i></i>${esc(ph)}</div>`).join("")}</div></div>
    <div class="seg ptabs" id="ptabs">${[["ueberblick", "Verlauf"], ["prototypen", `Prototypen${p.prototypes.length ? " · " + p.prototypes.length : ""}`], ["termine", `Termine${p.appointments.length ? " · " + p.appointments.length : ""}`], ["finanzen", "Angebot & Zahlungen"], ["dokumente", `Dokumente${p.documents.length ? " · " + p.documents.length : ""}`]]
      .map(([k, l]) => `<button data-t="${k}" class="${k === ptab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="ppane"></div>`;
  renderPane();
}
function renderPane() {
  const p = project, el = $("#ppane");
  if (ptab === "ueberblick") el.innerHTML = `<div class="card"><ol class="timeline">${eventsList(p.events)}</ol></div>`;
  if (ptab === "prototypen") el.innerHTML = p.prototypes.length ? p.prototypes.map((g, gi) => {
    const v = g[0];
    return `<div class="pgroup"><div class="proto__thumb">${ICON}</div>
      <div><h3>${esc(v.title)} <em class="vtag">V${v.version}</em></h3><p>${dateLong(v.created_at)}${v.openNotes ? ` · <span class="notes-chip">${v.openNotes} offene Anmerkung${v.openNotes === 1 ? "" : "en"}</span>` : ""}</p></div>
      <div class="pgroup__acts"><button class="btn btn--grad btn--sm" data-open="${gi}:0">Öffnen &amp; anmerken</button></div>
      ${g.length > 1 || v.changes ? `<div class="versions">${g.map((x, vi) => `<div class="vrow"><b>V${x.version}${g[0].seen && x.version > g[0].seen.version ? ` <em class="newtag">neu</em>` : ""}</b><span>${esc(x.changes || (x.version === 1 ? "Erste Version" : "–"))} <span class="muted">· ${fmt(x.created_at, { day: "numeric", month: "short" })}</span></span><button class="btn btn--ghost btn--sm" data-open="${gi}:${vi}">Ansehen</button></div>`).join("")}</div>` : ""}
    </div>`;
  }).join("") : `<div class="empty">Noch kein Prototyp in diesem Projekt.</div>`;
  if (ptab === "termine") {
    const now = new Date(), up = p.appointments.filter(a => new Date(a.start) >= now).reverse(), past = p.appointments.filter(a => new Date(a.start) < now).reverse();
    el.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:-6px"><button class="btn btn--grad btn--sm" data-req="${p.id}">Termin zu diesem Projekt anfragen</button></div>` + ((up.length ? `<p class="listhead">Geplant</p>` + up.map((a, i) => apptCard(a, i === 0)).join("") : "") + (past.length ? `<p class="listhead">Bisherige Termine</p>` + past.map(a => apptCard(a)).join("") : "") || `<div class="empty" style="margin-top:18px">Noch keine Termine in diesem Projekt.</div>`);
  }
  if (ptab === "finanzen") {
    const vatF = 1 + p.vat_rate / 100;
    el.innerHTML = `
      <div class="fin">
        <div class="tile tile--grad"><small>Kostenvoranschlag</small><b>${money(p.offer_net)} netto</b><span>${p.offer_gross != null ? money(p.offer_gross) + " brutto · inkl. " + String(p.vat_rate).replace(".", ",") + " % USt." : "noch nicht hinterlegt"}</span></div>
        <div class="tile"><small>Bezahlt</small><b>${money(Math.round(p.paid_net * vatF))}</b><span>${money(p.paid_net)} netto</span></div>
        <div class="tile"><small>Noch offen</small><b>${money(Math.round(p.open_net * vatF))}</b><span>${money(p.open_net)} netto</span></div>
      </div>
      ${(p.quotes || []).map(q => `<a class="qbanner qbanner--${q.status}" href="#angebot/${q.id}"><span class="qbanner__ico">${ICO_DOC}</span>
        <span class="qbanner__m"><small>${q.status === "angenommen" ? "✓ Beauftragt" + (q.acceptance ? " am " + dateLong(q.acceptance.at.replace(" ", "T") + "Z") : "") : q.status === "abgelehnt" ? "Abgelehnt" : q.expired ? "Abgelaufen" : "Wartet auf Ihre Freigabe"}</small><b>Angebot ${esc(q.number)}</b><span>${money(q.gross)} brutto${q.avv ? " · inkl. Auftragsverarbeitung" : ""}</span></span>
        <span class="btn ${q.status === "versendet" && !q.expired ? "btn--grad" : "btn--ghost"} btn--sm">${q.status === "versendet" && !q.expired ? "Ansehen & annehmen" : "Ansehen"}</span></a>`).join("")}
      ${p.conditions ? `<div class="card" style="margin-bottom:16px"><h2 class="h2">Vereinbarte Konditionen</h2><p class="cond">${esc(p.conditions)}</p></div>` : ""}
      <div class="card"><h2 class="h2">Zahlungsplan</h2>${p.payments.length ? `
        <table class="table"><thead><tr><th>Position</th><th>Fällig</th><th class="num">Netto</th><th class="num">Brutto</th><th>Status</th></tr></thead>
        <tbody>${p.payments.map(x => `<tr><td>${esc(x.label)}</td><td>${x.due ? ymd(x.due) : "–"}</td><td class="num">${money(x.amount_net)}</td><td class="num">${money(x.amount_gross)}</td><td><span class="pill pill--${x.status}">${x.status === "bezahlt" ? "✓ bezahlt" + (x.paid_at ? " am " + ymd(x.paid_at) : "") : x.status === "berechnet" ? "Rechnung gestellt" : "offen"}</span>${x.invoice_url ? ` <a class="invlink" href="${esc(x.invoice_url)}" target="_blank" rel="noopener">Rechnung ↗</a>` : ""}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Summe</td><td></td><td class="num">${money(p.payments.reduce((s, x) => s + x.amount_net, 0))}</td><td class="num">${money(p.payments.reduce((s, x) => s + x.amount_gross, 0))}</td><td></td></tr></tfoot></table>` : `<p class="muted" style="margin:0">Noch kein Zahlungsplan hinterlegt.</p>`}</div>
      ${p.documents.some(d => ["Angebot", "Rechnung", "Vertrag"].includes(d.kind)) ? `<div class="card" style="margin-top:16px"><h2 class="h2">Angebote &amp; Rechnungen</h2><div class="docs">${p.documents.filter(d => ["Angebot", "Rechnung", "Vertrag"].includes(d.kind)).map(docRow).join("")}</div></div>` : ""}`;
  }
  if (ptab === "dokumente") el.innerHTML = p.documents.length ? `<div class="card"><div class="docs">${p.documents.map(docRow).join("")}</div></div>` : `<div class="empty">Noch keine Dokumente in diesem Projekt.</div>`;
}
$("#projDetail").addEventListener("click", e => {
  const t = e.target.closest("#ptabs button"); if (t) { ptab = t.dataset.t; $$("#ptabs button").forEach(b => b.classList.toggle("on", b === t)); renderPane(); return; }
  const o = e.target.closest("[data-open]");
  if (o) {
    const [gi, vi] = o.dataset.open.split(":").map(Number), g = project.prototypes[gi];
    window.RSViewer.open(protoData(g[vi]), { versions: g.map(protoData) });
  }
});

/* ---------- Chat: je Projekt ein eigener Chat ----------
   Hat der Kunde mehrere Projekte (oder dazu allgemeine Nachrichten), wählt er oben den Chat; sonst sieht er wie bisher einen Verlauf.
   Adresse: #chat oder #chat/<Projekt-Nummer> bzw. #chat/allgemein */
let msgs = [], threads = [], thread = null, antwortAuf = null;
const thKey = t => t.project_id == null ? "allgemein" : String(t.project_id);
const EMPTY = `<b>Ihr direkter Draht zu uns.</b>Stellen Sie hier Fragen, geben Sie Feedback oder schicken Sie uns einfach Ihre Gedanken. Unser Team antwortet in der Regel am selben Werktag.`;
async function viewChat(arg) {
  threads = await api("/threads").catch(() => []);
  const gibt = k => k && threads.some(t => thKey(t) === k);
  const wahl = gibt(arg) ? arg : gibt(thread) ? thread : thKey(threads.find(t => t.unread) || threads[0] || { project_id: null });
  await openThread(wahl);
  $("#bChat").hidden = true;
  stopChat?.(); stopChat = poll(chatTick);
  $("#composer textarea").focus();
}
function renderThreads() {
  const box = $("#chatThreads"), cur = threads.find(t => thKey(t) === thread);
  box.hidden = threads.length < 2;
  box.innerHTML = threads.map(t => { const on = thKey(t) === thread;
    return `<button type="button" role="tab" class="thchip ${on ? "on" : ""} ${t.status === "abgeschlossen" ? "thchip--zu" : ""}" data-th="${thKey(t)}" aria-selected="${on}"><span>${esc(t.title)}</span>${t.unread && !on ? `<em>${t.unread}</em>` : ""}</button>`; }).join("");
  $("#chatSub").textContent = threads.length > 1 && cur ? (cur.project_id ? `Zum Projekt „${cur.title}“ · wir antworten in der Regel am selben Werktag.` : "Allgemeine Fragen · wir antworten in der Regel am selben Werktag.") : "Wir antworten in der Regel am selben Werktag.";
  if (!antwortAuf) $("#composer textarea").placeholder = threads.length > 1 && cur?.project_id ? `Nachricht zu „${cur.title}“ …` : "Nachricht an unser Team …";
}
async function openThread(k) {
  thread = k; msgs = []; $("#log").dataset.scrolled = ""; antwortAuf = null; $("#antwortAuf").hidden = true;
  if (location.hash.startsWith("#chat")) history.replaceState(null, "", threads.length > 1 ? `#chat/${k}` : "#chat");
  await loadMessages();
  const t = threads.find(x => thKey(x) === k); if (t) t.unread = 0;
  renderThreads();
  refreshBadge().catch(() => {});
}
async function loadMessages() {
  const k = thread, q = `/messages?thread=${encodeURIComponent(k)}&after=`;
  const after = msgs.length ? msgs[msgs.length - 1].id : 0;
  const fresh = await api(q + after); if (k !== thread) return;
  if (fresh.length || !msgs.length) {
    msgs = msgs.concat(fresh);
    if (after && fresh.some(m => m.art === "antwort")) msgs = await api(q + 0);   // neue Antwort: Stand der Rückfragen-Karten auffrischen
    render($("#log"), msgs, "client", EMPTY);
  }
  else if (msgs.some(m => m.sender === "client" && !m.read)) { msgs = await api(q + 0); render($("#log"), msgs, "client", EMPTY); }
}
async function chatTick() {
  await loadMessages();
  const neu = await api("/threads").catch(() => null);
  if (neu) { threads = neu; const t = threads.find(x => thKey(x) === thread); if (t) t.unread = 0; renderThreads(); }
}
$("#chatThreads").addEventListener("click", e => {
  const b = e.target.closest("[data-th]"); if (!b || b.dataset.th === thread) return;
  openThread(b.dataset.th).then(() => $("#composer textarea").focus()).catch(err => toast(err.message));
});
/* Auf eine Rückfrage antworten – direkt im Chat: „Antworten“ setzt die Frage als Zitat über das Eingabefeld,
   die nächste Nachricht geht als Antwort genau an diese Frage. Danach springt das Zitat zur nächsten offenen Frage. */
function antwortSetzen(a) {
  antwortAuf = a; const box = $("#antwortAuf"), ta = $("#composer textarea");
  box.hidden = !a;
  if (a) { $("#antwortNr").textContent = a.nr ? a.nr : ""; $("#antwortFrage").textContent = a.frage; ta.placeholder = "Ihre Antwort …"; ta.focus(); }
  else renderThreads();
}
function naechsteOffene() {
  const k = [...$$("#log [data-antworten]")][0];
  return k ? { id: +k.dataset.antworten, frage: k.dataset.frage, nr: k.dataset.nr } : null;
}
$("#log").addEventListener("click", e => {
  const b = e.target.closest("[data-antworten]"); if (!b) return;
  antwortSetzen({ id: +b.dataset.antworten, frage: b.dataset.frage, nr: b.dataset.nr });
});
$("#antwortWeg").addEventListener("click", () => antwortSetzen(null));
composer($("#composer"), async text => {
  if (antwortAuf) {
    await api(`/rueckfragen/${antwortAuf.id}`, { method: "POST", body: { antwort: text } }).catch(err => { toast(err.message); throw err; });
    msgs = await api(`/messages?thread=${encodeURIComponent(thread)}&after=0`);   // Karte und Antwort neu laden
    $("#log").dataset.scrolled = ""; render($("#log"), msgs, "client", EMPTY);
    antwortSetzen(naechsteOffene());
    RQ = await api("/rueckfragen").catch(() => RQ);
    return;
  }
  const m = await api("/messages", { method: "POST", body: { body: text, project_id: thread && thread !== "allgemein" ? +thread : null } }).catch(err => { toast(err.message); throw err; });
  if (!msgs.some(x => x.id === m.id)) msgs.push(m);
  $("#log").dataset.scrolled = ""; render($("#log"), msgs, "client", EMPTY);
});

/* ---------- Termine & Dokumente ---------- */
async function viewAppointments() {
  renderRequests().catch(() => {});
  const list = await api("/appointments"), now = new Date();
  const up = list.filter(a => new Date(a.start) >= now).reverse(), past = list.filter(a => new Date(a.start) < now).reverse();
  $("#apptList").innerHTML = (up.length ? `<p class="listhead" style="margin-top:0">Geplant</p>` + up.map((a, i) => apptCard(a, i === 0)).join("") : "")
    + (past.length ? `<p class="listhead">Bisherige Termine</p>` + past.map(a => apptCard(a)).join("") : "")
    || `<div class="empty">Noch keine Termine. Fragen Sie gern einen an – per Video oder Telefon.</div>`;
}
async function viewDocuments() {
  const list = await api("/documents");
  $("#docList").innerHTML = list.length ? `<div class="docs">${list.map(docRow).join("")}</div>` : `<p class="muted" style="margin:0;text-align:center;padding:16px">Hier finden Sie später Angebote, Rechnungen und Verträge.</p>`;
}

/* ---------- Support ---------- */
const SUP_ST = { neu: ["Eingegangen", "offen"], in_bearbeitung: ["In Bearbeitung", "berechnet"], wartet: ["Wartet auf Ihre Antwort", "offen"], geloest: ["Gelöst", "bezahlt"], geschlossen: ["Erledigt", "bezahlt"] };
const SUP_CAT = { fehler: "Fehler", frage: "Frage", wunsch: "Änderungswunsch" };
const slaText = s => s.business ? `${s.hours >= 8 && s.hours % 8 === 0 ? `${s.hours / 8} Werktag${s.hours === 8 ? "" : "e"}` : `${s.hours} Std. (Geschäftszeit)`}` : `${s.hours} Stunden`;
async function viewSupport(id) {
  if (id) return supportDetail(+id);
  const d = await api("/support"), el = $("#supView");
  el.innerHTML = `<header class="phead phead--row"><div><p class="kick">Support</p><h1>Hilfe &amp; Anfragen</h1></div></header>
    <div class="supgrid"><form class="card supnew" id="supForm"><h2 class="h2">Neue Anfrage</h2>
        <div class="supcats">${Object.entries(SUP_CAT).map(([k, l], i) => `<label><input type="radio" name="category" value="${k}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <label>Betreff<input name="subject" required minlength="3" maxlength="160" placeholder="z. B. Export bricht mit Fehlermeldung ab"></label>
        ${d.projects.length ? `<label>Betrifft<select name="project_id"><option value="">– allgemein –</option>${d.projects.map(p => `<option value="${p.id}" ${d.projects.length === 1 ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label>` : ""}
        <label>Beschreibung<textarea name="body" rows="5" required placeholder="Was ist passiert? Was haben Sie erwartet? Wo genau (Seite, Schritt)?"></textarea></label>
        <fieldset class="supprio"><legend>Wie dringend?</legend>${Object.entries(d.priorities).reverse().map(([k, l]) => `<label class="${k}"><input type="radio" name="priority" value="${k}" ${k === "normal" ? "checked" : ""}><span><b>${esc(l.split(" – ")[0])}</b><small>${esc(l.split(" – ")[1] || "läuft, aber stört")} · Antwort binnen ${slaText(d.sla[k])}</small></span></label>`).join("")}</fieldset>
        <p class="err" id="supErr" hidden></p><button class="btn btn--grad">Anfrage senden</button></form>
      <div class="card"><h2 class="h2">Ihre Anfragen</h2>${d.list.length ? `<div class="suplist">${d.list.map(t => `<a class="supitem ${t.unread ? "unread" : ""}" href="#support/${t.id}">
          <span><b>${esc(t.subject)}</b><small>#${t.id} · ${SUP_CAT[t.category]}${t.project ? " · " + esc(t.project) : ""} · ${dateLong(t.last_at || t.created_at)}</small></span>
          <span class="pill pill--${SUP_ST[t.status][1]}">${t.unread ? "● Neue Antwort" : SUP_ST[t.status][0]}</span></a>`).join("")}</div>` : `<p class="muted" style="margin:0">Noch keine Anfragen. Wenn etwas nicht funktioniert oder Sie eine Frage haben – einfach links eintragen.</p>`}</div></div>`;
  $("#supForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target, b = $("button", f); b.disabled = true;
    try { const r = await api("/support", { method: "POST", body: Object.fromEntries(new FormData(f)) }); toast("Danke – Ihre Anfrage ist bei uns eingegangen."); location.hash = `#support/${r.id}`; }
    catch (err) { $("#supErr").textContent = err.message; $("#supErr").hidden = false; b.disabled = false; }
  });
}
async function supportDetail(id) {
  const t = await api(`/support/${id}`), el = $("#supView"), closed = t.status === "geschlossen";
  el.innerHTML = `<a href="#support" class="back">← Alle Anfragen</a>
    <header class="phead"><p class="kick">Support #${t.id} · ${SUP_CAT[t.category]}${t.project ? " · " + esc(t.project) : ""}</p><h1>${esc(t.subject)}</h1>
      <p class="muted" style="margin:6px 0 0"><span class="pill pill--${SUP_ST[t.status][1]}">${SUP_ST[t.status][0]}</span> ${t.assignee ? ` · bearbeitet von ${esc(t.assignee)}` : ""}</p></header>
    <div class="card supthread">${t.messages.map(m => m.author_kind === "system" ? `<p class="supsys">${esc(m.body)} · ${fmt(m.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>`
      : `<div class="supmsg supmsg--${m.author_kind}"><div class="supmsg__h"><b>${esc(m.author)}</b><span>${m.author_kind === "team" ? "Reeder Software · " : ""}${fmt(m.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div><p>${esc(m.body)}</p></div>`).join("")}</div>
    ${closed ? `<div class="card supdone"><p style="margin:0">Diese Anfrage ist erledigt.</p><button class="btn btn--ghost btn--sm" id="supReopen">Wieder öffnen</button></div>`
      : `<form class="card supreply" id="supReply"><textarea name="body" rows="3" placeholder="Ihre Antwort …" required></textarea>
        <div class="supreply__a">${t.status === "geloest" ? `<span class="muted">Wir haben die Anfrage als gelöst markiert. Passt alles?</span>` : "<span></span>"}<div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost btn--sm" id="supSolved">✓ Problem gelöst</button><button class="btn btn--grad btn--sm">Antworten</button></div></div></form>`}`;
  refreshBadge();
  $("#supReply")?.addEventListener("submit", async e => { e.preventDefault(); try { await api(`/support/${id}/reply`, { method: "POST", body: { body: e.target.body.value } }); supportDetail(id); } catch (err) { toast(err.message); } });
  $("#supSolved")?.addEventListener("click", async () => { await api(`/support/${id}/solved`, { method: "POST", body: {} }); toast("Danke für die Rückmeldung!"); supportDetail(id); });
  $("#supReopen")?.addEventListener("click", async () => { await api(`/support/${id}/reopen`, { method: "POST", body: {} }); supportDetail(id); });
}

/* ---------- Verträge ---------- */
async function viewContracts() {
  const list = await api("/vertraege");
  const per = n => n === 1 ? "monatlich" : n === 12 ? "jährlich" : `alle ${n} Monate`;
  $("#vtList").innerHTML = list.length ? `<div class="vtgrid">${list.map(c => `<div class="card vt">
      <div class="vt__h"><div><small>${esc(c.kind)}${c.project ? " · " + esc(c.project) : ""}</small><h2>${esc(c.title)}</h2></div><span class="pill ${c.status === "aktiv" ? "pill--bezahlt" : "pill--offen"}">${c.status === "aktiv" ? "aktiv" : "gekündigt"}</span></div>
      <div class="vt__amt"><b>${money(c.amount_gross)}</b><span>pro Monat inkl. ${String(c.vat_rate).replace(".", ",")} % USt. · ${money(c.amount_net)} netto · Abrechnung ${per(c.interval_months)}</span></div>
      <dl class="vt__dl"><div><dt>Beginn</dt><dd>${ymd(c.start_date)}</dd></div>
        <div><dt>${c.status === "aktiv" ? (c.inMinTerm ? "Mindestlaufzeit bis" : "Aktuelle Laufzeit bis") : "Vertragsende"}</dt><dd>${c.status === "aktiv" ? (c.inMinTerm ? ymd(c.minEnd) : c.periodEnd ? ymd(c.periodEnd) : "monatlich kündbar") : ymd(c.end_date)}</dd></div>
        ${c.status === "aktiv" ? `<div><dt>Kündigungsfrist</dt><dd>${c.notice_months} Monat${c.notice_months === 1 ? "" : "e"}${c.noticeBy ? ` – nächster Termin: Kündigung bis ${ymd(c.noticeBy)}` : " zum Monatsende"}</dd></div>
          <div><dt>Danach</dt><dd>${c.renew_months > 0 ? `verlängert sich jeweils um ${c.renew_months} Monate` : "monatlich kündbar"}</dd></div>` : ""}</dl>
      ${c.buyout_net != null ? `<div class="vt__buy"><div><small>Kaufoption ab ${ymd(c.buyout_from)}</small><b>${money(c.buyout_rest)} Restbetrag</b>
          <span>Kaufpreis ${money(c.buyout_net)} netto · bereits angerechnet ${money(c.credit)} (${String(c.credit_pct || 0).replace(".", ",")} % Ihrer Zahlungen)</span></div>
        <span class="vt__prog"><i style="width:${Math.min(100, c.credit / Math.max(1, c.buyout_net) * 100)}%"></i></span></div>` : ""}
    </div>`).join("")}</div>
    <p class="muted" style="margin:18px 0 0;font-size:13.5px">Fragen zu einem Vertrag, Änderung oder Kündigung? <a href="#chat">Schreiben Sie uns im Chat</a> – wir bestätigen alles schriftlich.</p>`
    : `<div class="empty">Sie haben derzeit keine laufenden Verträge.</div>`;
}

/* ---------- Konto ---------- */
async function viewAccount() {
  me = await api("/me");
  const since = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(window.RSChat.toDate(me.created_at));
  $("#acAvatar").textContent = initials(me.name); $("#acName").textContent = me.name;
  $("#acSub").textContent = `${me.company} · Kunde seit ${since}`;
  $("#vName").textContent = me.name; $("#vCo").textContent = me.company; $("#vMail").textContent = me.email; $("#vPhone").textContent = me.phone;
  $("#vSessions").textContent = me.sessions > 1 ? `auf ${me.sessions} Geräten` : "nur auf diesem Gerät";
  $("#logoutOthers").hidden = me.sessions < 2;
  $("#notifyEmail").checked = me.notify_email;
  $("#ctAvatar").textContent = initials(me.contact); $("#ctName").textContent = me.contact;
  $$("#main details.srow").forEach(d => d.open = false);
  $("#meName").textContent = me.name; $("#meAvatar").textContent = initials(me.name);
}
// Aufklappbare Zeilen: beim Öffnen Feld vorbelegen und fokussieren, andere schließen
$$("details.srow").forEach(d => d.addEventListener("toggle", () => {
  if (!d.open) return;
  $$("details.srow").forEach(x => { if (x !== d) x.open = false; });
  const f = $("form", d), inp = $("input", d);
  if (f?.dataset.field) inp.value = me?.[f.dataset.field] || "";
  setTimeout(() => inp?.focus(), 50);
}));
$$("form[data-field]").forEach(f => f.addEventListener("submit", async e => {
  e.preventDefault();
  try { await api("/settings", { method: "PATCH", body: { [f.dataset.field]: f.v.value } }); toast("Gespeichert"); viewAccount(); }
  catch (err) { toast(err.message); }
}));
$("#pwForm").next.addEventListener("input", e => {
  const v = e.target.value, score = Math.min(4, (v.length >= 10) + (v.length >= 14) + (/[A-ZÄÖÜ]/.test(v) && /[a-zäöüß]/.test(v)) + (/[\d\W_]/.test(v)));
  $("#pwBar").style.width = v ? [12, 30, 55, 80, 100][score] + "%" : "0";
  $("#pwBar").style.background = score < 2 ? "#ff9f0a" : "";
  $("#pwHint").textContent = !v ? "Mindestens 10 Zeichen – am besten ein Satz, den Sie sich gut merken können." : v.length < 10 ? `Noch ${10 - v.length} Zeichen` : ["Schwach", "Geht so", "Gut", "Stark", "Sehr stark"][score];
});
$("#pwForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  try {
    await api("/password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
    f.reset(); $("#pwBar").style.width = "0"; $("#pwErr").hidden = true; $("#rowPw").open = false; toast("Passwort geändert – andere Geräte wurden abgemeldet."); viewAccount();
  } catch (err) { $("#pwErr").textContent = err.message; $("#pwErr").hidden = false; }
});
$("#pwForm [data-cancel]").addEventListener("click", () => { $("#pwForm").reset(); $("#pwErr").hidden = true; $("#pwBar").style.width = "0"; $("#rowPw").open = false; });
$("#notifyEmail").addEventListener("change", async e => {
  try { await api("/settings", { method: "PATCH", body: { notify_email: e.target.checked } }); toast(e.target.checked ? "Sie erhalten E-Mails bei neuen Nachrichten." : "Keine E-Mails mehr bei neuen Nachrichten."); }
  catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
});
$("#logoutOthers").addEventListener("click", async () => {
  try { const r = await api("/logout-others", { method: "POST", body: {} }); toast(r.removed ? "Alle anderen Geräte wurden abgemeldet." : "Keine anderen Anmeldungen."); viewAccount(); }
  catch (err) { toast(err.message); }
});
$("#deleteReq").addEventListener("click", () => setTimeout(() => {
  const ta = $("#composer textarea"); if (ta && !ta.value) { ta.value = "Ich möchte meinen Zugang zum Kundenportal löschen lassen."; ta.dispatchEvent(new Event("input")); }
}, 300));
$("#logout").addEventListener("click", async () => { stopChat?.(); stopBadge?.(); await api("/logout", { method: "POST", body: {} }).catch(() => {}); me = null; show("login"); });


/* ---------- Terminanfrage ---------- */
let rq = { types: null, type: null, slots: [], days: {} };
const shortDT = iso => fmt(iso, { weekday: "short", day: "numeric", month: "short" }) + ", " + fmt(iso, { hour: "2-digit", minute: "2-digit" }) + " Uhr";
async function openRequest(projectId) {
  const [types, projects] = await Promise.all([rq.types || api("/booking-types"), api("/projects")]);
  rq.types = types; rq.slots = [];
  const f = $("#reqForm"); f.reset();
  $("#rTypes").innerHTML = types.map((t, i) => `<label class="rtype"><input type="radio" name="type" value="${esc(t.key)}" ${i === 0 ? "checked" : ""}><span><b>${esc(t.label)}</b><small>${t.minutes} Min. · ${esc(t.desc)}</small></span></label>`).join("");
  const act = projects.filter(p => p.status !== "abgeschlossen");
  $("#rProjWrap").hidden = !act.length;
  $("#rProj").innerHTML = `<option value="">Allgemein / kein bestimmtes Projekt</option>` + act.map(p => `<option value="${p.id}" ${p.id === +projectId ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  if (!projectId && act.length === 1) $("#rProj").value = act[0].id;
  $("#reqSheet").hidden = false; document.body.style.overflow = "hidden";
  await loadReqSlots();
}
function closeRequest() { $("#reqSheet").hidden = true; document.body.style.overflow = ""; }
async function loadReqSlots() {
  rq.type = $("#reqForm").type.value; rq.slots = [];
  $("#rDays").innerHTML = `<p class="muted rload">Freie Zeiten werden geladen …</p>`;
  rq.days = await api("/slots?type=" + encodeURIComponent(rq.type));
  const days = Object.keys(rq.days).sort().slice(0, 14);
  $("#rDays").innerHTML = days.length ? days.map(d => {
    const first = rq.days[d][0].start;
    return `<div class="rday"><div class="rday__h"><b>${fmt(first, { weekday: "short" })}</b><span>${fmt(first, { day: "numeric", month: "short" })}</span></div>
      <div class="rday__t">${rq.days[d].map(s => `<button type="button" class="rslot" data-start="${s.start}">${s.t}</button>`).join("")}</div></div>`;
  }).join("") : `<p class="muted rload">In den nächsten Wochen ist leider nichts mehr frei. Kreuzen Sie „Ich bin flexibel“ an – wir melden uns mit einem Vorschlag.</p>`;
  syncReq();
}
function syncReq() {
  $$(".rslot").forEach(b => { const i = rq.slots.indexOf(b.dataset.start); b.classList.toggle("on", i >= 0); b.dataset.n = i >= 0 ? i + 1 : ""; b.disabled = i < 0 && rq.slots.length >= 3; });
  const f = $("#reqForm"), t = rq.types?.find(x => x.key === rq.type);
  $("#rSummary").innerHTML = rq.slots.length ? `<b>${esc(t?.label || "")}</b> · ${rq.slots.map(shortDT).join(" · ")}` : f.flexible.checked ? `<b>${esc(t?.label || "")}</b> · flexibel` : `<span class="muted">Wählen Sie bis zu drei Zeiten – oder „flexibel“.</span>`;
  $("#rSend").disabled = !rq.slots.length && !f.flexible.checked;
}
$("#reqForm").addEventListener("change", e => { if (e.target.name === "type") loadReqSlots(); if (e.target.name === "flexible") syncReq(); });
$("#rDays").addEventListener("click", e => {
  const b = e.target.closest(".rslot"); if (!b) return;
  const i = rq.slots.indexOf(b.dataset.start);
  if (i >= 0) rq.slots.splice(i, 1); else if (rq.slots.length < 3) rq.slots.push(b.dataset.start);
  syncReq();
});
$("#reqForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, btn = $("#rSend"); btn.disabled = true;
  try {
    await api("/requests", { method: "POST", body: { type: rq.type, project_id: f.project_id.value || null, slots: rq.slots, flexible: f.flexible.checked, message: f.message.value } });
    closeRequest(); toast("Anfrage gesendet – wir bestätigen Ihnen den Termin in Kürze.");
    if (location.hash === "#termine") viewAppointments(); else location.hash = "termine";
  } catch (err) { toast(err.message); if (/vergeben/.test(err.message)) loadReqSlots(); btn.disabled = false; }
});
$("#reqSheet").addEventListener("click", e => { if (e.target.id === "reqSheet" || e.target.closest("[data-close]")) closeRequest(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#reqSheet").hidden) closeRequest(); });
document.addEventListener("click", e => { const b = e.target.closest("[data-req]"); if (b) { e.preventDefault(); openRequest(b.dataset.req).catch(err => toast(err.message)); } });

async function renderRequests() {
  const list = await api("/requests");
  const LBL = { offen: ["Angefragt", "wait"], angenommen: ["Bestätigt", "ok"], abgelehnt: ["Neuer Vorschlag folgt", "no"] };
  $("#reqList").innerHTML = list.length ? `<p class="listhead" style="margin-top:0">Ihre Anfragen</p>` + list.map(r => `
    <div class="rreq rreq--${LBL[r.status]?.[1] || "no"}">
      <div class="rreq__ico">📅</div>
      <div class="rreq__body"><h3>${esc(r.label)} <span class="muted">· ${r.minutes} Min.${r.project ? " · " + esc(r.project) : ""}</span></h3>
        <p>${r.status === "offen" ? (r.slots.length ? "Ihre Wunschtermine: " + r.slots.map(s => shortDT(s.start)).join(" · ") : "Flexibel – wir schlagen Ihnen einen Termin vor.") : r.status === "angenommen" ? "Der Termin ist bestätigt und steht unten in Ihrer Liste." : esc(r.answer || "Leider hat keiner der Wunschtermine gepasst. Wir melden uns mit einem neuen Vorschlag.")}</p></div>
      <div class="rreq__side"><span class="pill rpill--${LBL[r.status]?.[1] || "no"}">${LBL[r.status]?.[0] || esc(r.status)}</span>${r.status === "offen" ? `<button class="link rreq__undo" data-undo="${r.id}">Zurückziehen</button>` : ""}</div>
    </div>`).join("") : "";
}
$("#reqList").addEventListener("click", async e => {
  const b = e.target.closest("[data-undo]"); if (!b || !confirm("Anfrage zurückziehen?")) return;
  try { await api(`/requests/${b.dataset.undo}`, { method: "DELETE", body: {} }); toast("Anfrage zurückgezogen"); renderRequests(); } catch (err) { toast(err.message); }
});

/* ---------- Passwort vergessen / neu setzen ---------- */
const resetToken = (location.hash.match(/passwort=([a-f0-9]{64})/) || [])[1];
const gate = id => { ["loginForm", "forgotForm", "resetForm"].forEach(x => $("#" + x).hidden = x !== id); };
$("#toForgot").addEventListener("click", () => { gate("forgotForm"); $("#forgotForm").email.value = $("#loginForm").email.value; });
$("#backLogin").addEventListener("click", () => gate("loginForm"));
$("#forgotForm").addEventListener("submit", async e => {
  e.preventDefault(); const b = $("button[type=submit]", e.target); b.disabled = true;
  const r = await fetch("/api/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e.target.email.value }) }).then(x => x.json()).catch(() => ({}));
  $("#forgotOk").textContent = r.message || "Falls es einen Zugang gibt, ist eine E-Mail unterwegs."; $("#forgotOk").hidden = false; b.disabled = false;
});
$("#resetForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, err = $("#resetErr");
  if (f.password.value !== f.password2.value) { err.textContent = "Die beiden Passwörter stimmen nicht überein."; err.hidden = false; return; }
  const r = await fetch("/api/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, password: f.password.value }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = d.error || "Fehler"; err.hidden = false; return; }
  history.replaceState(null, "", "/portal/"); gate("loginForm"); toast("Passwort gespeichert – bitte jetzt anmelden.");
});

/* ---------- Start ---------- */
if (inviteToken) showInvite();
else if (resetToken) { show("login"); gate("resetForm"); }
else start().catch(() => show("login"));
