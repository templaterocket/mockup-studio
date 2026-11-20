import * as THREE from 'three';
import { initCases } from './cases.js';
import { initAnim } from './anim.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Pane } from 'tweakpane';
import { DEVICES } from './devices.js';
import { BlurPass, MAX_SAMPLES } from './blur.js';

const D2R = Math.PI / 180;
const ASPECTS = { '4:3': 4 / 3, '3:2': 3 / 2, '16:10': 16 / 10, '16:9': 16 / 9, '2:1': 2, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '9:16': 9 / 16 };

// ───────────────────────── state ─────────────────────────
const DEFAULTS = {
  device: 'iphone16pro',
  aspect: '4:3',
  camera: { azimuth: -28, elevation: 14, roll: 0, distance: 3.2, focal: 50, panX: 0, panY: 0 },
  blur: {
    enabled: true, maxBlur: 0.06, samples: 64,
    focusX: 0.5, focusPos: 0.5, focusSize: 0.3, angle: 0, smartAngle: true,
    topStrength: 1, topSize: 0, topFalloff: 0.45, topCurve: 1.6,
    bottomStrength: 1, bottomSize: 0, bottomFalloff: 0.45, bottomCurve: 1.6,
    dof: false, dofFocusOffset: 0, dofStrength: 0.6,
  },
  scene: {
    // mesh: [glow 1, glow 2, base 1, base 2], drawn like .mock on the personal site
    // meshPos: centres of glow 1 and glow 2 in the frame, 0..1 (x1, y1, x2, y2)
    bgTop: '#f2f2f3', bgBottom: '#c9cacf', transparent: false, meshOn: false, mesh: ['#7c5cff', '#ff7a59', '#f1f1f2', '#d9d9dc'], meshReflect: 1.5,
    meshPos: [0.72, 0.38, 0.22, 0.82],
    photoOn: false, photoReflect: 1, envIntensity: 1, envRotation: 0,
    keyLight: 1.2, exposure: 1, tone: 'None', grain: 1.5,
  },
  screen: { fit: 'cover', align: 'center', flipX: false, flipY: false, rotate: 0, brightness: 1 },
  export: { width: 2400, supersample: 2 },
  // keyframes: [{ t (s), state: { camera, blur, screen, scene } }], see anim.js
  anim: { enabled: false, duration: 4, loop: true, keys: [] },
};
const S = structuredClone(DEFAULTS);

// ───────────────────────── renderer / scene ─────────────────────────
const canvas = document.getElementById('gl');
const frame = document.getElementById('frame');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 60);
const blurPass = new BlurPass(renderer);

const pmrem = new THREE.PMREMGenerator(renderer);
let photoTex = null, photoId = 0, photoAspect = 1; // Skybox photo (not part of the state: too big)
let envTex = null, envKey = '';
function buildEnv() {
  const usePhoto = S.scene.photoOn && photoTex;
  const k = (S.scene.meshOn ? S.scene.mesh.join() + S.scene.meshReflect : usePhoto ? '' : S.scene.bgTop + S.scene.bgBottom + S.scene.meshReflect) + (usePhoto ? photoId + ':' + S.scene.photoReflect : '');
  if (envTex && k === envKey) return;
  envKey = k;
  const room = new RoomEnvironment();
  if (S.scene.meshOn) {
    // brand-coloured emissive panels around the room: they show up as reflections on glass/metal
    const spots = [[-4.2, 3, 0, Math.PI / 2], [4.2, 3, 0, -Math.PI / 2], [0, 3, -4.2, 0], [0, 6.2, 0, 0, true]];
    S.scene.mesh.slice(0, 4).forEach((hex, i) => {
      const [x, y, z, ry, top] = spots[i];
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(S.scene.meshReflect), side: THREE.DoubleSide, toneMapped: false });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), mat);
      pl.position.set(x, y, z);
      if (top) pl.rotation.x = Math.PI / 2; else pl.rotation.y = ry;
      room.add(pl);
    });
  }
  if (!S.scene.meshOn && !usePhoto && S.scene.meshReflect > 0) {
    // plain gradient: its top and bottom colours as a soft ceiling and floor
    for (const [hex, y, rx] of [[S.scene.bgTop, 6.2, Math.PI / 2], [S.scene.bgBottom, -2, -Math.PI / 2]]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(S.scene.meshReflect * 0.5), side: THREE.DoubleSide, toneMapped: false }));
      pl.position.y = y; pl.rotation.x = rx; room.add(pl);
    }
  }
  if (usePhoto) {
    // the photo on big panels around the device, so it shows up in glass and aluminium
    const mat = new THREE.MeshBasicMaterial({ map: photoTex, color: new THREE.Color(1, 1, 1).multiplyScalar(S.scene.photoReflect), side: THREE.DoubleSide, toneMapped: false });
    for (const [x, y, z, ry] of [[0, 2.5, -5, 0], [-5, 2.5, 0, Math.PI / 2], [5, 2.5, 0, -Math.PI / 2], [0, 2.5, 5, Math.PI]]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), mat);
      pl.position.set(x, y, z); pl.rotation.y = ry; room.add(pl);
    }
  }
  envTex?.dispose();
  envTex = pmrem.fromScene(room, 0.03).texture;
  scene.environment = envTex;
}
buildEnv();
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(-2, 3, 4);
scene.add(key);

