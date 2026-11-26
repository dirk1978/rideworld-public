// Errors in the browser are reported to the server's log (journalctl -u rideworld), at most 10 per page. Loaded as a
// plain script before the app's modules, so it also catches errors while they load: a phone that failed to start
// (the owner 2026-10-22: no routes, no workouts, no sign out) showed nothing anywhere we could read.
(function () {
  var sent = 0;
  function report(msg, where) {
    if (sent++ >= 10) return;
    try {
      fetch('api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: String(msg).slice(0, 500), where: String(where || '').slice(0, 500), page: location.pathname }) }).catch(function () {});
    } catch (e) {}
  }
  window.rwReport = report; // (scenery.js: the 3D view's own render errors)
  window.addEventListener('error', function (e) { report(e.message, (e.filename || '') + ':' + e.lineno + ':' + e.colno); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason || {}; report(r.message || r, (r.stack || '').split('\n').slice(0, 3).join(' | ')); });
})();
