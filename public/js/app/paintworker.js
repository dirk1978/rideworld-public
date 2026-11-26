// A painter for the painted ground (paint.js runs 1-3 of these): gets the gridded world data once, then paints tiles
// on an OffscreenCanvas and hands each back as an ImageBitmap (transferred, no copy). The drawing is paintcore.js,
// the same code the page uses when workers aren't available.
import { drawTile, setData } from './paintcore.js';

// (flipped top to bottom: Cesium uploads an ImageBitmap as it is, without the flip it gives a canvas, so an unflipped
// bitmap lay upside down in every tile: the roads painted beside the kerbs, the owner's report 2026-11-23)
self.onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'data') { setData(m.D); return; }
  if (m.t === 'tile') {
    try {
      const bmp = await createImageBitmap(drawTile(m.w, m.s, m.e, m.n), { imageOrientation: 'flipY' });
      self.postMessage({ t: 'tile', id: m.id, bmp }, [bmp]);
    } catch (err) { self.postMessage({ t: 'tile', id: m.id, err: String(err?.message || err) }); }
  }
};
