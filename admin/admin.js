/* Reeder Software – Admin-Board */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Europe/Berlin";
const fmt = (iso, o) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, ...o }).format(new Date(iso));
const dayBox = iso => `<div class="date"><span>${fmt(iso, { month: "short" })}</span><b>${fmt(iso, { day: "numeric" })}</b></div>`;
const STATUS = { neu: "Neu", bestaetigt: "Bestätigt", abgesagt: "Abgesagt", erledigt: "Erledigt" };
const DAYS = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/* ---------- Eigene Dialoge (Browser-Rückfragen werden in manchen Umgebungen blockiert) ---------- */
const UI = (() => {
  function open(html, focusSel) {
    const m = document.createElement("div"); m.className = "modal uimodal";
    m.innerHTML = `<div class="card uidlg">${html}</div>`; document.body.appendChild(m);
    setTimeout(() => (m.querySelector(focusSel || "[data-ok]") || m.querySelector("button"))?.focus(), 30);
    return m;
  }
  const btns = (ok, cancel, danger) => `<div class="uidlg__btns">${cancel ? `<button class="btn btn--ghost" data-no>${esc(cancel)}</button>` : ""}<button class="btn ${danger ? "btn--danger" : "btn--grad"}" data-ok>${esc(ok)}</button></div>`;
  function confirm(text, { title = "Sind Sie sicher?", ok = "Bestätigen", cancel = "Abbrechen", danger = false } = {}) {
    return new Promise(res => {
      const m = open(`<h2>${esc(title)}</h2><p>${esc(text).replace(/\n/g, "<br>")}</p>${btns(ok, cancel, danger)}`);
      const done = v => { m.remove(); res(v); };
      m.addEventListener("click", e => { if (e.target.closest("[data-ok]")) done(true); else if (e.target.closest("[data-no]") || e.target === m) done(false); });
      m.addEventListener("keydown", e => { if (e.key === "Escape") done(false); });
    });
  }
  function prompt(title, { text = "", label = "", value = "", type = "text", placeholder = "", ok = "Übernehmen", multiline = false } = {}) {
    return new Promise(res => {
      const field = multiline ? `<textarea rows="3" data-in placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input type="${type}" data-in value="${esc(value)}" placeholder="${esc(placeholder)}">`;
      const m = open(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}<label>${esc(label)}${field}</label>${btns(ok, "Abbrechen")}`, "[data-in]");
      const done = v => { m.remove(); res(v); };
      m.addEventListener("click", e => { if (e.target.closest("[data-ok]")) done(m.querySelector("[data-in]").value); else if (e.target.closest("[data-no]") || e.target === m) done(null); });
      m.addEventListener("keydown", e => { if (e.key === "Escape") done(null); if (e.key === "Enter" && !multiline) done(m.querySelector("[data-in]").value); });
    });
  }
  function choice(text, options, { title = "Bitte auswählen" } = {}) {
    return new Promise(res => {
      const m = open(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="uidlg__btns">${options.map((o, i) => `<button class="btn ${o.primary ? "btn--grad" : "btn--ghost"}" data-i="${i}">${esc(o.label)}</button>`).join("")}</div>`);
      const done = v => { m.remove(); res(v); };
      m.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) done(options[+b.dataset.i].value); else if (e.target === m) done(null); });
    });
  }
  function link(title, text, url) {
    const m = open(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="copy"><input readonly value="${esc(url)}"><button class="btn" data-copy>Kopieren</button></div>${btns("Fertig")}`);
    m.addEventListener("click", e => { if (e.target.closest("[data-copy]")) { navigator.clipboard?.writeText(url); toast("Link kopiert"); } if (e.target.closest("[data-ok]") || e.target === m) m.remove(); });
  }
  return { confirm, prompt, choice, link };
})();
window.UI = UI;

/* ---------- Linien-Icons (statt Emojis – sitzen exakt mittig in Kreisen und Kacheln) ---------- */
const ICO = (() => {
  const cal = '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
  const doc = '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>';
  const p = {
    chat: '<path d="M4.5 5.5h15v10.5H10l-5.5 4z"/>', termin: cal, buchung: cal + '<path d="m9 15 2 2 4-4"/>',
    anmerkung: '<path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5z"/><path d="m13.5 7 3.5 3.5"/>',
    lead: '<path d="M12 3.5l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 15.9l-5 2.8 1.2-5.6L4 9.3l5.6-.6z"/>',
    summary: doc + '<path d="M10 13h6M10 17h4"/>', protokoll: doc + '<path d="M10 13h6M10 17h4"/>', angebot: doc + '<path d="M10 14h6"/>', dokument: doc,
    overdue: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.8M9.5 2.5h5"/>',
    kontakt: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    projekt: '<path d="M14 4.5c2.5-1 5-1 5.5-.5s.5 3-.5 5.5L13 16l-5-5z"/><path d="M8 11l-3 .5L3.5 14l4 .5M13 16l-.5 3L10 20.5l-.5-4M6 18c-1 1-1.5 2.5-1.5 2.5S6 20 7 19"/>',
    prototyp: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    zahlung: '<rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>',
    phase: '<path d="M5 12h14M13 6l6 6-6 6"/>', status: '<circle cx="12" cy="12" r="3.5"/>', automatik: '<path d="M13 2.5 5.5 13.5h5.5l-1 8 7.5-11h-5.5z"/>',
  };
  return k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[k] || p.status}</svg>`;
})();
window.ICO = ICO;

/* ---------- Dropdown im Board-Design (statt nativer Auswahlfelder) ----------
   DD.html(key, options, value, { label, trigger }) → Markup;  DD.on(key, fn) → fn(value) bei Auswahl.
   options: { v, l, n?, av?, danger? } oder { sep: "Überschrift" }.  trigger: fester Button-Text (Aktionsmenü). */
