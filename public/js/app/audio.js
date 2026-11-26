// Ride sounds (sound.js) and the YouTube music player (music.js) wired to the page.
import { Music, parseLink } from '../music.js';
import { RideSound } from '../sound.js';
import { $, api, esc, route, state, store, toast } from './core.js';
// ---------- ride sounds and music ----------
export const sound = new RideSound();
export let soundOn = store.get('soundOn', '1') === '1';
// Ride sounds at a fixed, barely-there level under the music (the owner 2026-10-26: no volume slider on the setup screen;
// 🔊 in the ride switches them off and on)
const SFX = 0.2;
export const applySound = () => {
  sound.setVolume(soundOn ? SFX : 0); sound.setAmbient(ambientOn);
  $('btn-sound').classList.toggle('off', !soundOn);
  $('btn-sound').innerHTML = `<svg class="ic"><use href="#i-${soundOn ? 'volume' : 'mute'}"/></svg>`;
};

// Outdoor sounds (birds, wind in the leaves, traffic): on unless switched off (Sound & music, per browser)
export let ambientOn = store.get('ambient', '1') === '1';
// What the place sounds like (2026-11-18): how built-up and how leafy it is round the rider, from the world file's
// buildings and trees (counted in 100 m cells once per world); without a world file (Google's 3D routes), open country
let sceneFor = null, grid = null, sceneAt = 0;
function sceneOf(W, lat, lon) {
  if (!W?.buildings) return { city: 0.1, trees: 0.5 };
  if (sceneFor !== W) {
    sceneFor = W; grid = new Map();
    const key = (la, lo) => `${Math.floor(la * 1110)}:${Math.floor(lo * 700)}`; // (~100 m cells in the UK)
    const add = (la, lo, f) => { const k = key(la, lo), c = grid.get(k) || grid.set(k, { b: 0, t: 0 }).get(k); c[f]++; };
    for (const b of W.buildings) { const q = b.pts?.[0]; if (q) add(q[0], q[1], 'b'); }
    for (const t of W.trees || []) add(t[0], t[1], 't');
    for (const w of W.woods || []) for (const q of (w.pts || w).filter((_, i) => i % 3 === 0)) if (Array.isArray(q)) add(q[0], q[1], 't');
    grid.key = key;
  }
  let b = 0, t = 0; const la0 = Math.floor(lat * 1110), lo0 = Math.floor(lon * 700);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = grid.get(`${la0 + i}:${lo0 + j}`); if (c) { b += c.b; t += c.t; } }
  const city = Math.max(W.flavour === 'london' ? 0.55 : 0, Math.min(1, (b - 12) / 90));
  return { city, trees: Math.min(1, 0.25 + t / 30) * (1 - city * 0.6) };
}
// every frame (main.js): the bike, the road surface under it and the place
export function rideSound(v, cadence, watts, W, surface) {
  const now = performance.now();
  if (now - sceneAt > 2000 && route?.at) { sceneAt = now; const p = route.at(state.dist); sound.setScene(sceneOf(W, p.lat, p.lon)); }
  const cob = route?.cobbles?.some(([a, b]) => state.dist >= a && state.dist <= b);
  sound.update(v, cadence, { watts, surface: cob ? 'cobbles' : surface || 'road' });
}

