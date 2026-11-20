// Animate: a timeline under the stage. Each keyframe holds the Thing settings (camera,
// blur, screen, light); between keyframes numbers are eased, everything else switches at
// the next keyframe. The device and the aspect stay the same for the whole animation.
//
// Click the track to move the playhead, click a diamond to select that keyframe (edits in
// the panel then go into it), drag a diamond to retime it.

const PARTS = ['camera', 'blur', 'screen', 'scene'];
const SCENE_KEYS = ['envIntensity', 'envRotation', 'keyLight', 'exposure', 'grain', 'tone'];
const snap = (S) => ({
  camera: { ...S.camera },
  blur: { ...S.blur },
  screen: { ...S.screen },
  scene: Object.fromEntries(SCENE_KEYS.map((k) => [k, S.scene[k]])),
});
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function between(a, b, k) {
  const out = {};
  for (const p of PARTS) {
    out[p] = {};
    for (const key of Object.keys(a[p] || {})) {
      const x = a[p][key], y = b[p]?.[key];
      out[p][key] = typeof x === 'number' && typeof y === 'number' ? x + (y - x) * k : k < 1 ? x : y;
    }
  }
  return out;
}

export function initAnim({ S, pane, stage, canvas, setState, hooks, layout, markDirty }) {
  const A = S.anim;
  let time = 0, selected = null, playing = false, recorder = null, last = 0;

  const bar = document.createElement('div');
  bar.id = 'timeline';
  bar.innerHTML = `
    <button data-a="play" title="Play / pause (Space)">▶</button>
    <span class="tl-time">0.00s</span>
    <div class="tl-track"><div class="tl-head"></div></div>
    <button data-a="add" title="Add a keyframe at the playhead">＋ Key</button>
    <button data-a="del" title="Delete the selected keyframe" disabled>Delete</button>
    <label title="Length in seconds">⏱ <input type="number" min="0.5" max="60" step="0.5"></label>
    <label title="Play in a loop"><input type="checkbox" data-a="loop"> Loop</label>
    <button data-a="rec" title="Play once and download a WebM">● Record</button>`;
  document.body.appendChild(bar);
  const $ = (q) => bar.querySelector(q);
  const track = $('.tl-track'), head = $('.tl-head'), timeEl = $('.tl-time');
  const durEl = $('input[type=number]'), loopEl = $('[data-a=loop]');

  const keys = () => A.keys.sort((a, b) => a.t - b.t);
  function stateAt(t) {
    const ks = keys();
    if (!ks.length) return null;
    if (t <= ks[0].t) return ks[0].state;
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].state;
    const i = ks.findIndex((k) => k.t > t);
    const a = ks[i - 1], b = ks[i];
    return between(a.state, b.state, ease((t - a.t) / (b.t - a.t)));
  }
  function seek(t, keepSelection) {
    time = Math.max(0, Math.min(A.duration, t));
    if (!keepSelection) selected = keys().find((k) => Math.abs(k.t - time) < 1e-3) || null;
    const st = stateAt(time);
    if (st) setState(structuredClone(st));
    draw();
  }

  function draw() {
    bar.style.display = A.enabled ? 'flex' : 'none';
    timeEl.textContent = time.toFixed(2) + 's';
    head.style.left = (time / A.duration) * 100 + '%';
    durEl.value = A.duration; loopEl.checked = A.loop;
    $('[data-a=play]').textContent = playing ? '❚❚' : '▶';
    $('[data-a=del]').disabled = !selected;
    $('[data-a=rec]').textContent = recorder ? '■ Recording…' : '● Record';
    track.querySelectorAll('.tl-key').forEach((n) => n.remove());
    for (const k of keys()) {
      const d = document.createElement('div');
      d.className = 'tl-key' + (k === selected ? ' on' : '');
      d.style.left = (k.t / A.duration) * 100 + '%';
      d.title = k.t.toFixed(2) + 's';
      d.onpointerdown = (e) => {
        e.stopPropagation(); selected = k; seek(k.t, true);
        const move = (ev) => {
          const r = track.getBoundingClientRect();
          k.t = Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * A.duration * 20) / 20;
          time = k.t; draw();
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      };
      track.appendChild(d);
    }
    stage.classList.toggle('with-timeline', !!A.enabled);
  }

  track.addEventListener('pointerdown', (e) => {
    const r = track.getBoundingClientRect();
    const scrub = (ev) => seek(((ev.clientX - r.left) / r.width) * A.duration);
    scrub(e);
    const up = () => { window.removeEventListener('pointermove', scrub); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', scrub); window.addEventListener('pointerup', up);
  });

  function play(on) {
    playing = on;
    if (on) { if (time >= A.duration) time = 0; last = performance.now(); requestAnimationFrame(step); }
    draw();
  }
  function step(now) {
    if (!playing) return;
    time += (now - last) / 1000; last = now;
    if (time >= A.duration) {
      if (A.loop && !recorder) time %= A.duration;
      else { time = A.duration; playing = false; recorder?.stop(); }
    }
    seek(time, true); markDirty();
    if (playing) requestAnimationFrame(step);
  }

  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') play(!playing);
    if (a === 'add') {
      time = +time.toFixed(2);
      const k = keys().find((x) => Math.abs(x.t - time) < 1e-3);
      if (k) k.state = snap(S); else A.keys.push({ t: time, state: snap(S) });
      selected = keys().find((x) => Math.abs(x.t - time) < 1e-3); draw();
    }
    if (a === 'del' && selected) { A.keys.splice(A.keys.indexOf(selected), 1); selected = null; draw(); }
    if (a === 'rec' && !recorder && A.keys.length > 1) record();
  });
  durEl.onchange = () => {
    const d = Math.max(0.5, +durEl.value || A.duration), k = d / A.duration;
    A.keys.forEach((x) => (x.t = +(x.t * k).toFixed(2))); // keep the rhythm, stretch the time
    A.duration = d; time = Math.min(time * k, d); draw();
  };
  loopEl.onchange = () => { A.loop = loopEl.checked; };

  function record() {
    const stream = canvas.captureStream(60);
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      a.download = `mockup-${S.device}-${Date.now()}.webm`; a.click();
      recorder = null; draw();
    };
    time = 0; seek(0, true); recorder.start(); play(true);
  }

  // edits in the panel (or with the mouse) go into the selected keyframe
  hooks.push((ev) => {
    // first switch-on: start the timeline with the current shot as the first keyframe
    if (A.enabled && !A.keys.length) { A.keys.push({ t: 0, state: snap(S) }); selected = A.keys[0]; time = 0; }
    draw();
    if (A.enabled && selected && !playing && Math.abs(selected.t - time) < 1e-3) selected.state = snap(S);
    layout();
  });
  window.addEventListener('keydown', (e) => {
    if (!A.enabled || e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); play(!playing); }
  });
  draw();
}
