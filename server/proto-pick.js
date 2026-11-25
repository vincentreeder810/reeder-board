/* Wird in jede Prototyp-Seite eingesetzt (Baustein H3): erkennt das Element unter einer Anmerkung und zeigt
   gewünschte Änderungen vorübergehend an. Nimmt nur Nachrichten vom Viewer (parent) an; ändert nichts dauerhaft. */
(() => {
  if (parent === window) return;
  const PROPS = ["fontSize", "fontWeight", "color", "backgroundColor", "textAlign", "marginTop", "marginBottom", "paddingTop", "paddingBottom", "borderRadius"];
  const SAFE = /^[#\w\s.,%()\-]{1,40}$/;
  const orig = new Map();
  const kindOf = el => {
    const t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img" || t === "picture" || t === "svg" || t === "video") return "image";
    if (t === "button" || (t === "a" && /btn|button|cta/i.test(String(el.className)))) return "button";
    if (t === "a") return "link";
    if (["p", "li", "span", "small", "strong", "em", "b", "label", "blockquote", "figcaption", "td", "th", "dt", "dd"].includes(t)) return "text";
    return "block";
  };
  const meaningful = el => (el.closest && el.closest("h1,h2,h3,h4,h5,h6,p,li,a,button,img,picture,svg,video,label,blockquote,figcaption,td,th,dt,dd")) || el;
  const selOf = el => {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift("#" + el.id); break; }
      let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
      parts.unshift(el.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
      el = el.parentElement;
    }
    return parts.join(">");
  };
  const textEditable = el => kindOf(el) !== "image" && !!el.textContent.trim() && !el.querySelector("img,svg,video,input,select,textarea,button,ul,ol,table,div,section,p,h1,h2,h3,h4,h5,h6");
  function info(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), style = {};
    for (const k of PROPS) style[k] = cs[k];
    style.fontFamily = (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();
    return { sel: selOf(el), tag: el.tagName.toLowerCase(), kind: kindOf(el), editable: textEditable(el),
      text: String(el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 200),
      style, rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } };
  }
  // Farben, die auf der Seite tatsächlich vorkommen (die „Markenpalette“ des Entwurfs)
  function palette() {
    const count = new Map(), add = c => { if (!c || /rgba\(.*,\s*0\)$|transparent/.test(c)) return; count.set(c, (count.get(c) || 0) + 1); };
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    for (let i = 0; i < all.length && i < 2500; i++) { const cs = getComputedStyle(all[i]); add(cs.color); add(cs.backgroundColor); }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 10);
  }
  function restore(el) { const o = orig.get(el); if (!o) return; if (o.style === null) el.removeAttribute("style"); else el.setAttribute("style", o.style); el.innerHTML = o.html; }
  addEventListener("message", e => {
    if (e.source !== parent) return;
    const d = e.data || {};
    if (d.rs === "pick") {
      let el = document.elementFromPoint((+d.x || 0) - scrollX, (+d.y || 0) - scrollY);
      if (!el || el === document.documentElement || el === document.body) { parent.postMessage({ rs: "picked", id: d.id, info: null }, "*"); return; }
      el = meaningful(el);
      parent.postMessage({ rs: "picked", id: d.id, info: info(el), palette: palette() }, "*");
    }
    if (d.rs === "preview") {
      let el = null; try { el = document.querySelector(String(d.sel || "")); } catch (_) {}
      if (!el) { parent.postMessage({ rs: "previewed", ok: false }, "*"); return; }
      for (const [x] of orig) if (x !== el) restore(x);
      if (!orig.has(el)) orig.set(el, { style: el.getAttribute("style"), html: el.innerHTML });
      restore(el);
      const css = d.css || {};
      for (const k of PROPS) if (typeof css[k] === "string" && SAFE.test(css[k])) el.style[k] = css[k];
      if (typeof d.text === "string" && textEditable(el)) el.textContent = d.text.slice(0, 800);
      if (d.mark !== false) { el.style.outline = "2px dashed #8b5cf6"; el.style.outlineOffset = "4px"; }
      if (d.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
      parent.postMessage({ rs: "previewed", ok: true }, "*");
    }
    if (d.rs === "reset") { for (const [x] of orig) restore(x); orig.clear(); }
    // Übersicht aller sichtbaren Elemente – damit der KI-Assistent auch grobe Markierungen zuordnen kann
    if (d.rs === "outline") {
      const list = [];
      for (const el of document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,button,img,picture,svg,video,label,blockquote,figcaption,td,th,dt,dd,header,section,footer,nav,form")) {
        if (list.length >= 250) break;
        if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
        const i = info(el);
        list.push({ sel: i.sel, kind: i.kind, tag: i.tag, text: i.text.slice(0, 120), editable: i.editable, x: Math.round(i.rect.x), y: Math.round(i.rect.y), w: Math.round(i.rect.w), h: Math.round(i.rect.h),
          style: { fontSize: i.style.fontSize, fontWeight: i.style.fontWeight, color: i.style.color, backgroundColor: i.style.backgroundColor, textAlign: i.style.textAlign, marginTop: i.style.marginTop, marginBottom: i.style.marginBottom } });
      }
      parent.postMessage({ rs: "outline", id: d.id, list, palette: palette() }, "*");
    }
  });
})();
