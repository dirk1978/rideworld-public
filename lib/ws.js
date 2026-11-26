// A small WebSocket server (RFC 6455) for the multiplayer link: text messages, ping/pong, close. No dependencies.
// Messages from browsers are masked as the spec requires; ours are sent unmasked.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => this.finish());
    sock.on('error', () => this.finish());
    this.pinger = setInterval(() => this.frame(0x9, Buffer.alloc(0)), 20000);
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.pinger);
    this.emit('close');
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MESSAGE || !masked) { this.close(1009); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        this.parts.push(payload);
        if (fin) {
          const text = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          let msg;
          try { msg = JSON.parse(text); } catch { continue; }
          this.emit('message', msg);
        }
      }
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len])
      : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 0xff])
        : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this.finish(); }
  }

  send(obj) { this.frame(0x1, Buffer.from(JSON.stringify(obj))); }

  close(code = 1000) {
    const b = Buffer.alloc(2); b.writeUInt16BE(code);
    this.frame(0x8, b);
    try { this.sock.end(); } catch {}
    this.finish();
  }
}

// Completes the HTTP upgrade; returns a Socket, or null after refusing
function accept(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`, '', ''].join('\r\n'));
  return new Socket(sock);
}

module.exports = { accept };
