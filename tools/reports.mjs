// Problem reports sent from the ride (⚑ Report / R; lib/reports.js): node tools/reports.mjs [n | id]
// Lists the newest n (default 10), or prints one report in full. Screenshots are data/reports/<id>.jpg.
import fs from 'fs';
import path from 'path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'reports');
const arg = process.argv[2] || '10';
const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse() : [];
if (/^\d{8}T/.test(arg)) { console.log(fs.readFileSync(path.join(dir, arg + '.json'), 'utf8')); process.exit(0); }
for (const id of ids.slice(0, +arg)) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')), c = r.ctx || {};
  console.log(`${id}  ${r.user}  ${c.route?.name || '?'} @ ${c.km?.full} km (${c.km?.shown})  ${c.camera?.view || ''}  ${c.at?.lat},${c.at?.lon}${r.image ? '  [jpg]' : ''}\n    ${r.note || '(no note)'}`);
}
