/* Board – Aktionsmenü „Aktionen ▾“ und ⋯ in Listen (nutzt $$, esc, toast aus admin.js)
   AKT.knopf(key, { text, punkte, extra }) → Markup des Auslösers (data-akt = key).
   AKT.on(key, btn => gruppen)  gruppen: [{ t: "Überschrift" | "", items: [{ l, fn, danger, hint }] }]  – leere Gruppen fallen weg.
   Das Menü hängt am <body> (position: fixed): Es wird von keiner Karte oder Zeile abgeschnitten, auf dem Handy erscheint es als Blatt von unten.
   Klick auf den Auslöser öffnet nie die Zeile darunter (Ereignis wird abgefangen, auch in <a>-Zeilen). */
(() => {
  const reg = {};
  let offen = null;   // { menu, hinter, btn }
  const chev = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const dots = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>`;
  const handy = () => innerWidth <= 560;

  function knopf(key, { text = "Aktionen", punkte = false, extra = "", titel = "" } = {}) {
    return punkte
      ? `<button type="button" class="akt-dots" data-akt="${esc(key)}" ${extra} aria-haspopup="menu" aria-label="${esc(titel || "Aktionen")}" title="${esc(titel || "Aktionen")}">${dots}</button>`
      : `<button type="button" class="akt-btn" data-akt="${esc(key)}" ${extra} aria-haspopup="menu">${esc(text)}${chev}</button>`;
  }

  function schliessen() {
    if (!offen) return;
    offen.menu.remove(); offen.hinter?.remove(); offen.btn.classList.remove("open"); offen.btn.setAttribute("aria-expanded", "false");
    const b = offen.btn; offen = null; return b;
  }

  function oeffnen(btn) {
    const key = btn.dataset.akt, fn = reg[key]; if (!fn) return;
    let gruppen; try { gruppen = (fn(btn) || []).map(g => ({ ...g, items: (g.items || []).filter(Boolean) })).filter(g => g.items.length); } catch (err) { return toast(err.message); }
    if (!gruppen.length) return;
    const menu = document.createElement("div");
    menu.className = "akt-menu"; menu.setAttribute("role", "menu");
    const aktionen = [];
    menu.innerHTML = gruppen.map((g, gi) => `<div class="akt-gr ${g.danger ? "akt-gr--danger" : ""}">${g.t ? `<p class="akt-t">${esc(g.t)}</p>` : ""}${g.items.map(it => {
      aktionen.push(it); return `<button type="button" role="menuitem" data-i="${aktionen.length - 1}" class="${it.danger ? "danger" : ""}"><span>${esc(it.l)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`; }).join("")}</div>`).join("");
    let hinter = null;
    if (handy()) { hinter = document.createElement("div"); hinter.className = "akt-hinter"; document.body.appendChild(hinter); menu.classList.add("akt-menu--blatt"); }
    document.body.appendChild(menu);
    if (!hinter) platzieren(menu, btn);
    requestAnimationFrame(() => { menu.classList.add("auf"); hinter?.classList.add("auf"); });
    btn.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    offen = { menu, hinter, btn };
    menu.addEventListener("click", e => {
      const b = e.target.closest("[data-i]"); if (!b) return;
      const it = aktionen[+b.dataset.i]; schliessen();
      Promise.resolve().then(() => it.fn?.()).catch(err => toast(err.message));
    });
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  // Unter dem Knopf, rechtsbündig; passt es unten nicht, darüber; immer ganz im Fenster
  function platzieren(menu, btn) {
    const r = btn.getBoundingClientRect(), rand = 8, vw = innerWidth, vh = innerHeight;
    menu.style.maxHeight = ""; const w = Math.min(menu.offsetWidth, vw - 2 * rand);
    menu.style.width = w + "px";
    let left = Math.min(Math.max(rand, r.right - w), vw - w - rand);
    const unten = vh - r.bottom - rand - 6, oben = r.top - rand - 6, h = menu.offsetHeight;
    let top;
    if (h <= unten || unten >= oben) { top = r.bottom + 6; menu.style.maxHeight = Math.max(160, unten) + "px"; }
    else { const hh = Math.min(h, oben); top = r.top - 6 - hh; menu.style.maxHeight = oben + "px"; menu.classList.add("akt-menu--oben"); }
    menu.style.left = left + "px"; menu.style.top = Math.max(rand, top) + "px";
  }

  // Abfangen in der Einfangphase: Zeilen (<a> oder data-href) öffnen sich nicht, offene Board-Dropdowns schließen
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-akt]");
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      document.querySelectorAll(".dd.open").forEach(d => d.classList.remove("open"));
      const war = offen?.btn; schliessen(); if (war !== btn) oeffnen(btn); return;
    }
    if (offen && !offen.menu.contains(e.target)) { schliessen(); if (e.target.closest(".akt-hinter")) { e.preventDefault(); e.stopPropagation(); } }
  }, true);
  document.addEventListener("keydown", e => {
    if (e.target.closest?.("[data-akt]") && (e.key === "Enter" || e.key === " ")) { e.stopPropagation(); return; }   // Enter auf ⋯ öffnet nicht die Zeile
    if (!offen) return;
    if (e.key === "Escape") { e.preventDefault(); schliessen()?.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); const l = [...offen.menu.querySelectorAll("button")], i = l.indexOf(document.activeElement);
      l[(i + (e.key === "ArrowDown" ? 1 : -1) + l.length) % l.length]?.focus();
    }
    if (e.key === "Tab") schliessen();
  }, true);
  addEventListener("resize", () => schliessen());
  addEventListener("scroll", e => { if (offen && !offen.menu.contains(e.target) && !handy()) schliessen(); }, true);
  addEventListener("hashchange", () => schliessen());

  window.AKT = { knopf, on: (key, fn) => { reg[key] = fn; }, schliessen };
})();
