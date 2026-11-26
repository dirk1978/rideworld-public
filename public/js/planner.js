// Route planner: click points on an OpenStreetMap map and BRouter (brouter.de) joins them along
// real roads, with elevation for gradients. Postcode/place search uses Nominatim.
import { Route } from './route.js';

const L = window.L;
const BROUTER = 'https://brouter.de/brouter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const HOME = [52.3162, -2.0775]; // Bromsgrove, until the first saved view

const pinIcon = (cls, text = '') => L.divIcon({ className: 'plan-pin ' + cls, html: text, iconSize: [18, 18], iconAnchor: [9, 9] });

export class Planner {
  // onRoute(route | null, message) is called whenever the planned route changes
  constructor(el, store, onRoute) {
    this.store = store;
    this.onRoute = onRoute;
    this.points = [];
    this.markers = [];
    this.gpx = null;
    this.reqId = 0;

    let saved = {};
    try { saved = JSON.parse(store.get('plan', '{}')); } catch {}
    this.map = L.map(el, { zoomControl: true }).setView(saved.center || HOME, saved.zoom || 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · routing <a href="https://brouter.de">BRouter</a>',
    }).addTo(this.map);
    this.line = L.polyline([], { color: '#ff6a1a', weight: 5, opacity: 0.85 }).addTo(this.map);

    this.map.on('click', (e) => this.add([e.latlng.lat, e.latlng.lng]));
    this.map.on('moveend', () => this.save());
    for (const p of saved.points || []) this.add(p, false);
    this.update();
  }

  get profile() { return document.getElementById('plan-profile').value; }
  get loop() { return document.getElementById('plan-loop').checked; }

  save() {
    const c = this.map.getCenter();
    this.store.set('plan', JSON.stringify({ center: [c.lat, c.lng], zoom: this.map.getZoom(), points: this.points }));
  }

  add(p, update = true) {
    this.points.push(p);
    const m = L.marker(p, { draggable: true, icon: pinIcon('via') }).addTo(this.map);
    m.on('dragend', () => { this.points[this.markers.indexOf(m)] = [m.getLatLng().lat, m.getLatLng().lng]; this.update(); });
    m.on('contextmenu', () => this.remove(this.markers.indexOf(m))); // right-click removes a point
    this.markers.push(m);
    if (update) this.update();
  }

  remove(i) {
    if (i < 0) return;
    this.markers[i].remove();
    this.markers.splice(i, 1);
    this.points.splice(i, 1);
    this.update();
  }

  undo() { this.remove(this.points.length - 1); }

  clear() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    this.points = [];
    this.update();
  }

  // Leaflet needs this after its container goes from hidden to visible
  refresh() { this.map.invalidateSize(); }

  async search(q) {
    if (!q.trim()) return;
    const res = await fetch(`${NOMINATIM}?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`);
    const hits = res.ok ? await res.json() : [];
    if (!hits.length) throw new Error(`Couldn't find "${q}"`);
    this.map.setView([+hits[0].lat, +hits[0].lon], 15);
  }

  async update() {
    this.save();
    this.markers.forEach((m, i) => m.setIcon(pinIcon(i === 0 ? 'start' : 'via', i === 0 ? 'S' : '')));
    const pts = this.loop && this.points.length >= 2 ? [...this.points, this.points[0]] : this.points;
    if (pts.length < 2) {
      this.line.setLatLngs([]);
      this.gpx = null;
      this.onRoute(null, this.points.length ? 'Now click where you want to ride to. Add more points to shape the route.' : 'Click the map to set your start point.');
      return;
    }
    const id = ++this.reqId;
    this.onRoute(null, 'Finding a route along the roads…');
    try {
      const lonlats = pts.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|');
      const res = await fetch(`${BROUTER}?lonlats=${lonlats}&profile=${this.profile}&alternativeidx=0&format=gpx`);
      const text = await res.text();
      if (!res.ok || !text.includes('<trkpt')) throw new Error(text.trim().slice(0, 160) || `routing service error ${res.status}`);
      if (id !== this.reqId) return; // a newer request has replaced this one
      const route = Route.fromGpx(text, 'Planned route');
      route.name = `Planned route from ${this.points[0].map((v) => v.toFixed(4)).join(', ')}`;
      this.gpx = text;
      this.line.setLatLngs(route.pts.map((p) => [p.lat, p.lon]));
      this.onRoute(route, `${(route.length / 1000).toFixed(1)} km, ${Math.round(route.gain)} m climbing. Drag points to adjust, right-click one to remove it.`);
    } catch (e) {
      if (id !== this.reqId) return;
      this.line.setLatLngs([]);
      this.gpx = null;
      this.onRoute(null, `Couldn't plan that route: ${e.message}. Try moving the points onto or nearer a road.`);
    }
  }

  downloadGpx() {
    if (!this.gpx) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.gpx], { type: 'application/gpx+xml' }));
    a.download = `rideworld-route-${new Date().toISOString().slice(0, 10)}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
