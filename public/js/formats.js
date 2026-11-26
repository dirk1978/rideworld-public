// File formats besides RideWorld's own GPX and FIT writers: reading FIT files (rides and courses), turning TCX,
// KML or FIT routes into GPX for import, and writing rides and routes as GPX, TCX and KML.
// Ride samples: { time (Date), lat, lon, ele, distance (m), speed (m/s), power, hr, cadence }.
// Route points: { lat, lon, ele }.

const xmlEsc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fx = (v, n) => (Number.isFinite(v) ? v.toFixed(n) : null);

// ---------- reading FIT (Garmin's binary format) ----------
// Just the record messages (one per second or so: position, height, distance, speed, power, heart rate, cadence),
// from any device's activity or course file. Developer fields are skipped.
const FIT_EPOCH = 631065600;
const INVALID = { 0: 0xff, 1: 0x7f, 2: 0xff, 3: 0x7fff, 4: 0xffff, 5: 0x7fffffff, 6: 0xffffffff, 10: 0, 11: 0, 12: 0, 13: 0xff };
const SIZE = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 10: 1, 11: 2, 12: 4, 13: 1 };

export function readFit(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12 || String.fromCharCode(b[8], b[9], b[10], b[11]) !== '.FIT') throw new Error('Not a FIT file');
  const headerSize = b[0], end = Math.min(b.length, headerSize + v.getUint32(4, true));
  const defs = [], records = [];
  let i = headerSize, lastTs = 0;
  const read = (pos, base, size, le) => {
    const t = base & 0x1f;
    if (SIZE[t] !== size) return null; // arrays, strings, 64-bit: not needed
    let x;
    if (size === 1) x = t === 1 ? v.getInt8(pos) : v.getUint8(pos);
    else if (size === 2) x = t === 3 ? v.getInt16(pos, le) : v.getUint16(pos, le);
    else x = t === 5 ? v.getInt32(pos, le) : v.getUint32(pos, le);
    return x === INVALID[t] ? null : x;
  };
  while (i < end) {
    const h = b[i++];
    let local, ts = null;
    if (h & 0x80) { // compressed timestamp header
      local = (h >> 5) & 3;
      const off = h & 0x1f;
      ts = (lastTs & ~0x1f) + off + (off < (lastTs & 0x1f) ? 0x20 : 0);
      lastTs = ts;
    } else if (h & 0x40) { // definition
      local = h & 0x0f;
      const le = b[i + 1] === 0, global = le ? v.getUint16(i + 2, true) : v.getUint16(i + 2, false), n = b[i + 4];
      i += 5;
      const fields = [];
      for (let k = 0; k < n; k++, i += 3) fields.push([b[i], b[i + 1], b[i + 2]]);
      let dev = 0;
      if (h & 0x20) { const nd = b[i++]; for (let k = 0; k < nd; k++, i += 3) dev += b[i + 1]; }
      defs[local] = { le, global, fields, dev };
      continue;
    } else local = h & 0x0f;
    const d = defs[local];
    if (!d) throw new Error('Damaged FIT file');
    const m = {};
    for (const [num, size, base] of d.fields) { m[num] = read(i, base, size, d.le); i += size; }
    i += d.dev;
    if (m[253] != null) lastTs = m[253];
    if (d.global !== 20) continue;
    const t = m[253] ?? ts;
    const alt = m[78] ?? m[2];
    records.push({
      time: t == null ? null : new Date((t + FIT_EPOCH) * 1000),
      lat: m[0] == null ? null : m[0] * (180 / 2 ** 31), lon: m[1] == null ? null : m[1] * (180 / 2 ** 31),
      ele: alt == null ? null : alt / 5 - 500, distance: m[5] == null ? null : m[5] / 100,
      speed: (m[73] ?? m[6]) == null ? null : (m[73] ?? m[6]) / 1000, power: m[7], hr: m[3], cadence: m[4],
    });
  }
  return records;
}

// ---------- routes: anything -> GPX (import) ----------
export function pointsToGpx(name, pts) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RideWorld" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${xmlEsc(name)}</name><trkseg>
${pts.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`).join('\n')}
</trkseg></trk>
</gpx>
`;
}

// A route file as GPX text: GPX as it is, TCX / KML / FIT converted. Throws if there's no track in it.
export async function routeFileToGpx(file) {
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || '').toLowerCase(), name = file.name.replace(/\.\w+$/, '');
  if (ext === 'gpx') return { name, gpx: await file.text() };
  let pts = [];
  if (ext === 'fit') {
    pts = readFit(await file.arrayBuffer()).filter((r) => r.lat != null && r.lon != null).map((r) => ({ lat: r.lat, lon: r.lon, ele: r.ele }));
  } else if (ext === 'tcx' || ext === 'kml') {
    const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`Not a valid ${ext.toUpperCase()} file`);
    const tag = (el, n) => el.getElementsByTagName(n)[0]?.textContent;
    if (ext === 'tcx') {
      for (const tp of doc.getElementsByTagName('Trackpoint')) {
        const lat = +tag(tp, 'LatitudeDegrees'), lon = +tag(tp, 'LongitudeDegrees'), ele = tag(tp, 'AltitudeMeters');
        if (Number.isFinite(lat) && Number.isFinite(lon) && tag(tp, 'LatitudeDegrees')) pts.push({ lat, lon, ele: ele == null ? null : +ele });
      }
    } else {
      // gx:Track (lon lat ele per gx:coord) or the longest LineString (lon,lat,ele triples)
      const coords = doc.getElementsByTagName('gx:coord');
      if (coords.length) for (const c of coords) { const [lon, lat, ele] = c.textContent.trim().split(/\s+/).map(Number); pts.push({ lat, lon, ele }); }
      else {
        let best = [];
        for (const ls of doc.getElementsByTagName('LineString')) {
          const p = (tag(ls, 'coordinates') || '').trim().split(/\s+/).map((t) => { const [lon, lat, ele] = t.split(',').map(Number); return { lat, lon, ele }; });
          if (p.length > best.length) best = p;
        }
        pts = best;
      }
    }
  } else throw new Error('Use a GPX, TCX, FIT or KML file');
  pts = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) throw new Error(`No route found in that ${ext.toUpperCase()} file`);
  return { name, gpx: pointsToGpx(name, pts) };
}

