// Records one sample per second; exports as TCX here (FIT: fit.js, GPX: formats.js)
import { samplesToTcx } from './formats.js';

export class Recorder {
  constructor() {
    this.samples = [];
    this.startTime = null;
  }

  add(s) {
    if (!this.startTime) this.startTime = new Date();
    this.samples.push({ time: new Date(), ...s });
  }

  get count() {
    return this.samples.length;
  }

  toTcx(name = 'Indoor ride') { return samplesToTcx(this.samples, name); }
}