const bgCanvas = document.createElement('canvas');
bgCanvas.width = 512; bgCanvas.height = 512;
const bgTex = new THREE.CanvasTexture(bgCanvas);
bgTex.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTex;

const holder = new THREE.Group();
scene.add(holder);

// ───────────────────────── screen texture ─────────────────────────
const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
let screenTex = null;
let screenAspect = 0.5; // w/h of the screen mesh in device space
const orbitTarget = new THREE.Vector3();
let imageAspect = 1;
let screenLabel = 'placeholder';

function placeholderCanvas() {
  const c = document.createElement('canvas'); c.width = 1170; c.height = 2532;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, c.width, c.height);
  grd.addColorStop(0, '#d7ff3a'); grd.addColorStop(0.55, '#2dd4bf'); grd.addColorStop(1, '#0b3b4a');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff'; g.font = '700 110px system-ui,sans-serif'; g.textAlign = 'center';
  g.fillText('Drop a screenshot', c.width / 2, c.height / 2 - 20);
  g.font = '500 60px system-ui,sans-serif'; g.globalAlpha = 0.8;
  g.fillText('or use Screen → Load image', c.width / 2, c.height / 2 + 80);
  return c;
}

function setScreenImage(source, label = 'image') {
  if (screenTex) screenTex.dispose();
  screenTex = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  screenTex.generateMipmaps = true;
  screenTex.minFilter = THREE.LinearMipmapLinearFilter;
  screenTex.center.set(0.5, 0.5);
  screenTex.needsUpdate = true;
  imageAspect = (source.naturalWidth || source.width) / (source.naturalHeight || source.height);
  screenMat.map = screenTex; screenMat.needsUpdate = true;
  screenLabel = label;
  applyScreen();
}

function loadScreenURL(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { setScreenImage(img, url.slice(0, 40)); res(); };
    img.onerror = () => rej(new Error('cannot load ' + url));
    img.src = url;
  });
}

function applyScreen() {
  if (!screenTex) return;
  const { fit, align, flipX, flipY, rotate, brightness } = S.screen;
  const rot = ((rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const ia = swap ? 1 / imageAspect : imageAspect;
  let rx = 1, ry = 1;
  if (fit === 'cover') { if (ia > screenAspect) rx = screenAspect / ia; else ry = ia / screenAspect; }
  // crop around the centre (or keep the top of a tall page), never from a corner
  // (three's uv transform is about `center`, so a centred crop needs no offset)
  const oy = align === 'top' ? (1 - ry) / 2 : align === 'bottom' ? -(1 - ry) / 2 : 0;
  screenTex.center.set(0.5, 0.5);
  screenTex.rotation = rot * D2R;
  screenTex.repeat.set((flipX ? -1 : 1) * rx, (flipY ? -1 : 1) * ry);
  screenTex.offset.set(0, flipY ? -oy : oy);
  screenMat.color.setScalar(brightness);
  screenTex.needsUpdate = true;
  dirty = true;
}

// ───────────────────────── device loading ─────────────────────────
const loader = new GLTFLoader();
let loadedDevice = null;
let loading = false;
let currentModel = null;
let screenMeshInfo = null;

function disposeObject(o) {
  o.traverse((n) => {
    if (n.isMesh) {
      n.geometry?.dispose();
      const ms = Array.isArray(n.material) ? n.material : [n.material];
      ms.forEach((m) => { if (m !== screenMat) { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose(); } });
    }
  });
}

function findScreenMesh(root, cfg) {
  const meshes = [];
  root.traverse((n) => n.isMesh && meshes.push(n));
  let cands = meshes;
  const s = cfg.screen || {};
  if (s.material) return meshes.filter((m) => (m.material.name || '') === s.material);
  else if (s.mesh) cands = meshes.filter((m) => m.name === s.mesh || m.parent?.name === s.mesh);
  else if (s.index != null) cands = [meshes[s.index]].filter(Boolean);
  else return [];
  let best = null, bestArea = -1;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  for (const m of cands) {
    box.setFromObject(m); box.getSize(size);
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const area = dims[1] * dims[2];
    if (area > bestArea) { bestArea = area; best = m; }
  }
  return best ? [best] : [];
}

function mapScreenUVs(meshes, space) {
  // planar-project the screen vertices (in `space` coordinates: x→u, y→v) onto 0..1 over the union bbox
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(1e9, 1e9, 1e9), max = new THREE.Vector3(-1e9, -1e9, -1e9);
  const spaceInv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const data = meshes.map((mesh) => {
    const geo = mesh.geometry.clone();
    const pos = geo.attributes.position;
    const m = new THREE.Matrix4().multiplyMatrices(spaceInv, mesh.matrixWorld);
    const pts = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m); pts[i * 2] = v.x; pts[i * 2 + 1] = v.y;
      min.min(v); max.max(v);
    }
    return { mesh, geo, pts };
  });
  const w = max.x - min.x, h = max.y - min.y;
  for (const { mesh, geo, pts } of data) {
    const n = pts.length / 2, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uv[i * 2] = (pts[i * 2] - min.x) / w; uv[i * 2 + 1] = (pts[i * 2 + 1] - min.y) / h; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.geometry = geo;
    mesh.material = screenMat;
  }
  screenAspect = w / h;
  // orbit around the middle of the screen, not the middle of the whole device (a stand
  // would otherwise push the screen off-centre)
  const c = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2).applyMatrix4(space.matrixWorld);
  orbitTarget.copy(c);
}

