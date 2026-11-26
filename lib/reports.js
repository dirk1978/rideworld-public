// Problem reports from the ride (⚑ Report, or R): a screenshot plus where and how the rider was riding (route, km,
// position, camera, settings, frame rate, device) and their note, so a spot can be found again exactly (the owner
// 2026-10-26: "a report issue button which gives you a screenshot and location while I'm scrubbing through").
// data/reports/<id>.json + <id>.jpg, newest found by the id's date prefix. Read with `node tools/reports.mjs`.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'reports');
const PER_HOUR = 30;
const recent = new Map(); // username -> [times]

// the context is the browser's own description of the moment: kept as sent, but only plain JSON of a sane size
function clean(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 500);
  if (depth > 3) return null;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [String(k).slice(0, 40), clean(x, depth + 1)]));
  return null;
}

function add(user, body) {
  const now = Date.now(), times = (recent.get(user.username) || []).filter((t) => now - t < 3600e3);
  if (times.length >= PER_HOUR) return { error: 'That is a lot of reports in an hour: try again a little later.' };
  const img = body.image ? Buffer.from(String(body.image), 'base64') : null;
  if (img && (img.length < 100 || img[0] !== 0xff || img[1] !== 0xd8)) return { error: 'The screenshot is not a JPEG.' };
  const id = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + crypto.randomBytes(3).toString('hex');
  const report = { id, at: new Date(now).toISOString(), user: user.username, note: String(body.note || '').slice(0, 2000), ctx: clean(body.ctx || {}), image: !!img };
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  if (img) fs.writeFileSync(path.join(ROOT, id + '.jpg'), img, { mode: 0o600 });
  fs.writeFileSync(path.join(ROOT, id + '.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  times.push(now); recent.set(user.username, times);
  return { id };
}

module.exports = { add, ROOT };
