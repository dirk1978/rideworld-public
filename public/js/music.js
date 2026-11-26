// Music: YouTube's embeddable player (IFrame Player API) in a small panel, playing a YouTube or YouTube Music
// playlist (or a single song) from a pasted link, with our own controls. YouTube Music has no API of its own, but its
// playlists are YouTube playlists, so music.youtube.com links work. YouTube's rules need the player visible and at
// least 200x200, so it is a small tile, not hidden. Songs whose owners block embedding are skipped.
let apiReady = null;
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiReady = null; reject(new Error('YouTube player could not be loaded')); };
    document.head.appendChild(s);
  });
  return apiReady;
}

// music.youtube.com/playlist?list=..., youtube.com/watch?v=...&list=..., youtu.be/ID, music.youtube.com/watch?v=...
export function parseLink(text) {
  let u;
  try { u = new URL(String(text).trim()); } catch { return null; }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
  const list = u.searchParams.get('list');
  let video = u.searchParams.get('v');
  if (u.hostname.endsWith('youtu.be')) video = u.pathname.slice(1) || null;
  const ok = (s) => (s && /^[\w-]{2,64}$/.test(s) ? s : null);
  if (!ok(list) && !ok(video)) return null;
  return { list: ok(list), video: ok(video) };
}

export class Music extends EventTarget {
  constructor(holderId) {
    super();
    this.holderId = holderId;
    this.player = null;
    this.link = null;
    this.volume = 60;
    this.shuffle = false;
    this.skips = 0;
  }

  get playing() { return this.player?.getPlayerState?.() === 1; }

  async play(link) {
    if (!link) return;
    this.link = link;
    await loadApi();
    const load = () => {
      const p = this.player;
      p.setVolume(this.volume);
      if (link.list) { p.loadPlaylist({ list: link.list, listType: 'playlist', index: 0 }); setTimeout(() => p.setLoop?.(true), 1500); } // (round again at the end: the owner 2026-11-24 was stuck on a playlist's last song)
      else p.loadVideoById(link.video);
    };
    if (this.player) { load(); return; }
    await new Promise((resolve) => {
      this.player = new window.YT.Player(this.holderId, {
        width: 200, height: 200,
        playerVars: { controls: 0, playsinline: 1, rel: 0, iv_load_policy: 3, disablekb: 1 },
        events: {
          onReady: () => { load(); resolve(); },
          onStateChange: (e) => {
            if (e.data === 1) this.skips = 0;
            // a playlist loads its list asynchronously; shuffle has to be applied once it has
            if (e.data === 1 && this.shuffle && !this.shuffled) { this.shuffled = true; this.player.setShuffle(true); }
            this.dispatchEvent(new Event('change'));
          },
          onError: (e) => {
            // 100 = removed/private, 101/150 = owner doesn't allow embedding: skip it (but not forever)
            this.dispatchEvent(new CustomEvent('skipped', { detail: e.data }));
            if (this.link?.list && this.skips++ < 15) this.player.nextVideo();
          },
        },
      });
    });
  }

  toggle() { if (!this.player) return; if (this.playing) this.player.pauseVideo(); else this.player.playVideo(); }
  next() { // (on a playlist's last song: back to its first, rather than nothing)
    const p = this.player; if (!p) return;
    const list = p.getPlaylist?.() || [], i = p.getPlaylistIndex?.() ?? -1;
    if (list.length && i >= list.length - 1) p.playVideoAt(0); else p.nextVideo?.();
  }
  prev() { this.player?.previousVideo?.(); }
  setVolume(v) { this.volume = v; this.player?.setVolume?.(v); }
  setShuffle(on) { this.shuffle = on; this.shuffled = on; this.player?.setShuffle?.(on); }
  stop() { this.player?.stopVideo?.(); }

  title() {
    const d = this.player?.getVideoData?.();
    if (!d?.title) return '';
    return d.author && !d.title.includes(d.author) ? `${d.title} · ${d.author.replace(/ - Topic$/, '')}` : d.title;
  }
}