// Apple-style anodised aluminium: silver, fully metallic, softly matte. Replaces the
// model's near-white materials, which read as glowing plastic under the studio light.
function applyAluminium(root, opt) {
  const alu = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opt.color || '#c4c6ca'), metalness: 1, roughness: opt.roughness ?? 0.36,
    envMapIntensity: opt.env ?? 0.85, clearcoat: 0.15, clearcoatRoughness: 0.5, side: THREE.DoubleSide,
  });
  root.traverse((n) => {
    if (!n.isMesh || n.material === screenMat) return;
    const mat = n.material;
    if (!mat.color || mat.map) return;
    const hsl = {}; mat.color.getHSL(hsl);
    if (hsl.l > (opt.minLightness ?? 0.6) && hsl.s < 0.15) n.material = alu;
  });
}

async function loadDevice(id) {
  if (loading) return;
  loading = true;
  const cfg = DEVICES[id];
  const gltf = await loader.loadAsync(`/models/${cfg.file}`);
  if (currentModel) { holder.remove(currentModel); disposeObject(currentModel); }
  const orient = new THREE.Group();
  orient.add(gltf.scene);
  orient.rotation.set(...cfg.rotation.map((d) => d * D2R));
  (cfg.hide || []).forEach((re) => gltf.scene.traverse((n) => { if (re.test(n.name) || re.test(n.material?.name || '')) n.visible = false; }));
  holder.add(orient);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const k = 1 / Math.max(size.x, size.y, size.z);
  orient.position.sub(ctr); // center
  const wrap = new THREE.Group(); wrap.add(orient); wrap.scale.setScalar(k);
  holder.add(wrap); holder.remove(orient);
  holder.updateMatrixWorld(true);
  currentModel = wrap;
  window.__gltf = gltf;
  screenMeshInfo = null;
  const sm = findScreenMesh(wrap, cfg);
  if (sm.length) {
    mapScreenUVs(sm, holder);
    screenMeshInfo = sm.map((m) => m.name).join(',');
  }
  if (cfg.aluminium) applyAluminium(wrap, cfg.aluminium);
  for (const fx of cfg.meshFix || []) {
    wrap.traverse((n) => {
      if (!n.isMesh || n.name !== fx.mesh) return;
      if (fx.hide) { n.visible = false; return; }
      const mat = fx.unlit ? new THREE.MeshBasicMaterial({ color: new THREE.Color(fx.unlit) }) : n.material.clone();
      if (fx.color && !fx.unlit) mat.color = new THREE.Color(fx.color);
      if (fx.roughness != null) mat.roughness = fx.roughness;
      if (fx.metalness != null) mat.metalness = fx.metalness;
      if (fx.env != null) mat.envMapIntensity = fx.env;
      if (fx.front) { mat.polygonOffset = true; mat.polygonOffsetFactor = -4; mat.polygonOffsetUnits = -4; n.renderOrder = 2; }
      n.material = mat;
    });
  }
  loadedDevice = id;
  loading = false;
  S.camera.distance = S.camera.distance; // keep user distance
  applyScreen();
  dirty = true;
  return sm;
}

// ───────────────────────── apply state → scene ─────────────────────────
let dirty = true;
let aspectNow = ASPECTS[S.aspect];

