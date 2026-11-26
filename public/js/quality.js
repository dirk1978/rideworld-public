// Scenery quality: how much of Google's scenery is loaded (detail) and how many pixels it is drawn with (resolution).
//
// Measured with real tiles (2026-10-16, Brighton Rocks and Westminster): within ~300 m of the rider Google's finest
// tiles (~2 m geometric error) load at EVERY detail level, even at 35% resolution. Detail only buys scenery further
// away (63 -> 97 tiles drawn from Low to Ultra). So what makes the near scenery look good is resolution, and the
// controller gives up distant detail first and resolution last.
//
// Cesium measures tile detail against the pixels actually drawn, so lowering resolution would also quietly load
// coarser tiles. Detail here is in CSS pixels and converted (x devicePixelRatio x resolution), which keeps the two
// knobs independent and makes a level mean the same on a 150%-scaled laptop as on a desktop.

export const LEVELS = [['Ultra', 5], ['High', 10], ['Balanced', 13], ['Normal', 18], ['Low', Infinity]]; // name by detail value (lower = finer)
export const levelName = (sse) => LEVELS.find(([, max]) => sse <= max)[0];

const SSE_WORST = 32;
// Per graphics tier: starting detail, the finest Auto will go, tile cache, starting resolution (fraction of CSS pixels).
// (Raised for Copenhagen on 2026-10-18 and put back the same evening: the owner got a regular half-second pause
// descending Sa Calobra on the gaming PC, likely Chrome sweeping the bigger cache.)
const TIERS = [
  { name: 'software', start: 32, best: 24, cacheMB: 256, css: 0.75 },
  { name: 'basic', start: 24, best: 12, cacheMB: 512, css: 1 },
  // worst: the coarsest Auto goes (2026-10-30: an RTX 3050 sat on Low after a dip, though Normal ran at 45 fps; Ultra 11, High 16)
  { name: 'mid', start: 12, best: 6, worst: 24, cacheMB: 768, css: 1 },
  { name: 'high', start: 12, best: 4, worst: 18, cacheMB: 1024, css: 1 },
];
const TARGETS = {
  sharp: { down: 27, up: 38, minCss: 0.75 },  // a steady ~30 fps, picture first
  smooth: { down: 47, up: 56, minCss: 0.5 },  // aim for 50+ fps, resolution gives way sooner
};

// Guess what this computer can do from the graphics card Chrome reports (ANGLE strings such as
// "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)"), its memory and cores.
const MOBILE = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // (iPads say Macintosh)
export function detectGpu(gl) {
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {}
  const software = /SwiftShader|llvmpipe|softpipe|Basic Render|WARP/i.test(renderer);
  let tier;
  if (software) tier = 0;
  else if (/RTX|GTX ?1(07|08|6)\d|RX ?(5[6-9]|6[6-9]|7[6-9])\d\d|Arc.*A7\d\d|Apple M\d (Pro|Max|Ultra)/i.test(renderer)) tier = 3;
  else if (/GTX|Quadro|Radeon RX|Radeon Pro|Iris\(R\) Xe|Iris Xe|Arc|Radeon\(TM\) (Graphics|[6-8]\d0M)|Apple M\d|GeForce MX|Adreno \(TM\) [7-9]/i.test(renderer)) tier = 2;
  else tier = 1; // Intel HD/UHD, older integrated graphics, phones
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
  if (mem <= 4 || cores <= 2) tier = Math.min(tier, 1);
  // Phones and tablets share their memory with everything else and the browser gives a page far less of it: an
  // Adreno 7xx counted as 'mid' (768 MB of tiles + Cesium's default 512 MB overflow) and the owner's phone lost the
  // WebGL context in Cap's tunnel, where the tube, portals, earthworks and clips add up (2026-10-21: "Fragment shader
  // failed to compile. Compile log: null" = context already gone). Their own small budget; detail no finer than basic.
  if (MOBILE()) return { renderer, software, tier: Math.min(tier, 1), ...TIERS[Math.min(tier, 1)], name: 'mobile', cacheMB: 192, overflowMB: 64, start: 24, best: Math.max(12, TIERS[Math.min(tier, 1)].best) };
  return { renderer, software, tier, ...TIERS[tier] };
}

