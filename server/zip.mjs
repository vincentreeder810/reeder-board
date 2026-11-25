// Einfaches ZIP (Deflate, UTF-8-Dateinamen, ohne Zip64) – übernommen aus dem Theraletik-Buchungskern, ohne Fremdbibliothek.
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

/** entries: [{ path, data: Buffer|string }] → Buffer */
export function createZip(entries, now = new Date()) {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8"), raw = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : e.data;
    const comp = deflateRawSync(raw), crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, comp);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(8, 10);
    h.writeUInt16LE(dosTime, 12); h.writeUInt16LE(dosDate, 14); h.writeUInt32LE(crc, 16); h.writeUInt32LE(comp.length, 20);
    h.writeUInt32LE(raw.length, 24); h.writeUInt16LE(name.length, 28); h.writeUInt32LE(offset, 42);
    central.push(h, name);
    offset += local.length + name.length + comp.length;
  }
  const cb = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cb.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cb, end]);
}
