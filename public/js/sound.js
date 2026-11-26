// Ride sounds, made in the browser with Web Audio (no sound files). Rebuilt 2026-11-18 (the owner: "improve the awful in
// game sounds ... a very realistic bike chain noise and some standard outdoor sounds. at the moment it's just white
// noise"):
// - The bike (sound-worklet.js, on the audio thread): the chain link by link at your cadence, the freehub's pawls when
//   you freewheel, the tyre's hiss and tread, crunching gravel, rumbling cobbles. A clunk when you change virtual gear.
// - Outdoors: wind past the ears in gusts (stereo, rising with speed), leaves rustling, birdsong (tits, robins,
//   blackbirds, chaffinches, wood pigeons), the hum of traffic and cars going by in towns, all through a little
//   outdoor reverb. How much of each follows the place (setScene: how built-up, how leafy).
// - A whoosh when another rider passes and a chime for a chapeau, as before.
// The browser only allows sound after a click, so start() is called from the Go ride / Simulator button.
export class RideSound {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.duck = 1;     // lowered while music plays
    this.ambientOn = true;
    this.scene = { city: 0.15, trees: 0.6 }; // 0..1 each (audio.js updateScene)
    this.gust = 0.4; this.gustTo = 0.4; this.gustAt = 0;
    this.birdAt = 0; this.carAt = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.duck;
    this.master.connect(ctx.destination);
    // white noise (2 s, looped) and a brown noise for distant traffic
    const mk = (fill) => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); fill(d); return b; };
    this.noise = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    const brown = mk((d) => { let y = 0; for (let i = 0; i < d.length; i++) { y = (y + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = y * 3.5; } });
    // the outdoors' reverb: a short decaying stereo tail (a wide open space with some trees and walls)
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * (i < 400 ? i / 400 : 1); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg).connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = this.ambientOn ? 1 : 0; this.amb.connect(this.master); // everything outdoors
    const loop = (buf, type, freq, q, pan = 0, dest = this.master) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      src.connect(f).connect(g).connect(p).connect(dest);
      src.start(ctx.currentTime, Math.random() * 1.9);
      return { f, g };
    };
    this.windL = loop(this.noise, 'lowpass', 500, 0.6, -0.7);
    this.windR = loop(this.noise, 'lowpass', 520, 0.6, 0.7);
    this.leaves = loop(this.noise, 'bandpass', 3400, 0.6, 0, this.amb);
    this.traffic = loop(brown, 'lowpass', 260, 0.7, 0, this.amb);
    // the bike
    // the owner's own recordings (2026-11-20, his videos on the share: rideworld/audio): seamless loops made from them
    // (media/sounds): his chain on the trainer (~59 rpm), tarmac outdoors, quiet gravel, rougher gravel. Each plays at a
    // rate that follows cadence or speed; while one is loaded the synthesised version of that sound stays quiet
    // (sound-worklet.js still does the freehub, cobbles and grass, which he has no clean recording of).
    this.rec = {};
    for (const [name, file] of [['chain', 'chain'], ['tarmac', 'tarmac'], ['gravel', 'gravel'], ['dirt', 'gravel2']]) {
      fetch(new URL(`../media/sounds/${file}.m4a`, import.meta.url)).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0; src.connect(g).connect(this.master);
        src.start(ctx.currentTime, Math.random() * buf.duration); this.rec[name] = { src, g };
      }).catch((e) => console.warn('ride sound', name, e));
    }
    this.drive = null;
    ctx.audioWorklet?.addModule(new URL('./sound-worklet.js', import.meta.url)).then(() => {
      this.drive = new AudioWorkletNode(ctx, 'rw-drive', { outputChannelCount: [2] });
      const g = ctx.createGain(); g.gain.value = 0.55; this.drive.connect(g).connect(this.master); // (about twice the old hiss: more going on, still under the music)
    }).catch((e) => console.warn('ride sounds: worklet', e));
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * this.duck, this.ctx.currentTime, 0.05); }
  setDuck(on) { this.duck = on ? 0.6 : 1; if (this.master) this.master.gain.setTargetAtTime(this.volume * this.duck, this.ctx.currentTime, 0.4); }
  setAmbient(on) { this.ambientOn = on; if (this.amb) this.amb.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.3); }
  setScene(s) { Object.assign(this.scene, s); }

  // every frame: v = speed through the world (m/s), cadence in rpm, o = { watts, surface ('road', 'paved', 'gravel',
  // 'dirt', 'grass', 'cobbles'), riding }
  update(v, cadence, o = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, k = 0.15, sc = this.scene, watts = o.watts || 0;
    // gusts: a slow random wander of the wind's strength
    if (t > this.gustAt) { this.gustTo = 0.15 + Math.random() * 0.85; this.gustAt = t + 2 + Math.random() * 5; }
    this.gust += (this.gustTo - this.gust) * 0.01;
    const air = Math.min(1, (v / 15) ** 2), g = this.gust;
    for (const [w, d] of [[this.windL, 0], [this.windR, 30]]) {
      w.g.gain.setTargetAtTime(0.03 * air * (0.7 + 0.4 * g) + 0.004 * g * (this.ambientOn ? 1 : 0), t, k); // (2026-11-18: a soft rumble, not a hiss)
      w.f.frequency.setTargetAtTime(180 + v * 28 + g * 60 + d, t, k);
    }
    this.leaves.g.gain.setTargetAtTime(sc.trees * 0.007 * g * g * g, t, 0.6); // (only in the stronger gusts)
    this.traffic.g.gain.setTargetAtTime(0.025 * sc.city * sc.city, t, 0.8); // (towns only)
    // the bike: the chain only turns under the rider's legs; the freehub ticks when rolling without pedalling
    const crank = cadence / 60, pedalling = cadence >= 10;
    const surf = o.surface || 'road', R = this.rec;
    const recRoad = /^(road|paved)$/.test(surf) ? R.tarmac : surf === 'gravel' ? R.gravel : surf === 'dirt' ? R.dirt : null;
    // the recordings: chain by cadence (recorded at ~59 rpm) and effort; the surface by speed (recorded ~7 m/s)
    if (R.chain) { R.chain.g.gain.setTargetAtTime(pedalling ? 0.09 * (0.55 + Math.min(0.6, watts / 500)) : 0, t, 0.12); R.chain.src.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(2.2, (cadence || 59) / 59)), t, 0.2); }
    for (const [name, lv] of [['tarmac', 0.07], ['gravel', 0.11], ['dirt', 0.09]]) {
      const r = R[name]; if (!r) continue;
      r.g.gain.setTargetAtTime(r === recRoad ? lv * Math.min(1, v / 9) : 0, t, 0.25);
      r.src.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(1.8, v / 7)), t, 0.3);
    }
    this.drive?.port.postMessage({
      link: pedalling ? crank * 50 : 0, crank: pedalling ? crank : 0, chain: pedalling && !R.chain ? 0.35 + Math.min(0.65, watts / 450) : 0,
      wheel: v / 2.1, free: !pedalling && v > 1 ? 1 : 0, tyre: recRoad ? 0 : Math.min(1, v / 12) * 0.9, v, surf: recRoad ? 'road' : surf,
    });
    // birds and passing cars, now and then
    if (this.ambientOn) {
      if (t > this.birdAt) { if (this.birdAt) this.bird(); this.birdAt = t + (sc.city > 0.6 ? 7 : 0.8) + Math.random() * (sc.city > 0.6 ? 16 : 3 + 6 * sc.city) / Math.max(0.3, sc.trees); }
      if (t > this.carAt) { if (this.carAt && sc.city > 0.2) this.car(); this.carAt = t + 4 + Math.random() * (24 - 16 * sc.city); }
    }
  }

  // a virtual gear change (gearsui.js): the derailleur's clack
  shift(up) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const [dt, f, lv] of [[0, up ? 2400 : 1900, 0.35], [0.035, 1300, 0.25], [0.07, up ? 3200 : 2600, 0.15]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
      const gg = ctx.createGain(); gg.gain.setValueAtTime(lv, t + dt); gg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.05);
      src.connect(bp).connect(gg).connect(this.master); src.start(t + dt, Math.random() * 1.5, 0.08);
    }
  }

  // one bird singing a phrase, somewhere to one side at some distance
  bird() {
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const dist = 0.25 + Math.random() * 0.75, out = ctx.createGain(); out.gain.value = 0.05 * dist;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500 + dist * 6000;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * 0.9;
    const send = ctx.createGain(); send.gain.value = 0.6 - dist * 0.4;
    out.connect(lp).connect(pan); pan.connect(this.amb); pan.connect(send).connect(this.verb);
    const note = (at, f0, f1, dur, amp = 1, vib = 0) => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      if (vib) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = vib; lg.gain.value = f0 * 0.04; lfo.connect(lg).connect(o.frequency); lfo.start(at); lfo.stop(at + dur + 0.02); }
      e.gain.setValueAtTime(0.0001, at); e.gain.exponentialRampToValueAtTime(amp, at + Math.min(0.012, dur / 4)); e.gain.setValueAtTime(amp, at + dur * 0.7); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(e).connect(out); o.start(at); o.stop(at + dur + 0.02);
    };
    const r = (a, b) => a + Math.random() * (b - a);
    const kind = this.scene.city > 0.6 ? ['tit', 'pigeon', 'robin'][Math.floor(Math.random() * 3)] : ['tit', 'robin', 'blackbird', 'chaffinch', 'pigeon', 'tit', 'robin'][Math.floor(Math.random() * 7)];
    let at = t;
    if (kind === 'tit') { // great tit: "tea-cher, tea-cher, tea-cher"
      const hi = r(5000, 6200), lo = hi * r(0.7, 0.8);
      for (let n = 0; n < 3 + Math.floor(Math.random() * 3); n++) { note(at, hi, hi * 0.97, 0.09); note(at + 0.13, lo, lo * 0.95, 0.11, 0.8); at += 0.34; }
    } else if (kind === 'robin') { // robin: a thin, wandering warble of short notes
      for (let n = 0; n < 7 + Math.floor(Math.random() * 7); n++) { const f = r(3200, 7200), d = r(0.04, 0.13); note(at, f, f * r(0.8, 1.25), d, r(0.4, 1), Math.random() < 0.4 ? r(25, 45) : 0); at += d + r(0.02, 0.09); }
    } else if (kind === 'blackbird') { // blackbird: rich fluted phrases, falling, then a squeaky end
      for (let n = 0; n < 4 + Math.floor(Math.random() * 3); n++) { const f = r(1700, 3000), d = r(0.14, 0.32); note(at, f, f * r(0.75, 1.15), d, r(0.6, 1), r(5, 9)); at += d + r(0.03, 0.08); }
      for (let n = 0; n < 3; n++) { note(at, r(5500, 7500), r(4000, 6000), 0.05, 0.4); at += 0.07; }
    } else if (kind === 'chaffinch') { // chaffinch: a speeding-up, falling trill and a flourish
      let f = r(5200, 6200), d = 0.09;
      for (let n = 0; n < 12; n++) { note(at, f, f * 0.92, d * 0.8, 0.8); at += d; d = Math.max(0.045, d * 0.9); f *= 0.975; }
      note(at, f * 1.3, f * 0.7, 0.22, 1, 30);
    } else { // wood pigeon: "coo-COO-coo, coo-coo", low and soft
      const f = r(480, 560);
      for (const [dt, d, a] of [[0, 0.32, 0.6], [0.42, 0.55, 1], [1.05, 0.3, 0.7], [1.45, 0.3, 0.6], [1.85, 0.32, 0.55]]) note(at + dt, f, f * 0.9, d, a * 1.6, 4);
    }
  }

  // a car going by on another road: a swell of tyre roar moving across, through the reverb
  car() {
    const ctx = this.ctx, t = ctx.currentTime, dur = 3 + Math.random() * 3, dir = Math.random() < 0.5 ? -1 : 1;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(260, t); f.frequency.linearRampToValueAtTime(700, t + dur * 0.5); f.frequency.linearRampToValueAtTime(220, t + dur);
    const g = ctx.createGain(), peak = 0.012 + 0.035 * this.scene.city * Math.random();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.9 * dir, t); p.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
    const send = ctx.createGain(); send.gain.value = 0.5;
    src.connect(f).connect(g).connect(p); p.connect(this.amb); p.connect(send).connect(this.verb);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.1);
  }

  // another rider going past; pan -1 (left) .. 1 (right)
  whoosh(pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.35); f.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 0.9, 1);
  }

  // chapeau received (or sent: quieter)
  chime(level = 0.25) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [[784, 0], [1175, 0.11]].forEach(([hz, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(level, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6);
      o.connect(g).connect(this.master);
      o.start(t + dt); o.stop(t + dt + 0.65);
    });
  }
}
