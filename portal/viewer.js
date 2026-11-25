/* Prototyp-Viewer mit Anmerkungen (Stift, Textmarker, Kommentar-Pins) – für Kundenportal und Admin-Board.
   Der Prototyp läuft in einer Sandbox auf eigenem Ursprung. Er meldet per postMessage nur Seite und Scrollposition;
   gezeichnet wird in einer Ebene darüber, in Dokument-Koordinaten (wandert also beim Scrollen mit). */
(() => {
  const { esc, fmt } = window.RSChat;
  const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#8b5cf6", "#111111"];
  const WIDTH = { tablet: 820, phone: 390 };
  const SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";
  const svgNS = "http://www.w3.org/2000/svg";
  const cleanPage = p => { const [path, ...h] = String(p || "").split("#"); return path.replace(/\\/g, "/").split("/").filter(x => x && x !== "." && x !== "..").join("/") + (h.length ? "#" + h.join("#") : ""); };
  const pts2d = p => { let d = ""; for (let i = 0; i < p.length; i += 2) d += (i ? "L" : "M") + p[i] + " " + p[i + 1]; return d; };

  let V = null; // aktueller Viewer-Zustand

  function open(proto, opts = {}) {
    close();
    const api = window.RS_VIEWER_API || null;          // vom Portal bzw. Admin-Board gesetzt
    const saved = (() => { try { return localStorage.getItem("rs-device") || "desktop"; } catch { return "desktop"; } })();
    const el = document.createElement("div");
    el.className = "viewer"; el.dataset.device = innerWidth < 700 ? "phone" : saved;
    V = { el, proto, api, notes: [], cur: { page: "", sx: 0, sy: 0, w: 0, h: 0 }, mode: null, tool: "pen", color: COLORS[0],
          draft: [], drawing: null, pin: null, wait: new Map(), assist: null, assistOn: false, target: null, palette: [], tw: { css: {}, text: null }, pv: null, focus: opts.focus || null, versions: opts.versions || null, listOpen: !!opts.focus || !!opts.showList };
    el.innerHTML = `
      <div class="viewer__bar">
        <div class="viewer__title"><b>${esc(proto.title)}</b><span>${proto.version > 1 ? "Version " + proto.version + " · " : ""}${proto.created_at ? fmt(proto.created_at, { day: "numeric", month: "long", year: "numeric" }) : "Prototyp"}</span></div>
        ${V.versions && V.versions.length > 1 ? `<select class="viewer__ver" aria-label="Version">${V.versions.map(v => `<option value="${v.id}" ${v.id === proto.id ? "selected" : ""}>Version ${v.version}${v.id === V.versions[0].id ? " (aktuell)" : ""}</option>`).join("")}</select>` : ""}
        <div class="seg" role="group" aria-label="Ansicht"><button data-d="desktop">Desktop</button><button data-d="tablet">Tablet</button><button data-d="phone">Smartphone</button></div>
        ${api ? `<button class="viewer__btn viewer__btn--grad" data-act="annotate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Anmerken</span></button>
        <button class="viewer__btn" data-act="list">Anmerkungen <b class="viewer__count">0</b></button>` : ""}
        <a class="viewer__btn" href="${esc(proto.url)}" target="_blank" rel="noopener" title="In neuem Tab öffnen">↗</a>
        <button class="viewer__btn viewer__close" data-act="close" aria-label="Schließen">✕</button>
      </div>
      <div class="viewer__body">
        <div class="viewer__stage">
          <div class="vdev">
            <iframe class="viewer__frame" title="${esc(proto.title)}" sandbox="${SANDBOX}" referrerpolicy="no-referrer"></iframe>
            <svg class="vlayer" xmlns="${svgNS}"><g class="vlayer__g"></g></svg>
            <div class="vpins"></div>
          </div>
          <div class="vtools" hidden>
            <div class="vtools__grp"><button data-tool="pen" title="Stift">✎ Stift</button><button data-tool="marker" title="Textmarker">▬ Marker</button><button data-tool="pin" title="Kommentar an eine Stelle setzen">◉ Kommentar</button><button data-tool="erase" title="Radierer: auf eine Linie tippen, um sie zu entfernen">⌫ Radierer</button></div>
            <div class="vtools__grp">${COLORS.map(c => `<button class="vcolor" data-color="${c}" style="--c:${c}" title="Farbe"></button>`).join("")}</div>
            <div class="vtools__grp"><button data-act="undo" title="Letzten Strich zurücknehmen">↶</button><button data-act="clear" title="Alles Neue wieder entfernen">Leeren</button><button data-act="cancel">Abbrechen</button><button class="vtools__done" data-act="done">Weiter</button></div>
          </div>
          <form class="vnote" hidden>
            <b>Was sollen wir ändern?</b>
            <div class="vtarget" hidden></div>
            <div class="vtweak" hidden></div>
            <textarea class="vnote__txt" rows="3" maxlength="2000" placeholder="z. B. „Diese Überschrift bitte größer und in Grün“"></textarea>
            <div class="vnote__row"><button type="button" class="viewer__btn" data-act="discard">Verwerfen</button><button type="submit" class="viewer__btn viewer__btn--grad">Speichern</button></div>
          </form>
          <div class="vassist" hidden></div>
          <div class="viewer__note">${api ? "Klickversion · mit „Anmerken“ zeichnen oder kommentieren" : "Klickversion · Eingaben werden nicht gespeichert"}</div>
        </div>
        <aside class="vlist" ${V.listOpen ? "" : "hidden"}><div class="vlist__head"><b>Anmerkungen</b><button class="viewer__btn" data-act="list" aria-label="Liste schließen">✕</button></div><div class="vlist__items"></div></aside>
      </div>`;
    document.body.appendChild(el); document.body.style.overflow = "hidden";
    V.frame = el.querySelector("iframe"); V.svg = el.querySelector(".vlayer"); V.g = el.querySelector(".vlayer__g"); V.pins = el.querySelector(".vpins");
    V.frame.src = opts.page && !V.focus ? (proto.base || "") + cleanPage(opts.page) : proto.url;   // „Was hat sich geändert?“ springt direkt zur Seite
    window.dispatchEvent(new CustomEvent("rs:viewer-open", { detail: proto }));
    syncDevice(); bind();
    if (V.focus) applyFocusDevice(V.focus);
    loadNotes();
    V.api?.assistStatus?.().then(s => { if (V) V.assistOn = !!s?.available; }).catch(() => {});
    setTimeout(() => el.querySelector(".viewer__note")?.classList.add("off"), 6000);
  }

  function close() {
    if (!V) return;
    removeEventListener("message", onMsg); V.el.remove(); V = null; document.body.style.overflow = "";
  }

  /* ---------- Gerät ---------- */
  function syncDevice() {
    const d = V.el.dataset.device, dev = V.el.querySelector(".vdev");
    V.el.querySelectorAll("[data-d]").forEach(b => b.classList.toggle("on", b.dataset.d === d));
    dev.style.width = d === "custom" ? V.customW + "px" : WIDTH[d] ? WIDTH[d] + "px" : "";
  }
  function applyFocusDevice(n) {
    // Für den Sprung zur Anmerkung genau die Breite einstellen, in der gezeichnet wurde
    const stageW = V.el.querySelector(".viewer__stage").clientWidth - 36;
    if (n.device_w <= stageW) { V.el.dataset.device = "custom"; V.customW = n.device_w; }
    syncDevice();
  }

  /* ---------- Nachrichten aus dem Prototyp ---------- */
  function onMsg(e) {
    if (!V || e.source !== V.frame.contentWindow) return;
    const d = e.data; if (!d) return;
    if (d.rs === "outline") { const w = V.wait.get(d.id); if (w) { V.wait.delete(d.id); w(d); } return; }
    if (d.rs === "picked") { const w = V.wait.get(d.id); if (w) { V.wait.delete(d.id); w(d); } return; }
    if (d.rs === "previewed") { if (!d.ok && V.pvWanted) toastV("Dieses Element gibt es in dieser Version nicht mehr – vermutlich schon geändert."); V.pvWanted = false; return; }
    if (d.rs !== "proto") return;
    const path = String(d.path || ""), base = V.proto.base || "";
    let page = path.startsWith(base) ? path.slice(base.length) : path.replace(/^\/p\/[a-f0-9]+\//, "");
    try { page = decodeURIComponent(page); } catch {}
    page = cleanPage(page + (typeof d.hash === "string" && d.hash.length < 200 ? d.hash : ""));
    const num = v => Number.isFinite(+v) ? +v : 0;
    const changed = page !== V.cur.page;
    V.cur = { page, sx: num(d.sx), sy: num(d.sy), w: num(d.w), h: num(d.h) };
    if (changed) { V.pv = null; if (V.target && !V.el.querySelector(".vnote").hidden) { V.target = null; renderTarget(); } renderNotes(); if (V.focus && pageKey(V.focus.page) === pageKey(page)) jumpScroll(); }
    else positionLayer();
  }
  const pageKey = p => cleanPage(p).replace(/(^|\/)index\.html?$/i, "$1") || "";

  /* ---------- Anmerkungen laden & zeichnen ---------- */
  async function loadNotes() {
    if (!V?.api) return;
    try { V.notes = await V.api.list(V.proto.id); } catch { V.notes = []; }
    if (!V) return;
    V.el.querySelector(".viewer__count") && (V.el.querySelector(".viewer__count").textContent = V.notes.filter(n => n.status === "offen").length);
    renderList(); renderNotes();
    if (V.focus) { const f = V.notes.find(n => n.id === V.focus.id); if (f) focusNote(f); }
  }
  function positionLayer() {
    V.g.setAttribute("transform", `translate(${-V.cur.sx} ${-V.cur.sy})`);
    V.pins.style.transform = `translate(${-V.cur.sx}px, ${-V.cur.sy}px)`;
  }
  function strokeEl(s, faded) {
    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", pts2d(s.p)); p.setAttribute("fill", "none"); p.setAttribute("stroke", s.c);
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-width", s.t === "marker" ? 18 : 3.5);
    p.setAttribute("opacity", (s.t === "marker" ? .38 : .95) * (faded ? .45 : 1));
    if (s.t === "marker") p.style.mixBlendMode = "multiply";
    return p;
  }
  function renderNotes() {
    if (!V) return;
    V.g.replaceChildren(); V.pins.replaceChildren();
    const here = V.notes.map((n, i) => ({ n, i })).filter(({ n }) => pageKey(n.page) === pageKey(V.cur.page));
    for (const { n, i } of here) {
      const done = n.status === "erledigt";
      for (const s of n.strokes) V.g.appendChild(strokeEl(s, done));
      const pin = document.createElement("button");
      pin.className = `vpin ${done ? "vpin--done" : ""} ${V.focus?.id === n.id ? "vpin--focus" : ""}`;
      pin.style.left = n.x + "px"; pin.style.top = n.y + "px"; pin.textContent = i + 1; pin.dataset.note = n.id;
      pin.title = n.comment || "Anmerkung";
      V.pins.appendChild(pin);
    }
    for (const s of V.draft) V.g.appendChild(strokeEl(s));
    if (V.pin) { const pin = document.createElement("span"); pin.className = "vpin vpin--draft"; pin.style.left = V.pin.x + "px"; pin.style.top = V.pin.y + "px"; pin.textContent = "+"; V.pins.appendChild(pin); }
    positionLayer(); showPop();
    V.el.querySelectorAll(".vitem").forEach(x => x.classList.toggle("here", here.some(h => String(h.n.id) === x.dataset.note)));
  }
  const mine = n => V.api?.mode === "team" ? n.author_kind === "team" : n.author_kind === "client" && n.status === "offen";
  const upCount = () => { const c = V.el.querySelector(".viewer__count"); if (c) c.textContent = V.notes.filter(x => x.status === "offen").length; };
  // Eigene Rückfrage im Viewer (Browser-Dialoge werden in manchen Umgebungen blockiert)
  function confirmV(text, ok = "Löschen") {
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "vconfirm";
      d.innerHTML = `<div class="vconfirm__card"><p>${esc(text)}</p><div class="vconfirm__btns"><button type="button" class="viewer__btn" data-c="0">Abbrechen</button><button type="button" class="viewer__btn viewer__btn--danger" data-c="1">${esc(ok)}</button></div></div>`;
      V.el.appendChild(d); d.querySelector("[data-c='1']").focus();
      d.addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b || e.target === d) { e.stopPropagation(); d.remove(); res(b?.dataset.c === "1"); } });
    });
  }
  function showPop() {
    V.pins.querySelector(".vpop")?.remove();
    const n = V.notes.find(x => x.id === V.popId); if (!n || pageKey(n.page) !== pageKey(V.cur.page)) return;
    const team = V.api?.mode === "team", own = mine(n);
    const p = document.createElement("div"); p.className = "vpop"; p.style.left = n.x + "px"; p.style.top = n.y + "px";
    p.innerHTML = `<div class="vpop__head"><b>${esc(n.author)}</b><span>${fmt(n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button type="button" class="vpop__x" data-pop="close" aria-label="Schließen">✕</button></div>
      ${V.editId === n.id ? `<textarea class="vpop__edit" rows="3" maxlength="2000">${esc(n.comment || "")}</textarea>` : n.change && n.comment === changeText(n.change) ? "" : `<p class="vpop__txt">${esc(n.comment || "(nur Zeichnung)")}</p>`}
      ${n.change ? `<div class="vpop__chg"><b>Gewünschte Änderung · ${esc(KIND[n.change.target.kind] || "Element")}</b>${changeHtml(n.change)}<button type="button" class="vbtn" data-pop="pv">${V.pv === n.id ? "Vorschau ausblenden" : "Vorschau zeigen"}</button></div>` : ""}
      ${n.ai ? `<div class="vpop__ai"><span class="vkind vkind--${esc(n.ai.kind || "offen")}">${esc({ klein: "Klein", mittel: "Mittel", gross: "Groß" }[n.ai.kind] || "KI")}</span>${team && n.ai.summary ? `<span>${esc(n.ai.summary)}</span>` : ""}<button type="button" class="vbtn" data-pop="assist">Gespräch mit dem Assistenten</button></div>` : ""}
      ${n.reply ? `<p class="vpop__reply">↳ ${esc(n.reply)}</p>` : ""}${n.status === "erledigt" ? `<em class="vdone">✓ erledigt</em>` : ""}
      <div class="vpop__acts">${V.editId === n.id ? `<button type="button" class="vbtn" data-pop="noedit">Abbrechen</button><button type="button" class="vbtn vbtn--ok" data-pop="save">Speichern</button>`
        : `${own && !team ? `<button type="button" class="vbtn" data-pop="edit">Text ändern</button>` : ""}${team ? `<button type="button" class="vbtn ${n.status === "erledigt" ? "" : "vbtn--ok"}" data-toggle="${n.id}">${n.status === "erledigt" ? "Wieder öffnen" : "✓ Erledigt"}</button>` : ""}${own ? `<button type="button" class="vbtn vbtn--danger" data-del="${n.id}">Löschen</button>` : ""}`}</div>
      ${own && !team && n.strokes.length && V.editId !== n.id ? `<small class="vpop__tip">Einzelne Striche entfernen: „Anmerken“ → Radierer</small>` : ""}`;
    V.pins.appendChild(p);
    p.querySelector(".vpop__edit")?.focus();
  }
  async function eraseAt(x, y) {
    const hit = st => { const r = st.t === "marker" ? 16 : 12; for (let i = 0; i < st.p.length; i += 2) if (Math.hypot(st.p[i] - x, st.p[i + 1] - y) < r) return true; return false; };
    const di = V.draft.findIndex(hit); if (di >= 0) { V.draft.splice(di, 1); renderNotes(); return; }
    if (V.api?.mode !== "team" && V.api?.patch) for (const n of V.notes.filter(n => mine(n) && pageKey(n.page) === pageKey(V.cur.page))) {
      const si = n.strokes.findIndex(hit); if (si < 0) continue;
      try {
        const r = await V.api.patch(n.id, { strokes: n.strokes.filter((_, k) => k !== si) });
        if (r.deleted) { V.notes = V.notes.filter(x => x !== n); if (V.popId === n.id) V.popId = null; toastV("Anmerkung entfernt – es war nichts mehr übrig."); } else { Object.assign(n, r); toastV("Strich entfernt"); }
        renderList(); renderNotes(); upCount();
      } catch (err) { toastV(err.message); }
      return;
    }
    toastV("Hier ist kein eigener Strich – tippen Sie direkt auf eine Linie.");
  }
  function renderList() {
    const box = V.el.querySelector(".vlist__items"); if (!box) return;
    const team = V.api?.mode === "team";
    box.innerHTML = V.notes.length ? V.notes.map((n, i) => `
      <div class="vitem ${n.status === "erledigt" ? "vitem--done" : ""} ${V.focus?.id === n.id ? "vitem--focus" : ""}" data-note="${n.id}">
        <span class="vitem__no">${i + 1}</span>
        <div class="vitem__body"><p>${esc(n.comment || "(nur Zeichnung)")}</p>${n.change && n.comment !== changeText(n.change) ? `<small class="vitem__chg">→ ${esc(changeText(n.change))}</small>` : ""}
          <span>${esc(n.page || "Startseite")} · ${esc(n.author)} · ${fmt(n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          ${n.reply ? `<div class="vitem__reply">↳ ${esc(n.reply)}</div>` : ""}</div>
        <div class="vitem__acts">
          ${team ? `<button class="vbtn ${n.status === "erledigt" ? "" : "vbtn--ok"}" data-toggle="${n.id}">${n.status === "erledigt" ? "Wieder öffnen" : "✓ Erledigt"}</button>`
                 : n.status === "erledigt" ? `<em class="vdone">✓ erledigt</em>` : n.author_kind === "client" ? `<button class="vbtn vbtn--danger" data-del="${n.id}">Löschen</button>` : ""}
        </div>
      </div>`).join("") : `<p class="vlist__empty">Noch keine Anmerkungen.${V.api ? " Klicken Sie oben auf „Anmerken“, um etwas einzuzeichnen." : ""}</p>`;
  }

  /* ---------- Springen ---------- */
  function focusNote(n) {
    V.focus = n; renderList();
    if (n.device_w && Math.abs((V.el.querySelector(".vdev").clientWidth || 0) - n.device_w) > 40) applyFocusDevice(n);
    if (pageKey(n.page) !== pageKey(V.cur.page)) { V.frame.src = (V.proto.base || "") + cleanPage(n.page); }
    else { renderNotes(); jumpScroll(); }
  }
  function jumpScroll() {
    const n = V.focus; if (!n) return;
    const top = Math.max(0, n.y - (V.frame.clientHeight || 600) * .3);
    V.frame.contentWindow?.postMessage({ rs: "scrollTo", y: top, smooth: true }, "*");
    renderNotes();
  }

  /* ---------- Zeichnen ---------- */
  function setMode(on) {
    V.mode = on ? "draw" : null; V.draft = []; V.pin = null;
    if (V.target) { V.target = null; V.tw = { css: {}, text: null }; post({ rs: "reset" }); renderTarget(); }
    V.el.classList.toggle("viewer--draw", !!on);
    V.el.querySelector(".vtools").hidden = !on; V.el.querySelector(".vnote").hidden = true;
    V.el.querySelector("[data-act=annotate]")?.classList.toggle("on", !!on);
    syncTools(); renderNotes();
  }
  function syncTools() {
    V.el.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === V.tool));
    V.el.querySelectorAll("[data-color]").forEach(b => b.classList.toggle("on", b.dataset.color === V.color));
    V.svg.style.cursor = V.tool === "pin" ? "copy" : V.tool === "erase" ? "cell" : "crosshair";
  }
  const docPoint = e => { const r = V.svg.getBoundingClientRect(); return [Math.round((e.clientX - r.left + V.cur.sx) * 10) / 10, Math.round((e.clientY - r.top + V.cur.sy) * 10) / 10]; };
  function openNoteForm() {
    if (!V.draft.length && !V.pin) return;
    V.el.querySelector(".vtools").hidden = true;
    const f = V.el.querySelector(".vnote"); f.hidden = false; f.querySelector(".vnote__txt").value = ""; f.querySelector(".vnote__txt").focus();
    pickTarget();
  }
  async function saveNote(comment) {
    const first = V.pin || (V.draft[0] ? { x: V.draft[0].p[0], y: V.draft[0].p[1] } : { x: 20, y: V.cur.sy + 20 });
    const change = currentChange();
    const body = { page: V.cur.page || V.proto.entry, device_w: Math.round(V.el.querySelector(".vdev").clientWidth), x: first.x, y: first.y, strokes: V.draft, comment: comment || (change ? changeText(change) : ""), change };
    const btn = V.el.querySelector(".vnote [type=submit]"); btn.disabled = true;
    try { const n = await V.api.create(V.proto.id, body); V.notes.push(n); setMode(false); renderList(); renderNotes();
      if (V.assistOn && V.api.assist) startAssist(n); else toastV("Anmerkung gespeichert – unser Team sieht sie sofort."); V.el.querySelector(".viewer__count").textContent = V.notes.filter(x => x.status === "offen").length; }
    catch (err) { toastV(err.message); }
    finally { btn.disabled = false; }
  }
  function toastV(msg) {
    let t = V.el.querySelector(".vtoast"); if (!t) { t = document.createElement("div"); t.className = "vtoast"; V.el.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(t.h); t.h = setTimeout(() => t.classList.remove("on"), 3200);
  }

  /* ---------- Element erkennen & Live-Vorschau (Baustein H3) ---------- */
  const KIND = { heading: "Überschrift", text: "Text", link: "Link", button: "Knopf", image: "Bild", block: "Bereich" };
  const LABEL = { fontSize: "Schriftgröße", fontWeight: "Schrift", color: "Textfarbe", backgroundColor: "Hintergrund", textAlign: "Ausrichtung",
    marginTop: "Abstand darüber", marginBottom: "Abstand darunter", paddingTop: "Innenabstand oben", paddingBottom: "Innenabstand unten", borderRadius: "Ecken" };
  const post = m => V?.frame.contentWindow?.postMessage(m, "*");
  const px = v => Math.round(parseFloat(v) || 0);
  const hex = c => { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join("") : String(c); };
  const fmtVal = (k, v) => k === "fontWeight" ? (+v >= 600 ? "fett" : "normal") : k === "textAlign" ? ({ left: "links", start: "links", center: "mittig", right: "rechts", end: "rechts", justify: "Blocksatz" }[v] || v)
    : /color/i.test(k) ? hex(v) : px(v) + " px";
  /** Änderungsliste für Anzeige und Text: [{k, label, from, to}] */
  function changeRows(c) {
    const rows = Object.keys(c.css || {}).map(k => ({ k, label: LABEL[k] || k, from: c.before?.[k] != null ? fmtVal(k, c.before[k]) : "", to: fmtVal(k, c.css[k]), color: /color/i.test(k) ? hex(c.css[k]) : null }));
    if (c.text) rows.push({ k: "text", label: "Text", from: c.textBefore ? `„${c.textBefore}“` : "", to: `„${c.text}“` });
    return rows;
  }
  function changeText(c) {
    if (!c) return "";
    const t = c.target?.text ? ` „${c.target.text.length > 40 ? c.target.text.slice(0, 40) + "…" : c.target.text}“` : "";
    return `${KIND[c.target?.kind] || "Element"}${t}: ` + changeRows(c).map(r => r.k === "text" ? `Text → ${r.to}` : `${r.label} ${r.from ? r.from + " → " : ""}${r.to}`).join(", ");
  }
  const changeHtml = c => `<ul class="vchg">${changeRows(c).map(r => `<li><span>${esc(r.label)}</span>${r.from ? `<s>${esc(r.from)}</s> → ` : ""}<b>${r.color ? `<i class="vsw" style="--c:${esc(r.color)}"></i>` : ""}${esc(r.to)}</b></li>`).join("")}</ul>`;

  function ask(msg) {
    return new Promise(res => {
      const id = Math.random().toString(36).slice(2); V.wait.set(id, res); post({ ...msg, id });
      setTimeout(() => { if (V?.wait.has(id)) { V.wait.delete(id); res(null); } }, 1500);
    });
  }
  async function pickTarget() {
    V.target = null; V.tw = { css: {}, text: null }; renderTarget();
    let pt = V.pin;
    if (!pt && V.draft.length) { const xs = [], ys = []; V.draft.forEach(s => { for (let i = 0; i < s.p.length; i += 2) { xs.push(s.p[i]); ys.push(s.p[i + 1]); } });
      pt = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; }
    if (!pt) return;
    const r = await ask({ rs: "pick", x: pt.x, y: pt.y });
    if (!V || !r?.info) return;
    V.target = r.info; V.lastPick = r.info.sel; V.palette = r.palette || []; renderTarget();
  }
  function renderTarget() {
    const box = V.el.querySelector(".vtarget"), tw = V.el.querySelector(".vtweak"), t = V.target;
    if (!t) { box.hidden = true; tw.hidden = true; box.innerHTML = tw.innerHTML = ""; return; }
    const st = t.style, isText = ["heading", "text", "link", "button"].includes(t.kind);
    box.hidden = false;
    box.innerHTML = `<div class="vtarget__row"><span class="vtarget__k">${KIND[t.kind]}</span><span class="vtarget__t">${t.text ? "„" + esc(t.text.length > 60 ? t.text.slice(0, 60) + "…" : t.text) + "“" : esc(t.tag)}</span>
        ${isText ? `<small>${px(st.fontSize)} px${+st.fontWeight >= 600 ? " · fett" : ""}</small>` : ""}</div>
      <div class="vtarget__acts">${t.kind === "image" ? `<small>Bild austauschen? Beschreiben Sie es unten – das neue Bild können Sie im Chat schicken.</small>` : `<button type="button" class="vbtn ${tw.hidden ? "vbtn--ok" : ""}" data-tw="toggle">${tw.hidden ? "Direkt anpassen" : "Anpassen ausblenden"}</button>`}
        <button type="button" class="vbtn" data-tw="drop" title="Die Anmerkung bleibt, nur ohne Zuordnung">Nicht dieses Element</button></div>`;
    if (tw.hidden) return;
    const cur = k => V.tw.css[k] ?? st[k];
    const stepper = (k, label, step) => `<div class="tw"><span>${label}</span><div class="tw__ctl"><button type="button" data-tw="step" data-v="${k}:${-step}" aria-label="kleiner">−</button><b>${px(cur(k))} px</b><button type="button" data-tw="step" data-v="${k}:${step}" aria-label="größer">+</button></div></div>`;
    const seg = (k, label, opts) => `<div class="tw"><span>${label}</span><div class="tw__seg">${opts.map(([v, l]) => `<button type="button" data-tw="set" data-v="${k}:${v}" class="${String(cur(k)) === v || (k === "fontWeight" && (+cur(k) >= 600) === (v === "700")) || (k === "textAlign" && ({ start: "left", end: "right" }[cur(k)] || cur(k)) === v) ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
    const sw = (k, label) => `<div class="tw"><span>${label}</span><div class="tw__sw">${V.palette.map(c => `<button type="button" data-tw="set" data-v="${k}:${esc(c)}" class="vsw ${hex(cur(k)) === hex(c) ? "on" : ""}" style="--c:${esc(c)}" title="${esc(hex(c))}"></button>`).join("")}${V.tw.css[k] ? `<button type="button" class="tw__orig" data-tw="unset" data-v="${k}">Original</button>` : ""}</div></div>`;
    tw.innerHTML = `${isText ? `<div class="tw"><span>Schriftgröße</span><div class="tw__ctl"><button type="button" data-tw="step" data-v="fontSize:-2" aria-label="kleiner">−</button><input type="range" min="10" max="120" value="${px(cur("fontSize"))}" data-tw-in="fontSize" aria-label="Schriftgröße"><b>${px(cur("fontSize"))} px</b><button type="button" data-tw="step" data-v="fontSize:2" aria-label="größer">+</button></div></div>
        ${seg("fontWeight", "Schrift", [["400", "Normal"], ["700", "Fett"]])}${seg("textAlign", "Ausrichtung", [["left", "Links"], ["center", "Mitte"], ["right", "Rechts"]])}${V.palette.length ? sw("color", "Textfarbe") : ""}` : ""}
      ${["button", "block"].includes(t.kind) && V.palette.length ? sw("backgroundColor", "Hintergrund") : ""}
      ${["button", "block"].includes(t.kind) ? stepper("borderRadius", "Ecken", 2) + stepper("paddingTop", "Innenabstand", 4) : ""}
      ${stepper("marginTop", "Abstand darüber", 4)}${stepper("marginBottom", "Abstand darunter", 4)}
      ${t.editable ? `<label class="tw tw--txt"><span>Text</span><textarea rows="2" maxlength="800" data-tw-in="text">${esc(V.tw.text ?? t.text)}</textarea></label>` : ""}
      <div class="tw__foot"><p class="tw__sum">${currentChange() ? "Ihr Wunsch: " + esc(changeRows(currentChange()).map(r => r.k === "text" ? "neuer Text" : r.label + " " + r.to).join(", ")) : "Probieren Sie es aus – die Seite zeigt die Änderung sofort (nur bei Ihnen)."}</p>
        ${currentChange() ? `<button type="button" class="vbtn" data-tw="reset">Zurücksetzen</button>` : ""}</div>`;
  }
  function currentChange() {
    const t = V.target; if (!t) return null;
    const css = {}; for (const [k, v] of Object.entries(V.tw.css)) if (v != null && String(v) !== String(t.style[k])) css[k] = v;
    const text = V.tw.text != null && V.tw.text.trim() && V.tw.text.trim() !== t.text ? V.tw.text.trim() : null;
    if (!Object.keys(css).length && !text) return null;
    const before = {}; for (const k of Object.keys(css)) before[k] = t.style[k];
    return { target: { sel: t.sel, tag: t.tag, kind: t.kind, text: t.text }, css, before, ...(text ? { text, textBefore: t.text } : {}) };
  }
  function tweak(a, v, el) {
    const t = V.target; if (!t && a !== "toggle") return;
    if (a === "toggle") { const tw = V.el.querySelector(".vtweak"); tw.hidden = !tw.hidden; renderTarget(); return; }
    if (a === "drop") { V.target = null; V.tw = { css: {}, text: null }; post({ rs: "reset" }); renderTarget(); return; }
    if (a === "reset") { V.tw = { css: {}, text: null }; post({ rs: "reset" }); }
    if (a === "step") { const [k, d] = v.split(":"); const base = px(V.tw.css[k] ?? t.style[k]); V.tw.css[k] = Math.max(0, Math.min(k === "fontSize" ? 160 : 240, base + +d)) + "px"; }
    if (a === "set") { const i = v.indexOf(":"); V.tw.css[v.slice(0, i)] = v.slice(i + 1); }
    if (a === "unset") delete V.tw.css[v];
    if (a === "fontSize") V.tw.css.fontSize = v + "px";
    if (a === "text") V.tw.text = v;
    if (a !== "reset") post({ rs: "preview", sel: t.sel, css: V.tw.css, text: V.tw.text ?? undefined });
    // Beim Tippen nicht neu zeichnen (Cursor bliebe sonst nicht stehen)
    if (a === "text" || a === "fontSize") { const sum = V.el.querySelector(".tw__sum"); const c = currentChange(); if (sum) sum.textContent = c ? "Ihr Wunsch: " + changeRows(c).map(r => r.k === "text" ? "neuer Text" : r.label + " " + r.to).join(", ") : ""; if (a === "fontSize") { const b = el.parentElement.querySelector("b"); if (b) b.textContent = v + " px"; } return; }
    renderTarget();
  }
  /* ---------- KI-Assistent (Baustein H4) ---------- */
  const team = () => V.api?.mode === "team";
  function askOutline() {
    return new Promise(res => { const id = Math.random().toString(36).slice(2); V.wait.set(id, res); post({ rs: "outline", id }); setTimeout(() => { if (V?.wait.has(id)) { V.wait.delete(id); res(null); } }, 1500); });
  }
  async function startAssist(n) {
    V.assist = { note: n, t: { status: "denkt", messages: [], variants: [] }, busy: true, tried: null }; renderAssist();
    const o = await askOutline();
    try { V.assist.t = (await V.api.assist(n.id, { outline: o?.list || [], palette: o?.palette || [], pickSel: n.change?.target?.sel || V.lastPick || "" })) || null; }
    catch (err) { V.assist.t = null; toastV(err.message); }
    if (!V?.assist) return;
    V.assist.busy = false;
    if (!V.assist.t) { closeAssist(); toastV("Anmerkung gespeichert – unser Team sieht sie sofort."); return; }
    refreshNote(n.id); renderAssist();
  }
  async function openAssist(n) {
    V.assist = { note: n, t: null, busy: true, tried: null }; renderAssist();
    try { V.assist.t = await V.api.assistGet(n.id); } catch { V.assist.t = null; }
    if (!V?.assist) return; V.assist.busy = false;
    if (!V.assist.t) { closeAssist(); toastV("Zu dieser Anmerkung gibt es kein Gespräch."); return; }
    renderAssist();
  }
  function closeAssist() { post({ rs: "reset" }); V.assist = null; const p = V.el.querySelector(".vassist"); p.hidden = true; p.innerHTML = ""; }
  async function refreshNote(id) { try { const list = await V.api.list(V.proto.id); const fresh = list.find(x => x.id === id); const n = V.notes.find(x => x.id === id); if (fresh && n) Object.assign(n, fresh); renderList(); } catch {} }
  const varHtml = v => [...Object.entries(v.css || {}).map(([k, x]) => /color/i.test(k) ? `${esc(LABEL[k] || k)} <i class="vsw" style="--c:${esc(hex(x))}"></i>` : `${esc(LABEL[k] || k)} ${esc(fmtVal(k, x))}`),
    ...(v.text ? [`„${esc(v.text.length > 70 ? v.text.slice(0, 70) + "…" : v.text)}“`] : [])].join(" · ");
  const varRows = v => [...Object.entries(v.css || {}).map(([k, x]) => `${LABEL[k] || k} ${fmtVal(k, x)}`), ...(v.text ? [`Text: „${v.text.length > 60 ? v.text.slice(0, 60) + "…" : v.text}“`] : [])];
  function renderAssist() {
    const box = V.el.querySelector(".vassist"), A = V.assist; if (!A) return;
    const t = A.t || { messages: [], variants: [] }, msgs = t.messages || [], last = msgs[msgs.length - 1];
    const canAct = !team() && !A.busy && ["offen", "rueckfrage"].includes(t.status);
    const showVariants = t.variants?.length && t.chosen == null && t.status === "offen";
    box.hidden = false;
    box.innerHTML = `<div class="vassist__head"><span class="vai">KI</span><div><b>Assistent</b><small>Reeder Software · Entscheidungen trifft unser Team</small></div><button type="button" class="vassist__x" data-as="close" aria-label="Schließen">✕</button></div>
      <div class="vassist__msgs">
        <div class="vmsg vmsg--kunde"><span>${esc(A.note.comment || "(Zeichnung)")}</span></div>
        ${msgs.map(m => `<div class="vmsg vmsg--${m.from === "ki" ? "ki" : "kunde"}"><span>${esc(m.text)}</span></div>`).join("")}
        ${A.busy || t.status === "denkt" ? `<div class="vmsg vmsg--ki vmsg--busy"><span><i></i><i></i><i></i> Ich sehe mir Ihre Anmerkung an …</span></div>` : ""}
        ${canAct && last?.options ? `<div class="vopts">${last.options.map(o => `<button type="button" class="vopt" data-as="clarify" data-i="${o.i}" data-sel="${esc(o.el?.sel || "")}">${esc(o.label)}</button>`).join("")}</div>` : ""}
      </div>
      ${showVariants ? `<div class="vcards">${t.variants.map((v, i) => `<div class="vcard ${A.tried === i ? "on" : ""}"><b>${esc(v.label)}</b><small>${varHtml(v)}</small>
          <div class="vcard__acts"><button type="button" class="vbtn" data-as="try" data-v="${i}">${A.tried === i ? "Original zeigen" : "Ansehen"}</button>${team() ? "" : `<button type="button" class="vbtn vbtn--ok" data-as="take" data-v="${i}">Diese nehmen</button>`}</div></div>`).join("")}</div>` : ""}
      ${t.kind && team() ? `<p class="vassist__team"><span class="vkind vkind--${esc(t.kind)}">${esc({ klein: "Klein", mittel: "Mittel", gross: "Groß" }[t.kind])}</span>${esc(t.team_summary || "")}</p>` : ""}
      ${canAct ? `<form class="vassist__form"><input name="text" maxlength="1000" autocomplete="off" placeholder="${last?.options ? "Oder in eigenen Worten …" : "Antworten oder genauer beschreiben …"}"><button class="viewer__btn viewer__btn--grad">Senden</button></form>` : ""}
      ${team() ? "" : `<p class="vassist__fine">Sie schreiben mit einem KI-Assistenten. <button type="button" class="link" data-as="human">Lieber mit einem Menschen sprechen</button></p>`}`;
    const m = box.querySelector(".vassist__msgs"); m.scrollTop = m.scrollHeight;
  }
  async function assistAct(a, b) {
    const A = V.assist; if (!A) return;
    const t = A.t, id = A.note.id;
    if (a === "close") return closeAssist();
    if (a === "human") { closeAssist(); if (V.api.human) { close(); V.api.human(); } return; }
    if (a === "try") {
      const i = +b.dataset.v, v = t.variants[i];
      if (A.tried === i) { A.tried = null; post({ rs: "reset" }); }
      else { A.tried = i; V.pvWanted = true; post({ rs: "preview", sel: t.target?.sel, css: v.css, text: v.text, scroll: true }); }
      return renderAssist();
    }
    if (A.busy) return;
    const run = async fn => { A.busy = true; renderAssist(); try { A.t = await fn(); } catch (err) { toastV(err.message); } if (!V?.assist) return; A.busy = false; renderAssist(); refreshNote(id); };
    if (a === "take") { const i = +b.dataset.v; if (A.tried != null) { post({ rs: "reset" }); A.tried = null; } return run(() => V.api.choose(id, i)); }
    if (a === "clarify") { if (b.dataset.sel) post({ rs: "preview", sel: b.dataset.sel, css: {}, scroll: true }); return run(() => V.api.clarify(id, +b.dataset.i)); }
    if (a === "send") { const txt = b.text.value.trim(); if (!txt) return; t.messages = [...(t.messages || []), { from: "kunde", text: txt }]; return run(() => V.api.message(id, txt)); }
  }

  function stopPv() { if (V?.pv) { V.pv = null; post({ rs: "reset" }); } }

  function bind() {
    addEventListener("message", onMsg);
    const el = V.el;
    el.addEventListener("click", async e => {
      const d = e.target.closest("[data-d]");
      if (d) { el.dataset.device = d.dataset.d; syncDevice(); try { localStorage.setItem("rs-device", d.dataset.d); } catch {} return; }
      const t = e.target.closest("[data-tool]"); if (t) { V.tool = t.dataset.tool; syncTools(); return; }
      const c = e.target.closest("[data-color]"); if (c) { V.color = c.dataset.color; syncTools(); return; }
      const pin = e.target.closest(".vpin[data-note]"); if (pin) { const n = V.notes.find(x => String(x.id) === pin.dataset.note); if (n) { V.popId = V.popId === n.id ? null : n.id; V.editId = null; V.focus = n; renderList(); renderNotes(); } return; }
      const pop = e.target.closest("[data-pop]");
      if (pop) {
        const n = V.notes.find(x => x.id === V.popId), a = pop.dataset.pop;
        if (a === "close") { V.popId = null; stopPv(); }
        if (a === "assist") { V.popId = null; openAssist(n); }
        if (a === "pv") { if (V.pv === n.id) stopPv(); else { V.pv = n.id; V.pvWanted = true; post({ rs: "preview", sel: n.change.target.sel, css: n.change.css, text: n.change.text, scroll: true }); } }
        if (a === "edit") V.editId = n.id;
        if (a === "noedit") V.editId = null;
        if (a === "save") { const t = el.querySelector(".vpop__edit").value.trim();
          try { const r = await V.api.patch(n.id, { comment: t }); if (r.deleted) { V.notes = V.notes.filter(x => x !== n); V.popId = null; } else Object.assign(n, r); V.editId = null; renderList(); upCount(); toastV("Gespeichert"); } catch (err) { toastV(err.message); } }
        renderNotes(); return;
      }
      if (V.popId && !e.target.closest(".vpop") && !e.target.closest("[data-del]") && !e.target.closest("[data-toggle]")) { V.popId = null; V.editId = null; stopPv(); renderNotes(); }
      const item = e.target.closest(".vitem"); const tg = e.target.closest("[data-toggle]"), del = e.target.closest("[data-del]");
      if (tg) {
        const n = V.notes.find(x => String(x.id) === tg.dataset.toggle);
        try { Object.assign(n, await V.api.patch(n.id, { status: n.status === "erledigt" ? "offen" : "erledigt" })); renderList(); renderNotes(); V.api.onChange?.(); el.querySelector(".viewer__count").textContent = V.notes.filter(x => x.status === "offen").length; } catch (err) { toastV(err.message); }
        return;
      }
      if (del) {
        if (!(await confirmV("Diese Anmerkung samt Zeichnung löschen?"))) return;
        try { await V.api.remove(+del.dataset.del); V.notes = V.notes.filter(x => String(x.id) !== del.dataset.del); V.popId = null; renderList(); renderNotes(); upCount(); toastV("Anmerkung gelöscht"); } catch (err) { toastV(err.message); }
        return;
      }
      if (item) { const n = V.notes.find(x => String(x.id) === item.dataset.note); if (n) focusNote(n); return; }
      const a = e.target.closest("[data-act]"); if (!a) return;
      const act = a.dataset.act;
      if (act === "close") close();
      if (act === "annotate") setMode(V.mode !== "draw");
      if (act === "list") { V.listOpen = !V.listOpen; el.querySelector(".vlist").hidden = !V.listOpen; }
      if (act === "undo") { if (V.pin) V.pin = null; else V.draft.pop(); renderNotes(); }
      if (act === "clear") { V.draft = []; V.pin = null; renderNotes(); }
      if (act === "cancel") setMode(false);
      if (act === "done") { if (!V.draft.length && !V.pin) { if (V.tool === "erase") return setMode(false); toastV("Zeichnen Sie zuerst etwas ein – oder setzen Sie einen Kommentar-Punkt."); } else openNoteForm(); }
      if (act === "discard") setMode(false);
    });
    el.querySelector(".viewer__ver")?.addEventListener("change", e => {
      const v = V.versions.find(x => String(x.id) === e.target.value); if (v) open(v, { versions: V.versions, showList: V.listOpen });
    });
    el.querySelector(".vassist").addEventListener("click", e => { const b = e.target.closest("[data-as]"); if (b) { e.preventDefault(); e.stopPropagation(); assistAct(b.dataset.as, b); } });
    el.querySelector(".vassist").addEventListener("submit", e => { e.preventDefault(); assistAct("send", e.target); });
    el.querySelector(".vnote").addEventListener("click", e => { const b = e.target.closest("[data-tw]"); if (b) { e.preventDefault(); tweak(b.dataset.tw, b.dataset.v, b); } });
    el.querySelector(".vnote").addEventListener("input", e => { const i = e.target.closest("[data-tw-in]"); if (i) tweak(i.dataset.twIn, i.value, i); });
    el.querySelector(".vnote").addEventListener("submit", e => { e.preventDefault(); saveNote(e.target.querySelector(".vnote__txt").value.trim()); });
    el.querySelector(".vnote__txt").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.target.form.requestSubmit(); });

    const svg = V.svg;
    svg.addEventListener("pointerdown", e => {
      if (V.mode !== "draw") return;
      e.preventDefault();
      const [x, y] = docPoint(e);
      if (V.tool === "pin") { V.pin = { x, y }; renderNotes(); openNoteForm(); return; }
      if (V.tool === "erase") { eraseAt(x, y); return; }
      V.drawing = { t: V.tool, c: V.color, p: [x, y] }; V.draft.push(V.drawing);
      svg.setPointerCapture(e.pointerId); renderNotes();
    });
    svg.addEventListener("pointermove", e => {
      if (!V.drawing) return;
      const [x, y] = docPoint(e), p = V.drawing.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 2.5) return;
      p.push(x, y);
      const last = V.g.lastElementChild; if (last) last.setAttribute("d", pts2d(p));
    });
    const end = () => { if (V?.drawing) { if (V.drawing.p.length === 2) V.drawing.p.push(V.drawing.p[0] + .5, V.drawing.p[1] + .5); V.drawing = null; } };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
    // Mausrad im Zeichenmodus an den Prototyp weitergeben
    svg.addEventListener("wheel", e => { if (V.mode !== "draw") return; e.preventDefault(); V.frame.contentWindow?.postMessage({ rs: "scrollBy", dx: e.deltaX, dy: e.deltaY }, "*"); }, { passive: false });
  }
  addEventListener("keydown", e => {
    if (!V || e.key !== "Escape") return;
    if (!V.el.querySelector(".vassist").hidden) return closeAssist();
    if (!V.el.querySelector(".vnote").hidden || V.mode) setMode(false); else close();
  });

  window.RSViewer = { open, close, changeText };
})();
