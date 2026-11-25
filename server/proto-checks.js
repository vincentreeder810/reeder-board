/* Feste Prüfungen in einer Seite (Baustein H6) – läuft im Browser der Prüfstrecke, ändert nichts.
   Rückgabe: Anzahl tatsächlich durchgeführter Einzelprüfungen, Funde, interne Links und eine Textübersicht für die KI-Prüfer. */
(mobile => {
  let n = 0;
  const out = [], ok = (cond, f) => { n++; if (!cond) out.push(f()); };
  const selOf = el => { const p = []; while (el && el.nodeType === 1 && el !== document.documentElement) { if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { p.unshift("#" + el.id); break; } let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++; p.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")"); el = el.parentElement; } return p.join(">"); };
  const txt = el => String(el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const visible = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  const F = (check, sev, title, detail, el, devDep = false) => ({ check, sev, title, detail, sel: el ? selOf(el) : "", devDep });

  // Grundlagen der Seite
  ok(!!document.documentElement.getAttribute("lang"), () => F("lang", "mittel", "Sprache der Seite fehlt", "<html lang=\"de\"> fehlt – Bildschirmleser lesen sonst mit falscher Aussprache vor."));
  const title = document.title.trim();
  ok(!!title, () => F("title", "hoch", "Seitentitel fehlt", "Kein <title> – erscheint so in Google und im Browser-Tab."));
  if (title) ok(title.length >= 10 && title.length <= 70, () => F("title-len", "hinweis", "Seitentitel ungünstig lang", `„${title}“ hat ${title.length} Zeichen (gut sind 10–70).`));
  ok(!!document.querySelector('meta[name="viewport"]'), () => F("viewport", "hoch", "Mobil-Einstellung fehlt", "<meta name=\"viewport\"> fehlt – auf dem Handy wird die Seite winzig angezeigt."));
  ok(!!document.querySelector('meta[name="description"]')?.content?.trim(), () => F("description", "hinweis", "Beschreibung für Suchmaschinen fehlt", "<meta name=\"description\"> fehlt."));
  const h1 = [...document.querySelectorAll("h1")].filter(visible);
  ok(h1.length === 1, () => F("h1", "mittel", h1.length ? `${h1.length} Hauptüberschriften` : "Hauptüberschrift fehlt", h1.length ? "Jede Seite sollte genau eine <h1> haben." : "Keine sichtbare <h1> auf der Seite.", h1[1]));
  let last = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) { if (!visible(h)) continue; const l = +h.tagName[1]; ok(!last || l <= last + 1, () => F("heading-order", "hinweis", "Überschriften-Ebene übersprungen", `Nach <h${last}> folgt <h${l}> „${txt(h)}“.`, h)); last = l; }

  // Bilder
  for (const img of document.querySelectorAll("img")) {
    ok(img.hasAttribute("alt"), () => F("img-alt", "mittel", "Bild ohne Alternativtext", `${(img.getAttribute("src") || "").split("/").pop().slice(0, 60)} – für Bildschirmleser und Google unsichtbar.`, img));
    if (img.complete) ok(img.naturalWidth > 0, () => F("img-broken", "hoch", "Bild lädt nicht", `${img.getAttribute("src") || ""}`.slice(0, 120), img));
    const r = img.getBoundingClientRect();
    if (img.naturalWidth > 1600 && r.width > 0) ok(img.naturalWidth < r.width * 2.6, () => F("img-size", "hinweis", "Bild unnötig groß", `${img.naturalWidth} px Breite für ${Math.round(r.width)} px Anzeige – verlangsamt das Laden.`, img, true));
  }

  // Links und Knöpfe
  const links = [], smallTaps = [];
  for (const a of document.querySelectorAll("a, button, [role=button]")) {
    if (!visible(a)) continue;
    const name = (a.innerText || a.getAttribute("aria-label") || a.getAttribute("title") || a.querySelector("img[alt]")?.alt || "").trim();
    ok(!!name, () => F("name", "mittel", a.tagName === "A" ? "Link ohne Beschriftung" : "Knopf ohne Beschriftung", "Nur ein Symbol ohne Text oder aria-label – für Bildschirmleser unbenannt.", a));
    if (a.tagName !== "A") continue;
    const href = (a.getAttribute("href") || "").trim();
    ok(href && href !== "#" && !/^javascript:/i.test(href), () => F("href", "mittel", "Link führt nirgendwohin", `„${txt(a) || "Link"}“ hat kein Ziel (href="${href}").`, a));
    if (a.target === "_blank") ok(/noopener|noreferrer/.test(a.rel), () => F("noopener", "hinweis", "Neuer Tab ohne Schutz", `„${txt(a)}“ öffnet einen neuen Tab ohne rel="noopener".`, a));
    if (/^tel:/i.test(href)) ok(/^tel:\+?[\d\s/()-]{6,}$/.test(href), () => F("tel", "mittel", "Telefon-Link fehlerhaft", `${href} – beim Antippen wählt das Handy so nicht richtig.`, a));
    if (/^mailto:/i.test(href)) ok(/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(href), () => F("mailto", "mittel", "E-Mail-Link fehlerhaft", href, a));
    if (href && !/^(https?:|mailto:|tel:|#|javascript:|data:)/i.test(href)) links.push(href);
    // Links mitten im Fließtext sind ausgenommen (WCAG); gemeldet wird je Seite und Gerät einmal, mit Beispielen
    const inline = a.parentElement && [...a.parentElement.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().length > 2) && /^(P|LI|SPAN|TD|DD|SMALL)$/.test(a.parentElement.tagName);
    if (mobile && !inline) { n++; const r = a.getBoundingClientRect(); if (!(r.height >= 32 || r.width >= 120)) smallTaps.push(`„${txt(a) || "Link"}“ ${Math.round(r.width)}×${Math.round(r.height)} px`); }
  }
  if (smallTaps.length) out.push(F("tap", "hinweis", `${smallTaps.length} Link${smallTaps.length === 1 ? "" : "s"} auf dem Handy schwer zu treffen`, `Kleiner als 32 px Höhe: ${smallTaps.slice(0, 4).join(", ")}${smallTaps.length > 4 ? " …" : ""}.`, null, true));
  const legal = [...document.querySelectorAll("a")].map(a => (a.innerText + " " + a.getAttribute("href")).toLowerCase());
  ok(legal.some(t => t.includes("impressum")), () => F("impressum", "hoch", "Kein Link zum Impressum", "In Deutschland muss das Impressum von jeder Seite aus erreichbar sein."));
  ok(legal.some(t => t.includes("datenschutz")), () => F("datenschutz", "hoch", "Kein Link zur Datenschutzerklärung", "Die Datenschutzerklärung muss von jeder Seite aus erreichbar sein."));

  // Formulare
  for (const f of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
    if (!visible(f)) continue;
    const labelled = f.labels?.length || f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.getAttribute("title");
    ok(!!labelled, () => F("label", "mittel", "Eingabefeld ohne Beschriftung", `${f.tagName.toLowerCase()} ${f.name ? `„${f.name}“` : ""} – Platzhaltertext allein reicht nicht.`, f));
  }
  for (const form of document.querySelectorAll("form[action]")) ok(!/^http:\/\//i.test(form.getAttribute("action")), () => F("form-http", "hoch", "Formular sendet unverschlüsselt", form.getAttribute("action"), form));

  // Unverschlüsselte Inhalte
  for (const el of document.querySelectorAll("img[src], script[src], link[href][rel=stylesheet], iframe[src]")) ok(!/^http:\/\//i.test(el.getAttribute("src") || el.getAttribute("href")), () => F("mixed", "mittel", "Unverschlüsselt eingebunden", (el.getAttribute("src") || el.getAttribute("href")).slice(0, 120), el));

  // Platzhalter im Text
  const body = document.body ? document.body.innerText : "";
  const ph = body.match(/lorem ipsum|\bTODO\b|\bXXX\b|platzhalter|\[[^\]]{0,30}(name|text|adresse|telefon)[^\]]{0,30}\]/i);
  ok(!ph, () => F("placeholder", "hoch", "Platzhaltertext auf der Seite", `„${ph[0]}“ steht noch im Text.`));

  // Lesbarkeit: Kontrast und Schriftgröße (je sichtbarem Textelement)
  const rgb = c => { const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== "none") return null; const c = rgb(cs.backgroundColor); if (c && c[3] > 0.9) return c; } return [255, 255, 255, 1]; };
  let checked = 0; const smallText = [];
  for (const el of document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,button,label,span,td,th,small,strong,em,blockquote,figcaption,dt,dd")) {
    if (checked >= 400) break;
    if (![...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim().length > 1) || !visible(el)) continue;
    checked++;
    const cs = getComputedStyle(el), fg = rgb(cs.color), bg = bgOf(el), size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 600;
    if (fg && bg) {
      const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      ok(ratio >= need, () => F("contrast", ratio < need - 1.2 ? "hoch" : "mittel", "Text schwer lesbar (Kontrast)", `„${txt(el)}“: Kontrast ${ratio.toFixed(1)}:1, nötig ${need}:1.`, el));
    }
    if (mobile) { n++; if (size < 12) smallText.push(`„${txt(el).slice(0, 30)}“ ${size} px`); }
  }

  if (smallText.length) out.push(F("font-small", "hinweis", `Schrift auf dem Handy sehr klein (${smallText.length}×)`, `Unter 12 px: ${smallText.slice(0, 4).join(", ")}${smallText.length > 4 ? " …" : ""}.`, null, true));
  // Breite: nichts darf seitlich überstehen (gemessen an der echten Bildschirmbreite, nicht am herausgezoomten Handy-Ausschnitt)
  const vw = document.documentElement.clientWidth, over = document.documentElement.scrollWidth - vw;
  let culprit = null;
  if (over > 1) for (const el of document.body.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0 && (!culprit || r.right > culprit.getBoundingClientRect().right)) culprit = el; }
  ok(over <= 1, () => F("overflow", "hoch", "Seite ist breiter als der Bildschirm", `Man kann ${over} px seitlich wischen${culprit ? ` – verursacht von <${culprit.tagName.toLowerCase()}> „${txt(culprit)}“` : ""}.`, culprit, true));

  // Übersicht für die KI-Prüfer
  const outline = [...document.querySelectorAll("h1,h2,h3,p,li,a,button,label,input,img")].filter(visible).slice(0, 160)
    .map(e => `${e.tagName.toLowerCase()}${e.tagName === "IMG" ? ` alt="${e.getAttribute("alt") || ""}"` : ""}: ${txt(e)}`).join("\n").slice(0, 6000);
  return { n, findings: out, links, outline, height: Math.min(document.documentElement.scrollHeight, 6000) };
})
