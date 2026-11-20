// rotation: degrees applied to the raw model so that the screen faces +Z and the top of the device is +Y.
// shot: screenshot size in px that fills the screen exactly; ratio: its proportion, rounded.
// screen: how to find the screen mesh ({material} name match, or {mesh} node-name match).
export const DEVICES = {
  iphone16pro: {
    label: 'iPhone 16 Pro Max', shot: [1290, 2764], ratio: '9:19.5',  file: 'iphone16pro.glb', rotation: [0, 90, 0],
    screen: { material: 'screen.001' },
    // Dynamic Island: drop the milky glass the model lays over it, make it glossy black and
    // draw it above the screen (both faces sit at the same depth)
    meshFix: [
      { mesh: 'Cube016_glass002_0', hide: true },
      { mesh: 'Cube016_black002_0', unlit: '#000000', front: true },
    ], distance: 3.2,
    credit: 'iPhone 16 Pro Max by MG990 — sketchfab.com (check license on the Sketchfab page)',
  },
  ipadpro: {
    label: 'iPad Pro', shot: [2064, 2730], ratio: '3:4',  file: 'ipadpro.glb', rotation: [0, 0, 0],
    screen: { material: 'screen' }, hide: [/pencil|Line_Line/i], distance: 3.0,
    credit: 'Apple iPad Pro by DatSketch — sketchfab.com (check license on the Sketchfab page)',
  },
  studiodisplay: {
    label: 'Studio Display', shot: [2560, 1419], ratio: '16:9',  file: 'studiodisplay.glb', rotation: [0, 0, 0],
    screen: { mesh: 'NYVmzMLiovxElXF' },
    aluminium: { color: '#c3c5c9', roughness: 0.36 }, distance: 2.6,
    credit: 'Studio Display by crumhirnd — sketchfab.com',
  },
  proxdr: {
    label: 'Pro Display XDR', shot: [2560, 1459], ratio: '16:9',  file: 'proxdr.glb', rotation: [0, 0, 0],
    screen: { mesh: 'USjagBfuEQpHyxx' },
    aluminium: { color: '#c3c5c9', roughness: 0.36 }, distance: 2.6,
    credit: 'Apple Pro Display XDR by Polyman_3D — sketchfab.com (check license on the Sketchfab page)',
  },
};
