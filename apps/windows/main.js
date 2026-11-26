// RideWorld for Windows (Electron): the live site (https://rideworld.example.org) in its own window, plus what Chrome
// can't be told by a web page:
//  - the fast graphics card on laptops with two (Intel + Nvidia/AMD), a bigger GPU memory budget, no slowing down when
//    the window is behind another one;
//  - Bluetooth: a device picker of our own (Electron has none), and devices chosen before picked again by themselves, so
//    the site's "reconnect my devices" works with no picker;
//  - ride photos and clips capture this window with no "share this tab" prompt;
//  - the screen kept awake, full screen on F11, the window's size and place remembered, other sites in the browser.
// The site updates itself; this shell rarely needs a new release. ANT+ uses WebUSB as in Chrome (the stick still needs
// the WinUSB driver for now; Garmin's own driver is the next step, see docs/client-apps.md).
const { app, BrowserWindow, session, shell, powerSaveBlocker, desktopCapturer, ipcMain, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME = process.env.RIDEWORLD_URL || 'https://rideworld.example.org/';
const ORIGIN = new URL(HOME).origin;
const INSIDE = [ORIGIN, 'https://www.strava.com', 'https://strava.com'];

// ---- graphics (before the app is ready) ----
app.commandLine.appendSwitch('force_high_performance_gpu'); // (Windows: the discrete card on hybrid laptops)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '4096'); // (a larger GPU memory budget: Intel graphics ran out at 1500 W)
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-features', 'WebBluetoothNewPermissionsBackend'); // (getDevices: remembered Bluetooth devices)
app.commandLine.appendSwitch('enable-experimental-web-platform-features'); // (watchAdvertisements: wait for a sleeping trainer)

if (process.env.RIDEWORLD_INSECURE) app.commandLine.appendSwitch('ignore-certificate-errors'); // (testing against the LAN address's own certificate only)
if (!app.requestSingleInstanceLock()) app.quit();

// ---- small settings file: window place, remembered Bluetooth devices ----
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
const loadSettings = () => { try { settings = JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); } catch { settings = {}; } };
const saveSettings = () => { try { fs.writeFileSync(SETTINGS(), JSON.stringify(settings, null, 1)); } catch (e) { console.warn('settings', e); } };

let win = null;

function createWindow() {
  const b = settings.bounds || { width: 1600, height: 900 };
  win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600, backgroundColor: '#0f1115', title: 'RideWorld', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  if (settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const keep = () => { if (!win.isMaximized() && !win.isFullScreen()) settings.bounds = win.getBounds(); settings.maximized = win.isMaximized(); saveSettings(); };
  win.on('resized', keep); win.on('moved', keep); win.on('maximize', keep); win.on('unmaximize', keep);

  // other sites open in the normal browser; Strava's sign-in stays in the window (it comes back to our callback)
  win.webContents.setWindowOpenHandler(({ url }) => { if (INSIDE.some((o) => url.startsWith(o))) return { action: 'allow' }; shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!INSIDE.some((o) => url.startsWith(o))) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F5') { win.webContents.reload(); e.preventDefault(); }
    if (input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools();
  });

  // ---- Bluetooth: Electron has no picker. Ours is an overlay IN the page (preload.js), not a second window (2026-11-25,
  // the owner: the app crashed adding the Bluetooth strap; the modal picker window answered Chromium's chooser while being torn
  // down). Each request's callback is answered exactly once, guarded; a device chosen before is picked by itself ----
  let req = null; // { cb, done }
  const answer = (id) => { const r = req; req = null; if (!r || r.done) return; r.done = true; try { r.cb(id || ''); } catch (e) { logCrash('bluetooth callback', e); } win?.webContents.send('bt-close'); };
  win.webContents.on('select-bluetooth-device', (e, list, callback) => {
    e.preventDefault();
    if (!req || req.done) req = { cb: callback, done: false }; else req.cb = callback; // (Chromium sends the list again as it finds more)
    const known = (settings.ble || []).find((k) => list.some((d) => d.deviceId === k.id));
    if (known) { answer(known.id); return; }
    win.webContents.send('bt-devices', list.map((d) => ({ id: d.deviceId, name: d.deviceName || 'Unnamed device' })));
  });
  ipcMain.removeAllListeners('bt-pick');
  ipcMain.on('bt-pick', (e, id, name) => {
    if (id) { settings.ble = [{ id, name }, ...(settings.ble || []).filter((k) => k.id !== id)].slice(0, 12); saveSettings(); }
    answer(id); // ('' = cancelled: the page gets NotFoundError, as from Chrome's picker)
  });
  // the page went away mid-choice (reload, navigation): cancel cleanly
  win.webContents.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain && req && !req.done) answer(''); });
  ipcMain.removeAllListeners('forget-ble');
  ipcMain.on('forget-ble', () => { settings.ble = []; saveSettings(); });

  win.loadURL(HOME);
  // (RIDEWORLD_SMOKE=1: print what the page sees, then quit; for checking a build without a person at the screen)
  if (process.env.RIDEWORLD_SMOKE) win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await win.webContents.executeJavaScript('JSON.stringify({ url: location.href, title: document.title, app: window.rideworldApp, bt: !!navigator.bluetooth, usb: !!navigator.usb, gl: (() => { const g = document.createElement("canvas").getContext("webgl2"); const x = g && g.getExtension("WEBGL_debug_renderer_info"); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : !!g; })() })');
    console.log('SMOKE', r);
    if (process.env.RIDEWORLD_SMOKE_BT) { // (the picker overlay: two pretend devices, a click, the choice back here)
      ipcMain.once('bt-pick', (e2, id, name) => console.log('SMOKE-BT picked', id, name));
      win.webContents.send('bt-devices', [{ id: 'AA:01', name: 'Polar H10 TEST' }, { id: 'AA:02', name: 'KICKR TEST' }]);
      await new Promise((rr) => setTimeout(rr, 800));
      console.log('SMOKE-BT overlay', await win.webContents.executeJavaScript('(() => { const l = document.querySelectorAll("#rw-bt-list > div"); const t = [...l].map((x) => x.textContent).join("|"); l[0]?.click(); return t; })()'));
      await new Promise((rr) => setTimeout(rr, 500));
      console.log('SMOKE-BT closed', await win.webContents.executeJavaScript('!document.getElementById("rw-bt-picker")'));
    }
    app.quit();
  });
}

