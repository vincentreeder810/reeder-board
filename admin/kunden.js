/* Admin-Board – Kunden (Mandanten), Kundenakte, Projektseite, Vertrieb (nutzt $, $$, esc, api, toast, DD aus admin.js) */
(() => {
  const C = window.RSChat;
  let clients = [], current = null, msgs = [], tab = "ueberblick", listMode = "alle", search = "", sortBy = "aktivitaet", stopPoll = null, pending = null, projects = [], project = null, annFilter = "offen";
  const initials = n => String(n || "").replace(/\b(Dr|Prof|GmbH|AG|KG|UG|e\.V)\b\.?/g, "").split(/[\s&+\-–]+/).filter(w => /^[A-Za-zÄÖÜäöü0-9]/.test(w)).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const STATUS_LABEL = { aktiv: "Portal aktiv", eingeladen: "Eingeladen", "Einladung abgelaufen": "Einladung abgelaufen", "kein Zugang": "kein Zugang" };
  const EMPTY = `<b>Noch keine Nachrichten.</b>Schreiben Sie dem Kunden eine erste Nachricht – oder laden Sie einen Prototyp hoch.`;
  const PHASES = ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"];
  const MODELS = ["", "Festpreis", "Festpreis + Betreuung", "Signature", "Anpassung bestehender Software", "Beratung"];
  const APPT_KINDS = ["Erstgespräch", "Analyse", "Konzept-Workshop", "Prototyp-Präsentation", "Abstimmung", "Abnahme", "Schulung", "Sonstiges"];
  const DOC_KINDS = ["Angebot", "Rechnung", "Vertrag", "Konzept", "Protokoll", "Sonstiges"];
  const money = c => c == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(c / 100);
  const moneyR = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format((c || 0) / 100);
  const euro = c => c == null ? "" : (c / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const localDT = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const opts = (list, sel) => list.map(v => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v || "–")}</option>`).join("");
  const ago = s => { const m = Math.round((Date.now() - C.toDate(s).getTime()) / 60000); return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : m < 2880 ? "gestern" : C.fmt(C.toDate(s).toISOString(), { day: "numeric", month: "short" }); };
  const day = s => s ? C.fmt(C.toDate(s).toISOString(), { day: "numeric", month: "short", year: "numeric" }) : "–";
  const dayShort = s => C.fmt(C.toDate(s).toISOString(), { weekday: "short", day: "numeric", month: "short" });
  const TABS = ["ueberblick", "chat", "projekte", "termine", "dokumente", "finanzen", "anmerkungen"];
  const onProjectPage = () => !$("#projectPage").hidden && location.hash.startsWith("#projekte/");
  const stepper = idx => `<span class="mstep">${PHASES.map((_, k) => `<i class="${k < idx ? "done" : k === idx ? "now" : ""}"></i>`).join("")}</span>`;
  const teamAv = list => (list || []).map(u => `<span class="avatar avatar--xs" title="${esc(u.name)}">${esc(initials(u.name))}</span>`).join("");

  // Anmerkungen im Viewer: Team kann abhaken, wieder öffnen und selbst anmerken
  window.RS_VIEWER_API = {
    mode: "team",
    list: id => api(`/prototypes/${id}/annotations`),
    create: (id, body) => api(`/prototypes/${id}/annotations`, { method: "POST", body }),
    patch: (id, body) => api(`/annotations/${id}`, { method: "PATCH", body }),
    remove: id => api(`/annotations/${id}`, { method: "DELETE", body: {} }),
    assistGet: id => api(`/annotations/${id}/assist`),      // Gespräch des Kunden mit dem KI-Assistenten (nur lesen)
    onChange: () => { if (onProjectPage() && project) return openProjectPage(project.id, true); if (tab === "anmerkungen") loadAnnotations(); },
  };

  window.onViewChange = view => { if (view !== "kunden") { stopPoll?.(); stopPoll = null; } };
  window.loadKunden = async () => {
    const [, hid, htab] = location.hash.slice(1).split("/");
    await loadClients();
    stopPoll?.();
    if (!hid) {
      current = null; project = null; $("#kList").hidden = false; $("#clientDetail").hidden = true;
      stopPoll = C.poll(loadClients); return;
    }
    $("#kList").hidden = true; $("#clientDetail").hidden = false;
    const id = +hid;
    tab = TABS.includes(htab) ? htab : current?.id === id ? tab : "ueberblick";
    await openClient(id); scrollTo(0, 0);
    stopPoll = C.poll(async () => { clients = await api("/clients"); if (current && tab === "chat") await loadMessages(); });
  };

  /* ---------- Kundenliste: nur Mandanten (Anfragen & Interessenten stehen im Vertrieb) ---------- */
  const STAGE = { anfrage: ["Anfrage", "lead"], interessent: ["Interessent", "prospect"], mandant: ["Kunde", "client"], archiv: ["Archiv", "arch"] };
  const stagePill = st => `<span class="spill spill--${(STAGE[st] || STAGE.mandant)[1]}">${(STAGE[st] || STAGE.mandant)[0]}</span>`;
  const activeProjects = c => (c.projects || []).filter(p => p.status === "aktiv");
  function listClients() {
    const q = search.trim().toLowerCase(), last = c => c.last_at || c.created_at || "";
    // Ansichten: alle (ohne Archiv), Kunden mit Auftrag, Interessenten (Anfrage oder Gespräch, noch kein Auftrag), Archiv.
    // Die Suche geht immer über alle Kontakte samt Archiv – wer einen Namen eintippt, findet ihn, egal in welcher Ansicht.
    const passt = c => listMode === "archiv" ? c.stage === "archiv" : listMode === "mandant" ? c.stage === "mandant" : listMode === "interessent" ? (c.stage === "anfrage" || c.stage === "interessent") : c.stage !== "archiv";
    const l = clients.filter(c => q ? `${c.company} ${c.name} ${c.email}`.toLowerCase().includes(q) : passt(c));
    const sorters = { aktivitaet: (a, b) => String(last(b)).localeCompare(String(last(a))), name: (a, b) => a.company.localeCompare(b.company, "de"),
      projekte: (a, b) => activeProjects(b).length - activeProjects(a).length, offen: (a, b) => (b.open_net || 0) - (a.open_net || 0),
      termin: (a, b) => (a.next?.start || "9").localeCompare(b.next?.start || "9") };
    return l.sort(sorters[sortBy] || sorters.aktivitaet);
  }
  async function loadClients() { clients = await api("/clients"); renderList(); }
  function renderList() {
    const mand = clients.filter(c => c.stage === "mandant"), arch = clients.filter(c => c.stage === "archiv"), inter = clients.filter(c => c.stage === "anfrage" || c.stage === "interessent");
    $("#kTitle").textContent = ME.owner ? "Kunden & Kontakte" : "Meine Kunden";
    $("#kSub").innerHTML = `${mand.length} Kunde${mand.length === 1 ? "" : "n"} · ${mand.reduce((s, c) => s + activeProjects(c).length, 0)} aktive Projekte${ME.owner ? ` · ${inter.length} Interessent${inter.length === 1 ? "" : "en"} · der Weg bis zum Auftrag steht im <a href="#anfragen">Vertrieb</a>` : ""}`;
    if (!$("#kSearch")) $("#kCtl").innerHTML = `<input type="search" id="kSearch" class="lsearch" placeholder="Name, Firma oder E-Mail suchen – findet alle Kontakte …" autocomplete="off"><div class="lctl__dd" id="kDD"></div>`;
    $("#kDD").innerHTML = (ME.owner ? DD.html("kMode", [{ v: "alle", l: "Alle Kontakte", n: mand.length + inter.length }, { v: "mandant", l: "Kunden mit Auftrag", n: mand.length }, { v: "interessent", l: "Interessenten", n: inter.length }, { v: "archiv", l: "Archiv", n: arch.length }], listMode, { label: "Ansicht" }) : "")
      + DD.html("kSort", [{ v: "aktivitaet", l: "Zuletzt aktiv" }, { v: "name", l: "Name A–Z" }, { v: "projekte", l: "Meiste Projekte" }, ...(ME.owner ? [{ v: "offen", l: "Höchster offener Betrag" }] : []), { v: "termin", l: "Nächster Termin" }], sortBy, { label: "Sortierung" });
    const list = listClients();
    $("#clients").innerHTML = list.length ? `<div class="ltab__h kgrid"><span>Kunde</span><span>Projekte</span><span>Team</span><span>Nächster Termin</span>${ME.owner ? `<span class="num">Offen (netto)</span>` : ""}<span>Letzter Kontakt</span></div>`
      + list.map(c => { const ap = activeProjects(c);
        return `<a class="ltab__r kgrid ${c.active ? "" : "is-off"}" href="#kunden/${c.id}">
          <span class="lmain"><span class="avatar avatar--${(STAGE[c.stage] || STAGE.mandant)[1]}">${esc(initials(c.company))}</span><span class="lmain__t"><b>${esc(c.company)} ${c.stage !== "mandant" ? stagePill(c.stage) : ""}${c.unread ? `<em class="dot" title="${c.unread} ungelesene Nachricht(en)">${c.unread}</em>` : ""}</b><small>${esc(c.name)}${c.status !== "aktiv" ? ` · <span class="warn">${esc(STATUS_LABEL[c.status] || c.status)}</span>` : ""}</small></span></span>
          <span class="lc">${ap.length ? `<b>${ap.length} aktiv ${bereicheTags(c)}</b><small>${esc(ap.map(p => p.phase).join(" · "))}</small>` : (() => { const an = (c.projects || []).filter(p => p.status === "anfrage"); return an.length ? `<b>${an.length} angefragt ${bereicheTags(c)}</b><small>${esc(an.map(p => p.title).join(" · ").slice(0, 60))}</small>` : `<small class="muted">${(c.projects || []).length ? "keine aktiven" : "noch kein Projekt"}</small>`; })()}</span>
          <span class="pteam">${teamAv(c.team) || `<small class="muted">–</small>`}</span>
          <span class="lc">${c.next ? `<b>${C.fmt(c.next.start, { day: "numeric", month: "short" })}</b><small>${esc(c.next.title)}</small>` : `<small class="muted">–</small>`}</span>
          ${ME.owner ? `<span class="num">${c.open_net ? moneyR(c.open_net) : "–"}</span>` : ""}
          <span class="lc"><small>${c.last_at ? ago(c.last_at) : "–"}</small></span></a>`; }).join("")
      : `<div class="empty">${search ? "Kein Kontakt gefunden." : listMode === "archiv" ? "Das Archiv ist leer." : listMode === "interessent" ? "Keine Interessenten." : listMode === "mandant" ? "Noch keine Kunden mit Auftrag." : "Noch keine Kontakte."}</div>`;
  }
  DD.on("kMode", v => { listMode = v; renderList(); });
  DD.on("kSort", v => { sortBy = v; renderList(); });
  document.addEventListener("input", e => { if (e.target.id === "kSearch") { search = e.target.value; renderList(); } });

  /* ---------- Kundenakte ---------- */
  async function openClient(id) {
    if (current?.id !== id) project = null;
    current = clients.find(c => c.id === id);
    if (!current) { $("#clientDetail").innerHTML = `<a class="back" href="#kunden">← Alle Kunden</a><div class="empty">Dieser Kontakt ist nicht (mehr) verfügbar.</div>`; return; }
    msgs = [];
    const c = current, lead = c.stage !== "mandant", ap = activeProjects(c);
    if (lead && ["chat", "anmerkungen", "dokumente"].includes(tab)) tab = "ueberblick";
    const back = lead && c.stage !== "archiv" ? ["#anfragen", "Vertrieb"] : ["#kunden", "Alle Kunden"];
    const more = !ME.owner ? [] : lead ? [{ v: "invite", l: "Neuen Zugangslink (Passwort neu setzen)" }, { v: "makeClient", l: "Nur Portalzugang freischalten" }, c.stage !== "archiv" ? { v: "archive", l: "Archivieren" } : { v: "unarchive", l: "Reaktivieren" }, { v: "loeschen", l: "Endgültig löschen", danger: true }]
      : [{ v: "newContract", l: "Laufenden Vertrag anlegen" }, { v: "billing", l: "Rechnungsadresse" }, { v: "invite", l: c.status === "aktiv" ? "Neuen Zugangslink senden" : "Einladungslink senden" }, { v: "toggle", l: c.active ? "Portalzugang sperren" : "Portalzugang aktivieren", danger: c.active }, { v: "archive", l: "Archivieren" }];
    const facts = lead ? [["Status", STAGE[c.stage][0]], ["Kontakt kam über", quelle(c) || "–"], ["Erster Kontakt", day(c.created_at)], ["Nächster Termin", c.next ? dayShort(c.next.start) : "–"]]
      : [["Kunde seit", day(c.created_at)], ["Aktive Projekte", String(ap.length)], ...(ME.owner ? [["Offen (netto)", c.open_net ? moneyR(c.open_net) : "–"]] : []), ["Nächster Termin", c.next ? dayShort(c.next.start) : "–"], ["Kundenportal", c.active ? (STATUS_LABEL[c.status] || c.status) : "gesperrt"]];
    const T = lead ? [["ueberblick", "Überblick"], ["termine", "Termine", c.requests], ["projekte", "Projekte", (c.projects || []).length], ...(ME.owner ? [["finanzen", "Angebote"]] : [])]
      : [["ueberblick", "Überblick"], ["chat", "Nachrichten", c.unread], ["projekte", "Projekte", (c.projects || []).length], ["termine", "Termine", c.requests], ["dokumente", "Dokumente"], ...(ME.owner ? [["finanzen", "Angebote & Rechnungen"]] : [])];
    $("#clientDetail").innerHTML = `
      <a class="back" href="${back[0]}">← ${back[1]}</a>
      <div class="card khead">
        <div class="khead__top"><span class="avatar avatar--lg avatar--${(STAGE[c.stage] || STAGE.mandant)[1]}">${esc(initials(c.company))}</span>
          <div class="khead__id"><h1>${esc(c.company)} ${stagePill(c.stage)}</h1>
            <p>${esc(c.name)} · <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""}${c.last_seen ? ` · zuletzt im Portal ${ago(c.last_seen)}` : ""}</p></div>
          <div class="khead__acts">
            <button class="btn btn--ghost btn--sm" data-act="schedule">Termin vereinbaren</button>
            ${ME.owner ? lead ? `<button class="btn btn--grad btn--sm" data-act="startOrder">Auftrag starten</button>` : `<button class="btn btn--grad btn--sm" data-act="newProject">Neues Projekt</button>` : ""}
            ${more.length ? DD.html("kMore", more, "", { trigger: "Mehr", align: "right" }) : ""}</div></div>
        <dl class="kfacts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      </div>
      <nav class="utabs" id="ctabs">${T.map(([k, l, n]) => `<button data-t="${k}">${esc(l)}${n ? `<em>${n}</em>` : ""}</button>`).join("")}</nav>
      <div id="cpane"></div>`;
    await showTab(tab);
  }
  DD.on("kMore", v => Promise.resolve().then(() => actions[v]?.()).catch(err => toast(err.message)));

  /* ---------- Vertrieb: der einzige Ort für neue Kontakte – Spalten nach Gesprächsstand ---------- */
  const TYPE_L = { erstgespraech: "Erstgespräch", produktdemo: "Produktdemo", workshop: "Projekt-Workshop", beratung: "Beratung" };
  // Stand eines Kontakts: Angebot beim Kunden → "angebot"; Termin steht → "geplant"; Gespräch war → "gefuehrt";
  // sonst "neu" (noch kein Termin) – diese Karten stehen oben in der Spalte "Gespräch geplant".
  // Woher der Kontakt kam. "Website-Termin" heißt: online über die Website gebucht – es sagt nichts über das Thema.
  const QUELLE = { "Website-Termin": "online gebucht", "Projektanfrage": "Anfrage über das Formular" };
  const quelle = c => QUELLE[c.source] || c.source || "";
  const leadStep = c => c.offer ? "angebot" : c.next ? "geplant" : c.last ? "gefuehrt" : "neu";
  /** Angebot für einen Kontakt vorbereiten: öffnet den Angebots-Editor in den Finanzen, Kunde/Projekt/Leistung vorbelegt */
  // vorgabe: fertige Inhalte (z. B. das Pauschal-Angebot für den Prototyp aus der Kalkulation eines Hardware-Projekts)
  window.angebotErstellen = ({ client_id, project_id, title, bereich, notizen, vorgabe }) => {
    if (vorgabe) { sessionStorage.setItem("rs-new-invoice", JSON.stringify({ kind: "angebot", client_id, project_id: project_id || null, ...vorgabe })); location.hash = "#finanzen/angebote"; return; }
    const hw = bereich === "hardware";
    const pre = { kind: "angebot", client_id, project_id: project_id || null, title: hw ? `Entwicklungskonzept ${title || ""}`.trim() : (title || ""),
      items: hw ? [{ title: "Entwicklungskonzept", description: "Pauschalpreis für die Ausarbeitung Ihrer Produktidee. Sie erhalten ein Konzeptdokument (PDF) mit Anforderungen, gewählter Lösung, Aufbau mit Ansichten aus dem 3D-Modell, geschätzten Materialkosten und Prüfplan.", qty: 1, unit: "pauschal", unit_net: 30000 }] : undefined,
      outro: hw ? "Wird im Anschluss der Prototyp beauftragt, rechnen wir den Betrag für das Entwicklungskonzept vollständig an. Den Prototyp bieten wir Ihnen als Pauschalpreis an, sobald das Konzept vorliegt." : undefined };
    if (notizen) pre.notizen = notizen;
    sessionStorage.setItem("rs-new-invoice", JSON.stringify(pre)); location.hash = "#finanzen/angebote";
  };
  let KARTEN = [];
  window.loadVertrieb = async () => {
    const [cl, alleProjekte] = await Promise.all([api("/clients"), api("/projects").catch(() => [])]); clients = cl;
    const leads = clients.filter(c => c.stage === "anfrage" || c.stage === "interessent");
    // Eine Karte je Anfrage: Jedes Projekt im Status „anfrage“ bringt seinen eigenen Termin, Fragebogen und sein eigenes Angebot mit.
    // Kontakte ganz ohne Projekt (z. B. von Hand angelegt) bekommen wie bisher eine Karte für den Kontakt.
    const jeKunde = new Map();
    for (const p of alleProjekte) if (p.status === "anfrage" && p.vorgang) { if (!jeKunde.has(p.client.id)) jeKunde.set(p.client.id, []); jeKunde.get(p.client.id).push(p); }
    KARTEN = leads.flatMap(c => { const ps = jeKunde.get(c.id) || [];
      return ps.length ? ps.map(p => ({ ...c, _p: p, _fb: p.fragebogen, next: p.vorgang.termin, last: p.vorgang.letztes, offer: p.vorgang.angebot, offerDraft: p.vorgang.entwurf ? {} : null }))
        : [{ ...c, _p: null, _fb: c.lead?.fragebogen || null }]; });
    KARTEN.forEach((k, i) => { k._i = i; });
    const time = iso => `${dayShort(iso)}, ${C.fmt(iso, { hour: "2-digit", minute: "2-digit" })} Uhr`;
    const card = c => {
      const L = c.lead || {}, bk = L.booking, open = bk && bk.status === "neu" && !c.next, step = leadStep(c);
      const anfr = c._p || (c.projects || []).find(p => p.status === "anfrage") || (c.projects || [])[0];
      const status = step === "geplant" ? `<p class="lead__bk lead__bk--ok">${ICO("termin")}${esc(c.next.title)} · ${time(c.next.start)}</p>`
        : step === "gefuehrt" ? `<p class="lead__bk">${ICO("summary")}<span>${esc(c.last.title)} am ${dayShort(c.last.start)}${c.last.notiz ? "" : ` · <em>noch keine Notizen</em>`}</span></p>`
        : step === "angebot" ? `<p class="lead__bk lead__bk--ok">${ICO("summary")}Angebot ${esc(c.offer.number || "")} · ${money(c.offer.gross)}${c.offer.valid_until ? ` · gültig bis ${dayShort(c.offer.valid_until)}` : ""}</p>`
        : open ? `<p class="lead__bk lead__bk--open">${ICO("buchung")}Wunschtermin ${esc(TYPE_L[bk.type] || bk.type)}: ${time(bk.start)} · <b>bitte bestätigen</b></p>`
        : `<p class="lead__bk lead__bk--open">${ICO("buchung")}<b>Noch kein Termin</b> · Erstgespräch vereinbaren</p>`;
      const angebotKnopf = cls => `<button class="ibtn ${cls}" data-lact="offer" data-pid="${anfr?.id || ""}" data-ptitle="${esc(anfr?.title || "")}" data-bereich="${anfr?.bereich || ""}">${c.offerDraft ? "Angebot fertigstellen" : "Angebot erstellen"}</button>`;
      // Je Stand genau ein Hauptknopf (der nächste sinnvolle Schritt), darunter die Nebenwege, ganz unten der Ausstieg
      const k = (act, text, extra = "") => `<button class="ibtn" data-lact="${act}" ${extra}>${text}</button>`;
      const haupt = (act, text, extra = "") => `<button class="ibtn ibtn--ok lead__haupt" data-lact="${act}" ${extra}>${text}</button>`;
      const weg = (act, text, extra = "") => `<button class="lead__weg" data-lact="${act}" ${extra}>${text}</button>`;
      const fbK = c._fb !== "ausgefuellt" ? k("fbSend", c._fb === "offen" ? "Fragebogen erinnern" : "Fragebogen senden", `data-bereich="${anfr?.bereich || ""}"`) : "";
      const notizK = c.last?.id ? k("notes", c.last.notiz ? "Notizen bearbeiten" : "Notizen") : "";
      const [h, neben, raus] = step === "neu" ? [open ? haupt("confirm", "✓ Termin bestätigen", `data-bid="${bk.id}"`) : haupt("schedule", "Erstgespräch vereinbaren"),
            (open ? k("schedule", "Andere Zeit") : "") + k("held", "Gespräch geführt") + angebotKnopf("") + fbK, weg("archive", "Kein Interesse")]
        : step === "geplant" ? [haupt("held", "✓ Gespräch geführt"), k("move", "Verschieben") + k("schedule", "Weiterer Termin") + angebotKnopf("") + fbK, weg("archive", "Kein Interesse")]
        : step === "angebot" ? [haupt("won", "✓ Zusage erhalten", `data-oid="${c.offer.id}"`), k("offerOpen", "Angebot ansehen") + notizK, weg("lost", "Angebot abgelehnt", `data-oid="${c.offer.id}"`)]
        : [angebotKnopf("ibtn--ok lead__haupt"), notizK + k("schedule", "Folgetermin") + k("start", "Ohne Angebot starten"), weg("archive", "Kein Auftrag")];
      const acts = `${h}<div class="lead__neben">${neben}</div>${raus}`;
      return `<div class="lead" data-cid="${c.id}" data-k="${c._i}">
        <a class="lead__top" href="#kunden/${c.id}"><span class="avatar avatar--${STAGE[c.stage][1]}">${esc(initials(c.company))}</span><span><b>${esc(c.company)}</b><small>${esc(c.name)}${c.source ? " · " + esc(quelle(c)) : ""} · seit ${ago(c.created_at)}</small></span></a>
        ${c._p ? `<a class="lead__was" href="${projektHref(c._p)}" title="Zum Projekt">${bereichTag(c._p)}<b>${esc(c._p.title)}</b></a>` : ""}
        ${!c._p && (L.kinds || L.budget) ? `<p class="lead__tags">${L.kinds ? L.kinds.split(/,\s*/).map(k => `<span>${esc(k)}</span>`).join("") : ""}${L.budget ? `<span class="lead__budget">${esc(L.budget)}</span>` : ""}</p>` : ""}
        ${c._fb || (!c._p && (c.projects || []).length) ? `<p class="lead__tags">${c._fb === "ausgefuellt" ? `<span class="lead__fb lead__fb--ok">✓ Fragebogen ausgefüllt</span>` : c._fb === "offen" ? `<span class="lead__fb">Fragebogen noch offen</span>` : ""}${(c._p ? [] : c.projects || []).slice(0, 3).map(p => `<a class="lead__proj" href="${projektHref(p)}" title="Zum Projekt">${esc(p.title.length > 34 ? p.title.slice(0, 32) + " …" : p.title)} · ${p.bereich === "hardware" ? "Hardware" : "Software"}</a>`).join("")}</p>` : ""}
        ${!c._p && L.text && c._fb !== "ausgefuellt" ? `<p class="lead__txt">${esc(L.text.slice(0, 160))}${L.text.length > 160 ? " …" : ""}</p>` : ""}
        ${status}${c.last?.notiz ? `<p class="lead__notiz"><b>Notizen:</b> ${esc(c.last.notiz.slice(0, 220))}${c.last.notiz.length > 220 ? " …" : ""}</p>` : ""}
        <div class="lead__acts">${acts}</div></div>`;
    };
    const col = (key, title, hint) => {
      // In "Gespräch geplant" stehen zuerst die Kontakte ohne Termin (bestätigen oder vereinbaren), dann die Termine nach Datum
      const l = KARTEN.filter(c => leadStep(c) === key || (key === "geplant" && leadStep(c) === "neu"))
        .sort((a, b) => key === "geplant" ? (a.next ? 1 : 0) - (b.next ? 1 : 0) || (a.next && b.next ? a.next.start.localeCompare(b.next.start) : String(b.created_at).localeCompare(String(a.created_at))) : String(b.created_at).localeCompare(String(a.created_at)));
      return `<div class="pipe__col pipe__col--${key}"><div class="pipe__h"><b>${title}</b><em>${l.length}</em><small>${hint}</small></div>${l.map(card).join("") || `<div class="pipe__empty">Nichts offen.</div>`}</div>`;
    };
    const won = clients.filter(c => c.stage === "mandant" && Date.now() - C.toDate(c.created_at).getTime() < 90 * 864e5);
    $("#pipeline").innerHTML = col("geplant", "1 · Gespräch geplant", "Termin bestätigen oder vereinbaren – danach Zusammenfassung eintragen")
      + col("gefuehrt", "2 · Gespräch geführt", "Jetzt entscheiden: Angebot erstellen oder absagen")
      + col("angebot", "3 · Angebot offen", "Liegt beim Kunden – mit der Annahme wird daraus ein Auftrag")
      + `<div class="pipe__col pipe__col--won"><div class="pipe__h"><b>Gewonnen</b><em>${won.length}</em><small>neue Kunden der letzten 90 Tage</small></div>
        ${won.slice(0, 6).map(c => `<a class="pipe__more" href="#kunden/${c.id}">${esc(c.company)}<small>${esc(activeProjects(c).map(p => p.title).join(", ") || "noch kein Projekt")}</small></a>`).join("")}
        <a class="pipe__more pipe__more--link" href="#kunden" data-arch>Archiv ansehen (${clients.filter(c => c.stage === "archiv").length}) →</a></div>`;
  };
  $("#pipeline").addEventListener("click", async e => {
    if (e.target.closest("[data-arch]")) { listMode = "archiv"; return; }
    const b = e.target.closest("[data-lact]"); if (!b) return;
    const cid = +b.closest(".lead").dataset.cid; current = clients.find(c => c.id === cid);
    const K = KARTEN[+b.closest(".lead").dataset.k] || current;   // die Karte: Kontakt mit Termin, Notizen und Angebot genau dieser Anfrage
    try {
      if (b.dataset.lact === "schedule") return scheduleDialog(cid, K._p ? { project_id: K._p.id } : {});
      if (b.dataset.lact === "start") return window.BOARD.startOrder(current);
      if (b.dataset.lact === "offer") {
        if (K.offerDraft) { location.hash = "#finanzen/angebote"; return toast("Der Entwurf steht bei den Angeboten – dort fertigstellen und versenden."); }
        return window.angebotErstellen({ client_id: cid, project_id: +b.dataset.pid || null, title: b.dataset.ptitle, bereich: b.dataset.bereich, notizen: K.last?.notiz || "" });
      }
      if (b.dataset.lact === "fbSend") {
        b.disabled = true;
        const r = await api(`/onboarding/kunde/${cid}/erneut`, { method: "POST", body: { kinds: b.dataset.bereich ? [b.dataset.bereich] : null } });
        toast(r.mailed === false ? "E-Mail-Versand ist noch nicht eingerichtet – die Mail liegt im Postausgang." : "Fragebogen ist unterwegs."); return window.loadVertrieb();
      }
      if (b.dataset.lact === "move") {
        // Den bestehenden Termin wirklich verlegen (auch auf heute) – kein zweiter Termin
        const neu = await UI.prompt(`Termin verschieben · ${current.company}`, { label: "Neue Zeit. Heute geht auch. Der Kunde bekommt die Änderung per E-Mail.", type: "datetime-local", value: localDT(K.next.start), ok: "Verschieben" });
        if (!neu) return;
        await api(`/appointments/${K.next.id}`, { method: "PATCH", body: { start: new Date(neu).toISOString(), notify: true } });
        toast("Termin verschoben"); window.loadVertrieb(); return window.updateBadges?.();
      }
      if (b.dataset.lact === "held") {
        // Das Gespräch hat stattgefunden – auch spontan am Telefon, vor dem geplanten Termin oder ganz ohne Termin
        const jetzt = new Date(Date.now() - 60000).toISOString();
        const frage = K.next ? `Der Termin am ${C.fmt(K.next.start, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} Uhr wird auf jetzt gesetzt und gilt als geführt.` : "Es wird ein Gespräch mit dem heutigen Datum eingetragen.";
        const notiz = await UI.prompt(`Gespräch geführt · ${current.company}`, { label: `${frage} Ihre Stichpunkte dazu (optional, sieht der Kunde nicht):`, value: "", multiline: true, ok: "Als geführt eintragen" });
        if (notiz === null) return;
        if (K.next) await api(`/appointments/${K.next.id}`, { method: "PATCH", body: { start: jetzt, notes_intern: notiz || undefined, notify: false } });
        else await api(`/clients/${cid}/appointments`, { method: "POST", body: { title: "Gespräch", start: jetzt, minutes: 30, kind: "Erstgespräch", notes_intern: notiz, notify: false, project_id: K._p?.id || undefined } });
        toast("Eingetragen – jetzt können Sie das Angebot erstellen."); window.loadVertrieb(); return window.updateBadges?.();
      }
      if (b.dataset.lact === "notes") {
        const t = await UI.prompt(`Gesprächsnotizen · ${current.company}`, { label: "Interne Stichpunkte aus dem Gespräch – der Kunde sieht sie nicht. Sie stehen beim Erstellen des Angebots daneben.", value: K.last.notiz || "", multiline: true, ok: "Speichern" });
        if (t === null) return;
        await api(`/appointments/${K.last.id}`, { method: "PATCH", body: { notes_intern: t, notify: false } }); toast("Notizen gespeichert"); return window.loadVertrieb();
      }
      if (b.dataset.lact === "offerOpen") { location.hash = "#finanzen/angebote"; return; }
      if (b.dataset.lact === "won") {
        const name = await UI.prompt(`Zusage von ${current.company}`, { label: "Wer hat zugesagt? Der Name steht in der Auftragsbestätigung. Der Kontakt wird Kunde, das Projekt ein Auftrag.", value: current.name || "", ok: "Als Auftrag übernehmen" });
        if (name === null) return;
        await api(`/contracts/quote/${b.dataset.oid}/accept`, { method: "POST", body: { name, via: "Zusage per Telefon oder E-Mail" } });
        toast(`${current.company} ist jetzt Kunde – Auftragsbestätigung liegt bei den Dokumenten.`); window.loadVertrieb(); return window.updateBadges?.();
      }
      if (b.dataset.lact === "lost") {
        if (!(await UI.confirm("Das Angebot wird als abgelehnt markiert. Der Kontakt bleibt im Vertrieb unter „Gespräch geführt“.", { title: "Angebot abgelehnt?", ok: "Als abgelehnt markieren" }))) return;
        await api(`/finance/invoices/${b.dataset.oid}/status`, { method: "POST", body: { status: "abgelehnt" } });
        toast("Als abgelehnt markiert."); window.loadVertrieb(); return window.updateBadges?.();
      }
      if (b.dataset.lact === "archive") { if (!(await UI.confirm("Der Kontakt wandert ins Archiv und kann jederzeit reaktiviert werden.", { title: `${current.company} archivieren?`, ok: "Archivieren" }))) return;
        await api(`/clients/${cid}/stage`, { method: "PATCH", body: { stage: "archiv" } }); toast("Archiviert"); window.loadVertrieb(); return window.updateBadges?.(); }
      if (b.dataset.lact === "confirm") { b.disabled = true; const r = await api(`/bookings/${b.dataset.bid}`, { method: "PATCH", body: { status: "bestaetigt", notify: true } }); toast(r.mailed ? "Bestätigt – Einladung mit Video-Link ist raus." : "Bestätigt – Einladung liegt im Postausgang."); window.loadVertrieb(); window.updateBadges?.(); }
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  /* ---------- Überblick: Verlauf + Kontakt + nächster Schritt ---------- */
  const TL_ICON = { kontakt: "👤", buchung: "🗓️", lead: "✨", termin: "📅", chat: "💬", projekt: "🚀", prototyp: "🖥️", dokument: "📄", zahlung: "💶", angebot: "📝", phase: "➜", status: "•", protokoll: "📝" };
  /* Fragebogen & Vorab-Entwurf (aus der Terminbuchung) */
  const VST = { eingeladen: "Fragebogen verschickt – noch nicht ausgefüllt", beantwortet: "Fragebogen ausgefüllt", baut: "Vorab-Entwurf wird gebaut …", fertig: "Vorab-Entwurf fertig", fehler: "Vorab-Entwurf fehlgeschlagen" };
  // Onboarding für Software und Hardware: Antworten gegliedert, mit Verweis auf die entstandenen Projekte
  function onboardingCard(list) {
    if (!list?.length) return "";
    const chips = l => `<div class="evd__chips">${l.map(t => `<span>${esc(t)}</span>`).join("")}</div>`;
    const row = r => `<div class="evd__row"><span>${esc(r.k)}</span><div>${r.chips ? chips(r.chips) : ""}${r.v ? `<p>${esc(r.v)}</p>` : ""}</div></div>`;
    return list.map(o => `<div class="card fbkarte"><h2 style="font-size:18px;margin-bottom:10px">Fragebogen ${o.bereiche.map(b => bereichTag({ bereich: b.id })).join(" ")}</h2>
      <div class="evd__prep">
        <div class="evd__vorab ${o.status === "ausgefuellt" ? "ok" : ""}"><span><b>${o.status === "ausgefuellt" ? "Ausgefüllt" : "Verschickt, noch nicht ausgefüllt"}</b>
          <small class="evd__img">${o.answered_at ? `ausgefüllt am ${esc(C.fmt(o.answered_at.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}` : `verschickt am ${esc(C.fmt(o.invited_at.replace(" ", "T") + "Z", { day: "numeric", month: "short" }))}`}${o.dateien ? ` · ${o.dateien} Datei${o.dateien === 1 ? "" : "en"}` : ""}</small>
          ${o.projekte.length ? `<small class="evd__img">Projekt: ${o.projekte.map(p => `<a href="${projektHref(p)}">${esc(p.title)}</a>`).join(", ")}</small>` : ""}</span>
          </div>
        ${o.status === "ausgefuellt" ? `<details class="fballe"><summary>Antworten ansehen</summary>${o.bereiche.flatMap(b => b.antworten).map(g => `<details class="evd__sec"><summary>${esc(g.title)}</summary><div class="evd__body">${g.rows.map(row).join("")}</div></details>`).join("")}</details>` : ""}
      </div></div>`).join("");
  }
  function vorabCard(list, c) {
    if (!list?.length) return "";
    const chips = l => `<div class="evd__chips">${l.map(t => `<span>${esc(t)}</span>`).join("")}</div>`;
    const row = r => `<div class="evd__row"><span>${esc(r.k)}</span><div>${r.chips ? chips(r.chips) : ""}${r.v ? `<p>${esc(r.v)}</p>` : ""}${r.colors?.length ? `<div class="evd__sw">${r.colors.map(x => `<i style="background:${esc(x)}"></i>`).join("")}</div>` : ""}</div></div>`;
    return list.map(v => `<div class="card fbkarte"><h2 style="font-size:18px;margin-bottom:10px">Fragebogen <span class="bereich bereich--sw">Website</span></h2>
      <div class="evd__prep">
        <div class="evd__vorab ${v.status === "fertig" ? "ok" : v.status === "fehler" ? "warn" : ""}"><span><b>${esc(VST[v.status] || v.status)}</b>
          <small class="evd__img">${c.status === "aktiv" ? "Kundenkonto angelegt" : "Noch kein Kundenkonto"}${v.answered_at ? ` · ausgefüllt am ${esc(C.fmt(v.answered_at.replace(" ", "T") + "Z", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}` : ""}${v.cost ? ` · KI-Kosten ${String(v.cost.toFixed(2)).replace(".", ",")} $` : ""}</small>
          ${v.url ? `<small class="evd__img">${v.visible ? "Für den Kunden im Portal sichtbar" : "Für den Kunden noch nicht sichtbar – zeigen Sie ihn im Gespräch"}</small>` : ""}
          ${v.notes?.length ? `<small class="evd__img">${esc(v.notes.join(" · "))}</small>` : ""}</span>
          ${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">Entwurf ansehen ↗</a>` : ""}</div>
        ${(v.answers || []).length ? `<details class="fballe"><summary>Antworten ansehen</summary>${v.answers.map(g => `<details class="evd__sec"><summary>${esc(g.title)}</summary><div class="evd__body">${g.rows.map(row).join("")}</div></details>`).join("")}</details>` : ""}
      </div></div>`).join("");
  }
  async function showOverview() {
    const [tl, projs, vorab, onb] = await Promise.all([api(`/clients/${current.id}/timeline`), api(`/clients/${current.id}/projects`), ME.owner ? api(`/vorab/kunde/${current.id}`).catch(() => []) : [], ME.owner ? api(`/onboarding/kunde/${current.id}`).catch(() => []) : []]);
    const c = current, hasFuture = tl.some(i => i.kind === "termin" && i.future), hadMeeting = tl.some(i => i.kind === "termin" && !i.future);
    const next = c.stage === "anfrage" ? { t: "Ersten Termin vereinbaren", d: "Schlagen Sie ein Erstgespräch vor – der Kunde bekommt Einladung, Video-Link und Kalendereintrag.", act: "schedule", btn: "📅 Termin vereinbaren" }
      : c.stage === "interessent" ? (hadMeeting || !hasFuture ? { t: "Auftrag starten", d: "Nach dem Gespräch in einem Schritt: Kunde mit Portalzugang, Projekt anlegen und dem Team zuweisen.", act: "startOrder", btn: "Auftrag starten" }
        : { t: "Gespräch steht an", d: "Nach dem Termin hier die Zusammenfassung eintragen und den Kontakt zum Kunden machen.", act: "tab:termine", btn: "Zu den Terminen" })
      : !projs.length ? { t: "Projekt anlegen", d: "Lege das erste Projekt an – Angebot, Termine, Prototypen und Rechnungen hängen daran.", act: "newProject", btn: "Neues Projekt" }
      : c.status !== "aktiv" ? { t: "Portal noch nicht aktiviert", d: "Der Kunde hat seinen Zugang noch nicht angenommen. Schicken Sie den Link erneut.", act: "invite", btn: "Zugangslink senden" } : null;
    $("#cpane").innerHTML = `<div class="ovgrid">
      <div class="card"><h2 style="font-size:18px">Verlauf</h2>
        <ol class="ctl">${tl.map(i => `<li class="ctl--${esc(i.kind)} ${i.future ? "ctl--future" : ""}"><span class="ctl__ico">${ICO(i.kind)}</span><div><b>${esc(i.title)}</b><span>${C.fmt(i.at.includes("T") ? i.at : i.at.replace(" ", "T") + "Z", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>${i.detail ? `<p>${esc(i.detail)}</p>` : ""}</div></li>`).join("")}</ol></div>
      <div class="stack">
        ${next && (ME.owner || next.act === "schedule") ? `<div class="card nextstep"><p class="kicker">Nächster Schritt</p><h3>${esc(next.t)}</h3><p>${esc(next.d)}</p><button class="btn btn--grad btn--sm" data-act="${next.act}">${next.btn}</button></div>` : ""}
        <div class="card"><h2 style="font-size:18px">Projekte</h2>${projs.length ? projs.map(p => `<a class="miniproj" href="${projektHref(p)}"><b>${esc(p.title)} ${bereichTag(p)}</b><span>${p.status === "anfrage" ? "Angefragt" + (p.fragebogen?.stand ? " · Fragebogen " + (p.fragebogen.stand === "ausgefuellt" ? "ausgefüllt" : "offen") : "") + (p.next ? " · Termin " + dayShort(p.next.start) : "") : esc(p.phase) + " · " + esc(p.status)}${(p.members || []).length ? " · " + esc(p.members.map(m => m.name.split(" ")[0]).join(", ")) : ""}</span></a>`).join("") : `<p class="hint" style="margin:0">Noch kein Projekt.</p>`}
          ${ME.owner ? `<button class="link" data-act="newProject" style="margin-top:8px">+ Neues Projekt</button>` : ""}</div>
        ${ME.owner ? `<form class="card form" id="contactForm" style="display:grid;gap:10px"><h2 style="font-size:18px;margin:0">Kontakt</h2>
          <label>Firma<input name="company" value="${esc(c.company)}"></label><label>Ansprechpartner<input name="name" value="${esc(c.name)}"></label>
          <label>Telefon<input name="phone" value="${esc(c.phone || "")}"></label><label>Interne Notiz<textarea name="notes" rows="3" placeholder="Nur für Ihr Team sichtbar">${esc(c.notes || "")}</textarea></label>
          <button class="btn btn--sm" type="submit" style="justify-self:start">Speichern</button></form>` : ""}
        ${onboardingCard(onb)}
        ${vorabCard(vorab, c)}
      </div></div>`;
    $("#contactForm")?.addEventListener("submit", async e => { e.preventDefault(); const f = e.target;
      try { await api(`/clients/${current.id}/stage`, { method: "PATCH", body: { stage: current.stage, company: f.company.value, name: f.name.value, phone: f.phone.value, notes: f.notes.value } }); toast("Kontakt gespeichert"); await loadClients(); current = clients.find(x => x.id === current.id); }
      catch (err) { toast(err.message); } });
  }

  /* ---------- Angebote & Rechnungen des Kunden ---------- */
  async function showFinance() {
    const [inv, quo] = await Promise.all([api("/finance/invoices?kind=rechnung"), api("/finance/invoices?kind=angebot")]);
    const mine = [...quo, ...inv].filter(x => x.client_id === current.id);
    const st = r => !r.locked ? "Entwurf" : r.dunning?.overdue > 0 ? `${r.dunning.overdue} Tage überfällig` : ({ offen: "offen", bezahlt: "bezahlt", storniert: "storniert", storno: "Storno", versendet: "versendet", angenommen: "angenommen", abgelehnt: "abgelehnt" })[r.status] || r.status;
    $("#cpane").innerHTML = `<div class="card"><div class="chead" style="margin-bottom:14px"><div><h2 style="font-size:18px">Angebote &amp; Rechnungen</h2><p>Alles, was dieser Kunde von Ihnen bekommen hat.</p></div>
      <div class="acts"><button class="btn btn--ghost btn--sm" data-act="newQuote">Neues Angebot</button><button class="btn btn--grad btn--sm" data-act="newInvoice">Neue Rechnung</button></div></div>
      <div class="plist">${mine.length ? mine.map(r => `<button class="prow prow--btn" data-act="openInvoice" data-id="${r.id}"><div class="proto__thumb" style="width:44px;height:44px;font-size:10px;font-weight:700;color:#fff">${r.kind === "angebot" ? "AN" : r.kind === "storno" ? "ST" : "RE"}</div>
        <div style="min-width:0;text-align:left"><h4>${esc(r.number || "Entwurf")} · ${esc(r.title || r.project || "")}</h4><p>${r.issue_date ? r.issue_date.split("-").reverse().join(".") : "noch nicht festgeschrieben"} · ${money(r.locked ? r.gross : r.draftTotals.gross)}</p></div>
        <span class="pill">${esc(st(r))}</span></button>`).join("") : `<div class="empty">Noch keine Angebote oder Rechnungen.</div>`}</div></div>`;
  }

  async function refreshAnnBadge() {
    const list = await api(`/clients/${current.id}/annotations`).catch(() => []);
    const n = list.filter(a => a.status === "offen").length, b = $("#annBadge"); if (b) { b.hidden = !n; b.textContent = n; }
    return list;
  }
  async function showTab(t) {
    tab = t;
    $$("#ctabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    if (current && location.hash.startsWith("#kunden/")) history.replaceState(null, "", `#kunden/${current.id}${t === "ueberblick" ? "" : "/" + t}`);
    if (t === "ueberblick") return showOverview();
    if (t === "finanzen") return showFinance();
    if (t === "chat") return showChat();
    if (t === "projekte") return loadProjects();
    if (t === "anmerkungen") return loadAnnotations();
    if (t === "termine") return loadAppointments();
    if (t === "dokumente") return loadDocuments();
  }
  const delegate = async e => {
    const t = e.target.closest("#ctabs button"); if (t) return showTab(t.dataset.t);
    const a = e.target.closest("[data-act]"); if (!a) return;
    try { await actions[a.dataset.act]?.(a, e); } catch (err) { toast(err.message); }
  };
  $("#clientDetail").addEventListener("click", delegate);
  $("#projectPage").addEventListener("click", delegate);

  /* ---------- Chat ---------- */
  async function showChat() {
    $("#cpane").innerHTML = `
      <section class="chat">
        <div class="chat__head"><span class="chat__dot"></span><div><h2>Chat mit ${esc(current.name)}</h2><p>${current.status === "aktiv" ? "Der Kunde sieht Ihre Antwort sofort im Portal." : "Der Kunde hat seinen Zugang noch nicht aktiviert – Nachrichten sieht er nach dem ersten Login."}</p></div></div>
        <div class="chat__log" id="clog"></div>
        <form class="composer" id="ccomposer"><textarea rows="1" placeholder="Antwort an ${esc(current.name)} …" aria-label="Nachricht"></textarea>
          <button type="submit" aria-label="Senden"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>
      </section>`;
    C.composer($("#ccomposer"), async text => {
      const m = await api(`/clients/${current.id}/messages`, { method: "POST", body: { body: text } }).catch(err => { toast(err.message); throw err; });
      if (!msgs.some(x => x.id === m.id)) msgs.push(m);
      $("#clog").dataset.scrolled = ""; C.render($("#clog"), msgs, "team", EMPTY);
    });
    msgs = []; await loadMessages(); loadClients();
  }
  async function loadMessages() {
    if (!current || !$("#clog")) return;
    const id = current.id, after = msgs.length ? msgs[msgs.length - 1].id : 0;
    const fresh = await api(`/clients/${id}/messages?after=${after}`);
    if (current?.id !== id || !$("#clog")) return;
    if (fresh.length || !msgs.length) { msgs = msgs.concat(fresh); C.render($("#clog"), msgs, "team", EMPTY); }
    else if (msgs.some(m => m.sender === "team" && !m.read)) { msgs = await api(`/clients/${id}/messages?after=0`); C.render($("#clog"), msgs, "team", EMPTY); }
  }

  /* ---------- Projekte des Kunden (Liste in der Kundenakte → eigene Projektseite) ---------- */
  async function loadProjects() {
    projects = await api(`/clients/${current.id}/projects`);
    $("#cpane").innerHTML = `
      <div class="card"><div class="chead" style="margin-bottom:10px"><h2 style="font-size:18px">Projekte</h2><div class="acts">${ME.owner ? `<button class="btn btn--grad btn--sm" data-act="newProject">Neues Projekt</button>` : ""}</div></div>
      <div class="cprojs">${projects.length ? projects.map(p => `
        <a class="cproj ${p.status !== "aktiv" ? "is-off" : ""}" href="${projektHref(p)}">
          <span class="cproj__t"><b>${esc(p.title)} ${bereichTag(p)}</b><small>${esc(p.kind || "Projekt")}${p.model ? " · " + esc(p.model) : ""}</small></span>
          <span>${stepper(p.phaseIndex)}<small>${esc(p.phase)}${p.status !== "aktiv" ? " · " + esc(p.status) : ""}</small></span>
          <span class="pteam">${teamAv(p.members) || (ME.owner ? `<small class="warn">nicht zugewiesen</small>` : "")}</span>
          <span>${p.next ? `<b>${C.fmt(p.next.start, { day: "numeric", month: "short" })}</b><small>${esc(p.next.title)}</small>` : `<small class="muted">kein Termin</small>`}</span>
          ${ME.owner ? `<span class="num">${p.offer_net != null ? moneyR(p.offer_net) : "–"}<small>Auftrag netto</small></span>` : ""}
        </a>`).join("") : `<div class="empty">${ME.owner ? "Noch keine Projekte. Legen Sie das erste an – Angebot, Termine, Prototypen und Rechnungen hängen dann daran." : "Ihnen ist bei diesem Kunden noch kein Projekt zugewiesen."}</div>`}</div></div>`;
  }

  /* ---------- Projektseite (#projekte/:id) ---------- */
  async function openProjectPage(id, keepScroll) {
    const y = scrollY, host = $("#projectPage");
    try { project = await api(`/projects/${id}`); }
    catch (err) { host.innerHTML = `<a class="back" href="#projekte">← Alle Projekte</a><div class="empty">${esc(err.message)}</div>`; return; }
    if (!keepScroll || !clients.some(c => c.id === project.client_id)) clients = await api("/clients");
    current = clients.find(c => c.id === project.client_id) || { id: project.client_id, company: "", name: "", email: "" };
    projects = await api(`/clients/${current.id}/projects`);
    const p = project, protoIds = new Set(p.prototypes.flat().map(v => v.id));
    const anns = (await api(`/clients/${current.id}/annotations`).catch(() => [])).filter(a => protoIds.has(a.prototype_id));
    loadAnnotations.all = anns;
    const byProto = {}; [...anns].sort((a, b) => a.id - b.id).forEach(a => { (byProto[a.prototype_id] ||= []).push(a.id); });
    const openAnns = anns.filter(a => a.status === "offen");
    const paid = p.payments.filter(x => x.status === "bezahlt").reduce((s, x) => s + x.amount_net, 0), total = p.payments.reduce((s, x) => s + x.amount_net, 0);
    const more = [{ v: "newContract", l: "Laufenden Vertrag anlegen" }, ...(p.status === "aktiv" && !p.offer_net ? [{ v: "zurAnfrage", l: "Zurück zur Anfrage" }] : []), p.status === "anfrage" ? { v: "resume", l: "Als Auftrag übernehmen" } : p.status === "aktiv" ? { v: "pause", l: "Projekt pausieren" } : { v: "resume", l: "Projekt fortsetzen" }, ...(p.status !== "abgeschlossen" ? [{ v: "finish", l: "Als abgeschlossen markieren" }] : []), { v: "deleteProject", l: "Projekt löschen", danger: true }];
    const statusPill = p.status === "aktiv" ? `<span class="pill pill--aktiv">aktiv</span>` : `<span class="pill">${esc(p.status)}</span>`;
    host.innerHTML = `
      <a class="back" href="#projekte">← Alle Projekte</a>
      <div class="card phead">
        <div class="khead__top">
          <div class="khead__id"><p class="kicker">${esc(p.kind || "Projekt")}${p.model ? " · " + esc(p.model) : ""}</p><h1>${esc(p.title)} ${statusPill}</h1>
            <p>für <a href="#kunden/${current.id}">${esc(current.company)}</a>${current.name ? " · " + esc(current.name) : ""} · seit ${day(p.created_at)}</p></div>
          <div class="khead__acts">
            ${current.stage === "mandant" ? `<a class="btn btn--ghost btn--sm" href="#kunden/${current.id}/chat">Nachricht an Kunden</a>` : ""}
            <button class="btn btn--ghost btn--sm" data-act="schedule">Termin</button>
            <button class="btn btn--grad btn--sm" data-act="editProject">Bearbeiten</button>
            ${ME.owner ? DD.html("pMore", more, "", { trigger: "Mehr", align: "right" }) : ""}</div></div>
        <div class="pphase" role="list">${PHASES.map((ph, k) => `<button type="button" data-act="setPhase" data-ph="${esc(ph)}" class="${k < p.phaseIndex ? "done" : k === p.phaseIndex ? "now" : ""}" title="Phase auf „${esc(ph)}“ setzen"><i></i><span>${esc(ph)}</span></button>`).join("")}</div>
      </div>
      <div class="pgrid">
        <div class="stack p-main">
          <div class="card" id="pTasks"></div>
          <div class="card">
            <div class="chead" style="margin-bottom:10px"><div><h2 style="font-size:18px">Prototypen &amp; Anmerkungen</h2><p>${openAnns.length ? `<b class="warn">${openAnns.length} offene Anmerkung${openAnns.length === 1 ? "" : "en"}</b> vom Kunden` : "Keine offenen Anmerkungen."}</p></div>
              <div class="acts"><button class="btn btn--grad btn--sm" data-act="uploadProto">Hochladen</button></div></div>
            <div id="pStand"></div>
            <div id="pAuftrag"></div>
            <div class="plist">${p.prototypes.length ? p.prototypes.map((g, gi) => protoGroupRow(g, gi)).join("") : `<div class="empty">Noch kein Prototyp.</div>`}</div>
            ${openAnns.length ? `<div class="annlist annlist--compact">${openAnns.sort((a, b) => a.id - b.id).map(a => `
              <div class="ann" data-act="jump" data-id="${a.id}"><span class="ann__no">${byProto[a.prototype_id].indexOf(a.id) + 1}</span>
                <div class="ann__body"><p>${esc(a.comment || "(nur Zeichnung)")}</p>${a.ai ? `<p class="ann__ai"><span class="kpill kpill--${esc(a.ai.kind || "x")}">${esc({ klein: "Klein", mittel: "Mittel", gross: "Groß" }[a.ai.kind] || (a.ai.status === "rueckfrage" ? "Rückfrage offen" : "KI"))}</span>${esc(a.ai.summary || "")}</p>` : ""}${a.change && a.comment !== window.RSViewer?.changeText(a.change) ? `<p class="ann__chg">→ ${esc(window.RSViewer.changeText(a.change))}</p>` : a.change ? `<p class="ann__chg">Mit Live-Vorschau gewählt · im Viewer „Vorschau zeigen“</p>` : ""}<span>${esc(a.proto_title)} V${a.proto_version} · ${esc(a.page || "Startseite")} · ${esc(a.author)} · ${ago(a.created_at)}</span></div>
                <div class="acts"><button class="btn btn--sm" data-act="jump" data-id="${a.id}">Zur Stelle →</button><button class="btn btn--sm" data-ann-task="${a.id}" title="Als Aufgabe übernehmen – erledigt sich mit der Aufgabe">→ Aufgabe</button><button class="btn btn--ok btn--sm" data-act="toggleAnn" data-id="${a.id}" data-s="offen">✓ Erledigt</button></div></div>`).join("")}</div>` : ""}
          </div>
          <div class="card" id="pTests"></div>
          <div class="card"><div class="chead" style="margin-bottom:10px"><h2 style="font-size:18px">Termine</h2><div class="acts"><button class="btn btn--ghost btn--sm" data-act="newAppt">Termin eintragen</button></div></div>
            <div class="plist">${p.appointments.length ? [...p.appointments].sort((x, y) => y.start.localeCompare(x.start)).map(apptRow).join("") : `<div class="empty">Noch keine Termine.</div>`}</div></div>
          <div class="card"><div class="chead" style="margin-bottom:10px"><h2 style="font-size:18px">Dokumente</h2><div class="acts"><button class="btn btn--ghost btn--sm" data-act="newDoc">Hochladen</button></div></div>
            <div class="plist">${p.documents.length ? p.documents.map(docRow).join("") : `<div class="empty">Noch keine Dokumente.</div>`}</div></div>
        </div>
        <div class="stack p-side">
          <div class="card astand" id="pArbeit" hidden></div>
          <div class="card" id="pVerein" hidden></div>
          <div class="card"><div class="chead" style="margin-bottom:12px"><h2 style="font-size:18px">Team</h2>${ME.owner ? `<div class="acts"><button class="btn btn--ghost btn--sm" data-act="assign">${p.members.length ? "Ändern" : "Zuweisen"}</button></div>` : ""}</div>
            ${p.members.length ? `<div class="pmembers">${p.members.map(m => `<div><span class="avatar">${esc(initials(m.name))}</span><span><b>${esc(m.name)}${m.id === ME.id ? " (Sie)" : ""}</b><small>${m.role === "inhaber" ? "Inhaber" : "Entwickler"}</small></span></div>`).join("")}</div>`
              : `<div class="pnoteam"><b>Noch niemand zugewiesen.</b><span>Wählen Sie, wer das Projekt umsetzt – mit Blick auf die aktuelle Auslastung.</span>${ME.owner ? `<button class="btn btn--grad btn--sm" data-act="assign">Jetzt zuweisen</button>` : ""}</div>`}</div>
          <div class="card" id="pTime"></div>
          ${ME.owner ? `<div class="card"><div class="chead" style="margin-bottom:12px"><h2 style="font-size:18px">Auftrag &amp; Zahlungen</h2><div class="acts"><button class="btn btn--ghost btn--sm" data-act="editProject">Bearbeiten</button></div></div>
            ${p.offer_net != null ? `<div class="pmoney"><div><small>Auftrag netto</small><b>${money(p.offer_net)}</b><span>${money(p.offer_gross)} brutto</span></div><div><small>Bezahlt</small><b>${money(paid)}</b><span>offen ${money(total - paid)}</span></div></div>
              <div class="pbar"><i style="width:${total ? paid / total * 100 : 0}%"></i></div>` : `<p class="hint" style="margin:0 0 10px">Noch kein Kostenvoranschlag hinterlegt.</p>`}
            <div class="ppays">${p.payments.map(x => `<div class="ppay ppay--${x.status}"><span><b>${esc(x.label)}</b><small>${x.due ? "fällig " + x.due.split("-").reverse().join(".") : x.due_on ? (x.due_on === "Auftrag" ? "bei Auftrag" : "ab Phase " + esc(x.due_on)) + (x.pct ? ` · ${String(x.pct).replace(".", ",")} %` : "") : "ohne Fälligkeit"}</small></span><span class="num">${money(x.amount_net)}</span>
              <span class="ppay__st">${x.status === "bezahlt" ? "bezahlt" : x.status === "berechnet" ? "Rechnung gestellt" : "offen"}</span>
              ${x.invoice_url ? `<a class="payinv" href="${esc(x.invoice_url)}" target="_blank" rel="noopener">PDF</a>` : x.status !== "bezahlt" ? `<button type="button" class="payinv payinv--new" data-act="invoicePay" data-id="${x.id}" title="Rechnung für diese Position erstellen">+ RE</button>` : `<span></span>`}</div>`).join("") || `<p class="hint" style="margin:0">Noch kein Zahlungsplan.</p>`}</div></div>` : ""}
        </div>
        <div class="stack p-more">
          ${p.description || p.conditions ? `<div class="card"><h2 style="font-size:18px">Beschreibung</h2>${p.description ? `<p class="ptext">${esc(p.description)}</p>` : ""}${p.conditions ? `<p class="ptext ptext--muted"><b>Konditionen:</b> ${esc(p.conditions)}</p>` : ""}</div>` : ""}
          <div class="card"><h2 style="font-size:18px">Verlauf</h2><ol class="tl">${p.events.slice(0, 12).map(e => `<li><b>${esc(e.title)}</b><span>${C.fmt(e.created_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>${e.detail ? `<p>${esc(e.detail)}</p>` : ""}</li>`).join("") || "<li><span>Noch keine Einträge.</span></li>"}</ol></div>
        </div>
      </div>`;
    window.WORK?.projectCards(p);
    window.STAND?.projectCard(p).then(() => window.AUFTRAG?.load(p));
    window.PRUEF?.load(p);
    window.BOARD?.arbeitsstand?.(p);
    window.BOARD?.vereinbarungen?.(p);
    if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  }
  DD.on("pMore", v => Promise.resolve().then(() => actions[v]?.()).catch(err => toast(err.message)));
  const setProject = async (body, msg) => { await api(`/projects/${project.id}`, { method: "PATCH", body }); toast(msg); openProjectPage(project.id, true); };

  const payRow = x => `<div class="payrow" data-id="${x.id || ""}">
    <input data-f="label" value="${esc(x.label || "")}" placeholder="z. B. Anzahlung 50 %"><input data-f="amount_net" inputmode="decimal" value="${euro(x.amount_net)}" placeholder="Betrag €">
    <input data-f="due" type="date" value="${x.due || ""}" title="festes Fälligkeitsdatum (optional)">
    <select data-f="due_on" title="Rechnungsentwurf automatisch anlegen, sobald …">${[["", "Rechnung manuell"], ["Auftrag", "bei Auftrag"], ...["Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"].map(p => [p, "ab " + p])].map(([v, l]) => `<option value="${v}" ${v === (x.due_on || "") ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select data-f="status" class="paystate paystate--${x.status || "offen"}">${[["offen", "offen"], ["berechnet", "Rechnung gestellt"], ["bezahlt", "bezahlt"]].map(([v, l]) => `<option value="${v}" ${v === (x.status || "offen") ? "selected" : ""}>${l}</option>`).join("")}</select>
    <span class="payinv payinv--none"></span>
    <button type="button" class="x" data-act="delPay" title="Entfernen">✕</button></div>`;
  function protoGroupRow(g, gi) {
    const v = g[0];
    return `<div class="prow ${v.active ? "" : "off"}">
      <div class="proto__thumb" style="width:44px;height:44px">${C.ICON}</div>
      <div style="min-width:0"><h4>${esc(v.title)} <em class="vtag">V${v.version}</em>${v.openNotes ? ` <span class="pill pill--neu" style="font-size:11px">${v.openNotes} offen</span>` : ""}</h4>
        <p>${C.fmt(v.created_at, { day: "numeric", month: "short", year: "numeric" })} · ${v.files} Dateien · ${C.size(v.bytes)}${g.length > 1 ? ` · ${g.length} Versionen` : ""}${v.state === "kandidat" ? ` · <b class="warn">Kandidat – Kunde sieht ihn erst nach Freigabe</b>` : v.active ? "" : " · deaktiviert"}</p>
        <p class="seenby ${v.seen && v.seen.version >= v.version ? "seenby--ok" : ""}">${v.seen ? (v.seen.version >= v.version ? "✓ Kunde hat den aktuellen Stand gesehen" : `Kunde kennt Version ${v.seen.version}`) + ` · zuletzt geöffnet ${C.fmt(v.seen.seen_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Vom Kunden noch nicht geöffnet"}</p>
        ${v.changes ? `<p style="color:var(--ink2)">${esc(v.changes)}</p>` : ""}</div>
      <div class="acts">
        <button class="btn btn--sm" data-act="openProto" data-g="${gi}">Öffnen</button>
        <button class="btn btn--ghost btn--sm" data-act="newVersion" data-g="${gi}">Neue Version</button>
        ${DD.html("proto-" + v.id, [{ v: "copyProto", l: "Link kopieren" }, { v: "toggleProto", l: v.active ? "Deaktivieren" : "Aktivieren" }, { v: "deleteProto", l: "Version löschen", danger: true }], "", { trigger: "Mehr", align: "right" })}
      </div></div>`;
  }
  // Prototyp-Menü: Aktion mit der Version aus dem Menü-Schlüssel
  document.addEventListener("click", e => {
    const item = e.target.closest('.dd[data-dd^="proto-"] .dd__menu [data-v]'); if (!item) return;
    const id = +item.closest(".dd").dataset.dd.slice(6), v = project?.prototypes.flat().find(x => x.id === id); if (!v) return;
    const fake = { dataset: { id: String(id), on: v.active ? "1" : "0", url: v.url } };
    Promise.resolve(actions[item.dataset.v]?.(fake)).catch(err => toast(err.message));
  }, true);
  const apptRow = a => `<div class="prow"><div class="date"><span>${C.fmt(a.start, { month: "short" })}</span><b>${C.fmt(a.start, { day: "numeric" })}</b></div>
    <div style="min-width:0"><h4>${esc(a.title)}</h4><p>${C.fmt(a.start, { weekday: "short", hour: "2-digit", minute: "2-digit" })} Uhr${a.kind ? " · " + esc(a.kind) : ""}${a.project && !onProjectPage() ? " · " + esc(a.project) : ""}${new Date(a.start) < new Date() ? ` · ${a.summary ? "Zusammenfassung ✓" : "<b class='warn'>ohne Zusammenfassung</b>"}` : " · <b>geplant</b>"}</p></div>
    <div class="acts">${a.video_url && new Date(a.start).getTime() + 3 * 3600e3 > Date.now() ? `<a class="btn btn--grad btn--sm" href="${esc(a.video_url)}" target="_blank" rel="noopener" title="${esc(a.video_url)}">Video beitreten</a>` : ""}${a.next_steps && a.project_id && onProjectPage() ? `<button class="btn btn--ghost btn--sm" data-appt-tasks="${a.id}" title="Jede Zeile der nächsten Schritte wird eine Aufgabe">→ Aufgaben</button>` : ""}<button class="btn btn--ghost btn--sm" data-act="editAppt" data-id="${a.id}">Bearbeiten</button></div></div>`;
  const docRow = d => `<div class="prow"><div class="proto__thumb" style="width:44px;height:44px;font-size:10px;font-weight:700;color:#fff">${esc((d.file_name.split(".").pop() || "").toUpperCase().slice(0, 4))}</div>
    <div style="min-width:0"><h4>${esc(d.title)}</h4><p>${esc(d.kind)}${d.doc_date ? " · " + esc(d.doc_date.split("-").reverse().join(".")) : ""}${d.amount_gross != null ? " · " + money(d.amount_gross) + " brutto" : ""}${d.project && !onProjectPage() ? " · " + esc(d.project) : ""}</p></div>
    <div class="acts"><a class="btn btn--sm" href="${esc(d.url)}" target="_blank" rel="noopener">Öffnen</a><button class="btn btn--danger btn--sm" data-act="deleteDoc" data-id="${d.id}">Löschen</button></div></div>`;

  // Projekt bearbeiten (Dialog statt Riesenformular)
  function editProjectDialog() {
    const p = project;
    const f = dialog(`<h2 class="span2">Projekt bearbeiten</h2>
      <label class="span2">Titel<input name="title" value="${esc(p.title)}" required></label>
      <label>Art<input name="kind" value="${esc(p.kind || "")}" placeholder="z. B. Web-App"></label>
      <div class="field"><span>Modell</span>${DD.html("f-model", (MODELS.includes(p.model || "") ? MODELS : [...MODELS, p.model]).map(m => ({ v: m, l: m || "– kein Modell –" })), p.model || "", { field: "model" })}</div>
      <label class="span2">Beschreibung (sieht der Kunde)<textarea name="description" rows="3">${esc(p.description || "")}</textarea></label>
      ${ME.owner ? `<h3 class="span2 fsec">Auftrag &amp; Konditionen</h3>
      <label>Auftragswert netto (€)<input name="offer_net" inputmode="decimal" value="${euro(p.offer_net)}" placeholder="40.000"></label>
      <label>Umsatzsteuer (%)<input name="vat_rate" inputmode="decimal" value="${String(p.vat_rate).replace(".", ",")}"></label>
      <label class="span2">Vereinbarte Konditionen (sieht der Kunde)<textarea name="conditions" rows="3" placeholder="z. B. 50 % Anzahlung bei Auftrag, 30 % bei Abnahme des Prototyps, 20 % nach Launch.">${esc(p.conditions || "")}</textarea></label>
      <div class="span2"><b class="flabel">Zahlungsplan (netto)</b><div id="payRows" class="payrows">${p.payments.map(payRow).join("")}</div>
        <button type="button" class="link" data-act="addPay">+ Position hinzufügen</button></div>` : ""}
      <label class="check span2 notify"><input type="checkbox" name="notify" checked> Kunden per E-Mail informieren <small>(mehrere Änderungen werden zu einer Mail gebündelt)</small></label>`,
      async f => {
        const body = { title: f.title.value, kind: f.kind.value, model: f.model.value, description: f.description.value, notify: f.notify.checked };
        if (ME.owner) Object.assign(body, { offer_net: f.offer_net.value.trim(), vat_rate: f.vat_rate.value.replace(",", "."), conditions: f.conditions.value,
          payments: $$("#payRows .payrow", f).map(r => ({ id: +r.dataset.id || undefined, label: $("[data-f=label]", r).value, amount_net: $("[data-f=amount_net]", r).value, due: $("[data-f=due]", r).value, due_on: $("[data-f=due_on]", r).value, status: $("[data-f=status]", r).value })).filter(x => x.label.trim() || x.amount_net.trim()) });
        await api(`/projects/${project.id}`, { method: "PATCH", body });
        toast(f.notify.checked ? "Gespeichert – der Kunde sieht es sofort und bekommt gleich eine E-Mail." : "Gespeichert."); openProjectPage(project.id, true);
      }, { wide: true });
    f.addEventListener("change", e => { if (e.target.matches("[data-f=status]")) e.target.className = `paystate paystate--${e.target.value}`; });
  }

  /* ---------- Anmerkungen (Kurzansicht zum Abarbeiten) ---------- */
  async function loadAnnotations() {
    const all = await refreshAnnBadge();
    // Nummern wie im Viewer: je Prototyp in Reihenfolge der Erstellung
    const byProto = {}; [...all].sort((a, b) => a.id - b.id).forEach(a => { (byProto[a.prototype_id] ||= []).push(a.id); });
    const list = all.filter(a => annFilter === "alle" || a.status === "offen");
    const groups = new Map(); for (const a of list) { if (!groups.has(a.prototype_id)) groups.set(a.prototype_id, []); groups.get(a.prototype_id).push(a); }
    $("#cpane").innerHTML = `
      <div class="card"><div class="chead" style="margin-bottom:14px"><div><h2 style="font-size:18px">Anmerkungen an Prototypen</h2><p>Klick auf eine Zeile springt direkt an die eingezeichnete Stelle.</p></div>
        <div class="acts"><div class="seg" id="annSeg"><button data-f="offen" class="${annFilter === "offen" ? "on" : ""}">Offen (${all.filter(a => a.status === "offen").length})</button><button data-f="alle" class="${annFilter === "alle" ? "on" : ""}">Alle (${all.length})</button></div></div></div>
      ${groups.size ? [...groups.values()].map(g => `
        <h3 class="anngroup">${esc(g[0].proto_title)} <em class="vtag">V${g[0].proto_version}</em></h3>
        <div class="annlist">${g.sort((a, b) => a.id - b.id).map(a => `
          <div class="ann ${a.status === "erledigt" ? "ann--done" : ""}" data-act="jump" data-id="${a.id}">
            <span class="ann__no">${byProto[a.prototype_id].indexOf(a.id) + 1}</span>
            <div class="ann__body"><p>${esc(a.comment || "(nur Zeichnung)")}</p>${a.ai ? `<p class="ann__ai"><span class="kpill kpill--${esc(a.ai.kind || "x")}">${esc({ klein: "Klein", mittel: "Mittel", gross: "Groß" }[a.ai.kind] || (a.ai.status === "rueckfrage" ? "Rückfrage offen" : "KI"))}</span>${esc(a.ai.summary || "")}</p>` : ""}${a.change && a.comment !== window.RSViewer?.changeText(a.change) ? `<p class="ann__chg">→ ${esc(window.RSViewer.changeText(a.change))}</p>` : a.change ? `<p class="ann__chg">Mit Live-Vorschau gewählt · im Viewer „Vorschau zeigen“</p>` : ""}
              <span>${esc(a.page || "Startseite")} · ${a.device_w} px breit · ${esc(a.author)} · ${C.fmt(a.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${a.strokes.length ? ` · ${a.strokes.length} Zeichnung${a.strokes.length === 1 ? "" : "en"}` : ""}</span></div>
            <div class="acts"><button class="btn btn--sm" data-act="jump" data-id="${a.id}">Zur Stelle →</button>
              <button class="btn ${a.status === "erledigt" ? "btn--ghost" : "btn--ok"} btn--sm" data-act="toggleAnn" data-id="${a.id}" data-s="${a.status}">${a.status === "erledigt" ? "Wieder öffnen" : "✓ Erledigt"}</button></div>
          </div>`).join("")}</div>`).join("") : `<div class="empty">${annFilter === "offen" ? "Keine offenen Anmerkungen – alles abgearbeitet. 🎉" : "Noch keine Anmerkungen."}</div>`}
      </div>`;
    $("#annSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { annFilter = b.dataset.f; loadAnnotations(); } });
    loadAnnotations.all = all;
  }

  /* ---------- Termine & Dokumente (alle des Kunden) ---------- */
  async function loadAppointments() {
    const [list, bookings, requests] = await Promise.all([api(`/clients/${current.id}/appointments`), api(`/clients/${current.id}/bookings`), api(`/clients/${current.id}/requests`)]);
    const open = requests.filter(r => r.status === "offen");
    const when = iso => C.fmt(iso, { weekday: "short", day: "numeric", month: "short" }) + ", " + C.fmt(iso, { hour: "2-digit", minute: "2-digit" });
    $("#cpane").innerHTML = `
      ${open.length ? `<div class="card reqcard" style="margin-bottom:14px"><h2 style="font-size:18px">Terminanfragen <span class="pill pill--neu">${open.length} offen</span></h2>
        <p class="hint">Ein Klick auf einen Wunschtermin bestätigt ihn: Er landet in Ihrem Kalender, beim Kunden im Portal und im Verlauf – der Kunde bekommt eine Bestätigung.</p>
        ${open.map(r => `<div class="reqrow" data-rid="${r.id}">
          <div class="reqrow__top"><div><h4>${esc(r.label)} · ${r.minutes} Min.${r.project ? ` <span style="font-weight:400;color:var(--muted)">· ${esc(r.project)}</span>` : ""}</h4>
            <p>angefragt ${C.fmt(r.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${r.flexible ? " · <b>flexibel</b>" : ""}</p>
            ${r.message ? `<div class="bk__msg" style="margin-top:8px">${esc(r.message)}</div>` : ""}</div></div>
          <div class="reqslots">${r.slots.map(s => `<button class="reqslot ${s.free ? "" : "reqslot--taken"}" data-act="acceptReq" data-rid="${r.id}" data-start="${s.start}" ${s.free ? "" : 'title="Inzwischen belegt"'}>
              <span>Annehmen</span><b>${when(s.start)} Uhr</b>${s.free ? "" : "<em>belegt</em>"}</button>`).join("")}
            <button class="btn btn--ghost btn--sm" data-act="otherTime" data-rid="${r.id}">Andere Zeit …</button>
            <button class="btn btn--danger btn--sm" data-act="declineReq" data-rid="${r.id}">Ablehnen</button></div>
        </div>`).join("")}</div>` : ""}
      ${bookings.length ? `<div class="card" style="margin-bottom:14px"><h2 style="font-size:18px">Über die Website gebucht</h2><p class="hint">Diese Buchungen stammen von ${esc(current.email)}. Übernehmen Sie sie, damit der Kunde sie im Portal sieht.</p>
        <div class="plist">${bookings.map(b => `<div class="prow"><div class="date"><span>${C.fmt(b.start, { month: "short" })}</span><b>${C.fmt(b.start, { day: "numeric" })}</b></div><div><h4>${esc(b.type)}${b.product ? " · " + esc(b.product) : ""}</h4><p>${C.fmt(b.start, { weekday: "short", hour: "2-digit", minute: "2-digit" })} Uhr · ${b.minutes} Min. · ${esc(b.status)}</p></div>
          <div class="acts"><button class="btn btn--sm" data-act="importBooking" data-b='${esc(JSON.stringify({ id: b.id, start: b.start, minutes: b.minutes, type: b.type, message: b.message || "" }))}'>Übernehmen</button></div></div>`).join("")}</div></div>` : ""}
      <div class="card"><div class="chead" style="margin-bottom:14px"><div><h2 style="font-size:18px">Termine</h2><p>Mit Zusammenfassung und nächsten Schritten – beides sieht der Kunde im Portal.</p></div><div class="acts"><button class="btn btn--grad btn--sm" data-act="newAppt">Termin eintragen</button></div></div>
        <div class="plist">${list.length ? [...list].sort((x, y) => x.start.localeCompare(y.start)).map(apptRow).join("") : `<div class="empty">Noch keine Termine.</div>`}</div></div>`;
    loadAppointments.list = list;
  }
  async function loadDocuments() {
    const list = await api(`/clients/${current.id}/documents`);
    $("#cpane").innerHTML = `<div class="card"><div class="chead" style="margin-bottom:14px"><div><h2 style="font-size:18px">Dokumente</h2><p>Angebote, Rechnungen, Verträge – der Kunde sieht und lädt sie im Portal.</p></div><div class="acts"><button class="btn btn--grad btn--sm" data-act="newDoc">Hochladen</button></div></div>
      <div class="plist">${list.length ? list.map(docRow).join("") : `<div class="empty">Noch keine Dokumente.</div>`}</div></div>`;
  }

  /* ---------- Formulare in einem Dialog ---------- */
  function dialog(html, onSubmit, { wide = false } = {}) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card form-grid" style="width:min(${wide ? 860 : 620}px,100%);max-height:90vh;overflow:auto">${html}
      <p class="err span2" hidden></p><div class="span2" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">Speichern</button></div></form>`;
    document.body.appendChild(m);
    const f = m.querySelector("form"), close = () => m.remove();
    m.addEventListener("click", e => {
      if (e.target === m || e.target.closest("[data-close]")) return close();
      const a = e.target.closest("[data-act]"); if (a && ["addPay", "delPay"].includes(a.dataset.act)) { e.preventDefault(); actions[a.dataset.act](a, e); }
    });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try { await onSubmit(f); close(); } catch (err) { const p = f.querySelector(".err"); p.textContent = err.message; p.hidden = false; btn.disabled = false; }
    });
    f.querySelector("input,select,textarea")?.focus();
    return f;
  }
  const projectSelect = (sel) => `<label>Projekt<select name="project_id"><option value="">– ohne Projekt –</option>${projects.map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label>`;
  async function ensureProjects() { if (!projects.length || projects[0]?.client_id !== current.id) projects = await api(`/clients/${current.id}/projects`); }

  async function apptDialog(a = {}) {
    await ensureProjects();
    const start = a.start ? localDT(a.start) : localDT(new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString());
    dialog(`<h2 class="span2">${a.id ? "Termin bearbeiten" : "Termin eintragen"}</h2>
      <label class="span2">Titel<input name="title" required value="${esc(a.title || "")}" placeholder="z. B. Erstgespräch Praxissoftware"></label>
      <label>Datum &amp; Uhrzeit<input type="datetime-local" name="start" required value="${start}"></label>
      <label>Dauer (Min.)<input type="number" name="minutes" min="0" max="600" value="${a.minutes || 30}"></label>
      <label>Art<select name="kind">${opts(APPT_KINDS, a.kind || "Erstgespräch")}</select></label>
      ${projectSelect(a.project_id ?? project?.id)}
      <label class="span2">Interne Notizen <small class="muted" style="font-weight:400">– sieht der Kunde nicht. Stichpunkte aus dem Gespräch, Grundlage für das Angebot.</small><textarea name="notes_intern" rows="5" placeholder="z. B. will nur ein Konzept, Budget ca. …, Entscheidung bis …"></textarea></label>
      <label class="span2">Zusammenfassung (sieht der Kunde)<textarea name="summary" rows="6" placeholder="Was wurde besprochen? Was möchte der Kunde?">${esc(a.summary || "")}</textarea></label>
      <label class="span2">Nächste Schritte<textarea name="next_steps" rows="3" placeholder="z. B. Wir schicken bis Freitag den ersten Prototyp.">${esc(a.next_steps || "")}</textarea></label>
<label class="check span2 notify"><input type="checkbox" name="notify" checked> Kunden per E-Mail informieren <small>(mehrere Änderungen werden zu einer Mail gebündelt)</small></label>
      ${a.id ? `<button type="button" class="btn btn--danger btn--sm span2" style="justify-self:start" data-delappt="${a.id}">Termin löschen</button>` : ""}`,
      async f => {
        const body = { title: f.title.value, start: new Date(f.start.value).toISOString(), minutes: +f.minutes.value, kind: f.kind.value, project_id: f.project_id.value ? +f.project_id.value : null, summary: f.summary.value, next_steps: f.next_steps.value, booking_id: a.booking_id, notify: f.notify.checked, notes_intern: f.notes_intern.value };
        if (a.id) await api(`/appointments/${a.id}`, { method: "PATCH", body }); else await api(`/clients/${current.id}/appointments`, { method: "POST", body });
        toast("Termin gespeichert"); refreshCurrent();
      });
    // Interne Notizen gesondert laden: Sie stehen nicht in den Termindaten, die auch das Kundenportal bekommt
    if (a.id) api(`/appointments/${a.id}`).then(r => { const t = document.querySelector(".modal textarea[name=notes_intern]"); if (t && !t.value) t.value = r.notes_intern || ""; }).catch(() => {});
    document.querySelector("[data-delappt]")?.addEventListener("click", async e => {
      if (!(await UI.confirm("Der Termin verschwindet auch beim Kunden.", { title: "Termin löschen?", ok: "Löschen", danger: true }))) return;
      await api(`/appointments/${e.target.dataset.delappt}`, { method: "DELETE", body: {} }); e.target.closest(".modal").remove(); toast("Gelöscht"); refreshCurrent();
    });
  }
  async function docDialog() {
    await ensureProjects();
    const docForm = dialog(`<h2 class="span2">Dokument hochladen</h2>
      <label class="span2">Datei (PDF, Bild, Word, Excel …)<input type="file" name="file" required></label>
      <label>Art<select name="kind">${ME.owner ? opts(DOC_KINDS, "Rechnung") : opts(DOC_KINDS.filter(k => !["Angebot", "Rechnung", "Vertrag"].includes(k)), "Konzept")}</select></label>
      ${projectSelect(project?.id)}
      <label class="span2">Titel<input name="title" placeholder="z. B. Rechnung Nr. 2026-014 – Anzahlung"></label>
      <label>Betrag brutto (€, optional)<input name="amount_gross" inputmode="decimal" placeholder="23.800"></label>
      <label>Datum<input type="date" name="doc_date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="span2" id="payPick" hidden>Zu welcher Zahlung gehört die Rechnung?<select name="payment_id"><option value="">– keiner Zahlung zuordnen –</option></select>
        <small class="hint" style="margin:4px 0 0">Die Position springt beim Kunden automatisch auf „Rechnung gestellt“ – mit Link zur PDF.</small></label>
      <label class="check span2 notify"><input type="checkbox" name="notify" checked> Kunden per E-Mail informieren <small>(mehrere Änderungen werden zu einer Mail gebündelt)</small></label>`,
      async f => {
        const file = f.file.files[0]; if (!file) throw new Error("Bitte eine Datei wählen.");
        if (file.size > 20 * 1048576) throw new Error("Höchstens 20 MB.");
        await api(`/clients/${current.id}/documents`, { method: "POST", body: { file_name: file.name, data: b64(new Uint8Array(await file.arrayBuffer())), kind: f.kind.value, title: f.title.value || file.name.replace(/\.[^.]+$/, ""),
          amount_gross: f.amount_gross.value.trim(), doc_date: f.doc_date.value, project_id: f.project_id.value ? +f.project_id.value : null,
          payment_id: f.payment_id.value ? +f.payment_id.value : null, notify: f.notify.checked } });
        toast("Dokument hochgeladen – der Kunde sieht es im Portal."); refreshCurrent();
      });
    // Zahlungsauswahl nur bei Rechnungen mit Projekt; Positionen des gewählten Projekts laden
    const form = docForm;
    const syncPay = async () => {
      const pid = +form.project_id.value, isInv = form.kind.value === "Rechnung";
      form.querySelector("#payPick").hidden = !(pid && isInv);
      if (!(pid && isInv)) return;
      const p = project?.id === pid ? project : await api(`/projects/${pid}`);
      const sel = form.payment_id, open = p.payments.filter(x => x.status !== "bezahlt");
      sel.innerHTML = `<option value="">– keiner Zahlung zuordnen –</option>` + p.payments.map(x => `<option value="${x.id}">${esc(x.label)} · ${money(x.amount_gross)} brutto${x.status === "bezahlt" ? " (bezahlt)" : x.status === "berechnet" ? " (bereits berechnet)" : ""}</option>`).join("");
      const first = open.find(x => x.status === "offen"); if (first) { sel.value = first.id; if (!form.amount_gross.value) form.amount_gross.value = (first.amount_gross / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }); }
    };
    form.project_id.addEventListener("change", syncPay); form.kind.addEventListener("change", syncPay);
    form.payment_id.addEventListener("change", () => { const p = project?.payments?.find(x => x.id === +form.payment_id.value); if (p) form.amount_gross.value = (p.amount_gross / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }); });
    syncPay();
  }
  function refreshCurrent() { if (location.hash.startsWith("#termine")) return window.CAL?.reload(); if (onProjectPage() && project) return openProjectPage(project.id, true); if (current && !$("#clientDetail").hidden) showTab(tab); }

  /* ---------- Prototyp-Upload (neu oder neue Version) ---------- */
  function uploadDialog(group) {
    pending = null;
    const v = group?.[0];
    const f = dialog(`<h2 class="span2">${v ? `Neue Version von „${esc(v.title)}“ (V${v.version + 1})` : "Prototyp hochladen"}</h2>
      <div class="drop span2" id="drop"><b>Dateien hierher ziehen</b>HTML-Datei, Ordner oder ZIP · <button type="button" class="link" data-pick="files">Dateien / ZIP wählen</button> · <button type="button" class="link" data-pick="dir">Ordner wählen</button>
        <input type="file" id="upFiles" multiple hidden><input type="file" id="upDir" webkitdirectory hidden></div>
      <div id="upSum" class="span2" hidden></div>
      <label class="span2">Titel<input name="title" required maxlength="140" value="${esc(v?.title || "")}" placeholder="z. B. Website – Entwurf"></label>
      ${v ? `<label class="span2">Was hat sich geändert? (sieht der Kunde)<textarea name="changes" rows="3" placeholder="z. B. Farben wärmer, Samstag in der Terminbuchung ergänzt"></textarea></label>` : ""}
      <label class="span2">Nachricht im Chat<textarea name="message" rows="2" placeholder="Leer lassen für den Standardtext"></textarea></label>
      <label class="check span2"><input type="checkbox" name="announce" checked> Im Chat ankündigen und Kunden benachrichtigen</label>`,
      async f => {
        if (!pending?.files.length) throw new Error("Bitte zuerst Dateien auswählen.");
        f.querySelector("[type=submit]").textContent = "Wird hochgeladen …";
        const r = await api(`/clients/${current.id}/prototypes`, { method: "POST", body: { title: f.title.value, message: f.message.value, announce: f.announce.checked, entry: pending.entry,
          project_id: project?.id, replaces: v ? v.group_id : undefined, changes: f.changes?.value || "", files: pending.files.map(x => ({ path: x.path, data: b64(x.data) })) } });
        toast(r.skipped?.length ? `Hochgeladen · ${r.skipped.length} Datei(en) übersprungen` : v ? `Version ${r.prototype.version} ist online` : "Prototyp hochgeladen");
        refreshCurrent(); loadClients();
      });
    const drop = f.querySelector("#drop");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", async e => { e.preventDefault(); drop.classList.remove("over"); await takeFiles(f, await filesFromDrop(e.dataTransfer)); });
    drop.addEventListener("click", e => { const b = e.target.closest("[data-pick]"); if (b) f.querySelector(b.dataset.pick === "dir" ? "#upDir" : "#upFiles").click(); });
    f.querySelector("#upFiles").addEventListener("change", e => takeFiles(f, [...e.target.files].map(x => ({ file: x, path: x.name }))));
    f.querySelector("#upDir").addEventListener("change", e => takeFiles(f, [...e.target.files].map(x => ({ file: x, path: x.webkitRelativePath || x.name }))));
  }
  async function filesFromDrop(dt) {
    const out = [], walk = async (entry, prefix) => {
      if (entry.isFile) { const f = await new Promise((ok, no) => entry.file(ok, no)); out.push({ file: f, path: prefix + f.name }); }
      else if (entry.isDirectory) { const reader = entry.createReader(); let batch; do { batch = await new Promise((ok, no) => reader.readEntries(ok, no)); for (const en of batch) await walk(en, prefix + entry.name + "/"); } while (batch.length); }
    };
    const entries = [...dt.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) { for (const en of entries) await walk(en, ""); return out; }
    return [...dt.files].map(f => ({ file: f, path: f.name }));
  }
  async function takeFiles(form, list) {
    const sum = form.querySelector("#upSum");
    try {
      let files = [];
      for (const { file, path } of list) {
        if (/\.zip$/i.test(file.name)) files.push(...await unzip(file));
        else files.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
      }
      files = files.filter(f => !/(^|\/)(\.|__MACOSX\/)/.test(f.path));
      const tops = new Set(files.map(f => f.path.includes("/") ? f.path.split("/")[0] : ""));
      if (tops.size === 1 && !tops.has("")) { const t = [...tops][0] + "/"; files.forEach(f => f.path = f.path.slice(t.length)); }
      const bytes = files.reduce((s, f) => s + f.data.length, 0);
      if (bytes > 28 * 1048576) throw new Error("Zu groß – höchstens 28 MB pro Prototyp.");
      const htmls = files.map(f => f.path).filter(p => /\.html?$/i.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
      if (!htmls.length) throw new Error("Keine HTML-Datei gefunden.");
      const entry = htmls.find(p => /(^|\/)index\.html?$/i.test(p)) || htmls[0];
      pending = { files, entry };
      sum.hidden = false;
      sum.innerHTML = `<div class="upsum"><b>${files.length} Datei${files.length === 1 ? "" : "en"}</b><span>${C.size(bytes)}</span>
        <label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-left:auto">Startseite <select id="upEntry">${htmls.map(h => `<option ${h === entry ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label></div>`;
      sum.querySelector("#upEntry").addEventListener("change", e => pending.entry = e.target.value);
      if (!form.title.value) form.title.value = (list[0]?.file.name || "Prototyp").replace(/\.(zip|html?)$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase());
    } catch (err) { pending = null; sum.hidden = true; toast(err.message); }
  }

  /* ---------- Aktionen ---------- */
  const groupVersions = gi => project.prototypes[gi];
  // Termin vereinbaren: freie Zeit aus Ihrer Verfügbarkeit wählen → Einladung mit Video-Link und Kalenderdatei
  async function scheduleDialog(cid, preset = {}) {
    const cl = clients.find(x => x.id === cid) || current;
    let data = await api("/slots?type=" + (preset.type || (cl?.stage === "mandant" ? "abstimmung" : "erstgespraech")));
    const projs = cl?.stage === "mandant" ? await api(`/clients/${cid}/projects`) : [];
    let picked = null;
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card sched"><div class="chead"><div><h2 style="font-size:22px">Termin vereinbaren</h2><p>mit ${esc(cl?.name || "")} · ${esc(cl?.company || "")}</p></div><button type="button" class="x" data-close>✕</button></div>
      <div class="form-grid">
        <label>Terminart<select name="type">${data.types.map(t => `<option value="${t.key}" data-min="${t.minutes}">${esc(t.label)} · ${t.minutes} Min.</option>`).join("")}</select></label>
        <label>Gesprächsart<select name="channel"><option>Video</option><option>Telefon</option><option>Vor Ort</option></select></label>
        <div class="span2"><b style="font-size:13px;color:var(--ink2)">Freie Zeiten</b><div class="rdays" id="sDays"></div>
          <label class="check" style="margin-top:6px"><input type="checkbox" name="custom"> Andere Zeit eintragen</label>
          <input type="datetime-local" name="start" hidden></div>
        <label class="span2">Titel<input name="title" placeholder="z. B. Erstgespräch Praxissoftware"></label>
        ${projs.length ? `<label class="span2">Projekt<select name="project_id"><option value="">– kein bestimmtes –</option>${projs.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}</select></label>` : ""}
        <label class="span2">Nachricht in der Einladung (optional)<textarea name="note" rows="2" placeholder="z. B. Bitte halten Sie Ihre aktuellen Abläufe bereit."></textarea></label>
        <label class="check span2"><input type="checkbox" name="notify" checked> Einladung per E-Mail mit Video-Link und Kalendereintrag senden</label>
      </div><p class="err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">Termin festlegen</button></div></form>`;
    document.body.appendChild(m);
    const f = $("form", m);
    if (preset.type) f.type.value = preset.type; else f.type.value = cl?.stage === "mandant" ? "abstimmung" : "erstgespraech";
    if (f.project_id && (preset.project_id || (onProjectPage() && project))) f.project_id.value = preset.project_id || project.id;
    if (preset.start) { f.custom.checked = true; f.start.hidden = false; f.start.value = localDT(preset.start); }
    const render = () => {
      const days = Object.keys(data.days).sort().slice(0, 14);
      $("#sDays", m).innerHTML = days.length ? days.map(d => { const first = data.days[d][0].start;
        return `<div class="rday"><div class="rday__h"><b>${C.fmt(first, { weekday: "short" })}</b><span>${C.fmt(first, { day: "numeric", month: "short" })}</span></div><div class="rday__t">${data.days[d].map(s => `<button type="button" class="rslot ${picked === s.start ? "on" : ""}" data-start="${s.start}">${s.t}</button>`).join("")}</div></div>`; }).join("")
        : `<p class="hint" style="margin:6px 0">In den nächsten Wochen ist nichts frei – tragen Sie eine andere Zeit ein.</p>`;
    };
    render();
    f.type.addEventListener("change", async () => { data = await api("/slots?type=" + f.type.value); picked = null; render(); });
    f.custom.addEventListener("change", () => { f.start.hidden = !f.custom.checked; });
    m.addEventListener("click", e => {
      if (e.target === m || e.target.closest("[data-close]")) return m.remove();
      const b = e.target.closest(".rslot"); if (b) { picked = b.dataset.start; f.custom.checked = false; f.start.hidden = true; render(); }
    });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const err = $(".err", f);
      const start = f.custom.checked && f.start.value ? new Date(f.start.value).toISOString() : picked;
      if (!start) { err.textContent = "Bitte eine freie Zeit wählen oder eine andere Zeit eintragen."; err.hidden = false; return; }
      try {
        const r = await api(`/clients/${cid}/schedule`, { method: "POST", body: { type: f.type.value, start, minutes: +f.type.selectedOptions[0].dataset.min, title: f.title.value, channel: f.channel.value, project_id: f.project_id?.value || null, note: f.note.value, notify: f.notify.checked, force: f.custom.checked } });
        m.remove(); toast(f.notify.checked ? (r.mailed ? "Termin festgelegt – Einladung mit Video-Link ist raus." : "Termin festgelegt – Einladung liegt im Postausgang.") : "Termin festgelegt.");
        await refreshAfter(cid); window.BOARD?.refresh?.();
      } catch (er) { err.textContent = er.message; err.hidden = false; }
    });
  }
  async function refreshAfter(cid) {
    if (location.hash.startsWith("#termine")) return window.CAL?.reload();
    if (onProjectPage() && project) return openProjectPage(project.id, true);
    if (location.hash.startsWith("#anfragen")) return window.loadVertrieb();
    await loadClients(); if (current?.id === cid && !$("#clientDetail").hidden) { current = clients.find(x => x.id === cid); openClient(cid); }
  }
  // Aus dem Kalender: Termin bearbeiten / neuen Termin (erst Kunde wählen, dann Zeit + Einladung)
  async function editAppt(id, cid) {
    if (!clients.some(c => c.id === cid)) clients = await api("/clients");
    current = clients.find(c => c.id === cid); if (!current) return toast("Kunde nicht gefunden");
    const list = await api(`/clients/${cid}/appointments`); apptDialog(list.find(a => a.id === id));
  }
  async function newAppt(startIso) {
    clients = await api("/clients");
    const pick = [...clients.filter(c => c.stage === "mandant"), ...clients.filter(c => c.stage === "anfrage" || c.stage === "interessent")];
    const when = startIso ? new Date(startIso).toLocaleString("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) + " Uhr" : "";
    dialog(`<h2 class="span2">Neuer Termin${when ? ` · ${esc(when)}` : ""}</h2>
      <div class="field span2"><span>Mit wem?</span>${DD.html("na-client", [...pick.filter(c => c.stage === "mandant").map(c => ({ v: c.id, l: c.company })), { sep: "Interessenten & Anfragen" }, ...pick.filter(c => c.stage !== "mandant").map(c => ({ v: c.id, l: c.company }))], "", { field: "client", placeholder: "Kunde oder Interessent wählen …" })}</div>
      <p class="hint span2" style="margin:0">Im nächsten Schritt wählen Sie Terminart und Projekt – der Kunde bekommt eine Einladung mit Video-Link und Kalendereintrag.</p>`,
      async f => { const cid = +f.client.value; if (!cid) throw new Error("Bitte auswählen, mit wem der Termin ist."); current = clients.find(c => c.id === cid); setTimeout(() => scheduleDialog(cid, startIso ? { start: startIso } : {}), 0); });
    const b = document.querySelector(".modal:last-of-type [type=submit]"); if (b) b.textContent = "Weiter";
  }
  window.KUNDEN = { schedule: scheduleDialog, openProjectPage, refreshAfter, editAppt, newAppt };

  const actions = {
    schedule: () => scheduleDialog(current.id),
    async makeClient() {
      const send = await UI.choice(`${current.name} bekommt Zugang zum Kundenportal (Chat, Projekte, Termine, Dokumente).`, [{ label: "Nur Link anzeigen", value: false }, { label: `Einladung an ${current.email} senden`, value: true, primary: true }], { title: `${current.company} zum Kunden machen` });
      if (send === null) return;
      const r = await api(`/clients/${current.id}/stage`, { method: "PATCH", body: { stage: "mandant", sendInvite: send } });
      tab = "ueberblick"; await loadClients(); current = clients.find(x => x.id === r.client.id);
      if (location.hash === `#kunden/${r.client.id}` || location.hash.startsWith(`#kunden/${r.client.id}/`)) await openClient(r.client.id); else location.hash = `#kunden/${r.client.id}`;
      window.updateBadges?.();
      if (r.inviteLink) UI.link("Willkommen als Kunde", send ? (r.mailed ? "Die Einladung ist verschickt. Zur Sicherheit hier der Link:" : "Die Einladung liegt im Postausgang (E-Mail noch nicht eingerichtet). Schicken Sie den Link bis dahin selbst:") : "Schicken Sie diesen Link (14 Tage gültig):", r.inviteLink);
    },
    async archive() { if (!(await UI.confirm("Der Kontakt verschwindet aus der Liste, bleibt aber unter „Archiv“ erhalten.", { title: `${current.company} archivieren?`, ok: "Archivieren" }))) return; await api(`/clients/${current.id}/stage`, { method: "PATCH", body: { stage: "archiv" } }); toast("Archiviert"); location.hash = current.stage === "mandant" ? "#kunden" : "#anfragen"; },
    // Kontakt ohne Auftrag samt Konto, Terminen, Fragebögen, Entwürfen und Anfrage-Projekten entfernen
    async loeschen() {
      if (!(await UI.confirm(`Gelöscht werden das Konto, alle Termine, Fragebögen, Entwürfe, Nachrichten und Projekte von ${current.company}. Das lässt sich nicht rückgängig machen.

Danach kann sich die Person mit derselben E-Mail-Adresse ganz neu anmelden.`, { title: `${current.company} endgültig löschen?`, ok: "Endgültig löschen", danger: true }))) return;
      try { await api(`/clients/${current.id}/endgueltig`, { method: "DELETE", body: {} }); } catch (e) { return toast(e.message); }
      toast("Kontakt gelöscht"); current = null; await loadClients(); location.hash = "#anfragen"; window.updateBadges?.();
    },
    async unarchive() { await api(`/clients/${current.id}/stage`, { method: "PATCH", body: { stage: "interessent" } }); await loadClients(); openClient(current.id); },
    "tab:termine": () => showTab("termine"),
    newInvoice: () => window.FIN.editor({ kind: "rechnung", client_id: current.id }),
    newQuote: () => window.FIN.editor({ kind: "angebot", client_id: current.id }),
    newContract: () => window.SOFT.newContract(project && location.hash.startsWith("#projekte/") ? { client_id: project.client_id, project_id: project.id } : { client_id: current.id }),
    openInvoice: a => window.FIN.open(+a.dataset.id),
    async invite() {
      const send = await UI.choice(`Neuer Zugangslink für ${current.name}. Ein älterer Link wird ungültig.`, [{ label: "Nur Link anzeigen", value: false }, { label: `Per E-Mail an ${current.email}`, value: true, primary: true }], { title: "Zugangslink" }); if (send === null) return;
      const r = await api(`/clients/${current.id}/invite`, { method: "POST", body: { send } });
      showDone(r.inviteLink, send ? (r.mailed === true ? "Der Link wurde per E-Mail verschickt." : "Die E-Mail liegt im Postausgang (Versand noch nicht eingerichtet) – schicken Sie den Link bei Bedarf selbst.") : "Schicken Sie dem Kunden diesen Link. Er ist 14 Tage gültig; ein älterer Link wird damit ungültig.");
      await loadClients(); current = clients.find(c => c.id === current.id);
    },
    async toggle() {
      if (current.active && !(await UI.confirm("Der Kunde wird sofort abgemeldet.", { title: `Zugang für ${current.company} sperren?`, ok: "Sperren", danger: true }))) return;
      await api(`/clients/${current.id}`, { method: "PATCH", body: { active: !current.active } });
      await loadClients(); await openClient(current.id); toast(current.active ? "Zugang aktiviert" : "Zugang gesperrt");
    },
    newProject: () => window.BOARD.newProject(current.id),
    startOrder: () => window.BOARD.startOrder(current),
    editProject: () => editProjectDialog(),
    assign: () => window.BOARD.assign(project, () => openProjectPage(project.id, true)),
    setPhase: a => a.dataset.ph === project.phase ? null : setProject({ phase: a.dataset.ph, notify: true }, `Phase „${a.dataset.ph}“ – der Kunde sieht es im Portal.`),
    pause: () => setProject({ status: "pausiert", notify: false }, "Projekt pausiert"),
    resume: async () => { if (project.status === "anfrage" && !(await UI.confirm("Das Projekt gilt dann als beauftragt und steht unter „Alle aktiven“. Normalerweise passiert das von selbst, wenn der Kunde das Angebot annimmt.", { title: "Ohne Angebot als Auftrag übernehmen?", ok: "Als Auftrag übernehmen" }))) return; return setProject({ status: "aktiv", notify: false }, "Projekt wieder aufgenommen"); },
    zurAnfrage: () => setProject({ status: "anfrage", notify: false }, "Wieder als Anfrage geführt"),
    finish: () => setProject({ status: "abgeschlossen", notify: true }, "Projekt abgeschlossen"),
    async deleteProject() { if (!(await UI.confirm("Zahlungsplan und Verlauf werden entfernt; Termine, Dokumente und Prototypen bleiben beim Kunden erhalten.", { title: `Projekt „${project.title}“ löschen?`, ok: "Löschen", danger: true }))) return; await api(`/projects/${project.id}`, { method: "DELETE", body: {} }); project = null; toast("Projekt gelöscht"); location.hash = "#projekte"; },
    addPay: a => (a.closest("form") || document).querySelector("#payRows").insertAdjacentHTML("beforeend", payRow({})),
    delPay: a => a.closest(".payrow").remove(),
    uploadProto: () => uploadDialog(null),
    newVersion: a => uploadDialog(groupVersions(+a.dataset.g)),
    openProto: a => { const g = groupVersions(+a.dataset.g); window.RSViewer.open(C.protoData(g[0]), { versions: g.map(C.protoData), showList: true }); },
    async copyProto(a) { await navigator.clipboard?.writeText(location.origin + a.dataset.url); toast("Link kopiert – jeder mit diesem Link kann den Prototyp ansehen."); },
    async toggleProto(a) { await api(`/clients/${current.id}/prototypes/${a.dataset.id}`, { method: "PATCH", body: { active: a.dataset.on !== "1" } }); refreshCurrent(); },
    async deleteProto(a) { if (!(await UI.confirm("Dateien und Anmerkungen werden entfernt.", { title: "Version endgültig löschen?", ok: "Löschen", danger: true }))) return; await api(`/clients/${current.id}/prototypes/${a.dataset.id}`, { method: "DELETE", body: {} }); refreshCurrent(); toast("Gelöscht"); },
    newAppt: () => apptDialog(),
    async editAppt(a) { const list = project?.appointments || loadAppointments.list || await api(`/clients/${current.id}/appointments`); apptDialog(list.find(x => x.id === +a.dataset.id)); },
    importBooking(a) { const b = JSON.parse(a.dataset.b); apptDialog({ title: b.type === "erstgespraech" ? "Erstgespräch" : b.type === "produktdemo" ? "Produktdemo" : b.type === "workshop" ? "Projekt-Workshop" : b.type, start: b.start, minutes: b.minutes, kind: b.type === "erstgespraech" ? "Erstgespräch" : "Abstimmung", summary: b.message ? `Anliegen laut Buchung:\n${b.message}` : "", booking_id: b.id }); },
    newDoc: () => docDialog(),
    invoicePay(a) {   // Rechnung zu einer Zahlungsposition im Finanzbereich vorbereiten
      try { sessionStorage.setItem("rs-new-invoice", JSON.stringify({ client_id: current.id, project_id: project.id, prefillPayment: +a.dataset.id, title: project.title })); } catch {}
      a.closest(".modal")?.remove(); location.hash = "#finanzen/rechnungen";
    },
    billing: () => window.FIN.addrDialog(current.id, () => toast("Gespeichert")),
    async acceptReq(a) {
      const taken = a.classList.contains("reqslot--taken");
      if (taken && !(await UI.confirm("Dieser Zeitpunkt ist inzwischen belegt.", { title: "Trotzdem bestätigen?" }))) return;
      
      a.disabled = true;
      try { await api(`/requests/${a.dataset.rid}/accept`, { method: "POST", body: { start: a.dataset.start, force: taken } }); toast("Termin bestätigt – der Kunde wird informiert."); loadClients(); showTab("termine"); }
      catch (err) { toast(err.message); a.disabled = false; }
    },
    otherTime(a) {
      dialog(`<h2 class="span2">Anderen Termin bestätigen</h2>
        <p class="hint span2" style="margin:0">Der Kunde bekommt diesen Termin als bestätigt – passt er nicht, kann er im Chat antworten.</p>
        <label>Datum &amp; Uhrzeit<input type="datetime-local" name="start" required value="${localDT(new Date(Math.ceil(Date.now() / 3600000 + 24) * 3600000).toISOString())}"></label>
        <label>Dauer (Min.)<input type="number" name="minutes" min="5" max="600" value="30"></label>
        ${'<label class="check span2 notify"><input type="checkbox" name="notify" checked> Kunden per E-Mail informieren</label>'}`,
        async f => { await api(`/requests/${a.dataset.rid}/accept`, { method: "POST", body: { start: new Date(f.start.value).toISOString(), minutes: +f.minutes.value, force: true, notify: f.notify.checked } }); toast("Termin bestätigt"); loadClients(); showTab("termine"); });
    },
    declineReq(a) {
      dialog(`<h2 class="span2">Anfrage ablehnen</h2>
        <label class="span2">Antwort an den Kunden (erscheint im Chat)<textarea name="answer" rows="4">Leider passt keiner der Wunschtermine. Wie wäre es stattdessen mit </textarea></label>`,
        async f => { await api(`/requests/${a.dataset.rid}/decline`, { method: "POST", body: { answer: f.answer.value } }); toast("Abgelehnt – Antwort steht im Chat."); loadClients(); showTab("termine"); });
    },
    async deleteDoc(a) { if (!(await UI.confirm("Der Kunde sieht es dann nicht mehr.", { title: "Dokument löschen?", ok: "Löschen", danger: true }))) return; await api(`/documents/${a.dataset.id}`, { method: "DELETE", body: {} }); refreshCurrent(); toast("Gelöscht"); },
    async toggleAnn(a, e) { e.stopPropagation(); await api(`/annotations/${a.dataset.id}`, { method: "PATCH", body: { status: a.dataset.s === "erledigt" ? "offen" : "erledigt" } }); if (onProjectPage()) { toast("Erledigt"); return openProjectPage(project.id, true); } loadAnnotations(); },
    jump(a, e) {
      if (e.target.closest("[data-act=toggleAnn]")) return;
      const n = (loadAnnotations.all || []).find(x => x.id === +a.dataset.id); if (!n) return;
      window.RSViewer.open({ id: n.prototype_id, title: n.proto_title, url: n.proto_url + n.proto_entry, base: n.proto_url, entry: n.proto_entry, version: n.proto_version }, { focus: n });
    },
  };

  /* ---------- Neuer Kunde / neue Anfrage ---------- */
  const modal = $("#clientModal");
  const openNew = stage => {
    const f = $("#clientForm"); f.hidden = false; $("#clientDone").hidden = true; $("#clientErr").hidden = true; f.reset();
    f.querySelector(`[name=stage][value=${stage}]`).checked = true; $("#cfInvite").hidden = stage !== "mandant";
    $("h2", f).textContent = stage === "mandant" ? "Neuer Kunde" : "Neue Anfrage"; modal.hidden = false; f.company.focus();
  };
  $("#clientForm").addEventListener("change", e => { if (e.target.name === "stage") $("#cfInvite").hidden = e.target.value !== "mandant"; });
  $("#newClient").addEventListener("click", () => openNew("mandant"));
  $("#newLead")?.addEventListener("click", () => openNew("anfrage"));
  modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-close]")) modal.hidden = true; });
  $("#clientForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target, stage = f.stage.value;
    try {
      const r = await api("/clients", { method: "POST", body: { company: f.company.value, name: f.name.value, email: f.email.value, phone: f.phone.value, stage, sendInvite: f.sendInvite.checked } });
      tab = "ueberblick"; await loadClients();
      if (stage === "anfrage") { modal.hidden = true; toast("Anfrage angelegt"); location.hash = `#kunden/${r.client.id}`; return; }
      location.hash = `#kunden/${r.client.id}`;
      showDone(r.inviteLink, f.sendInvite.checked ? (r.mailed === true ? `Die Einladung wurde an ${r.client.email} verschickt.` : "Die Einladung liegt im Postausgang (E-Mail-Versand noch nicht eingerichtet). Schicken Sie dem Kunden den Link bis dahin selbst.") : "Schicken Sie dem Kunden diesen Link. Er ist 14 Tage gültig.");
    } catch (err) { $("#clientErr").textContent = err.message; $("#clientErr").hidden = false; }
  });
  function showDone(link, info) { modal.hidden = false; $("#clientForm").hidden = true; $("#clientDone").hidden = false; $("#clientDoneInfo").textContent = info; $("#clientDoneLink").value = link; }
  $("#clientDoneCopy").addEventListener("click", () => { navigator.clipboard?.writeText($("#clientDoneLink").value); toast("Link kopiert"); });

  /* ---------- ZIP im Browser entpacken (ohne Zusatzbibliothek) ---------- */
  async function unzip(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error(`${file.name} ist keine gültige ZIP-Datei.`);
    const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder(), out = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP-Datei beschädigt.");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith("/")) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = buf.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else throw new Error(`Komprimierung in ${name} wird nicht unterstützt.`);
      out.push({ path: name, data });
    }
    return out;
  }
  function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
})();