const TUNE_KEY = 'rw.tune.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(TUNE_KEY)) || null; } catch { return null; } };
const save = (v) => { try { localStorage.setItem(TUNE_KEY, JSON.stringify(v)); } catch {} };

export class Quality {
  // apply(sse) sets the scenery's maximumScreenSpaceError (device pixels) on the tileset or globe
  constructor(viewer, gpu, { detail, target }, apply) {
    this.viewer = viewer;
    this.gpu = gpu;
    this.applySse = apply;
    this.dpr = window.devicePixelRatio || 1;
    this.frames = 0;
    this.t0 = 0;
    this.good = 0;
    this.fps = 0;
    this.paused = false;
    this.set({ detail, target }, true);
  }

  // Change Auto / a fixed level, or Sharp / Smooth (also mid-ride)
  set({ detail, target }, first = false) {
    this.auto = detail === 'auto';
    this.target = TARGETS[target] ? target : 'sharp';
    const t = TARGETS[this.target];
    this.minRes = Math.min(1, t.minCss / this.dpr);
    const tune = load();
    const remembered = tune && tune.renderer === this.gpu.renderer && tune.target === this.target ? tune : null;
    if (this.auto) this.sse = Math.min(this.gpu.worst ?? SSE_WORST, remembered?.sse ?? this.gpu.start);
    else this.sse = +detail || 16;
    if (first || remembered) this.res = remembered?.res ?? Math.min(1, this.gpu.css / this.dpr);
    this.res = Math.max(this.minRes, Math.min(1, this.res));
    this.apply();
  }

  apply() {
    this.viewer.resolutionScale = this.res;
    this.applySse(this.sse * this.dpr * this.res);
  }


  // Call once per rendered frame. Every 2 s: too slow -> less distant detail, then lower resolution; spare
  // speed (for 4 s) -> full resolution back first, then more detail.
  frame(now) {
    this.frames++;
    if (!this.t0) this.t0 = now;
    const span = now - this.t0;
    if (span < 2000) return;
    this.fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.t0 = now;
    if (this.paused || this.idle || document.hidden || span > 4000) { this.good = 0; return; } // screenshot, frame rate capped (main.js), hidden tab, stall
    const t = TARGETS[this.target];
    let changed = false;
    if (this.fps < t.down) {
      this.good = 0;
      const worst = this.gpu.worst ?? SSE_WORST;
      if (this.auto && this.sse < worst) { this.sse = Math.min(worst, this.sse * 1.3); changed = true; }
      else if (this.res > this.minRes) { this.res = Math.max(this.minRes, this.res * 0.88); changed = true; }
    } else if (this.fps > t.up && ++this.good >= 2) {
      this.good = 0;
      if (this.res < 1) { this.res = Math.min(1, this.res * 1.1); changed = true; }
      else if (this.auto && this.sse > this.gpu.best) { this.sse = Math.max(this.gpu.best, this.sse / 1.2); changed = true; }
    }
    if (changed) {
      this.apply();
      if (this.auto) save({ renderer: this.gpu.renderer, target: this.target, sse: +this.sse.toFixed(2), res: +this.res.toFixed(3) });
    }
  }

  label() {
    return `${Math.round(this.fps)} fps · ${Math.round(this.res * 100)}% res · ${levelName(this.sse)}${this.auto ? ' (auto)' : ''}`;
  }

  title() {
    return `Frame rate, share of the screen's real pixels drawn, and how much distant scenery is loaded.\n`
      + `Graphics: ${this.gpu.renderer || 'unknown'} (${this.gpu.name}). Detail ${this.sse.toFixed(1)}, `
      + `${this.target === 'sharp' ? 'Sharp: picture first, steady ~30 fps' : 'Smooth: aims for 50+ fps'}.`;
  }
}
