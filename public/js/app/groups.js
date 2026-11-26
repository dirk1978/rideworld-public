// Riding with others from the setup screen: group rides (create, join, cancel) and drop-in.
import { $, api, esc, me, store, toast } from './core.js';
import { mp } from './riders.js';
import { currentInfo, pickSuggested, showTab } from './setup.js';
// ---------- setup screen: ride with others ----------
export let groups = [];
export async function refreshGroups() {
  try { groups = (await api('api/groups')).groups; } catch { return; }
  const mine = mp.wantRoom?.startsWith('group:') ? mp.wantRoom.slice(6) : null;
  $('mp-groups').innerHTML = groups.length ? groups.map((g) => `
    <div class="mp-group${g.id === mine ? ' joined' : ''}">
      <div><strong>${esc(g.name)}</strong> <span class="opt">${esc(g.routeName)} · host ${esc(g.hostName)} · ${{ firm: 'kept together', soft: 'gentle pull', off: 'race' }[g.banding]}</span>
      <div class="opt">${g.riders.length ? 'In: ' + g.riders.map(esc).join(', ') : 'Nobody in yet'}${g.status === 'riding' ? ' · <b>riding now</b>' : ''}</div></div>
      ${g.id === mine ? '<button data-leave="1">Leave</button>' : g.status === 'waiting' ? `<button data-join="${g.id}">Join</button>` : ''}
      ${g.host === me.username || me.admin ? `<button data-cancel="${g.id}" title="Cancel this group ride">×</button>` : ''}
    </div>`).join('') : '<p class="note">No group rides right now. Start one below.</p>';
  $('mp-groups').querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => joinGroup(groups.find((g) => g.id === b.dataset.join))));
  $('mp-groups').querySelectorAll('[data-leave]').forEach((b) => b.addEventListener('click', () => { mp.leave(); $('mp-status').textContent = ''; refreshGroups(); }));
  $('mp-groups').querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Cancel this group ride for everyone?')) return;
    try { await api(`api/groups/${b.dataset.cancel}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
    if (mine === b.dataset.cancel) mp.leave();
    refreshGroups();
  }));
}

export async function joinGroup(g) {
  if (!g) return;
  showTab('suggest');
  await pickSuggested(g.routeId);
  mp.join('group:' + g.id);
  mp.group = g;
  $('mp-status').textContent = `You're in "${g.name}" on ${g.routeName}. Press Go ride, then wait for ${g.host === me.username ? 'everyone, and press Start' : g.hostName + ' to start'}.`;
  refreshGroups();
}

// drop-in: when the ride starts on a RideWorld route and we're not in a group, ride with whoever else is there
export function dropIn() {
  if (mp.wantRoom?.startsWith('group:')) return;
  const info = currentInfo();
  if ($('mp-dropin').checked && info && info.kind !== 'user' && !info.open) mp.join('route:' + info.id); else mp.leave();
}

// start-up: group rides on the setup screen, connect (main.js runs these in order)
export async function initGroups() {
  $('mp-create').addEventListener('click', async () => {
    const info = currentInfo();
    if (!info || info.kind === 'user') { toast('Pick a RideWorld route first (Routes tab): group rides need a route everyone can see.', 6000); return; }
    try {
      const { group } = await api('api/groups', { method: 'POST', body: JSON.stringify({ name: $('mp-name').value, routeId: info.id, banding: $('mp-banding').value }) });
      $('mp-name').value = '';
      await joinGroup(group);
    } catch (e) { toast(e.message, 6000); }
  });
  setInterval(() => { if ($('setup').offsetParent) refreshGroups(); }, 5000);
  refreshGroups();
  mp.connect();
  $('mp-dropin').checked = store.get('dropin', '1') === '1';
  $('mp-dropin').addEventListener('change', () => store.set('dropin', $('mp-dropin').checked ? '1' : '0'));
}
