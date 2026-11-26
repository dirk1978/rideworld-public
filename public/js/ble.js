// Bluetooth sensors via Web Bluetooth (Chrome/Edge, HTTPS only), using the standard Bluetooth SIG services:
//   Fitness Machine (FTMS, 0x1826)  smart trainers: power, cadence, speed; slope control (Kickr Core, Tacx, Elite…)
//   Cycling Power (0x1818)          power meters and trainers that only report power
//   Heart Rate (0x180D)             chest straps and watches broadcasting HR
//   Cycling Speed & Cadence (0x1816) crank cadence sensors (Garmin, Wahoo…): a cadence that doesn't depend on the trainer
// Each class exposes the same fields the ANT+ driver does, so the app treats them alike.

const FTMS = 0x1826, INDOOR_BIKE_DATA = 0x2ad2, FTMS_CONTROL = 0x2ad9;
const CPS = 0x1818, CP_MEASUREMENT = 0x2a63;
const HRS = 0x180d, HR_MEASUREMENT = 0x2a37;
const CSC = 0x1816, CSC_MEASUREMENT = 0x2a5b;
const BATTERY = 0x180f, BATTERY_LEVEL = 0x2a19; // (2026-10-29: battery shown in the sensor list)
const UDS = 0x181c, UDS_WEIGHT = 0x2a98; // User Data service: Weight (the trainer's rider weight)
// (2026-10-29, finding how to tell a Bluetooth trainer the rider's weight: FTMS has no field for it) User Data (0x181C),
// Device Information and Wahoo's own services, asked for so probeServices() can list what a trainer offers
const PROBE = [0x181c, 0x180a, ...['01', '03', '06', '0b'].map((x) => `a026ee${x}-0a7d-4ab3-97fa-f1500f9feb8b`)];
const STALE_MS = 5000;

export const bleSupported = () => !!(navigator.bluetooth && window.isSecureContext);

// ---------- parsers (exported for tests) ----------
export function parseIndoorBikeData(dv) {
  const flags = dv.getUint16(0, true);
  let o = 2;
  const out = {};
  if (!(flags & 0x0001)) { out.speed = dv.getUint16(o, true) / 100 / 3.6; o += 2; } // bit 0 = "more data": speed present when clear
  if (flags & 0x0002) o += 2;                                                      // average speed
  if (flags & 0x0004) { out.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2;                                                      // average cadence
  if (flags & 0x0010) o += 3;                                                      // total distance
  if (flags & 0x0020) o += 2;                                                      // resistance level
  if (flags & 0x0040) { out.power = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2;                                                      // average power
  if (flags & 0x0100) o += 5;                                                      // expended energy
  if (flags & 0x0200) { out.hr = dv.getUint8(o); o += 1; }
  return out;
}

// Cadence from the crank revolution counter needs the previous reading, so this takes and returns state
export function parseCyclingPower(dv, prev = {}) {
  const flags = dv.getUint16(0, true);
  const out = { power: dv.getInt16(2, true) };
  let o = 4;
  if (flags & 0x0001) o += 1;   // pedal power balance
  if (flags & 0x0004) o += 2;   // accumulated torque
  if (flags & 0x0010) o += 6;   // wheel revolution data
  if (flags & 0x0020) {         // crank revolution data
    const revs = dv.getUint16(o, true), time = dv.getUint16(o + 2, true);
    if (prev.crankRevs !== undefined) {
      const dRevs = (revs - prev.crankRevs + 65536) % 65536;
      const dTime = (time - prev.crankTime + 65536) % 65536; // 1/1024 s
      if (dTime > 0 && dRevs < 20) out.cadence = (dRevs / (dTime / 1024)) * 60;
      else if (dTime === 0 && dRevs === 0) out.cadenceIdle = true;
    }
    out.crankRevs = revs; out.crankTime = time;
  }
  return out;
}

// The Kickr Core's FTMS cadence reads 0 at times while the rider pedals on (55 one-second zeros in a 42 min ride,
// power unaffected; over ANT+ about one a ride). Keep the last cadence through zeros for up to CAD_HOLD_MS while power
// is still coming in; a real stop (power gone, or zeros that last) still shows 0.
// 5 s since 2026-10-27: the owner's hour on the Kickr over Bluetooth still recorded 60 one-second zeros (cadence quiet
// for ~3 s about once a minute, power steady; he never saw it on ANT+). Stopping still shows 0: power falls to 0 within
// a second or two of the legs stopping, and then the hold lets go.
const CAD_HOLD_MS = 5000;
export function steadyCadence(cadence, power, now, st) {
  if (cadence > 0) { st.cad = cadence; st.at = now; return cadence; }
  if (power > 0 && st.cad > 0 && now - st.at < CAD_HOLD_MS) return st.cad;
  st.cad = 0;
  return 0;
}

// Cycling Power's cadence between revolutions (the owner 2026-10-27: 60 one-second zeros in an hour's ride, power steady):
// a message repeating the last crank count and time ("no new revolution": two notifications close together, or
// power coming more often than the crank turns) used to set cadence to 0 until the next message. Now the last cadence
// holds until 2.5 s pass without a new revolution (24 rpm is one every 2.5 s), as for crank sensors.
export function cpsCadence(d, st, now) {
  if (d.cadence !== undefined) { st.rpm = d.cadence; st.revAt = now; }
  return st.revAt !== undefined && now - st.revAt < 2500 ? st.rpm : 0;
}

// Cycling Speed & Cadence measurement: the crank's revolution count and the time of the last revolution (1/1024 s).
// A sensor repeats the same pair between revolutions, so cadence comes from the change since the last NEW revolution;
// takes and returns state like parseCyclingPower. { cadence } when a revolution came in, { same: true } otherwise.
export function parseCsc(dv, prev = {}) {
  const flags = dv.getUint8(0);
  let o = 1;
  if (flags & 0x01) o += 6; // wheel revolutions (uint32) and time (uint16)
  if (!(flags & 0x02) || dv.byteLength < o + 4) return { ...prev, same: true };
  const revs = dv.getUint16(o, true), time = dv.getUint16(o + 2, true), out = { crankRevs: revs, crankTime: time };
  if (prev.crankRevs === undefined) return out;
  const dRevs = (revs - prev.crankRevs + 65536) % 65536, dTime = (time - prev.crankTime + 65536) % 65536;
  if (dRevs === 0 || dTime === 0) return { ...prev, same: true };
  if (dRevs < 20) out.cadence = (dRevs / (dTime / 1024)) * 60;
  return out;
}

export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return { bpm: flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1) };
}

