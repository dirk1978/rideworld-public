// Map beside the power dial: OpenStreetMap (Leaflet, as in the planner) with the route, the part ridden so far,
// start and finish, and a dot for every rider (others in their jersey colour, us larger with a white ring).
// Click it to switch between the whole route and a close-up that follows us.
/* global L */
const MAX_POINTS = 1200;

export class MiniMap {
  // close: the second map (the owner 2026-10-19), top right: always follows us, about `span` metres across (click: 1.5 km <->
  // 500 m; the owner tried 30 m first: far too close).
  constructor(el, { close = false } = {}) {
    this.el = el;
    this.close = close;
    this.span = 500; // the owner: 30 m was far too close; 1-2 km; then 2026-11-15: "the maps are now too similar - one should be much more zoomed in" -> 500 m by default
    this.route = null;
    this.width = 0;
    this.follow = false;
    this.riders = [];
    this.map = L.map(el, {
      zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      keyboard: false, touchZoom: false, zoomSnap: 0.25, zoomAnimation: false, fadeAnimation: false, attributionControl: true,
    });
    this.map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(this.map);
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // the attribution link
      if (this.close) { this.span = this.span === 1500 ? 500 : 1500; el.title = `About ${this.span >= 1000 ? this.span / 1000 + ' km' : this.span + ' m'} across: click for ${this.span === 1500 ? '500 m' : '1.5 km'}`; return; }
      this.follow = !this.follow;
      el.title = this.follow ? 'Following you: click to see the whole route' : 'Whole route (north up): click to follow you';
      if (!this.follow) this.fit();
    });
  }

  fit() { if (this.line) this.map.fitBounds(this.line.getBounds(), { padding: [12, 12], animate: false }); }

  prepare(route) {
    const w = this.el.clientWidth;
    if (w !== this.width) { this.width = w; this.map.invalidateSize({ animate: false }); if (this.route === route) this.fit(); }
    if (route === this.route) return;
    this.route = route;
    for (const l of this.layers || []) l.remove();
    const n = Math.min(MAX_POINTS, Math.max(2, Math.ceil(route.length / 5)));
    this.step = route.length / n;
    this.pts = [];
    for (let i = 0; i <= n; i++) { const p = route.at((route.length * i) / n); this.pts.push([p.lat, p.lon]); }
    // highlights routes: only the pieces that are ridden, each its own line ([from, to] point indices)
    const ix = (d) => Math.max(0, Math.min(this.pts.length - 1, Math.round(d / this.step)));
    this.spans = route.pieces ? route.pieces.map((p) => [ix(p.a), ix(p.b), p]) : null;
    const shown = this.spans ? this.spans.map(([i, j]) => this.pts.slice(i, j + 1)) : this.pts;
    // blue with a white edge, like a route in a map app: white alone was lost on OSM's pale streets
    const casing = L.polyline(shown, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false });
    this.line = L.polyline(shown, { color: '#1d4ed8', weight: 4, opacity: 1, interactive: false });
    this.done = L.polyline([], { color: '#ff6a1a', weight: 4, opacity: 1, interactive: false });
    const mark = (ll, fill) => L.circleMarker(ll, { radius: 4.5, color: '#111', weight: 1.5, fillColor: fill, fillOpacity: 1, interactive: false });
    this.layers = [casing, this.line, this.done, mark(this.pts[0], '#22c55e'), mark(this.pts.at(-1), '#ffffff')];
    for (const l of this.layers) l.addTo(this.map);
    for (const r of this.riders) r.remove();
    this.riders = [];
    this.me = null;
    this.fit();
  }

  // a pre-plotted open-world route (2026-11-20): its whole outline (ride.shape) with the part ridden (frac of its length)
  // and us at our real position; the rolling few km the ride is built from would show only the next stretch
  drawRide(ride, frac, here, colour) {
    if (!this.el.clientWidth) return;
    const w = this.el.clientWidth;
    if (w !== this.width) { this.width = w; this.map.invalidateSize({ animate: false }); }
    if (this.route !== ride) {
      this.route = ride;
      for (const l of this.layers || []) l.remove();
      this.pts = ride.shape.map(([a, b]) => [a, b]);
      this.cum = [0]; for (let i = 1; i < this.pts.length; i++) { const [a, b] = this.pts[i - 1], [c, d] = this.pts[i]; this.cum.push(this.cum[i - 1] + Math.hypot((c - a) * 110540, (d - b) * 111320 * Math.cos((a * Math.PI) / 180))); }
      const casing = L.polyline(this.pts, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false });
      this.line = L.polyline(this.pts, { color: '#1d4ed8', weight: 4, opacity: 1, interactive: false });
      this.done = L.polyline([], { color: '#ff6a1a', weight: 4, opacity: 1, interactive: false });
      const mark = (ll, fill) => L.circleMarker(ll, { radius: 4.5, color: '#111', weight: 1.5, fillColor: fill, fillOpacity: 1, interactive: false });
      this.layers = [casing, this.line, this.done, mark(this.pts[0], '#22c55e'), mark(this.pts.at(-1), '#ffffff')];
      for (const l of this.layers) l.addTo(this.map);
      for (const r of this.riders) r.remove(); this.riders = [];
      if (this.me) { this.me.remove(); this.me = null; }
      this.fit();
    }
    const D = frac * this.cum.at(-1); let k = 0; while (k < this.cum.length - 1 && this.cum[k + 1] < D) k++;
    this.done.setLatLngs([...this.pts.slice(0, k + 1), here]);
    if (!this.me) this.me = L.circleMarker(here, { radius: 7, color: '#ffffff', weight: 3, fillOpacity: 1, interactive: false }).addTo(this.map);
    this.me.setLatLng(here); this.me.setStyle({ fillColor: colour || '#ff6a1a' }); this.me.bringToFront();
    if (this.follow) this.map.setView(here, 16, { animate: false });
  }

  // me: { dist, colour }, others: [{ dist, colour }]
  draw(route, me, others) {
    if (!route || !this.el.clientWidth) return;
    this.prepare(route);
    const at = (d) => { const p = route.at(d); return [p.lat, p.lon]; };
    const idx = Math.min(this.pts.length - 1, Math.floor(me.dist / this.step));
    if (this.spans) this.done.setLatLngs(this.spans.filter(([, , p]) => me.dist >= p.a).map(([i, j, p]) => (me.dist >= p.b ? this.pts.slice(i, j + 1) : [...this.pts.slice(i, idx + 1), at(me.dist)])));
    else this.done.setLatLngs([...this.pts.slice(0, idx + 1), at(me.dist)]);
    // other riders (reuse markers), then us on top
    while (this.riders.length > others.length) this.riders.pop().remove();
    others.forEach((o, i) => {
      let m = this.riders[i];
      if (!m) { m = L.circleMarker(at(o.dist), { radius: 5, color: '#111', weight: 1.5, fillOpacity: 1, interactive: false }).addTo(this.map); this.riders.push(m); }
      m.setLatLng(at(o.dist));
      m.setStyle({ fillColor: o.colour || '#ff6a1a' });
    });
    const here = at(me.dist);
    if (!this.me) this.me = L.circleMarker(here, { radius: 7, color: '#ffffff', weight: 3, fillOpacity: 1, interactive: false }).addTo(this.map);
    this.me.setLatLng(here);
    this.me.setStyle({ fillColor: me.colour || '#ff6a1a' });
    this.me.bringToFront();
    if (this.close) {
      // zoom that fits ~span metres across the box: metres per pixel = 156543 cos(lat) / 2^z
      const z = Math.log2((156543.03 * Math.cos((here[0] * Math.PI) / 180) * Math.max(60, this.el.clientWidth)) / this.span);
      this.map.setView(here, Math.min(21, z), { animate: false });
    } else if (this.follow) this.map.setView(here, 16, { animate: false });
  }
}