// crash log: %APPDATA%/RideWorld/crash.log, and a message on screen with the reason (so a crash can be diagnosed)
function logCrash(what, err) {
  const line = `${new Date().toISOString()} ${what}: ${err?.stack || err?.reason || JSON.stringify(err)}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), line); } catch {}
  console.error(line);
}
process.on('uncaughtException', (e) => { logCrash('main process', e); try { dialog.showErrorBox('RideWorld hit a problem', String(e?.message || e) + '\n\nLogged to ' + path.join(app.getPath('userData'), 'crash.log')); } catch {} });
app.on('render-process-gone', (e, wc, d) => { logCrash('page', d); if (win && !win.isDestroyed()) dialog.showMessageBox(win, { type: 'error', message: 'The RideWorld page stopped (' + d.reason + ').', detail: 'Logged to ' + path.join(app.getPath('userData'), 'crash.log') + '. It will reload.' }).then(() => win.reload()); });
app.on('child-process-gone', (e, d) => logCrash('child process', d));

app.whenReady().then(() => {
  loadSettings();
  const ses = session.defaultSession;
  // our own site may use Bluetooth / USB / the screen without asking again; nothing else
  const ours = (o) => { try { return new URL(o).origin === ORIGIN; } catch { return false; } };
  ses.setPermissionCheckHandler((wc, perm, origin) => ours(origin) || ours(wc?.getURL?.() || ''));
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ours(wc.getURL())));
  ses.setDevicePermissionHandler((d) => ours(d.origin));
  // Bluetooth pairing that Windows wants confirmed (some sensors): confirm it; a PIN request is cancelled (the page says so)
  try { ses.setBluetoothPairingHandler((details, cb) => cb(details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin' ? { confirmed: true } : { confirmed: false })); } catch (e) { logCrash('pairing handler', e); }
  // WebUSB (the ANT+ stick): the first Garmin / Dynastream stick, as Chrome's picker would offer it
  ses.on('select-usb-device', (e, details, cb) => { e.preventDefault(); const d = details.deviceList.find((x) => x.vendorId === 0x0fcf) || details.deviceList[0]; cb(d?.deviceId); });
  // photos and clips: the page asks for the tab (getDisplayMedia); hand it this window, no prompt
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    try { const src = (await desktopCapturer.getSources({ types: ['window'] })).find((s) => s.id === win?.getMediaSourceId()); cb(src ? { video: src } : {}); } catch { cb({}); }
  });
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
