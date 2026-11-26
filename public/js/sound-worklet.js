// The bike's own sounds, made sample by sample on the audio thread (2026-11-18, the owner: "improve the awful in game
// sounds ... a very realistic bike chain noise ... at the moment it's just white noise"). Loaded by sound.js.
//
// Every sound here is physical events ringing small resonators, not filtered hiss:
// - Chain: each link meeting the chainring's teeth is a tiny metallic tick (links per second = cadence x 50 teeth / 60,
//   ~75 a second at 90 rpm). Inner and outer links alternate in weight, the ticks are louder through each pedal stroke
//   (twice a revolution) and with effort, and each one rings a little bank of steel-like resonances. Together: the
//   familiar fine "zzzz" of a drivetrain under load.
// - Freehub: freewheeling, the pawls click over the ratchet (36 a wheel revolution), a dry high tick.
// - Tyre: rolling hiss shaped by speed, plus the tread's grain; gravel and dirt add crunching stones, cobbles a
//   rumble at the setts' rate plus the bike rattling, grass a soft swish.
// Parameters arrive by port message ~10 times a second and are eased here, so nothing zips or steps.
class Res { // a two-pole resonator: rings at f Hz, dying away over `ms`
  constructor(f, ms, sr) { this.set(f, ms, sr); this.y1 = 0; this.y2 = 0; }
  set(f, ms, sr) { const r = Math.exp(-1 / ((ms / 1000) * sr)); this.a1 = 2 * r * Math.cos((2 * Math.PI * f) / sr); this.a2 = -r * r; this.g = (1 - r * r) * 0.5; }
  tick(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
const CH_LP = 0.4, CH_HP = 0.06, CH_GAIN = 1.0, CH_BUMP = 0.0005; // (chain tone: ~3.6 kHz low-pass twice, ~430 Hz high-pass twice, each tick a 0.5 ms rounded push; tuned 2026-11-18 to about half the old brightness, same loudness)
class OnePole { constructor(c) { this.c = c; this.y = 0; } tick(x) { this.y += this.c * (x - this.y); return this.y; } }

class Drive extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const sr = sampleRate;
    this.p = { link: 0, chain: 0, crank: 0, wheel: 0, free: 0, tyre: 0, v: 0, surf: 'road', ...(opts?.processorOptions || {}) };
    this.s = { link: 0, chain: 0, crank: 0, wheel: 0, free: 0, tyre: 0, v: 0 }; // eased copies
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
    this.ph = { link: 0, crank: 0, pawl: 0, sett: 0 }; this.odd = false;
    // (2026-11-18, the owner: "a bit harsh ... like a chain with no oil ... in real life it would be more dull and muted": an
    // oiled chain is a soft low whirr, so the rings are low and short, each tick a rounded push (no sharp edge), and the
    // whole chain sound goes through a gentle low-pass)
    this.chainR = [[720, 2.4, 1], [1300, 1.8, 0.7], [2250, 1.1, 0.3]].map(([f, ms, a]) => Object.assign(new Res(f * (0.97 + Math.random() * 0.06), ms, sr), { amp: a }));
    this.roller = new Res(230, 5, sr);
    this.chainLP = new OnePole(CH_LP); this.chainLP2 = new OnePole(CH_LP); this.chainHP = new OnePole(CH_HP); this.chainHP2 = new OnePole(CH_HP); // (low-pass twice; the high-pass keeps the link rate from droning)
    this.bump = 0; this.bumpN = Math.round(CH_BUMP * sr); this.bumpA = 0; // (each tick spread over ~1.6 ms)
    this.pawlR = [[1700, 1.6, 1], [3100, 1.1, 0.5], [5200, 0.7, 0.15]].map(([f, ms, a]) => Object.assign(new Res(f, ms, sr), { amp: a })); // (softer, lower: 2026-11-18)
    this.pawlLP = new OnePole(0.35);
    this.stoneR = [[1150, 4], [2450, 3], [4100, 2]].map(([f, ms]) => new Res(f, ms, sr));
    this.thump = new Res(150, 18, sr); this.sett = new Res(105, 25, sr); this.rattle = [new Res(1750, 6, sr), new Res(2900, 5, sr)];
    this.tread = new Res(900, 3, sr);
    this.hissHP = new OnePole(0.5); this.hissLP = new OnePole(0.2); this.swish = new OnePole(0.05);
    this.grit = 0; // a few samples of noise after each link tick (the roller's grit)
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, sr = sampleRate, p = this.p, s = this.s;
    const k = 1 - Math.exp(-n / (0.12 * sr)); // ease over ~0.12 s
    for (const key of ['link', 'chain', 'crank', 'wheel', 'free', 'tyre', 'v']) s[key] += (p[key] - s[key]) * k;
    const surf = p.surf, rough = surf === 'gravel' || surf === 'dirt', cob = surf === 'cobbles', grass = surf === 'grass';
    this.hissLP.c = Math.min(0.16, 0.04 + s.v * 0.012); // (a soft low hum, ~1 kHz at most, not a hiss)
    for (let i = 0; i < n; i++) {
      let y = 0;
      // the chain
      if (s.chain > 0.001 && s.link > 1) {
        this.ph.crank += s.crank / sr; if (this.ph.crank >= 1) this.ph.crank -= 1;
        this.ph.link += s.link / sr;
        let x = 0;
        if (this.ph.link >= 1) {
          this.ph.link -= 1 + (Math.random() - 0.5) * 0.04; this.odd = !this.odd;
          const stroke = 0.6 + 0.4 * Math.abs(Math.sin(2 * Math.PI * this.ph.crank));
          this.bumpA = s.chain * stroke * (this.odd ? 0.88 : 1) * (0.88 + Math.random() * 0.24);
          this.bump = this.bumpN;
        }
        if (this.bump > 0) { const k2 = 1 - this.bump / this.bumpN; x = this.bumpA * Math.sin(Math.PI * k2) * (2 / this.bumpN); this.bump--; }
        let c = 0; for (const r of this.chainR) c += r.tick(x) * r.amp;
        c += this.roller.tick(x) * 0.8;
        { const lp = this.chainLP2.tick(this.chainLP.tick(c)); const h1 = lp - this.chainHP.tick(lp); y += (h1 - this.chainHP2.tick(h1)) * CH_GAIN; }
      }
      // the freehub's pawls
      if (s.free > 0.01 && s.wheel > 0.2) {
        this.ph.pawl += (s.wheel * 36) / sr;
        let x = 0; if (this.ph.pawl >= 1) { this.ph.pawl -= 1 + (Math.random() - 0.5) * 0.08; x = s.free * Math.min(1, s.wheel / 2) * (0.8 + Math.random() * 0.4); }
        let c = 0; for (const r of this.pawlR) c += r.tick(x) * r.amp;
        y += this.pawlLP.tick(c) * 0.9;
      }
      // the tyre
      if (s.tyre > 0.001) {
        const w = Math.random() * 2 - 1;
        const hiss = this.hissLP.tick(w - this.hissHP.tick(w)); // band-limited, rising in pitch with speed
        y += hiss * s.tyre * (grass ? 0.5 : cob ? 0.8 : 1) * 0.1; // (2026-11-18: quieter and softer, the owner: "a wall of noise again")
        if (Math.random() < (s.v * 60) / sr) y += this.tread.tick((Math.random() - 0.5) * s.tyre * 0.6); else y += this.tread.tick(0);
        if (rough) { // stones: many small crunches and the odd bigger one
          let x = 0; if (Math.random() < (s.v * (surf === 'gravel' ? 260 : 120)) / sr) x = s.tyre * Math.pow(Math.random(), 3) * 2.2;
          let c = 0; for (const r of this.stoneR) c += r.tick(x);
          y += c + this.thump.tick(Math.random() < (s.v * 4) / sr ? s.tyre * (0.5 + Math.random()) : 0) * 2.5;
        }
        if (cob) { // the setts (~13 cm each) and the bike rattling over them
          this.ph.sett += s.v / 0.13 / sr;
          let x = 0; if (this.ph.sett >= 1) { this.ph.sett -= 1 + (Math.random() - 0.5) * 0.3; x = s.tyre * (0.6 + Math.random() * 0.8); }
          y += this.sett.tick(x) * 3.2;
          let r2 = 0; const rx = Math.random() < (s.v * 90) / sr ? s.tyre * Math.random() : 0; for (const r of this.rattle) r2 += r.tick(rx);
          y += r2 * 0.9;
        }
        if (grass) y += this.swish.tick(w) * s.tyre * 1.2;
      }
      y = Math.tanh(y * 1.3) * 0.8; // (soft limit)
      L[i] = y; R[i] = y;
    }
    return true;
  }
}
registerProcessor('rw-drive', Drive);
