// Pacers and ghosts: the setup screen lists, building them for a ride, saving a finished ride as a ghost.
import { Ghost, Pacer } from '../pacers.js';
import { $, api, fmtTime, kg, recorder, route, state, store, toast } from './core.js';
import { currentInfo, routeTab } from './setup.js';
// ---------- pacers (bots at a set power) and ghosts (your earlier rides) ----------
// (function declarations: account settings arrive while the rest of this file is still being set up)
export function bots() { try { const b = JSON.parse($('cfg-bots').value || '[]'); return Array.isArray(b) ? b.slice(0, 5) : []; } catch { return []; } }
export function saveBots(list) {
  $('cfg-bots').value = JSON.stringify(list.map((b) => ({ w: Math.max(50, Math.min(1000, Math.round(+b.w || 0))) })));
  $('cfg-bots').dispatchEvent(new Event('change'));
  renderBots();
}
export function renderBots() {
  const list = bots();
  $('bots-list').innerHTML = list.length ? list.map((b, i) => `
    <div class="bot-row"><span>Pacer ${i + 1}</span><input type="number" min="50" max="1000" step="5" value="${+b.w}" data-bot="${i}"> W
      <button class="small" data-bot-del="${i}" title="Remove this pacer">×</button></div>`).join('') : '<p class="note">No pacers yet.</p>';
  $('bot-add').disabled = list.length >= 5;
  $('bots-list').querySelectorAll('[data-bot]').forEach((el) => el.addEventListener('change', () => { const l = bots(); l[+el.dataset.bot] = { w: +el.value }; saveBots(l); }));
  $('bots-list').querySelectorAll('[data-bot-del]').forEach((el) => el.addEventListener('click', () => { const l = bots(); l.splice(+el.dataset.botDel, 1); saveBots(l); }));
}

// ghosts of the selected route
// (none when starting part-way with "Start at": a part ride would replay against the whole route)
export const ghostRouteId = () => (routeTab === 'suggest' && !route?.skipKm ? currentInfo()?.id : null);
export const ghostSel = (id) => { try { return JSON.parse(store.get('ghostSel.' + id, 'null')); } catch { return null; } };
export let ghostList = [];
export async function refreshGhosts() {
  const id = ghostRouteId();
  if (!id) { ghostList = []; $('ghost-list').innerHTML = '<p class="note">Ghosts are kept for saved routes (RideWorld routes and My routes).</p>'; return; }
  try { ghostList = (await api(`api/ghosts/${encodeURIComponent(id)}`)).ghosts; } catch { ghostList = []; }
  if (ghostRouteId() !== id) return;
  const sel = ghostSel(id) ?? ghostList.filter((g) => g.best).map((g) => g.id);
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  $('ghost-list').innerHTML = ghostList.length ? ghostList.map((g) => `
    <div class="ghost-row"><label><input type="checkbox" data-ghost="${g.id}"${sel.includes(g.id) ? ' checked' : ''}>
      <span>${g.best ? '<span class="best">Best</span> · ' : ''}${fmtTime(g.time)} · ${day(g.date)}${g.sim ? ' (sim)' : ''}</span></label>
      <button class="small" data-ghost-del="${g.id}" title="Delete this ghost">×</button></div>`).join('') : '<p class="note">No ghosts yet: finish this route and it will be here next time.</p>';
  $('ghost-list').querySelectorAll('[data-ghost]').forEach((el) => el.addEventListener('change', () => {
    store.set('ghostSel.' + id, JSON.stringify([...$('ghost-list').querySelectorAll('[data-ghost]:checked')].map((x) => x.dataset.ghost)));
  }));
  $('ghost-list').querySelectorAll('[data-ghost-del]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('Delete this ghost?')) return;
    try { await api(`api/ghosts/${encodeURIComponent(id)}/${el.dataset.ghostDel}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
    refreshGhosts();
  }));
}

// at Load scenery: build the pacers and fetch the ticked ghosts
export async function preparePacersAndGhosts() {
  const params = { riderKg: kg.rider, bikeKg: kg.bike, cda: +$('cfg-cda').value };
  state.pacers = bots().map((b, i) => new Pacer(i, Math.round(+b.w), params));
  state.ghosts = [];
  const id = ghostRouteId();
  if (!id) return;
  const sel = ghostSel(id) ?? ghostList.filter((g) => g.best).map((g) => g.id);
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  for (const gid of sel) {
    try {
      const { ghost } = await api(`api/ghosts/${encodeURIComponent(id)}/${gid}`);
      if (Math.abs(ghost.length - route.length) > route.length * 0.03) { toast(`A ghost from ${day(ghost.date)} was on a different version of this route, so it's left out.`, 5000); continue; }
      const info = ghostList.find((g) => g.id === gid);
      state.ghosts.push(new Ghost(ghost, `${info?.best ? 'Best' : day(ghost.date)} ${fmtTime(ghost.time)}`));
    } catch { /* deleted meanwhile */ }
  }
}

// at the finish: keep this ride as a ghost (saved routes only)
export async function saveGhost() {
  const id = ghostRouteId();
  const samples = recorder.samples.map((x) => x.distance);
  if (!id || samples.length < 10 || state.simUsed) return; // no ghosts from simulator rides
  try {
    const r = await api(`api/ghosts/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ time: state.elapsed, length: route.length, sim: $('cfg-sim').checked, samples }) });
    toast(r.best ? '👻 New best on this route: saved as your ghost.' : '👻 Saved as a ghost for next time.', 5000);
  } catch (e) { console.warn('ghost not saved', e); }
}

// start-up: pacers and ghosts on the setup screen (main.js runs these in order)
export async function initCompany() {
  $('bot-add').addEventListener('click', () => saveBots([...bots(), { w: Math.round(((+$('cfg-ftp').value || 250) * 0.75) / 5) * 5 }]));
  renderBots();
  setInterval(() => { if ($('setup').offsetParent && ghostRouteId() !== refreshGhosts.last) { refreshGhosts.last = ghostRouteId(); refreshGhosts(); } }, 1000);
}
