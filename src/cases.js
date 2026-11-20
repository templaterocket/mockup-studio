// "Cases" panel: step through the personal site's case screenshots, tune each shot and
// save it. Saved shots go to <site>/source-images/mock/shots.json (via the dev-server API
// in vite.config.js); tools/mock-cases.mjs renders them with exactly these settings.
// The frame shows the case's mesh behind the transparent render, as on the site; the
// mesh colours are edited on the Skybox tab and saved into the site's styles.css.

const SUBSET = (S) => ({
  device: S.device,
  aspect: S.aspect,
  state: {
    camera: { ...S.camera },
    blur: { ...S.blur },
    scene: { ...S.scene, mesh: undefined, meshPos: undefined, transparent: true },
    screen: { ...S.screen },
  },
});
const sig = (x) => JSON.stringify(x);
const MESH_KEYS = ['g1', 'g2', 'b1', 'b2'];
const FALLBACK = { g1: '#d0d0d4', g2: '#c0c0c4', b1: '#f1f1f2', b2: '#d9d9dc' };

export async function initCases({ pane, S, DEFAULTS, setState, loadScreenURL, frame, settled, hooks, lockCaseMode, skyBg, resetHistory }) {
  let data;
  try {
    const r = await fetch('/api/cases');
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  if (!data.shots?.length) return;
  lockCaseMode();

  const bySlug = {};
  for (const s of data.shots) (bySlug[s.slug] ??= []).push(s);
  for (const list of Object.values(bySlug)) list.sort((a, b) => (a.key === 'hero' ? -1 : b.key === 'hero' ? 1 : 0));
  const slugs = Object.keys(bySlug);

  const ui = { slug: slugs[0], key: bySlug[slugs[0]][0].key };
  let current = null;   // the shot entry
  let baseline = '';    // signature of the last loaded / saved settings

  const f = pane.addFolder({ title: 'Cases (personal site)', index: 0 });
  const slugBlade = f.addBlade({ view: 'list', label: 'Project', options: slugs.map((s) => ({ text: s, value: s })), value: ui.slug });

  // Save / Revert row: "✓ Saved" (inactive) when nothing changed since the last save
  const row = document.createElement('div');
  row.className = 'case-save';
  const saveBtn = Object.assign(document.createElement('button'), { onclick: () => save() });
  const revertBtn = Object.assign(document.createElement('button'), { className: 'ghost', textContent: 'Revert', title: 'Back to the last saved settings', onclick: () => open() });
  row.append(saveBtn, revertBtn);

  let keyBlade = null;
  // ✕ hidden from the case page, ● saved settings
  const keyOptions = () => bySlug[ui.slug].map((s) => ({ text: `${s.hidden ? '✕ ' : s.saved ? '● ' : ''}${s.key}${s.kind === 'phone' ? ' (phone)' : ''}`, value: s.key }));
  const icon = (txt, title, fn) => Object.assign(document.createElement('button'), { className: 'icon-btn', textContent: txt, title, onclick: fn });
  const makeKeyBlade = () => {
    keyBlade?.dispose();
    keyBlade = f.addBlade({ view: 'list', label: 'Screen', options: keyOptions(), value: ui.key, index: 1 });
    keyBlade.on('change', (ev) => { ui.key = ev.value; open(); });
    keyBlade.element.classList.add('case-screen');
    const v = keyBlade.element.querySelector('.tp-lblv_v');
    v.prepend(icon('‹', 'Previous screen (Alt+←)', () => nav(-1)));
    v.append(icon('›', 'Next screen (Alt+→)', () => nav(1)));
    keyBlade.element.after(row);
  };
  makeKeyBlade();
  slugBlade.on('change', (ev) => { ui.slug = ev.value; ui.key = bySlug[ui.slug][0].key; makeKeyBlade(); open(); });

  const nav = (d) => {
    const order = slugs.flatMap((s) => bySlug[s]);
    let i = order.findIndex((s) => s.slug === ui.slug && s.key === ui.key);
    i = (i + d + order.length) % order.length;
    const next = order[i];
    const slugChanged = next.slug !== ui.slug;
    ui.slug = next.slug; ui.key = next.key;
    if (slugChanged) slugBlade.value = ui.slug;
    makeKeyBlade();
    open();
  };
  const hideBtn = f.addButton({ title: 'Hide from case' });
  hideBtn.on('click', toggleHidden);

  // Skybox tab in case mode: the case's mesh, saved into the site's CSS
  const meshBtn = skyBg.addButton({ title: 'Save background to case' });
  meshBtn.on('click', saveMesh);
  const meshOf = (slug) => MESH_KEYS.map((k) => data.mesh[slug]?.[k] || FALLBACK[k]);
  // glow centres: --p1 / --p2 in the CSS ("72% 38%"), 0..1 here
  const pt = (v, d) => (v ? v.split(/\s+/).map((x) => parseFloat(x) / 100) : d);
  const posOf = (slug) => [...pt(data.mesh[slug]?.p1, [0.72, 0.38]), ...pt(data.mesh[slug]?.p2, [0.22, 0.82])];
  const pct = (x, y) => `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;

  function setMesh([g1, g2, b1, b2], [x1, y1, x2, y2]) {
    // same layers as .mock in the site's styles.css
    frame.style.backgroundColor = b2;
    frame.style.backgroundImage = [
      `radial-gradient(55% 65% at ${pct(x1, y1)}, color-mix(in oklab, ${g1} 42%, transparent), transparent 72%)`,
      `radial-gradient(50% 60% at ${pct(x2, y2)}, color-mix(in oklab, ${g2} 30%, transparent), transparent 70%)`,
      `linear-gradient(155deg, ${b1} 0%, ${b2} 100%)`,
    ].join(',');
  }

  async function open() {
    current = bySlug[ui.slug].find((s) => s.key === ui.key);
    const st = structuredClone(DEFAULTS);
    st.device = current.device;
    st.aspect = current.aspect;
    for (const k of ['camera', 'blur', 'scene', 'screen']) Object.assign(st[k], current.state[k] || {});
    if (current.state.blur && current.state.blur.smartAngle == null) st.blur.smartAngle = Math.abs(st.blur.angle - st.camera.roll) < 0.01;
    st.scene.transparent = true;
    st.scene.meshOn = true;
    st.scene.mesh = meshOf(ui.slug); // reflections in the preview match the page
    st.scene.meshPos = posOf(ui.slug);
    st.anim = S.anim;
    setState(st);
    await settled();
    await loadScreenURL(`/api/cases/screen/${ui.slug}/${current.file}`);
    baseline = sig(SUBSET(S));
    resetHistory(); // undo stays within one screen
    showHidden();
    tick();
  }

  async function save() {
    if (!current) return;
    const body = { slug: ui.slug, key: ui.key, ...SUBSET(S) };
    const r = await fetch('/api/cases/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { saveBtn.textContent = 'Save failed, try again'; return; }
    current.saved = true;
    current.device = body.device; current.aspect = body.aspect; current.state = structuredClone(body.state);
    baseline = sig(SUBSET(S));
    makeKeyBlade();
    tick();
  }

  async function saveMesh() {
    const [g1, g2, b1, b2] = S.scene.mesh;
    const [x1, y1, x2, y2] = S.scene.meshPos;
    const v = { g1, g2, b1, b2, p1: pct(x1, y1), p2: pct(x2, y2) };
    const r = await fetch('/api/cases/mesh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: ui.slug, ...v }) });
    if (!r.ok) { meshBtn.title = 'Save failed'; return; }
    data.mesh[ui.slug] = v;
    tick();
  }

  async function toggleHidden() {
    if (!current || current.key === 'hero') return;
    const hidden = !current.hidden;
    const r = await fetch('/api/cases/hide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: ui.slug, key: ui.key, hidden }) });
    if (!r.ok) return;
    current.hidden = hidden;
    makeKeyBlade();
    showHidden();
  }
  function showHidden() {
    hideBtn.title = current?.hidden ? 'Show on case again' : 'Hide from case';
    hideBtn.disabled = current?.key === 'hero';
    frame.style.opacity = current?.hidden ? '0.35' : '';
  }

  let lastLook = '';
  function tick() {
    if (!current) return;
    const changed = sig(SUBSET(S)) !== baseline;
    const look = `${changed}|${current.saved}`;
    if (look !== lastLook) {
      lastLook = look;
      saveBtn.disabled = !changed && current.saved;
      saveBtn.textContent = !changed && current.saved ? '✓  Saved' : 'Save this shot';
      saveBtn.title = 'Cmd+S';
      revertBtn.style.display = changed ? '' : 'none';
    }
    setMesh(S.scene.mesh, S.scene.meshPos);
    const meshDirty = sig([S.scene.mesh, S.scene.meshPos]) !== sig([meshOf(ui.slug), posOf(ui.slug)]);
    meshBtn.disabled = !meshDirty;
    meshBtn.title = meshDirty ? 'Save background to case' : '✓  Background saved';
  }
  setInterval(tick, 300);
  hooks.push(() => tick());

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    else if (e.altKey && e.key === 'ArrowRight') nav(1);
    else if (e.altKey && e.key === 'ArrowLeft') nav(-1);
  });
  window.addEventListener('beforeunload', (e) => { if (sig(SUBSET(S)) !== baseline) e.preventDefault(); });

  open();
}
