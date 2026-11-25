/* =========================================================
   Reeder Software GmbH – Interaktionen (alle Seiten)
   ========================================================= */

/* ---- Einstellungen: hier anpassen ---- */
const CONFIG = {
  email: "kontakt@reeder-tech.de",   // Empfänger der Anfragen
  endpoint: "",                           // Optional: Formular-Endpunkt (z. B. Formspree). Leer = E-Mail-Programm
  hours: { start: 9, end: 17 },           // Buchbare Zeiten Mo–Fr
  weeksAhead: 8,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = matchMedia("(hover: hover)").matches;

/* ---------- Navigation ---------- */
const nav = $("#nav");
const page = document.body.dataset.page;
$$("[data-nav]").forEach(a => a.classList.toggle("is-active", a.dataset.nav === page || (a.dataset.also || "").split(" ").includes(page)));
function updateNav() {
  if (!nav) return;
  nav.classList.toggle("is-scrolled", scrollY > 20);
  const dark = $$(".dark").some(el => { const r = el.getBoundingClientRect(); return r.top <= 34 && r.bottom >= 34; });
  nav.classList.toggle("is-dark", dark);
  // Glasleiste: beim Herunterscrollen kleiner, beim Hochscrollen wieder größer, ganz oben immer groß
  const y = scrollY;
  if (y < 60 || nav.classList.contains("is-open")) nav.classList.remove("is-klein");
  else if (y > navLetzteY + 6) nav.classList.add("is-klein");
  else if (y < navLetzteY - 6) nav.classList.remove("is-klein");
  if (Math.abs(y - navLetzteY) > 6) navLetzteY = y;
}
let navLetzteY = scrollY;
$("#burger")?.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  $("#burger").setAttribute("aria-expanded", open);
});
// Handy-Menü: nach dem Antippen eines Links schließen (wichtig bei Sprüngen innerhalb derselben Seite); immer nur eine Gruppe offen
$$(".nav__mobile a").forEach(a => a.addEventListener("click", () => { nav.classList.remove("is-open"); $("#burger")?.setAttribute("aria-expanded", false); }));
$$(".mnav").forEach(d => d.addEventListener("toggle", () => { if (d.open) $$(".mnav").forEach(x => { if (x !== d) x.open = false; }); }));
// Aufklapper am Desktop: nach einem Klick auf einen Unterpunkt wieder schließen, auch wenn die Maus noch darüber steht
$$(".nav__drop a").forEach(a => a.addEventListener("click", () => { const it = a.closest(".nav__item"); it.classList.add("is-zu"); a.blur(); it.addEventListener("mouseleave", () => it.classList.remove("is-zu"), { once: true }); }));

/* Mobile CTA */
const mcta = $("#mcta");
function updateMcta() {
  if (!mcta) return;
  const atEnd = innerHeight + scrollY > document.body.scrollHeight - 500;
  mcta.classList.toggle("is-on", scrollY > innerHeight * .6 && !atEnd);
}

/* ---------- Reveal ---------- */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
}, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
const observeReveals = () => $$(".reveal:not(.is-in), .hl:not(.is-in)").forEach(el => io.observe(el));
observeReveals();

/* ---------- Hero-Canvas ---------- */
(function heroCanvas() {
  const c = $("#heroCanvas"); if (!c) return;
  const ctx = c.getContext("2d");
  let w, h, dpr, mx = .5, my = .5, visible = true;
  const blobs = [
    { x: .22, y: .35, r: .45, c: [79, 124, 255], a: .34, s: .00011, p: 0 },
    { x: .78, y: .3, r: .5, c: [139, 92, 246], a: .32, s: .00009, p: 2 },
    { x: .55, y: .78, r: .55, c: [236, 72, 153], a: .22, s: .00013, p: 4 },
    { x: .12, y: .85, r: .35, c: [56, 189, 248], a: .18, s: .0001, p: 1 },
  ];
  function size() { dpr = Math.min(devicePixelRatio || 1, 1.5); w = c.clientWidth; h = c.clientHeight; c.width = w * dpr / 2; c.height = h * dpr / 2; }
  function draw(t) {
    ctx.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    blobs.forEach((b, i) => {
      const x = (b.x + Math.sin(t * b.s + b.p) * .12 + (mx - .5) * .06 * (i + 1)) * w;
      const y = (b.y + Math.cos(t * b.s * 1.3 + b.p) * .1 + (my - .5) * .05 * (i + 1)) * h * .7;
      const r = b.r * Math.max(w, h) * .6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${b.c},${b.a})`); g.addColorStop(1, `rgba(${b.c},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    ctx.globalCompositeOperation = "source-over";
    const fade = ctx.createLinearGradient(0, h * .55, 0, h);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
  }
  new IntersectionObserver(([e]) => visible = e.isIntersecting).observe(c);
  function loop(t) { if (visible) draw(t); if (!reduced) requestAnimationFrame(loop); }
  size(); addEventListener("resize", size); requestAnimationFrame(loop);
  addEventListener("pointermove", e => { mx = e.clientX / innerWidth; my = e.clientY / innerHeight; }, { passive: true });
})();

/* ---------- Hero-Geräte: Maus-Parallaxe ---------- */
(function heroStage() {
  const stage = $("#heroStage"); if (!stage || reduced || !canHover) return;
  const items = $$("[data-depth]", stage);
  stage.parentElement.addEventListener("pointermove", e => {
    const dx = e.clientX / innerWidth - .5, dy = e.clientY / innerHeight - .5;
    items.forEach(el => { const d = +el.dataset.depth * 400; el.style.translate = `${dx * d}px ${dy * d * .6}px`; });
  });
})();

/* ---------- Parallaxe & Ablauf beim Scrollen ---------- */
const parallaxEls = $$(".parallax");
function updateParallax() {
  if (reduced) return;
  parallaxEls.forEach(el => {
    const r = el.getBoundingClientRect();
    el.style.transform = `translate3d(0, ${(r.top + r.height / 2 - innerHeight / 2) * +el.dataset.speed}px, 0)`;
  });
}
const stepsEl = $("#steps");
function updateSteps() {
  if (!stepsEl) return;
  const r = stepsEl.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (innerHeight * .75 - r.top) / (r.height + innerHeight * .2)));
  stepsEl.style.setProperty("--p", p.toFixed(3));
  const steps = $$(".step", stepsEl);
  steps.forEach((s, i) => s.classList.toggle("is-lit", p >= i / steps.length + .02));
}

