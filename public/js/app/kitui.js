// The kit picker on the setup screen (2026-11-03): ready-made jerseys, up to three colours for the design, shorts,
// socks, shoes, helmet and bike, and your own picture (a logo on the chest and back, or a whole jersey painted on the
// template). The design is the account setting `design` (public/js/kit.js); the colour inputs are settings fields too.
// Changes show on the rider at the next ride.
import { PRESET_GROUPS, PRESETS, designString, drawJersey, drawTemplate, drawThumb, parseDesign } from '../kit.js';
import { $, api, esc, toast } from './core.js';
import { previewKit } from './kitpreview.js';

let pic = null, picFor = '';
const current = () => parseDesign($('kit-design').value, $('kit-jersey').value);
function setDesign(str, save = true) {
  setTimeout(previewKit); // (the live preview: kitpreview.js)
  const el = $('kit-design');
  if (el.value !== str) { el.value = str; render(); }
  if (save) el.dispatchEvent(new Event('change')); // (saves it: core.js initSettingsFields)
}
async function picture(p) {
  if (!p.img) return null;
  if (picFor !== p.img) { picFor = p.img; pic = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = 'api/kit/' + p.img; }); }
  return pic;
}
async function render() {
  const p = current();
  // the colour inputs follow the design
  $('kit-c2').value = p.c[1]; $('kit-c3').value = p.c[2]; $('kit-c4').value = p.c[3];
  $('kit-c4-l').classList.toggle('hidden', p.d.n < 4 || (p.img && p.fit === 'full'));
  $('kit-c2-l').classList.toggle('hidden', p.d.n < 2 || (p.img && p.fit === 'full'));
  $('kit-c3-l').classList.toggle('hidden', p.d.n < 3 || (p.img && p.fit === 'full'));
  // your own picture: what's on now, and buttons that say what they'll do (2026-11-14, the owner: "I don't know how to
  // replace the logo or remove it")
  $('kit-up-clear').classList.toggle('hidden', !p.img);
  $('kit-pic-img').classList.toggle('hidden', !p.img);
  if (p.img) $('kit-pic-img').src = 'api/kit/' + p.img;
  $('kit-pic-title').textContent = !p.img ? 'Your own picture' : p.fit === 'full' ? 'Your own jersey design' : 'Your logo';
  $('kit-pic-note').textContent = !p.img ? 'A logo on the chest and back, or a whole jersey you\'ve painted on the template.'
    : p.fit === 'full' ? 'Painted on the template: the design above and its colours are not used.' : 'On the chest and the back, over the design above.';
  $('kit-up-logo').textContent = p.img && p.fit === 'logo' ? 'Replace logo' : p.img ? 'Use a logo instead' : 'Add a logo';
  $('kit-up-full').textContent = p.img && p.fit === 'full' ? 'Replace jersey' : p.img ? 'Use a whole jersey instead' : 'Upload a whole jersey';
  $('kit-up-clear').textContent = p.fit === 'full' ? 'Remove jersey' : 'Remove logo';
  const tex = drawJersey(document.createElement('canvas'), p, await picture(p));
  drawThumb($('kit-front'), tex, 'front'); drawThumb($('kit-back'), tex, 'back');
  const preset = PRESETS.find(([, d]) => d === designString({ ...p, img: null }));
  $('kit-name').textContent = p.img ? (p.fit === 'full' ? 'Your own jersey' : `${preset?.[0] || p.d.name} + your logo`) : preset?.[0] || p.d.name;
  for (const b of $('kit-designs').children) b.classList.toggle('on', b.dataset.id === p.id && (!b.dataset.design || b.dataset.design === designString({ ...p, img: null })));
}

function grid() {
  const box = $('kit-designs');
  box.innerHTML = '';
  for (const [group, items] of PRESET_GROUPS) {
   const h = document.createElement('div'); h.className = 'kit-group'; h.textContent = group; box.append(h);
   for (const [name, d] of items) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'kit-tile'; b.title = name;
    b.dataset.design = d; b.dataset.id = d.split(':')[0];
    const cv = document.createElement('canvas'); cv.width = cv.height = 120;
    drawThumb(cv, drawJersey(document.createElement('canvas'), d));
    b.append(cv); b.insertAdjacentHTML('beforeend', `<span>${esc(name)}</span>`);
    b.addEventListener('click', () => {
      const p = parseDesign(d), keep = current();
      $('kit-jersey').value = p.c[0]; $('kit-jersey').dispatchEvent(new Event('change'));
      setDesign(designString({ ...p, img: keep.img, fit: keep.fit }));
    });
    box.append(b);
   }
  }
}

// your own picture: shrink to 1024 px, send, and use it
async function upload(fit) {
  const f = $('kit-file').files[0];
  $('kit-file').value = '';
  if (!f) return;
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(f); }).catch(() => null);
  if (!img) { toast('That picture could not be read.', 4000); return; }
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  let data = cv.toDataURL('image/png');
  if (data.length > 2.5e6) data = cv.toDataURL('image/jpeg', 0.9);
  try {
    const { file } = await api('api/kit', { method: 'POST', body: JSON.stringify({ image: data }) });
    setDesign(designString({ ...current(), img: file, fit }));
    toast(fit === 'full' ? 'Your jersey is on: it shows from your next ride.' : 'Logo added: it shows from your next ride.', 5000);
  } catch (e) { toast('Upload failed: ' + e.message, 5000); }
}

export function initKit() {
  grid();
  // the chosen bike's picture (public/img/bikes/, rendered from the rider models: tools/rider/render.py RW_BIKE_ONLY)
  const pic = () => { const v = $('kit-bikestyle').value || 'road'; $('kit-bikepic').src = `img/bikes/${v}.webp`; $('kit-bikepic').alt = $('kit-bikestyle').selectedOptions[0]?.text || ''; };
  $('kit-bikestyle').addEventListener('change', pic);
  pic();
  let fit = 'logo';
  $('kit-up-logo').addEventListener('click', () => { fit = 'logo'; $('kit-file').click(); });
  $('kit-up-full').addEventListener('click', () => { fit = 'full'; $('kit-file').click(); });
  $('kit-file').addEventListener('change', () => upload(fit));
  $('kit-up-clear').addEventListener('click', () => setDesign(designString({ ...current(), img: null })));
  $('kit-template').addEventListener('click', (e) => {
    e.preventDefault();
    drawTemplate(document.createElement('canvas')).toBlob((b) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'rideworld-jersey-template.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });
  // dragging round a colour picker previews; letting go saves
  const recolour = (save) => { const p = current(); p.c = [$('kit-jersey').value, $('kit-c2').value, $('kit-c3').value, $('kit-c4').value]; setDesign(designString(p), save); };
  for (const id of ['kit-jersey', 'kit-c2', 'kit-c3', 'kit-c4']) { $(id).addEventListener('input', () => recolour(false)); $(id).addEventListener('change', () => recolour(true)); }
  render();
}
