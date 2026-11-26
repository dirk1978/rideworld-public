// Inside the Android app only (apps/android): the app's WebView has no Web Bluetooth and no downloads, so the app
// injects `RideWorldAndroid` (MainActivity.Bridge) and this builds what the site already uses on top of it:
// navigator.bluetooth (requestDevice, getDevices, GATT, notifications, watchAdvertisements: everything ble.js calls)
// and file downloads (a[download] -> Downloads/RideWorld). In a normal browser RideWorldAndroid doesn't exist and this
// does nothing. A plain script, loaded before the modules, so ble.js sees navigator.bluetooth from the start.
(function () {
  const A = window.RideWorldAndroid;
  if (!A) return;
  window.rideworldApp = { platform: 'android', version: A.version() };
  document.documentElement.classList.add('in-app', 'android-app');

  // ---- calls into Java: each answers through __rwb.r(id, ok, value) ----
  const calls = new Map(); let seq = 0;
  const call = (fn, ...args) => new Promise((ok, fail) => { const id = ++seq; calls.set(id, [ok, fail]); A[fn](id, ...args); });
  const err = (msg) => { const m = /^(\w+Error): (.*)$/.exec(String(msg)) || [, 'NetworkError', String(msg)]; const e = new Error(m[2]); e.name = m[1]; return e; };

  const BASE = '-0000-1000-8000-00805f9b34fb';
  const NAMES = { heart_rate: 0x180d, cycling_power: 0x1818, cycling_speed_and_cadence: 0x1816, fitness_machine: 0x1826, battery_service: 0x180f, user_data: 0x181c, device_information: 0x180a };
  const uuid = (u) => {
    if (typeof u === 'string' && NAMES[u] != null) u = NAMES[u];
    if (typeof u === 'number') return u.toString(16).padStart(8, '0') + BASE;
    u = String(u).toLowerCase();
    return /^[0-9a-f]{4}$/.test(u) ? '0000' + u + BASE : /^[0-9a-f]{8}$/.test(u) ? u + BASE : u;
  };
  const toB64 = (v) => { const b = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const fromB64 = (s) => { const t = atob(s || ''), b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return new DataView(b.buffer); };
  const notFound = (what) => { const e = new Error(`No ${what} matching UUID found on the device.`); e.name = 'NotFoundError'; return e; };

  const devices = new Map(), chars = new Map();
  class Characteristic extends EventTarget {
    constructor(service, c) {
      super(); this.service = service; this.uuid = c.uuid; this.value = null;
      const p = { read: c.read, write: c.write, writeWithoutResponse: c.writeWithoutResponse, notify: c.notify, indicate: c.indicate };
      this.properties = { ...p, toJSON: () => p };
      chars.set(service.device.id + '|' + service.uuid + '|' + c.uuid, this);
    }
    get _a() { return [this.service.device.id, this.service.uuid, this.uuid]; }
    async readValue() { this.value = fromB64(await call('bleRead', ...this._a)); return this.value; }
    writeValueWithResponse(v) { return call('bleWrite', ...this._a, toB64(v), true).then(() => {}); }
    writeValueWithoutResponse(v) { return call('bleWrite', ...this._a, toB64(v), false).then(() => {}); }
    writeValue(v) { return this.properties.write || !this.properties.writeWithoutResponse ? this.writeValueWithResponse(v) : this.writeValueWithoutResponse(v); }
    async startNotifications() { await call('bleNotify', ...this._a, true); return this; }
    async stopNotifications() { await call('bleNotify', ...this._a, false); return this; }
  }
  class Service {
    constructor(device, s) { this.device = device; this.uuid = s.uuid; this.isPrimary = true; this._chars = s.chars.map((c) => new Characteristic(this, c)); }
    async getCharacteristic(u) { const id = uuid(u), c = this._chars.find((x) => x.uuid === id); if (!c) throw notFound('Characteristics'); return c; }
    async getCharacteristics(u) { return u == null ? this._chars : this._chars.filter((x) => x.uuid === uuid(u)); }
  }
  class Gatt {
    constructor(device) { this.device = device; this.connected = false; this._svcs = []; }
    async connect() {
      const list = await call('bleConnect', this.device.id).catch((e) => { throw err(e); });
      for (const k of [...chars.keys()]) if (k.startsWith(this.device.id + '|')) chars.delete(k);
      this._svcs = list.map((s) => new Service(this.device, s)); this.connected = true;
      return this;
    }
    disconnect() { if (!this.connected) return; this.connected = false; A.bleDisconnect(this.device.id); setTimeout(() => this.device.dispatchEvent(new Event('gattserverdisconnected')), 0); }
    async getPrimaryService(u) { if (!this.connected) throw err('NetworkError: GATT Server is disconnected.'); const id = uuid(u), s = this._svcs.find((x) => x.uuid === id); if (!s) throw notFound('Services'); return s; }
    async getPrimaryServices(u) { return u == null ? this._svcs : this._svcs.filter((x) => x.uuid === uuid(u)); }
  }
  class Device extends EventTarget {
    constructor(id, name) { super(); this.id = id; this.name = name || ''; this.gatt = new Gatt(this); this.watchingAdvertisements = false; }
    async watchAdvertisements(opts = {}) {
      A.bleWatch(this.id, true); this.watchingAdvertisements = true;
      opts.signal?.addEventListener('abort', () => { A.bleWatch(this.id, false); this.watchingAdvertisements = false; });
    }
    async forget() { A.bleForget(this.id); devices.delete(this.id); }
  }
  const device = (id, name) => { let d = devices.get(id); if (!d) devices.set(id, (d = new Device(id, name))); else if (name) d.name = name; return d; };

  window.__rwb = {
    r(id, ok, value) { const c = calls.get(id); if (!c) return; calls.delete(id); ok ? c[0](value) : c[1](err(value)); },
    ev(e) {
      if (e.t === 'val') { const c = chars.get(e.d + '|' + e.s + '|' + e.c); if (c) { c.value = fromB64(e.v); c.dispatchEvent(new Event('characteristicvaluechanged')); } return; }
      const d = devices.get(e.d); if (!d) return;
      if (e.t === 'disc') { if (d.gatt.connected) { d.gatt.connected = false; d.dispatchEvent(new Event('gattserverdisconnected')); } }
      else if (e.t === 'adv') { const ev = new Event('advertisementreceived'); ev.device = d; ev.rssi = e.rssi; d.dispatchEvent(ev); }
    },
  };
  const bluetooth = {
    async requestDevice(opts = {}) {
      const svcs = [...new Set((opts.filters || []).flatMap((f) => f.services || []).map(uuid))];
      const r = await call('bleRequest', JSON.stringify(svcs)).catch((e) => { throw err(e); });
      return device(r.id, r.name);
    },
    async getDevices() { return (await call('bleDevices')).map((r) => device(r.id, r.name)); },
    async getAvailability() { return true; },
    addEventListener() {}, removeEventListener() {},
  };
  try { Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true }); } catch { navigator.bluetooth = bluetooth; }

  // ---- downloads: the WebView can't save blob: links; hand the bytes to the app ----
  const save = async (href, name) => {
    try {
      const b = await (await fetch(href, { credentials: 'same-origin' })).blob();
      const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
      A.saveFile(name || 'rideworld-download', b.type || '', String(dataUrl).split(',')[1] || '');
    } catch (e) { console.warn('save failed', e); }
  };
  const isDownload = (a) => a && a.hasAttribute('download') && /^(blob:|data:|\/|https?:)/.test(a.getAttribute('href') || a.href || '');
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isDownload(this)) { save(this.href, this.getAttribute('download') || this.href.split('/').pop()); return; } return click.call(this); };
  document.addEventListener('click', (e) => { const a = e.target.closest?.('a[download]'); if (isDownload(a)) { e.preventDefault(); save(a.href, a.getAttribute('download') || a.href.split('/').pop()); } }, true);
})();
