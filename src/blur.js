import * as THREE from 'three';

// Fullscreen post pass: tilt-shift style gradient blur (independent top / bottom)
// combined with optional depth-based DOF. Single-pass golden-angle disc gather.
export const MAX_SAMPLES = 128;

const vert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uAspect;
uniform float uMaxBlur;
uniform float uBandOn;
uniform float uFocusX, uFocusY, uFocusSize, uAngle, uTopZ, uBotZ;
uniform float uTopS, uTopF, uTopC, uBotS, uBotF, uBotC;
uniform float uDofOn, uDofFocus, uDofStrength, uNear, uFar;
uniform int uSamples;
uniform float uExposure, uGrain, uTime;

float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float viewZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }

void main(){
  vec2 p = vUv - 0.5; p.x *= uAspect;
  float ca = cos(uAngle), sa = sin(uAngle);
  // the sharp band passes through (uFocusX, uFocusY); at uFocusX = 0.5 this is the old formula
  float yy = (-sa * (p.x - (uFocusX - 0.5) * uAspect) + ca * p.y) - (uFocusY - 0.5);
  float half_ = uFocusSize * 0.5;
  float r = 0.0;
  if (uBandOn > 0.5) {
    float t = clamp((yy - half_ - uTopZ) / max(uTopF, 1e-4), 0.0, 1.0);
    float b = clamp((-yy - half_ - uBotZ) / max(uBotF, 1e-4), 0.0, 1.0);
    r = max(pow(t, uTopC) * uTopS, pow(b, uBotC) * uBotS);
  }
  if (uDofOn > 0.5) {
    float z = viewZ(texture2D(tDepth, vUv).x);
    float coc = uDofStrength * abs(z - uDofFocus) / max(z, 1e-3);
    r = max(r, clamp(coc, 0.0, 1.0));
  }
  float radius = r * uMaxBlur;
  vec4 col;
  if (radius < 1e-5) {
    col = texture2D(tColor, vUv);
  } else {
    vec2 rad = vec2(radius / uAspect, radius);
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    vec4 acc = vec4(0.0);
    float n = float(uSamples);
    for (int i = 0; i < ${MAX_SAMPLES}; i++) {
      if (i >= uSamples) break;
      float fi = float(i);
      float th = fi * 2.3999632 + rot;
      float rr = sqrt((fi + 0.5) / n);
      acc += texture2D(tColor, vUv + vec2(cos(th), sin(th)) * rr * rad);
    }
    col = acc / n;
  }
  // target holds premultiplied colour; unpremultiply for tone/colour-space, re-premultiply on output
  float a = col.a;
  vec3 c = a > 1e-4 ? col.rgb / a : vec3(0.0);
  c *= uExposure;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (ign(gl_FragCoord.xy + uTime) - 0.5) * uGrain / 255.0;
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}
`;

export class BlurPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthTexture: new THREE.DepthTexture(4, 4),
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uAspect: { value: 1 }, uMaxBlur: { value: 0.05 }, uBandOn: { value: 1 },
        uFocusX: { value: 0.5 }, uFocusY: { value: 0.5 }, uFocusSize: { value: 0.3 }, uAngle: { value: 0 }, uTopZ: { value: 0 }, uBotZ: { value: 0 },
        uTopS: { value: 1 }, uTopF: { value: 0.4 }, uTopC: { value: 1.5 },
        uBotS: { value: 1 }, uBotF: { value: 0.4 }, uBotC: { value: 1.5 },
        uDofOn: { value: 0 }, uDofFocus: { value: 2 }, uDofStrength: { value: 0.5 },
        uNear: { value: 0.05 }, uFar: { value: 50 },
        uSamples: { value: 64 }, uExposure: { value: 1 }, uGrain: { value: 1.5 }, uTime: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.Camera();
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.material.uniforms.uAspect.value = w / h;
  }

  render(scene, camera) {
    const r = this.renderer;
    const u = this.material.uniforms;
    u.tColor.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
