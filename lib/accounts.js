// User accounts and sign-in sessions, kept in data/ (git-ignored, in the nightly backup).
// Passwords are hashed with scrypt; sessions are random tokens in an HttpOnly cookie.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const USERS = path.join(DATA, 'users.json');
const SESSIONS = path.join(DATA, 'sessions.json');
const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

let users = readJson(USERS, []);
let sessions = readJson(SESSIONS, {});
let usersMtime = 0;
// pick up changes made by tools/adduser.js while the server is running
function freshUsers() {
  try {
    const t = fs.statSync(USERS).mtimeMs;
    if (t !== usersMtime) { users = readJson(USERS, []); usersMtime = t; }
  } catch {}
  return users;
}
const saveUsers = () => { writeJson(USERS, users); try { usersMtime = fs.statSync(USERS).mtimeMs; } catch {} };
const saveSessions = () => writeJson(SESSIONS, sessions);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// What the browser is allowed to see about a user
const publicUser = (u) => u && { username: u.username, name: u.name, admin: !!u.admin };

function findUser(username) {
  return freshUsers().find((u) => u.username === String(username || '').toLowerCase());
}

// Signing in by username, email address or name (the owner 2026-10-26: a rider couldn't sign in with a dotted username,
// and people type their name or email): case and spaces don't matter, "Alex Smith" finds alex.smith
function findLogin(who) {
  const w = String(who || '').trim().toLowerCase();
  if (!w) return null;
  const list = freshUsers();
  return list.find((u) => u.username === w) || list.find((u) => u.email && u.email.toLowerCase() === w)
    || list.find((u) => u.username === w.replace(/\s+/g, '.')) || list.find((u) => String(u.name || '').trim().toLowerCase() === w) || null;
}

// Password reset links: a random token (only its hash kept, in memory), 1 hour, used once
const resets = new Map(); // sha256(token) -> { username, until }
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function newResetToken(username) {
  const t = crypto.randomBytes(24).toString('hex');
  for (const [k, r] of resets) if (r.username === username || r.until < Date.now()) resets.delete(k);
  resets.set(tokenHash(t), { username, until: Date.now() + 3600e3 });
  return t;
}
function useResetToken(token, password) {
  const k = tokenHash(token), r = resets.get(k);
  if (!r || r.until < Date.now()) return { error: 'That reset link has expired or been used. Ask for a new one.' };
  const res = setPassword(r.username, password);
  if (!res.error) resets.delete(k);
  return res;
}
function setEmail(username, email) {
  const user = findUser(username);
  if (!user) return { error: 'No such user.' };
  user.email = String(email).slice(0, 120);
  saveUsers();
  return { user };
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Passwords need at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

function createUser({ username, name, password, admin = false, email }) {
  username = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return { error: 'Usernames are 2-32 characters: lowercase letters, numbers, dot, dash or underscore.' };
  if (findUser(username)) return { error: 'That username is taken.' };
  const bad = validatePassword(password);
  if (bad) return { error: bad };
  const user = { username, name: String(name || username).slice(0, 60), admin: !!admin, created: new Date().toISOString(), settings: {}, ...hashPassword(password) };
  if (email) user.email = String(email).slice(0, 120);
  users.push(user);
  saveUsers();
  return { user };
}

function setPassword(username, password) {
  const user = findUser(username);
  if (!user) return { error: 'No such user.' };
  const bad = validatePassword(password);
  if (bad) return { error: bad };
  Object.assign(user, hashPassword(password));
  saveUsers();
  // sign them out everywhere else
  for (const [t, s] of Object.entries(sessions)) if (s.username === user.username) delete sessions[t];
  saveSessions();
  return { user };
}

function deleteUser(username) {
  const i = users.findIndex((u) => u.username === username);
  if (i < 0) return { error: 'No such user.' };
  if (users[i].admin && users.filter((u) => u.admin).length === 1) return { error: "You can't remove the last admin." };
  users.splice(i, 1);
  saveUsers();
  for (const [t, s] of Object.entries(sessions)) if (s.username === username) delete sessions[t];
  saveSessions();
  return {};
}

function updateSettings(username, patch, allowed) {
  const user = findUser(username);
  if (!user) return null;
  user.settings ||= {};
  for (const k of allowed) if (typeof patch[k] === 'string' && patch[k].length <= 200) user.settings[k] = patch[k];
  saveUsers();
  return user.settings;
}

// Strava tokens for a rider (lib/strava.js); null removes them
function setStrava(username, strava) {
  const user = findUser(username);
  if (!user) return;
  if (strava) user.strava = strava; else delete user.strava;
  saveUsers();
}

// ---------- sessions ----------
function newSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username, expires: Date.now() + SESSION_DAYS * 864e5 };
  saveSessions();
  return token;
}

function sessionUser(token) {
  const s = token && sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete sessions[token]; saveSessions(); return null; }
  const user = findUser(s.username);
  if (!user) return null;
  // slide the expiry forward, at most once a day
  if (s.expires - Date.now() < (SESSION_DAYS - 1) * 864e5) { s.expires = Date.now() + SESSION_DAYS * 864e5; saveSessions(); }
  return user;
}

// an account's sessions (for the admin status page's "last active")
function sessionsOf(username) { return Object.values(sessions).filter((s) => s.username === username); }

function endSession(token) {
  if (sessions[token]) { delete sessions[token]; saveSessions(); }
}

// ---------- slow down password guessing: 8 failures per 15 min per key (address, address+username) ----------
const failures = new Map();
const WINDOW = 15 * 60e3, LIMIT = 8;
function tooManyAttempts(keys) {
  const now = Date.now();
  return keys.some((k) => (failures.get(k) || []).filter((t) => now - t < WINDOW).length >= LIMIT);
}
function noteFailure(keys) {
  const now = Date.now();
  for (const k of keys) failures.set(k, [...(failures.get(k) || []).filter((t) => now - t < WINDOW), now]);
}

module.exports = {
  findLogin, newResetToken, useResetToken, setEmail,
  users: freshUsers, findUser, publicUser, setStrava, createUser, setPassword, deleteUser, updateSettings, checkPassword,
  newSession, sessionUser, endSession, sessionsOf, tooManyAttempts, noteFailure, SESSION_DAYS,
};
