// Editor chrome on top of the pane and the preview (not the scene):
// - pane header (static, no collapse) and progressive blur at the top / bottom of the list
// - section icons (Phosphor) in rounded accent frames
// - 3D rotation widget (Figma-style cube + X / Y / Z fields) for camera.elevation / azimuth / roll
// - preview scrollbars for camera.panX / panY
// - focus mode: the preview fills the screen (36px padding), the rest blurs away
// Edits go through the same path as the mouse on the preview: change S, quietRefresh(),
// applyAll(), then hooks (undo, timeline, cases).
import { ICONS } from './icons.js';

// webimmersive.io RGB split; the blue is lifted from #3c3cff to #7373ff so the icon keeps a
// 4.5:1 contrast on its tinted frame (red ≈4.8:1, green ≈13:1)
const ACCENTS = { r: '#ff3c3c', g: '#3cff3c', b: '#7373ff' };
const SECTION = {
  'Cases (personal site)': ['cases', 'b'],
  Device: ['device', 'r'], Camera: ['camera', 'g'], Blur: ['blur', 'b'],
  Screen: ['screen', 'r'], Light: ['light', 'g'], Export: ['export', 'b'],
  Background: ['background', 'r'], Lighting: ['lighting', 'g'],
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function initUI({ S, DEFAULTS, frame, stage, paneEl, fCam, applyAll, quietRefresh, hooks, layout }) {
  const edited = (key) => { quietRefresh(); applyAll(); hooks.forEach((h) => h({ target: { key } })); };

  // ───────── progressive blur at the bottom of the list (the top is the sticky tab bar) ─────────
  const fade = el('div', 'pane-fade pane-fade-bottom', '<i></i><i></i><i></i><i></i><i></i>');
  document.body.appendChild(fade);
  const syncFades = () => {
    const { scrollTop, scrollHeight, clientHeight } = paneEl;
    fade.classList.toggle('on', scrollTop + clientHeight < scrollHeight - 2);
  };
  paneEl.addEventListener('scroll', syncFades, { passive: true });
  new ResizeObserver(syncFades).observe(paneEl);

  // ───────── section icons ─────────
  function decorate() {
    for (const b of paneEl.querySelectorAll('.tp-fldv_b')) {
      if (b.querySelector('.sec-ico')) continue;
      const folder = b.parentElement;
      const top = folder.parentElement?.matches('.tp-tbpv_c, .tp-rotv_c');
      const meta = SECTION[b.textContent.trim()];
      if (!top || !meta) continue;
      const [icon, tone] = meta;
      const i = el('span', 'sec-ico', ICONS[icon]);
      i.style.setProperty('--acc', ACCENTS[tone]);
      b.prepend(i);
      folder.classList.add('has-ico');
    }
    syncFades();
  }
  decorate();
  new MutationObserver(decorate).observe(paneEl, { childList: true, subtree: true });

  // ───────── 3D rotation widget ─────────
  const AX = [
    { k: 'elevation', n: 'X', min: -89, max: 89 },
    { k: 'azimuth', n: 'Y', min: -Infinity, max: Infinity },
    { k: 'roll', n: 'Z', min: -90, max: 90 },
  ];
  const rot = el('div', 'rot');
  rot.innerHTML = `
    <div class="rot-view" title="Drag to rotate">
      <div class="rot-cube">
        <i class="f-front"><b></b></i><i class="f-back"></i><i class="f-right"></i>
        <i class="f-left"></i><i class="f-top"></i><i class="f-bottom"></i>
      </div>
      <button class="rot-reset" data-tip="Reset rotation" aria-label="Reset rotation">${ICONS.reset}</button>
    </div>
    <div class="rot-rows">
      <span class="rot-label">Rotation</span>
      <div class="rot-fields">${AX.map((a) => `<label class="rot-field" data-k="${a.k}"><span class="rot-ax" title="Drag to scrub">${a.n}</span><input type="text" inputmode="decimal" spellcheck="false"></label>`).join('')}</div>
    </div>`;
  fCam.element.querySelector('.tp-fldv_c').prepend(rot);
  const cube = rot.querySelector('.rot-cube');
  const fields = [...rot.querySelectorAll('.rot-field')].map((f) => ({ f, a: AX.find((a) => a.k === f.dataset.k), input: f.querySelector('input') }));
  const fmt = (v) => `${(+v.toFixed(2)).toString()}°`;
  const setAxis = (a, v) => { S.camera[a.k] = clamp(v, a.min, a.max); };

  // drag the cube: same mapping as dragging the device on the preview
  const view = rot.querySelector('.rot-view');
  let cd = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.rot-reset')) return;
    cd = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); view.classList.add('drag');
  });
  view.addEventListener('pointermove', (e) => {
    if (!cd) return;
    const dx = e.clientX - cd.x, dy = e.clientY - cd.y; cd.x = e.clientX; cd.y = e.clientY;
    S.camera.azimuth -= dx * 0.5;
    S.camera.elevation = clamp(S.camera.elevation + dy * 0.5, -89, 89);
    edited('camera');
  });
  const endCube = () => { cd = null; view.classList.remove('drag'); };
  view.addEventListener('pointerup', endCube);
  view.addEventListener('pointercancel', endCube);
  rot.querySelector('.rot-reset').addEventListener('click', () => {
    for (const a of AX) S.camera[a.k] = DEFAULTS.camera[a.k];
    edited('camera');
  });

  // fields: type a value (Enter / blur), ↑↓ steps 1 (Shift 10), drag the axis letter to scrub
  for (const { f, a, input } of fields) {
    const commit = () => {
      const v = parseFloat(input.value.replace(',', '.'));
      if (Number.isFinite(v) && v !== S.camera[a.k]) { setAxis(a, v); edited(a.k); }
      input.value = fmt(S.camera[a.k]);
    };
    input.addEventListener('focus', () => { input.value = +S.camera[a.k].toFixed(2); input.select(); });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      else if (e.key === 'Escape') { input.value = fmt(S.camera[a.k]); input.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setAxis(a, S.camera[a.k] + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
        input.value = +S.camera[a.k].toFixed(2); edited(a.k);
      }
    });
    const ax = f.querySelector('.rot-ax');
    let sd = null;
    ax.addEventListener('pointerdown', (e) => { e.preventDefault(); sd = { x: e.clientX }; ax.setPointerCapture(e.pointerId); f.classList.add('scrub'); });
    ax.addEventListener('pointermove', (e) => {
      if (!sd) return;
      const dx = e.clientX - sd.x; sd.x = e.clientX;
      setAxis(a, S.camera[a.k] + dx * (e.shiftKey ? 1 : 0.25)); edited(a.k);
    });
    const endScrub = () => { sd = null; f.classList.remove('scrub'); };
    ax.addEventListener('pointerup', endScrub);
    ax.addEventListener('pointercancel', endScrub);
  }

  // ───────── preview scrollbars (pan) ─────────
  const PAN = 1.5, THUMB = 0.28; // pan range ±1.5, thumb = 28% of the track
  const bars = ['x', 'y'].map((axis) => {
    const track = el('div', `pv-bar pv-bar-${axis}`, '<i></i>');
    frame.appendChild(track);
    const thumb = track.firstChild;
    const key = axis === 'x' ? 'panX' : 'panY';
    // thumb right = camera right (panX +); thumb down = camera down (panY −)
    const toT = () => (axis === 'x' ? S.camera.panX : -S.camera.panY) / (2 * PAN) + 0.5;
    const fromT = (t) => { const v = clamp((t - 0.5) * 2 * PAN, -PAN, PAN); S.camera[key] = axis === 'x' ? v : -v; };
    const len = () => (axis === 'x' ? track.clientWidth : track.clientHeight);
    let d = null;
    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const r = track.getBoundingClientRect();
      const p = axis === 'x' ? e.clientX - r.left : e.clientY - r.top;
      const L = len(), span = L * (1 - THUMB);
      if (e.target !== thumb) { fromT(clamp((p - L * THUMB / 2) / span, 0, 1)); edited(key); }
      d = { p, t: toT() }; track.setPointerCapture(e.pointerId); track.classList.add('drag');
    });
    track.addEventListener('pointermove', (e) => {
      if (!d) return;
      const r = track.getBoundingClientRect();
      const p = axis === 'x' ? e.clientX - r.left : e.clientY - r.top;
      fromT(d.t + (p - d.p) / (len() * (1 - THUMB))); edited(key);
    });
    const end = () => { d = null; track.classList.remove('drag'); };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('dblclick', (e) => { e.stopPropagation(); S.camera[key] = DEFAULTS.camera[key]; edited(key); });
    track.title = 'Drag to move · double-click to centre';
    return { thumb, axis, toT };
  });

  // ───────── tooltips for icon-only buttons ─────────
  // [data-tip] or an icon button with a title (the timeline's ▶, the Cases arrows): the title
  // moves to data-tip on first hover so the browser's own tooltip does not show as well
  const ICON_BTN = '[data-tip], #timeline [data-a=play], .icon-btn';
  const tip = el('div', 'tip'); tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  let tipFor = null, tipTimer = 0;
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.classList.remove('on'); }
  function placeTip(t) {
    tip.textContent = t.dataset.tip;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10;
    const below = r.top - h - gap < 8;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tip.style.left = x + 'px';
    tip.style.top = (below ? r.bottom + gap : r.top - h - gap) + 'px';
    tip.style.setProperty('--cx', Math.max(12, Math.min(w - 12, r.left + r.width / 2 - x)) + 'px');
    tip.classList.toggle('below', below);
  }
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.(ICON_BTN);
    if (t === tipFor) return;
    hideTip();
    if (!t) return;
    if (!t.dataset.tip && t.title) { t.dataset.tip = t.title.replace(/\s*\(([^)]+)\)\s*$/, ' · $1'); t.setAttribute('aria-label', t.title); t.removeAttribute('title'); }
    if (!t.dataset.tip) return;
    tipFor = t;
    tipTimer = setTimeout(() => { if (tipFor === t) { placeTip(t); tip.classList.add('on'); } }, 350);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('blur', hideTip);

  // ───────── focus mode ─────────
  const veil = el('div'); veil.id = 'focus-veil'; document.body.appendChild(veil);
  const fsBtn = el('button', 'focus-btn', ICONS.expand);
  fsBtn.dataset.tip = 'Full screen · F'; fsBtn.setAttribute('aria-label', 'Full screen');
  // one bar over the preview: wordmark on the left (hidden in focus mode), full screen on the right
  const bar = el('div', 'stage-bar', '<span class="wordmark">Mockup Studio</span>');
  bar.appendChild(fsBtn);
  stage.appendChild(bar);
  function setFocus(on) {
    if (on === document.body.classList.contains('focus')) return;
    const r0 = frame.getBoundingClientRect();
    document.body.classList.toggle('focus', on);
    fsBtn.innerHTML = on ? ICONS.collapse : ICONS.expand;
    fsBtn.dataset.tip = on ? 'Exit full screen · Esc' : 'Full screen · F';
    fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    hideTip();
    layout();
    const r1 = frame.getBoundingClientRect();
    // FLIP: start from the old box and glide into the new one
    frame.style.transition = 'none';
    frame.style.transformOrigin = '0 0';
    frame.style.transform = `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) scale(${r0.width / r1.width}, ${r0.height / r1.height})`;
    frame.getBoundingClientRect();
    frame.style.transition = 'transform .55s cubic-bezier(.2,.7,.2,1)';
    frame.style.transform = '';
    frame.addEventListener('transitionend', () => { frame.style.transition = ''; frame.style.transformOrigin = ''; }, { once: true });
  }
  fsBtn.addEventListener('click', () => setFocus(!document.body.classList.contains('focus')));
  veil.addEventListener('click', () => setFocus(false));
  stage.addEventListener('click', (e) => { if (e.target === stage) setFocus(false); });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') setFocus(false);
    else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) setFocus(!document.body.classList.contains('focus'));
  });

  // ───────── keep the custom widgets in step with S (mouse, undo, timeline, setState) ─────────
  let last = '';
  (function sync() {
    const c = S.camera;
    const sig = [c.elevation, c.azimuth, c.roll, c.panX, c.panY].join();
    if (sig !== last) {
      last = sig;
      // the cube shows the device as the camera sees it
      cube.style.transform = `rotateZ(${-c.roll}deg) rotateX(${-c.elevation}deg) rotateY(${-c.azimuth}deg)`;
      for (const { a, input } of fields) if (document.activeElement !== input) input.value = fmt(c[a.k]);
      for (const b of bars) {
        const t = clamp(b.toT(), 0, 1) * (1 - THUMB) * 100;
        if (b.axis === 'x') b.thumb.style.left = t + '%'; else b.thumb.style.top = t + '%';
      }
    }
    requestAnimationFrame(sync);
  })();

  return { setFocus };
}
