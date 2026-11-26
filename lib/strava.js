// Strava integration: each rider connects their own Strava account (OAuth), then rides upload straight to Strava
// as a Virtual Ride on an indoor trainer, with a title and description. All Strava calls happen here on the server:
// the app's client secret and riders' tokens never reach a browser.
//   App credentials (from strava.com/settings/api): data/strava.json, set by an admin in the app.
//   Riders' tokens: in their account record (lib/accounts.js).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const accounts = require('./accounts');

const CONFIG = path.join(__dirname, '..', 'data', 'strava.json');
const PUBLIC_URL = process.env.PUBLIC_URL || `https://localhost:${process.env.PORT || 8443}`;
const REDIRECT = PUBLIC_URL + '/api/strava/callback';
const API = 'https://www.strava.com/api/v3';

const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
function saveConfig(clientId, clientSecret) {
  const id = String(clientId || '').trim(), secret = String(clientSecret || '').trim();
  if (!/^\d{1,12}$/.test(id) || !/^[0-9a-f]{20,64}$/i.test(secret)) return { error: 'That doesn\'t look like a Strava Client ID (a number) and Client Secret (a long hex string).' };
  fs.writeFileSync(CONFIG + '.tmp', JSON.stringify({ clientId: id, clientSecret: secret }, null, 2), { mode: 0o600 });
  fs.renameSync(CONFIG + '.tmp', CONFIG);
  return {};
}
const configured = () => { const c = readConfig(); return !!(c.clientId && c.clientSecret); };

// OAuth "state" values, so the callback knows which rider is connecting (they may be signed in on another address)
const pending = new Map();

function connectUrl(user) {
  const c = readConfig();
  const state = crypto.randomBytes(16).toString('hex');
  pending.set(state, { username: user.username, expires: Date.now() + 10 * 60e3 });
  const q = new URLSearchParams({ client_id: c.clientId, response_type: 'code', redirect_uri: REDIRECT, approval_prompt: 'auto', scope: 'read,activity:write', state });
  return 'https://www.strava.com/oauth/authorize?' + q;
}

async function tokenRequest(params) {
  const c = readConfig();
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Strava said ${res.status}`);
  return data;
}

// Returns { username } on success, or { error }
async function callback({ code, state, scope, error }) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.expires < Date.now()) return { error: 'That Strava sign-in link has expired. Try Connect with Strava again.' };
  if (error) return { error: 'Strava access was not granted.' };
  if (!String(scope || '').includes('activity:write')) return { error: 'RideWorld needs permission to upload activities. Please connect again and leave "Upload your activities" ticked.' };
  const t = await tokenRequest({ code, grant_type: 'authorization_code' });
  accounts.setStrava(p.username, {
    athleteId: t.athlete?.id, athlete: [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' '),
    accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at,
  });
  return { username: p.username };
}

async function accessToken(user) {
  const s = user.strava;
  if (!s) throw Object.assign(new Error('Connect your Strava account first.'), { status: 400 });
  if (s.expiresAt - 120 > Date.now() / 1000) return s.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
  accounts.setStrava(user.username, { ...s, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at });
  return t.access_token;
}

async function disconnect(user) {
  if (!user.strava) return;
  try {
    const token = await accessToken(user);
    await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch { /* forget it locally anyway */ }
  accounts.setStrava(user.username, null);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fit: Buffer. Uploads, waits for Strava to process it, then marks it as a Virtual Ride on a trainer.
// every upload says where to join (the owner 2026-11-02); added here so it also covers ride pages already open
function withLink(description) {
  const d = String(description || '').trim(), line = `Join in: ${PUBLIC_URL}`;
  return d.includes(PUBLIC_URL) ? d : d ? `${d}\n${line}` : line;
}

async function upload(user, { fit, name, description: given, externalId }) {
  const description = withLink(given);
  const token = await accessToken(user);
  const auth = { Authorization: `Bearer ${token}` };
  const form = new FormData();
  form.append('file', new Blob([fit], { type: 'application/octet-stream' }), 'ride.fit');
  form.append('data_type', 'fit');
  form.append('name', String(name || 'RideWorld ride').slice(0, 120));
  form.append('description', String(description || '').slice(0, 2000));
  form.append('trainer', '1');
  if (externalId) form.append('external_id', String(externalId).slice(0, 100));
  let res = await fetch(`${API}/uploads`, { method: 'POST', headers: auth, body: form });
  let up = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(up.message || `Strava upload failed (${res.status})`);
  for (let i = 0; i < 20 && !up.activity_id && !up.error; i++) {
    await sleep(1500);
    res = await fetch(`${API}/uploads/${up.id}`, { headers: auth });
    up = await res.json().catch(() => ({}));
  }
  if (up.error) throw new Error(up.error.replace(/<[^>]+>/g, ''));
  if (!up.activity_id) return { pending: true, message: 'Strava is still processing the ride; it will appear shortly.' };
  const put = await fetch(`${API}/activities/${up.activity_id}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sport_type: 'VirtualRide', trainer: true, name: String(name || 'RideWorld ride').slice(0, 120), description: String(description || '').slice(0, 2000) }),
  });
  if (!put.ok) console.warn('Strava activity update failed', put.status);
  return { activityId: up.activity_id, url: `https://www.strava.com/activities/${up.activity_id}` };
}

module.exports = { withLink, configured, readConfig, saveConfig, connectUrl, callback, disconnect, upload, PUBLIC_URL };