function drawBackground() {
  const g = bgCanvas.getContext('2d'), W = bgCanvas.width, H = bgCanvas.height;
  if (S.scene.meshOn) {
    // same layers as .mock on the site: a 155deg base gradient and two soft brand glows
    const [g1, g2, b1, b2] = S.scene.mesh;
    const a = 155 * D2R, dx = Math.sin(a) * W / 2, dy = -Math.cos(a) * H / 2;
    const base = g.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    base.addColorStop(0, b1); base.addColorStop(1, b2);
    g.globalAlpha = 1; g.fillStyle = base; g.fillRect(0, 0, W, H);
    const [x1, y1, x2, y2] = S.scene.meshPos;
    for (const [c, cx, cy, rx, ry, op, end] of [[g1, x1, y1, 0.55, 0.65, 0.42, 0.72], [g2, x2, y2, 0.5, 0.6, 0.3, 0.7]]) {
      g.save(); g.translate(cx * W, cy * H); g.scale(rx * W, ry * H);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      r.addColorStop(0, c); r.addColorStop(end, c + '00');
      g.globalAlpha = op; g.fillStyle = r; g.fillRect(-2, -2, 4, 4); g.restore();
    }
    g.globalAlpha = 1;
  } else {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, S.scene.bgTop); grd.addColorStop(1, S.scene.bgBottom);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  bgTex.needsUpdate = true;
  let bg = bgTex;
  if (S.scene.photoOn && photoTex) {
    // cover the frame, like background-size: cover
    const fa = ASPECTS[S.aspect];
    if (photoAspect > fa) photoTex.repeat.set(fa / photoAspect, 1); else photoTex.repeat.set(1, photoAspect / fa);
    photoTex.offset.set((1 - photoTex.repeat.x) / 2, (1 - photoTex.repeat.y) / 2);
    bg = photoTex;
  }
  scene.background = S.scene.transparent ? null : bg;
}
function setPhoto(img) {
  photoTex?.dispose();
  photoTex = new THREE.Texture(img); photoTex.colorSpace = THREE.SRGBColorSpace; photoTex.needsUpdate = true;
  photoAspect = img.naturalWidth / img.naturalHeight; photoId++;
  S.scene.photoOn = true; S.scene.meshOn = false;
}
function clearPhoto() { photoTex?.dispose(); photoTex = null; S.scene.photoOn = false; photoId++; }

const tmpQ = new THREE.Quaternion();
function applyCamera() {
  const c = S.camera;
  const az = c.azimuth * D2R, el = c.elevation * D2R;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  camera.position.copy(dir).multiplyScalar(c.distance).add(orbitTarget);
  camera.up.set(0, 1, 0);
  camera.lookAt(orbitTarget);
  camera.rotateZ(c.roll * D2R);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  const pan = right.multiplyScalar(c.panX).add(up.multiplyScalar(c.panY));
  camera.position.add(pan);
  camera.fov = 2 * Math.atan(12 / c.focal) / D2R; // 36x24mm sensor, vertical
  camera.aspect = aspectNow;
  camera.updateProjectionMatrix();
}

function applyBlur() {
  const b = S.blur, u = blurPass.material.uniforms;
  u.uBandOn.value = b.enabled ? 1 : 0;
  u.uMaxBlur.value = b.maxBlur;
  u.uSamples.value = MAX_SAMPLES; // smooth at full quality, and still fast
  // Smart angle: the sharp band turns with the device (Angle Z)
  if (b.smartAngle) b.angle = Math.max(-45, Math.min(45, S.camera.roll));
  u.uFocusX.value = b.focusX ?? 0.5; u.uFocusY.value = b.focusPos; u.uFocusSize.value = b.focusSize; u.uAngle.value = b.angle * D2R;
  u.uTopS.value = b.topStrength; u.uTopZ.value = b.topSize ?? 0; u.uTopF.value = b.topFalloff; u.uTopC.value = b.topCurve;
  u.uBotS.value = b.bottomStrength; u.uBotZ.value = b.bottomSize ?? 0; u.uBotF.value = b.bottomFalloff; u.uBotC.value = b.bottomCurve;
  u.uDofOn.value = b.dof ? 1 : 0;
  u.uDofFocus.value = Math.max(0.05, S.camera.distance + b.dofFocusOffset);
  u.uDofStrength.value = b.dofStrength;
  u.uExposure.value = S.scene.exposure;
  u.uGrain.value = S.scene.grain;
}

const TONES = { None: THREE.NoToneMapping, ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping };
function applyScene() {
  drawBackground();
  buildEnv();
  scene.environmentIntensity = S.scene.envIntensity;
  scene.environmentRotation.y = S.scene.envRotation * D2R;
  scene.backgroundRotation?.set(0, 0, 0);
  key.intensity = S.scene.keyLight;
  renderer.toneMapping = TONES[S.scene.tone] ?? THREE.NoToneMapping;
}

function layout() {
  const stage = document.getElementById('stage').getBoundingClientRect();
  const pad = 24;
  const aw = stage.width - pad * 2, ah = stage.height - pad * 2;
  aspectNow = ASPECTS[S.aspect];
  let w = aw, h = aw / aspectNow;
  if (h > ah) { h = ah; w = ah * aspectNow; }
  frame.style.width = Math.floor(w) + 'px'; frame.style.height = Math.floor(h) + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(Math.floor(w), Math.floor(h), false);
  const bs = renderer.getDrawingBufferSize(new THREE.Vector2());
  blurPass.setSize(bs.x, bs.y);
  dirty = true;
}

function applyAll() {
  if (DEVICES[S.device] && loadedDevice !== S.device && !loading) {
    loadDevice(S.device).then(() => { if (S.device !== loadedDevice) applyAll(); });
  }
  if (aspectNow !== ASPECTS[S.aspect]) layout();
  applyScene(); applyCamera(); applyBlur(); applyScreen();
  dirty = true;
}