// ---------- base: connect, notifications, automatic reconnect ----------
class BleDevice extends EventTarget {
  constructor(kind) {
    super();
    this.kind = kind;
    this.device = null;
    this.connected = false;
    this.lastSeen = 0;
    this.name = '';
    this.battery = null; // { pct } from the Battery service, when the device has one
  }

  get live() { return this.connected && performance.now() - this.lastSeen < STALE_MS; }

  async pick(services, optional = []) {
    await this.use(await navigator.bluetooth.requestDevice({ filters: services.map((s) => ({ services: [s] })), optionalServices: [...optional, BATTERY] }));
  }

  // a device already chosen (pickAnyBle)
  async use(device) {
    this.device = device;
    this.name = this.device.name || 'Bluetooth device';
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect());
    await this.open();
    this.watchBattery();
  }

  // Battery level (standard Battery service 0x180F): read now, then as the device notifies or every 5 min. Only devices
  // chosen since the service was asked for (2026-10-29) can be read: older permissions don't include it.
  async watchBattery() {
    try {
      const ch = await (await this.device.gatt.getPrimaryService(BATTERY)).getCharacteristic(BATTERY_LEVEL);
      const set = (dv) => { if (dv.byteLength) this.battery = { pct: Math.min(100, dv.getUint8(0)) }; };
      set(await ch.readValue());
      try { ch.addEventListener('characteristicvaluechanged', (e) => set(e.target.value)); await ch.startNotifications(); } catch {}
      clearInterval(this.batteryTimer);
      this.batteryTimer = setInterval(() => { if (this.connected) ch.readValue().then(set, () => {}); }, 300000);
    } catch { /* no battery service, or not permitted */ }
  }

  async onDisconnect() {
    this.connected = false;
    if (this.closing) return;
    this.dispatchEvent(new CustomEvent('status', { detail: 'reconnecting' }));
    for (let attempt = 1; attempt <= 6 && !this.closing; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      try { await this.open(); this.watchBattery(); this.dispatchEvent(new CustomEvent('status', { detail: 'reconnected' })); return; } catch {}
    }
    this.dispatchEvent(new CustomEvent('status', { detail: 'lost' }));
    // (then quietly every 10 s for 10 minutes: a sensor that sleeps, or a bike whose Bluetooth restarts, comes back by
    // itself; 2026-11-21, a rider's Stages bike dropped every sensor and "would not reconnect")
    for (let n = 0; n < 60 && !this.closing && !this.connected; n++) {
      await new Promise((r) => setTimeout(r, 10000));
      if (this.closing || this.connected) return;
      try { await this.open(); this.watchBattery(); this.dispatchEvent(new CustomEvent('status', { detail: 'reconnected' })); return; } catch {}
    }
  }

  async notify(service, charId, handler) {
    const ch = await service.getCharacteristic(charId);
    ch.addEventListener('characteristicvaluechanged', (e) => { this.lastSeen = performance.now(); handler(e.target.value); });
    await ch.startNotifications();
    return ch;
  }

  disconnect() {
    this.closing = true;
    clearInterval(this.batteryTimer);
    try { this.device?.gatt.disconnect(); } catch {}
    this.connected = false;
  }
}

