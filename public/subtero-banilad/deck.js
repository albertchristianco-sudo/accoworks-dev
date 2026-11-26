(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const N = slides.length;
  const progress = document.getElementById('progress');
  const cur = document.getElementById('cur');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const pad = n => String(n).padStart(2, '0');
  let index = 0, lock = false;

  // stagger index per slide
  slides.forEach(s => s.querySelectorAll('[data-r]').forEach((el, i) => el.style.setProperty('--i', i)));

  // progress lanes
  slides.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Go to slide ${i + 1}: ${s.dataset.title}`);
    b.addEventListener('click', () => go(i));
    li.appendChild(b); progress.appendChild(li);
  });
  const bars = [...progress.querySelectorAll('button')];

  function go(i, fromHash) {
    i = Math.max(0, Math.min(N - 1, i));
    if (i === index && slides[i].classList.contains('is-active')) return;
    index = i;
    slides.forEach((s, k) => {
      s.classList.toggle('is-active', k === i);
      s.classList.toggle('is-before', k < i);
      s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
      if (k === i) { s.removeAttribute('inert'); s.scrollTop = 0; } else s.setAttribute('inert', '');
    });
    bars.forEach((b, k) => {
      b.classList.toggle('is-done', k < i);
      b.classList.toggle('is-current', k === i);
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    cur.textContent = pad(i + 1);
    prev.disabled = i === 0; next.disabled = i === N - 1;
    if (!fromHash) history.replaceState(null, '', '#' + (i + 1));
    document.title = `${slides[i].dataset.title} | Subtero at QOMPLEX`;
  }
  const step = d => { if (lock) return; lock = true; go(index + d); setTimeout(() => lock = false, 650); };

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' '].includes(k)) { e.preventDefault(); step(1); }
    else if (['ArrowLeft', 'PageUp'].includes(k)) { e.preventDefault(); step(-1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(N - 1); }
  });

  // touch swipe (horizontal); vertical stays native scroll
  let sx = 0, sy = 0, st = 0, tracking = false;
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); tracking = true;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - st < 900) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // wheel / trackpad on desktop, only when the slide cannot scroll
  let wheelAcc = 0, wheelT = 0;
  window.addEventListener('wheel', e => {
    const s = slides[index];
    const scrollable = s.scrollHeight > s.clientHeight + 4;
    if (scrollable) {
      const atTop = s.scrollTop <= 0, atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
      if (!((e.deltaY > 0 && atEnd) || (e.deltaY < 0 && atTop))) return;
    }
    const now = Date.now();
    if (now - wheelT > 250) wheelAcc = 0;
    wheelT = now; wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(wheelAcc) > 60) { step(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
  }, { passive: true });

  const fromHash = () => { const n = parseInt(location.hash.slice(1), 10); return Number.isFinite(n) ? n - 1 : 0; };
  window.addEventListener('hashchange', () => go(fromHash(), true));

  // warm the next slides' images
  const warm = () => slides.forEach(s => s.querySelectorAll('img[loading="lazy"]').forEach(img => { img.loading = 'eager'; }));
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 }); else setTimeout(warm, 1500);

  // ---------- Layout plan (SVG) ----------
  const svg = document.getElementById('plan');
  const NS = 'http://www.w3.org/2000/svg';
  const L = 279, W = 127; // long and short proportions of the unit
  const zones = [
    { id: 'lounge', x: 0, y: 0, w: 38, h: W, fill: '#1f1d1a', label: 'Reception', sub: 'and lounge', d: 0 },
    { id: 'turf', x: 38, y: 0, w: L - 38, h: 46, fill: '#2c2b28', label: 'Turf sled lanes', sub: 'full length', d: 1 },
    { id: 'strength', x: 38, y: 46, w: 170, h: 54, fill: '#141311', label: 'Strength and machine floor', sub: '', d: 2 },
    { id: 'cardio', x: 38, y: 100, w: 170, h: 27, fill: '#24231f', label: 'Cardio and ergs', sub: '', d: 3 },
    { id: 'rig', x: 208, y: 46, w: L - 208, h: 81, fill: '#2a2823', label: 'Rig zone', sub: 'ropes and wall balls', d: 4 },
  ];
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };

  function build() {
    const portrait = window.matchMedia('(max-width: 820px)').matches;
    // map landscape coords (x along length, y across width) to view coords
    const M = portrait ? (x, y, w, h) => ({ x: y, y: x, w: h, h: w }) : (x, y, w, h) => ({ x, y, w, h });
    const VW = portrait ? W : L, VH = portrait ? L : W, P = portrait ? 12 : 10;
    while (svg.lastChild && svg.lastChild.nodeName !== 'desc') svg.removeChild(svg.lastChild);
    svg.setAttribute('viewBox', `${-P} ${-P} ${VW + P * 2} ${VH + P * 2}`);
    const fs = portrait ? 5.6 : 5.2;

    const defs = el('defs', {}, svg);
    const cp = el('clipPath', { id: 'roomClip' }, defs); el('rect', { x: 0, y: 0, width: VW, height: VH }, cp);

    const g0 = el('g', { 'clip-path': 'url(#roomClip)' }, svg);
    zones.forEach(z => {
      const r = M(z.x, z.y, z.w, z.h);
      const g = el('g', { class: 'pz', style: `--d:${z.d}` }, g0);
      el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: z.fill, stroke: 'rgba(233,229,220,.22)', 'stroke-width': .4 }, g);
      // details
      if (z.id === 'turf') {
        [15.3, 30.6].forEach(yy => { const a = M(z.x + 4, yy, z.w - 8, 0); el('line', { x1: a.x, y1: a.y, x2: a.x + (portrait ? 0 : a.w), y2: a.y + (portrait ? a.h : 0), stroke: '#E9E5DC', 'stroke-width': .7 }, g); });
        for (let t = z.x + 16; t < L - 8; t += 26) { [[3, 12.3], [18.3, 12.3], [33.6, 12.3]].forEach(([yy, hh]) => { const a = M(t, yy, 0, hh); el('line', { x1: a.x, y1: a.y, x2: a.x + (portrait ? a.w : 0), y2: a.y + (portrait ? 0 : a.h), stroke: 'rgba(233,229,220,.38)', 'stroke-width': .5 }, g); }); }
        [7, 22.5, 37.5].forEach(yy => { const a = M(z.x + 6, yy - 3, 8, 6); el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: '#0C0B0A', stroke: '#8C877D', 'stroke-width': .4 }, g); });
      }
      if (z.id === 'strength') {
        for (let i = 0; i < 5; i++) { const a = M(z.x + 10 + i * 22, z.y + 6, 12, 16); el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#8C877D', 'stroke-width': .5 }, g); }
        const d = M(z.x + 8, z.y + 32, 150, 4); el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, fill: '#3a3833' }, g);
        for (let i = 0; i < 4; i++) { const a = M(z.x + 118 + (i % 2) * 22, z.y + 4 + Math.floor(i / 2) * 13, 16, 9); el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: '#2a2823', stroke: '#5d5a53', 'stroke-width': .4 }, g); }
      }
      if (z.id === 'cardio') {
        for (let i = 0; i < 12; i++) { const a = M(z.x + 6 + i * 13.5, z.y + 9, 8, 15); el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, rx: 1.2, fill: '#0C0B0A', stroke: '#8C877D', 'stroke-width': .4 }, g); }
        const glow = M(z.x, z.y + z.h - 1.4, z.w, 1.4); el('rect', { x: glow.x, y: glow.y, width: glow.w, height: glow.h, fill: '#CFF349', opacity: .9 }, g);
      }
      if (z.id === 'rig') {
        const a = M(L - 14, z.y + 6, 8, z.h - 12); el('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#E9E5DC', 'stroke-width': .6 }, g);
        for (let i = 1; i < 5; i++) { const b = M(L - 14, z.y + 6 + i * (z.h - 12) / 5, 8, 0); el('line', { x1: b.x, y1: b.y, x2: b.x + (portrait ? 0 : b.w), y2: b.y + (portrait ? b.h : 0), stroke: '#E9E5DC', 'stroke-width': .4 }, g); }
        [0, 1, 2].forEach(i => { const c = M(z.x + 16 + i * 14, z.y + 12, 0, 0); el('circle', { cx: c.x, cy: c.y, r: 2.2, fill: 'none', stroke: '#E9E5DC', 'stroke-width': .5 }, g); });
        [0, 1, 2].forEach(i => { const c = M(z.x + 18 + i * 14, z.y + z.h - 10, 0, 0); el('circle', { cx: c.x, cy: c.y, r: 3.2, fill: '#0C0B0A', stroke: '#8C877D', 'stroke-width': .5 }, g); });
      }
      if (z.id === 'lounge') {
        const desk = M(22, 30, 5, 40); el('rect', { x: desk.x, y: desk.y, width: desk.w, height: desk.h, fill: '#0C0B0A', stroke: '#E9E5DC', 'stroke-width': .5 }, g);
        [[10, 92], [20, 100], [10, 108]].forEach(([cx, cy]) => { const c = M(cx, cy, 0, 0); el('circle', { cx: c.x, cy: c.y, r: 3.6, fill: '#2e2c28' }, g); });
      }
      // label
      const lx = z.id === 'rig' ? z.x + 30 : z.id === 'lounge' ? z.x + 19 : z.x + z.w / 2;
      const ly = z.id === 'turf' ? z.y + 23 : z.id === 'strength' ? z.y + 46 : z.id === 'lounge' ? z.y + 16 : z.id === 'cardio' ? z.y + 5.5 : z.y + z.h / 2 + 4;
      let c = M(lx, ly, 0, 0);
      const PL = { lounge: [W / 2, 12], strength: [73, 122], rig: [86, 240] };
      if (portrait && PL[z.id]) c = { x: PL[z.id][0], y: PL[z.id][1] };
      const label = el('text', { x: c.x, y: c.y, 'text-anchor': 'middle', 'font-size': fs }, g);
      if (portrait && z.id === 'strength') { label.textContent = ''; ['Strength and', 'machine floor'].forEach((t, k) => { const ts = el('tspan', { x: c.x, dy: k ? fs * 1.15 : 0 }, label); ts.textContent = t; }); label.setAttribute('paint-order','stroke'); label.setAttribute('stroke','#141311'); label.setAttribute('stroke-width',3); }
      else label.textContent = z.label;
      if (z.id === 'turf') { const bg = el('rect', { x: c.x - (portrait ? 0 : 1), y: c.y, width: 0, height: 0 }, g); bg.remove(); }
      if (z.sub) { const s2 = el('text', { x: c.x, y: c.y + fs * (portrait && z.id === 'strength' ? 2.3 : 1.2), 'text-anchor': 'middle', 'font-size': fs * .82, class: 'lbl-sub' }, g); s2.textContent = z.sub; }
      if (z.id === 'turf' || z.id === 'cardio') { label.setAttribute('paint-order', 'stroke'); label.setAttribute('stroke', z.id === 'turf' ? '#2c2b28' : '#24231f'); label.setAttribute('stroke-width', 3); }
      if (portrait && (z.id === 'turf' || z.id === 'cardio')) {
        label.setAttribute('transform', `rotate(-90 ${c.x} ${c.y})`);
        const s2 = label.nextSibling; if (s2 && s2.nodeName === 'text') { s2.setAttribute('x', c.x); s2.setAttribute('y', c.y + fs * 1.2); s2.setAttribute('transform', `rotate(-90 ${c.x} ${c.y})`); }
      }
    });

    // ceiling light lines over the room (moving dashes, transform only)
    const lg = el('g', { class: 'pz', style: '--d:5', 'clip-path': 'url(#roomClip)' }, svg);
    [10, 64, 118].forEach(yy => {
      const a = M(-30, yy, L + 60, 0);
      const line = el('line', { class: 'ledline' + (portrait ? ' ledline--v' : ''), x1: a.x, y1: a.y, x2: a.x + (portrait ? 0 : a.w), y2: a.y + (portrait ? a.h : 0), stroke: '#CFF349', 'stroke-width': .5, 'stroke-dasharray': '14 10', opacity: .55 }, lg);
      if (portrait) { line.setAttribute('x1', yy); line.setAttribute('x2', yy); line.setAttribute('y1', -30); line.setAttribute('y2', L + 30); }
    });

    // outline + entrance
    const o = el('g', { class: 'pz', style: '--d:0' }, svg);
    el('rect', { x: 0, y: 0, width: VW, height: VH, fill: 'none', stroke: '#E9E5DC', 'stroke-width': 1.1 }, o);
    const door = M(-1, 52, 2, 22);
    el('rect', { x: door.x, y: door.y, width: door.w, height: door.h, fill: '#0C0B0A' }, o);
    const arrow = portrait ? `M${door.x + door.w / 2 - 4},${-6} L${door.x + door.w / 2},${-1.5} L${door.x + door.w / 2 + 4},${-6}` : `M${-6},${door.y + door.h / 2 - 4} L${-1.5},${door.y + door.h / 2} L${-6},${door.y + door.h / 2 + 4}`;
    el('path', { d: arrow, fill: 'none', stroke: '#CFF349', 'stroke-width': .9 }, o);
    const et = portrait ? M(-5.5, 63, 0, 0) : { x: -4, y: door.y - 3 };
    const t = el('text', { x: portrait ? door.x + door.w / 2 + 7 : 1, y: portrait ? -4 : door.y - 3, 'font-size': fs * .8, class: 'lbl-sub', 'text-anchor': 'start' }, o);
    t.textContent = 'Entrance';
  }
  build();
  let rt; window.matchMedia('(max-width: 820px)').addEventListener('change', () => { clearTimeout(rt); rt = setTimeout(build, 50); });

  go(fromHash(), true);
})();