// ───────────────────────── render loop / export ─────────────────────────
function renderNow() {
  blurPass.material.uniforms.uTime.value = 0;
  blurPass.render(scene, camera);
}
function tick() {
  if (dirty && currentModel) { dirty = false; renderNow(); }
  requestAnimationFrame(tick);
}

function exportDataURL(width = S.export.width) {
  const W = Math.round(width), H = Math.round(width / ASPECTS[S.aspect]);
  // supersample: render at ss× and downscale, which removes the stair-stepping on edges
  const max = renderer.capabilities.maxTextureSize;
  const ss = Math.max(1, Math.min(S.export.supersample ?? 2, Math.floor(max / Math.max(W, H))));
  const dpr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(W * ss, H * ss, false);
  blurPass.setSize(W * ss, H * ss);
  applyCamera();
  renderNow();
  let src = canvas, sw = W * ss, sh = H * ss;
  while (sw / 2 >= W) { // halve step by step so the box filter averages every sample
    const c = document.createElement('canvas'); c.width = Math.max(W, sw / 2); c.height = Math.max(H, sh / 2);
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height;
  }
  const url = (src === canvas ? canvas : src).toDataURL('image/png');
  renderer.setPixelRatio(dpr);
  layout();
  return url;
}
function downloadPNG() {
  const a = document.createElement('a');
  a.href = exportDataURL(); a.download = `mockup-${S.device}-${Date.now()}.png`; a.click();
}

// ───────────────────────── pane ─────────────────────────
// Cases (when the site API is up) sits on top; below it two tabs: Thing (the device and
// the camera on it) and Skybox (what is behind it and reflects in it).
const pane = new Pane({ container: document.getElementById('pane'), title: 'Mockup Studio' });
const tabs = pane.addTab({ pages: [{ title: 'Thing' }, { title: 'Skybox' }] });
const [thing, sky] = tabs.pages;
const deviceText = (v) => `${v.label}  ·  ${v.shot[0]}×${v.shot[1]}  ·  ${v.ratio}`;

const fDev = thing.addFolder({ title: 'Device' });
fDev.addBinding(S, 'device', { label: 'Model', options: Object.fromEntries(Object.entries(DEVICES).map(([k, v]) => [deviceText(v), k])) });
const aspectBinding = fDev.addBinding(S, 'aspect', { label: 'Aspect', options: Object.fromEntries(Object.keys(ASPECTS).map((k) => [k, k])) });
fDev.addBinding(S.anim, 'enabled', { label: 'Animate' });

const fCam = thing.addFolder({ title: 'Camera' });
fCam.addBinding(S.camera, 'elevation', { label: 'Angle X', min: -89, max: 89, step: 0.5 });
fCam.addBinding(S.camera, 'azimuth', { label: 'Angle Y', min: -180, max: 180, step: 0.5 });
fCam.addBinding(S.camera, 'roll', { label: 'Angle Z', min: -90, max: 90, step: 0.5 });
fCam.addBinding(S.camera, 'focal', { label: 'Lens (mm)', min: 12, max: 300, step: 1 });
fCam.addBinding(S.camera, 'distance', { label: 'Distance', min: 0.25, max: 8, step: 0.01 });
fCam.addBinding(S.camera, 'panX', { label: 'Position X', min: -1.5, max: 1.5, step: 0.005 });
fCam.addBinding(S.camera, 'panY', { label: 'Position Y', min: -1.5, max: 1.5, step: 0.005 });

const fBlur = thing.addFolder({ title: 'Blur' });
fBlur.addBinding(S.blur, 'enabled', { label: 'Enabled' });
fBlur.addBinding(S.blur, 'maxBlur', { label: 'Strength', min: 0, max: 0.2, step: 0.001 });
fBlur.addBinding(S.blur, 'focusSize', { label: 'Size', min: 0, max: 1.5, step: 0.005 });
fBlur.addBinding(S.blur, 'focusX', { label: 'Position X', min: 0, max: 1, step: 0.005 });
fBlur.addBinding(S.blur, 'focusPos', { label: 'Position Y', min: 0, max: 1, step: 0.005 });
const angleBinding = fBlur.addBinding(S.blur, 'angle', { label: 'Angle', min: -45, max: 45, step: 0.25 });
fBlur.addBinding(S.blur, 'smartAngle', { label: 'Smart angle' });
const fTop = fBlur.addFolder({ title: 'Top' });
fTop.addBinding(S.blur, 'topStrength', { label: 'Strength', min: 0, max: 2, step: 0.01 });
fTop.addBinding(S.blur, 'topSize', { label: 'Size', min: -0.5, max: 1, step: 0.005 });
const fBot = fBlur.addFolder({ title: 'Bottom' });
fBot.addBinding(S.blur, 'bottomStrength', { label: 'Strength', min: 0, max: 2, step: 0.01 });
fBot.addBinding(S.blur, 'bottomSize', { label: 'Size', min: -0.5, max: 1, step: 0.005 });
const fDof = fBlur.addFolder({ title: 'Depth of field (3D)', expanded: false });
fDof.addBinding(S.blur, 'dof', { label: 'Enabled' });
fDof.addBinding(S.blur, 'dofFocusOffset', { label: 'Focus offset', min: -2, max: 2, step: 0.005 });
fDof.addBinding(S.blur, 'dofStrength', { label: 'Strength', min: 0, max: 3, step: 0.01 });

