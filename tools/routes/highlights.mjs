// Make a highlights route: chosen stretches of an existing route, ridden one after another with a fade between them
// (route.pieces, see Route in public/js/route.js and public/js/app/pieces.js).
//
//   node tools/routes/highlights.mjs <data dir> <parent id> <pieces.json> <name> [--id ID] [--write]
//
// pieces.json: { "where": "...", "blurb": "...", "pieces": [{ "from": km, "to": km, "name": "..." }, ...] } in km along
// the parent's cleaned route (the km the route editor and segments use), in riding order. The new route reuses a copy
// of the parent's GPX and its corrections, analysis (bridges, tunnels, cobbles), segments, low camera stretches and
// height settings, so it rides exactly like those stretches of the parent. Without --write it prints the entry.
// Back up data/routes.json first; the server reads it on every request (no restart needed).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Route } from '../../public/js/route.js';

const args = process.argv.slice(2);
const [dir, parentId, piecesFile, name] = args;
const flag = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
if (!name) { console.error('Usage: highlights.mjs <data dir> <parent id> <pieces.json> <name> [--id ID] [--write]'); process.exit(2); }
const listFile = path.join(dir, 'routes.json');
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const parent = list.find((r) => r.id === parentId);
if (!parent) throw new Error('No route ' + parentId);
const spec = JSON.parse(fs.readFileSync(piecesFile, 'utf8'));
const gpx = fs.readFileSync(path.join(dir, 'routes', parentId + '.gpx'), 'utf8');
// the points as the browser reads them (lat, lon, ele per trkpt)
const pts = [...gpx.matchAll(/<trkpt\b[^>]*?lat="([^"]+)"[^>]*?lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
  .map((m) => ({ lat: +m[1], lon: +m[2], ele: +(m[3].match(/<ele>([^<]+)/)?.[1] ?? NaN) }));
const r = new Route(name, pts, parent.adjust, null, null, { structures: parent.structures?.list, pieces: spec.pieces, trusted: !!parent.trusted });
if (!r.pieces) throw new Error('Need at least two pieces');

// the card's numbers: length and climbing ridden, a 100 m gradient profile and an outline along the pieces only
const L = r.rideLength, grade = [], shape = [];
for (let v = 0; v < L; v += 100) grade.push(+r.grade(r.fromV(v + 50)).toFixed(1));
for (let i = 0; i < 100; i++) { const p = r.at(r.fromV((i / 99) * L)); shape.push([+p.lat.toFixed(5), +p.lon.toFixed(5)]); }
const id = flag('--id') || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
const keep = ['kind', 'by', 'trusted', 'trustedAuto', 'segments', 'structures', 'country', 'adjust', 'lowCam', 'heightGuard', 'banks', 'camHigh', 'centre', 'presmoothed', 'viewpoints', 'landmarks'];
const entry = {
  id, name, where: spec.where ?? parent.where, blurb: spec.blurb ?? '',
  km: +(L / 1000).toFixed(1), gain: Math.round(r.gain), profile: { step: 100, grade }, shape,
  ...Object.fromEntries(keep.filter((k) => parent[k] !== undefined).map((k) => [k, parent[k]])),
  pieces: spec.pieces, parent: parentId, added: new Date().toISOString(),
};
console.log(`${id}: ${entry.km} km ridden of ${(r.length / 1000).toFixed(1)} km, ${entry.gain} m climbing, ${r.pieces.length} pieces`);
for (const p of r.pieces) console.log(`  ${(r.km(p.a)).toFixed(2)}-${(r.km(p.b)).toFixed(2)} km  ${((p.b - p.a) / 1000).toFixed(2)} km  ${p.name}`);
if (!args.includes('--write')) { console.log('(dry run: --write to save)'); process.exit(0); }
if (list.some((x) => x.id === id)) throw new Error(id + ' already exists');
fs.copyFileSync(path.join(dir, 'routes', parentId + '.gpx'), path.join(dir, 'routes', id + '.gpx'));
fs.chmodSync(path.join(dir, 'routes', id + '.gpx'), 0o600);
list.push(entry);
fs.writeFileSync(listFile + '.tmp', JSON.stringify(list, null, 2));
fs.renameSync(listFile + '.tmp', listFile);
fs.chmodSync(listFile, 0o600);
console.log('written');
