// "Register your interest" from the sign-in page, before RideWorld opens to the public. data/interest.json holds
// [{ id, name, email, note, date }], newest first; the same email again updates its entry. Anyone can add (rate
// limited per address); only admins can list or remove (Accounts dialog).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'interest.json');
const MAX = 5000;
const PER_HOUR = 5;
const recent = new Map(); // ip -> [times]

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(list) {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 1), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
}

function add(body, ip) {
  const now = Date.now(), times = (recent.get(ip) || []).filter((t) => now - t < 3600e3);
  if (times.length >= PER_HOUR) return { error: 'Thanks, we already have that. Try again later if you need to change it.', status: 429 };
  if (body.website) return { ok: true }; // the hidden field: only bots fill it in
  const name = String(body.name || '').trim().slice(0, 80), email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const note = String(body.note || '').trim().slice(0, 500);
  if (!name) return { error: 'Please give your name.', status: 400 };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'That email address doesn\'t look right.', status: 400 };
  times.push(now); recent.set(ip, times);
  const list = load().filter((x) => x.email !== email);
  list.unshift({ id: crypto.randomBytes(6).toString('hex'), name, email, note, date: new Date(now).toISOString() });
  save(list.slice(0, MAX));
  return { ok: true, entry: list[0] };
}

function remove(id) {
  const list = load(), next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

// mark an entry as having an account (Approve in the Accounts dialog): { username, at, emailed }
function markApproved(id, approved) {
  const list = load(), x = list.find((e) => e.id === id);
  if (!x) return false;
  x.approved = approved;
  save(list);
  return true;
}

module.exports = { add, list: load, remove, markApproved };