const DD = (() => {
  const reg = {};
  const chev = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function html(key, options, value, { label = "", trigger = "", align = "", field = "", placeholder = "" } = {}) {
    const items = options.filter(o => !o.sep), cur = items.find(o => String(o.v) === String(value)) || (placeholder ? { v: "", l: placeholder } : items[0] || { l: "" });
    const active = !trigger && items[0] && String(cur.v) !== String(items[0].v);
    return `<div class="dd ${trigger ? "dd--menu" : ""} ${active && !field ? "dd--set" : ""} ${field ? "dd--field" : ""} ${align === "right" ? "dd--right" : ""}" data-dd="${esc(key)}">${field ? `<input type="hidden" name="${esc(field)}" value="${esc(cur.v ?? "")}">` : ""}
      <button type="button" class="dd__btn" aria-haspopup="listbox">${label ? `<small>${esc(label)}</small>` : ""}<span>${esc(trigger || cur.l)}</span>${chev}</button>
      <div class="dd__menu" role="listbox">${options.map(o => o.sep ? `<p class="dd__sep">${esc(o.sep)}</p>`
        : `<button type="button" data-v="${esc(o.v)}" class="${!trigger && String(o.v) === String(cur.v) ? "on" : ""} ${o.danger ? "danger" : ""}">${o.av ? `<span class="avatar avatar--xs">${esc(o.av)}</span>` : ""}<span>${esc(o.l)}</span>${o.n != null ? `<em>${esc(o.n)}</em>` : ""}</button>`).join("")}</div></div>`;
  }
  document.addEventListener("click", e => {
    const item = e.target.closest(".dd__menu [data-v]"), btn = e.target.closest(".dd__btn");
    if (item) {
      const dd = item.closest(".dd"), inp = dd.querySelector(":scope > input[type=hidden]"); dd.classList.remove("open");
      if (inp) { inp.value = item.dataset.v; dd.querySelector(".dd__btn > span").textContent = item.querySelector("span:not(.avatar)").textContent;
        dd.querySelectorAll(".dd__menu [data-v]").forEach(b => b.classList.toggle("on", b === item)); inp.dispatchEvent(new Event("change", { bubbles: true })); }
      reg[dd.dataset.dd]?.(item.dataset.v, dd); return;
    }
    $$(".dd.open").forEach(d => { if (!btn || d !== btn.closest(".dd")) d.classList.remove("open"); });
    if (btn) btn.closest(".dd").classList.toggle("open");
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $$(".dd.open").forEach(d => d.classList.remove("open")); });
  return { html, on: (key, fn) => { reg[key] = fn; } };
})();
window.DD = DD;

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 3000); }
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api/admin" + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") { showLogin(); throw new Error("Bitte anmelden."); }
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}

/* ---------- Anmeldung ---------- */
function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const d = await api("/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
    $("#loginErr").hidden = true;
    if (d.need2fa) return window.AUTH.askCode(d.challenge);
    if (d.to === "/portal/") { location.href = "/portal/"; return; }   // Kundenkonto → Kundenportal
    start();
  }
  catch (err) { $("#loginErr").textContent = err.message; $("#loginErr").hidden = false; }
});
$("#logout").addEventListener("click", async () => { await api("/logout", { method: "POST", body: {} }).catch(() => {}); ME = null; showLogin(); });

/* ---------- Navigation ---------- */
// Ansichten: board.js stellt Cockpit, Posteingang, Projekt-Board und Team bereit
let ME = null;
const views = {
  cockpit: () => window.BOARD.cockpit(), posteingang: () => window.BOARD.inbox(),
  kunden: () => window.loadKunden ? window.loadKunden() : Promise.resolve(),
  projekte: () => window.BOARD.projects(), termine: loadTermine, anfragen: () => Promise.all([window.loadVertrieb(), loadRequests()]),
  team: () => window.BOARD.team(), einstellungen: loadSettings, finanzen: () => window.loadFinance(), software: () => window.loadSoftware(), arbeitsplatz: () => window.WORK.load(), kennzahlen: () => window.loadKpi(), support: () => window.SUPPORT.load(),
  hardware: () => Promise.resolve(),   // Seite eines Hardware-Projekts, zeichnet sich selbst (admin/hardware/hardware.js)
};
const OWNER_VIEWS = ["anfragen", "team", "finanzen", "kennzahlen"];
/* ---------- Software und Hardware in einem Board ---------- */
// Es gibt nur eine Projektliste. Jedes Projekt trägt seinen Bereich; Listen zeigen ihn als kleines Schild.
// Website-Anfragen tragen das Schild „Website“ (technisch gehören sie zum Bereich Software)
const bereichTag = p => `<span class="bereich bereich--${p.bereich === "hardware" ? "hw" : "sw"}">${p.bereich === "hardware" ? "Hardware" : p.anfrage_art === "website" || p.kind === "Website" ? "Website" : "Software"}</span>`;
window.bereichTag = bereichTag;
/** Schilder für alle Bereiche, in denen ein Kunde Projekte hat */
const bereicheTags = c => ["software", "hardware"].filter(b => (c.projects || []).some(p => (p.bereich || "software") === b)).map(b => bereichTag({ bereich: b })).join(" ");
/** Kurzform für enge Stellen wie Kalenderkacheln: SW oder HW (leer ohne Projekt) */
const bereichKurz = p => p ? `<em class="bkurz bkurz--${p.bereich === "hardware" ? "hw" : "sw"}" title="${p.bereich === "hardware" ? "Hardware" : "Software"}-Termin">${p.bereich === "hardware" ? "HW" : "SW"}</em>` : "";
/** Adresse der Projektseite: Hardware-Projekte haben ihre eigene Seite */
const projektHref = p => p.bereich === "hardware" ? `#hardware/projekt/${p.id}` : `#projekte/${p.id}`;
function route() {
  if (!ME) return;
  let v = location.hash.slice(1).split("/")[0] || (ME.owner ? "cockpit" : "arbeitsplatz");
  if (v === "uebersicht") v = "cockpit";
  if (v === "verfuegbarkeit") { v = "termine"; termTab = "verfuegbarkeit"; } else if (v === "termine") termTab = "kalender";
  if (!views[v] || (!ME.owner && OWNER_VIEWS.includes(v))) v = "cockpit";
  $$("[data-section]").forEach(s => s.hidden = s.dataset.section !== v);
  $$(".side nav a").forEach(a => a.classList.toggle("on", a.dataset.view === v || (v === "hardware" && a.dataset.view === "projekte")));
  // Schmale Fenster: Menü-Knopf zeigt den aktuellen Bereich, nach dem Wechsel klappt das Menü zu
  { const t = $("#navAktuell"), on = $(".side nav a.on span"); if (t) t.textContent = on?.textContent || "Menü"; menuZu(); }
  window.onViewChange?.(v);
  views[v]().catch(e => toast(e.message));
}
addEventListener("hashchange", route);