/* Unternavigation (Produkte / Leistungen): aktiven Abschnitt markieren */
const subLinks = $$("[data-sub] a");
const subTargets = subLinks.map(a => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
function updateSub() {
  if (!subTargets.length) return;
  let cur = subTargets[0].id;
  const sichtbar = subTargets.filter(t => t.offsetParent !== null); if (!sichtbar.length) return; cur = sichtbar[0].id;
  sichtbar.forEach(t => { if (t.getBoundingClientRect().top < innerHeight * .4) cur = t.id; });
  subLinks.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === "#" + cur));
}

let ticking = false;
function onScroll() {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => { updateNav(); updateMcta(); updateParallax(); updateSteps(); updateSub(); ticking = false; });
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
onScroll();

/* ---------- Zähler ---------- */
const countIO = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target, to = +el.dataset.to, t0 = performance.now(), dur = 1400;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
    countIO.unobserve(el);
  });
}, { threshold: .6 });
$$(".count").forEach(el => countIO.observe(el));

/* ---------- Kippen & Magnet ---------- */
if (!reduced && canHover) {
  $$("[data-tilt]").forEach(el => {
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg) translateY(-4px)`;
    });
    el.addEventListener("pointerleave", () => el.style.transform = "");
  });
  $$(".magnetic").forEach(el => {
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .15}px, ${(e.clientY - r.top - r.height / 2) * .25}px)`;
    });
    el.addEventListener("pointerleave", () => el.style.transform = "");
  });
}

/* ---------- Toast ---------- */
function toast(msg) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.add("is-on");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-on"), 3600);
}