const fScr = thing.addFolder({ title: 'Screen', expanded: false });
const loadImageBtn = fScr.addButton({ title: 'Load image…' });
loadImageBtn.on('click', () => fileInput.click());
fScr.addBinding(S.screen, 'align', { label: 'Crop align', options: { Center: 'center', Top: 'top', Bottom: 'bottom' } });
fScr.addBinding(S.screen, 'brightness', { label: 'Brightness', min: 0.3, max: 1.5, step: 0.01 });
fScr.addBinding(S.screen, 'fit', { label: 'Fit', options: { Cover: 'cover', Stretch: 'stretch' } });
fScr.addBinding(S.screen, 'rotate', { label: 'Rotate', options: { '0°': 0, '90°': 90, '180°': 180, '270°': 270 } });
fScr.addBinding(S.screen, 'flipX', { label: 'Flip X' });
fScr.addBinding(S.screen, 'flipY', { label: 'Flip Y' });

const fLight = thing.addFolder({ title: 'Light', expanded: false });
fLight.addBinding(S.scene, 'envIntensity', { label: 'Env light', min: 0, max: 4, step: 0.01 });
fLight.addBinding(S.scene, 'keyLight', { label: 'Key light', min: 0, max: 5, step: 0.01 });
fLight.addBinding(S.scene, 'exposure', { label: 'Exposure', min: 0.2, max: 3, step: 0.01 });
fLight.addBinding(S.scene, 'tone', { label: 'Tone map', options: { None: 'None', ACES: 'ACES', AgX: 'AgX', Neutral: 'Neutral' } });
fLight.addBinding(S.scene, 'grain', { label: 'Grain', min: 0, max: 8, step: 0.1 });

const fExp = thing.addFolder({ title: 'Export' });
fExp.addBinding(S.export, 'width', { label: 'Width px', min: 800, max: 6000, step: 100 });
fExp.addButton({ title: 'Download PNG' }).on('click', downloadPNG);
fExp.addButton({ title: 'Save preset (JSON)' }).on('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  a.download = 'mockup-preset.json'; a.click();
});
fExp.addButton({ title: 'Load preset…' }).on('click', () => presetInput.click());
fExp.addButton({ title: 'Reset all' }).on('click', () => { setState(structuredClone(DEFAULTS)); });

// Skybox, in two parts: the background itself (what you see behind the device) and its
// reflections (how much of it shows up in the glass and aluminium)
const skyUI = {
  get bg() { return S.scene.photoOn && photoTex ? 'photo' : S.scene.meshOn ? 'mesh' : 'plain'; },
  set bg(v) { S.scene.meshOn = v === 'mesh'; S.scene.photoOn = v === 'photo' && !!photoTex; if (v === 'photo' && !photoTex) photoInput.click(); },
  get show() { return !S.scene.transparent; },
  set show(v) { S.scene.transparent = !v; },
  get reflect() { return skyUI.bg === 'photo' ? S.scene.photoReflect : S.scene.meshReflect; },
  set reflect(v) { if (skyUI.bg === 'photo') S.scene.photoReflect = v; else S.scene.meshReflect = v; },
};
const fBg = sky.addFolder({ title: 'Background' });
const bgBinding = fBg.addBinding(skyUI, 'bg', { label: 'Type', options: { 'Mesh gradient': 'mesh', Photo: 'photo', Gradient: 'plain' } });
const showBinding = fBg.addBinding(skyUI, 'show', { label: 'In the render' });
const meshColors = ['Glow 1', 'Glow 2', 'Base 1', 'Base 2'].map((n, i) => fBg.addBinding(S.scene.mesh, i, { label: n, view: 'color' }));
const meshHint = fBg.addBlade({ view: 'text', label: 'Glows', parse: (v) => v, value: 'drag the dots in the preview', disabled: true });
const photoBtns = [
  fBg.addButton({ title: 'Upload photo…' }).on('click', () => photoInput.click()),
  fBg.addButton({ title: 'Remove photo' }).on('click', () => { clearPhoto(); S.scene.meshOn = true; pane.refresh(); syncPane(); applyAll(); }),
];
const plainColors = [fBg.addBinding(S.scene, 'bgTop', { label: 'Top', view: 'color' }), fBg.addBinding(S.scene, 'bgBottom', { label: 'Bottom', view: 'color' })];
const fRefl = sky.addFolder({ title: 'Reflections' });
fRefl.addBinding(skyUI, 'reflect', { label: 'Strength', min: 0, max: 8, step: 0.05 });
fRefl.addBinding(S.scene, 'envRotation', { label: 'Rotate', min: -180, max: 180, step: 1 });

