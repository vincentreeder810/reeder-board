/* Bilder für den Vorab-Entwurf
   1) von der bisherigen Website des Interessenten – nur mit seiner ausdrücklichen Erlaubnis im Fragebogen
   2) lizenzfreie Fotos von Pexels (nur wenn PEXELS_API_KEY gesetzt ist)
   Alle Bilder werden in den Ordner des Entwurfs kopiert (img/…) – der Entwurf lädt nichts von fremden Servern. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export const stockAvailable = () => !!(process.env.PEXELS_API_KEY || "").trim();

/* ---------- Sicherheit: nur öffentliche Adressen (kein Zugriff aufs eigene Netz über die Fragebogen-Eingabe) ---------- */
function privateIp(ip) {
  if (isIP(ip) === 6) { const s = ip.toLowerCase(); return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") || (s.startsWith("::ffff:") && privateIp(s.slice(7))); }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function safeUrl(raw) {
  let u; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (process.env.VORAB_ALLOW_LOCAL === "1") return u;   // nur für Tests
  if (u.port && !["80", "443"].includes(u.port)) return null;
  try { const addrs = await lookup(u.hostname, { all: true }); if (!addrs.length || addrs.some(x => privateIp(x.address))) return null; } catch { return null; }
  return u;
}
async function get(raw, { maxBytes = MAX_BYTES, headers = {} } = {}) {
  let u = await safeUrl(raw);
  for (let hop = 0; u && hop < 4; hop++) {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (compatible; ReederVorab/1.0)", ...headers } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = await safeUrl(new URL(r.headers.get("location"), u).href); continue; }
    if (!r.ok) return null;
    if (+r.headers.get("content-length") > maxBytes) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > maxBytes) return null;
    return { buf, type: (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), url: u.href };
  }
  return null;
}

/* ---------- Bildgröße aus den Dateiköpfen (JPEG, PNG, WebP) ---------- */
export function imageSize(b) {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const f = b.toString("ascii", 12, 16);
      if (f === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (f === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (f === "VP8L") { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) }; }
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + len; }
    }
  } catch {}
  return null;
}

/* ---------- 1) Bilder der bisherigen Website ---------- */
export async function websiteImages(siteUrl, dir, limit = 10) {
  const page = await get(siteUrl, { maxBytes: 3 * 1024 * 1024 }); if (!page || !/html/.test(page.type)) return [];
  const html = page.buf.toString("utf8"), found = new Map();
  const add = (src, alt = "", hint = "") => { if (!src || src.startsWith("data:")) return; try { const abs = new URL(src.trim(), page.url).href; if (!found.has(abs)) found.set(abs, { alt, hint }); } catch {} };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi)) add((m[0].match(/content=["']([^"']+)/i) || [])[1], "", "Vorschaubild der Website");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], attr = n => (tag.match(new RegExp(`\\s${n}=["']([^"']+)`, "i")) || [])[1];
    const set = attr("srcset") || attr("data-srcset");
    const best = set ? set.split(",").map(s => s.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] || 0) - parseInt(a[1] || 0))[0]?.[0] : null;
    add(best || attr("data-src") || attr("src"), attr("alt") || "", /logo/i.test(tag) ? "Logo" : "");
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)/gi)) add(m[1], "", "Hintergrundbild");
  await mkdir(path.join(dir, "img"), { recursive: true });
  const out = [];
  for (const [src, info] of [...found].slice(0, 40)) {
    if (out.length >= limit) break;
    if (/\.svg(\?|$)/i.test(src)) continue;
    const r = await get(src).catch(() => null); if (!r || !TYPES[r.type] || r.buf.length < 6000) continue;
    const size = imageSize(r.buf); if (!size || (info.hint !== "Logo" && (size.w < 360 || size.h < 200))) continue;
    const name = `img/website-${out.length + 1}${TYPES[r.type]}`;
    await writeFile(path.join(dir, name), r.buf);
    out.push({ file: name, w: size.w, h: size.h, source: "website", alt: info.alt.slice(0, 140), hint: info.hint, bytes: r.buf.length, mime: r.type });
  }
  return out;
}