async function start() {
  ME = await api("/me");
  $("#login").hidden = true; $("#app").hidden = false;
  document.body.classList.toggle("is-dev", !ME.owner);
  $$("[data-owner]").forEach(el => el.hidden = !ME.owner);
  $("#mailBanner").hidden = ME.mail.ready || !ME.owner;
  $("#meAv").textContent = ME.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  $("#meName").textContent = ME.name; $("#meRole").textContent = ME.roleLabel;
  if ($("#nameForm")) $("#nameForm").name.value = ME.name;
  route(); refreshBadges();
  clearInterval(start.h); start.h = setInterval(() => { if (!document.hidden) refreshBadges().catch(() => {}); }, 20000);
}
window.updateBadges = () => refreshBadges().catch(() => {});
window.addEventListener("hashchange", () => { if (/^#(anfragen|termine)/.test(location.hash)) refreshBadges().catch(() => {}); });
async function refreshBadges() {
  const o = await api("/cockpit");
  const set = (el, n) => { if (!el) return; el.hidden = !n; el.textContent = n; };
  set($("#badgeInbox"), o.unread + o.openRequests);
  const bt = $("#badgeTimer"); if (bt) bt.hidden = !o.timer;
  set($("#badgeSupport"), o.support || 0);
  // Zähler wie bei einem Messenger: alles, was seit dem letzten Öffnen des Bereichs dazugekommen ist
  const seit = k => localStorage.getItem(k) || "", neu = (liste, k) => (liste || []).filter(t => String(t).replace(" ", "T") > seit(k)).length;
  if (location.hash.startsWith("#anfragen")) localStorage.setItem("rs-gesehen-vertrieb", new Date().toISOString().slice(0, 19));
  if (location.hash.startsWith("#termine")) localStorage.setItem("rs-gesehen-termine", new Date().toISOString().slice(0, 19));
  set($("#badgeAnfragen"), Math.max((o.newLeads || 0) + (o.newBookings || 0), neu(o.kontakteNeu, "rs-gesehen-vertrieb"))); set($("#badgeCockpit"), o.nudges || 0);
  set($("#badgeTermine"), neu(o.termineNeu, "rs-gesehen-termine"));
  return o;
}

/* ---------- Team-Einladung annehmen ---------- */
const teamToken = (location.hash.match(/einladung=([a-f0-9]{48})/) || [])[1];
async function showTeamInvite() {
  $("#app").hidden = true; $("#login").hidden = false; $("#loginForm").hidden = true; $("#teamInvite").hidden = false;
  try {
    const i = await api("/invite/" + teamToken);
    $("#tiHello").textContent = `Willkommen im Team, ${i.name.split(" ")[0]}.`;
    $("#tiSub").textContent = `Ihr Zugang als ${i.role}. Legen Sie Ihr Passwort fest – danach sind Sie direkt angemeldet.`;
    $("#tiEmail").value = i.email;
  } catch (err) { $("#tiHello").textContent = "Link nicht mehr gültig."; $("#tiSub").textContent = err.message; $$("#teamInvite label, #teamInvite button").forEach(x => x.hidden = true); }
}
$("#teamInvite").addEventListener("submit", async e => {
  e.preventDefault(); const f = new FormData(e.target);
  if (f.get("password") !== f.get("password2")) { $("#tiErr").textContent = "Die Passwörter stimmen nicht überein."; $("#tiErr").hidden = false; return; }
  try { await api("/invite/" + teamToken, { method: "POST", body: { password: f.get("password") } }); history.replaceState(null, "", "/admin/#cockpit"); $("#teamInvite").hidden = true; $("#loginForm").hidden = false; start(); }
  catch (err) { $("#tiErr").textContent = err.message; $("#tiErr").hidden = false; }
});

/* ---------- Termine: Kalender (kalender.js) + Verfügbarkeit ---------- */
let termTab = "kalender";
async function loadTermine() {
  $("#tKalender").hidden = termTab !== "kalender"; $("#tVerfuegbarkeit").hidden = termTab !== "verfuegbarkeit";
  $(".calbar").hidden = termTab !== "kalender";
  if (termTab === "verfuegbarkeit") { $("#calTitle").textContent = "Arbeitszeiten & Verfügbarkeit"; $("#calSub").textContent = "Nur in diesen Zeiten können Termine gebucht werden – auf der Website und im Kundenportal."; return loadAvailability(); }
  return window.CAL.load();
}
$("#toAvail").addEventListener("click", () => { termTab = "verfuegbarkeit"; loadTermine().catch(err => toast(err.message)); });
$("#backCal").addEventListener("click", () => { termTab = "kalender"; loadTermine().catch(err => toast(err.message)); });

/* ---------- Projektanfragen ---------- */
const RSTATUS = ["neu", "in Bearbeitung", "Angebot", "gewonnen", "abgelehnt", "erledigt"];
async function loadRequests() {
  const rows = await api("/requests");
  $("#requests").innerHTML = rows.length ? rows.map(q => `
    <details class="bk" data-id="${q.id}" ${q.status === "neu" ? "open" : ""}>
      <summary>${dayBox(q.created_at.replace(" ", "T") + "Z")}
        <div><h3 style="margin:0">${esc(q.name)}${q.company ? ` · <span style="font-weight:400">${esc(q.company)}</span>` : ""}</h3>
        <p style="margin:2px 0 0;color:var(--muted)">${esc(q.kinds || "Projektanfrage")}${q.model ? " · " + esc(q.model) : ""}</p></div>
        <span class="pill ${q.status === "neu" ? "pill--neu" : ""}">${esc(q.status)}</span></summary>
      <div class="bk__body">
        <div><dl><dt>E-Mail</dt><dd><a href="mailto:${esc(q.email)}">${esc(q.email)}</a></dd><dt>Telefon</dt><dd>${esc(q.phone || "–")}</dd>
          <dt>Budget</dt><dd>${esc(q.budget || "–")}</dd><dt>Start</dt><dd>${esc(q.timing || "–")}</dd><dt>Modell</dt><dd>${esc(q.model || "–")}</dd></dl>
          <div class="bk__msg">${esc(q.description)}</div></div>
        <div class="bk__actions">
          <label>Status<select data-status>${RSTATUS.map(s => `<option ${s === q.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Interne Notiz<textarea rows="4" data-note>${esc(q.note || "")}</textarea></label>
          <div class="row"><button class="btn btn--sm" data-save>Speichern</button><a class="btn btn--ghost btn--sm" href="mailto:${esc(q.email)}?subject=${encodeURIComponent("Ihre Anfrage bei Reeder Software")}">Antworten</a></div>
        </div>
      </div>
    </details>`).join("") : `<div class="empty">Noch keine Projektanfragen.</div>`;
}
$("#requests").addEventListener("click", async e => {
  const btn = e.target.closest("[data-save]"); if (!btn) return;
  const card = btn.closest(".bk");
  try { await api(`/requests/${card.dataset.id}`, { method: "PATCH", body: { status: $("[data-status]", card).value, note: $("[data-note]", card).value } }); toast("Gespeichert"); loadRequests(); refreshBadges(); }
  catch (err) { toast(err.message); }
});

/* ---------- Verfügbarkeit ---------- */
let av = null;
async function loadAvailability() { av = await api("/availability"); renderAvailability(); }
function renderAvailability() {
  $("#weekly").innerHTML = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const wins = av.weekly[d] || [];
    return `<div class="day" data-day="${d}">
      <label class="day__name"><input type="checkbox" data-on ${wins.length ? "checked" : ""}> ${DAYS[d]}</label>
      <div class="wins">${wins.length ? wins.map((w, i) => `<div class="win"><input type="time" value="${w[0]}" step="900" data-a> – <input type="time" value="${w[1]}" step="900" data-b><button class="x" data-del="${i}" title="Entfernen">✕</button></div>`).join("") + `<button class="link" data-addwin style="justify-self:start;font-size:13.5px">+ Zeitfenster</button>` : `<span style="color:var(--muted);padding-top:8px">Nicht verfügbar</span>`}</div>
    </div>`;
  }).join("");
  $("#types").innerHTML = Object.entries(av.types).map(([k, t]) => `
    <div class="typ" data-type="${k}"><b>${esc(t.label)}${t.portal ? ' <small style="font-weight:500;color:var(--muted)">· nur Kundenportal</small>' : ""}</b>
      <label>Dauer<span class="unit"><input type="number" min="10" max="480" value="${t.minutes}" data-min> Min</span></label>
      <label>Puffer<span class="unit"><input type="number" min="0" max="120" value="${t.buffer}" data-buf> Min</span></label>
      <label class="check"><input type="checkbox" data-active ${t.active !== false ? "checked" : ""}> aktiv</label></div>`).join("");
  $("#step").value = av.step; $("#leadHours").value = av.leadHours; $("#horizonDays").value = av.horizonDays;
  $("#blocked").innerHTML = (av.blocked || []).map((b, i) => `<div class="blk" data-i="${i}"><input type="date" value="${b.from}" data-from><input type="date" value="${b.to}" data-to><input placeholder="Notiz, z. B. Urlaub" value="${esc(b.note || "")}" data-n><button class="x" data-delblock title="Entfernen">✕</button></div>`).join("") || `<p class="hint" style="margin:0 0 10px">Keine Sperrzeiten eingetragen.</p>`;
}
function collect() {
  const weekly = {};
  $$("#weekly .day").forEach(d => { weekly[d.dataset.day] = $$(".win", d).map(w => [$("[data-a]", w).value, $("[data-b]", w).value]); });
  const types = {};
  $$("#types .typ").forEach(t => { types[t.dataset.type] = { minutes: +$("[data-min]", t).value, buffer: +$("[data-buf]", t).value, active: $("[data-active]", t).checked }; });
  const blocked = $$("#blocked .blk").map(b => ({ from: $("[data-from]", b).value, to: $("[data-to]", b).value, note: $("[data-n]", b).value }));
  return { weekly, types, blocked, step: +$("#step").value, leadHours: +$("#leadHours").value, horizonDays: +$("#horizonDays").value };
}
$("#weekly").addEventListener("click", e => {
  const day = e.target.closest(".day"); if (!day) return;
  const d = day.dataset.day;
  if (e.target.matches("[data-del]")) { Object.assign(av, collect()); av.weekly[d].splice(+e.target.dataset.del, 1); renderAvailability(); }
  if (e.target.matches("[data-addwin]")) { Object.assign(av, collect()); const last = av.weekly[d].at(-1); av.weekly[d].push(last ? [last[1], "17:00"] : ["09:00", "17:00"]); renderAvailability(); }
});
$("#weekly").addEventListener("change", e => {
  if (!e.target.matches("[data-on]")) return;
  Object.assign(av, collect()); const d = e.target.closest(".day").dataset.day;
  av.weekly[d] = e.target.checked ? [["09:00", "12:00"], ["13:00", "17:00"]] : []; renderAvailability();
});
$("#addBlock").addEventListener("click", () => { Object.assign(av, collect()); const t = new Date().toISOString().slice(0, 10); (av.blocked ||= []).push({ from: t, to: t, note: "" }); renderAvailability(); });
$("#blocked").addEventListener("click", e => { if (!e.target.matches("[data-delblock]")) return; Object.assign(av, collect()); av.blocked.splice(+e.target.closest(".blk").dataset.i, 1); renderAvailability(); });
$("#saveAvail").addEventListener("click", async () => {
  try { av = await api("/availability", { method: "PUT", body: collect() }); renderAvailability(); toast("Verfügbarkeit gespeichert – die Website zeigt sie sofort an."); }
  catch (err) { toast(err.message); }
});

/* ---------- Einstellungen ---------- */
let setTab = null;
async function loadSettings() {
  const sub = location.hash.split("/")[1];
  setTab = (sub && $(`#setTabs [data-t="${sub}"]`) ? sub : null) || setTab || (ME.owner ? "firma" : "konto");
  if (!ME.owner) setTab = "konto";
  $$("#setTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === setTab));
  segZeigen($("#setTabs"));
  $$("[data-set]").forEach(d => d.hidden = d.dataset.set !== setTab);
  if (!ME.owner) return;
  const s = await api("/settings");
  const c = $("#companyForm"); for (const [k, v] of Object.entries(s.company)) if (c[k]) c[k].value = v ?? "";
  // Zweite Firma: dasselbe Formular noch einmal, mit Schalter „aktiv“
  let h = $("#companyHwForm");
  if (!h) {
    h = c.cloneNode(true); h.id = "companyHwForm"; h.style.marginTop = "18px";
    h.querySelector("h2").innerHTML = `Reeder Hardware GmbH <small class="hint" style="font-weight:400;margin:0">– zweite Firma für Hardware-Projekte</small>`;
    h.querySelector("h2").insertAdjacentHTML("afterend", `<label class="check span2"><input type="checkbox" name="aktiv"> <span><b>Hardware-Projekte über diese Firma abrechnen</b> – Angebote und Rechnungen zu Hardware-Projekten tragen dann diese Stammdaten und einen eigenen Nummernkreis (ANH-…, REH-…). Erst einschalten, wenn die Firma gegründet ist. Ohne Haken läuft alles über die Software GmbH.</span></label>`);
    c.after(h);
    h.addEventListener("submit", async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(h)); body.aktiv = h.aktiv.checked;
      try { const r = await api("/settings/company-hardware", { method: "PUT", body }); h.iban.value = r.iban || ""; toast("Hardware GmbH gespeichert"); } catch (err) { toast(err.message); h.aktiv.checked = false; } });
  }
  for (const [k, v] of Object.entries(s.companyHardware || {})) if (h[k] && k !== "aktiv") h[k].value = v ?? "";
  h.aktiv.checked = !!s.companyHardware?.aktiv;
  const m = $("#mailForm"); m.fromName.value = s.mail.fromName; m.fromAddress.value = s.mail.fromAddress; m.notifyAddress.value = s.mail.notifyAddress;
  const sm = $("#smtpForm"); sm.host.value = s.smtp.host; sm.port.value = s.smtp.port; sm.user.value = s.smtp.user; sm.pass.value = "";
  sm.pass.placeholder = s.smtp.hasPass ? "•••••••• (gespeichert – leer lassen = unverändert)" : "Passwort Ihres Postfachs";
  $("#smtpInfo").innerHTML = s.mailStatus.ready ? `<span class="pill pill--bestaetigt">● Versand aktiv</span> über ${esc(s.mailStatus.host)}`
    : `<span class="pill pill--abgesagt">● Noch nicht eingerichtet</span> Tragen Sie die SMTP-Daten Ihres Postfachs ein (stehen bei Ihrem Mail-Anbieter, z. B. IONOS, Strato, Google Workspace).`;
  $("#calUrl").value = s.calendarUrl;
  const mf = $("#meetForm"); if (mf) { mf.mode.value = s.meeting.mode; mf.url.value = s.meeting.url || ""; mf.url.closest("label").hidden = s.meeting.mode !== "fixed"; }
  if (setTab === "automatik") return loadAutomation();
  if (setTab === "vertrag") return loadContract();
  if (setTab === "betrieb") return window.SUPPORT.loadOps();
  if (setTab === "livegang") return window.AUTH.loadGoLive();
  if (setTab === "ki") return window.AIUI.load();
  if (setTab === "covered") return window.COVUI.load();
  if (setTab === "konto") window.AUTH.loadTfa();
  const ob = await api("/outbox");
  $("#outbox").innerHTML = ob.length ? ob.map(m => `<div class="ob"><h4>${esc(m.subject)}</h4><p>an ${esc(m.to_addr)} · ${fmt(m.created_at.replace(" ", "T") + "Z", { dateStyle: "short", timeStyle: "short" })} · ${esc(m.status)}${m.error ? " – " + esc(m.error) : ""}</p><button type="button" class="link ob__ansehen" data-mail-id="${+m.id}">Ansehen</button><details><summary>Inhalt</summary><pre>${esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</pre></details></div>`).join("") : `<div class="empty">Noch keine E-Mails.</div>`;
}
$("#setTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { history.replaceState(null, "", "#einstellungen/" + b.dataset.t); setTab = b.dataset.t; loadSettings().catch(err => toast(err.message)); } });
$("#companyForm").addEventListener("submit", async e => {
  e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
  try { const r = await api("/settings/company", { method: "PUT", body }); e.target.iban.value = r.iban || ""; toast("Unternehmensdaten gespeichert"); } catch (err) { toast(err.message); }
});
$("#smtpForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  try { const r = await api("/settings/smtp", { method: "PUT", body: { host: f.host.value, port: f.port.value, user: f.user.value, pass: f.pass.value } });
    toast(r.mailStatus.ready ? "Gespeichert – Versand ist aktiv. Senden Sie zur Sicherheit eine Testmail." : "Gespeichert – Zugang noch unvollständig."); ME.mail = r.mailStatus; $("#mailBanner").hidden = r.mailStatus.ready; loadSettings(); }
  catch (err) { toast(err.message); }
});
$("#testMail").addEventListener("click", async e => {
  e.target.disabled = true;
  try { const r = await api("/settings/test-mail", { method: "POST", body: {} }); toast(`Testmail an ${r.to} verschickt – bitte Postfach prüfen.`); }
  catch (err) { toast("Fehlgeschlagen: " + err.message); } finally { e.target.disabled = false; loadSettings(); }
});
$("#mailForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  try { await api("/settings", { method: "PUT", body: { fromName: f.fromName.value, fromAddress: f.fromAddress.value, notifyAddress: f.notifyAddress.value } }); toast("Gespeichert"); } catch (err) { toast(err.message); }
});
$("#meetForm")?.addEventListener("change", e => { if (e.target.name === "mode") e.currentTarget.url.closest("label").hidden = e.target.value !== "fixed"; });
$("#meetForm")?.addEventListener("submit", async e => { e.preventDefault(); const f = e.target; try { await api("/settings/meeting", { method: "PUT", body: { mode: f.mode.value, url: f.url.value } }); toast("Gespeichert – neue Einladungen verwenden diese Einstellung."); } catch (err) { toast(err.message); } });
$("#copyCal").addEventListener("click", () => { navigator.clipboard?.writeText($("#calUrl").value); toast("Adresse kopiert"); });
$("#resetCal").addEventListener("click", async () => { if (!(await UI.confirm("Bestehende Kalender-Abos funktionieren danach nicht mehr.", { title: "Neue Adresse erzeugen?", ok: "Neu erzeugen", danger: true }))) return; const r = await api("/calendar/reset", { method: "POST", body: {} }); $("#calUrl").value = r.calendarUrl; toast("Neue Adresse erzeugt"); });
// Eigener Name: steht im Board und im Gruß jeder Kundenmail
$("#nameForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, name = f.name.value.trim(); if (!name) return;
  try { const r = await api("/me", { method: "PATCH", body: { name } }); ME.name = r.name;
    $("#meName").textContent = r.name; $("#meAv").textContent = r.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase(); toast("Name gespeichert"); }
  catch (err) { toast(err.message); }
});
$("#pwForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  try { await api("/password", { method: "POST", body: { current: f.current.value, next: f.next.value } }); f.reset(); toast("Passwort geändert"); } catch (err) { toast(err.message); }
});

