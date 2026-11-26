// Minimal FIT activity encoder (Garmin's binary format). Marked sport = cycling, sub_sport = virtual_activity,
// which is how Zwift's files look: Strava files the upload as a "Virtual Ride" automatically.
// Samples come from the Recorder: { time, lat, lon, ele, distance, speed, power, hr, cadence }.

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in Unix seconds
const ts = (d) => Math.round(d.getTime() / 1000) - FIT_EPOCH;
const semicircles = (deg) => Math.round(deg * (2 ** 31 / 180));

// base types: [code, size]
const T = { enum: [0x00, 1], uint8: [0x02, 1], uint16: [0x84, 2], sint32: [0x85, 4], uint32: [0x86, 4], uint32z: [0x8c, 4] };
const INVALID = { enum: 0xff, uint8: 0xff, uint16: 0xffff, sint32: 0x7fffffff, uint32: 0xffffffff, uint32z: 0 };

function crc16(bytes) {
  const tbl = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (const b of bytes) {
    let t = tbl[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ tbl[b & 0xf];
    t = tbl[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ tbl[(b >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  constructor() { this.bytes = []; this.defs = new Map(); }
  u8(v) { this.bytes.push(v & 0xff); }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  // message: { local, global, fields: [[fieldNum, type, value], ...] }; a definition is written when the layout changes
  msg(local, global, fields) {
    const key = `${global}:${fields.map((f) => f[0] + f[1]).join(',')}`;
    if (this.defs.get(local) !== key) {
      this.defs.set(local, key);
      this.u8(0x40 | local); this.u8(0); this.u8(0); this.u16(global); this.u8(fields.length);
      for (const [num, type] of fields) { this.u8(num); this.u8(T[type][1]); this.u8(T[type][0]); }
    }
    this.u8(local);
    for (const [, type, value] of fields) {
      const v = value == null || Number.isNaN(value) ? INVALID[type] : value;
      const size = T[type][1];
      if (size === 1) this.u8(v); else if (size === 2) this.u16(v); else this.u32(v >>> 0);
    }
  }
}

export function toFit(samples, { name = 'RideWorld ride', elapsed } = {}) {
  if (!samples.length) throw new Error('Nothing recorded yet');
  const w = new Writer();
  const start = samples[0].time, end = samples[samples.length - 1].time;
  const total = elapsed ?? (end - start) / 1000;
  const clamp = (v, max) => (v == null ? null : Math.max(0, Math.min(max, Math.round(v))));

  w.msg(0, 0, [[0, 'enum', 4], [1, 'uint16', 255], [2, 'uint16', 1], [3, 'uint32z', 1], [4, 'uint32', ts(start)]]); // file_id: activity, "development"
  w.msg(6, 12, [[0, 'enum', 2], [1, 'enum', 58]]); // sport: cycling, virtual activity
  w.msg(1, 21, [[253, 'uint32', ts(start)], [0, 'enum', 0], [1, 'enum', 0]]); // event: timer start
  for (const s of samples) {
    w.msg(2, 20, [
      [253, 'uint32', ts(s.time)],
      [0, 'sint32', s.lat == null ? null : semicircles(s.lat)],
      [1, 'sint32', s.lon == null ? null : semicircles(s.lon)],
      [2, 'uint16', s.ele == null ? null : clamp((s.ele + 500) * 5, 0xfffe)],
      [3, 'uint8', s.hr ? clamp(s.hr, 254) : null],
      [4, 'uint8', s.cadence == null ? null : clamp(s.cadence, 254)],
      [5, 'uint32', clamp(s.distance * 100, 0xfffffffe)],
      [6, 'uint16', clamp(s.speed * 1000, 0xfffe)],
      [7, 'uint16', s.power == null ? null : clamp(s.power, 0xfffe)],
    ]);
  }
  w.msg(1, 21, [[253, 'uint32', ts(end)], [0, 'enum', 0], [1, 'enum', 4]]); // event: timer stop_all

  const n = samples.length, last = samples[n - 1];
  const avg = (k) => samples.reduce((a, s) => a + (s[k] || 0), 0) / n;
  const hrs = samples.filter((s) => s.hr > 0);
  let ascent = 0;
  for (let i = 1; i < n; i++) if (samples[i].ele > samples[i - 1].ele) ascent += samples[i].ele - samples[i - 1].ele;
  const totals = [
    [253, 'uint32', ts(end)], [2, 'uint32', ts(start)],
    [7, 'uint32', Math.round(total * 1000)], [8, 'uint32', Math.round(total * 1000)],
    [9, 'uint32', Math.round(last.distance * 100)],
  ];
  w.msg(3, 19, [...totals, [0, 'enum', 9], [1, 'enum', 1], [25, 'enum', 2], [39, 'enum', 58]]); // lap: cycling, virtual
  w.msg(4, 18, [
    ...totals, [0, 'enum', 8], [1, 'enum', 1],
    [5, 'enum', 2], [6, 'enum', 58],                                  // sport cycling, sub_sport virtual_activity
    [20, 'uint16', Math.round(avg('power'))], [21, 'uint16', Math.round(Math.max(...samples.map((s) => s.power || 0)))],
    [16, 'uint8', hrs.length ? Math.round(hrs.reduce((a, s) => a + s.hr, 0) / hrs.length) : null],
    [17, 'uint8', hrs.length ? Math.max(...hrs.map((s) => s.hr)) : null],
    [18, 'uint8', Math.round(avg('cadence'))], [22, 'uint16', Math.round(ascent)],
    [25, 'uint16', 0], [26, 'uint16', 1],
  ]);
  w.msg(5, 34, [[253, 'uint32', ts(end)], [0, 'uint32', Math.round(total * 1000)], [1, 'uint16', 1], [2, 'enum', 0], [3, 'enum', 26], [4, 'enum', 1]]); // activity

  const data = w.bytes;
  const header = [14, 0x20, ...[2132 & 0xff, 2132 >> 8], data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, (data.length >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54];
  const hcrc = crc16(header);
  const file = [...header, hcrc & 0xff, hcrc >> 8, ...data];
  const crc = crc16(file);
  file.push(crc & 0xff, crc >> 8);
  return new Uint8Array(file);
}

// A route as a FIT course (file type 6): for loading onto a bike computer. Points are given timestamps 1 s apart
// (courses need them; devices ignore them for navigation). pts: [{ lat, lon, ele }]
export function toFitCourse(pts) {
  if (pts.length < 2) throw new Error('Route too short');
  const w = new Writer(), start = new Date(Date.UTC(2026, 0, 1));
  const at = (i) => ts(new Date(start.getTime() + i * 1000));
  const cum = [0], k = Math.PI / 180;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum.push(cum[i - 1] + Math.hypot((b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), (b.lat - a.lat) * k) * 6371000);
  }
  const n = pts.length - 1, total = cum[n];
  w.msg(0, 0, [[0, 'enum', 6], [1, 'uint16', 255], [2, 'uint16', 1], [3, 'uint32z', 1], [4, 'uint32', at(0)]]); // file_id: course
  w.msg(6, 31, [[4, 'enum', 2]]); // course: cycling
  w.msg(3, 19, [[253, 'uint32', at(n)], [2, 'uint32', at(0)], [3, 'sint32', semicircles(pts[0].lat)], [4, 'sint32', semicircles(pts[0].lon)],
    [5, 'sint32', semicircles(pts[n].lat)], [6, 'sint32', semicircles(pts[n].lon)], [7, 'uint32', n * 1000], [8, 'uint32', n * 1000], [9, 'uint32', Math.round(total * 100)]]); // lap
  w.msg(1, 21, [[253, 'uint32', at(0)], [0, 'enum', 0], [1, 'enum', 0]]); // timer start
  pts.forEach((p, i) => w.msg(2, 20, [[253, 'uint32', at(i)], [0, 'sint32', semicircles(p.lat)], [1, 'sint32', semicircles(p.lon)],
    [2, 'uint16', Number.isFinite(p.ele) ? Math.max(0, Math.min(0xfffe, Math.round((p.ele + 500) * 5))) : null], [5, 'uint32', Math.round(cum[i] * 100)]]));
  w.msg(1, 21, [[253, 'uint32', at(n)], [0, 'enum', 0], [1, 'enum', 9]]); // timer stop_disable_all
  const data = w.bytes;
  const header = [14, 0x20, 2132 & 0xff, 2132 >> 8, data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, (data.length >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54];
  const hcrc = crc16(header);
  const file = [...header, hcrc & 0xff, hcrc >> 8, ...data];
  const crc = crc16(file);
  file.push(crc & 0xff, crc >> 8);
  return new Uint8Array(file);
}
