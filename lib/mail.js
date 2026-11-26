// Email through Brevo's transactional API (https://api.brevo.com/v3/smtp/email). the owner's own Brevo account; the
// API key and addresses are entered by an admin in Accounts and kept in data/mail.json (git-ignored, mode 600).
// Outbound port 25 is blocked on the home line, and the API needs no SMTP at all.
const fs = require('fs');
const https = require('https');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'mail.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// what a new rider is told with their sign-in details, unless an admin has written their own (Accounts -> Email)
// (2026-11-18: the browser, reports and kit notes moved into the riders' guide, lib/guide.js, which follows them)
const DEFAULT_NOTES = [
  'RideWorld is in early testing. Routes are still being polished, and things will change (and now and then break) as I work on it.',
  'Your trainer feels the real road: hills come from measured heights, not from the 3D scenery. Where the scenery is rough, what you see can be a little different from what you feel.',
].join('\n\n');
const guide = require('./guide.js');

// What admins see: never the key itself
function status() {
  const c = load();
  return { configured: !!(c.apiKey && c.from), from: c.from || '', fromName: c.fromName || 'RideWorld', notify: c.notify || '', thanks: c.thanks !== false,
    keyEnd: c.apiKey ? c.apiKey.slice(-4) : '', welcomeNotes: c.welcomeNotes || DEFAULT_NOTES };
}

function configure({ apiKey, from, fromName, notify, thanks, welcomeNotes }) {
  const c = load();
  if (apiKey !== undefined && apiKey !== '') c.apiKey = String(apiKey).trim();
  if (from !== undefined) { if (from && !EMAIL.test(from)) return { error: 'The sender address doesn\'t look right.' }; c.from = String(from).trim(); }
  if (notify !== undefined) { if (notify && !EMAIL.test(notify)) return { error: 'The notify address doesn\'t look right.' }; c.notify = String(notify).trim(); }
  if (fromName !== undefined) c.fromName = String(fromName).trim().slice(0, 60) || 'RideWorld';
  if (thanks !== undefined) c.thanks = !!thanks;
  if (welcomeNotes !== undefined) {
    const t = String(welcomeNotes).replace(/\r/g, '').trim().slice(0, 3000);
    if (t && t !== DEFAULT_NOTES) c.welcomeNotes = t; else delete c.welcomeNotes;
  }
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(c, null, 1), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
  return status();
}