/* =========================================================
   Termin-Logik (wird auch für „nächster freier Termin“ genutzt)
   ========================================================= */
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const today = new Date(); today.setHours(0, 0, 0, 0);
const firstBookable = new Date(today); firstBookable.setDate(today.getDate() + 1);
const lastBookable = new Date(today); lastBookable.setDate(today.getDate() + CONFIG.weeksAhead * 7);
const isWorkday = d => d.getDay() > 0 && d.getDay() < 6;
const isBookable = d => d >= firstBookable && d <= lastBookable && isWorkday(d);
const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
const fmtDate = d => `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const fmtShort = d => `${DAYS[d.getDay()].slice(0, 2)}., ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}.`;

// Beispiel-Belegung (später über das Admin-Board durch echte Verfügbarkeit ersetzen)
function busy(date, h, m) {
  const seed = date.getFullYear() * 1e4 + (date.getMonth() + 1) * 100 + date.getDate() + h * 7 + m;
  return ((Math.sin(seed) * 1e4) % 1 + 1) % 1 < .3;
}
function slotsFor(date, min) {
  const step = min >= 60 ? 60 : 30, out = [];
  for (let t = CONFIG.hours.start * 60; t + min <= CONFIG.hours.end * 60; t += step) {
    const h = Math.floor(t / 60), m = t % 60;
    if (h === 12 || busy(date, h, m)) continue;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}
/* ---------- Server (Admin-Board) ---------- */
// Läuft die Seite über den eigenen Server (npm start), kommen freie Zeiten und Anfragen über die API.
// Als reine Dateien geöffnet, fällt alles automatisch auf den Vorschau-Modus zurück.
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let serverMode = false;
const serverReady = location.protocol.startsWith("http")
  ? fetch("/api/ping", { cache: "no-store" }).then(r => (serverMode = r.ok)).catch(() => false)
  : Promise.resolve(false);
const slotCache = {};
async function loadMonth(type, monthDate) {
  const key = `${type}|${monthDate.getFullYear()}-${monthDate.getMonth()}`;
  if (slotCache[key]) return slotCache[key];
  slotCache[key] = "loading";
  const from = new Date(Math.max(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1), today));
  const to = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  try {
    const r = await fetch(`/api/slots?type=${type}&from=${ymd(from)}&to=${ymd(to)}`, { cache: "no-store" });
    slotCache[key] = r.ok ? (await r.json()).days : "error";
  } catch { slotCache[key] = "error"; }
  return slotCache[key];
}

// „Nächster freier Termin“ überall anzeigen
(async function nextSlot() {
  const els = $$("[data-next-slot]"); if (!els.length) return;
  if (await serverReady) {
    try {
      const n = await (await fetch("/api/next-slot", { cache: "no-store" })).json();
      if (n.day) { const [y, mo, da] = n.day.split("-").map(Number); els.forEach(el => el.textContent = `${fmtShort(new Date(y, mo - 1, da))}, ${n.t} Uhr`); }
    } catch { /* bleibt „in Kürze“ */ }
    return;
  }
  const d = new Date(firstBookable);
  for (let i = 0; i < 30; i++, d.setDate(d.getDate() + 1)) {
    if (!isWorkday(d)) continue;
    const s = slotsFor(d, 30);
    if (s.length) { els.forEach(el => el.textContent = `${fmtShort(d)}, ${s[0]} Uhr`); return; }
  }
})();

/* ---------- Projekte (Seite „Projekte“) ---------- */
const PROJECTS = [
  {
    id: "perspektive", type: "produkt", tag: "Eigenes Produkt · Gesellschaft", title: "Perspektive",
    short: "Verstehen, was andere Menschen denken und warum – mit Persönlichkeitstest und Rhetorik-Training.",
    img: "assets/img/app-perspektive-ergebnis.webp", pos: "center 5%",
    lead: "Perspektive macht sichtbar, warum Menschen zu ihren Positionen kommen – emotional und fachlich, bei Politik, Gesellschaft und Alltagsfragen. Ein Persönlichkeitstest zeigt, wer man selbst ist. Im Training mit KI-Gegenübern lernt man, besser zu argumentieren, rhetorisch sicherer zu werden und flüssiger zu sprechen. Niemand wird belehrt.",
    features: ["Persönlichkeitstest mit teilbarer Story-Karte", "Verstehen, wie andere zu ihrer Position kommen", "Gesprächstraining mit KI-Gegenüber", "„Mittendrin“: 360-Grad-Diskussion gegen wechselnde Gäste", "Rhetorik: besser argumentieren, flüssiger reden", "Persönliche Inhalte bleiben auf dem Gerät"],
    stack: ["Expo", "React Native", "TypeScript", "Supabase", "OpenAI"], demo: "Perspektive",
  },
  {
    id: "lernpass", type: "produkt", tag: "Eigenes Produkt · Bildung", title: "Lernpass",
    short: "KI, die beim Lernen hilft statt es abzunehmen – mit Rechercheaufträgen, Lernspielen und Gamification.",
    img: "assets/img/app-lernpass-modul.webp", pos: "center 6%",
    lead: "Lernpass dreht die übliche KI-Nutzung um: Die KI nimmt das Lernen nicht ab, sie hilft, besser zu lernen. Lernende geben ihren Stoff ein, die KI erkennt Kern- und Randwissen, stellt gezielte Fragen und gibt Rechercheaufträge – die Antworten erarbeiten die Lernenden selbst. Über Level, Lernspiele, Coins und Tagesziele wird das Wissen spielerisch gefestigt.",
    features: ["Lernmodule und Karteikarten aus eigenem Stoff, auch per Spracheingabe", "KI stellt Fragen und Rechercheaufträge statt Lösungen", "Gamification: Level, Coins, Tagesziel, fällige Karten", "Lernspiele: Tabu, Millionär, Professor, Patientengespräch", "Mündliche Prüfungssimulation mit 3D-Prüfer", "Eine Codebasis für iPhone, iPad, Android und Web"],
    stack: ["Expo", "React Native", "TypeScript", "SQLite", "Three.js", "OpenAI"], demo: "Lernpass",
  },
  {
    id: "covered", type: "produkt", tag: "Eigenes Produkt · KI-Agenten · In Entwicklung", title: "Covered",
    short: "Ihr persönliches Team aus KI-Agenten, das selbstständig für Sie handelt – bis zum Anruf beim Arzt.",
    img: "assets/img/app-covered-team.webp", pos: "center 42%",
    lead: "Covered ist kein Assistent, der nur antwortet, sondern ein persönliches Team aus KI-Agenten, das selbstständig handelt. Covered ruft für Sie beim Arzt an, reserviert, bestellt, stimmt Termine mit den Covered-Agenten Ihrer Kontakte ab und behält Privat- und Berufsleben im Blick – Sie bekommen nur noch das Ergebnis.",
    features: ["Telefon-Agent: ruft für Sie an – Arzt, Restaurant, Lieferdienst", "Autonome Agenten erledigen Aufgaben im Hintergrund", "Kalender privat und beruflich, auch mit Outlook", "Agent-zu-Agent-Abstimmung mit Ihren Kontakten", "Dokumente, Nachrichten, Erinnerungen und Tageszusammenfassung", "Volle Kontrolle: Sie bestimmen, was die Agenten dürfen"],
    stack: ["KI-Agenten", "Sprach-KI", "Telefonie", "iOS", "Android"], demo: "Covered",
  },
  {
    id: "businesscat", type: "produkt", tag: "Eigenes Produkt · Gründung", title: "BusinessCat",
    short: "Aus guten Ideen werden Unternehmen – KI-geführte Gründung in Phasen.",
    art: '<div class="art art--bcat">Business<span>Cat</span></div>',
    lead: "Viele Menschen haben gute Ideen, aber kaum jemand hat gelernt, daraus ein Unternehmen zu machen. BusinessCat (Cat = Catalyst) führt Gründer mit KI Schritt für Schritt von der Idee bis zur Umsetzung – in klaren Phasen, mit passenden Experten und auf Wunsch mit Zugang zu Investoren und Banken.",
    features: ["KI-geführte Gründungsplanung in Phasen – Phase 0 kostenlos", "Markt, Zielgruppe, Geschäftsmodell und Finanzen strukturiert", "Matching mit Experten und Mitgründern", "Teamvereinbarungen bis zur Beteiligung", "Zugang für Investoren und Banken", "Zweisprachig: Deutsch und Englisch"],
    stack: ["Web-App", "Next.js", "KI", "Stripe", "DE / EN"], demo: "BusinessCat",
  },
  {
    id: "physio", type: "kunde", tag: "Kundenprojekt · Physiotherapie", title: "Patientenverwaltung Physiotherapie",
    short: "Komplette Patientenverwaltung für Physiotherapie – mit KI-Anamnese vor der ersten Behandlung.",
    img: "assets/img/praxis-koerper.webp",
    lead: "Für einen Kunden aus der Physiotherapie haben wir eine komplette Patientenverwaltung entwickelt. Neue Patientinnen und Patienten melden sich online an und führen vor der ersten Behandlung eine KI-gestützte Anamnese durch. Die Praxis erhält eine strukturierte Zusammenfassung und organisiert Termine, Akte und Abrechnung an einem Ort.",
    features: ["KI-Anamnese vor der ersten Behandlung", "Digitaler Check-in und Online-Terminbuchung", "Schmerzangaben am 3D-Körpermodell", "Check-in-Terminal und Patientenaufruf im Wartebereich", "Praxiskalender, Patientenakte, Verordnungen", "Abrechnung und Therapieberichte"],
    stack: ["Web-App", "KI-Integration", "3D", "Datenschutz"], demo: null,
  },
  {
    id: "aesthetik", type: "kunde", tag: "Kundenprojekt · Schönheitschirurgie", title: "Patientenverwaltung Schönheitschirurgie",
    short: "Patientensystem mit OP-Plan, Vor- und Nachsorge, KI-Wundmanager und Fernsprechstunde.",
    art: '<div class="art art--clinic"><span>OP-Plan · Nachsorge · KI</span></div>',
    lead: "Für einen Kunden aus der ästhetischen Chirurgie haben wir ein Patientensystem entwickelt, das den gesamten Behandlungsweg begleitet: von der OP-Planung über die Vorbereitung bis zur Nachsorge. Ein KI-Wundmanager wertet digital erfasste Wundfotos aus, Fernsprechstunden ersparen Wege.",
    features: ["OP-Planung", "Strukturierte Vor- und Nachsorge", "KI-Wundmanager mit digitaler Wunderfassung", "Fernsprechstunde per Video", "Digitale Anbindung von Patientinnen und Patienten"],
    stack: ["Web-App", "KI-Bildanalyse", "Video", "Datenschutz"], demo: null,
  },
  {
    id: "telefon", type: "leistung", tag: "Leistung · KI", title: "KI-Telefonassistent",
    short: "Nimmt Anrufe an, beantwortet Fragen und vergibt Termine – mit Schnittstelle zu Praxis oder Büro.",
    art: '<div class="art art--phone"><span>☏</span></div>',
    lead: "Wir integrieren KI-Telefonassistenten, die Anrufe rund um die Uhr annehmen, Fragen beantworten, Anliegen aufnehmen und Termine vergeben. Über eine Schnittstelle landet alles direkt in Ihrer Praxis-, Büro- oder CRM-Software.",
    features: ["Natürliche Gespräche auf Deutsch", "Terminvergabe direkt im Kalender", "Schnittstelle zu Ihrer Software", "Weiterleitung wichtiger Anrufe an Ihr Team", "Zusammenfassung jedes Anrufs"],
    stack: ["Telefonie", "Sprach-KI", "Schnittstellen"], demo: "KI-Telefonassistent",
  },
  {
    id: "auftrag", type: "kunde", tag: "Für Ihr Unternehmen", title: "Ihr Projekt",
    short: "Website, Web-App, KI-Integration oder Praxissystem – erzählen Sie uns, was Sie vorhaben.",
    art: '<div class="art art--web">+ Ihr Projekt</div>',
    lead: "Wir entwickeln für Unternehmen mit derselben Sorgfalt wie für unsere eigenen Produkte: Websites, Portale, mobile Apps, KI-Telefonassistenten und Systeme für Praxen und Kliniken. Beschreiben Sie uns Ihr Vorhaben – Sie erhalten innerhalb eines Werktags eine Antwort.",
    features: ["Kostenloses Erstgespräch", "Kostenloser Prototyp", "Festpreis, Festpreis + Betreuung oder Signature", "Einrichtung und Betreuung nach dem Launch"],
    stack: ["Web", "iOS", "Android", "KI"], demo: "order",
  },
];

const ORDER = ["physio", "aesthetik", "telefon", "covered", "businesscat", "lernpass", "perspektive", "auftrag"];
PROJECTS.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
const cardsEl = $("#projectCards");
if (cardsEl) {
  cardsEl.innerHTML = PROJECTS.map((p, i) => `
    <article class="card reveal" style="--d:${(i % 3) * .08}s" data-type="${p.type}" data-id="${p.id}" tabindex="0" role="button" aria-label="${p.title} – Details öffnen">
      <div class="card__media">${p.img ? `<img src="${p.img}" alt="" loading="lazy" style="object-position:${p.pos || "top"}">` : p.art}</div>
      <div class="card__body">
        <span class="badge">${p.tag}</span>
        <h3>${p.title}</h3>
        <p>${p.short}</p>
        <div class="card__meta"><span>Details ansehen</span><span>→</span></div>
      </div>
    </article>`).join("");
  observeReveals();
  $$(".filter").forEach(btn => btn.addEventListener("click", () => {
    $$(".filter").forEach(b => { b.classList.toggle("is-active", b === btn); b.setAttribute("aria-selected", b === btn); });
    const f = btn.dataset.filter;
    $$(".card", cardsEl).forEach(c => c.classList.toggle("is-hidden", f !== "alle" && c.dataset.type !== f));
  }));
}

/* ---------- Modal ---------- */
const modal = $("#modal");
let lastFocus = null, currentProject = null;
function openProject(id) {
  const p = PROJECTS.find(x => x.id === id); if (!p || !modal) return;
  currentProject = p; lastFocus = document.activeElement;
  $("#modalHero").innerHTML = p.img ? `<img src="${p.img}" alt="${p.title}" style="object-position:${p.pos || "top"}">` : p.art;
  $("#modalTag").textContent = p.tag;
  $("#modalTitle").textContent = p.title;
  $("#modalLead").textContent = p.lead;
  $("#modalFeatures").innerHTML = p.features.map(f => `<li>${f}</li>`).join("");
  $("#modalStack").innerHTML = p.stack.map(s => `<span>${s}</span>`).join("");
  const btn = $("#modalDemo");
  if (p.demo === "order") { btn.href = "termin.html?modus=auftrag"; btn.firstChild.textContent = "Projekt anfragen "; }
  else if (p.type === "kunde") { btn.href = `termin.html?modus=auftrag&bezug=${encodeURIComponent(p.title)}`; btn.firstChild.textContent = "Ähnliches Projekt anfragen "; }
  else if (p.type === "leistung") { btn.href = `termin.html?modus=auftrag&art=${encodeURIComponent(p.title)}`; btn.firstChild.textContent = "Jetzt anfragen "; }
  else { btn.href = `termin.html?demo=${encodeURIComponent(p.demo)}`; btn.firstChild.textContent = p.id === "covered" ? "Frühen Zugang anfragen " : "Demo vereinbaren "; }
  modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
  $(".modal__close", modal).focus();
  history.replaceState(null, "", "#" + p.id);
}
function closeModal() {
  modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  history.replaceState(null, "", location.pathname + location.search);
  lastFocus && lastFocus.focus();
}
if (modal) {
  cardsEl?.addEventListener("click", e => { const c = e.target.closest(".card"); c && openProject(c.dataset.id); });
  cardsEl?.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("card")) { e.preventDefault(); openProject(e.target.dataset.id); } });
  $$("[data-close]", modal).forEach(b => b.addEventListener("click", closeModal));
  addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal(); });
  const h = location.hash.slice(1);
  if (h && PROJECTS.some(p => p.id === h)) setTimeout(() => openProject(h), 400);
}

/* =========================================================
   Termin buchen (Seite „Termin“): Was → Thema → Datum & Zeit → Daten → sofort bestätigt
   ========================================================= */
const booker = $("#booker");
if (booker) {
  const state = { step: 1, typ: "Kostenloses Erstgespräch", type: "erstgespraech", min: 30, price: 0, product: "", date: null, time: null, start: null, extra: "" };
  let view = new Date(firstBookable.getFullYear(), firstBookable.getMonth(), 1);
  const topics = () => $$('#topics input:checked').map(i => i.value);

  const goStep = n => {
    state.step = n;
    $$(".bstep", booker).forEach(s => s.classList.toggle("is-active", +s.dataset.step === n));
    $$(".booker__progress span").forEach((s, i) => s.classList.toggle("is-on", i < n));
    $(".booker__progress").style.display = n === 4 ? "none" : "";
    if (n === 3) {
      const t = topics().length ? ` · ${topics().join(", ")}` : "";
      $("#summary").innerHTML = `<b>${state.typ}${state.product ? " · " + state.product : ""}</b>${t} · ${fmtDate(state.date)}, ${state.time} Uhr · ${state.min} Min${state.price ? ` · ${state.price} € zzgl. MwSt.` : ""}`;
    }
    booker.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $$("[data-next]", booker).forEach(b => b.addEventListener("click", () => {
    // Ohne "Worum geht es?" wissen wir nicht, welche Fragen wir vorab schicken sollen
    if (state.step === 1 && !topics().length && state.type !== "produktdemo") { $("#worumErr").hidden = false; return $("#topicField").scrollIntoView({ behavior: "smooth", block: "start" }); }
    goStep(state.step + 1);
  }));
  // Auswahl und Terminart passen sich aneinander an: nur Hardware gewählt → Hardware-Erstgespräch und umgekehrt
  $("#topics").addEventListener("change", () => {
    $("#worumErr").hidden = true;
    const t = topics(), hw = state.type.startsWith("hw_"), setzen = v => { const r = $(`input[name="typ"][value="${v}"]`); if (r) { r.checked = true; syncType(); } };
    if (t.length && t.every(x => x === "Hardware") && !hw) setzen("hw_erstgespraech");
    else if (hw && !t.includes("Hardware")) setzen("erstgespraech");
  });
  // Schritt 1 hat zwei Teile: erst "Worum geht es?", nach "Weiter" nur die Terminarten, die dazu passen.
  // Wer Hardware wählt, sieht keine Produktdemo; wer Website oder Software wählt, keine Hardware-Termine.
  const typenZeigen = () => {
    const t = topics(), hw = t.includes("Hardware"), sw = t.some(x => x !== "Hardware");
    $$("#terminWahl [data-b]").forEach(el => el.hidden = el.dataset.b === "hardware" ? !hw : !sw);
    if (!(hw && sw)) $$("#terminWahl .types__h").forEach(el => el.hidden = true);   // Überschriften nur, wenn beide Gruppen zu sehen sind
    const r = $('input[name="typ"]:checked');
    if (!r || r.closest("label").hidden) { const erste = $$('input[name="typ"]').find(i => !i.closest("label").hidden); if (erste) { erste.checked = true; syncType(); } }
  };
  const teil = (zweiter, rollen = true) => {
    $("#topicField").hidden = zweiter; $("#terminWahl").hidden = !zweiter;
    if (zweiter) typenZeigen();
    if (rollen) booker.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Der Kasten rechts oben passt sich der Auswahl an: Software/Website, Hardware, beides oder noch nichts
  const seitenleiste = () => {
    const t = topics(), hw = t.includes("Hardware"), dg = t.some(x => x !== "Hardware");
    const zeigen = hw && dg ? "beides" : hw ? "hardware" : dg ? "digital" : "start";
    $$(".aside [data-fuer]").forEach(el => el.hidden = el.dataset.fuer !== zeigen);
  };
  $("#topics").addEventListener("change", seitenleiste);
  $("#worumWeiter").addEventListener("click", () => { if (!topics().length) return void ($("#worumErr").hidden = false); teil(true); });
  $("#worumZurueck").addEventListener("click", () => teil(false));
  $$("[data-prev]", booker).forEach(b => b.addEventListener("click", () => goStep(state.step - 1)));

  const MSG_LABEL = { erstgespraech: "Erzählen Sie kurz von Ihrem Vorhaben (optional)", produktdemo: "Was interessiert Sie besonders? (optional)", beratung: "Worum soll es in der Beratung gehen? (optional)", hw_erstgespraech: "Beschreiben Sie kurz Ihre Produktidee (optional)", hw_konzept: "Für welches Produkt soll das Konzept sein? (optional)" };
  const MSG_HINT = { erstgespraech: "Zum Beispiel: Wir brauchen eine neue Website mit Online-Terminbuchung.", produktdemo: "Zum Beispiel: Wie funktioniert die Terminplanung?", beratung: "Zum Beispiel: Wir verlieren viel Zeit mit Papierkram und Telefon – was ließe sich automatisieren?", hw_erstgespraech: "Zum Beispiel: Eine Matratzenauflage, die mit Wasser gekühlt wird.", hw_konzept: "Zum Beispiel: Ein Gehäuse mit Sensorik für unsere Maschine, Stückzahl etwa 50." };
  const syncType = () => {
    const r = $('input[name="typ"]:checked');
    const changed = state.type !== r.value;
    state.type = r.value; state.typ = r.dataset.label; state.min = +r.dataset.min; state.price = +(r.dataset.price || 0);
    const isDemo = state.type === "produktdemo";
    $("#demoProductField").classList.toggle("is-on", isDemo);
    // Hardware-Terminarten gehören immer zum Bereich Hardware
    if (state.type.startsWith("hw_")) $$('#topics input').forEach(i => { if (i.value === "Hardware") i.checked = true; });
    $("#priceNote").hidden = !state.price;
    $("#bMsgLabel").textContent = MSG_LABEL[state.type]; $("#bMsg").placeholder = MSG_HINT[state.type];
    state.product = isDemo ? $("#demoProduct").value : "";
    if (!changed) return;
    if (serverMode) { state.date = state.time = state.start = null; $("#slots").innerHTML = ""; $("#calDay").textContent = "Bitte wählen Sie einen Tag."; $("#toStep3").disabled = true; renderCal(); }
    else if (state.date) renderSlots();
  };
  $$('input[name="typ"]').forEach(r => r.addEventListener("change", syncType));
  $("#demoProduct").addEventListener("change", syncType);

  const monthData = () => slotCache[`${state.type}|${view.getFullYear()}-${view.getMonth()}`];
  const renderCal = () => {
    $("#calTitle").textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
    let md = null;
    if (serverMode) {
      md = monthData();
      if (!md) { loadMonth(state.type, new Date(view)).then(renderCal); md = "loading"; }
      if (md === "loading") $("#calDay").textContent = "Freie Termine werden geladen …";
      else if (md === "error") $("#calDay").textContent = "Der Kalender ist gerade nicht erreichbar – bitte versuchen Sie es später.";
      else if (!state.date) $("#calDay").textContent = Object.keys(md).length ? "Bitte wählen Sie einen Tag." : "In diesem Monat sind keine Termine mehr frei.";
    }
    const offset = (view.getDay() + 6) % 7;
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    let html = "";
    for (let i = 0; i < offset; i++) html += "<span></span>";
    for (let d = 1; d <= days; d++) {
      const date = new Date(view.getFullYear(), view.getMonth(), d);
      const ok = serverMode ? (md && typeof md === "object" && (md[ymd(date)] || []).length > 0) : isBookable(date);
      const cls = [ok ? "av" : "", sameDay(date, state.date) ? "sel" : "", sameDay(date, today) ? "today" : ""].join(" ");
      html += `<button type="button" class="${cls}" ${ok ? "" : "disabled"} data-d="${d}" aria-label="${fmtDate(date)}">${d}</button>`;
    }
    $("#calGrid").innerHTML = html;
    $("#calPrev").disabled = view <= new Date(firstBookable.getFullYear(), firstBookable.getMonth(), 1);
    $("#calNext").disabled = new Date(view.getFullYear(), view.getMonth() + 1, 1) > lastBookable;
  };
  $("#calPrev").addEventListener("click", () => { view.setMonth(view.getMonth() - 1); renderCal(); });
  $("#calNext").addEventListener("click", () => { view.setMonth(view.getMonth() + 1); renderCal(); });
  $("#calGrid").addEventListener("click", e => {
    const b = e.target.closest("button[data-d]"); if (!b || b.disabled) return;
    state.date = new Date(view.getFullYear(), view.getMonth(), +b.dataset.d);
    state.time = null; $("#toStep3").disabled = true;
    renderCal(); renderSlots();
  });
  const renderSlots = () => {
    $("#calDay").textContent = fmtDate(state.date);
    const md = serverMode ? monthData() : null;
    const out = serverMode ? ((md && typeof md === "object" && md[ymd(state.date)]) || []) : slotsFor(state.date, state.min).map(t => ({ t, start: "" }));
    $("#slots").innerHTML = out.length
      ? out.map((s, i) => `<button type="button" data-start="${s.start}" style="animation-delay:${i * 25}ms" class="${s.t === state.time ? "sel" : ""}">${s.t}</button>`).join("")
      : `<p class="hint">An diesem Tag ist leider nichts mehr frei.</p>`;
  };
  $("#slots").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.time = b.textContent; state.start = b.dataset.start;
    $$("#slots button").forEach(x => x.classList.toggle("sel", x === b));
    $("#toStep3").disabled = false;
  });

  const validate = form => {
    let ok = true;
    $$("[required]", form).forEach(el => {
      const valid = el.type === "checkbox" ? el.checked : el.type === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()) : el.value.trim() !== "";
      (el.closest(".field") || el.closest(".consent")).classList.toggle("has-error", !valid);
      if (!valid && ok) { el.focus(); ok = false; }
    });
    return ok;
  };
  const send = async (subject, data) => {
    const body = Object.entries(data).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
    if (CONFIG.endpoint) {
      try {
        const res = await fetch(CONFIG.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ _subject: subject, ...data }) });
        if (res.ok) return true;
      } catch (_) { /* Fallback unten */ }
    }
    location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return true;
  };

  $("#bookingForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    if (!validate(f)) { toast("Bitte füllen Sie die markierten Felder aus."); return; }
    const fd = new FormData(f), th = topics();
    const note = [$("#bMsg").value.trim(), state.extra].filter(Boolean).join("\n\n");
    const when = `${fmtDate(state.date)} um ${state.time} Uhr`;
    if (serverMode && state.start) {
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        const r = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          type: state.type, product: state.product, start: state.start, topics: th, name: fd.get("name"), email: fd.get("email"), phone: fd.get("telefon"),
          company: fd.get("firma"), channel: fd.get("kanal"), message: note, website: fd.get("website") }) });
        if (r.status === 409) {
          Object.keys(slotCache).forEach(k => delete slotCache[k]);
          toast("Dieser Termin wurde gerade vergeben. Bitte wählen Sie einen anderen.");
          state.time = state.start = null; $("#toStep3").disabled = true; goStep(2); renderCal(); renderSlots(); return;
        }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Fehler");
        Object.keys(slotCache).forEach(k => delete slotCache[k]);
        state.confirmed = true;
        $("#doneTitle").textContent = "Ihr Termin ist gebucht.";
        $("#doneText").textContent = `${state.typ}${state.product ? " – " + state.product : ""} am ${when}. Die Bestätigung${fd.get("kanal") === "Video" ? " mit Videolink" : ""} ist unterwegs an ${fd.get("email")}.`
          + (state.type === "erstgespraech" ? " Gleich danach bekommen Sie einen kurzen Fragebogen – daraus bereiten wir schon einen ersten Entwurf für unser Gespräch vor." : "")
          + (state.price ? ` Die Beratung kostet ${state.price} € zzgl. MwSt., die Rechnung kommt nach dem Termin.` : "");
        goStep(4); return;
      } catch (err) { toast(err.message === "Fehler" ? "Das hat nicht geklappt – bitte versuchen Sie es erneut." : err.message); return; }
      finally { btn.disabled = false; }
    }
    // Ohne Server (Seite als Datei geöffnet): per E-Mail
    const data = { Termin: `${state.typ}${state.product ? " – " + state.product : ""}, ${when} (${state.min} Min)`, Themen: th.join(", "), Kanal: fd.get("kanal"),
      Name: fd.get("name"), Unternehmen: fd.get("firma"), "E-Mail": fd.get("email"), Telefon: fd.get("telefon"), Nachricht: note };
    await send(`Terminbuchung: ${data.Termin}`, data);
    state.confirmed = false;
    $("#doneTitle").textContent = "Vielen Dank!";
    $("#doneText").textContent = `Ihre Buchung für ${when} ist eingegangen. Sie erhalten in Kürze eine Bestätigung an ${fd.get("email")}.`;
    goStep(4);
  });
  $("#restart").addEventListener("click", () => {
    $("#bookingForm").reset(); $$('#topics input').forEach(i => i.checked = false); teil(false, false); seitenleiste(); $("#bMsg").value = "";
    state.date = state.time = state.start = null; $("#slots").innerHTML = ""; $("#calDay").textContent = "Bitte wählen Sie einen Tag."; $("#toStep3").disabled = true; renderCal(); goStep(1);
  });

  $("#icsBtn").addEventListener("click", () => {
    const [h, m] = state.time.split(":").map(Number);
    const s = new Date(state.date); s.setHours(h, m, 0, 0);
    const e = new Date(s.getTime() + state.min * 60000);
    const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reeder Software GmbH//Termin//DE", "BEGIN:VEVENT",
      `UID:${Date.now()}@reeder-tech.de`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(s)}`, `DTEND:${z(e)}`,
      `SUMMARY:${state.typ}${state.product ? " " + state.product : ""} – Reeder Software`,
      "DESCRIPTION:Termin bei der Reeder Software GmbH. Details und Videolink stehen in Ihrer Bestätigungs-E-Mail.",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "termin-reeder-software.ics"; a.click();
  });

  /* Vorauswahl über die Adresse – auch alte Links funktionieren weiter:
     ?demo=Lernpass · ?typ=Produktdemo|beratung · ?modus=auftrag&art=KI-Integration · &modell=Signature · &bezug=Projektname */
  const q = new URLSearchParams(location.search);
  const pick = v => { const r = $(`input[name="typ"][value="${v}"]`); if (r) r.checked = true; };
  const typ = (q.get("typ") || "").toLowerCase();
  if (q.get("demo")) { pick("produktdemo"); $("#demoProduct").value = q.get("demo"); }
  else if (typ.includes("demo")) pick("produktdemo");
  else if (typ.startsWith("hw_")) pick(typ);   // Hardware-Terminarten: ?typ=hw_erstgespraech | hw_konzept
  else if (typ.includes("workshop") || typ.includes("beratung")) pick("beratung");
  // Alte Links nennen einzelne Leistungen (z. B. art=KI-Integration): alles außer "Website" gehört zu Software
  if (q.get("art")) { const ziel = /website/i.test(q.get("art")) ? "Website" : /hardware/i.test(q.get("art")) ? "Hardware" : "Software"; $$('#topics input').forEach(i => { if (i.value === ziel) i.checked = true; }); }
  if ((q.get("demo") || typ) && !typ.startsWith("hw_") && !topics().length) $$('#topics input').forEach(i => { if (i.value === "Software") i.checked = true; });
  if (q.get("modell")) state.extra = `Interesse am Modell: ${q.get("modell")}`;
  if (q.get("bezug")) $("#bMsg").value = `Ähnlich wie „${q.get("bezug")}“: `;

  serverReady.then(() => { state.type = ""; syncType(); seitenleiste(); if (topics().length && (q.get("typ") || q.get("demo") || q.get("art"))) teil(true, false); if (!serverMode) renderCal(); });
}

