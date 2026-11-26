// Turns watts into road speed with a standard cycling model, including inertia,
// so you coast, accelerate and slow on climbs the way you would outdoors.

const G = 9.81;
const RHO = 1.225; // air density, kg/m^3

export class Bike {
  constructor({ riderKg = 75, bikeKg = 9, cda = 0.32, crr = 0.004, drivetrain = 0.97 } = {}) {
    Object.assign(this, { riderKg, bikeKg, cda, crr, drivetrain });
    this.v = 0; // m/s
    this.draft = 0; // share of air resistance saved by riding in someone's slipstream (0..0.5, see draft.js)
  }

  get mass() {
    return this.riderKg + this.bikeKg;
  }

  // The speed (m/s) these watts hold on this gradient once settled (for the ETA): drive force = resistance,
  // found by halving the range. 1 to 25 m/s (descents capped at 90 km/h: real riders brake for bends).
  steadySpeed(watts, gradePct) {
    const m = this.mass, theta = Math.atan(gradePct / 100);
    const surplus = (v) => (watts * this.drivetrain) / v - m * G * Math.sin(theta) - this.crr * m * G * Math.cos(theta) - 0.5 * RHO * this.cda * (1 - this.draft) * v * v;
    let lo = 1, hi = 25;
    if (surplus(hi) > 0) return hi;
    if (surplus(lo) < 0) return lo;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (surplus(mid) > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // dt in seconds, gradePct e.g. 5 for 5%
  step(watts, gradePct, dt) {
    const m = this.mass;
    const theta = Math.atan(gradePct / 100);
    const v = this.v;
    const drive = (watts * this.drivetrain) / Math.max(v, 1.0); // cap force at very low speed
    const gravity = m * G * Math.sin(theta);
    const rolling = v > 0.01 ? this.crr * m * G * Math.cos(theta) : 0;
    const aero = 0.5 * RHO * this.cda * (1 - this.draft) * v * v;
    const effectiveMass = m + 1.0; // a little extra for rotating wheels
    let a = (drive - gravity - rolling - aero) / effectiveMass;
    if (watts <= 0 && v < 0.3 && gravity >= 0) { this.v = 0; return 0; }
    this.v = Math.max(0, v + a * dt);
    return this.v;
  }
}

// Time (s) to ride from `from` to `to` m along a route: `gradeAt(d)` gives the gradient (%), `wattsAt(grade)` the
// power held there; each `step` m is ridden at the speed that power settles to (as the in-ride ETA does)
export function routeTime(bike, gradeAt, from, to, wattsAt, step = 20) {
  let t = 0;
  for (let d = from; d < to; d += step) {
    const g = gradeAt(d);
    t += Math.min(step, to - d) / bike.steadySpeed(wattsAt(g), g);
  }
  return t;
}