export const music = new Music('yt-player');
// the remote (app/remote.js): the recent music links, and playing one of them
export const recentMusic = () => recent().slice(0, 6).map((r) => ({ url: r.url, title: r.title || r.url }));
export function playRecent(n) {
  const r = recent()[n]; if (!r) return;
  $('cfg-music').value = r.url; checkMusicLink();
  const l = parseLink(r.url); if (!l) return;
  $('music').classList.remove('hidden'); music.play(l).catch(() => {});
}
export function startSound() {
  sound.start();
  applySound();
  const link = parseLink($('cfg-music').value);
  if (link && !music.player) {
    $('music').classList.remove('hidden');
    music.play(link).catch((e) => { $('m-title').textContent = e.message; });
  }
}
export const showMusic = () => {
  $('m-title').textContent = music.title() || (music.player ? '…' : 'Loading music…');
  $('m-title').title = $('m-title').textContent;
  $('music').title = $('m-title').textContent; // (the title line is hidden when the player sits in the right-hand gap)
  $('m-play').textContent = music.playing ? '⏸' : '▶';
  sound.setDuck(music.playing);
};
// ---------- the music picker (setup screen) ----------
// the owner 2026-10-26: the old box was "horrible - too small and remembers the previous playlist". Now: a wide box with
// Paste and ✕, a card with the link's title and picture (server: /api/music/info, from YouTube), and the last few links
// as one-tap buttons (per browser). Nothing is chosen until the rider picks: no music unless asked for.
const RECENT = 'musicRecent', MAX_RECENT = 6;
const recent = () => { try { return JSON.parse(store.get(RECENT, '[]')) || []; } catch { return []; } };
const infoCache = new Map();
async function infoFor(url) {
  if (!infoCache.has(url)) infoCache.set(url, api('api/music/info?url=' + encodeURIComponent(url)).catch(() => ({ title: null, thumb: null })));
  return infoCache.get(url);
}
export async function rememberMusic(url) {
  const l = parseLink(url);
  if (!l) return;
  const info = await infoFor(url);
  const list = recent().filter((r) => r.url !== url);
  list.unshift({ url, title: info.title || (l.list ? 'YouTube playlist' : 'YouTube song'), thumb: info.thumb || null });
  store.set(RECENT, JSON.stringify(list.slice(0, MAX_RECENT)));
  showRecent();
}
function showRecent() {
  const box = $('music-recent'), list = recent().filter((r) => r.url !== $('cfg-music').value.trim());
  box.innerHTML = list.length ? '<span class="note">Recent:</span>' : '';
  for (const r of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = r.url;
    b.innerHTML = `${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '♫'}<span>${esc(r.title)}</span><span class="x" title="Forget this one">✕</span>`;
    b.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) { store.set(RECENT, JSON.stringify(recent().filter((x) => x.url !== r.url))); showRecent(); return; }
      $('cfg-music').value = r.url; checkMusicLink();
    });
    box.appendChild(b);
  }
}
let checkSeq = 0;
export async function checkMusicLink() {
  const v = $('cfg-music').value.trim(), l = parseLink(v), seq = ++checkSeq;
  // (mid-ride, the owner 2026-11-24: a link picked while the music is already playing switches to it at once)
  if (l && music.player && JSON.stringify(l) !== JSON.stringify(music.link)) music.play(l).catch(() => {});
  $('music-card').classList.toggle('hidden', !v);
  $('music-thumb').classList.add('hidden');
  $('music-title').textContent = !v ? '' : l ? (l.list ? 'Playlist' : 'Song') : "That isn't a YouTube or YouTube Music link";
  $('music-check').textContent = l ? 'Checking…' : '';
  showRecent();
  if (!l) return;
  const info = await infoFor(v);
  if (seq !== checkSeq) return; // changed meanwhile
  $('music-title').textContent = info.title || (l.list ? 'A YouTube playlist (its name shows once it plays)' : 'A YouTube song');
  if (info.thumb) { $('music-thumb').src = info.thumb; $('music-thumb').classList.remove('hidden'); }
  $('music-check').textContent = `✓ ${l.list ? 'Playlist' : 'Song'}: plays when the ride starts.`;
  rememberMusic(v);
}

// start-up: ride sounds and the music player (main.js runs these in order)
export async function initAudio() {
  $('btn-sound').addEventListener('click', () => { soundOn = !soundOn; store.set('soundOn', soundOn ? '1' : '0'); applySound(); });
  const amb = $('cfg-ambient'); if (amb) { amb.checked = ambientOn; amb.addEventListener('change', () => { ambientOn = amb.checked; store.set('ambient', ambientOn ? '1' : '0'); applySound(); }); }
  applySound();
  music.volume = +store.get('musicVol', '60');
  $('m-vol').value = music.volume;
  music.shuffle = store.get('musicShuffle', '0') === '1';
  $('m-shuffle').classList.toggle('on', music.shuffle);
  music.addEventListener('change', showMusic);
  music.addEventListener('skipped', () => toast("Skipped a song that can't be played here", 2500));
  setInterval(() => { if (music.player) showMusic(); }, 2000);
  $('m-play').addEventListener('click', () => music.toggle());
  $('m-next').addEventListener('click', () => music.next());
  $('m-prev').addEventListener('click', () => music.prev());
  $('m-shuffle').addEventListener('click', () => {
    music.setShuffle(!music.shuffle);
    store.set('musicShuffle', music.shuffle ? '1' : '0');
    $('m-shuffle').classList.toggle('on', music.shuffle);
  });
  $('m-vol').addEventListener('input', () => { music.setVolume(+$('m-vol').value); store.set('musicVol', $('m-vol').value); });
  $('cfg-music').addEventListener('input', checkMusicLink);
  $('music-clear').addEventListener('click', () => { $('cfg-music').value = ''; checkMusicLink(); });
  $('music-paste').addEventListener('click', async () => {
    try { $('cfg-music').value = (await navigator.clipboard.readText()).trim(); checkMusicLink(); }
    catch { $('cfg-music').focus(); toast('Press Ctrl+V (or long-press → Paste) in the box', 4000); }
  });
  checkMusicLink();
}