/* ---------- Store-Links (Platzhalter bis zur Veröffentlichung) ---------- */
$$("[data-soon]").forEach(a => a.addEventListener("click", e => { if (a.getAttribute("href") === "#") { e.preventDefault(); toast("Der Link folgt in Kürze – fragen Sie gern eine Demo an."); } }));

/* ---------- Allgemein ---------- */
$$("[data-year]").forEach(el => el.textContent = new Date().getFullYear());
$$(".js-mail").forEach(a => { a.href = "mailto:" + CONFIG.email; a.textContent = CONFIG.email; });

/* ---------- Kundenportal-Button: oben ausgeschrieben, beim Scrollen rund ---------- */
const fab = $("#fab");
if (fab) {
  const syncFab = () => fab.classList.toggle("is-compact", scrollY > 320);
  addEventListener("scroll", syncFab, { passive: true }); syncFab();
}

/* ---------- 3D-Schaustück (Hardware) ---------- */
// Das Modell ist groß und wird erst geladen, wenn es in die Nähe des Bildschirms kommt.
// Quelle: Reeder Hardware GmbH/konzept-studio/web/produkt3d.ts
(function pad3d() {
  const els = $$("[data-pad3d]"); if (!els.length || !("IntersectionObserver" in window)) return;
  const o = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    o.disconnect();
    import("./produkt3d.js?v=" + (document.body.dataset.p3d || ""))   /* relativ zu dieser Datei (assets/js); Versionsnummer setzt build.py */.catch(() => els.forEach(e => e.classList.add("is-static")));
  }, { rootMargin: "700px 0px" });
  els.forEach(e => o.observe(e));
})();


