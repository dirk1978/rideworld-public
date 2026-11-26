// One view of all connected sensors, whether they came in over ANT+ or Bluetooth.
// Readings come from the best source available: a dedicated power meter beats the trainer's own power reading,
// a Bluetooth strap and an ANT+ strap are interchangeable. Slope and drag go to every trainer that can take them.
export const devices = {
  ant: null,         // AntStick (ant.js): .fec trainer and .hr strap
  bleTrainer: null,  // BleTrainer (ble.js)
  blePower: null,    // BlePowerMeter
  bleHr: null,       // BleHeartRate
  bleCadence: null,  // BleCadence: a crank cadence sensor

  get powerSource() {
    if (this.blePower?.live) return this.blePower;
    if (this.bleTrainer?.live) return this.bleTrainer;
    if (this.ant?.fec.connected) return this.ant.fec;
    return null;
  },
  get power() { return this.powerSource?.power ?? 0; },
  // a crank cadence sensor beats the trainer's or power meter's figure (the owner 2026-10-27: the Kickr Core's Bluetooth
  // cadence kept dropping out; his Garmin sensor on the left crank broadcasts on both)
  get cadenceSource() {
    if (this.bleCadence?.live) return this.bleCadence;
    if (this.ant?.cad.connected) return this.ant.cad;
    return this.powerSource;
  },
  get cadence() { return this.cadenceSource?.cadence ?? 0; },

  get hrConnected() { return !!(this.bleHr?.live || this.ant?.hr.connected); },
  get hr() {
    if (this.bleHr?.live) return this.bleHr.bpm;
    if (this.ant?.hr.connected) return this.ant.hr.bpm;
    return 0;
  },

  // a trainer we can send slope to
  get trainerConnected() { return !!((this.bleTrainer?.live && this.bleTrainer.controllable) || this.ant?.fec.connected); },
  get anyTrainer() { return !!(this.bleTrainer?.live || this.ant?.fec.connected); },
  get sentGrade() {
    if (this.bleTrainer?.live && this.bleTrainer.controllable) return this.bleTrainer.sentGrade;
    if (this.ant?.fec.connected) return this.ant.sentGrade;
    return null;
  },
  get any() { return !!(this.ant?.running || this.bleTrainer?.connected || this.blePower?.connected || this.bleHr?.connected || this.bleCadence?.connected); },

  // rolling resistance for the surface under the wheels (open worlds: gravel / dirt); goes out with the next slope
  setCrr(c) { this.crr = c; if (this.ant) this.ant.crr = c; if (this.bleTrainer) this.bleTrainer.crr = c; },
  setGrade(p) {
    if (this.ant) this.ant.setGrade(p);
    if (this.bleTrainer) this.bleTrainer.setGrade(p);
  },
  // ERG mode: the trainer holds this power whatever the road does (workouts)
  setTargetPower(w) {
    if (this.ant) this.ant.setTargetPower(w);
    if (this.bleTrainer) this.bleTrainer.setTargetPower(w);
  },
  get ergTarget() {
    if (this.bleTrainer?.live && this.bleTrainer.controllable && this.bleTrainer.erg) return this.bleTrainer.sentTarget;
    if (this.ant?.fec.connected && this.ant.erg) return this.ant.sentTarget;
    return null;
  },
  async setUserWeight(rider, bikeKg) {
    if (this.ant?.fec.connected) await this.ant.setUserWeight(rider, bikeKg);
    if (this.bleTrainer?.connected) await this.bleTrainer.setUserWeight(rider, bikeKg);
  },
  async setWindResistance(cda, draft = 0) {
    if (this.ant?.fec.connected) await this.ant.setWindResistance(cda, draft);
    if (this.bleTrainer?.connected) await this.bleTrainer.setWindResistance(cda, draft);
  },
};