/* ---------- Start ---------- */
// erst starten, wenn alle Skripte (auch kunden.js) geladen sind
addEventListener("DOMContentLoaded", () => teamToken ? showTeamInvite() : window.AUTH?.fromHash() || start().catch(() => showLogin()));


/* ---------- Einstellungen: Automatik ---------- */
const AUTO_RULES = [
  { k: "reminders", t: "Terminerinnerungen an Kunden", d: "E-Mail mit Uhrzeit und Video-Link vor jedem Termin – weniger vergessene Termine.", sub: [["reminder24", "24 Stunden vorher", "bool"], ["reminder1", "1 Stunde vorher", "bool"]] },
  { k: "leadFollowup", t: "Projektanfragen nachfassen", d: "Bucht jemand nach seiner Anfrage keinen Termin, geht automatisch eine freundliche E-Mail mit Buchungslink raus. Bleibt es still, bekommen Sie einen Vorschlag zum Anrufen.", sub: [["leadHours", "E-Mail nach (Stunden)", "num"], ["leadNudgeDays", "Vorschlag für Sie nach (Tagen)", "num"]] },
  { k: "bookingNudge", t: "Unbestätigte Website-Termine", d: "Vorschlag im Cockpit, wenn eine Buchung zu lange auf Ihre Bestätigung wartet.", sub: [["bookingNudgeHours", "nach (Stunden)", "num"]] },
  { k: "quoteNudge", t: "Angebote nachfassen", d: "Unbeantwortete Angebote erscheinen mit „Kunden erinnern“ – ein Klick verschickt eine freundliche Nachfrage.", sub: [["quoteDays", "nach (Tagen)", "num"]] },
  { k: "autoDrafts", t: "Rechnungen laut Zahlungsplan vorbereiten", d: "Nimmt ein Kunde ein Angebot an oder erreicht ein Projekt die vereinbarte Phase, legt das Board die passende Rechnung als Entwurf an – Positionen, Betrag und Bezug zum Angebot inklusive.", sub: [] },
  { k: "releaseNudge", t: "Rechnungen zur Freigabe", d: "Vorbereitete Rechnungen erscheinen im Cockpit mit „Freigeben & senden“: festschreiben, PDF erzeugen und an den Kunden schicken – ein Klick.", sub: [] },
  { k: "orderNudge", t: "Neue Aufträge & Absagen", d: "Nach einer Annahme erinnert das Cockpit daran, das Projekt einem Entwickler zuzuweisen. Lehnt ein Kunde ab, kommt ein Vorschlag zum Nachfragen.", sub: [] },
  { k: "aboDrafts", t: "Wiederkehrende Rechnungen", d: "Laufende Verträge (Betreuung, Lizenz, Hosting …) werden zum Abrechnungstermin automatisch als Rechnungsentwurf vorbereitet und erscheinen im Cockpit zur Freigabe.", sub: [["aboLeadDays", "Tage vorher vorbereiten", "num"]] },
  { k: "termNudge", t: "Vertragsfristen", d: "Hinweis, bevor die Kündigungsfrist eines Vertrags endet, wenn ein gekündigter Vertrag ausläuft und wenn bei Signature die Kaufoption beginnt.", sub: [["termDays", "Tage vorher", "num"]] },
  { k: "taskNudge", t: "Überfällige Aufgaben", d: "Hinweis im Cockpit, wenn eine Aufgabe ihr Fälligkeitsdatum überschritten hat. Entwickler sehen nur ihre eigenen.", sub: [] },
  { k: "dunningNudge", t: "Mahnvorschläge", d: "Überfällige Rechnungen erscheinen mit der passenden Stufe (Zahlungserinnerung, 1.–3. Mahnung). Sie bestätigen nur noch.", sub: [] },
  { k: "summaryNudge", t: "Fehlende Zusammenfassungen", d: "Nach jedem Termin erinnert das Cockpit an das Protokoll, das der Kunde im Portal sieht. Entwickler sehen das für ihre Projekte.", sub: [["summaryHours", "nach (Stunden)", "num"]] },
  { k: "inactiveNudge", t: "Ruhende Projekte", d: "Hinweis, wenn sich in einem aktiven Projekt lange nichts tut (Projekte in Betreuung ausgenommen).", sub: [["inactiveDays", "nach (Tagen)", "num"]] },
  { k: "weekly", t: "Wochenbericht per E-Mail", d: "Kennzahlen aus Vertrieb, Geld, Projekten und Team plus die wichtigsten offenen Punkte – an alle Inhaber.", sub: [["weeklyDay", "Tag", "day"], ["weeklyHour", "Uhrzeit", "hour"]] },
];
// Vertrag & AVV
const ON_OPTS = [["Auftrag", "fällig bei Auftrag"], ...["Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"].map(p => [p, "fällig ab Phase " + p])];
const ctrRow = x => `<div class="fplanrow fplanrow--cfg"><input data-p="label" value="${esc(x.label || "")}" placeholder="z. B. Anzahlung bei Auftrag"><span class="fpct"><input data-p="pct" value="${String(x.pct ?? "").replace(".", ",")}" inputmode="decimal"><i>%</i></span>
  <select data-p="on">${ON_OPTS.map(([v, l]) => `<option value="${v}" ${v === (x.on || "Auftrag") ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="x" data-del>✕</button></div>`;
const ctrSum = () => { const s = $$("#ctrPlan .fplanrow").reduce((t, r) => t + (Number($("[data-p=pct]", r).value.replace(",", ".")) || 0), 0), ok = Math.abs(s - 100) < .01;
  $("#ctrSum").innerHTML = `<b class="${ok ? "ok" : "warn"}">${String(Math.round(s * 100) / 100).replace(".", ",")} %</b>${ok ? "" : " – muss 100 % ergeben"}`; };
async function loadContract() {
  const d = await api("/contracts/settings"), f = $("#contractForm");
  $("#ctrPlan").innerHTML = d.plan.map(ctrRow).join(""); ctrSum();
  f.terms.value = d.terms; f.avv.value = d.avv;
  const v = k => d.versions.find(x => x.kind === k);
  $("#ctrVer").textContent = [v("terms") && `Vertragsbedingungen: Fassung ${v("terms").version}`, v("avv") && `AVV: Fassung ${v("avv").version}`].filter(Boolean).join(" · ");
}
$("#ctrAdd").addEventListener("click", () => { $("#ctrPlan").insertAdjacentHTML("beforeend", ctrRow({ on: "Launch" })); ctrSum(); });
$("#ctrPlan").addEventListener("input", ctrSum);
$("#ctrPlan").addEventListener("click", e => { if (e.target.closest("[data-del]")) { e.target.closest(".fplanrow").remove(); ctrSum(); } });
$("#contractForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  try { await api("/contracts/settings", { method: "PUT", body: { terms: f.terms.value, avv: f.avv.value,
      plan: $$("#ctrPlan .fplanrow").map(r => ({ label: $("[data-p=label]", r).value, pct: $("[data-p=pct]", r).value, on: $("[data-p=on]", r).value })) } });
    toast("Gespeichert"); loadContract(); } catch (err) { toast(err.message); }
});
const WD = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
async function loadAutomation() {
  const [d, logRows] = await Promise.all([api("/automation/settings"), api("/automation/log")]);
  const S = d.settings;
  $("#autoForm").innerHTML = `<h2>Was automatisch passiert</h2><p class="hint" style="margin:-6px 0 4px">Das Board prüft jede Minute. E-Mails gehen nur einmal raus – alles steht rechts im Protokoll und beim Kunden im Verlauf.</p>
    ${AUTO_RULES.map(r => `<div class="arule ${S[r.k] ? "on" : ""}"><label class="switch"><input type="checkbox" name="${r.k}" ${S[r.k] ? "checked" : ""}><i></i></label>
      <div class="arule__m"><b>${r.t}</b><p>${r.d}</p>${r.sub.length ? `<div class="arule__sub">${r.sub.map(([k, l, ty]) => ty === "bool" ? `<label class="check"><input type="checkbox" name="${k}" ${S[k] ? "checked" : ""}> ${l}</label>`
        : ty === "day" ? `<div class="field"><span>${l}</span>${DD.html("auto-" + k, WD.slice(1).map((w, i) => ({ v: i + 1, l: w })), S[k], { field: k })}</div>`
        : ty === "hour" ? `<div class="field"><span>${l}</span>${DD.html("auto-" + k, [...Array(24)].map((_, h) => ({ v: h, l: `${String(h).padStart(2, "0")}:00 Uhr` })), S[k], { field: k })}</div>`
        : `<label class="arule__num">${l}<input type="number" name="${k}" min="1" max="365" value="${S[k]}"></label>`).join("")}</div>` : ""}</div></div>`).join("")}
    <div><button class="btn btn--grad" type="submit">Speichern</button></div>`;
  const lr = d.lastRun;
  $("#autoStatus").innerHTML = `<span class="pill pill--bestaetigt">● läuft</span> ${lr ? `zuletzt geprüft ${fmt(lr.at, { hour: "2-digit", minute: "2-digit" })} Uhr` : "startet gleich"} · <b>${d.open}</b> offene Vorschläge im Cockpit`;
  const KL = { erinnerung: "Terminerinnerung", nachfassen: "Nachgefasst", bericht: "Wochenbericht" };
  $("#autoLog").innerHTML = logRows.length ? logRows.map(j => `<div class="alog"><span class="alog__k alog__k--${esc(j.kind)}">${KL[j.kind] || esc(j.kind)}</span>
    <div><p>${esc(j.detail || "")}</p><small>${fmt(j.created_at.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${j.company ? " · " + esc(j.company) : ""}</small></div></div>`).join("")
    : `<div class="empty">Noch nichts verschickt.</div>`;
}
$("#autoForm").addEventListener("change", e => { const r = e.target.closest(".arule"); if (r && e.target === r.querySelector(".switch input")) r.classList.toggle("on", e.target.checked); });
$("#autoForm").addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, body = {};
  for (const el of f.querySelectorAll("input[name]")) body[el.name] = el.type === "checkbox" ? el.checked : +el.value;
  try { await api("/automation/settings", { method: "PUT", body }); toast("Automatik gespeichert"); loadAutomation(); refreshBadges(); } catch (err) { toast(err.message); }
});
$("#autoRun").addEventListener("click", async () => {
  try { const r = await api("/automation/run", { method: "POST", body: {} }); toast(r.busy ? "Läuft gerade schon" : `Geprüft – ${r.mails} E-Mail${r.mails === 1 ? "" : "s"} verschickt, ${r.open} offene Vorschläge.`); loadAutomation(); refreshBadges(); } catch (err) { toast(err.message); }
});
$("#autoWeekly").addEventListener("click", async () => {
  try {
    const r = await api("/automation/weekly");
    const m = document.createElement("div"); m.className = "modal uimodal";
    m.innerHTML = `<div class="card uidlg" style="width:min(720px,100%)"><h2>${esc(r.subject)}</h2><pre class="weekly">${esc(r.text)}</pre>
      <div class="uidlg__btns"><button class="btn btn--ghost" data-x>Schließen</button><button class="btn btn--grad" data-send>Jetzt an mich senden</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", async ev => {
      if (ev.target === m || ev.target.closest("[data-x]")) return m.remove();
      if (ev.target.closest("[data-send]")) { const s = await api("/automation/weekly", { method: "POST", body: {} }); m.remove(); toast(s.mailed ? "Wochenbericht verschickt (bzw. im Postausgang)." : "Kein Inhaber-Postfach gefunden."); loadAutomation(); }
    });
  } catch (err) { toast(err.message); }
});

