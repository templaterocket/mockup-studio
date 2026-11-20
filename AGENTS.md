# Mockup Studio: guide for AI agents

How to work with this editor: drive it to make a mockup, or change its code. Read this before
touching anything; `README.md` has the user-facing overview.

## What it is

A three.js page (`npm run dev`, http://localhost:5273) that puts a screenshot on a 3D device
(iPhone 16 Pro Max, iPad Pro, Studio Display, Pro Display XDR) and renders it with a camera,
tilt-shift blur, lighting and a background. The same page is driven headlessly by
`render.mjs` to batch-render PNGs. Everything the panel shows is one plain state object `S`.

## Files

| File | What lives there |
|---|---|
| `src/main.js` | State (`DEFAULTS`), renderer, scene, environment and lighting (`buildEnv`), background (`drawBackground`), camera, the panel (Tweakpane), undo, mouse, `window.mockup` API, boot |
| `src/blur.js` | Post pass: tilt-shift band + depth of field, grain, tone mapping (GLSL) |
| `src/anim.js` | Animate timeline: keyframes, smooth curve between them, playback, WebM recording |
| `src/cases.js` | "Cases" panel for the personal site (only when the dev server answers `/api/cases`) |
| `src/devices.js` | Device models: file, rotation, how to find the screen mesh, screenshot size, fixes |
| `src/style.css` | Layout, timeline, dots on the preview, lighting map |
| `vite.config.js` | Dev-server API for the Cases panel (`/api/cases…`), writes the site's files |
| `render.mjs` | Headless batch renderer (Playwright + Chrome) |
| `public/models/*.glb` | Device models (Sketchfab, licences unchecked: see README) |

## Driving the editor (no code changes)

In the browser (or from Playwright) everything goes through `window.mockup`:

```js
await window.mockup.ready;                       // first device loaded
window.mockup.setState({ device: 'studiodisplay', aspect: '16:9',
  camera: { azimuth: -30, elevation: 11, roll: -4, focal: 85, distance: 2.6 } });
await window.mockup.settled();                   // after a device change: wait for the model
await window.mockup.loadScreen('/path/or/url.png');   // or loadScreenData(dataUrl)
const png = window.mockup.exportPNG(2400);       // data URL, supersampled 2×
window.mockup.getState();                        // a copy of S
window.mockup.screenAspect();                    // w/h of the device screen
```

`setState` merges a partial state (nested objects merge, arrays are filled in place) and
refreshes the panel. It does not count as a user edit (no undo step, no keyframe write).

From the command line:

```bash
node render.mjs --out out/shot.png --device iphone16pro --screen ui.png --width 2400 \
  --state '{"camera":{"azimuth":-30,"elevation":14,"focal":85,"distance":2.5}}' [--transparent]
node render.mjs --jobs jobs.json   # [{ screen, out, device, aspect, width, transparent, state }]
```

Every job starts from the defaults, so settings never leak between jobs. The renderer opens
the page with `?render=1`, which leaves out the Cases panel (it would swap in its own screen).

Screenshots fill the screen exactly at these sizes (`shot` in `devices.js`): Studio Display
2560×1419, Pro Display XDR 2560×1459, iPhone 16 Pro Max 1290×2764, iPad Pro 2064×2730. Other
sizes are cover-cropped (`screen.align`: top / center / bottom).

## State reference

Panel label → state key. Keep the keys: saved shots, presets and the site's renders use them.

- **Device**: `device`, `aspect` (`4:3 3:2 16:10 16:9 2:1 1:1 4:5 3:4 9:16`)
- **Camera**: Angle X `camera.elevation`, Angle Y `camera.azimuth`, Angle Z `camera.roll`
  (degrees), Lens `camera.focal` (mm, 36×24 sensor), `camera.distance`, Position X/Y
  `camera.panX/panY`. The camera orbits the centre of the screen, not of the whole device.
- **Blur**: `blur.enabled`, Strength `maxBlur`, Size `focusSize`, Position X/Y `focusX` /
  `focusPos` (0..1, Y from the bottom), `angle`, Smart angle `smartAngle` (band follows
  `camera.roll`, clamped ±45°), Top/Bottom `topStrength/topSize`, `bottomStrength/bottomSize`.
  `top/bottomFalloff`, `top/bottomCurve` still work but are not in the panel. Depth of field:
  `dof`, `dofStrength`, `dofFocusOffset`. Samples are always the maximum.
- **Screen**: `screen.fit` (cover/stretch), `align`, `rotate`, `flipX/flipY`, `brightness`
- **Light** (Thing tab): `scene.envIntensity`, `keyLight`, `exposure`, `tone`, `grain`
- **Skybox → Background**: Show = `!scene.transparent` (in case mode it only hides the CSS
  background in the preview), type: `scene.meshOn` (mesh), `scene.photoOn` (photo, the image
  itself is not in the state), otherwise the plain gradient `bgTop/bgBottom`. Mesh:
  `scene.mesh` = [glow 1, glow 2, base 1, base 2], `scene.meshPos` = [x1, y1, x2, y2] (0..1,
  the dots on the preview); it is drawn exactly like `.mock` on the personal site.
- **Skybox → Lighting**: Background glow `scene.meshReflect` (or `photoReflect` for a photo),
  Rotate `scene.envRotation`, Light gradient `scene.light = { on, strength, points: [{ x, y,
  color, size, power }] }`; x 0..1 goes around the device (0.5 = in front of the screen),
  y 0..1 = top..bottom. Off by default, so older shots render unchanged.
- **Export**: `export.width`, `export.supersample`
- **Animate**: `anim = { enabled, duration, loop, keys: [{ t, state: { camera, blur, screen,
  scene } }] }`. Numbers move along a monotone cubic through all keys (no stop at each key,
  no overshoot); other values switch at the next key. Device and aspect are fixed.

## Personal-site mode (Cases panel)

With the site at `~/DNP/personal-site` (or `CASES_SITE=`), the panel lists every screenshot in
`source-images/mock/<case>/`. Endpoints in `vite.config.js`:

- `GET /api/cases`: the shot plan (`node tools/mock-cases.mjs --plan` in the site) + mesh vars
- `POST /api/cases/save` / `reset` / `hide`: `source-images/mock/shots.json` per shot
- `POST /api/cases/mesh`: the case's `.mesh-<slug>` line in the site's `styles.css`

The render there is always transparent; the site draws the background in CSS. The site then
renders with `node tools/mock-cases.mjs <case>` and builds pages with
`node tools/build-work.mjs`. Never commit or publish the site without its owner's word.

## Changing the code

- **Keep state compatible.** New settings get a default in `DEFAULTS` that reproduces the old
  look. Old states without the key must render the same (see the `smartAngle` fallback in
  `setState`).
- **Panel edits vs code edits.** User edits fire `pane.on('change')` and then `hooks` (undo,
  timeline, cases). Changes made in code go through `setState` or `quietRefresh()`, which set
  `programmatic` so they are not taken for edits. Custom widgets (dots, lighting map) call
  `applyAll()` and then `hooks.forEach((h) => h({ target: { key } }))` themselves.
- **Undo** groups a run of changes to one key within 700 ms; a new key starts a new step.
- **Never recreate a DOM element** that is being dragged: update its style instead.
- **Arrays bound to the panel** (mesh colours) must be changed in place, not replaced.
- **Function order:** `syncPane` touches widgets defined later. Anything that calls
  `quietRefresh` at load time must run after `let programmatic` is declared, at boot.

## Checking a change

1. `npm run dev`, open http://localhost:5273. The console must have no errors (reload with
   Cmd+Shift+R: the browser can keep an old module).
2. Open `?render=1` to see the editor without the Cases panel.
3. Run one batch job and look at the PNG:
   `node render.mjs --out out/check.png --device iphone16pro --width 800`
4. For the site: render a case and check that its saved shots look as before.
