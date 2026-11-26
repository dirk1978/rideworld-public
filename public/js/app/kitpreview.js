// Live rider preview on the setup screen (2026-11-16, the owner: "could the face be shown in the set up screen showing live
// changes?"): the same GLB the ride uses, recoloured the same way (kit colours, jersey design, skin tone, facial hair,
// bike style), shown with Google's <model-viewer> (loaded on demand from jsDelivr). Starts framed on the face; drag
// to turn it, scroll to zoom. Redrawn a moment after any kit setting changes.
import { $ } from './core.js';
import { BIKES, KIT_KEYS, beardPng, jerseyPng, recolourGlb, skinPng } from './model.js';
import { fields } from './core.js';

let loader = null, timer = 0, url = null;
const glbs = new Map();
const load = () => (loader ||= new Promise((ok, fail) => { const s = document.createElement('script'); s.type = 'module'; s.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }));

async function draw() {
  const mv = $('kit-preview');
  if (!mv) return;
  try {
    await load();
    const kit = Object.fromEntries(KIT_KEYS.map((k) => [k, $(fields[k])?.value]));
    const bk = BIKES[kit.bikestyle] || BIKES.road;
    if (!glbs.has(bk.file)) glbs.set(bk.file, fetch(bk.file).then((r) => r.arrayBuffer()));
    const glb = await glbs.get(bk.file);
    const png = await jerseyPng(kit.design || 'plain', kit.jersey || '#ff6a1a'), skin = await skinPng(glb, kit.skin, kit.beard), beardTex = await beardPng(kit.beard, kit.beardcol);
    const out = recolourGlb(glb, { Jersey: kit.jersey, Shorts: kit.shorts, Accent: kit.shorts, Frame: kit.frame, Helmet: kit.helmet, Socks: kit.socks, Shoes: kit.shoes }, { Jersey: png, ...(skin ? { Skin: skin } : {}), Beard: beardTex });
    const next = URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
    mv.src = next;
    if (url) setTimeout(((u) => () => URL.revokeObjectURL(u))(url), 4000);
    url = next;
  } catch (e) { console.warn('kit preview', e); mv.closest('.kit-preview-wrap')?.classList.add('hidden'); }
}
export const previewKit = () => { clearTimeout(timer); timer = setTimeout(draw, 250); };

export function initKitPreview() {
  const mv = $('kit-preview');
  if (!mv) return;
  for (const k of KIT_KEYS) { const el = $(fields[k]); if (el) { el.addEventListener('change', previewKit); el.addEventListener('input', previewKit); } }
  // the face, from in front and a little to the side (the rider rides along +X in the GLB, head at ~1.25 m)
  mv.addEventListener('load', () => { if (!mv.dataset.framed) { mv.dataset.framed = '1'; } });
  // only once the setup screen shows it (the script is ~1 MB)
  new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { o.disconnect(); draw(); } }).observe(mv);
}
