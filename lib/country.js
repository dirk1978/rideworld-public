// The country a route starts in, for the flag on its card: one reverse-geocoding request to OpenStreetMap's
// Nominatim (zoom 3 = country level) when a route is saved or analysed. Returns an ISO 3166 code ('gb', 'es') or
// null. Never throws. Nominatim's usage policy: a real User-Agent, at most one request a second (callers go one at a
// time).
const https = require('https');

function countryOf(lat, lon) {
  return new Promise((resolve) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return resolve(null);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=3&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'RideWorld route analyser (https://rideworld.example.org)', 'Accept-Language': 'en' }, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 100000) req.destroy(); });
      res.on('end', () => {
        try { const cc = JSON.parse(body)?.address?.country_code; resolve(/^[a-z]{2}$/.test(cc || '') ? cc : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

module.exports = { countryOf };