// ---------- smart trainer (FTMS), falling back to Cycling Power if it has no FTMS ----------
export class BleTrainer extends BleDevice {
  constructor() {
    super('trainer');
    this.power = 0; this.cadence = 0; this.speed = 0;
    this.cadHold = {};
    this.controllable = false;
    this.sentGrade = null;
    this.pendingGrade = null;
    this.wind = 0.39;        // kg/m, CdA x air density; updated by setWindResistance
    this.queue = Promise.resolve();
  }

  connect() { return this.pick([FTMS, CPS], [FTMS, CPS]); }

  async open() {
    this.weightSent = null; // (sent again on each connection)
    const gatt = await this.device.gatt.connect();
    let ftms = null;
    try { ftms = await gatt.getPrimaryService(FTMS); } catch {}
    if (ftms) {
      await this.notify(ftms, INDOOR_BIKE_DATA, (dv) => {
        const d = parseIndoorBikeData(dv);
        if (d.power !== undefined) this.power = Math.max(0, d.power);
        if (d.cadence !== undefined) this.cadence = steadyCadence(d.cadence, this.power, performance.now(), this.cadHold);
        if (d.speed !== undefined) this.speed = d.speed;
      });
      try {
        this.control = await ftms.getCharacteristic(FTMS_CONTROL);
        // the trainer answers control commands by indication; we must listen before writing
        this.control.addEventListener('characteristicvaluechanged', (e) => this.onControlResponse(e.target.value));
        await this.control.startNotifications();
        await this.write([0x00]); // Request Control
        await this.write([0x07]); // Start or Resume
        this.controllable = true;
      } catch (e) {
        console.warn('trainer control unavailable (is another app connected to it?)', e);
        this.controllable = false;
      }
    } else {
      const cps = await gatt.getPrimaryService(CPS);
      let prev = {};
      await this.notify(cps, CP_MEASUREMENT, (dv) => {
        const d = parseCyclingPower(dv, prev);
        prev = d;
        this.power = Math.max(0, d.power);
        this.cadence = cpsCadence(d, this.cadHold, performance.now());
      });
      this.controllable = false;
    }
    this.connected = true;
    this.lastSeen = performance.now();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), 1000);
  }

  onControlResponse(dv) {
    // 0x80, request op code, result (1 = success)
    if (dv.getUint8(0) === 0x80 && dv.getUint8(2) !== 0x01) console.warn('trainer refused command', dv.getUint8(1), 'result', dv.getUint8(2));
  }

  // GATT writes can't overlap, so they go through a queue
  write(bytes) {
    this.queue = this.queue.then(() => this.control.writeValueWithResponse(new Uint8Array(bytes))).catch((e) => console.warn('trainer write failed', e));
    return this.queue;
  }

  // a slope cancels a queued target power and the other way round (the trainer follows the last command)
  setGrade(percent) { this.pendingGrade = Math.max(-35, Math.min(35, percent)); this.pendingTarget = null; this.erg = false; } // trainer limits itself
  setTargetPower(watts) { this.pendingTarget = Math.max(0, Math.min(2000, Math.round(watts))); this.pendingGrade = null; }

  // Indoor Bike Simulation Parameters (op 0x11): wind speed 0.001 m/s, grade 0.01 %, Crr 0.0001, wind resistance 0.01 kg/m
  flush() {
    if (!this.controllable || !this.connected) return;
    if (this.pendingTarget != null) { // ERG: Set Target Power (op 0x05)
      this.sentTarget = this.pendingTarget;
      this.erg = true;
      this.write(ftmsTargetPower(this.pendingTarget));
      this.pendingTarget = null;
      return;
    }
    if (this.pendingGrade === null) return;
    const g = Math.round(this.pendingGrade * 100);
    const cw = Math.max(0, Math.min(255, Math.round(this.wind * 100)));
    this.sentGrade = this.pendingGrade;
    this.pendingGrade = null;
    this.write([0x11, 0, 0, g & 0xff, (g >> 8) & 0xff, this.crr ? Math.max(0, Math.min(255, Math.round(this.crr / 0.0001))) : 40, cw]); // (Crr from the surface, 2026-11-17)
  }

  // Rider + bike weight (2026-10-29): FTMS's simulation message has no weight, but a trainer may offer the standard
  // User Data service's Weight (0x2A98, uint16 in 0.005 kg; the owner's Kickr Core does, after a Wahoo firmware update)
  // and use it in its simulation. Written through the same queue as the control point (GATT operations can't overlap),
  // once per connection or change; the value before and after goes to the server log. Trainers without it keep their
  // own app's weight. The total, as ANT+ FE-C gets rider and bike.
  setUserWeight(riderKg, bikeKg) {
    const total = riderKg + bikeKg;
    if (!(total > 20 && total < 300) || this.weightSent === total) return this.queue;
    this.queue = this.queue.then(async () => {
      const ch = await (await this.device.gatt.getPrimaryService(UDS)).getCharacteristic(UDS_WEIGHT);
      const before = (await ch.readValue()).getUint16(0, true) * 0.005, v = Math.round(total / 0.005);
      await ch.writeValue(new Uint8Array([v & 0xff, v >> 8]));
      const after = (await ch.readValue()).getUint16(0, true) * 0.005;
      this.weightSent = total;
      fetch('api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: `ble-weight ${this.name}`, msg: `trainer weight ${before.toFixed(1)} -> ${after.toFixed(1)} kg (sent ${total})` }) }).catch(() => {});
    }).catch((e) => console.info('trainer weight not set:', e.message));
    return this.queue;
  }
  // Wind drag rides along with the slope.
  // FTMS has no drafting field: a draft is sent as less wind resistance
  async setWindResistance(cda, draft = 0) { this.wind = cda * 1.225 * (1 - draft); if (this.sentGrade !== null && this.pendingGrade === null) this.pendingGrade = this.sentGrade; }

  disconnect() { clearInterval(this.timer); super.disconnect(); }
}

