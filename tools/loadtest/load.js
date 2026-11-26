// Fake riders for the load test: each connects to the test server's /ws with its own session, joins a drop-in
// room (10 per room, one test route each) and sends its position 4 times a second, as the ride page does.
// Reports state messages received and how late they arrive. Usage: node load.js <riders> <seconds> [firstIndex]
const tls = require('tls'), crypto = require('crypto'), fs = require('fs');
const [N, SECS, FIRST = 0] = process.argv.slice(2).map(Number);
const ROOM = +(process.env.ROOM || 10); // riders per room (one shared world: ROOM=100000)
const tokens = JSON.parse(fs.readFileSync(__dirname + '/tokens.json'));
let states = 0, bytes = 0, errors = 0, connected = 0;
const gaps = [];
function frame(obj) {
  const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
  const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 0xff]);
  for (let i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, p]);
}
function rider(i) {
  const s = tls.connect({ host: '127.0.0.1', port: 9443, rejectUnauthorized: false }, () => {
    s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:9443\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nCookie: rw_session=${tokens[i]}\r\n\r\n`);
  });
  let buf = Buffer.alloc(0), up = false, last = 0, dist = Math.random() * 500, timer;
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!up) {
      const e = buf.indexOf('\r\n\r\n'); if (e < 0) return;
      if (!/^HTTP\/1.1 101/.test(buf.toString('utf8', 0, 20))) { errors++; s.destroy(); return; }
      up = true; connected++; buf = buf.subarray(e + 4);
      s.write(frame({ type: 'join', room: `route:lt-route-${Math.floor(i / ROOM)}` }));
      timer = setInterval(() => { dist += 2.5; s.write(frame({ type: 'pos', dist, speed: 10, power: 200, cadence: 88, riding: true, finished: false })); }, 250);
    }
    while (buf.length >= 2) {
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const op = buf[0] & 0x0f, p = buf.subarray(off, off + len); buf = buf.subarray(off + len);
      bytes += len;
      if (op === 0x1 && p.includes('"type":"state"')) {
        states++;
        const now = Date.now(); if (last) gaps.push(now - last); last = now;
      }
    }
  });
  s.on('error', () => { errors++; });
  s.on('close', () => clearInterval(timer));
  return s;
}
const socks = [];
for (let i = FIRST; i < FIRST + N; i++) setTimeout(() => socks.push(rider(i)), (i - FIRST) * 5);
setTimeout(() => {
  gaps.sort((a, b) => a - b);
  const pct = (q) => gaps[Math.floor(gaps.length * q)] ?? null;
  console.log(JSON.stringify({ riders: N, connected, errors, statesPerRiderPerSec: +(states / N / (SECS - N * 0.005)).toFixed(2), kbPerRiderPerSec: +(bytes / 1024 / N / (SECS - N * 0.005)).toFixed(2), gapMs: { p50: pct(0.5), p99: pct(0.99), max: gaps.at(-1) } }));
  for (const s of socks) s.destroy();
  process.exit(0);
}, SECS * 1000);
