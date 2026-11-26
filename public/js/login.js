// Sign-in / register-interest page. Visitors land on "Register interest"; anyone who has signed in on this browser
// before (rw.hasAccount), or arrives at #login, gets "Sign in" first. Sign-in goes back to where they were heading.
const $ = (id) => document.getElementById(id);
const form = $('login'), interest = $('interest');
const field = (n) => interest.elements.namedItem(n); // not interest.name: that's the form's own name attribute
const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

function show(which) {
  for (const id of ['forgot', 'reset']) $(id).classList.toggle('hidden', which !== id);
  if (which === 'forgot' || which === 'reset') { $('tab-login').setAttribute('aria-selected', true); $('tab-interest').setAttribute('aria-selected', false); form.classList.add('hidden'); interest.classList.add('hidden'); $('interest-done').classList.add('hidden'); return; }
  const login = which === 'login';
  $('tab-login').setAttribute('aria-selected', login);
  $('tab-interest').setAttribute('aria-selected', !login);
  const done = $('interest-done').dataset.done === '1';
  form.classList.toggle('hidden', !login);
  interest.classList.toggle('hidden', login || done);
  $('interest-done').classList.toggle('hidden', login || !done);
}
$('tab-login').addEventListener('click', () => { show('login'); $('username').focus(); });
$('tab-interest').addEventListener('click', () => show('interest'));
const next = new URLSearchParams(location.search).get('next');
// a reset link from the email (#reset=<token>), or "Forgotten your password?"
const resetToken = (location.hash.match(/^#reset=([a-f0-9]{48})$/) || [])[1];
$('to-forgot').addEventListener('click', (e) => { e.preventDefault(); $('forgot-who').value = $('username').value; show('forgot'); $('forgot-who').focus(); });
$('back-login').addEventListener('click', (e) => { e.preventDefault(); show('login'); });
if (resetToken) show('reset');
else show(location.hash === '#login' || (location.hash !== '#interest' && (remember('rw.hasAccount') === '1' || (next && next !== '/'))) ? 'login' : 'interest');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('msg');
  msg.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = data.error || 'Sign-in failed.'; return; }
    remember('rw.hasAccount', '1');
    const to = next || '/';
    location.href = to.startsWith('/') && !to.startsWith('//') ? to : '/'; // only same-site paths
  } catch {
    msg.textContent = "Couldn't reach the server.";
  }
});

interest.addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('interest-msg'), btn = interest.querySelector('button[type=submit]');
  m.textContent = ''; btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/interest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: field('name').value, email: field('email').value, note: field('note').value, website: field('website').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { m.textContent = data.error || "That didn't work. Please try again."; return; }
    $('interest-done').dataset.done = '1';
    interest.classList.add('hidden');
    $('interest-done').classList.remove('hidden');
  } catch {
    m.textContent = "Couldn't reach the server.";
  } finally {
    btn.disabled = false; btn.textContent = 'Register my interest';
  }
});

// "Forgotten your password?": the server emails a link (the same answer whether or not the account exists)
$('forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('forgot-msg'), btn = $('forgot').querySelector('button[type=submit]');
  m.textContent = 'Sending…'; btn.disabled = true;
  try {
    const res = await fetch('/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who: $('forgot-who').value.trim() }) });
    const data = await res.json().catch(() => ({}));
    m.textContent = data.message || data.error || 'Something went wrong. Please try again.';
  } catch { m.textContent = "Couldn't reach the server."; } finally { btn.disabled = false; }
});

// the link from the email: set a new password, signed straight in
$('reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('reset-msg');
  if ($('reset-pw').value !== $('reset-pw2').value) { m.textContent = "The two passwords don't match."; return; }
  m.textContent = 'Saving…';
  try {
    const res = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: $('reset-pw').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { m.textContent = data.error || "That didn't work."; return; }
    remember('rw.hasAccount', '1');
    location.href = '/';
  } catch { m.textContent = "Couldn't reach the server."; }
});
// (a reset link opened into a sign-in page that's already open only changes the #: start again with it)
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#reset=')) location.reload(); });
