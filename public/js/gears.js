// Virtual gears (2026-11-18, the owner: "if I get a Zwift Cog, will RideWorld support it?"). With a single cog on the
// trainer (Zwift Cog) or simply a fixed gear, the app does the shifting: each virtual gear makes the trainer push back as
// hard as the road would in that gear. Pure maths here (unit-tested); main.js applies it to the slope sent to the trainer.
//
// How: in simulation mode the trainer works out its resistance from the slope we send and its own speed (from the
// flywheel, so from your cadence through the real cog). A virtual gear f times the reference gear means that at the same
// cadence you'd be going f times as fast, so the power the road asks for is P(f v) = (m g (sin + crr) + aero(f v)) f v.
// The trainer asks P_t = (m g (s_t + crr) + aero(v)) v at its own speed, so the slope that makes them equal is
//   s_t = f (s + crr) + aero(v) (f^3 - 1) / (m g) - crr          (aero(v) = 1/2 rho CdA v^2; small-angle slopes)
// Gear 12 is the reference (f = 1: exactly what's sent without gears). Speed through the world still comes from your
// power (physics.js), as always; only how the pedals feel changes.

// 24 gears, the spread of a road bike (about 34x34 up to 53x11), the middle one = the reference
export const GEARS = [0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.40, 2.61, 2.82, 3.03, 3.24, 3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49];
export const REF_GEAR = 12; // (1-based: GEARS[11] = 2.40)
const G = 9.80665, RHO = 1.225;

// the factor of gear n (1..24) over the reference
export const gearFactor = (n) => GEARS[Math.max(1, Math.min(GEARS.length, n)) - 1] / GEARS[REF_GEAR - 1];

// the slope (percent) to send the trainer for road slope `gradePct` in gear n, at the trainer's own speed v (m/s), for a
// rider + bike of mass m (kg) and drag area cda (m^2); crr as sent to the trainer. Clamped to what trainers take.
export function gearedGrade(gradePct, n, { v, mass, cda, crr = 0.004 }) {
  const f = gearFactor(n);
  if (f === 1) return gradePct;
  const s = gradePct / 100, aero = 0.5 * RHO * cda * Math.max(0, v || 0) ** 2;
  const st = f * (s + crr) + (aero * (f ** 3 - 1)) / (mass * G) - crr;
  return Math.max(-10, Math.min(25, st * 100));
}