/* ---------- Software-Seite: vier Bereiche, darunter die Leistung im Einzelnen ---------- */
(function leistungen() {
  const root = $(".lst"); if (!root) return;
  root.classList.add("js");
  const tabs = $$("[data-lst]", root), panels = $$("[data-lst-panel]", root);
  function zeig(bereich, svc) {
    tabs.forEach(t => { const an = t.dataset.lst === bereich; t.classList.toggle("is-on", an); t.setAttribute("aria-selected", an); });
    panels.forEach(p => {
      const an = p.dataset.lstPanel === bereich; p.classList.toggle("is-on", an); if (!an) return;
      const ziel = svc || $(".lst__pick .is-on", p)?.dataset.svc || $(".lst__pick button", p).dataset.svc;
      $$(".lst__pick button", p).forEach(b => b.classList.toggle("is-on", b.dataset.svc === ziel));
      $$(".sblock", p).forEach(a => a.classList.toggle("is-on", a.id === ziel));
    });
  }
  const hin = () => scrollTo({ top: $(".lst__tabs", root).getBoundingClientRect().top + scrollY - 96, behavior: reduced ? "auto" : "smooth" });
  tabs.forEach(t => t.addEventListener("click", () => zeig(t.dataset.lst)));
  root.addEventListener("click", e => { const b = e.target.closest("[data-svc]"); if (b) zeig(b.closest("[data-lst-panel]").dataset.lstPanel, b.dataset.svc); });
  // Sprungziele wie leistungen.html#telefon öffnen den passenden Bereich
  function ausAdresse() {
    const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    const a = $$(".sblock", root).find(x => x.id === id); if (!a) return;
    zeig(a.closest("[data-lst-panel]").dataset.lstPanel, id); requestAnimationFrame(hin);
  }
  addEventListener("hashchange", ausAdresse); ausAdresse();
  // Links auf der Seite selbst (z. B. „Mehr erfahren“) funktionieren auch, wenn das Ziel schon in der Adresse steht
  document.addEventListener("click", e => { const l = e.target.closest('a[href^="#"]'); if (l && l.getAttribute("href") === location.hash) { e.preventDefault(); ausAdresse(); } });
})();