// ---------- power meter (Cycling Power) ----------
export class BlePowerMeter extends BleDevice {
  constructor() { super('power'); this.power = 0; this.cadence = 0; this.cadHold = {}; }
  connect() { return this.pick([CPS]); }
  async open() {
    const gatt = await this.device.gatt.connect();
    const cps = await gatt.getPrimaryService(CPS);
    let prev = {};
    await this.notify(cps, CP_MEASUREMENT, (dv) => {
      const d = parseCyclingPower(dv, prev);
      prev = d;
      this.power = Math.max(0, d.power);
      this.cadence = cpsCadence(d, this.cadHold, performance.now());
    });
    this.connected = true;
    this.lastSeen = performance.now();
  }
}

// ---------- heart rate ----------
export class BleHeartRate extends BleDevice {
  constructor() { super('hr'); this.bpm = 0; }
  connect() { return this.pick([HRS]); }
  async open() {
    const gatt = await this.device.gatt.connect();
    const hrs = await gatt.getPrimaryService(HRS);
    await this.notify(hrs, HR_MEASUREMENT, (dv) => { this.bpm = parseHeartRate(dv).bpm; });
    this.connected = true;
    this.lastSeen = performance.now();
  }
}

// ---------- cadence sensor (Cycling Speed & Cadence) ----------
// the owner 2026-10-27: a Garmin cadence sensor on the crank, so cadence needn't come from the trainer's Bluetooth (the
// Kickr Core's dropped out). The last cadence holds between revolutions; 0 after 2.5 s without one (well under any
// real cadence: 24 rpm is one every 2.5 s).
export class BleCadence extends BleDevice {
  constructor() { super('cadence'); this.rpm = 0; this.lastRevAt = 0; }
  get cadence() { return performance.now() - this.lastRevAt < 2500 ? this.rpm : 0; }
  connect() { return this.pick([CSC]); }
  async open() {
    const gatt = await this.device.gatt.connect();
    const csc = await gatt.getPrimaryService(CSC);
    let prev = {};
    await this.notify(csc, CSC_MEASUREMENT, (dv) => {
      const d = parseCsc(dv, prev);
      if (d.same) return;
      prev = d;
      if (d.cadence !== undefined && d.cadence < 250) { this.rpm = d.cadence; this.lastRevAt = performance.now(); }
    });
    this.connected = true;
    this.lastSeen = performance.now();
  }
}

