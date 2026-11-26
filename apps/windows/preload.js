// Runs in each page before its scripts: tells the site it's in the Windows app, and draws the Bluetooth device picker as
// an overlay in the page (main.js sends the devices Chromium finds; a click answers). Nothing else of Node or Electron
// reaches the page.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rideworldApp', { platform: 'windows', version: '1.0.1' });

let box = null;
function overlay() {
  if (box) return box;
  box = document.createElement('div');
  box.id = 'rw-bt-picker';
  box.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;font:15px system-ui,sans-serif">
    <div style="background:#1a1d23;color:#e8e8ea;border-radius:12px;width:400px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.6)">
      <div style="padding:16px 16px 4px;font-weight:600">Pedal or wake your sensor…</div>
      <div style="padding:0 16px 10px;color:#9aa0a8;font-size:13px">Trainers, power meters, heart-rate straps and cadence sensors appear as they're found. RideWorld remembers your choice.</div>
      <div id="rw-bt-list" style="overflow:auto;padding:0 8px;flex:1"><div style="padding:12px;color:#9aa0a8">Searching…</div></div>
      <div style="padding:12px 16px;text-align:right"><button id="rw-bt-cancel" style="font:inherit;padding:6px 16px;border-radius:6px;border:1px solid #444;background:#2a2f38;color:inherit;cursor:pointer">Cancel</button></div>
    </div></div>`;
  document.documentElement.appendChild(box);
  box.querySelector('#rw-bt-cancel').onclick = () => { ipcRenderer.send('bt-pick', '', ''); close(); };
  return box;
}
function close() { if (box) { box.remove(); box = null; } }
ipcRenderer.on('bt-devices', (e, list) => {
  const l = overlay().querySelector('#rw-bt-list');
  l.innerHTML = '';
  if (!list.length) { l.innerHTML = '<div style="padding:12px;color:#9aa0a8">Searching…</div>'; return; }
  for (const d of list) {
    const b = document.createElement('div');
    b.textContent = d.name; b.style.cssText = 'padding:12px;border-radius:8px;cursor:pointer';
    b.onmouseenter = () => (b.style.background = '#2a2f38'); b.onmouseleave = () => (b.style.background = '');
    b.onclick = () => { ipcRenderer.send('bt-pick', d.id, d.name); close(); };
    l.appendChild(b);
  }
});
ipcRenderer.on('bt-close', close);
