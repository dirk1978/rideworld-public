// paint a box of the world's painted ground into one image (paintcore.drawTile), for key art
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const ow = window.__ow;
for (let i = 0; i < 120 && !(ow.on && ow.g?.edges?.length); i++) await sleep(500);
const P = await import('/js/app/paint.js'), PC = await import('/js/app/paintcore.js');
for (let i = 0; i < 60 && !P.paint.layer; i++) await sleep(500);
const B = window.__BOX, N = window.__PX || 3072; // { w, s, e, n } degrees
const R = 6378137, mx = (lo) => (lo * Math.PI / 180) * R, my = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)) * R;
const x0 = mx(B.w), x1 = mx(B.e), y0 = my(B.s), y1 = my(B.n), H = Math.round(N * (y1 - y0) / (x1 - x0));
const out = document.createElement('canvas'); out.width = N; out.height = H; const g = out.getContext('2d');
// tiles of 512 px painted at the right ground scale, laid side by side in Mercator
const per = 512, nx = Math.ceil(N / per), ny = Math.ceil(H / per), inv = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
  const tx0 = x0 + (x1 - x0) * (i * per / N), tx1 = x0 + (x1 - x0) * ((i + 1) * per / N), ty1 = y1 - (y1 - y0) * (j * per / H), ty0 = y1 - (y1 - y0) * ((j + 1) * per / H);
  const c = PC.drawTile(tx0 / R * 180 / Math.PI, inv(ty0), tx1 / R * 180 / Math.PI, inv(ty1));
  g.drawImage(c, i * per, j * per);
}
return { ok: true, w: N, h: H, img: out.toDataURL('image/jpeg', 0.92) };