// Glow dots on the preview (Skybox tab, mesh gradient): drag them to move the glows
let skyActive = false;
tabs.on('select', (ev) => { skyActive = ev.index === 1; meshDots.update(); });
const meshDots = (() => {
  const layer = document.createElement('div');
  layer.className = 'mesh-dots';
  const dots = [0, 1].map((i) => {
    const d = document.createElement('div');
    d.className = 'mesh-dot'; d.title = `Glow ${i + 1}: drag to move`;
    d.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      d.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = frame.getBoundingClientRect();
        S.scene.meshPos[i * 2] = Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 100) / 100;
        S.scene.meshPos[i * 2 + 1] = Math.round(Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) * 100) / 100;
        update(); applyAll(); hooks.forEach((h) => h({ target: { key: 'meshPos' } }));
      };
      const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
    });
    layer.appendChild(d);
    return d;
  });
  frame.appendChild(layer);
  function update() {
    layer.style.display = skyActive && S.scene.meshOn && !(S.scene.photoOn && photoTex) ? '' : 'none';
    dots.forEach((d, i) => {
      d.style.left = S.scene.meshPos[i * 2] * 100 + '%';
      d.style.top = S.scene.meshPos[i * 2 + 1] * 100 + '%';
      d.style.background = S.scene.mesh[i];
    });
  }
  return { update };
})();

// show only what applies right now
function syncPane() {
  angleBinding.disabled = !!S.blur.smartAngle;
  const bg = skyUI.bg;
  for (const c of meshColors) c.hidden = bg !== 'mesh';
  meshHint.hidden = bg !== 'mesh';
  for (const c of photoBtns) c.hidden = bg !== 'photo';
  for (const c of plainColors) c.hidden = bg !== 'plain';
  meshDots.update();
}

pane.on('change', (ev) => {
  if (ev.target?.key === 'device' && !programmatic) { S.camera.distance = DEVICES[S.device].distance; quietRefresh(); }
  if (ev.target?.key === 'smartAngle' || ev.target?.key === 'roll') { applyBlur(); quietRefresh(); }
  syncPane();
  applyAll();
  if (!programmatic) hooks.forEach((h) => h(ev));
});
const hooks = []; // anim.js / cases.js listen to edits made in the pane

// ───────────────────────── undo / redo ─────────────────────────
// Cmd/Ctrl+Z undoes the last edit; a run of small changes to the same setting (arrow keys
// in an input, a slider drag, the mouse on the preview) counts as one edit, closed after
// 700 ms without changes. Cmd/Ctrl+Shift+Z (or Ctrl+Y) redoes.
const H = { past: [], future: [], committed: null, burst: false, timer: 0, key: null, restoring: false };
const snapH = () => structuredClone({ device: S.device, aspect: S.aspect, camera: S.camera, blur: S.blur, scene: S.scene, screen: S.screen });
function endBurst() { if (H.burst) { clearTimeout(H.timer); H.burst = false; H.committed = snapH(); } }
function noteEdit(ev) {
  if (H.restoring) return;
  const key = ev?.target?.key ?? null;
  if (H.burst && key !== H.key) endBurst(); // another setting: a new edit
  if (!H.burst) { if (H.committed) H.past.push(H.committed); if (H.past.length > 200) H.past.shift(); H.future.length = 0; H.burst = true; H.key = key; }
  clearTimeout(H.timer);
  H.timer = setTimeout(endBurst, 700);
}
hooks.push(noteEdit);
function resetHistory() { clearTimeout(H.timer); H.burst = false; H.past.length = 0; H.future.length = 0; H.committed = snapH(); }
function stepHistory(from, to) {
  endBurst();
  const st = from.pop(); if (!st) return;
  to.push(snapH());
  H.restoring = true;
  try { setState(st); } finally { H.restoring = false; }
  H.committed = snapH();
  hooks.forEach((h) => h !== noteEdit && h({ target: { key: 'history' } }));
}
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  const redo = (k === 'z' && e.shiftKey) || k === 'y';
  if (k !== 'z' && k !== 'y') return;
  e.preventDefault(); e.stopPropagation();
  document.activeElement?.blur?.();
  if (redo) stepHistory(H.future, H.past); else stepHistory(H.past, H.future);
}, true);

