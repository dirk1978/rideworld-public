// Minimal ANT+ driver over WebUSB for Garmin/Dynastream USB sticks (USB2 0x1008, USB-m 0x1009).
// Opens three slave channels: heart rate (device type 0x78), FE-C trainer (0x11) and bike cadence (0x7A: crank
// cadence sensors such as Garmin's).

import { steadyCadence } from './ble.js';

const SYNC = 0xa4;
const MSG = {
  RESET: 0x4a,
  NETWORK_KEY: 0x46,
  ASSIGN: 0x42,
  CHANNEL_ID: 0x51,
  PERIOD: 0x43,
  RF_FREQ: 0x45,
  SEARCH_TIMEOUT: 0x44,
  OPEN: 0x4b,
  BROADCAST: 0x4e,
  ACKNOWLEDGED: 0x4f,
  CHANNEL_EVENT: 0x40,
  STARTUP: 0x6f,
};
const ANTPLUS_KEY = [0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45];

const CH_HR = 0;
const CH_FEC = 1;
const CH_CAD = 2;

function frame(id, data) {
  const out = [SYNC, data.length, id, ...data];
  let cs = 0;
  for (const b of out) cs ^= b;
  out.push(cs);
  return new Uint8Array(out);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AntStick extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.inEp = null;
    this.outEp = null;
    this.buf = [];
    this.running = false;
    this.fec = { power: 0, cadence: 0, speed: 0, connected: false, lastSeen: 0 };
    this.fecCadHold = {};
    this.hr = { bpm: 0, connected: false, lastSeen: 0 };
    this.cad = { cadence: 0, connected: false, lastSeen: 0 }; // a crank cadence sensor
    this.pendingGrade = null;
  }

  static supported() {
    return 'usb' in navigator;
  }

  // a stick this site was allowed before (Chrome remembers it): reopened with no picker after the page reloads
  static async remembered() {
    if (!navigator.usb?.getDevices) return null;
    return (await navigator.usb.getDevices()).find((d) => d.vendorId === 0x0fcf && (d.productId === 0x1008 || d.productId === 0x1009)) || null;
  }

  async connect(device) {
    this.device = device || await navigator.usb.requestDevice({
      filters: [{ vendorId: 0x0fcf, productId: 0x1008 }, { vendorId: 0x0fcf, productId: 0x1009 }],
    });
    await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    const iface = this.device.configuration.interfaces[0];
    await this.device.claimInterface(iface.interfaceNumber);
    for (const ep of iface.alternate.endpoints) {
      if (ep.direction === 'in') this.inEp = ep.endpointNumber;
      else this.outEp = ep.endpointNumber;
    }
    this.running = true;
    this.readLoop();

    await this.send(MSG.RESET, [0x00]);
    await sleep(600);
    await this.send(MSG.NETWORK_KEY, [0x00, ...ANTPLUS_KEY]);
    // heart rate: paired to the strap found before (2026-11-25, the owner: a steady 118 bpm with his strap's module off: a
    // watch broadcasting its wrist heart rate was taken, as the channel took any strap it heard); none yet: any, then remembered
    const hp = AntStick.hrPair();
    await this.openChannel(CH_HR, 0x78, 8070, hp?.n || 0, hp?.t || 0);
    this.hr.dev = hp?.n || 0;
    await this.openChannel(CH_FEC, 0x11, 8192);
    await this.openChannel(CH_CAD, 0x7a, 8102);
    this.watchdog = setInterval(() => this.checkStale(), 1000);
    this.gradeTimer = setInterval(() => this.flushGrade(), 1000);
  }

  static hrPair() { try { return JSON.parse(localStorage.getItem('rw.antHr') || 'null'); } catch { return null; } }
  // forget the strap: back to any strap, which is then remembered again
  async forgetHr() {
    try { localStorage.removeItem('rw.antHr'); } catch {}
    this.hr = { bpm: 0, connected: false, lastSeen: 0, dev: 0 };
    await this.send(0x4c, [CH_HR]); await sleep(400); // close
    await this.send(MSG.CHANNEL_ID, [CH_HR, 0x00, 0x00, 0x78, 0x00]);
    await this.send(MSG.OPEN, [CH_HR]);
  }
  async openChannel(ch, deviceType, period, dev = 0, trans = 0) {
    await this.send(MSG.ASSIGN, [ch, 0x00, 0x00]); // slave, network 0
    await this.send(MSG.CHANNEL_ID, [ch, dev & 0xff, (dev >> 8) & 0xff, deviceType, trans]); // device number (0 = any)
    await this.send(MSG.PERIOD, [ch, period & 0xff, period >> 8]);
    await this.send(MSG.RF_FREQ, [ch, 57]); // 2457 MHz
    await this.send(MSG.SEARCH_TIMEOUT, [ch, 0xff]); // search forever
    await this.send(MSG.OPEN, [ch]);
  }

  async send(id, data) {
    await this.device.transferOut(this.outEp, frame(id, data));
    await sleep(40);
  }

  async readLoop() {
    while (this.running) {
      try {
        const res = await this.device.transferIn(this.inEp, 64);
        if (res.data) {
          for (let i = 0; i < res.data.byteLength; i++) this.buf.push(res.data.getUint8(i));
          this.parse();
        }
      } catch (e) {
        if (this.running) this.dispatchEvent(new CustomEvent('error', { detail: e }));
        this.running = false;
      }
    }
  }

  parse() {
    while (this.buf.length >= 4) {
      const s = this.buf.indexOf(SYNC);
      if (s < 0) { this.buf = []; return; }
      if (s > 0) this.buf.splice(0, s);
      const len = this.buf[1];
      if (this.buf.length < len + 4) return;
      const msg = this.buf.splice(0, len + 4);
      let cs = 0;
      for (let i = 0; i < len + 3; i++) cs ^= msg[i];
      if (cs !== msg[len + 3]) continue;
      this.handle(msg[2], msg.slice(3, 3 + len));
    }
  }

  handle(id, data) {
    // the strap the heart-rate channel found: remember its device number, so only it is listened to from now on
    if (id === MSG.CHANNEL_ID && data[0] === CH_HR) {
      const n = data[1] | (data[2] << 8), t = data[4];
      if (n) { this.hr.dev = n; try { localStorage.setItem('rw.antHr', JSON.stringify({ n, t })); } catch {} this.dispatchEvent(new CustomEvent('hrpaired', { detail: n })); }
      return;
    }
    if (id !== MSG.BROADCAST && id !== MSG.ACKNOWLEDGED && id !== 0x50) return;
    const ch = data[0];
    const p = data.slice(1, 9);
    const now = performance.now();
    if (ch === CH_HR || ch === CH_CAD) this.battery(ch === CH_HR ? this.hr : this.cad, p);
    if (ch === CH_HR) {
      this.hr.bpm = p[7];
      this.hr.connected = true;
      this.hr.lastSeen = now;
      if (!this.hr.dev && now - (this.hr.asked || 0) > 3000) { this.hr.asked = now; this.send(0x4d, [CH_HR, MSG.CHANNEL_ID]).catch(() => {}); } // (which strap is this? its reply is the CHANNEL_ID message above)
    } else if (ch === CH_CAD) {
      // bike cadence: bytes 4-5 the time of the last crank revolution (1/1024 s), 6-7 the revolution count
      const c = this.cad, time = p[4] | (p[5] << 8), revs = p[6] | (p[7] << 8);
      c.connected = true; c.lastSeen = now;
      if (c.revs !== undefined) {
        const dRevs = (revs - c.revs + 65536) % 65536, dTime = (time - c.time + 65536) % 65536;
        if (dRevs > 0 && dTime > 0 && dRevs < 20) { c.rpm = (dRevs / (dTime / 1024)) * 60; c.lastRevAt = now; }
      }
      c.revs = revs; c.time = time;
      c.cadence = now - (c.lastRevAt || 0) < 2500 && c.rpm < 250 ? c.rpm : 0;
    } else if (ch === CH_FEC) {
      this.fec.connected = true;
      this.fec.lastSeen = now;
      if (p[0] === 0x10) {
        this.fec.speed = ((p[5] << 8) | p[4]) / 1000; // m/s (trainer's own estimate, not used for movement)
      } else if (p[0] === 0x19) {
        // (the same one-message hold as Bluetooth FTMS: a lone 0 while power keeps coming is a blip)
        this.fec.cadence = steadyCadence(p[2] === 0xff ? 0 : p[2], this.fec.power, now, this.fecCadHold);
        const w = p[5] | ((p[6] & 0x0f) << 8);
        this.fec.power = w === 0xfff ? 0 : w;
      }
    }
    this.dispatchEvent(new Event('data'));
  }

  // Battery (2026-10-29): straps and crank sensors send a battery page now and then, among their data pages. Only
  // sensors whose page byte's top bit toggles send pages at all (older ones send bare data), so wait for a toggle.
  // HR page 7: byte 1 level % (0xFF = not given); bike cadence page 4 and the common page 82: a status in bits 4-6 of
  // byte 3 (page 4) / byte 7 (page 82).
  battery(s, p) {
    const t = p[0] & 0x80;
    if (s.lastToggle !== undefined && s.lastToggle !== t) s.paged = true;
    s.lastToggle = t;
    if (!s.paged) return;
    const page = p[0] & 0x7f, word = (b) => ['', 'new', 'good', 'ok', 'low', 'critical'][(b >> 4) & 7] || '';
    if (s === this.hr && page === 7) s.battery = { pct: p[1] <= 100 ? p[1] : undefined, status: word(p[3]) };
    else if (s === this.cad && page === 4) s.battery = { status: word(p[3]) };
    else if (page === 82) s.battery = { status: word(p[7]) };
  }

  checkStale() {
    const now = performance.now();
    if (this.hr.connected && now - this.hr.lastSeen > 5000) { this.hr.connected = false; this.hr.bpm = 0; }
    if (this.cad.connected && now - this.cad.lastSeen > 5000) { this.cad.connected = false; this.cad.cadence = 0; }
    else if (this.cad.connected && now - (this.cad.lastRevAt || 0) >= 2500) this.cad.cadence = 0;
    if (this.fec.connected && now - this.fec.lastSeen > 5000) {
      this.fec.connected = false; this.fec.power = 0; this.fec.cadence = 0;
    }
  }

  // Queue a slope (percent); sent at most once a second as FE-C page 51 (Track Resistance). The trainer follows
  // whichever control page it got last, so a slope cancels any queued target power (and the other way round).
  setGrade(percent) {
    this.pendingGrade = Math.max(-35, Math.min(35, percent)); // the trainer applies its own limit (Kickr Core ~16%)
    this.pendingTarget = null;
    this.erg = false;
  }

  // ERG: queue a target power (watts); sent at most once a second as FE-C page 49 (Target Power)
  setTargetPower(watts) {
    this.pendingTarget = Math.max(0, Math.min(2000, Math.round(watts)));
    this.pendingGrade = null;
  }

  async flushGrade() {
    if (!this.fec.connected || !this.running) return;
    if (this.pendingTarget != null) {
      const w = this.pendingTarget;
      this.pendingTarget = null;
      this.erg = true;
      this.sentTarget = w;
      try { await this.send(MSG.ACKNOWLEDGED, [CH_FEC, ...fecTargetPower(w)]); } catch { /* transient */ }
      return;
    }
    if (this.pendingGrade === null) return;
    const raw = Math.round((this.pendingGrade + 200) / 0.01);
    this.sentGrade = this.pendingGrade;
    this.pendingGrade = null;
    try {
      // (the last byte: rolling resistance in 0.00005 units, from the surface under the wheels: gravel / dirt feel heavier, 2026-11-17)
      await this.send(MSG.ACKNOWLEDGED, [CH_FEC, 0x33, 0xff, 0xff, 0xff, 0xff, raw & 0xff, raw >> 8, this.crr ? Math.max(0, Math.min(254, Math.round(this.crr / 5e-5))) : 0xff]);
    } catch (e) { /* ignore transient send errors */ }
  }

  // FE-C page 55 User Configuration: rider + bike weight so the trainer's sim matches ours.
  async setUserWeight(riderKg, bikeKg) {
    const u = Math.round(riderKg / 0.01);
    const b = Math.round(bikeKg / 0.05);
    await this.send(MSG.ACKNOWLEDGED, [
      CH_FEC, 0x37, u & 0xff, u >> 8, 0xff, ((b & 0x0f) << 4) | 0x0f, b >> 4, 0xff, 0x00,
    ]);
  }

  // FE-C page 50 Wind Resistance: tells the trainer our aero drag so flats and descents match the
  // on-screen physics. Coefficient = CdA x air density (kg/m); no wind; drafting factor 1.00 = none, 0.65 = 35% less
  // drag (the last byte, in 0.01 units).
  async setWindResistance(cda, draft = 0) {
    const k = Math.max(0, Math.min(1.86, cda * 1.225));
    const factor = Math.round(Math.max(0, Math.min(1, 1 - draft)) * 100);
    await this.send(MSG.ACKNOWLEDGED, [CH_FEC, 0x32, 0xff, 0xff, 0xff, 0xff, Math.round(k / 0.01), 127, factor]);
  }

  async disconnect() {
    this.running = false;
    clearInterval(this.watchdog);
    clearInterval(this.gradeTimer);
    try { await this.send(MSG.RESET, [0x00]); } catch (e) {}
    try { await this.device.close(); } catch (e) {}
  }
}

// FE-C page 49 Target Power (ERG): 5 reserved bytes, then the target in 0.25 W units, little-endian
export function fecTargetPower(watts) {
  const u = Math.max(0, Math.min(65530, Math.round(watts * 4)));
  return [0x31, 0xff, 0xff, 0xff, 0xff, 0xff, u & 0xff, u >> 8];
}