/* ---------- Produktseite: Schalter Software | Hardware ---------- */
(function produktBereich() {
  const knoepfe = $$("[data-pb]"); if (!knoepfe.length) return;
  const leiste = $(".pnav");
  function setz(b) {
    $$("[data-pbereich]").forEach(el => el.hidden = el.dataset.pbereich !== b);
    $$("[data-pblinks]").forEach(el => el.hidden = el.dataset.pblinks !== b);
    knoepfe.forEach(k => { const an = k.dataset.pb === b; k.classList.toggle("is-on", an); k.setAttribute("aria-selected", an); });
    observeReveals(); onScroll();
  }
  const zurLeiste = () => scrollTo({ top: leiste.offsetTop - 50, behavior: reduced ? "auto" : "smooth" });
  function ausAdresse() {
    const id = decodeURIComponent(location.hash.slice(1)), el = id && document.getElementById(id), w = el && el.closest("[data-pbereich]");
    if (!w) return false;
    setz(w.dataset.pbereich);
    requestAnimationFrame(() => el === w ? zurLeiste() : scrollTo({ top: el.getBoundingClientRect().top + scrollY - 110, behavior: reduced ? "auto" : "smooth" }));
    return true;
  }
  knoepfe.forEach(k => k.addEventListener("click", () => { setz(k.dataset.pb); history.replaceState(null, "", "#" + k.dataset.pb); zurLeiste(); }));
  addEventListener("hashchange", ausAdresse);
  if (!ausAdresse()) setz("software");
})();
