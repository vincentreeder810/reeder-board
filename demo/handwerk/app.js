// Beispiel-Website Handwerk: Menü am Handy, sanftes Einblenden, Anfrage-Formular (Demo – es wird nichts verschickt)
(() => {
  // In der Blase (eingebettet auf der Seite „Beispiele“): „Zurück“ schließt die Blase statt die Seite zu wechseln
  if (window.top !== window) {
    document.documentElement.classList.add("in-blase");
    document.querySelectorAll('a[href^="/beispiele.html"]').forEach(a => a.addEventListener("click", e => { e.preventDefault(); window.parent.postMessage("demo-schliessen", location.origin); }));
  }
  // Wer weniger Bewegung möchte: Video anhalten, Vorschaubild zeigen
  const video = document.querySelector(".held__video");
  if (video && matchMedia("(prefers-reduced-motion: reduce)").matches) { video.removeAttribute("autoplay"); video.pause(); }
  const kopf = document.getElementById("kopf"), menue = kopf.querySelector(".kopf__menue");
  menue.addEventListener("click", () => { const auf = kopf.classList.toggle("offen"); menue.setAttribute("aria-expanded", auf); });
  kopf.querySelectorAll(".kopf__nav a").forEach(a => a.addEventListener("click", () => { kopf.classList.remove("offen"); menue.setAttribute("aria-expanded", "false"); }));

  // Abschnitte und Karten blenden beim Scrollen ein
  const ziele = document.querySelectorAll(".abschnitt__kopf, .leistung, .galerie figure, .ablauf li, .stimmen blockquote, .ueber > *, .gebiet > *, .kontakt > *, .faq details");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(eintraege => eintraege.forEach(e => { if (e.isIntersecting) { e.target.classList.add("ist-da"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    ziele.forEach((el, i) => { el.classList.add("rein"); el.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(el); });
  }

  const meldung = document.getElementById("meldung");
  const zeigen = text => { meldung.textContent = text; meldung.hidden = false; clearTimeout(zeigen.t); zeigen.t = setTimeout(() => { meldung.hidden = true; }, 4200); };
  document.getElementById("anfrage").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim() || !f.tel.value.trim()) return zeigen("Bitte Name und Telefonnummer eintragen.");
    zeigen("Beispiel-Website: Hier würde die Anfrage jetzt beim Betrieb ankommen – mit Rückruf-Wunsch.");
    f.reset();
  });
})();

/* „Reeder erklärt“: Beim Scrollen erklärt eine Glas-Karte, warum der jeweilige Abschnitt Kunden gewinnt.
   Der erste Eindruck bleibt frei – die erste Erklärung kommt erst, wenn man zu scrollen beginnt. */
(() => {
  const ERKLAERUNGEN = [
    { sel: ".held", titel: "Erster Eindruck in drei Sekunden", punkte: ["Bewegtes Video: Handwerk und Gefühl sind sofort spürbar", "Klares Nutzenversprechen: „Möbel, die passen“", "Zwei Wege zur Anfrage – Aufmaß oder Anruf"] },
    { sel: ".leiste", titel: "Vertrauen auf einen Blick", punkte: ["Meisterbetrieb, Festpreis, Gewährleistung: die häufigsten Bedenken sind beantwortet, bevor sie entstehen"] },
    { sel: "#leistungen", titel: "Für Google geschrieben", punkte: ["Begriffe, nach denen Kunden suchen: „Küche nach Maß“, „Einbauschrank“, „Treppe“", "„ab“-Preise setzen Erwartungen und sortieren unpassende Anfragen aus"] },
    { sel: "#referenzen", titel: "Der Beweis: echte Projekte", punkte: ["Projekte mit Ort und Dauer zeigen: Die können das wirklich", "Große Bilder wirken stärker als jeder Text"] },
    { sel: ".einblicke", titel: "Nähe durch echte Bilder", punkte: ["Blicke in die Werkstatt machen den Betrieb greifbar – kein austauschbares Stockfoto-Gefühl"] },
    { sel: "#ablauf", titel: "Hemmschwelle senken", punkte: ["Vier einfache Schritte zeigen: Anfragen ist leicht und kostet nichts"] },
    { sel: '[aria-labelledby="stimmen"]', titel: "Andere sprechen für Sie", punkte: ["Bewertungen von Kunden aus der Region überzeugen mehr als Eigenlob"] },
    { sel: "#ueber-uns", titel: "Gesichter statt Logo", punkte: ["Menschen und Geschichte schaffen Vertrauen – man weiß, wer ins Haus kommt"] },
    { sel: ".gebiet", titel: "Lokal gefunden werden", punkte: ["Orte im Text und in den Daten für Google: sichtbar bei „Schreiner in der Nähe“"] },
    { sel: "#kontakt", titel: "Klare Handlungsaufforderung", punkte: ["Kurzes Formular mit Rückruf-Wunsch, Telefonnummer gut sichtbar", "Am Handy immer da: Leiste mit „Anrufen“ und „Aufmaß anfragen“"] },
    { sel: ".faq", titel: "Antworten, die Google zeigt", punkte: ["Häufige Fragen als strukturierte Daten – Google kann sie direkt in den Suchergebnissen anzeigen"] },
  ].map(e => ({ ...e, el: document.querySelector(e.sel) })).filter(e => e.el);
  if (!ERKLAERUNGEN.length) return;
  const karte = document.createElement("aside"); karte.className = "erklaert"; karte.setAttribute("aria-live", "polite"); karte.setAttribute("aria-label", "Reeder erklärt");
  const an = document.createElement("button"); an.className = "erklaert-an"; an.type = "button"; an.innerHTML = '<span class="erklaert__marke">R</span> Erklärungen einblenden';
  document.body.append(karte, an);
  let aus = false, aktiv = -1, gescrollt = false;
  try { aus = sessionStorage.getItem("erklaert-aus") === "1"; } catch {}
  const zeichnen = i => {
    const e = ERKLAERUNGEN[i];
    karte.innerHTML = `<div class="erklaert__inhalt"><div class="erklaert__kopf"><span class="erklaert__marke">R</span>Reeder erklärt<span class="erklaert__nr">${i + 1} / ${ERKLAERUNGEN.length}</span><button type="button" class="erklaert__zu" aria-label="Erklärungen ausblenden">✕</button></div>
      <h4>${e.titel}</h4><ul>${e.punkte.map(p => `<li>${p}</li>`).join("")}</ul>
      <div class="erklaert__punkte" aria-hidden="true">${ERKLAERUNGEN.map((_, k) => `<i class="${k <= i ? "an" : ""}"></i>`).join("")}</div></div>`;
  };
  const zeigen = i => {
    ERKLAERUNGEN.forEach((e, k) => e.el.classList.toggle("ist-erklaert", k === i && !aus));
    if (aus) { karte.classList.remove("ist-da"); an.classList.toggle("ist-da", gescrollt); return; }
    an.classList.remove("ist-da");
    if (i < 0) { karte.classList.remove("ist-da"); return; }
    if (i === aktiv && karte.classList.contains("ist-da")) return;
    if (karte.classList.contains("ist-da")) tauschen(i);
    else { clearTimeout(tauschT); zeichnen(i); requestAnimationFrame(() => karte.classList.add("ist-da")); }
    aktiv = i;
  };
  // Weicher Wechsel: alter Inhalt blendet aus, die Karte gleitet auf die neue Höhe, neuer Inhalt blendet ein
  let tauschT = 0, hoeheT = 0;
  const tauschen = i => {
    clearTimeout(tauschT); clearTimeout(hoeheT);
    karte.classList.add("wechselt");
    tauschT = setTimeout(() => {
      const h0 = karte.offsetHeight;
      karte.style.height = "auto"; zeichnen(i); const h1 = karte.offsetHeight;
      karte.style.height = h0 + "px"; void karte.offsetHeight; karte.style.height = h1 + "px";
      requestAnimationFrame(() => karte.classList.remove("wechselt"));
      hoeheT = setTimeout(() => { karte.style.height = ""; }, 500);
    }, 230);
  };
  ERKLAERUNGEN.forEach(e => e.el.classList.add("erklaert-ziel"));
  // Welcher Abschnitt liegt gerade in der Mitte des Fensters?
  const pruefen = () => {
    // Ganz oben bleibt der erste Eindruck immer frei – auch wenn man wieder hochscrollt
    if (scrollY <= 40) return zeigen(-1);
    gescrollt = true;
    const linie = innerHeight * .55, puffer = innerHeight * .12; let treffer = -1;
    ERKLAERUNGEN.forEach((e, k) => { const r = e.el.getBoundingClientRect(); if (r.top <= linie && r.bottom >= linie) treffer = k; });
    // Kein Hin- und Herspringen an Abschnittsgrenzen: Der aktuelle Abschnitt bleibt, solange er noch knapp an der Linie liegt
    if (aktiv >= 0 && treffer !== aktiv && karte.classList.contains("ist-da")) {
      const r = ERKLAERUNGEN[aktiv].el.getBoundingClientRect();
      if (r.top <= linie + puffer && r.bottom >= linie - puffer) treffer = aktiv;
    }
    if (treffer < 0) return;
    // Erst wechseln, wenn der Abschnitt einen Moment ruhig in der Mitte liegt (schnelles Durchscrollen löst keine Wechsel-Kaskade aus)
    if (treffer === aktiv || !karte.classList.contains("ist-da")) { clearTimeout(pruefen.t); pruefen.ziel = -1; return zeigen(treffer); }
    if (pruefen.ziel === treffer) return; // Wechsel ist schon vorgemerkt
    clearTimeout(pruefen.t); pruefen.ziel = treffer;
    pruefen.t = setTimeout(() => { pruefen.ziel = -1; zeigen(treffer); }, 140);
  };
  let wartet = false;
  addEventListener("scroll", () => { if (wartet) return; wartet = true; requestAnimationFrame(() => { wartet = false; pruefen(); }); }, { passive: true });
  addEventListener("resize", pruefen);
  karte.addEventListener("click", e => { if (!e.target.closest(".erklaert__zu")) return; aus = true; try { sessionStorage.setItem("erklaert-aus", "1"); } catch {} zeigen(aktiv); });
  an.addEventListener("click", () => { aus = false; try { sessionStorage.removeItem("erklaert-aus"); } catch {} aktiv = -1; pruefen(); });
  pruefen();
})();
