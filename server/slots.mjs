// Freie Termine berechnen: Arbeitszeiten minus Sperrtage minus bereits angefragte/bestätigte Termine.
import { db, getSetting, DEFAULT_AVAILABILITY } from "./db.mjs";

/* ---------- Zeitzonen-Helfer (Wanduhrzeit Europe/Berlin <-> UTC) ---------- */
function offsetMinutes(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split("-").map(Number), [H, M] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  let ts = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const off2 = offsetMinutes(new Date(ts), tz);
  ts = guess - off2 * 60000;
  return new Date(ts);
}
export function zonedParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
export function formatDe(iso, tz = DEFAULT_AVAILABILITY.timeZone) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " Uhr";
}
const toMin = hm => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const pad = n => String(n).padStart(2, "0");
const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const weekday = ymd => { const [y, m, d] = ymd.split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w === 0 ? 7 : w; };

export const ACTIVE_STATES = ["neu", "bestaetigt"];

/** Freie Startzeiten je Tag für einen Termintyp im Bereich [from, to] (YYYY-MM-DD, Berliner Kalendertage). */
export function freeSlots(typeKey, from, to) {
  const av = getSetting("availability", DEFAULT_AVAILABILITY);
  const type = av.types[typeKey];
  if (!type || type.active === false) return {};
  const tz = av.timeZone, now = Date.now();
  const earliest = now + av.leadHours * 3600000;
  const todayYmd = zonedParts(new Date(), tz).ymd;
  const lastYmd = addDays(todayYmd, av.horizonDays);
  if (from < todayYmd) from = todayYmd;
  if (to > lastYmd) to = lastYmd;
  if (from > to) return {};

  const rangeStart = zonedToUtc(from, "00:00", tz).getTime() - 86400000;
  const rangeEnd = zonedToUtc(addDays(to, 1), "00:00", tz).getTime() + 86400000;
  const busy = db.prepare(`SELECT start, minutes, type FROM bookings WHERE status IN (${ACTIVE_STATES.map(() => "?").join(",")})`)
    .all(...ACTIVE_STATES)
    .map(b => { const s = Date.parse(b.start); const buf = (av.types[b.type]?.buffer ?? 0) * 60000; return [s - buf, s + b.minutes * 60000 + buf]; })
    .filter(([s, e]) => e > rangeStart && s < rangeEnd);
  const blocked = (av.blocked || []).filter(b => b.from && b.to);

  const out = {};
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (blocked.some(b => day >= b.from && day <= b.to)) continue;
    const windows = av.weekly[weekday(day)] || [];
    const list = [];
    for (const [a, b] of windows) {
      for (let t = toMin(a); t + type.minutes <= toMin(b); t += av.step) {
        const hm = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
        const s = zonedToUtc(day, hm, tz).getTime(), e = s + type.minutes * 60000, buf = (type.buffer || 0) * 60000;
        if (s < earliest) continue;
        if (busy.some(([bs, be]) => s - buf < be && e + buf > bs)) continue;
        list.push({ t: hm, start: new Date(s).toISOString() });
      }
    }
    if (list.length) out[day] = list;
  }
  return out;
}

export function isSlotFree(typeKey, startIso) {
  const av = getSetting("availability", DEFAULT_AVAILABILITY);
  const { ymd } = zonedParts(new Date(startIso), av.timeZone);
  return (freeSlots(typeKey, ymd, ymd)[ymd] || []).some(s => s.start === new Date(startIso).toISOString());
}
