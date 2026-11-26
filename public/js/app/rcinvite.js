// Making the phone remote (/rc) obvious (the owner 2026-10-30: "New riders won't know about it"): a card in the setup
// screen's sidebar with a QR code (click: a bigger one and what the remote does), and a pop-up with the code a few
// seconds into each ride, until a phone connects (the server asks the ride page for its status when a remote opens:
// 'rc-want-status'), 30 s pass, or the rider says Got it / Don't show again (`rw.rcTip`, per browser). Not on phones
// and tablets (the ride is already in their hand). The code always points at the public address: a phone on the LAN
// address would meet the self-signed certificate.
import { $, state, store, toast } from './core.js';
import { mp } from './riders.js';

export const RC_URL = /(^|\.)rideworld\.uk$/.test(location.hostname) ? `${location.origin}/rc` : 'https://rideworld.example.org/rc';
const qrSvg = (url) => {
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch { return ''; }
};
let phone = false, tipTimer = 0;
const touch = () => matchMedia('(pointer: coarse)').matches;
const hideTip = () => { clearTimeout(tipTimer); $('rc-tip').classList.add('hidden'); };

// a few seconds after the ride appears
export function rcTipAtStart() {
  if (phone || store.get('rcTip') === 'off' || touch()) return;
  setTimeout(() => {
    if (phone || state.film || state.finished) return;
    $('rc-tip').classList.remove('hidden');
    tipTimer = setTimeout(hideTip, 30000);
  }, 5000);
}

export function initRcInvite() {
  const svg = qrSvg(RC_URL);
  for (const id of ['rc-qr-side', 'rc-qr-big', 'rc-qr-tip']) $(id).innerHTML = svg;
  $('rc-link').href = RC_URL; $('rc-link').textContent = RC_URL.replace(/^https:\/\//, '');
  $('btn-rc-help').addEventListener('click', () => $('dlg-rc').showModal());
  $('rc-close').addEventListener('click', () => $('dlg-rc').close());
  $('rc-tip-ok').addEventListener('click', hideTip);
  $('rc-tip-never').addEventListener('click', () => { store.set('rcTip', 'off'); hideTip(); toast('OK: the phone remote is always on the setup screen (left).', 4000); });
  mp.addEventListener('rc-want-status', () => {
    if (phone) return;
    phone = true;
    hideTip();
    toast('📱 Phone remote connected', 3000);
    $('btn-rc-help').classList.add('on');
    $('rc-side-title').textContent = 'Phone remote connected';
    $('rc-side-sub').textContent = 'Click to see what it can do';
  });
}
