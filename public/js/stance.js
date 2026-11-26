// Standing up (2026-11-03, the owner's avatar list: "sprinting/standing up"). rider GLBs carry two crank cycles, "pedal"
// (seated) and "stand" (out of the saddle, the bike rocking under the rider: tools/rider/build_rider.py). A rider
// stands for a sprint (1.4 x FTP or more for a second) and for bursts on steep climbs (7%+, below 78 rpm, 80% of FTP
// or more: up to 14-22 s, then sits for 25-50 s), and sits again 1.2 s after the reason stops. Other riders' FTP isn't
// known: 250 W is used. No blending between the two (Cesium can't): it switches on the spot, as riders do.
export function stanceStep(s, { watts = 0, ftp = 250, grade = 0, cadence = 0, dt = 0, riding = false }) {
  s.t = (s.t || 0) + dt;
  s.seed ??= Math.random();
  const sprint = riding && cadence > 0 && watts >= 1.4 * ftp;
  const climb = riding && cadence > 0 && cadence < 78 && grade >= 0.07 && watts >= 0.8 * ftp;
  if (!s.on) {
    s.want = sprint || (climb && s.t >= (s.rest || 0)) ? (s.want || 0) + dt : 0;
    if (s.want >= (sprint ? 1.0 : 2.0)) Object.assign(s, { on: true, since: 0, drop: 0 });
  } else {
    s.since += dt;
    const keep = sprint || (climb && s.since < 14 + s.seed * 8);
    s.drop = keep ? 0 : (s.drop || 0) + dt;
    if (s.drop >= 1.2) Object.assign(s, { on: false, want: 0, drop: 0, rest: s.t + 25 + Math.random() * 25 });
  }
  return !!s.on;
}

// Off since 2026-11-03 (the owner's recording: "from behind it looks nothing like a human riding up a hill or sprinting");
// riders stay seated until it's redone against recordings of Zwift's riders. true turns it back on.
export const STANDING = false;
// switch a rider model's crank cycle (model.rwAnim: app/model.js)
export function setStance(model, standing) {
  if (!STANDING) return;
  const a = model?.rwAnim;
  if (!a || a.standing === standing || a.noStand) return;
  try {
    const next = a.anims.add({ name: standing ? 'stand' : 'pedal', loop: a.loop, animationTime: a.crankFn });
    a.anims.remove(a.cur);
    Object.assign(a, { cur: next, standing });
  } catch { a.noStand = true; } // (an older model without "stand")
}
