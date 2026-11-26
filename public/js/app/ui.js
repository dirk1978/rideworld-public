// The setup screen's shell (redesign 2026-10-27): the sidebar's links light up for the section in view and scroll to
// theirs smoothly; "Your route" in the sidebar follows the route picked in the list (its outline, name, distance and
// climbing); every slider fills its gradient up to the thumb (CSS reads --p).
import { $ } from './core.js';

// The launch screen while a ride loads: the route's outline drawing itself, three steps and a bar. step 0..2; done()
// fades it out (with the setup screen) as the ride appears, or straight away on an error.
export function launch(step) {
  const el = $('launch');
  if (el.classList.contains('hidden')) {
    const card = document.querySelector('#pane-suggest .route-card.active'), svg = card?.querySelector('.thumb svg');
    $('launch-route').textContent = card?.querySelector('.title strong')?.textContent || 'your route';
    $('launch-thumb').replaceChildren(...(svg ? [svg.cloneNode(true)] : []));
    el.classList.remove('hidden', 'out');
  }
  [...$('launch-steps').children].forEach((li, i) => { li.className = i < step ? 'done' : i === step ? 'on' : ''; });
  $('launch-fill').style.width = `${[18, 55, 88][step] ?? 100}%`;
}
export function launchDone(ok = true) {
  const el = $('launch');
  if (el.classList.contains('hidden')) return;
  if (!ok) { el.classList.add('hidden'); return; }
  $('launch-fill').style.width = '100%';
  [...$('launch-steps').children].forEach((li) => { li.className = 'done'; });
  el.classList.add('out');
  setTimeout(() => el.classList.add('hidden'), 700);
}

export function initUi() {
  const setup = $('setup'), links = [...document.querySelectorAll('.side-nav a')];
  let navLock = 0; // (while a tapped link's scroll runs, the chip strip doesn't re-centre itself)
  // the section in view: the last one whose top has passed a third of the way down the screen
  const spy = () => {
    const mark = setup.getBoundingClientRect().top + setup.clientHeight / 3;
    let on = null;
    for (const a of links) {
      const sec = document.querySelector(a.getAttribute('href'));
      if (sec && sec.offsetParent !== null && sec.getBoundingClientRect().top <= mark) on = a;
    }
    on ||= links.find((a) => document.querySelector(a.getAttribute('href'))?.offsetParent !== null);
    for (const a of links) a.classList.toggle('on', a === on);
    // (the strip of chips on narrow screens keeps the lit one in view)
    if (on && performance.now() > navLock && getComputedStyle(on.parentElement).flexDirection === 'row') {
      const nav = on.parentElement, x = on.offsetLeft - nav.clientWidth / 2 + on.clientWidth / 2;
      if (Math.abs(nav.scrollLeft - x) > 40) nav.scrollTo({ left: x, behavior: 'smooth' });
    }
  };
  let ticking = false;
  setup.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; spy(); }); } }, { passive: true });
  for (const a of [...links, ...document.querySelectorAll('.side a.brand, #side-route')]) {
    a.addEventListener('click', (e) => {
      const sec = document.querySelector(a.getAttribute('href'));
      if (!sec) return;
      e.preventDefault();
      // (2026-11-24, the owner: the links "have never worked for android chrome", nor in the Android app) scrollIntoView
      // smoothly in #setup, then the chip strip's own smooth re-centre: Chrome on Android cancels the first smooth scroll
      // when the second starts, so nothing moved. Now #setup is scrolled to the exact place (below the chip strip when
      // it sits across the top) and the strip waits until that's done.
      navLock = performance.now() + 1200;
      for (const l of links) l.classList.toggle('on', l === a);
      const nav = a.closest('.side'), strip = nav && getComputedStyle(a.parentElement).flexDirection === 'row' ? nav.getBoundingClientRect().bottom - setup.getBoundingClientRect().top : 0;
      const top = setup.scrollTop + sec.getBoundingClientRect().top - setup.getBoundingClientRect().top - Math.max(16, strip + 12);
      setup.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  spy();
  new ResizeObserver(spy).observe(setup);

  // "Your route": copied from the selected card whenever the list changes
  const pane = $('pane-suggest');
  const sync = () => {
    const card = pane.querySelector('.route-card.active');
    const name = card?.querySelector('.title strong')?.textContent;
    $('side-route-name').textContent = name || 'Choose a route';
    $('side-route-meta').textContent = card?.querySelector('.meta.km')?.textContent || '';
    const thumb = document.querySelector('#side-route .sr-thumb'), svg = card?.querySelector('.thumb svg, .thumb img'); // (an open world's picture, else the outline)
    thumb.replaceChildren(...(svg ? [svg.cloneNode(true)] : []));
  };
  new MutationObserver(sync).observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  sync();

  // sliders: --p for the gradient fill (on load, as they move, and when the app sets them)
  const fill = (r) => r.style.setProperty('--p', `${((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100}%`);
  const ranges = [...document.querySelectorAll('input[type=range]')];
  for (const r of ranges) { fill(r); r.addEventListener('input', () => fill(r)); }
  setInterval(() => { for (const r of ranges) if (r.offsetParent !== null) fill(r); }, 1000);
}
