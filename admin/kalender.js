/* Board – Kalender: Woche / Monat / Liste (nutzt $, $$, esc, api, toast, DD, UI, ME aus admin.js) */
(() => {
  const START = 7, END = 21, HOUR = 64;               // sichtbarer Tagesbereich (Uhr) und Pixel pro Stunde
  const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  let view = "woche", anchor = new Date(), who = "alle", data = { events: [], blocked: [] }, team = [];
  try { view = localStorage.getItem("rs-cal-view") || (innerWidth < 760 ? "liste" : "woche"); } catch {}

  const d0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = d => { const x = d0(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hm = d => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const initials = n => String(n || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const tone = e => e.kind === "buchung" ? (e.tentative ? "tent" : "blue")
    : /erst/i.test(e.type + e.title) ? "blue" : /präsent|workshop|konzept/i.test(e.type + e.title) ? "pink" : /schulung|abnahme|launch/i.test(e.type + e.title) ? "green" : "violet";

  function range() {
    if (view === "woche") { const f = monday(anchor); return [f, addDays(f, 7)]; }
    if (view === "monat") { const f = monday(new Date(anchor.getFullYear(), anchor.getMonth(), 1)); return [f, addDays(f, 42)]; }
    return [addDays(d0(new Date()), -30), addDays(d0(new Date()), 90)];
  }
  async function load() {
    const [from, to] = range();
    const [d, t] = await Promise.all([api(`/kalender?from=${from.toISOString()}&to=${to.toISOString()}`), ME.owner && !team.length ? api("/team") : Promise.resolve(null)]);
    data = d; if (t) team = t.filter(u => u.active && !u.invited);
    render();
  }
  const visible = () => data.events.filter(e => who === "alle" ? true
    : who === "me" ? (!e.team.length || e.team.some(u => u.id === ME.id)) : e.team.some(u => String(u.id) === String(who)));

  function render() {
    const [from] = range();
    const title = view === "woche" ? (() => { const a = from, b = addDays(from, 6); return a.getMonth() === b.getMonth() ? a.toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : `${a.toLocaleDateString("de-DE", { month: "short" })} – ${b.toLocaleDateString("de-DE", { month: "short", year: "numeric" })}`; })()
      : view === "monat" ? anchor.toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : "Alle Termine";
    $("#calTitle").textContent = title;
    const evs = visible(), upcoming = evs.filter(e => new Date(e.start) >= new Date()).length, tent = evs.filter(e => e.tentative).length;
    $("#calSub").innerHTML = view === "woche" ? `KW ${kw(from)} · ${evs.length} Termin${evs.length === 1 ? "" : "e"}${tent ? ` · <b class="warn">${tent} unbestätigt</b>` : ""}`
      : `${upcoming} kommende Termin${upcoming === 1 ? "" : "e"}${tent ? ` · <b class="warn">${tent} unbestätigt</b>` : ""}`;
    $$("#calView button").forEach(b => b.classList.toggle("on", b.dataset.v === view));
    $("#calNav").hidden = view === "liste";
    $("#calWho").innerHTML = ME.owner && team.length ? DD.html("calWho", [{ v: "alle", l: "Alle Termine" }, { v: "me", l: "Meine Termine" }, { sep: "Team" }, ...team.filter(u => !u.me).map(u => ({ v: u.id, l: u.name, av: initials(u.name) }))], who, { label: "Wer" }) : "";
    $("#cal").innerHTML = view === "woche" ? week(evs, from) : view === "monat" ? month(evs, from) : list(evs);
    if (view === "woche") { const body = $(".cw__body"); if (body && !render.scrolled) { const first = Math.min(8, ...evs.map(e => new Date(e.start).getHours())); body.scrollTop = Math.max(0, first - START - .3) * HOUR; render.scrolled = true; } }
  }
  const kw = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); };
  const isBlocked = d => (data.blocked || []).find(b => key(d) >= b.from && key(d) <= (b.to || b.from));

  /* ---------- Woche ---------- */
  function lanes(list) {
    list.sort((a, b) => a.s - b.s || b.e - a.e); let cl = [], end = -1;
    const flush = () => { const ln = []; cl.forEach(ev => { let i = ln.findIndex(x => x <= ev.s); if (i < 0) { i = ln.length; ln.push(0); } ln[i] = ev.e; ev.lane = i; }); cl.forEach(ev => ev.lanes = ln.length); cl = []; };
    for (const ev of list) { if (ev.s >= end && cl.length) flush(); cl.push(ev); end = Math.max(end, ev.e); }
    if (cl.length) flush(); return list;
  }
  function week(evs, from) {
    const days = [...Array(7)].map((_, i) => addDays(from, i)), now = new Date();
    const head = days.map((d, i) => `<div class="cw__day ${sameDay(d, now) ? "is-today" : ""} ${i > 4 ? "is-we" : ""}"><span>${DAYS[i]}</span><b>${d.getDate()}</b></div>`).join("");
    const allday = days.map(d => { const b = isBlocked(d); return `<div class="cw__ad">${b ? `<span class="chip chip--off">${esc(b.note || "Abwesend")}</span>` : ""}</div>`; }).join("");
    const cols = days.map((d, i) => {
      const list = lanes(evs.filter(e => sameDay(new Date(e.start), d)).map(ev => { const s = new Date(ev.start), sm = s.getHours() * 60 + s.getMinutes(); return { ev, s: sm, e: sm + (ev.minutes || 30) }; }));
      const blocks = list.map(({ ev, s, e, lane, lanes: n }) => {
        const top = (Math.max(s, START * 60) - START * 60) / 60 * HOUR, h = Math.max(22, (Math.min(e, END * 60) - Math.max(s, START * 60)) / 60 * HOUR - 2);
        const st = new Date(ev.start), short = h < 40;
        return `<button class="ev ev--${tone(ev)} ${short ? "ev--short" : ""} ${st < now ? "ev--past" : ""}" style="top:${top}px;height:${h}px;left:calc(${lane / n * 100}% + 2px);width:calc(${100 / n}% - 4px)" data-ev="${ev.kind}:${ev.id}">
          <b>${esc(short ? ev.client.company || ev.title : ev.title)}${bereichKurz(ev.bereich && ev)}</b><span>${hm(st)}${short ? "" : ` – ${hm(new Date(st.getTime() + (ev.minutes || 30) * 6e4))} · ${esc(ev.client.company || "")}`}</span></button>`;
      }).join("");
      const nowLine = sameDay(d, now) && now.getHours() >= START && now.getHours() < END ? `<i class="cw__now" style="top:${(now.getHours() * 60 + now.getMinutes() - START * 60) / 60 * HOUR}px"></i>` : "";
      return `<div class="cw__col ${sameDay(d, now) ? "is-today" : ""} ${i > 4 ? "is-we" : ""} ${isBlocked(d) ? "is-off" : ""}" data-day="${key(d)}">${blocks}${nowLine}</div>`;
    }).join("");
    const hours = [...Array(END - START)].map((_, i) => `<span style="top:${i * HOUR}px">${String(START + i).padStart(2, "0")}:00</span>`).join("");
    return `<div class="cw" style="--h:${HOUR}px">
      <div class="cw__head"><div class="cw__g"></div>${head}</div>
      <div class="cw__allrow"><div class="cw__g"><small>ganztägig</small></div>${allday}</div>
      <div class="cw__body"><div class="cw__grid" style="height:${(END - START) * HOUR}px"><div class="cw__times">${hours}</div>${cols}</div></div></div>`;
  }

  /* ---------- Monat ---------- */
  function month(evs, from) {
    const now = new Date(), m = anchor.getMonth();
    const cells = [...Array(42)].map((_, i) => {
      const d = addDays(from, i), list = evs.filter(e => sameDay(new Date(e.start), d)), b = isBlocked(d);
      return `<div class="cm__cell ${d.getMonth() !== m ? "is-other" : ""} ${sameDay(d, now) ? "is-today" : ""} ${i % 7 > 4 ? "is-we" : ""}" data-day="${key(d)}">
        <span class="cm__n">${d.getDate()}</span>${b ? `<span class="chip chip--off">${esc(b.note || "Abwesend")}</span>` : ""}
        ${list.slice(0, 3).map(e => `<button class="cm__ev cm__ev--${tone(e)}" data-ev="${e.kind}:${e.id}"><i></i>${hm(new Date(e.start))} ${esc(e.client.company || e.title)}${bereichKurz(e.bereich && e)}</button>`).join("")}
        ${list.length > 3 ? `<button class="cm__more" data-goday="${key(d)}">+ ${list.length - 3} weitere</button>` : ""}</div>`;
    }).join("");
    return `<div class="cm"><div class="cm__head">${DAYS.map(x => `<span>${x}</span>`).join("")}</div><div class="cm__grid">${cells}</div></div>`;
  }

  /* ---------- Liste: chronologisch, Kommendes oben ---------- */
  function list(evs) {
    const now = new Date(), up = evs.filter(e => new Date(e.start).getTime() + (e.minutes || 30) * 6e4 >= now).sort((a, b) => a.start.localeCompare(b.start));
    const past = evs.filter(e => !up.includes(e)).sort((a, b) => b.start.localeCompare(a.start));
    const group = arr => { const g = new Map(); arr.forEach(e => { const k = key(new Date(e.start)); if (!g.has(k)) g.set(k, []); g.get(k).push(e); }); return [...g]; };
    const label = k => { const d = new Date(k + "T12:00:00"), t = d0(now); const diff = Math.round((d0(d) - t) / 864e5);
      const rel = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : ""; return `${rel ? `<b>${rel}</b> · ` : ""}${d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}`; };
    const row = e => { const s = new Date(e.start), en = new Date(s.getTime() + (e.minutes || 30) * 6e4), past = en < now;
      return `<button class="cl__r" data-ev="${e.kind}:${e.id}"><span class="cl__t">${hm(s)}<small>${hm(en)}</small></span><i class="cl__bar cl__bar--${tone(e)}"></i>
        <span class="cl__m"><b>${esc(e.title)}${e.bereich ? " " + bereichTag(e) : ""}${e.tentative ? ` <em class="chip chip--tent">unbestätigt</em>` : ""}</b><small>${esc(e.client.company || "")}${e.client.name ? " · " + esc(e.client.name) : ""}${e.project ? " · " + esc(e.project.title) : ""}</small></span>
        <span class="pteam">${e.team.map(u => `<span class="avatar avatar--xs" title="${esc(u.name)}">${esc(initials(u.name))}</span>`).join("")}</span>
        <span class="cl__s">${past ? (e.kind === "termin" ? (e.summary ? `<em class="chip chip--ok">Zusammenfassung ✓</em>` : `<em class="chip chip--warn">Zusammenfassung fehlt</em>`) : "") : e.video_url ? `<em class="chip">Video</em>` : ""}</span></button>`; };
    return `<div class="cl">${up.length ? group(up).map(([k, arr]) => `<h3 class="cl__h">${label(k)}</h3><div class="cl__g">${arr.map(row).join("")}</div>`).join("") : `<div class="empty">Keine kommenden Termine.</div>`}
      ${past.length ? `<details class="cl__past"><summary>Vergangene Termine (letzte 30 Tage) · ${past.length}${past.filter(e => e.kind === "termin" && !e.summary).length ? ` · <b class="warn">${past.filter(e => e.kind === "termin" && !e.summary).length} ohne Zusammenfassung</b>` : ""}</summary>
        ${group(past).map(([k, arr]) => `<h3 class="cl__h">${label(k)}</h3><div class="cl__g">${arr.map(row).join("")}</div>`).join("")}</details>` : ""}</div>`;
  }

  /* ---------- Vorbereitung: Anliegen aus der Buchung, Fragebogen, Vorab-Entwurf ---------- */
  const VSTAT = { eingeladen: ["Fragebogen verschickt – noch nicht ausgefüllt", ""], beantwortet: ["Fragebogen ausgefüllt", "ok"], baut: ["Vorab-Entwurf wird gerade gebaut …", ""], fertig: ["Vorab-Entwurf fertig", "ok"], fehler: ["Vorab-Entwurf fehlgeschlagen", "warn"] };
  function prepHtml(p) {
    if (!p) return "";
    const chips = list => `<div class="evd__chips">${list.map(t => `<span>${esc(t)}</span>`).join("")}</div>`;
    const row = r => `<div class="evd__row"><span>${esc(r.k)}</span><div>${r.chips ? chips(r.chips) : ""}${r.v ? `<p>${esc(r.v)}</p>` : ""}${r.colors?.length ? `<div class="evd__sw">${r.colors.map(c => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join("")}</div>` : ""}</div></div>`;
    const v = p.vorab, st = v ? VSTAT[v.status] || [v.status, ""] : null;
    return `<div class="evd__prep">
      ${v ? `<div class="evd__vorab ${st[1]}"><span><b>${esc(st[0])}</b>${v.images?.length ? `<small class="evd__img">Bilder: ${esc(v.images.join(" · "))}</small>` : ""}</span>${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">Ansehen ↗</a>` : ""}</div>` : ""}
      ${p.topics.length || p.message ? `<details class="evd__sec" open><summary>Anliegen aus der Buchung</summary><div class="evd__body">${p.topics.length ? chips(p.topics) : ""}${p.message ? `<p class="evd__msg">${esc(p.message)}</p>` : ""}</div></details>` : ""}
      ${v?.answers?.length ? v.answers.map(g => `<details class="evd__sec"><summary>Fragebogen · ${esc(g.title)}</summary><div class="evd__body">${g.rows.map(row).join("")}</div></details>`).join("") : ""}
    </div>`;
  }

  /* ---------- Termin-Details ---------- */
  function detail(id) {
    const [kind, n] = id.split(":"), e = data.events.find(x => x.kind === kind && String(x.id) === n); if (!e) return;
    const s = new Date(e.start), en = new Date(s.getTime() + (e.minutes || 30) * 6e4);
    const m = document.createElement("div"); m.className = "modal uimodal";
    m.innerHTML = `<div class="card uidlg evd"><div class="evd__top"><i class="cl__bar cl__bar--${tone(e)}"></i><div><h2>${esc(e.title)}</h2>
        <p>${s.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} · ${hm(s)} – ${hm(en)} Uhr${e.type && e.type !== e.title ? " · " + esc(e.type) : ""}</p></div><button class="x" data-x>✕</button></div>
      <dl class="evd__dl">
        <dt>Kunde</dt><dd>${e.client.id ? `<a href="#kunden/${e.client.id}" data-x>${esc(e.client.company)}</a>` : esc(e.client.company || "–")}${e.client.name ? " · " + esc(e.client.name) : ""}</dd>
        ${e.project ? `<dt>Projekt</dt><dd><a href="${projektHref(e.project)}" data-x>${esc(e.project.title)}</a> ${bereichTag(e.project)}</dd>` : ""}
        ${e.team.length ? `<dt>Team</dt><dd>${e.team.map(u => esc(u.name)).join(", ")}</dd>` : ""}
        ${e.video_url ? `<dt>Video</dt><dd><a href="${esc(e.video_url)}" target="_blank" rel="noopener">${esc(e.video_url.replace(/^https?:\/\//, ""))}</a></dd>` : ""}
        ${e.client.id && e.client.stage !== "mandant" || e.fragebogen ? `<dt>Fragebogen</dt><dd>${e.fragebogen === "ausgefuellt" ? `<b style="color:#16774f">✓ ausgefüllt</b> · <a href="#kunden/${e.client.id}" data-x>Antworten ansehen</a>`
          : `<b class="warn">${e.fragebogen === "offen" ? "verschickt, noch nicht ausgefüllt" : "noch nicht verschickt"}</b> · <button class="link" data-fb="${e.client.id}" data-bereich="${e.bereich || ""}">${e.fragebogen === "offen" ? "Erinnerung senden" : "Jetzt senden"}</button>`}</dd>` : ""}
        ${e.kind === "termin" && e.notes ? `<dt>Notizen</dt><dd><div class="evd__notes">${esc(e.notes)}</div></dd>` : ""}
        ${e.kind === "termin" && en < new Date() ? `<dt>Protokoll</dt><dd>${e.summary ? "Zusammenfassung eingetragen ✓" : `<b class="warn">Zusammenfassung fehlt – der Kunde wartet darauf</b>`}</dd>` : ""}
        ${e.tentative ? `<dt>Status</dt><dd><b class="warn">Über die Website gebucht – noch nicht bestätigt</b></dd>` : ""}
      </dl>
      ${prepHtml(e.prep)}
      <div class="uidlg__btns">
        ${e.tentative ? `<button class="btn btn--danger btn--sm" data-a="cancel">Absagen</button><button class="btn btn--grad btn--sm" data-a="confirm">✓ Bestätigen &amp; Einladung senden</button>` : ""}
        ${e.video_url && en > new Date() ? `<a class="btn btn--ghost btn--sm" href="${esc(e.video_url)}" target="_blank" rel="noopener">Video beitreten</a>` : ""}
        ${e.kind === "termin" ? `<button class="btn btn--grad btn--sm" data-a="edit">${en < new Date() && !e.summary ? "Zusammenfassung eintragen" : "Bearbeiten"}</button>` : ""}
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", async ev => {
      if (ev.target === m || ev.target.closest("[data-x]")) return m.remove();
      const fb = ev.target.closest("[data-fb]");
      if (fb) { fb.disabled = true;
        try { const r = await api(`/onboarding/kunde/${fb.dataset.fb}/erneut`, { method: "POST", body: { kinds: fb.dataset.bereich ? [fb.dataset.bereich] : null } });
          toast(r.mailed === false ? "E-Mail-Versand ist noch nicht eingerichtet – die Mail liegt im Postausgang." : "Fragebogen ist unterwegs."); fb.textContent = "gesendet ✓"; }
        catch (x) { toast(x.message); fb.disabled = false; }
        return; }
      const a = ev.target.closest("[data-a]")?.dataset.a; if (!a) return;
      try {
        if (a === "edit") { m.remove(); return window.KUNDEN.editAppt(e.id, e.client.id); }
        if (a === "confirm") { const r = await api(`/bookings/${e.id}`, { method: "PATCH", body: { status: "bestaetigt", notify: true } }); toast(r.mailed ? "Bestätigt – Einladung mit Video-Link ist raus." : "Bestätigt – Einladung liegt im Postausgang."); }
        if (a === "cancel") { if (!(await UI.confirm("Der Kontakt wird per E-Mail informiert und kann einen neuen Termin wählen.", { title: "Termin absagen?", ok: "Absagen", danger: true }))) return; await api(`/bookings/${e.id}`, { method: "PATCH", body: { status: "abgesagt", notify: true } }); toast("Abgesagt"); }
        m.remove(); load(); window.updateBadges?.();
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------- Bedienung ---------- */
  DD.on("calWho", v => { who = v; render(); });
  $("#calView").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; view = b.dataset.v; try { localStorage.setItem("rs-cal-view", view); } catch {} render.scrolled = false; load(); });
  $("#calNav").addEventListener("click", e => { const b = e.target.closest("[data-nav]"); if (!b) return; const n = +b.dataset.nav;
    anchor = n === 0 ? new Date() : view === "monat" ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : addDays(anchor, 7 * n); render.scrolled = n !== 0; load(); });
  $("#calNew").addEventListener("click", () => window.KUNDEN.newAppt());
  $("#cal").addEventListener("click", e => {
    const ev = e.target.closest("[data-ev]"); if (ev) return detail(ev.dataset.ev);
    const more = e.target.closest("[data-goday]"); if (more) { anchor = new Date(more.dataset.goday + "T12:00:00"); view = "woche"; return load(); }
    const col = e.target.closest(".cw__col"); if (col) {   // Klick in die Woche: neuer Termin zu dieser Uhrzeit
      const y = e.clientY - col.getBoundingClientRect().top, min = Math.round((START * 60 + y / HOUR * 60) / 30) * 30;
      const d = new Date(col.dataset.day + "T00:00:00"); d.setMinutes(min); return window.KUNDEN.newAppt(d.toISOString());
    }
    const cell = e.target.closest(".cm__cell"); if (cell) { anchor = new Date(cell.dataset.day + "T12:00:00"); view = "woche"; render.scrolled = false; load(); }
  });
  window.CAL = { load, reload: () => load() };
})();
