// A minimal ZIP writer: files stored as they are (no compression: JPEGs are already compressed), UTF-8 names.
// zip([{ name, data: Buffer, date? }]) -> Buffer. Used for "Download all photos" (a ride's photos in one file).
const zlib = require('zlib');

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), crc = zlib.crc32(f.data), { time, date } = dosTime(f.date || new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(f.data.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, name, f.data);
    central.push(cen, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { zip };