/* ---------- 1b) Website im echten Browser: auch nachgeladene Bilder, AVIF, Hintergrundbilder + Bildschirmfotos als Referenz ---------- */
const blockedHost = h => { h = h.replace(/^\[|\]$/g, "").toLowerCase(); return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || (isIP(h) && privateIp(h)); };
async function toWebp(b, buf, mime) {
  // AVIF & Co. im Browser über ein Canvas in WebP umwandeln (data:-Bilder „verschmutzen“ das Canvas nicht)
  const r = await b.cmd("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(ok => { const i = new Image(); i.onload = () => { const s = Math.min(1, 2200 / Math.max(i.naturalWidth, i.naturalHeight)), c = document.createElement("canvas");
    c.width = Math.round(i.naturalWidth * s); c.height = Math.round(i.naturalHeight * s); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); ok(c.toDataURL("image/webp", .86)); }; i.onerror = () => ok(null);
    i.src = "data:${mime};base64,${buf.toString("base64")}"; })` });
  const d = r.result?.value; return d?.startsWith("data:image/webp") ? Buffer.from(d.split(",")[1], "base64") : null;
}
export async function websiteCapture(siteUrl, dir, limit = 12) {
  const start = await safeUrl(siteUrl); if (!start) return { images: [], shots: [] };
  const { withBrowser, loadPage, browserPath } = await import("./browser.mjs");
  if (!browserPath()) return { images: await websiteImages(siteUrl, dir, limit), shots: [] };
  await mkdir(path.join(dir, "img"), { recursive: true });
  return withBrowser(async b => {
    // Schutz: der Browser darf aus der fremden Seite heraus nichts im eigenen Netz aufrufen
    if (process.env.VORAB_ALLOW_LOCAL !== "1") {
      await b.cmd("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      b.on("Fetch.requestPaused", p => { let h = ""; try { h = new URL(p.request.url).hostname; } catch {}
        (blockedHost(h) ? b.cmd("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }) : b.cmd("Fetch.continueRequest", { requestId: p.requestId })).catch(() => {}); });
    }
    await loadPage(b, start.href, { w: 1440, h: 900 });
    const ev = async e => (await b.cmd("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
    const H = Math.min(await ev("document.documentElement.scrollHeight") || 900, 14000);
    for (let y = 0; y < H; y += 700) { await ev(`window.scrollTo(0, ${y}), 1`); await b.sleep(160); }
    await ev("window.scrollTo(0, 0), 1"); await b.sleep(900);
    // Referenz: erster Bildschirm und zwei weitere Stellen der bisherigen Seite
    const shots = [];
    for (const y of [0, Math.round(H * .3), Math.round(H * .6)]) {
      if (y && y + 900 > H) continue;
      await ev(`window.scrollTo(0, ${y}), 1`); await b.sleep(700);
      const s = await b.cmd("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 0, y, width: 1440, height: 900, scale: .6 } }).catch(() => null);
      if (s?.data) shots.push(Buffer.from(s.data, "base64"));
    }
    const found = await ev(`(() => { const out = [], seen = new Set(), add = (src, o) => { if (!src || src.startsWith("data:") || seen.has(src)) return; seen.add(src); out.push({ src, ...o }); };
      for (const i of document.images) { const r = i.getBoundingClientRect(); add(i.currentSrc || i.src, { nw: i.naturalWidth, nh: i.naturalHeight, area: Math.round(r.width * r.height), alt: (i.alt || "").slice(0, 140), logo: /logo/i.test(i.className + " " + i.alt + " " + (i.currentSrc || i.src) + " " + (i.closest("a[href='/'],header,nav") ? "logo" : "")) && r.width < 420 }); }
      for (const el of document.querySelectorAll("body *")) { const m = getComputedStyle(el).backgroundImage.match(/url\\(["']?([^"')]+)/); if (!m) continue; const r = el.getBoundingClientRect(); try { add(new URL(m[1], location.href).href, { nw: 0, nh: 0, area: Math.round(r.width * r.height), alt: "", logo: false, bg: true }); } catch {} }
      const videos = [...document.querySelectorAll("video")].map(v => { const r = v.getBoundingClientRect(); return { src: v.currentSrc || v.querySelector("source[src$='.mp4'],source[type='video/mp4'],source")?.src || "", poster: v.poster || "", area: Math.round(r.width * r.height) }; }).filter(v => v.src && !v.src.startsWith("blob:")).sort((a, b) => b.area - a.area);
      window.__videos = videos;
      const og = document.querySelector("meta[property='og:image']")?.content; if (og) try { add(new URL(og, location.href).href, { nw: 0, nh: 0, area: 1, alt: "Vorschaubild der Website", logo: false }); } catch {}
      return out; })()`) || [];
    const videos = await ev("window.__videos || []") || [];
    const DECOR = /decor|pattern|shape|blob|noise|texture|gradient|placeholder|spacer|icon/i;
    const logo = found.find(f => f.logo);
    const big = found.filter(f => !f.logo && !DECOR.test(f.src) && (f.area > 60000 || (f.nw >= 600 && f.nh >= 340))).sort((x, y) => y.area - x.area);
    const out = [];
    // Videos der Seite (z. B. Hintergrundvideo im ersten Bildschirm) – höchstens zwei, je bis 25 MB
    for (const v of videos.slice(0, 4)) {
      if (out.filter(o => o.video).length >= 2) break;
      const r = await get(v.src, { maxBytes: 25 * 1024 * 1024 }).catch(() => null);
      if (!r || !/^video\/(mp4|webm)$/.test(r.type)) continue;
      const name = `img/video-${out.filter(o => o.video).length + 1}.${r.type === "video/webm" ? "webm" : "mp4"}`;
      await writeFile(path.join(dir, name), r.buf);
      out.push({ file: name, w: 0, h: 0, source: "website", alt: "", hint: v.area > 400000 ? "Hintergrundvideo des ersten Bildschirms" : "Video der Website", bytes: r.buf.length, mime: r.type, video: true, novision: true });
    }
    for (const f of [...(logo ? [logo] : []), ...big]) {
      if (out.filter(o => !o.video).length >= limit) break;
      const r = await get(f.src).catch(() => null); if (!r) continue;
      let buf = r.buf, mime = r.type;
      if (mime === "image/svg+xml" && f.logo && buf.length < 300000) { const name = "img/logo.svg"; await writeFile(path.join(dir, name), buf); out.push({ file: name, w: 0, h: 0, source: "website", alt: f.alt, hint: "Logo", bytes: buf.length, mime, novision: true }); continue; }
      if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(mime) || buf.length < 5000) continue;
      if (mime === "image/avif" || mime === "image/gif") { buf = await toWebp(b, buf, mime); mime = "image/webp"; if (!buf) continue; }
      const size = imageSize(buf); if (!size || (!f.logo && (size.w < 480 || size.h < 260))) continue;
      const name = `img/website-${out.filter(o => !o.video).length + 1}${TYPES[mime]}`;
      await writeFile(path.join(dir, name), buf);
      out.push({ file: name, w: size.w, h: size.h, source: "website", alt: f.alt, hint: f.logo ? "Logo" : f.bg ? "Standbild/Hintergrundbild" : "", bytes: buf.length, mime });
    }
    return { images: out, shots };
  });
}

/* ---------- 2) Lizenzfreie Fotos (Pexels-Lizenz: kostenlose Nutzung, Namensnennung freiwillig) ---------- */
export async function stockImages(queries, dir, limit = 8) {
  if (!stockAvailable()) return [];
  await mkdir(path.join(dir, "img"), { recursive: true });
  const out = [], seen = new Set();
  for (const q of queries.filter(Boolean).slice(0, 3)) {
    if (out.length >= limit) break;
    const r = await fetch(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: "6", locale: "de-DE" })}`,
      { headers: { Authorization: process.env.PEXELS_API_KEY.trim() }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r?.ok) continue;
    const data = await r.json().catch(() => ({}));
    for (const p of data.photos || []) {
      if (out.length >= limit || seen.has(p.id)) continue; seen.add(p.id);
      const img = await get(p.src?.large2x || p.src?.large).catch(() => null); if (!img || !TYPES[img.type]) continue;
      const size = imageSize(img.buf) || { w: p.width, h: p.height };
      const name = `img/foto-${out.length + 1}${TYPES[img.type]}`;
      await writeFile(path.join(dir, name), img.buf);
      out.push({ file: name, w: size.w, h: size.h, source: "pexels", alt: (p.alt || q).slice(0, 140), credit: `Foto: ${p.photographer} / Pexels`, link: p.url, bytes: img.buf.length, mime: img.type });
    }
  }
  return out;
}
