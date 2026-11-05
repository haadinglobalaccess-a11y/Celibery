/**
 * "THE FUTURE IS HERE" — timeline of the hero's opening sequence.
 *
 * One clock drives everything: the WebGL uniforms (portal, flash, shockwave, particles, camera
 * push) and the DOM product layer (emergence, exploded view, wireframe, rebuild, glint). The clock
 * only advances on rendered frames, so if the hero scrolls off screen or the tab is hidden the whole
 * sequence pauses in sync and resumes where it was.
 *
 *  0.0 – 2.4  1. Dimensional portal opening   (camera push, inflowing particles, energy waves)
 *  2.3 – 3.9  2. Product emergence            (flash, shockwave, particle burst, product through portal)
 *  4.0 – 6.5  3. Mechanical transformation    (photo panel splits into components that float and snap back)
 *  6.8 – 9.7  4. Digital reconstruction       (wireframe, disintegration into particles, morph, rebuild)
 *  9.6 – 10.4 Final reveal                     (glint, pulse) → resting hero
 *
 * The heading, copy and CTAs are never delayed: they render and stay usable from the first frame.
 */
export const INTRO_DURATION = 10.4;
export const TILE_COLS = 3;
export const TILE_ROWS = 4;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Progress of t through [a, b], clamped to 0..1. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x * x;
/** Overshooting ease — used for the magnetic "snap" when components reassemble. */
const backOut = (x: number) => {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const pulse = (t: number, at: number, width: number) => Math.exp(-Math.pow((t - at) / width, 2));

export type IntroPhase = 'portal' | 'emerge' | 'mech' | 'digital' | 'reveal' | 'done';

export type IntroState = {
  phase: IntroPhase;
  /** Camera distance multiplier (cinematic push-in). */
  cam: number;
  /** Studio light level 0..1. */
  light: number;
  portal: number;
  portalFade: number;
  flash: number;
  shock: number;
  /** Product coming through the portal 0..1. */
  emerge: number;
  /** Thickness layers pulling apart 0..1. */
  sep: number;
  tilesOp: number;
  faceOp: number;
  edgeOp: number;
  wireOp: number;
  scan: number;
  reveal: number;
  scanOp: number;
  glint: number;
  glow: number;
  // particle pass
  wA: number;
  tA: number;
  wB: number;
  tB: number;
  wD: number;
  d1: number;
  d2: number;
  dT: number;
};

/** Exploded-view amount for one component (staggered so the panel opens like a mechanism). */
export function tileExplode(t: number, index: number, count: number): number {
  const d = index * 0.03;
  const back = (count - 1 - index) * 0.025;
  if (t < 4.0 + d) return 0;
  if (t < 4.95 + d) return easeOut(seg(t, 4.0 + d, 4.95 + d));
  if (t < 5.6 + back) return 1 + 0.05 * Math.sin((t - 4.95 - d) * 5);
  return 1 - backOut(seg(t, 5.6 + back, 6.35 + back));
}

export function introState(t: number): IntroState {
  const done = t >= INTRO_DURATION;
  const phase: IntroPhase = done ? 'done' : t < 2.35 ? 'portal' : t < 4 ? 'emerge' : t < 6.6 ? 'mech' : t < 9.6 ? 'digital' : 'reveal';

  // 1. Portal
  const portalOpen = easeOut(seg(t, 0.2, 1.7)) * (1 - easeIn(seg(t, 2.9, 3.5)));
  const portalFade = seg(t, 0, 0.4) * (1 - seg(t, 3.0, 3.6));
  const cam = 1 + 1.1 * (1 - easeInOut(seg(t, 0, 2.6))) - 0.07 * Math.sin(Math.PI * seg(t, 2.3, 3.9)) - 0.06 * Math.sin(Math.PI * seg(t, 7.2, 9.8));
  const light = t < 2.3 ? 0.18 + 0.27 * seg(t, 0, 2.2) : 0.45 + 0.55 * easeOut(seg(t, 2.3, 3.2));

  // 2. Emergence (+ snap flash at the end of 3, final pulse at the reveal)
  const flash = 0.55 * pulse(t, 2.35, 0.14) + 0.12 * pulse(t, 6.42, 0.1) + 0.2 * pulse(t, 9.65, 0.18);
  const shock = t >= 2.35 && t < 3.35 ? seg(t, 2.35, 3.35) : t >= 9.6 && t < 10.4 ? seg(t, 9.6, 10.4) : 0;
  const emerge = easeOut(seg(t, 2.4, 3.7));

  // 3. Mechanical transformation
  const mech = t >= 4.0 && t < 6.45;
  const sep = t < 4.95 ? easeOut(seg(t, 4.0, 4.9)) : t < 5.6 ? 1 : 1 - backOut(seg(t, 5.6, 6.35));

  // 4. Digital reconstruction
  const wireOp = seg(t, 6.8, 7.1) * (1 - seg(t, 9.3, 9.7));
  const faceOp = mech ? 0 : t < 7.1 ? 1 : t < 9.0 ? 1 - seg(t, 7.1, 7.6) : 1;
  const edgeOp = t < 7.1 ? 1 : t < 9.0 ? 1 - seg(t, 7.1, 7.5) : seg(t, 9.3, 9.7);
  const reveal = t < 9.0 ? 1 : easeInOut(seg(t, 9.0, 9.6));
  const scanOp = seg(t, 9.0, 9.08) * (1 - seg(t, 9.55, 9.7));
  const scan = t >= 6.8 && t < 9.0 ? ((t - 6.8) / 0.9) % 1 : 0;
  const glint = seg(t, 9.55, 10.3);

  return {
    phase,
    cam,
    light,
    portal: portalOpen,
    portalFade,
    flash,
    shock,
    emerge,
    sep: mech ? sep : 0,
    tilesOp: mech ? 1 : 0,
    faceOp,
    edgeOp,
    wireOp,
    scan,
    reveal,
    scanOp,
    glint,
    glow: Math.sin(Math.PI * glint),
    wA: t < 2.35 ? seg(t, 0.1, 0.6) : 0,
    tA: t,
    wB: t >= 2.35 && t < 3.9 ? 1 : 0,
    tB: t - 2.35,
    wD: t >= 7.2 ? seg(t, 7.2, 7.5) * (1 - seg(t, 9.3, 9.7)) : 0,
    d1: easeInOut(seg(t, 7.3, 8.3)),
    d2: easeInOut(seg(t, 8.4, 9.3)),
    dT: Math.max(0, t - 7.2),
  };
}

/** The resting state (also used when the sequence is skipped). */
export const RESTING: IntroState = introState(INTRO_DURATION);

export { claimIntro } from './introFlag';

/** Particle pass: portal inflow, emergence burst, and the disintegrate → morph → rebuild cloud. */
export const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uRo, uFw, uRt, uUp;
uniform float uFl;
uniform vec2 uOff;
uniform float uWA, uTA, uWB, uTB, uWD, uD1, uD2, uDT;
uniform vec2 uSlab;
varying float vA;
varying float vM;
const vec3 PC = vec3(0.0, 1.1, 0.0);

vec3 portalFlow(out float a){
  float k = fract(aSeed.z + uTA * (0.32 + aSeed.w * 0.3));
  float ang = aSeed.x * 6.2831 + uTA * (1.1 + aSeed.y * 1.6) + k * 3.0;
  float r = mix(2.9, 0.04, k * k);
  a = smoothstep(0.0, 0.18, k) * smoothstep(1.0, 0.82, k);
  return PC + vec3(cos(ang) * r, sin(ang) * r * 0.92, (aSeed.w - 0.5) * 0.7 * (1.0 - k));
}
vec3 burst(out float a){
  vec3 dir = normalize(vec3(aSeed.x - 0.5, aSeed.y - 0.5, (aSeed.z - 0.5) * 0.8) + 1e-4);
  float sp = 1.2 + aSeed.w * 3.2;
  float e = 1.0 - exp(-uTB * 2.8);
  a = 1.0 - smoothstep(0.25, 1.5, uTB);
  return PC + dir * sp * e + vec3(0.0, -0.35 * uTB * uTB, 0.0);
}
vec3 recon(out float a, out float m){
  vec3 slab = vec3((aSeed.x - 0.5) * 2.0 * uSlab.x, 0.22 + aSeed.y * uSlab.y, (aSeed.z - 0.5) * 0.03);
  float th = aSeed.x * 6.2831 + uDT * 0.9;
  float ph = acos(2.0 * aSeed.y - 1.0);
  vec3 sph = PC + vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)) * (0.82 + 0.08 * sin(uDT * 3.0 + aSeed.z * 6.0));
  vec3 n = vec3(sin(aSeed.z * 40.0 + uDT * 2.0), cos(aSeed.w * 37.0 + uDT * 1.7), sin(aSeed.x * 31.0 + uDT * 2.3)) * 0.22;
  m = uD1 * (1.0 - uD2);
  a = 1.0;
  return mix(slab, sph, m) + n * sin(3.14159 * m);
}
void main(){
  vec3 p; float a; float m = 0.0;
  if (uWA > 0.0) { p = portalFlow(a); a *= uWA; }
  else if (uWB > 0.0) { p = burst(a); a *= uWB; }
  else { p = recon(a, m); a *= uWD; }
  vA = a; vM = m;
  vec3 v = p - uRo;
  float z = max(dot(v, uFw), 0.05);
  vec2 uv = vec2(dot(v, uRt), dot(v, uUp)) * uFl / z + uOff;
  gl_Position = vec4(uv.x * 2.0 * uRes.y / uRes.x, uv.y * 2.0, 0.0, 1.0);
  gl_PointSize = clamp((0.018 + aSeed.w * 0.018) * uFl * uRes.y / z, 1.0, 7.0);
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec3 uAccent;
varying float vA;
varying float vM;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float s = exp(-d * 14.0);
  gl_FragColor = vec4(mix(uAccent, vec3(1.0), 0.5 + 0.3 * vM) * s, s * vA);
}
`;
