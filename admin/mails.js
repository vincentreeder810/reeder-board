/* ---------- E-Mails: Vorschau aller Vorlagen (Einstellungen › E-Mail) und Ansicht verschickter Mails ---------- */
(() => {
  const GRUPPEN = ["Termine", "Fragebögen", "Angebote & Rechnungen", "Projekt & Portal", "Support", "Konto & Zugang", "Intern"];
  const BREITE = { desktop: 600, handy: 375 };
  let liste = null, aktiv = null, geraet = "desktop", firma = "software", laeuft = false;

  // HTML ins iframe schreiben (sandbox ohne Skripte) und die Höhe an den Inhalt anpassen
  function zeige(frame, html) {
    frame.onload = () => {
      try {
        const d = frame.contentDocument;
        d.querySelectorAll("a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
        frame.style.height = Math.max(420, d.documentElement.scrollHeight) + "px";
      } catch { frame.style.height = "760px"; }
    };
    frame.srcdoc = html;
  }
  function setzeGeraet(wurzel, frame, g) {
    $$("[data-g]", wurzel).forEach(b => b.classList.toggle("on", b.dataset.g === g));
    frame.style.width = BREITE[g] + "px";
    // Nach dem Umschalten neu messen (Zeilen brechen anders um)
    setTimeout(() => { try { frame.style.height = Math.max(420, frame.contentDocument.documentElement.scrollHeight) + "px"; } catch {} }, 60);
  }
  const anText = an => an === "team" ? "an dich" : "an Kunden";

  function rendereListe() {
    const box = $("#mvListe");
    if (!liste.length) { box.innerHTML = `<div class="empty">Noch keine Vorlagen hinterlegt.</div>`; return; }
    const gruppen = [...new Set([...GRUPPEN, ...liste.map(v => v.gruppe)])].filter(g => liste.some(v => v.gruppe === g));
    box.innerHTML = gruppen.map(g => `<div class="mv__gruppe"><h3>${esc(g)}</h3>${liste.filter(v => v.gruppe === g).map(v => `
      <button type="button" class="mv__eintrag${v.schluessel === aktiv ? " on" : ""}" data-k="${esc(v.schluessel)}">
        <span class="mv__titel">${esc(v.titel)}<i class="mv__an mv__an--${v.an === "team" ? "team" : "kunde"}">${anText(v.an)}</i></span>
        <span class="mv__betreff">${esc(v.subject)}</span>
      </button>`).join("")}</div>`).join("");
  }

  async function oeffne(k) {
    aktiv = k;
    $$("#mvListe .mv__eintrag").forEach(b => b.classList.toggle("on", b.dataset.k === k));
    const meta = $("#mvMeta");
    try {
      const v = await api("/mail-vorlagen/" + encodeURIComponent(k) + "?firma=" + firma);
      const hw = $("#mvHinweis");
      hw.hidden = !(firma === "hardware" && v.hardwareAktiv === false);
      hw.textContent = "Die Hardware GmbH ist noch nicht aktiv – bis dahin gehen alle Mails als Reeder Software raus.";
      meta.innerHTML = `<p class="mv__kicker">${esc(v.gruppe)} · ${anText(v.an)}</p><h3 class="mv__subject">${esc(v.subject)}</h3>${v.wann ? `<p class="mv__wann">${esc(v.wann)}</p>` : ""}`;
      zeige($("#mvFrame"), v.html);
    } catch (err) { meta.innerHTML = `<p class="mv__wann">${esc(err.message)}</p>`; toast(err.message); }
  }

  async function lade() {
    if (laeuft) return; laeuft = true;
    try {
      const r = await api("/mail-vorlagen?firma=" + firma);
      liste = Array.isArray(r) ? r : (r.vorlagen || []);
      rendereListe();
      if (liste.length) oeffne(aktiv && liste.some(v => v.schluessel === aktiv) ? aktiv : liste[0].schluessel);
      else $("#mvMeta").innerHTML = "";
    } catch (err) { $("#mvListe").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    finally { laeuft = false; }
  }

  const karte = $("#mailVorschau");
  if (karte) {
    const frame = $("#mvFrame");
    setzeGeraet(karte, frame, geraet);
    $("#mvListe").addEventListener("click", e => { const b = e.target.closest(".mv__eintrag"); if (b) oeffne(b.dataset.k); });
    $("#mvGeraet").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (b) { geraet = b.dataset.g; setzeGeraet(karte, frame, geraet); } });
    $("#mvFirma").addEventListener("click", e => {
      const b = e.target.closest("[data-f]"); if (!b || b.dataset.f === firma) return;
      firma = b.dataset.f; $$("#mvFirma [data-f]").forEach(x => x.classList.toggle("on", x === b));
      lade();   // Betreffzeilen können den Firmennamen enthalten – Liste und Ansicht neu laden
    });
    // Laden, sobald der Reiter „E-Mail“ sichtbar wird (admin.js schaltet das hidden-Attribut um)
    const reiter = karte.closest('[data-set="email"]');
    const pruefe = () => { if (reiter && !reiter.hidden && !liste) lade(); };
    if (reiter) new MutationObserver(pruefe).observe(reiter, { attributes: true, attributeFilter: ["hidden"] });
    pruefe();
  }

  /* ---------- Postausgang: gespeicherte Fassung einer verschickten Mail ansehen ---------- */
  async function ansehen(id, titel) {
    let html;
    try {
      const res = await fetch(`/api/admin/postausgang/${id}/html`, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Die E-Mail konnte nicht geladen werden.");
      html = await res.text();
    } catch (err) { return toast(err.message); }
    const m = document.createElement("div");
    m.className = "modal mvmodal";
    m.innerHTML = `<div class="card mvmodal__karte" role="dialog" aria-modal="true" aria-label="E-Mail ansehen">
      <header class="mvmodal__kopf"><div><p class="mv__kicker">Postausgang</p><h2>${esc(titel || "E-Mail")}</h2></div><button type="button" class="x" data-close aria-label="Schließen">✕</button></header>
      <div class="mv__leiste"><div class="seg"><button type="button" data-g="desktop">Desktop</button><button type="button" data-g="handy">Handy</button></div></div>
      <div class="mv__buehne"><iframe class="mv__frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="Gespeicherte E-Mail"></iframe></div>
    </div>`;
    document.body.append(m);
    const frame = $("iframe", m), schliessen = () => { m.remove(); document.removeEventListener("keydown", taste); };
    const taste = e => { if (e.key === "Escape") schliessen(); };
    document.addEventListener("keydown", taste);
    m.addEventListener("click", e => {
      if (e.target === m || e.target.closest("[data-close]")) return schliessen();
      const b = e.target.closest("[data-g]"); if (b) setzeGeraet(m, frame, b.dataset.g);
    });
    setzeGeraet(m, frame, geraet);
    zeige(frame, html);
  }
  const ob = $("#outbox");
  if (ob) ob.addEventListener("click", e => {
    const b = e.target.closest("[data-mail-id]"); if (!b) return;
    ansehen(b.dataset.mailId, b.closest(".ob")?.querySelector("h4")?.textContent);
  });

  window.MAILS = { lade, ansehen };
})();
