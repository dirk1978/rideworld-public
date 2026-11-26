// The browser end of multiplayer: a WebSocket to the RideWorld server (/ws), joining a room (a group ride or drop-in
// on a route), sending our position ~4x a second and keeping the latest state of everyone else.
export class Multiplayer extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.room = null;        // e.g. 'group:ab12cd34' or 'route:brighton-rocks-ede8f1'
    this.wantRoom = null;    // rejoined automatically after a reconnect
    this.you = null;
    this.lane = 0;
    this.group = null;
    this.riders = new Map(); // id -> { ...latest, at (local ms when received) }
    this.clockOffset = 0;    // server ms - local ms
    this.retry = 0;
    this.lastPos = null;
    this.lastSent = 0;
    // heartbeat: keep our place in the room while the ride loop isn't running (loading scenery, setup screen)
    setInterval(() => { if (this.room && Date.now() - this.lastSent > 2000) this.sendPos(this.lastPos || {}); }, 1000);
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.role) this.send({ type: 'rc-role', role: this.role }); // the phone remote's target, after a reconnect too
      if (this.wantRoom) this.send({ type: 'join', room: this.wantRoom });
    };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.warn('multiplayer message', err); } };
    ws.onclose = () => {
      this.ws = null;
      this.room = null;
      if (!this.wantRoom && !this.role) return;
      const delay = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay); // network blip: come back and rejoin
    };
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  join(room) {
    this.wantRoom = room;
    this.riders.clear();
    if (this.ws?.readyState === 1) this.send({ type: 'join', room }); else this.connect();
  }

  leave() {
    this.wantRoom = null;
    this.room = null;
    this.group = null;
    this.riders.clear();
    this.send({ type: 'leave' });
  }

  // 'ride': this page is a ride the phone remote (/rc) can drive
  setRole(role) { this.role = role; if (this.ws?.readyState === 1) this.send({ type: 'rc-role', role }); else this.connect(); }

  sendPos(p) { this.lastPos = p; if (this.room) { this.lastSent = Date.now(); this.send({ type: 'pos', ...p }); } }

  serverNow() { return Date.now() + this.clockOffset; }

  onMessage(m) {
    if (m.now) this.clockOffset = m.now - Date.now();
    if (m.type === 'hello') this.you = m.you;
    else if (m.type === 'joined') { this.room = m.room; this.lane = m.lane ?? 0; this.group = m.group; }
    else if (m.type === 'state') {
      const now = performance.now(), seen = new Set();
      for (const row of m.riders) {
        // compact rows from the server: [id, lane, dist, speed, power, cadence, flags, name?, kit?]
        const [id, lane, dist, speed, power, cadence, flags, name, kit] = row;
        const r = { id, lane, dist, speed, power, cadence, riding: !!(flags & 1), finished: !!(flags & 2) };
        if (name !== undefined) Object.assign(r, { name, kit });
        seen.add(id);
        this.riders.set(id, { ...this.riders.get(id), ...r, at: now });
      }
      for (const id of this.riders.keys()) if (!seen.has(id)) this.riders.delete(id);
      if (m.group) this.group = m.group;
      this.total = m.total || 0; // everyone in the room; m.riders is only the nearest (see lib/multiplayer.js)
    } else if (m.type === 'start' && this.group) { this.group = { ...this.group, status: 'riding', startAt: m.at }; }
    this.dispatchEvent(new CustomEvent(m.type, { detail: m }));
  }
}