// ───────────────────────── inputs ─────────────────────────
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
fileInput.onchange = () => fileInput.files[0] && loadFile(fileInput.files[0]);
const presetInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
presetInput.onchange = async () => presetInput.files[0] && setState(JSON.parse(await presetInput.files[0].text()));
const photoInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
photoInput.onchange = () => {
  const f = photoInput.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { setPhoto(img); pane.refresh(); syncPane(); applyAll(); };
  img.src = URL.createObjectURL(f);
  photoInput.value = '';
};
function loadFile(f) {
  const url = URL.createObjectURL(f);
  return loadScreenURL(url).then(() => URL.revokeObjectURL(url));
}
const dropEl = document.getElementById('drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('on'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropEl.classList.remove('on'); });
window.addEventListener('drop', (e) => { e.preventDefault(); dropEl.classList.remove('on'); const f = e.dataTransfer.files[0]; f && f.type.startsWith('image/') && loadFile(f); });

// drag = orbit, shift-drag = pan, wheel = distance
let drag = null;
frame.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey }; frame.setPointerCapture(e.pointerId); });
frame.addEventListener('pointerup', () => (drag = null));
frame.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan || e.shiftKey) { S.camera.panX -= dx * 0.002 * S.camera.distance; S.camera.panY += dy * 0.002 * S.camera.distance; }
  else { S.camera.azimuth -= dx * 0.3; S.camera.elevation = Math.max(-89, Math.min(89, S.camera.elevation + dy * 0.3)); }
  quietRefresh(); applyAll(); hooks.forEach((h) => h({ target: { key: 'camera' } }));
});
frame.addEventListener('wheel', (e) => { e.preventDefault(); S.camera.distance = Math.max(0.25, Math.min(8, S.camera.distance * Math.exp(e.deltaY * 0.001))); quietRefresh(); applyAll(); hooks.forEach((h) => h({ target: { key: 'distance' } })); }, { passive: false });
window.addEventListener('resize', layout);

// ───────────────────────── public API (for the AI / scripts) ─────────────────────────
// arrays are filled in place: the pane is bound to the array object itself (mesh colours)
function merge(t, s) {
  for (const k in s) {
    if (Array.isArray(s[k]) && Array.isArray(t[k]) && k !== 'keys') t[k].splice(0, t[k].length, ...s[k]);
    else if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) merge((t[k] ??= {}), s[k]);
    else t[k] = s[k];
  }
  return t;
}
let programmatic = false;
// refresh the pane after a change made in code, without it reporting the change as an edit
function quietRefresh() { const p = programmatic; programmatic = true; try { pane.refresh(); } finally { programmatic = p; } }
function setState(partial) {
  // older saved shots have no smartAngle: smart only if their band already followed the roll
  if (partial?.blur && partial.blur.angle != null && partial.blur.smartAngle == null) {
    partial = structuredClone(partial);
    partial.blur.smartAngle = Math.abs(partial.blur.angle - (partial.camera?.roll ?? S.camera.roll)) < 0.01;
  }
  merge(S, partial); programmatic = true; try { pane.refresh(); syncPane(); } finally { programmatic = false; } applyAll();
  if (!H.burst && !H.restoring) H.committed = snapH();
  return structuredClone(S);
}

window.mockup = {
  getState: () => structuredClone(S),
  setState,
  loadScreen: loadScreenURL,
  loadScreenData: (dataUrl) => loadScreenURL(dataUrl),
  exportPNG: (width) => exportDataURL(width),
  screenAspect: () => screenAspect,
  // resolves once the requested device is loaded (use after setState with a new device)
  settled: async () => { while (loading || loadedDevice !== S.device) await new Promise((r) => setTimeout(r, 30)); applyAll(); },
  devices: () => Object.fromEntries(Object.entries(DEVICES).map(([k, v]) => [k, v.label])),
  ready: null,
  async tryDevice(id, screen, rotation) {
    if (screen) DEVICES[id].screen = screen;
    if (rotation) DEVICES[id].rotation = rotation;
    S.device = id; loadedDevice = null; loading = false;
    await loadDevice(id); pane.refresh(); applyAll();
  },
  inspect() {
    const out = [];
    const box = new THREE.Box3(), size = new THREE.Vector3(), c = new THREE.Vector3();
    currentModel.traverse((n) => {
      if (!n.isMesh) return;
      box.setFromObject(n); box.getSize(size); box.getCenter(c);
      out.push({ name: n.name, mat: n.material?.name, size: size.toArray().map((v) => +v.toFixed(3)), c: c.toArray().map((v) => +v.toFixed(2)), tris: (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3 });
    });
    return out;
  },
};

// ───────────────────────── boot ─────────────────────────
layout();
setScreenImage(placeholderCanvas(), 'placeholder');
const params = new URLSearchParams(location.search);
if (params.get('state')) { try { merge(S, JSON.parse(atob(params.get('state')))); pane.refresh(); } catch (e) { console.warn('bad state param', e); } }
window.mockup.ready = (async () => {
  applyAll();
  while (loadedDevice !== S.device) await new Promise((r) => setTimeout(r, 50));
  if (params.get('screen')) await loadScreenURL(params.get('screen'));
  applyAll();
})();
tick();
// Cases panel (only when the dev server exposes /api/cases)
syncPane();
initAnim({ S, pane, stage: document.getElementById('stage'), canvas, setState, hooks, layout, markDirty: () => (dirty = true) });
if (!params.has('render')) window.mockup.ready.then(() => initCases({ pane, sky, S, DEFAULTS, setState, loadScreenURL, frame, settled: window.mockup.settled, hooks, skyBg: fBg, resetHistory, lockCaseMode: () => {
  // the site draws the case background in CSS, the render stays transparent
  aspectBinding.disabled = true; loadImageBtn.disabled = true; bgBinding.disabled = true;
  showBinding.label = 'In the render'; showBinding.disabled = true;
} }));
