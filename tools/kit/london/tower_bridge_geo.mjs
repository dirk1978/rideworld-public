// Tower Bridge's real geometry for tools/kit/london/tower_bridge.py (2026-11-22, the owner: "absolutely essential to get bang
// on. Perfectly placed in the water ... roads flowing smoothly either side"), taken from the built London world:
//   the deck: every road point of the bridge and its approaches as (u across, v along, z) in the bridge's own frame
//   (origin = the landmark's point, v along the bearing 23 deg, z relative to the landmark's ground = the deck at mid-span);
//   the river piers: OSM's outlines (the two 9 m "buildings" tagged bridge:support=pier), same frame; the river level.
//   node tools/kit/london/tower_bridge_geo.mjs  -> tools/kit/london/tower_bridge_geo.json
import fs from 'fs';
const W = JSON.parse(fs.readFileSync(new URL('../../../data/world/london-central.json', import.meta.url), 'utf8'));
const L = W.landmarks.find((l) => l.model === 'tower_bridge'), la = L.lat, lo = L.lon, Z0 = L.ground, H = (L.heading * Math.PI) / 180;
const K = 111320 * Math.cos((la * Math.PI) / 180), c = Math.cos(H), s = Math.sin(H);
const uv = (p) => { const x = (p[1] - lo) * K, y = (p[0] - la) * 110540; return [+(x * c - y * s).toFixed(2), +(x * s + y * c).toFixed(2)]; };
const deck = [];
for (const e of W.roads.edges) if (/^Tower Bridge( Approach| Road)?$/.test(e.name || '') && !e.oneway) for (const p of e.pts) { const [u, v] = uv(p); if (Math.abs(u) < 6 && Math.abs(v) < 175) deck.push([u, v, +(p[2] - Z0).toFixed(2)]); }
deck.sort((a, b) => a[1] - b[1]);
// the pier outlines: from OSM (the world's copies are hidden by the model)
const { query } = await import('../../openworld/localosm.mjs');
const r = await query('[out:json];way["bridge:support"="pier"](51.503,-0.079,51.508,-0.072);out geom qt;', new URL('../../../data/cache/osm/london-central.opl', import.meta.url).pathname);
const piers = r.elements.filter((e) => e.geometry && /Tower Bridge/.test(e.tags.name || '')).map((e) => ({ name: e.tags.name, pts: e.geometry.map((q) => uv([q.lat, q.lon])) }));
// the river level (the Thames area's lv), relative to the deck
const inside = (pt, P) => { let k = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [yi, xi] = P[i], [yj, xj] = P[j]; if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) k = !k; } return k; };
const river = (W.land || []).find((a) => a.t === 'water' && a.lv != null && inside([la, lo], a.pts));
const out = { heading: L.heading, ground: Z0, water: +((river?.lv ?? 2.3) - Z0).toFixed(2), deck, piers };
fs.writeFileSync(new URL('./tower_bridge_geo.json', import.meta.url), JSON.stringify(out));
console.log('deck points', deck.length, 'v', deck[0]?.[1], '..', deck.at(-1)?.[1], 'piers', piers.map((p) => p.name).join(', '), 'water', out.water);
for (const v of [-170, -150, -140, -120, -80, -55, -45, -34, 0, 28, 40, 49, 80, 120, 140, 160, 175]) { const q = deck.reduce((b, d) => (Math.abs(d[1] - v) < Math.abs(b[1] - v) ? d : b), deck[0]); console.log(' v', v, '-> deck z', q[2], 'u', q[0]); }