// One pairing window for every kind of sensor (the owner 2026-10-27: four Bluetooth buttons, one per kind, were
// confusing): Chrome lists anything offering one of our services; what it is comes from what it offers. A trainer
// (FTMS) is a trainer whatever else it has; then a power meter, a heart-rate strap, a cadence sensor.
// Returns { dev, slot } (slot: the devices.js field it belongs in).
export async function pickAnyBle() {
  const all = [FTMS, CPS, HRS, CSC];
  const device = await navigator.bluetooth.requestDevice({ filters: all.map((s) => ({ services: [s] })), optionalServices: [...all, BATTERY, ...PROBE] });
  const gatt = await device.gatt.connect();
  const has = async (s) => { try { await gatt.getPrimaryService(s); return true; } catch { return false; } };
  const ftms = await has(FTMS), cps = !ftms && await has(CPS), hrs = !ftms && !cps && await has(HRS), csc = !ftms && !cps && !hrs && await has(CSC);
  const [Cls, slot] = ftms ? [BleTrainer, 'bleTrainer'] : cps ? [BlePowerMeter, 'blePower'] : hrs ? [BleHeartRate, 'bleHr'] : csc ? [BleCadence, 'bleCadence'] : [null, null];
  if (!Cls) { try { gatt.disconnect(); } catch {} throw new Error(`${device.name || 'That device'} isn't a trainer, power meter, heart-rate strap or cadence sensor`); }
  const dev = new Cls();
  await dev.use(device);
  if (slot === 'bleTrainer') probeServices(device);
  return { dev, slot };
}

// Every service and characteristic a device lets this page see, sent to the server log (journalctl -u rideworld,
// "client error [user] ble-probe: ..."), once per device per page load
export async function probeServices(device) {
  if (probeServices.done?.has(device.id)) return;
  (probeServices.done ||= new Set()).add(device.id);
  const lines = [];
  try {
    for (const s of await device.gatt.getPrimaryServices()) {
      let chars = [];
      try { chars = await s.getCharacteristics(); } catch {}
      lines.push(`${s.uuid}: ${chars.map((c) => `${c.uuid.slice(0, 8)}[${Object.entries(c.properties.toJSON ? c.properties.toJSON() : {}).filter(([, v]) => v).map(([k]) => k).join('|') || ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => c.properties[k]).join('|')}]`).join(' ')}`);
    }
  } catch (e) { lines.push('error: ' + e.message); }
  const send = (msg, i) => fetch('api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: `ble-probe ${device.name} ${i}`, msg }) }).catch(() => {});
  lines.forEach((l, i) => send(l, i));
  console.info('Bluetooth services of', device.name, lines);
}

// Remembered devices (the owner 2026-10-29: "every time I stop and start a ride, it doesn't remember the devices"): the
// page reloads after a ride, which drops Bluetooth. Chrome keeps the permission, and getDevices() hands back devices
// this site was allowed before, with no picker. Connect straight away; if the device isn't reachable yet (asleep, not
// pedalled), wait for it to advertise (watchAdvertisements) for up to 10 minutes.
export const bleRemembers = () => !!navigator.bluetooth?.getDevices;
const SLOT_CLASS = { bleTrainer: () => BleTrainer, blePower: () => BlePowerMeter, bleHr: () => BleHeartRate, bleCadence: () => BleCadence };
export async function reconnectBle(id, slot, onReady) {
  const device = (await navigator.bluetooth.getDevices()).find((d) => d.id === id);
  if (!device || !SLOT_CLASS[slot]) return false;
  const go = async () => { const dev = new (SLOT_CLASS[slot]())(); await dev.use(device); if (slot === 'bleTrainer') probeServices(device); onReady(dev); };
  try { await go(); return true; } catch {}
  if (!device.watchAdvertisements) return false;
  const ac = new AbortController();
  let busy = false;
  device.addEventListener('advertisementreceived', async () => {
    if (busy) return; busy = true;
    try { await go(); ac.abort(); } catch { busy = false; }
  });
  try { await device.watchAdvertisements({ signal: ac.signal }); } catch { return false; }
  setTimeout(() => ac.abort(), 600000);
  return true;
}

// FTMS control point op 0x05 Set Target Power: watts as a signed 16-bit little-endian number
export function ftmsTargetPower(watts) {
  const w = Math.max(0, Math.min(4000, Math.round(watts)));
  return [0x05, w & 0xff, (w >> 8) & 0xff];
}