/* ---------- Menü in schmalen Fenstern (Handy, Tablet, schmales Fenster) ---------- */
function menuZu() { const s = $(".side"); if (!s?.classList.contains("menu-auf")) return; s.classList.remove("menu-auf"); $("#navToggle")?.setAttribute("aria-expanded", "false"); }
$("#navToggle")?.addEventListener("click", e => { e.stopPropagation(); const s = $(".side"), auf = !s.classList.contains("menu-auf"); s.classList.toggle("menu-auf", auf); e.currentTarget.setAttribute("aria-expanded", String(auf)); });
document.addEventListener("click", e => { if (!e.target.closest(".side")) menuZu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") menuZu(); });
$$(".side nav a").forEach(a => a.addEventListener("click", () => menuZu()));

/* Wischbare Reiterleisten: den aktiven Reiter immer ins Bild holen (nur innerhalb der Leiste, die Seite scrollt nicht mit) */
function segZeigen(seg) { if (!seg || seg.scrollWidth <= seg.clientWidth) return; const on = seg.querySelector("button.on"); if (!on) return;
  seg.scrollLeft = Math.max(0, on.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2); segRand(seg); }
document.addEventListener("click", e => { const seg = e.target.closest(".seg"); if (seg) setTimeout(() => segZeigen(document.getElementById(seg.id) || seg), 60); });
/* Weicher Rand links/rechts, solange es in der Leiste noch weitergeht – so ist klar, dass man wischen kann */
function segRand(seg) { if (!seg) return; const mehr = seg.scrollWidth > seg.clientWidth + 1; seg.classList.toggle("seg--l", mehr && seg.scrollLeft > 4); seg.classList.toggle("seg--r", mehr && seg.scrollLeft + seg.clientWidth < seg.scrollWidth - 4); }
document.addEventListener("scroll", e => { if (e.target.classList?.contains("seg")) segRand(e.target); }, true);
addEventListener("resize", () => $$(".seg").forEach(segRand));
setTimeout(() => $$(".seg").forEach(segRand), 800); window.addEventListener("hashchange", () => setTimeout(() => $$(".seg").forEach(segRand), 400));
