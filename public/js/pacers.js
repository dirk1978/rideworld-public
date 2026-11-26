// Pacers (bots that ride at a set power) and ghosts (replays of your own earlier rides).
import { Bike } from './physics.js';

// A pacer holds its power on the flat, eases off 20% going down and pushes 10% harder going up; the change blends
// in between ±0.5% and ±2% so it doesn't snap at every crest.
export function pacerWatts(watts, grade) {
  const t = (g) => Math.max(0, Math.min(1, (Math.abs(g) - 0.5) / 1.5));
  if (grade > 0) return watts * (1 + 0.1 * t(grade));
  return watts * (1 - 0.2 * t(grade));
}

export const PACER_KITS = [
  { jersey: '#1d4ed8', shorts: '#111111', frame: '#e5e7eb', helmet: '#1d4ed8' },
  { jersey: '#16a34a', shorts: '#111111', frame: '#111111', helmet: '#ffffff' },
  { jersey: '#9333ea', shorts: '#1f1f1f', frame: '#f5f5f5', helmet: '#9333ea' },
  { jersey: '#eab308', shorts: '#111111', frame: '#111111', helmet: '#111111' },
  { jersey: '#0891b2', shorts: '#0f172a', frame: '#e5e7eb', helmet: '#ffffff' },
];

export class Pacer {
  constructor(i, watts, bikeParams) {
    this.id = `bot:${i}`;
    this.watts = watts;
    this.name = `Pacer ${watts} W`;
    this.kit = PACER_KITS[i % PACER_KITS.length];
    this.lane = [1, -1, 2, -2, 3][i % 5];
    this.bike = new Bike(bikeParams); // same weight and position as the rider: a like-for-like pace
    this.dist = 0;
    this.power = 0;
    this.finished = false;
  }

  get v() { return this.bike.v; }

  // grade (%) where the pacer is; stops (brakes) after the finish line
  step(dt, grade, finishAt, length) {
    if (this.finished) {
      this.bike.v = Math.max(0, this.bike.v - dt * 1.8);
      this.power = 0;
    } else {
      this.power = pacerWatts(this.watts, grade);
      this.bike.step(this.power, grade, dt);
      if (this.dist >= finishAt) this.finished = true;
    }
    this.dist = Math.min(length, this.dist + this.bike.v * dt);
  }
}

// A ghost: samples[i] = distance (m) after i + 1 seconds of riding
export class Ghost {
  constructor(ride, label) {
    this.id = `ghost:${ride.id}`;
    this.name = `👻 ${label}`;
    this.samples = ride.samples;
    this.time = ride.time;
  }

  distAt(t) {
    const s = this.samples;
    if (t <= 0) return 0;
    if (t < 1) return s[0] * t;
    const i = Math.floor(t) - 1;
    if (i >= s.length - 1) return s[s.length - 1];
    return s[i] + (s[i + 1] - s[i]) * (t - Math.floor(t));
  }

  speedAt(t) { return Math.max(0, this.distAt(t + 0.5) - this.distAt(t - 0.5)); }
}