// ---------- routes: export ----------
const cumDist = (pts) => {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], k = Math.PI / 180;
    const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k;
    out.push(out[i - 1] + Math.hypot(x, y) * 6371000);
  }
  return out;
};

export function routeToTcx(name, pts) {
  const cum = cumDist(pts), n = xmlEsc(name.slice(0, 15)); // TCX course names are limited to 15 characters
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Courses><Course><Name>${n}</Name>
    <Lap><TotalTimeSeconds>0</TotalTimeSeconds><DistanceMeters>${cum.at(-1).toFixed(1)}</DistanceMeters>
      <BeginPosition><LatitudeDegrees>${pts[0].lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${pts[0].lon.toFixed(7)}</LongitudeDegrees></BeginPosition>
      <EndPosition><LatitudeDegrees>${pts.at(-1).lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${pts.at(-1).lon.toFixed(7)}</LongitudeDegrees></EndPosition>
      <Intensity>Active</Intensity></Lap>
    <Track>
${pts.map((p, i) => `      <Trackpoint><Time>${new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()}</Time><Position><LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${p.lon.toFixed(7)}</LongitudeDegrees></Position>${Number.isFinite(p.ele) ? `<AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>` : ''}<DistanceMeters>${cum[i].toFixed(1)}</DistanceMeters></Trackpoint>`).join('\n')}
    </Track>
  </Course></Courses>
</TrainingCenterDatabase>
`;
}

export function routeToKml(name, pts) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(name)}</name>
<Style id="line"><LineStyle><color>ff1a6aff</color><width>4</width></LineStyle></Style>
<Placemark><name>${xmlEsc(name)}</name><styleUrl>#line</styleUrl><LineString><altitudeMode>clampToGround</altitudeMode><coordinates>
${pts.map((p) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${fx(p.ele, 1) ?? 0}`).join('\n')}
</coordinates></LineString></Placemark>
</Document></kml>
`;
}

// ---------- rides: export ----------
export function samplesToTcx(samples, name = 'Indoor ride') {
  const iso = (d) => d.toISOString(), first = samples[0], last = samples[samples.length - 1];
  const totalSec = last ? (last.time - first.time) / 1000 : 0;
  const tps = samples.map((s) => `
        <Trackpoint>
          <Time>${iso(s.time)}</Time>${s.lat != null ? `
          <Position><LatitudeDegrees>${s.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${s.lon.toFixed(7)}</LongitudeDegrees></Position>` : ''}${s.ele != null ? `
          <AltitudeMeters>${s.ele.toFixed(1)}</AltitudeMeters>` : ''}
          <DistanceMeters>${(s.distance || 0).toFixed(1)}</DistanceMeters>${s.hr ? `
          <HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>` : ''}
          <Cadence>${Math.round(s.cadence || 0)}</Cadence>
          <Extensions><ns3:TPX><ns3:Speed>${(s.speed || 0).toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(s.power || 0)}</ns3:Watts></ns3:TPX></Extensions>
        </Trackpoint>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${iso(first?.time || new Date())}</Id>
      <Lap StartTime="${iso(first?.time || new Date())}">
        <TotalTimeSeconds>${totalSec.toFixed(0)}</TotalTimeSeconds>
        <DistanceMeters>${(last?.distance || 0).toFixed(1)}</DistanceMeters>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${tps}
        </Track>
      </Lap>
      <Notes>${xmlEsc(name)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

// GPX with Garmin's TrackPointExtension for heart rate and cadence, and power (as most apps read it)
export function samplesToGpx(samples, name = 'Indoor ride') {
  const pts = samples.filter((s) => s.lat != null && s.lon != null);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RideWorld" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>${xmlEsc(name)}</name><time>${(pts[0]?.time || new Date()).toISOString()}</time></metadata>
<trk><name>${xmlEsc(name)}</name><type>VirtualRide</type><trkseg>
${pts.map((s) => `<trkpt lat="${s.lat.toFixed(7)}" lon="${s.lon.toFixed(7)}">${s.ele != null ? `<ele>${s.ele.toFixed(1)}</ele>` : ''}<time>${s.time.toISOString()}</time><extensions>${s.power != null ? `<power>${Math.round(s.power)}</power>` : ''}<gpxtpx:TrackPointExtension>${s.hr ? `<gpxtpx:hr>${Math.round(s.hr)}</gpxtpx:hr>` : ''}${s.cadence != null ? `<gpxtpx:cad>${Math.round(s.cadence)}</gpxtpx:cad>` : ''}</gpxtpx:TrackPointExtension></extensions></trkpt>`).join('\n')}
</trkseg></trk>
</gpx>
`;
}

// Save text or bytes as a file
export function saveFile(data, type, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
