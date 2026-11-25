/* Board: Cockpit, Posteingang, Projekt-Board, Team (nutzt $, $$, esc, api, toast, fmt, ME aus admin.js) */
(() => {
  const C = window.RSChat;
  const money = c => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format((c || 0) / 100);
  const initials = n => String(n || "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const when = iso => C.fmt(iso, { weekday: "short", day: "numeric", month: "short" }) + " · " + C.fmt(iso, { hour: "2-digit", minute: "2-digit" }) + " Uhr";
  const ago = s => { const m = Math.round((Date.now() - C.toDate(s).getTime()) / 60000); return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : C.fmt(s, { day: "numeric", month: "short" }); };
  const ICON = Object.fromEntries(["chat", "termin", "anmerkung", "buchung", "lead", "summary", "overdue"].map(k => [k, ICO(k)]));

  /* ---------- Heute: je Vorgang eine Karte ---------- */
  // Ein Vorgang = ein Vorhaben eines Kunden. Er kommt genau einmal vor, zeigt seinen Weg (Termin … Prototyp) und den einen nächsten Schritt.
  // Den Stand rechnet der Server aus (vorgang in /projects); hier wird nur gezeichnet.
  const HW_SEITE = { anforderungen: ["anforderungen", "Anforderungen klären"], analyse: ["varianten", "Varianten entscheiden"], module: ["module", "Module festlegen"], detail: ["modell", "3D-Modell ausarbeiten"], beschaffung: ["einkauf", "Stückliste und Bauanleitung"], pruefung: ["pruefung", "Konzept-Dokument erstellen"] };
  const WEG = { hardware: ["Termin", "Gespräch", "Angebot", "Auftrag", "Konzept", "Prototyp"], software: ["Termin", "Gespräch", "Angebot", "Auftrag", "Umsetzung", "Abnahme"] };
  let heuteDaten = { karten: [] };
  async function heute() {
    const box = $("#ckHeute"); if (!box) return;
    const tag0 = new Date(); tag0.setHours(0, 0, 0, 0); const jetzt = Date.now();
    const [projekte, hw, clients, verein] = await Promise.all([api("/projects"), api("/hardware/projekte").catch(() => []), ME.owner ? api("/clients").catch(() => []) : [], ME.owner ? api("/vereinbarungen").catch(() => []) : []]);
    const hwNach = new Map((hw || []).map(h => [h.id, h]));
    const tagZeit = iso => { const d = new Date(iso), heuteTag = d.toDateString() === new Date().toDateString();
      return `${heuteTag ? "heute" : "am " + C.fmt(iso, { weekday: "short", day: "numeric", month: "short" })} um ${C.fmt(iso, { hour: "2-digit", minute: "2-digit" })}`; };
    const karten = [];
    const bauen = (p, v, c) => {
      // p: Projekt oder null (Kontakt ohne Projekt); v: Vorgang; c: { id, company, name }
      const bereich = p?.bereich === "hardware" ? "hardware" : "software", h = p ? hwNach.get(p.id) : null;
      let schritt = v.schritt, wer = v.wer, stand = "", naechstes = "", haupt = "", neben = [], zusatz = "";
      const k = { cid: c.id, pid: p?.id || "", ptitle: p?.title || "", bereich: p?.bereich || "", firma: c.company };
      const d = extra => Object.entries({ ...k, ...extra }).map(([n, w]) => `data-${n}="${esc(String(w ?? ""))}"`).join(" ");
      const knopf = (act, text, extra = {}) => `<button class="btn btn--sm btn--grad" data-va="${act}" ${d(extra)}>${text}</button>`;
      const klein = (act, text, extra = {}) => `<button class="vneben" data-va="${act}" ${d(extra)}>${text}</button>`;
      const href = p ? (h ? `#hardware/projekt/${p.id}` : `#projekte/${p.id}`) : `#kunden/${c.id}`;
      const video = v.termin?.video_url && new Date(v.termin.start).toDateString() === new Date().toDateString() ? `<a class="vneben" href="${esc(v.termin.video_url)}" target="_blank" rel="noopener">Video beitreten</a>` : "";
      if (schritt === 4) {            // Auftrag läuft
        if (h) { const ph = (h.phasen || []).find(x => x.status !== "fertig"), seite = ph ? HW_SEITE[ph.id] : null, nr = ph ? (h.phasen || []).indexOf(ph) + 1 : 0;
          if (seite) { stand = "Auftrag erteilt, Konzept läuft"; naechstes = `${seite[1]} (Schritt ${nr} von ${h.phasen.length})`; haupt = `<a class="btn btn--sm btn--grad" href="#hardware/projekt/${p.id}/${seite[0]}">Weiterarbeiten</a>`; }
          else { schritt = 5; stand = "Konzept fertig"; naechstes = "Prototyp kalkulieren und anbieten"; haupt = `<a class="btn btn--sm btn--grad" href="#hardware/projekt/${p.id}/pruefung">Zur Kalkulation</a>`; }
        } else { if (["Launch", "Betreuung"].includes(p.phase)) schritt = 5; stand = `Auftrag erteilt · Phase ${esc(p.phase)}`; naechstes = "Am Projekt weiterarbeiten"; haupt = `<a class="btn btn--sm btn--grad" href="${href}">Weiterarbeiten</a>`; }
        if (v.termin) stand += ` · Termin ${tagZeit(v.termin.start)}`;
        neben = [video];
        // Wo war ich zuletzt? Letzter Stand und Notiz fürs nächste Mal; Hinweis, wenn zugesagte tägliche Updates fehlen
        const notiz = h ? h.naechstesMal : p.notiz, letzt = h ? h.aktualisiert : p.stand?.at;
        const tage = letzt ? Math.floor((jetzt - C.toDate(letzt).getTime()) / 864e5) : null;
        zusatz = [letzt ? `<span>Zuletzt bearbeitet ${tage === 0 ? "heute" : tage === 1 ? "gestern" : `vor ${tage} Tagen`}${p.stand ? ` · Stand V${p.stand.version}` : ""}${p.stand?.text ? " · " + esc(p.stand.text.slice(0, 160)) : ""}</span>` : "",
          (p.vereinbarungen || []).length ? `<span class="vverein"><b>Vereinbarung:</b> ${p.vereinbarungen.map(x => esc(x.titel + (x.prozent ? ` ${String(x.prozent).replace(".", ",")} %` : "") + (x.text ? " – " + x.text.slice(0, 120) : ""))).join(" · ")}</span>` : "",
          notiz ? `<span class="vnotiz"><b>Fürs nächste Mal:</b> ${esc(notiz.slice(0, 220))}</span>` : "",
          p.taeglich && (tage === null || tage >= 2) ? `<span class="vwarn">Tägliche Updates zugesagt – ${tage === null ? "noch kein Stand hochgeladen" : `seit ${tage} Tagen kein neuer Stand`}</span>` : ""].filter(Boolean).join("");
      } else if (wer === "kunde") {   // Angebot liegt beim Kunden
        const tage = Math.max(0, Math.floor((jetzt - new Date((v.angebot?.issue_date || "") + "T00:00:00").getTime()) / 864e5));
        stand = `Angebot ${esc(v.angebot?.number || "")} ${tage ? `seit ${tage} ${tage === 1 ? "Tag" : "Tagen"}` : "heute"} verschickt · ${money(v.angebot?.gross)}`; naechstes = "Der Kunde muss unterschreiben";
        neben = [`<a class="vneben" href="#finanzen/angebote">Angebot ansehen</a>`, klein("won", "Zusage erhalten", { oid: v.angebot?.id, name: c.name })];
      } else if (wer === "geplant") { // Termin steht
        const heuteT = new Date(v.termin.start).toDateString() === new Date().toDateString();
        stand = `Gespräch ${tagZeit(v.termin.start)}`; naechstes = heuteT ? "Gespräch führen" : "Nichts zu tun bis zum Termin";
        if (heuteT) { wer = "ich"; haupt = knopf("held", "Gespräch geführt", { aid: v.termin.id }); }
        neben = [video, heuteT ? "" : klein("held", "Schon geführt", { aid: v.termin.id }), klein("move", "Verschieben", { aid: v.termin.id, start: v.termin.start })];
      } else if (schritt === 2) {     // Gespräch war, Angebot fehlt
        stand = `Gespräch ${tagZeit(v.letztes.start)} geführt`; naechstes = bereich === "hardware" ? "Angebot für das Konzept schreiben" : "Angebot schreiben";
        haupt = knopf("offer", v.entwurf ? "Angebot fertigstellen" : "Angebot erstellen", { notiz: v.letztes.notiz, entwurf: v.entwurf ? 1 : "" });
        // Vor dem Angebot ist oft noch etwas zu klären: ein weiterer Termin, oder erst im Projekt vorarbeiten und kalkulieren
        neben = [klein("notes", v.letztes.notiz ? "Notizen bearbeiten" : "Notizen eintragen", { aid: v.letztes.id }), klein("schedule", "Weiterer Termin"), p ? `<a class="vneben" href="${href}">Vorarbeiten</a>` : ""];
      } else {                        // noch kein Termin
        stand = v.buchung ? `Wunschtermin ${tagZeit(v.buchung.start)} wartet auf Bestätigung` : "Noch kein Termin"; naechstes = v.buchung ? "Termin bestätigen" : "Erstgespräch vereinbaren";
        haupt = v.buchung ? knopf("confirm", "Termin bestätigen", { bid: v.buchung.id }) : knopf("schedule", "Termin vereinbaren");
        neben = [klein("held", "Gespräch schon geführt"), klein("offer", "Angebot erstellen")];
      }
      const weg = WEG[bereich];
      const html = `<div class="vkarte"><div class="vkarte__kopf"><a href="${href}"><b>${esc(p?.title || c.company)}</b> ${p ? bereichTag(p) : ""}</a><p>${esc(c.company)}${c.name && c.name !== c.company ? " · " + esc(c.name) : ""} · ${stand}</p></div>
        <div class="vweg">${weg.map((w, i) => `<span class="${i < schritt ? "ok" : i === schritt ? "jetzt" : ""}">${w}</span>`).join("")}</div>
        ${zusatz ? `<div class="vzusatz">${zusatz}</div>` : ""}
        <div class="vkarte__fuss"><p>${wer === "ich" ? "Nächster Schritt: " : ""}${naechstes}</p><div>${neben.filter(Boolean).join("")}${p && !haupt.includes("Weiterarbeiten") && !neben.join("").includes("Vorarbeiten") ? `<a class="vneben" href="${href}">Projekt öffnen</a>` : ""}${haupt}</div></div></div>`;
      // Reihenfolge: erst Termine von heute, dann je näher am Geld, desto weiter oben
      const heuteT = v.termin && new Date(v.termin.start).toDateString() === new Date().toDateString();
      const mein = !p || p.status === "anfrage" || !(p.members || []).length || (p.members || []).some(u => u.id === ME.id);
      karten.push({ wer, mein, html, rang: (heuteT ? 100 : 0) + (schritt === 2 ? 30 : schritt === 0 ? 20 : schritt >= 4 ? 10 : 0), zeit: p?.last_activity || p?.updated_at || "" });
    };
    for (const p of projekte) if (p.vorgang) bauen(p, p.vorgang, p.client);
    // Kontakte im Vertrieb, zu denen es noch kein Projekt gibt
    const mitProjekt = new Set(projekte.filter(p => p.vorgang).map(p => p.client.id));
    for (const c of clients.filter(c => (c.stage === "anfrage" || c.stage === "interessent") && !mitProjekt.has(c.id))) {
      const v = { schritt: c.offer ? 2 : c.next ? 1 : c.last ? 2 : 0, wer: c.offer ? "kunde" : c.next ? "geplant" : "ich", termin: c.next || null, letztes: c.last || null, angebot: c.offer || null,
        buchung: c.lead?.booking?.status === "neu" && !c.next ? c.lead.booking : null, entwurf: !!c.offerDraft };
      bauen(null, v, c);
    }
    const sort = l => l.sort((a, b) => b.rang - a.rang || String(b.zeit).localeCompare(String(a.zeit)));
    // „Meine“ = Projekte, in denen ich im Team bin; für den Inhaber zusätzlich alles vor dem Auftrag und alles ohne Team
    const wahl = $("#vgWahl"), modus = localStorage.getItem("rs-vorgaenge") === "alle" ? "alle" : "meine";
    if (wahl) { wahl.hidden = !ME.owner; $$("button", wahl).forEach(b2 => b2.classList.toggle("on", b2.dataset.vg === modus)); }
    if (ME.owner && modus === "meine") for (let i = karten.length - 1; i >= 0; i--) if (!karten[i].mein) karten.splice(i, 1);
    const ich = sort(karten.filter(x => x.wer === "ich")), rest = sort(karten.filter(x => x.wer !== "ich"));
    const gruppe = (name, l) => l.length ? `<p class="vgruppe">${name} <em>${l.length}</em></p>${l.map(x => x.html).join("")}` : "";
    // Umsatzbeteiligungen, bei denen die Zahlen des Kunden fällig sind
    const zahlen = verein.filter(a => a.faellig_jetzt).map(a => `<div class="vrn vrn--faellig"><div><b>Umsatzzahlen abfragen: ${esc(a.company)}</b>
      <p>${esc(a.titel)}${a.prozent ? ` · ${String(a.prozent).replace(".", ",")} %` : ""}${a.project_title ? " · " + esc(a.project_title) : ""}</p><small>fällig seit ${C.fmt(a.faellig + "T12:00", { day: "numeric", month: "long", year: "numeric" })}</small></div>
      <button class="btn btn--sm btn--grad" data-vr="zahl" data-id="${a.id}" data-pz="${a.prozent || ""}">Zahlen eintragen</button></div>`).join("");
    box.innerHTML = (zahlen ? `<p class="vgruppe">Vereinbarungen <em>${verein.filter(a => a.faellig_jetzt).length}</em></p>${zahlen}` : "") + (karten.length ? gruppe("Jetzt bist du dran", ich) + gruppe("Wartet auf den Kunden oder auf einen Termin", rest)
      : zahlen ? "" : `<div class="allclear"><b>Alles erledigt.</b><span>Kein Vorgang wartet auf dich.</span></div>`);
  }
  // Aktionen der Karten: alles passiert hier, ohne in einen anderen Bereich zu springen
  $("#ckHeute")?.addEventListener("click", async e => {
    const b = e.target.closest("[data-va]"); if (!b) return;
    const x = b.dataset, cid = +x.cid, nachher = () => { heute().catch(() => {}); window.updateBadges?.(); };
    const notizen = async (aid, alt = "") => { const text = await UI.prompt(`Gesprächsnotizen · ${x.firma}`, { label: "Interne Stichpunkte aus dem Gespräch – der Kunde sieht sie nicht. Sie stehen beim Erstellen des Angebots daneben.", value: alt, multiline: true, ok: "Speichern" });
      if (text === null) return false; await api(`/appointments/${aid}`, { method: "PATCH", body: { notes_intern: text, notify: false } }); return true; };
    try {
      if (x.va === "offer") { if (x.entwurf) { location.hash = "#finanzen/angebote"; return toast("Der Entwurf steht bei den Angeboten – dort fertigstellen und versenden."); }
        return window.angebotErstellen?.({ client_id: cid, project_id: +x.pid || null, title: x.ptitle, bereich: x.bereich, notizen: x.notiz || "" }); }
      if (x.va === "notes") { const alt = await api(`/appointments/${x.aid}`); if (await notizen(x.aid, alt.notes_intern || "")) { toast("Notizen gespeichert"); nachher(); } return; }
      if (x.va === "held") {
        const jetzt = new Date(Date.now() - 60000).toISOString();
        const text = await UI.prompt(`Gespräch geführt · ${x.firma}`, { label: "Das Gespräch wird mit dem heutigen Datum als geführt eingetragen. Deine Stichpunkte dazu (optional, sieht der Kunde nicht):", value: "", multiline: true, ok: "Als geführt eintragen" });
        if (text === null) return;
        if (x.aid) await api(`/appointments/${x.aid}`, { method: "PATCH", body: { start: jetzt, notes_intern: text || undefined, notify: false } });
        else await api(`/clients/${cid}/appointments`, { method: "POST", body: { title: "Gespräch", start: jetzt, minutes: 30, kind: "Erstgespräch", notes_intern: text, project_id: +x.pid || null, notify: false } });
        toast("Eingetragen – als Nächstes das Angebot."); return nachher();
      }
      if (x.va === "move") { const d0 = new Date(x.start), p2 = n => String(n).padStart(2, "0");
        const neu = await UI.prompt(`Termin verschieben · ${x.firma}`, { label: "Neue Zeit. Heute geht auch. Der Kunde bekommt die Änderung per E-Mail.", type: "datetime-local", value: `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}T${p2(d0.getHours())}:${p2(d0.getMinutes())}`, ok: "Verschieben" });
        if (!neu) return; await api(`/appointments/${x.aid}`, { method: "PATCH", body: { start: new Date(neu).toISOString(), notify: true } }); toast("Termin verschoben"); return nachher(); }
      if (x.va === "confirm") { b.disabled = true; const r = await api(`/bookings/${x.bid}`, { method: "PATCH", body: { status: "bestaetigt", notify: true } }); toast(r.mailed ? "Bestätigt – Einladung ist raus." : "Bestätigt – Einladung liegt im Postausgang."); return nachher(); }
      if (x.va === "schedule") { await window.loadVertrieb?.(); return window.KUNDEN?.schedule(cid); }
      if (x.va === "won") { const name = await UI.prompt(`Zusage von ${x.firma}`, { label: "Wer hat zugesagt? Der Name steht in der Auftragsbestätigung. Der Kontakt wird Kunde, das Projekt ein Auftrag.", value: x.name || "", ok: "Als Auftrag übernehmen" });
        if (name === null) return; await api(`/contracts/quote/${x.oid}/accept`, { method: "POST", body: { name, via: "Zusage per Telefon oder E-Mail" } }); toast(`${x.firma} ist jetzt Kunde – das Projekt ist ein Auftrag.`); return nachher(); }
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  $("#vgWahl")?.addEventListener("click", e => { const b = e.target.closest("[data-vg]"); if (!b) return; localStorage.setItem("rs-vorgaenge", b.dataset.vg); heute().catch(() => {}); });
  const vorgaenge = () => heute().catch(err => { const b = $("#ckHeute"); if (b) b.innerHTML = `<div class="empty">Die Vorgänge ließen sich nicht laden (${esc(err.message)}).</div>`; });
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#arbeitsplatz")) vorgaenge(); });
  if (location.hash.startsWith("#arbeitsplatz")) setTimeout(vorgaenge, 600);

  /* ---------- Arbeitsstand auf der Projektseite ---------- */
  async function arbeitsstand(p) {
    const box = $("#pArbeit"); if (!box || !p || p.bereich === "hardware") return;
    const a = await api(`/projects/${p.id}/arbeitsstand`).catch(() => null); if (!a) return;
    const tag = iso => C.fmt(iso, { weekday: "short", day: "numeric", month: "short" });
    box.hidden = false;
    box.innerHTML = `<div class="chead" style="margin-bottom:10px"><h2 style="font-size:18px">Arbeitsstand</h2></div>
      ${a.letzter ? `<p class="astand__letzt"><b>Letzte Sitzung: ${tag(String(a.letzter.at).replace(" ", "T") + "Z")} · Stand V${a.letzter.version}</b>${a.letzter.zusammenfassung ? esc(a.letzter.zusammenfassung) : "Keine Beschreibung."}</p>`
        : `<p class="astand__letzt"><b>Noch kein Stand hochgeladen</b>Verknüpfe unten bei „Täglicher Stand“ den Projektordner oder Claude Code.</p>`}
      <label class="astand__notiz">Fürs nächste Mal<textarea rows="3" placeholder="Womit geht es weiter? Was ist noch offen?">${esc(a.notiz)}</textarea></label>
      <div class="astand__tage">${a.verlauf.map(d => `<span class="${d.versionen.length ? "ok" : ""}" title="${d.tag.split("-").reverse().join(".")}${d.versionen.length ? " · Stand V" + d.versionen.join(", V") : " · kein Update"}"><i>${d.tag.slice(8)}.</i>${d.versionen.length ? "V" + d.versionen[d.versionen.length - 1] : "–"}</span>`).join("")}</div>
      <label class="check" style="margin-top:10px"><input type="checkbox" ${a.taeglich ? "checked" : ""}> Tägliche Updates zugesagt <small class="muted">– „Mein Arbeitsplatz“ warnt, wenn zwei Tage kein Stand kommt</small></label>`;
    const speichern = body => api(`/projects/${p.id}/arbeitsstand`, { method: "PATCH", body }).then(() => toast("Gespeichert")).catch(x => toast(x.message));
    $("textarea", box).addEventListener("change", e => speichern({ notiz: e.target.value }));
    $("input[type=checkbox]", box).addEventListener("change", e => speichern({ taeglich: e.target.checked }));
  }

  /* ---------- Vereinbarungen: Karte auf der Projektseite, Liste unter „Verträge & Produkte“ ---------- */
  const RHYTHMUS = [[0, "gar nicht"], [1, "jeden Monat"], [3, "jedes Quartal"], [6, "jedes halbe Jahr"], [12, "einmal im Jahr"]];
  const geldV = c => (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const vZeile = (a, mitProjekt) => `<div class="vrn ${a.status !== "aktiv" ? "aus" : ""}"><div><b>${esc(a.titel)}${a.prozent ? ` · ${String(a.prozent).replace(".", ",")} %` : ""}</b>
      ${a.text ? `<p>${esc(a.text)}</p>` : ""}
      ${a.status === "aktiv" ? `<div class="vrn__er">Zahlen beim Kunden abfragen: <select data-vrh="${a.id}">${RHYTHMUS.map(([n, t]) => `<option value="${n}" ${+a.rhythmus === n ? "selected" : ""}>${t}</option>`).join("")}</select>
        ${a.rhythmus > 0 ? `nächstes Mal <input type="date" data-vdat="${a.id}" value="${esc(a.faellig || "")}">${a.faellig_jetzt ? ` <em>jetzt fällig</em>` : ""}` : ""}</div>` : ""}
      ${(a.meldungen || []).map(x => `<div class="vrn__m"><span>${esc(x.zeitraum)}</span><span>Umsatz ${geldV(x.umsatz)}</span><b>${a.prozent ? "dein Anteil " + geldV(x.anteil) : ""}</b></div>`).join("")}<small>${mitProjekt ? esc(a.company) + (a.project_title ? " · " + esc(a.project_title) : "") + " · " : ""}${a.angebot ? "aus Angebot " + esc(a.angebot) : "von Hand eingetragen"} · ${a.status === "aktiv" ? "gilt" : "beendet"}</small></div>
      <div class="vrn__k">${a.status === "aktiv" ? `<button class="btn btn--ghost btn--sm" data-vr="zahl" data-id="${a.id}" data-pz="${a.prozent || ""}">Zahlen eintragen</button>` : ""}
      <button class="ibtn" data-vr="${a.status === "aktiv" ? "ende" : "wieder"}" data-id="${a.id}">${a.status === "aktiv" ? "Beenden" : "Wieder aktiv"}</button></div></div>`;
  async function vereinbarungen(p) {
    const box = $("#pVerein"); if (!box || !p || !ME.owner) return;
    const l = await api(`/projects/${p.id}/vereinbarungen`).catch(() => []);
    box.hidden = false; box.dataset.pid = p.id;
    box.innerHTML = `<div class="chead" style="margin-bottom:8px"><div><h2 style="font-size:18px">Vereinbarungen</h2><p>Was über Preis und Leistung hinaus gilt, zum Beispiel eine Umsatzbeteiligung.</p></div><button class="btn btn--ghost btn--sm" data-vr="neu">Hinzufügen</button></div>
      ${l.length ? l.map(a => vZeile(a, false)).join("") : `<div class="empty">Keine besonderen Vereinbarungen.</div>`}`;
  }
  async function vereinbarungenAlle() {
    const box = $("#swVerein"); if (!box || !ME.owner) return;
    const l = await api("/vereinbarungen").catch(() => []);
    box.innerHTML = `<div class="card" style="margin-top:16px"><h2>Vereinbarungen</h2><p class="hint">Zusagen aus Angeboten, die über Preis und Leistung hinausgehen: Umsatzbeteiligungen, Nachlässe gegen Gegenleistung und Ähnliches.</p>
      ${l.length ? l.map(a => vZeile(a, true)).join("") : `<div class="empty">Noch keine Vereinbarungen. Sie entstehen, wenn ein Angebot mit „Besondere Vereinbarung“ angenommen wird, oder von Hand im Projekt.</div>`}</div>`;
  }
  // Nach einer Änderung dort neu zeichnen, wo die Vereinbarung gerade zu sehen ist
  const vNeu = el => { const k = el.closest("#pVerein"); if (k) return vereinbarungen({ id: +k.dataset.pid }); if (el.closest("#ckHeute")) return vorgaenge(); return vereinbarungenAlle(); };
  document.addEventListener("change", async e => {
    const rh = e.target.closest("[data-vrh]"), dat = e.target.closest("[data-vdat]"); if (!rh && !dat) return;
    try { await api(`/vereinbarungen/${(rh || dat).dataset[rh ? "vrh" : "vdat"]}`, { method: "PATCH", body: rh ? { rhythmus: +rh.value } : { faellig: dat.value } }); toast("Erinnerung gespeichert"); vNeu(e.target); }
    catch (x) { toast(x.message); }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-vr]"); if (!b) return;
    try {
      if (b.dataset.vr === "zahl") {
        const zeitraum = await UI.prompt("Zahlen eintragen", { label: "Für welchen Zeitraum? Zum Beispiel: 3. Quartal 2026", value: "", ok: "Weiter" }); if (!zeitraum) return;
        const umsatz = await UI.prompt(zeitraum, { label: "Netto-Umsatz des Kunden in diesem Zeitraum (in Euro)", value: "", placeholder: "z. B. 12500", ok: "Eintragen" }); if (umsatz === null) return;
        const r = await api(`/vereinbarungen/${b.dataset.id}/meldung`, { method: "POST", body: { zeitraum, umsatz } });
        toast(b.dataset.pz ? `Eingetragen. Dein Anteil: ${geldV(r.anteil)}` : "Eingetragen"); return vNeu(b); }
      if (b.dataset.vr === "neu") { const pid = b.closest("#pVerein").dataset.pid;
        const titel = await UI.prompt("Vereinbarung hinzufügen", { label: "Worum geht es? Zum Beispiel: Umsatzbeteiligung 5 %", value: "", ok: "Weiter" }); if (!titel) return;
        const text = await UI.prompt(titel, { label: "Was genau gilt? Zum Beispiel: 5 % des Nettoumsatzes ab Markteinführung, für 36 Monate.", value: "", multiline: true, ok: "Speichern" }); if (text === null) return;
        const pz = (titel.match(/(\d+(?:[.,]\d+)?)\s*%/) || [])[1] || "";
        await api(`/projects/${pid}/vereinbarungen`, { method: "POST", body: { titel, text, prozent: pz } }); toast("Vereinbarung gespeichert"); return vereinbarungen({ id: +pid }); }
      await api(`/vereinbarungen/${b.dataset.id}`, { method: "PATCH", body: { status: b.dataset.vr === "ende" ? "beendet" : "aktiv" } });
      vNeu(b);
    } catch (x) { toast(x.message); }
  });
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#software")) vereinbarungenAlle(); });
  if (location.hash.startsWith("#software")) setTimeout(vereinbarungenAlle, 700);

  /* ---------- Cockpit ---------- */
  async function cockpit() {
    const o = await api("/cockpit");
    const h = new Date().getHours();
    $("#hello").textContent = `${h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend"}, ${o.name}.`;
    $("#today").textContent = fmt(new Date().toISOString(), { weekday: "long", day: "numeric", month: "long" });
    const warten = (await api("/projects").catch(() => [])).filter(p => p.vorgang?.wer === "ich").length;
    const tiles = [
      { href: "#arbeitsplatz", k: "Vorgänge warten auf dich", v: warten, s: "weiter in „Mein Arbeitsplatz“", grad: true },
      { href: "#posteingang", k: "Wartet auf Antwort", v: o.unread + o.openRequests, nograd: true, s: `${o.unread} Nachricht${o.unread === 1 ? "" : "en"} · ${o.openRequests} Terminanfrage${o.openRequests === 1 ? "" : "n"}`, grad: true },
      { href: "#kunden", k: "Termine heute", v: o.today.length, s: o.today[0] ? `als Nächstes ${C.fmt(o.today[0].start, { hour: "2-digit", minute: "2-digit" })} Uhr` : `${o.week.length} in den nächsten 7 Tagen` },
      { href: "#posteingang", k: "Offene Anmerkungen", v: o.openNotes, s: "an Prototypen" },
    ];
    if (o.owner) tiles.push(
      { href: "#projekte", k: "Noch offen aus Aufträgen", v: money(o.receivables), s: `laut Zahlungsplan, brutto · ${money(o.invoiced)} davon schon berechnet${o.overdue.length ? ` · <b style="color:#ffb4c0">${o.overdue.length} überfällig</b>` : ""}`, dark: true },
      { href: "#projekte", k: "Als bezahlt markiert", v: money(o.paidMonth), s: `diesen Monat · ${money(o.paidYear)} im Jahr · von Hand bestätigt, kein Kontoabgleich` },
      { href: "#anfragen", k: "Neue Anfragen", v: o.newBookings + o.newLeads, s: `${o.newBookings} Website-Buchung${o.newBookings === 1 ? "" : "en"} · ${o.newLeads} Projektanfrage${o.newLeads === 1 ? "" : "n"}` });
    else tiles.push({ href: "#projekte", k: "Meine Projekte", v: o.projects.length, s: `bei ${o.clients} Kunde${o.clients === 1 ? "" : "n"}` });
    $("#ckTiles").innerHTML = tiles.map(t => `<a class="tile ${t.grad && !t.nograd ? "tile--grad" : ""} ${t.dark ? "tile--dark" : ""}" href="${t.href}"><small>${t.k}</small><b>${t.v}</b><span>${t.s}</span></a>`).join("");

    // Heute zu tun: Vorschläge der Automatik (mit Ein-Klick-Aktion) + Nachrichten/Anmerkungen der Kunden
    const [inbox, nudges] = await Promise.all([api("/inbox"), api("/automation/nudges").catch(() => [])]);
    cockpit.nudges = nudges;
    const todo = inbox.filter(i => i.kind !== "buchung" && i.kind !== "lead").slice(0, 8).map(i => ({ icon: ICON[i.kind], title: i.title, text: i.text, href: i.href, at: ago(i.at), count: i.count }));
    const SHOW = 6, more = nudges.length - SHOW;
    $("#ckTodo").innerHTML = (nudges.length ? `<p class="todo__sec">Vorschläge der Automatik <em>${nudges.length}</em></p>${nudges.slice(0, SHOW).map(nudgeRow).join("")}
        ${more > 0 ? `<div class="todo__rest" hidden>${nudges.slice(SHOW).map(nudgeRow).join("")}</div><button class="todo__more" type="button" data-more>Alle ${nudges.length} Vorschläge anzeigen <span>+${more}</span></button>` : ""}` : "")
      + (todo.length ? `<p class="todo__sec">Nachrichten &amp; Anmerkungen von Kunden</p>${todo.map(t => `<a class="todo__item" href="${t.href}"><span class="todo__ico">${t.icon}</span><div><b>${esc(t.title)}${t.count > 1 ? ` <em>${t.count}</em>` : ""}</b><p>${esc(t.text)}</p></div>${t.at ? `<span class="todo__at">${t.at}</span>` : ""}</a>`).join("")}` : "")
      || `<div class="allclear"><b>Alles erledigt.</b><span>Keine offenen Hinweise, Nachrichten oder Anmerkungen.</span></div>`;
    $("#ckTodo [data-more]")?.addEventListener("click", e => { const rest = $("#ckTodo .todo__rest"), open = rest.hidden;
      rest.hidden = !open; e.currentTarget.innerHTML = open ? "Weniger anzeigen" : `Alle ${nudges.length} Vorschläge anzeigen <span>+${more}</span>`; });

    const appts = [...o.today.map(a => ({ ...a, today: true })), ...o.week];
    $("#ckAppts").innerHTML = appts.length ? appts.map(a => `<a class="item ${a.today ? "item--today" : ""}" href="#kunden/${a.client_id}/termine" style="text-decoration:none">
      <div class="date"><span>${C.fmt(a.start, { month: "short" })}</span><b>${C.fmt(a.start, { day: "numeric" })}</b></div>
      <div><h3>${esc(a.title)}</h3><p>${C.fmt(a.start, { weekday: "short", hour: "2-digit", minute: "2-digit" })} Uhr · ${esc(a.company)}${a.project ? " · " + esc(a.project) : ""}</p></div>${a.today ? `<span class="pill pill--neu">heute</span>` : ""}</a>`).join("")
      : `<div class="empty">Keine Termine in den nächsten 7 Tagen.</div>`;

    const max = Math.max(1, ...o.phases.map(ph => o.projects.filter(p => p.phase === ph).length));
    $("#ckPhases").innerHTML = o.projects.length ? o.phases.map(ph => { const n = o.projects.filter(p => p.phase === ph).length;
      return `<a class="phasebar" href="#projekte"><span>${ph}</span><i><em style="width:${n / max * 100}%"></em></i><b>${n}</b></a>`; }).join("") : `<div class="empty">Noch keine aktiven Projekte.</div>`;
  }

  /* ---------- Vorschläge der Automatik ---------- */
  const NUDGE_ICON = { lead: "lead", buchung: "buchung", angebot: "angebot", mahnung: "overdue", summary: "summary", inactive: "projekt", freigabe: "zahlung", team: "kontakt", absage: "angebot", frist: "termin", aufgabe: "status", support: "chat", ausfall: "overdue", stand: "projekt" };
  const NUDGE_BTN = { schedule: "Termin vorschlagen", confirm: "Bestätigen & einladen", quoteReminder: "Kunden erinnern", openAppt: "Jetzt eintragen", open: "Projekt öffnen", release: "Freigeben & senden", assign: "Team zuweisen", openClient: "Kunde öffnen", openContract: "Vertrag öffnen", openTask: "Aufgabe öffnen", openTicket: "Anfrage öffnen", openOps: "Status ansehen" };
  const nudgeRow = n => `<div class="nudge nudge--${n.kind}" data-nid="${n.id}"><span class="todo__ico">${ICO(NUDGE_ICON[n.kind] || "status")}</span>
    <div class="nudge__m"><b>${esc(n.title)}</b><p>${esc(n.text)}</p>
      <div class="nudge__acts"><button class="ibtn ibtn--ok" data-na="go">${esc(n.action === "dunning" ? n.title.split(" fällig")[0] + " senden" : NUDGE_BTN[n.action] || "Öffnen")}</button>
        ${n.action === "release" ? `<button class="ibtn" data-na="view">Ansehen</button>` : ""}<button class="ibtn" data-na="snooze" title="3 Tage ausblenden">Später</button><button class="ibtn" data-na="done" title="Ohne Aktion als erledigt markieren">Erledigt</button></div></div></div>`;
  $("#ckTodo").addEventListener("click", async e => {
    const b = e.target.closest("[data-na]"); if (!b) return;
    const n = (cockpit.nudges || []).find(x => x.id === +b.closest("[data-nid]").dataset.nid); if (!n) return;
    const a = b.dataset.na, done = () => api(`/automation/nudges/${n.id}/done`, { method: "POST", body: {} });
    try {
      if (a === "done") { await done(); toast("Als erledigt markiert"); }
      else if (a === "snooze") { await api(`/automation/nudges/${n.id}/snooze`, { method: "POST", body: { days: 3 } }); toast("Für 3 Tage ausgeblendet"); }
      else if (n.action === "schedule") return window.KUNDEN.schedule(n.client_id);
      else if (n.action === "openAppt") return window.KUNDEN.editAppt(n.ref_id, n.client_id);
      else if (n.action === "open" || n.action === "openClient") { location.hash = n.href; return; }
      else if (a === "view") return window.FIN.open(n.ref_id);
      else if (n.action === "openContract") return window.SOFT.open(n.ref_id);
      else if (n.action === "openTask") return window.WORK.openTask(n.ref_id);
      else if (n.action === "openTicket" || n.action === "openOps") { location.hash = n.href; return; }
      else if (n.action === "assign") { const p = await api(`/projects/${n.ref_id}`); return assign(p, () => { cockpit(); window.updateBadges?.(); }); }
      else {
        b.disabled = true;
        if (n.action === "confirm") { const r = await api(`/bookings/${n.ref_id}`, { method: "PATCH", body: { status: "bestaetigt", notify: true } }); await done(); toast(r.mailed ? "Bestätigt – Einladung mit Video-Link ist raus." : "Bestätigt – Einladung liegt im Postausgang."); }
        if (n.action === "release") {
          const inv = await api(`/finance/invoices/${n.ref_id}`);
          if (!(await UI.confirm(`${inv.title || "Rechnung"} · ${money(inv.gross)} brutto an ${inv.client_email}. Die Rechnung bekommt ihre Nummer, ist danach nicht mehr änderbar und geht mit PDF an den Kunden.`, { title: "Rechnung festschreiben & senden?", ok: "Freigeben & senden" }))) { b.disabled = false; return; }
          const r = await api(`/finance/invoices/${n.ref_id}/issue`, { method: "POST", body: { send: true } });
          toast(`${r.invoice.number} ${r.mailed ? "festgeschrieben und verschickt" : "festgeschrieben – Mail liegt im Postausgang"}.`);
        }
        if (n.action === "quoteReminder") { const r = await api(`/automation/nudges/${n.id}/send`, { method: "POST", body: {} }); toast(r.mailed ? "Nachfrage zum Angebot verschickt." : "Nachfrage liegt im Postausgang (E-Mail noch nicht eingerichtet)."); }
        if (n.action === "dunning") {
          const label = n.title.split(" fällig")[0];
          if (!(await UI.confirm(`${n.text.split(" – ")[0]}: Die ${label} geht mit der Rechnung als PDF an den Kunden.`, { title: `${label} senden?`, ok: "Senden" }))) { b.disabled = false; return; }
          const r = await api(`/finance/invoices/${n.ref_id}/remind`, { method: "POST", body: {} }); await done(); toast(`${r.label} ${r.mailed ? "verschickt" : "liegt im Postausgang"}.`);
        }
      }
      cockpit(); window.updateBadges?.();
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  /* ---------- Posteingang ---------- */
  const KIND = { chat: "Nachricht", termin: "Terminanfrage", anmerkung: "Anmerkungen", buchung: "Website-Buchung", lead: "Projektanfrage" };
  async function inbox() {
    const all = await api("/inbox"), items = all.filter(i => i.kind !== "buchung" && i.kind !== "lead"), leads = all.length - items.length;
    const when = iso => C.fmt(iso, { weekday: "short", day: "numeric", month: "short" }) + ", " + C.fmt(iso, { hour: "2-digit", minute: "2-digit" }) + " Uhr";
    // Jede Zeile hat ihre Aktionen direkt dabei – bestätigen, antworten, einplanen, ohne erst irgendwohin zu springen
    const actionsFor = i => {
      if (i.kind === "termin") return `<div class="ibx__acts">${i.slots.map(s => `<button class="ibtn ${s.free ? "ibtn--ok" : "ibtn--taken"}" data-ia="acceptReq" data-rid="${i.request_id}" data-start="${s.start}" ${s.free ? "" : 'title="Inzwischen belegt"'}>✓ ${when(s.start)}</button>`).join("")}
        <button class="ibtn" data-ia="schedule" data-cid="${i.client_id}">Andere Zeit …</button><button class="ibtn ibtn--no" data-ia="declineReq" data-rid="${i.request_id}">Ablehnen</button></div>`;
      if (i.kind === "buchung") return `<div class="ibx__acts"><button class="ibtn ibtn--ok" data-ia="confirmBooking" data-bid="${i.booking_id}">✓ Bestätigen &amp; Einladung senden</button><button class="ibtn ibtn--no" data-ia="cancelBooking" data-bid="${i.booking_id}">Absagen</button>${i.client_id ? `<a class="ibtn" href="#kunden/${i.client_id}">Kontakt ansehen</a>` : ""}</div>`;
      if (i.kind === "lead") return `<div class="ibx__acts"><button class="ibtn ibtn--ok" data-ia="schedule" data-cid="${i.client_id}">Erstgespräch vereinbaren</button><a class="ibtn" href="#kunden/${i.client_id}">Kontakt ansehen</a><button class="ibtn" data-ia="leadDone" data-lid="${i.lead_id}">Erledigt</button></div>`;
      if (i.kind === "chat") return `<form class="ibx__reply" data-cid="${i.client_id}"><input placeholder="Schnell antworten …" aria-label="Antwort"><button class="ibtn ibtn--ok">Senden</button><a class="ibtn" href="${i.href}">Chat öffnen</a></form>`;
      if (i.kind === "anmerkung") return `<div class="ibx__acts"><a class="ibtn ibtn--ok" href="${i.href}">Anmerkungen abarbeiten →</a></div>`;
      return "";
    };
    const hint = leads ? `<a class="ibx-hint" href="#anfragen"><b>${leads} neue Anfrage${leads === 1 ? "" : "n"} von Interessenten</b><span>Website-Buchungen und Projektanfragen bearbeiten Sie im Vertrieb →</span></a>` : "";
    $("#inboxList").innerHTML = hint + (items.length ? items.map(i => `
      <div class="ibx ibx--${i.kind}">
        <span class="ibx__ico">${ICON[i.kind]}</span>
        <div class="ibx__body"><div class="ibx__top"><span class="ibx__kind">${KIND[i.kind]}</span>${i.count > 1 ? `<span class="badge">${i.count}</span>` : ""}<span class="ibx__at">${ago(i.at)}</span></div>
          <b>${esc(i.title)}</b><p>${esc(i.text)}</p>${actionsFor(i)}</div>
      </div>`).join("") : `<div class="allclear allclear--big"><b>Posteingang leer.</b><span>Alle Kunden haben eine Antwort – genießen Sie den Moment. ☕</span></div>`);
  }
  const after = async msg => { if (msg) toast(msg); await inbox(); window.updateBadges?.(); };
  $("#inboxList").addEventListener("click", async e => {
    const b = e.target.closest("[data-ia]"); if (!b) return;
    const a = b.dataset.ia;
    try {
      if (a === "acceptReq") {
        if (b.classList.contains("ibtn--taken") && !(await UI.confirm("Dieser Zeitpunkt ist inzwischen anderweitig belegt.", { title: "Trotzdem bestätigen?" }))) return;
        b.disabled = true; const r = await api(`/requests/${b.dataset.rid}/accept`, { method: "POST", body: { start: b.dataset.start, force: b.classList.contains("ibtn--taken") } });
        return after(r.mailed ? "Termin bestätigt – Einladung mit Video-Link ist raus." : "Termin bestätigt – Einladung liegt im Postausgang.");
      }
      if (a === "declineReq") { const ans = await UI.prompt("Terminanfrage ablehnen", { label: "Antwort an den Kunden (erscheint im Chat)", value: "Leider passt keiner der Wunschtermine. Wie wäre es stattdessen mit ", multiline: true, ok: "Ablehnen & antworten" }); if (ans === null) return; await api(`/requests/${b.dataset.rid}/decline`, { method: "POST", body: { answer: ans } }); return after("Abgelehnt – Ihre Antwort steht im Chat."); }
      if (a === "schedule") return window.KUNDEN.schedule(+b.dataset.cid);
      if (a === "confirmBooking") { b.disabled = true; const r = await api(`/bookings/${b.dataset.bid}`, { method: "PATCH", body: { status: "bestaetigt", notify: true } }); return after(r.mailed ? "Bestätigt – Einladung mit Video-Link ist raus." : "Bestätigt – Mail liegt im Postausgang (E-Mail noch nicht eingerichtet)."); }
      if (a === "cancelBooking") { if (!(await UI.confirm("Der Kunde wird per E-Mail informiert und kann einen neuen Termin wählen.", { title: "Termin absagen?", ok: "Absagen", danger: true }))) return; await api(`/bookings/${b.dataset.bid}`, { method: "PATCH", body: { status: "abgesagt", notify: true } }); return after("Abgesagt"); }
      if (a === "leadDone") { await api(`/requests/${b.dataset.lid}`, { method: "PATCH", body: { status: "in Bearbeitung" } }); return after("Als bearbeitet markiert – der Kontakt bleibt unter Kunden → Anfragen."); }
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  $("#inboxList").addEventListener("submit", async e => {
    const f = e.target.closest(".ibx__reply"); if (!f) return; e.preventDefault();
    const inp = $("input", f); if (!inp.value.trim()) return;
    try { await api(`/clients/${f.dataset.cid}/messages`, { method: "POST", body: { body: inp.value.trim() } }); await api(`/clients/${f.dataset.cid}/messages?after=999999999`); after("Antwort gesendet"); } catch (err) { toast(err.message); }
  });

  /* ---------- Projekte: Team-Auslastung, Filter, kompakte Liste ---------- */
  const PH = ["Erstgespräch", "Konzept", "Prototyp", "Umsetzung", "Launch", "Betreuung"];
  // Aufwand je Phase (Umsetzung bindet am meisten); 8 Punkte ≈ eine volle Person
  const EFFORT = { "Erstgespräch": .3, "Konzept": .7, "Prototyp": 1, "Umsetzung": 1.2, "Launch": .8, "Betreuung": .3 }, CAPACITY = 8;
  const loadOf = u => { const pts = Object.entries(u.load?.phases || {}).reduce((s, [ph, n]) => s + (EFFORT[ph] || .5) * n, 0); return Math.round(pts / CAPACITY * 100); };
  const level = pct => pct >= 100 ? ["voll ausgelastet", "full"] : pct >= 70 ? ["gut ausgelastet", "mid"] : ["hat Kapazität", "free"];
  let pPhase = "aktiv", pTeam = "alle", pKind = "alle", pModel = "alle", pBereich = "alle", pSort = "aktivitaet", pSearch = "";
  const pState = { all: [], team: [] };

  async function projects() {
    const [, pid] = location.hash.slice(1).split("/");
    if (pid) {
      // Hardware-Projekte haben ihre eigene Seite im Hardware-Bereich
      const istHardware = await api(`/hardware/projekte/${+pid}/stand`).then(() => true, () => false);
      if (istHardware) { location.replace(`#hardware/projekt/${+pid}`); return; }
      $("#pList").hidden = true; $("#projectPage").hidden = false; return window.KUNDEN.openProjectPage(+pid); }
    $("#pList").hidden = false; $("#projectPage").hidden = true;
    const [all, team] = await Promise.all([api("/projects"), ME.owner ? api("/team") : Promise.resolve([])]);
    pState.all = all; pState.team = team.filter(u => u.active && !u.invited);
    renderProjects();
  }
  function filtered() {
    const all = pState.all, active = all.filter(p => p.status === "aktiv");
    let list = pPhase === "aktiv" ? active : PH.includes(pPhase) ? active.filter(p => p.phase === pPhase) : pPhase === "angebot" ? all.filter(p => p.status === "anfrage" && p.offerOpen) : pPhase === "anfrage" ? all.filter(p => p.status === "anfrage" && !p.offerOpen) : all.filter(p => p.status === pPhase);
    const has = (p, id) => (p.members || []).some(m => String(m.id) === String(id));
    if (pTeam === "me") list = list.filter(p => has(p, ME.id)); else if (pTeam === "none") list = list.filter(p => !(p.members || []).length); else if (pTeam !== "alle") list = list.filter(p => has(p, pTeam));
    if (pBereich !== "alle") list = list.filter(p => (p.bereich || "software") === pBereich);
    if (pKind !== "alle") list = list.filter(p => (p.kind || "–") === pKind);
    if (pModel !== "alle") list = list.filter(p => (p.model || "–") === pModel);
    const q = pSearch.trim().toLowerCase(); if (q) list = list.filter(p => `${p.title} ${p.client.company} ${p.kind || ""} ${(p.members || []).map(m => m.name).join(" ")}`.toLowerCase().includes(q));
    const sorters = { aktivitaet: (a, b) => String(b.last_activity).localeCompare(String(a.last_activity)), termin: (a, b) => (a.next?.start || "9").localeCompare(b.next?.start || "9"),
      phase: (a, b) => a.phaseIndex - b.phaseIndex, kunde: (a, b) => a.client.company.localeCompare(b.client.company, "de"), aufmerksamkeit: (a, b) => (b.openNotes + b.unread * 2) - (a.openNotes + a.unread * 2),
      wert: (a, b) => (b.offer_net || 0) - (a.offer_net || 0) };
    return list.sort(sorters[pSort]);
  }
  function renderProjects() {
    const all = pState.all, team = pState.team, active = all.filter(p => p.status === "aktiv"), unassigned = active.filter(p => !(p.members || []).length);
    $("#pbTitle").textContent = ME.owner ? "Alle Projekte" : "Meine Projekte";
    { const anfragen = all.filter(p => p.status === "anfrage").length; $("#pbSub").textContent = `${active.length} aktiv${anfragen ? ` · ${anfragen} Anfrage${anfragen === 1 ? "" : "n"}` : ""} · ${all.length - active.length - anfragen} pausiert oder abgeschlossen`; }
    // Team-Auslastung: wer macht gerade wie viel – Klick filtert die Liste
    $("#pLoad").innerHTML = ME.owner ? team.map(u => { const pct = loadOf(u), [lt, lc] = level(pct);
      return `<button class="wl ${String(pTeam) === String(u.id) ? "on" : ""}" data-team="${u.id}"><span class="avatar">${esc(initials(u.name))}</span>
        <span class="wl__m"><b>${esc(u.name)}${u.me ? " (Sie)" : ""}</b><small>${u.load.active} Projekt${u.load.active === 1 ? "" : "e"} · ${u.load.clients} Kunde${u.load.clients === 1 ? "" : "n"}</small><span class="wl__vol">${money(u.load.volume)} <small>Auftragsvolumen</small></span>
        <span class="meter meter--${lc}"><i style="width:${Math.min(100, Math.max(4, pct))}%"></i></span><small class="meter__l meter__l--${lc}">${pct} % · ${lt}</small></span></button>`; }).join("")
      + `<button class="wl wl--none ${pTeam === "none" ? "on" : ""} ${unassigned.length ? "wl--warn" : ""}" data-team="none"><span class="avatar avatar--none">?</span><span class="wl__m"><b>Nicht zugewiesen</b><small>${unassigned.length ? `${unassigned.length} aktive${unassigned.length === 1 ? "s Projekt wartet" : " Projekte warten"} auf ein Team` : "alles verteilt ✓"}</small></span></button>` : "";
    const chips = [["aktiv", "Alle aktiven", active.length], ["anfrage", "Vor dem Auftrag", all.filter(p => p.status === "anfrage" && !p.offerOpen).length], ["angebot", "Angebot offen", all.filter(p => p.status === "anfrage" && p.offerOpen).length], ...PH.map(ph => [ph, ph, active.filter(p => p.phase === ph).length]), ["pausiert", "Pausiert", all.filter(p => p.status === "pausiert").length], ["abgeschlossen", "Abgeschlossen", all.filter(p => p.status === "abgeschlossen").length]];
    const count = (key, fn) => { const m = new Map(); active.forEach(p => { const k = fn(p) || "–"; m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, l: v, n })); };
    const teamOpts = ME.owner ? [{ v: "alle", l: "Ganzes Team" }, { v: "me", l: "Meine Projekte" }, { v: "none", l: "Nicht zugewiesen", n: unassigned.length }, { sep: "Person" }, ...team.map(u => ({ v: u.id, l: u.name, av: initials(u.name), n: u.load.active }))] : null;
    const any = pTeam !== "alle" || pBereich !== "alle" || pKind !== "alle" || pModel !== "alle" || pSearch;
    $("#pboard").innerHTML = `
      <div class="pctl">
        <div class="pchips">${chips.filter(c => c[2] || c[0] === "aktiv").map(([k, l, n]) => `<button data-pf="${esc(k)}" class="${k === pPhase ? "on" : ""}">${esc(l)}<em>${n}</em></button>`).join("")}</div>
        <div class="pctl__r"><input type="search" id="pSearch" class="lsearch" placeholder="Projekt, Kunde oder Person suchen …" value="${esc(pSearch)}" autocomplete="off">
          ${teamOpts ? DD.html("pTeam", teamOpts, pTeam, { label: "Wer" }) : ""}
          ${DD.html("pBereich", [{ v: "alle", l: "Software & Hardware" }, { v: "software", l: "Software", n: active.filter(p => p.bereich !== "hardware").length }, { v: "hardware", l: "Hardware", n: active.filter(p => p.bereich === "hardware").length }], pBereich, { label: "Bereich" })}
          ${DD.html("pKind", [{ v: "alle", l: "Alle Arten" }, ...count("kind", p => p.kind)], pKind, { label: "Art" })}
          ${DD.html("pModel", [{ v: "alle", l: "Alle Modelle" }, ...count("model", p => p.model)], pModel, { label: "Modell" })}
          ${DD.html("pSort", [{ v: "aktivitaet", l: "Zuletzt aktiv" }, { v: "aufmerksamkeit", l: "Braucht Aufmerksamkeit" }, { v: "termin", l: "Nächster Termin" }, { v: "phase", l: "Phase" }, { v: "kunde", l: "Kunde A–Z" }, ...(ME.owner ? [{ v: "wert", l: "Auftragswert" }] : [])], pSort, { label: "Sortierung" })}
          ${any ? `<button class="link" data-reset>Filter zurücksetzen</button>` : ""}</div></div>
      <div id="plist"></div>`;
    renderList();
  }
  function renderList() {
    const list = filtered(), all = pState.all;
    $("#plist").innerHTML = list.length ? `<div class="ptab"><div class="ptab__h"><span>Projekt</span><span>Phase</span><span>Team</span><span>Nächster Termin</span><span>Offen</span>${ME.owner ? `<span class="num">Auftrag</span>` : ""}<span>Aktivität</span></div>
      ${list.map(p => `<div class="ptab__r ${p.status !== "aktiv" ? "ptab__r--off" : ""}" data-href="${projektHref(p)}" role="link" tabindex="0">
        <span class="pt__main"><b>${esc(p.title)} ${bereichTag(p)}${p.status === "anfrage" ? (p.vorgang?.wer === "kunde" ? ` <span class="bereich bereich--angebot">Angebot offen</span>` : p.vorgang?.wer === "geplant" ? ` <span class="bereich bereich--anfrage">Gespräch geplant</span>` : p.vorgang?.schritt === 2 ? ` <span class="bereich bereich--anfrage">Gespräch geführt · Angebot fehlt</span>` : ` <span class="bereich bereich--anfrage">Neu · noch kein Termin</span>`) : ""}</b><small>${esc(p.client.company)}${p.kind ? " · " + esc(p.kind) : ""}</small></span>
        <span><span class="mstep">${PH.map((_, k) => `<i class="${k < p.phaseIndex ? "done" : k === p.phaseIndex ? "now" : ""}"></i>`).join("")}</span><small>${esc(p.phase)}${p.prototype ? ` · V${p.prototype}` : ""}</small></span>
        <span class="pteam">${(p.members || []).map(m => `<span class="avatar avatar--xs" title="${esc(m.name)}">${esc(initials(m.name))}</span>`).join("") || (ME.owner ? `<button class="assignbtn" data-assign="${p.id}">+ Zuweisen</button>` : "")}</span>
        <span>${p.next ? `<b class="ptab__date">${C.fmt(p.next.start, { day: "numeric", month: "short" })}</b><small>${esc(p.next.title)}</small>` : `<small class="muted">–</small>`}</span>
        <span class="pflags">${p.unread ? `<em class="flag flag--chat" title="Ungelesene Nachrichten des Kunden">${ICO("chat")}${p.unread}</em>` : ""}${p.openNotes ? `<em class="flag flag--note" title="Offene Anmerkungen">${ICO("anmerkung")}${p.openNotes}</em>` : ""}${!p.unread && !p.openNotes ? `<small class="muted">–</small>` : ""}</span>
        ${ME.owner ? `<span class="num">${p.offer_net ? money(p.offer_net) : "–"}</span>` : ""}
        <span><small>${ago(p.last_activity)}</small></span></div>`).join("")}</div>
      <p class="pcount">${list.length} von ${all.length} Projekten</p>`
      : `<div class="empty">${all.length ? "Keine Projekte für diese Filter." : ME.owner ? "Noch keine Projekte – legen Sie oben rechts das erste an." : "Ihnen ist noch kein Projekt zugewiesen."}</div>`;
  }
  DD.on("pTeam", v => { pTeam = v; renderProjects(); });
  DD.on("pBereich", v => { pBereich = v; renderProjects(); });
  DD.on("pKind", v => { pKind = v; renderProjects(); });
  DD.on("pModel", v => { pModel = v; renderProjects(); });
  DD.on("pSort", v => { pSort = v; renderProjects(); });
  $("#pLoad").addEventListener("click", e => { const b = e.target.closest("[data-team]"); if (!b) return; pTeam = String(pTeam) === b.dataset.team ? "alle" : b.dataset.team; renderProjects(); });
  $("#pboard").addEventListener("click", e => {
    const c = e.target.closest("[data-pf]"); if (c) { pPhase = c.dataset.pf; return renderProjects(); }
    if (e.target.closest("[data-reset]")) { pTeam = pKind = pModel = pBereich = "alle"; pSearch = ""; return renderProjects(); }
    const as = e.target.closest("[data-assign]"); if (as) { e.stopPropagation(); const p = pState.all.find(x => x.id === +as.dataset.assign); return assign(p, projects); }
    const r = e.target.closest("[data-href]"); if (r) location.hash = r.dataset.href;
  });
  $("#pboard").addEventListener("keydown", e => { const r = e.target.closest("[data-href]"); if (r && e.key === "Enter") location.hash = r.dataset.href; });
  $("#pboard").addEventListener("input", e => { if (e.target.id === "pSearch") { pSearch = e.target.value; renderList(); } });
  $("#newProjectBtn").addEventListener("click", () => newProject().catch(err => toast(err.message)));

  /* ---------- Zuweisen mit Blick auf die Auslastung ---------- */
  const assignList = (team, on) => `<div class="asgl">${team.map(u => { const pct = loadOf(u), [lt, lc] = level(pct);
    return `<label class="asg"><input type="checkbox" value="${u.id}" ${on.has(u.id) ? "checked" : ""}><span class="asg__chk"></span>
      <span class="avatar">${esc(initials(u.name))}</span>
      <span class="asg__m"><b>${esc(u.name)}${u.me ? " (Sie)" : ""} <small>${esc(u.roleLabel)}</small></b>
        <small>${u.load.active} aktive Projekte · ${u.load.clients} Kunden · ${money(u.load.volume)} Auftragsvolumen${u.load.appts ? ` · ${u.load.appts} Termin${u.load.appts === 1 ? "" : "e"} diese Woche` : ""}</small>
        <span class="asg__ph">${PH.filter(ph => u.load.phases[ph]).map(ph => `<i>${u.load.phases[ph]}× ${ph}</i>`).join("") || "<i>noch frei</i>"}</span></span>
      <span class="asg__load"><span class="meter meter--${lc}"><i style="width:${Math.min(100, Math.max(4, pct))}%"></i></span><small class="meter__l meter__l--${lc}">${pct} %<br>${lt}</small></span></label>`; }).join("")}</div>`;
  async function assign(p, onDone) {
    const team = (await api("/team")).filter(u => u.active && !u.invited);
    modal(`<h2>Wer setzt „${esc(p.title)}“ um?</h2><p class="hint" style="margin:0">Die Auslastung rechnet aktive Projekte nach Aufwand der Phase (Umsetzung zählt mehr als Betreuung). Entwickler sehen nur Projekte, denen sie zugewiesen sind – ohne Beträge.</p>
      ${assignList(team, new Set((p.members || []).map(m => m.id)))}`,
      async f => { const ids = $$(".asg input:checked", f).map(i => +i.value); await api(`/projects/${p.id}/members`, { method: "PUT", body: { user_ids: ids } });
        toast(ids.length ? `Zugewiesen: ${team.filter(u => ids.includes(u.id)).map(u => u.name.split(" ")[0]).join(", ")}` : "Niemand mehr zugewiesen."); onDone?.(); }, { wide: true, ok: "Zuweisen" });
  }
  async function startOrder(c) {
    const team = (await api("/team")).filter(u => u.active && !u.invited), L = c.lead || {};
    const MODELS = ["Festpreis", "Festpreis + Betreuung", "Signature", "Anpassung bestehender Software", "Beratung"];
    modal(`<h2>Auftrag starten · ${esc(c.company)}</h2>
      <ol class="steps3"><li><b>Kunde</b><span>${esc(c.name)} bekommt Zugang zum Kundenportal</span></li><li><b>Projekt</b><span>wird angelegt – mit Auftragswert</span></li><li><b>Team</b><span>wer setzt es um?</span></li></ol>
      <label>Projekttitel<input name="title" required maxlength="160" placeholder="z. B. ${esc((L.kinds || "Web-App").split(/,\s*/)[0])} für ${esc(c.company)}"></label>
      <div class="two"><label>Art<input name="kind" value="${esc((L.kinds || "").split(/,\s*/)[0] || "")}" placeholder="z. B. Web-App"></label>
        <div class="field"><span>Modell</span>${DD.html("so-model", [{ v: "", l: "– noch offen –" }, ...MODELS.map(m => ({ v: m, l: m }))], "", { field: "model" })}</div></div>
      <div class="two"><label>Auftragswert netto (€)<input name="offer_net" inputmode="decimal" placeholder="${L.budget ? esc(L.budget) : "z. B. 24.000"}"></label>
        <div class="field"><span>Startphase</span>${DD.html("so-phase", PH.map(ph => ({ v: ph, l: ph })), "Konzept", { field: "phase" })}</div></div>
      <div><b class="flabel">Wer setzt es um? <small class="muted" style="font-weight:400">– Auslastung und Auftragsvolumen je Person</small></b>${assignList(team, new Set())}</div>
      <label class="check"><input type="checkbox" name="invite" checked> Einladung zum Kundenportal an ${esc(c.email)} senden</label>`,
      async f => {
        const ids = $$(".asg input:checked", f).map(i => +i.value);
        if (!ids.length && !(await UI.confirm("Das Projekt erscheint dann unter „Nicht zugewiesen“, bis jemand zugewiesen ist.", { title: "Ohne Team starten?", ok: "Ohne Team starten" }))) throw new Error("Bitte wählen Sie, wer das Projekt umsetzt.");
        const r = await api(`/clients/${c.id}/stage`, { method: "PATCH", body: { stage: "mandant", sendInvite: f.invite.checked } });
        const p = await api(`/clients/${c.id}/projects`, { method: "POST", body: { title: f.title.value, kind: f.kind.value, model: f.model.value, phase: f.phase.value, description: "", notify: false } });
        if (f.offer_net.value.trim()) await api(`/projects/${p.id}`, { method: "PATCH", body: { offer_net: f.offer_net.value.trim(), notify: false } });
        if (ids.length) await api(`/projects/${p.id}/members`, { method: "PUT", body: { user_ids: ids } });
        window.updateBadges?.(); location.hash = `#projekte/${p.id}`;
        toast(`${c.company} ist jetzt Kunde – Projekt angelegt${ids.length ? " und zugewiesen" : ""}.`);
        if (r.inviteLink && r.mailed !== true) setTimeout(() => UI.link("Zugang zum Kundenportal", f.invite.checked ? "Die Einladung liegt im Postausgang (E-Mail noch nicht eingerichtet). Schicken Sie den Link bis dahin selbst:" : "Schicken Sie diesen Link (14 Tage gültig):", r.inviteLink), 400);
      }, { wide: true, ok: "Auftrag starten" });
  }
  async function newProject(clientId) {
    const [clients, team, all] = await Promise.all([api("/clients"), api("/team"), api("/projects")]);
    const cands = clients.filter(c => c.stage === "mandant" || c.stage === "interessent").sort((a, b) => a.company.localeCompare(b.company, "de"));
    const kinds = [...new Set(all.map(p => p.kind).filter(Boolean))].sort();
    const MODELS = ["Festpreis", "Festpreis + Betreuung", "Signature", "Anpassung bestehender Software", "Beratung"];
    modal(`<h2>Neues Projekt</h2>
      <div class="field"><span>Bereich</span>${DD.html("np-bereich", [{ v: "software", l: "Software – digitale Lösung" }, { v: "hardware", l: "Hardware – physisches Produkt" }], "software", { field: "bereich" })}</div>
      <div class="field"><span>Kunde</span>${DD.html("np-client", [...cands.filter(c => c.stage === "mandant").map(c => ({ v: c.id, l: c.company })), ...(cands.some(c => c.stage === "interessent") ? [{ sep: "Interessenten" }] : []), ...cands.filter(c => c.stage === "interessent").map(c => ({ v: c.id, l: c.company }))], clientId || "", { field: "client", placeholder: "Kunde wählen …" })}</div>
      <label>Titel<input name="title" required maxlength="160" placeholder="z. B. Praxissoftware mit Online-Anamnese"></label>
      <div class="two"><label>Art<input name="kind" list="npKinds" placeholder="z. B. Web-App"><datalist id="npKinds">${kinds.map(k => `<option value="${esc(k)}">`).join("")}</datalist></label>
        <div class="field"><span>Modell</span>${DD.html("np-model", [{ v: "", l: "– noch offen –" }, ...MODELS.map(m => ({ v: m, l: m }))], "", { field: "model" })}</div></div>
      <div class="field"><span>Startphase</span>${DD.html("np-phase", PH.map(ph => ({ v: ph, l: ph })), "Erstgespräch", { field: "phase" })}</div>
      <label>Kurzbeschreibung (sieht der Kunde)<textarea name="description" rows="2"></textarea></label>
      <div><b class="flabel">Wer setzt es um?</b>${assignList(team.filter(u => u.active && !u.invited), new Set())}</div>
      <label class="check"><input type="checkbox" name="notify" checked> Kunden informieren, dass das Projekt angelegt ist</label>`,
      async f => {
        const cid = +f.client.value; if (!cid) throw new Error("Bitte einen Kunden wählen.");
        const p = await api(`/clients/${cid}/projects`, { method: "POST", body: { title: f.title.value, bereich: f.bereich.value, kind: f.kind.value, model: f.model.value, phase: f.phase.value, description: f.description.value, notify: f.notify.checked } });
        const ids = $$(".asg input:checked", f).map(i => +i.value);
        if (ids.length) await api(`/projects/${p.id}/members`, { method: "PUT", body: { user_ids: ids } });
        toast(ids.length ? "Projekt angelegt und zugewiesen" : "Projekt angelegt – noch niemand zugewiesen"); location.hash = projektHref(p);
      }, { wide: true, ok: "Projekt anlegen" });
  }

  /* ---------- Team ---------- */
  async function team() {
    const list = await api("/team");
    $("#teamList").innerHTML = list.map(u => `
      <div class="tm ${u.active ? "" : "tm--off"}" data-id="${u.id}">
        <span class="avatar tm__av">${esc(initials(u.name))}</span>
        <div class="tm__main"><b>${esc(u.name)}${u.me ? ` <em class="pill" style="font-size:11px">Sie</em>` : ""}</b><span>${esc(u.email)}</span>
          <p>${u.invited ? "Einladung offen" : u.last_login ? "zuletzt angemeldet " + ago(u.last_login) : "noch nie angemeldet"}${u.active ? "" : " · gesperrt"}</p>
          ${u.active && !u.invited ? (() => { const pct = loadOf(u), [lt, lc] = level(pct); return `<span class="tm__load"><span class="meter meter--${lc}"><i style="width:${Math.min(100, Math.max(4, pct))}%"></i></span><small class="meter__l meter__l--${lc}">${u.load.active} aktive Projekte · ${money(u.load.volume)} Auftragsvolumen · ${pct} % · ${lt}</small></span>`; })() : ""}</div>
        <div class="tm__role"><span class="pill ${u.role === "inhaber" ? "pill--neu" : ""}">${esc(u.roleLabel)}</span></div>
        <div class="tm__projects">${u.projects.filter(p => p.status === "aktiv").length ? u.projects.filter(p => p.status === "aktiv").map(p => `<a class="tag" href="#projekte/${p.id}">${esc(p.title)} <small>· ${esc(p.company)}</small></a>`).join("") : u.role === "inhaber" ? `<span class="hint" style="margin:0">sieht alle Projekte</span>` : `<span class="hint" style="margin:0">noch keinem Projekt zugewiesen</span>`}</div>
        <div class="tm__acts">${u.me ? "" : `
          <button class="btn btn--ghost btn--sm" data-tm="projects">Projekte</button>
          <button class="btn btn--ghost btn--sm" data-tm="role">${u.role === "inhaber" ? "Zu Entwickler" : "Zu Inhaber"}</button>
          ${u.invited ? `<button class="btn btn--ghost btn--sm" data-tm="invite">Link</button>` : ""}
          <button class="btn ${u.active ? "btn--danger" : "btn--ghost"} btn--sm" data-tm="active">${u.active ? "Sperren" : "Aktivieren"}</button>`}</div>
      </div>`).join("");
    team.list = list;
  }
  $("#teamList").addEventListener("click", async e => {
    const b = e.target.closest("[data-tm]"); if (!b) return;
    const u = team.list.find(x => x.id === +b.closest(".tm").dataset.id), act = b.dataset.tm;
    try {
      if (act === "role") { if (!(await UI.confirm(u.role !== "inhaber" ? "Inhaber sehen auch Finanzen, Vertrieb und das Team." : "Entwickler sehen nur zugewiesene Projekte.", { title: `${u.name} zum ${u.role === "inhaber" ? "Entwickler" : "Inhaber"} machen?` }))) return; await api(`/team/${u.id}`, { method: "PATCH", body: { role: u.role === "inhaber" ? "entwickler" : "inhaber" } }); }
      if (act === "active") { if (u.active && !(await UI.confirm("Die Person wird sofort abgemeldet.", { title: `Zugang von ${u.name} sperren?`, ok: "Sperren", danger: true }))) return; await api(`/team/${u.id}`, { method: "PATCH", body: { active: !u.active } }); }
      if (act === "invite") { const r = await api(`/team/${u.id}/invite`, { method: "POST", body: {} }); UI.link("Einladungslink", "14 Tage gültig – ein älterer Link wird ungültig.", r.inviteLink); }
      if (act === "projects") return projectPicker(u);
      team(); toast("Gespeichert");
    } catch (err) { toast(err.message); }
  });
  async function projectPicker(u) {
    const clients = await api("/clients");
    const groups = await Promise.all(clients.map(c => api(`/clients/${c.id}/projects`).then(ps => ({ c, ps }))));
    const on = new Set(u.projects.map(p => p.id));
    modal(`<h2>Projekte für ${esc(u.name)}</h2><p class="hint">${esc(u.name.split(" ")[0])} sieht nur diese Projekte – mit Chat, Prototypen, Anmerkungen und Terminen, aber ohne Beträge.</p>
      <div class="pickgrid">${groups.filter(g => g.ps.length).map(g => `<div><b>${esc(g.c.company)}</b>${g.ps.map(p => `<label class="check"><input type="checkbox" value="${p.id}" ${on.has(p.id) ? "checked" : ""}> ${esc(p.title)}</label>`).join("")}</div>`).join("") || `<p class="hint">Noch keine Projekte vorhanden.</p>`}</div>`,
      async box => { await api(`/team/${u.id}`, { method: "PATCH", body: { projects: $$("input:checked", box).map(i => +i.value) } }); toast("Projekte zugewiesen"); team(); });
  }
  $("#newMember").addEventListener("click", () => modal(`<h2>Person ins Team einladen</h2>
      <label>Name<input name="name" required maxlength="120"></label>
      <label>E-Mail<input name="email" type="email" required maxlength="160"></label>
      <label>Rolle<select name="role"><option value="entwickler">Entwickler – nur zugewiesene Projekte</option><option value="inhaber">Inhaber – alles</option></select></label>
      <label class="check"><input type="checkbox" name="sendInvite" checked> Einladung per E-Mail senden</label>`,
    async box => {
      const f = $("form", box) || box;
      const r = await api("/team", { method: "POST", body: { name: f.name.value, email: f.email.value, role: f.role.value, sendInvite: f.sendInvite.checked } });
      team(); UI.link("Einladung", r.mailed === true ? "Einladung verschickt. Zur Sicherheit hier noch der Link:" : "Zugang angelegt. Diesen Link der Person schicken (14 Tage gültig):", r.inviteLink);
    }));

  function modal(html, onSave, { wide = false, ok = "Speichern" } = {}) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<form class="card bmodal" style="width:min(${wide ? 760 : 560}px,100%);max-height:90vh;overflow:auto;display:grid;gap:14px">${html}<p class="err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn--ghost" data-close>Abbrechen</button><button class="btn btn--grad" type="submit">${esc(ok)}</button></div></form>`;
    document.body.appendChild(m);
    const f = $("form", m);
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
    f.addEventListener("submit", async e => { e.preventDefault(); try { await onSave(f); m.remove(); } catch (err) { const p = $(".err", f); p.textContent = err.message; p.hidden = false; } });
    $("input:not([type=hidden]):not([type=checkbox]),select", f)?.focus();
  }

  window.BOARD = { cockpit, inbox, projects, team, assign, newProject, startOrder, arbeitsstand, vorgaenge, vereinbarungen, refresh: async () => {
    if (ME.owner) await api("/automation/run", { method: "POST", body: {} }).catch(() => {}); if (location.hash.startsWith("#posteingang")) inbox(); if (location.hash.startsWith("#cockpit") || location.hash === "") cockpit(); window.updateBadges?.(); } };
})();
