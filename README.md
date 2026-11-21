# Mockup Studio

Web editor + headless renderer for Dribbble-style device mockups: close-up camera, lens control,
tilt-shift blur (independent top / bottom) and optional true depth-of-field.

## Run the editor
    npm run dev          # http://localhost:5273  (drag & drop a screenshot onto the page)
Mouse: drag = orbit, shift+drag = pan, wheel = distance.

## Render from the CLI (for an AI agent)
    node render.mjs --out out/shot.png --device iphone16pro --screen ui.png --width 2400 \
      --state '{"camera":{"azimuth":-30,"elevation":14,"focal":70,"distance":1.6},
                "blur":{"focusPos":0.5,"focusSize":0.2,"topStrength":1,"bottomStrength":1.2,"maxBlur":0.07}}'
Devices: iphone16pro, ipadpro, studiodisplay, proxdr. Presets saved from the editor ("Save preset")
can be passed via `--config preset.json`. In the browser the same API lives at `window.mockup`
(`setState`, `getState`, `loadScreen`, `exportPNG`).

## State reference (all keys optional)
- camera: azimuth, elevation, roll (deg) · focal (mm, 36x24 sensor) · distance (device-heights) · panX, panY
- blur: enabled, maxBlur (Strength, fraction of frame height), focusSize (Size), focusX / focusPos
  (Position X / Y, 0..1, Y from the bottom), angle, smartAngle (angle follows camera.roll),
  topStrength/topSize, bottomStrength/bottomSize (topFalloff/topCurve, bottomFalloff/bottomCurve
  are kept but not in the panel), dof, dofFocusOffset, dofStrength
- scene: transparent, meshOn, mesh [glow 1, glow 2, base 1, base 2], meshPos [x1, y1, x2, y2],
  meshReflect, photoOn, photoReflect, bgTop, bgBottom, envIntensity, envRotation, keyLight,
  exposure, tone, grain
- anim: enabled, duration, loop, keys [{ t, state }]
- screen: fit (cover|stretch), rotate, flipX, flipY, brightness · aspect: 4:3 | 3:2 | 16:9 | 1:1 | 4:5 | 3:4 | 9:16

Models live in `public/models/` (Sketchfab, see `src/devices.js` for credits). Check each
model's license on its Sketchfab page before publishing renders or making this repo public.

## Transparent background + brand mesh

`--transparent` (or `scene.transparent: true`) exports RGBA with the blur applied to the alpha edge,
so the background can live in CSS. `scene.meshOn` + `scene.mesh` (4 hex colours) + `scene.meshReflect`
feed brand-coloured panels into the environment, so the colours show up as reflections on the device.
Aspect `16:10` is available.

## Cases panel (personal site)

With `npm run dev`, the "Cases (personal site)" folder lists every screenshot in
`~/DNP/personal-site/source-images/mock/<case>/` (override with `CASES_SITE=`). Pick a project
and screen (‹ › beside the list, or Alt+←/→), tune, then "Save this shot" (Cmd+S); "Revert"
shows up next to it while there are unsaved changes, "✓ Saved" when there are none. Settings go
to `source-images/mock/shots.json`; `node tools/mock-cases.mjs` in the site renders saved shots
with them and the rest with presets. The frame shows the case's CSS mesh behind the transparent
render; on the Skybox tab its colours can be changed and saved into the site's `styles.css`
("Save background to case"; reflections need a re-render). A shot's aspect starts from the slot it
fills on the case page; if you change it, the page crops the image to the slot (object-fit: cover). The batch renderer opens the page with
`?render=1`, which leaves the Cases panel out.

## Tabs

- **Thing**: device (with the screenshot size that fills its screen), Animate, camera
  (Angle X/Y/Z = pitch/yaw/roll, Position X/Y = pan), blur (Strength, Size, Position X/Y,
  Angle or Smart angle that follows Angle Z, Top/Bottom strength and size), screen, light, export.
- **Skybox**, in two parts.
  - *Background*: Show (off = transparent PNG; in case mode, where the site draws the
    background in CSS and the render is always transparent, it hides it in the preview), type
    (mesh gradient, photo or gradient), its colours; the two mesh glows are moved by dragging
    their dots on the preview (saved to the case as `--p1`/`--p2`).
  - *Lighting*: Background glow (how strongly the background's colours reflect on the device),
    Rotate, and a Light gradient (`scene.light`) that can be switched off: a map around the
    device (back · left · front · right · back). Click it to add a point, drag to move,
    double-click to delete; the selected point has colour, size and power.
- **Undo**: Cmd/Ctrl+Z, redo Cmd/Ctrl+Shift+Z. A run of quick changes to one setting (arrow
  keys, a slider drag, a mouse drag on the preview) is one step; undo stays within one case screen.
- **Animate** (`src/anim.js`): a timeline under the stage. "＋ Key" stores the Thing settings at
  the playhead; edits go into the selected keyframe; numbers are eased between keyframes.
  Space plays, "● Record" plays once and downloads a WebM of the preview. Delete removes the
  selected keyframe. A video on the screen (Screen → Load image or video…, or drop a .webm /
  .mp4 / .mov) plays along with the timeline.
- **Preview**: drag to rotate, shift-drag to move, wheel for distance; the scrollbars on its
  edges move it too, F (or the button top right) shows it full screen, Esc goes back.