// send({ to, toName?, subject, text, html?, replyTo? }) -> resolves, or rejects with Brevo's message
function send({ to, toName, subject, text, html, replyTo }) {
  const c = load();
  if (!c.apiKey || !c.from) return Promise.reject(new Error('Email is not set up yet.'));
  const body = JSON.stringify({
    sender: { email: c.from, name: c.fromName || 'RideWorld' }, to: [{ email: to, ...(toName ? { name: toName } : {}) }],
    subject, textContent: text, ...(html ? { htmlContent: html } : {}), ...(replyTo ? { replyTo: { email: replyTo } } : {}),
  });
  return new Promise((resolve, reject) => {
    const req = https.request({ host: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST', timeout: 15000,
      headers: { 'api-key': c.apiKey, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = '';
      res.on('data', (d) => (out += d));
      res.on('end', () => {
        if (res.statusCode < 300) return resolve();
        let msg = out; try { msg = JSON.parse(out).message || out; } catch {}
        reject(new Error(`Brevo said: ${msg} (${res.statusCode})`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Brevo did not answer.')));
    req.on('error', reject);
    req.end(body);
  });
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// A new "register your interest": tell the owner, and thank them (if switched on). Never throws.
async function interestArrived(x) {
  const c = load();
  if (!c.apiKey || !c.from) return;
  const notify = c.notify || c.from;
  try {
    await send({ to: notify, subject: `RideWorld: ${x.name} registered interest`, replyTo: x.email,
      text: `${x.name} <${x.email}> registered interest in RideWorld.\n\n${x.note ? `They said: ${x.note}\n\n` : ''}Reply to this email to answer them. The list is under Accounts in RideWorld.`,
      html: `<p><strong>${esc(x.name)}</strong> &lt;${esc(x.email)}&gt; registered interest in RideWorld.</p>${x.note ? `<p>They said: <em>${esc(x.note)}</em></p>` : ''}<p>Reply to this email to answer them. The list is under Accounts in RideWorld.</p>` });
  } catch (e) { console.error('interest notify', e.message); }
  if (c.thanks === false) return;
  try {
    await send({ to: x.email, toName: x.name, subject: 'You\'re on the RideWorld list', replyTo: notify,
      text: `Hi ${x.name},\n\nThanks for registering your interest in RideWorld: indoor rides on real roads in real 3D scenery, with your smart trainer.\n\nYou'll hear from us as soon as it opens up. Just reply to this email if you have any questions.\n\nRide on,\nThe RideWorld team\nRideWorld · https://rideworld.example.org`,
      html: `<p>Hi ${esc(x.name)},</p><p>Thanks for registering your interest in <strong>RideWorld</strong>: indoor rides on real roads in real 3D scenery, with your smart trainer.</p><p>You'll hear from us as soon as it opens up. Just reply to this email if you have any questions.</p><p>Ride on,<br>the owner<br><a href="https://rideworld.example.org">RideWorld</a></p>` });
  } catch (e) { console.error('interest thanks', e.message); }
}

// An approved registration: their sign-in details, how to get going, the phone remote (the owner 2026-10-30: new riders
// won't know it exists) and the admin's notes ("Good to know", one paragraph each). Rejects if it couldn't be sent.
function welcome({ to, name, username, password, site }) {
  const c = load(), notes = c.welcomeNotes || DEFAULT_NOTES, first = String(name || '').split(/\s+/)[0] || name;
  const link = `${site}/login.html#login`, rc = `${site}/rc`;
  const paras = notes.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const steps = [
    ['Rider & kit', 'enter your weight and FTP: the trainer and your speed are worked out from them.'],
    ['Sensors', 'connect your smart trainer (Bluetooth, or an ANT+ USB stick) and a heart-rate strap. RideWorld reconnects them by itself next time.'],
    ['Route', 'pick one and press Go ride. No trainer to hand? Simulator lets you ride with the ↑ and ↓ keys setting your power.'],
  ];
  const remote = 'Open it on your phone during a ride (or scan the QR code on the setup screen) and keep it on the bars: start and pause, switch cameras, take photos, ease or harden a workout, skip songs, and see your power, heart rate and speed.';
  const text = `Hi ${first},\n\nYour RideWorld account is ready: real roads in real 3D scenery, ridden on your own smart trainer.\n\n`
    + `Sign in: ${link}\nUsername: ${username}\nPassword: ${password}\n(Change it any time with Password at the top of the setup screen.)\n\n`
    + `GETTING STARTED\n${steps.map(([k, v], i) => `${i + 1}. ${k}: ${v}`).join('\n')}\n\n`
    + `YOUR PHONE AS A REMOTE: ${rc}\n${remote}\n\n`
    + `GOOD TO KNOW\n${paras.map((p) => `- ${p}`).join('\n')}\n\nTIPS AND TRICKS\n\n${guide.text(site)}\n\nRide on,\nThe RideWorld team\nRideWorld · ${site}`;
  const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#ff6a1a;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:10px">${esc(label)}</a>`;
  const h = (t) => `<h3 style="margin:26px 0 8px;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#d9480f">${t}</h3>`;
  const html = `<div style="max-width:560px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2430">`
    + `<p>Hi ${esc(first)},</p><p>Your <strong>RideWorld</strong> account is ready: real roads in real 3D scenery, ridden on your own smart trainer.</p>`
    + `<div style="background:#f4f6fa;border-radius:12px;padding:16px 18px;margin:16px 0">`
    + `<p style="margin:0 0 12px">${btn(link, 'Sign in to RideWorld')}</p>`
    + `<p style="margin:0">Username: <strong>${esc(username)}</strong><br>Password: <strong style="font-family:Consolas,monospace">${esc(password)}</strong></p>`
    + `<p style="margin:8px 0 0;font-size:13px;color:#5b6475">Change it any time with Password at the top of the setup screen.</p></div>`
    + h('Getting started') + `<ol style="padding-left:20px;margin:0">${steps.map(([k, v]) => `<li style="margin-bottom:6px"><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('')}</ol>`
    + h('📱 Your phone as a remote')
    + `<div style="border:2px solid #ffb27a;background:#fff6ef;border-radius:12px;padding:14px 18px"><p style="margin:0 0 10px">${esc(remote)}</p><p style="margin:0">${btn(rc, 'Open the remote')} <span style="font-size:13px;color:#5b6475;margin-left:8px">${esc(rc.replace(/^https:\/\//, ''))}</span></p></div>`
    + h('Good to know') + `<ul style="padding-left:20px;margin:0">${paras.map((p) => `<li style="margin-bottom:6px">${esc(p).replace(/\n/g, '<br>')}</li>`).join('')}</ul>`
    + h('Tips and tricks') + guide.html(site)
    + `<p style="margin-top:26px">Ride on,<br>the owner<br><a href="${esc(site)}" style="color:#d9480f">RideWorld</a></p></div>`;
  return send({ to, toName: name, subject: 'Your RideWorld account', replyTo: c.notify || c.from, text, html });
}

module.exports = { status, configure, send, interestArrived, welcome, guide };
