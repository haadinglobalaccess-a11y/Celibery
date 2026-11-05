/**
 * The CELIBERY "studio": a raymarched product stage (two-tier satin pedestal, glossy reflective
 * floor, volumetric key light, orbiting light rings with travelling highlights). It is an
 * environment, not a product — product photos are layered on top as DOM (see Product3DStage) and
 * positioned with the same camera maths, so they sit exactly on the pedestal.
 *
 * Camera and projection live in JS (below) and are passed to the shader as a basis, so the WebGL
 * pixels and the DOM layer always agree.
 */

export type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** World-space dimensions shared by shader and DOM. */
export const STAGE = {
  target: [0, 0.8, 0] as Vec3,
  pedestalTop: 0.22,
  pedestalRadius: 1.28,
  productHeight: 1.75,
  productAspect: 0.8,
  focal: 1.6,
};

export type Camera = { ro: Vec3; fw: Vec3; rt: Vec3; up: Vec3; fl: number };

export function makeCamera(yaw: number, pitch: number, dist: number): Camera {
  const t = STAGE.target;
  const ro: Vec3 = [t[0] + dist * Math.sin(yaw) * Math.cos(pitch), t[1] + dist * Math.sin(pitch), t[2] + dist * Math.cos(yaw) * Math.cos(pitch)];
  const fw = norm(sub(t, ro));
  const rt = norm(cross(fw, [0, 1, 0]));
  const up = cross(rt, fw);
  return { ro, fw, rt, up, fl: STAGE.focal };
}

/** Projects a world point to "uv" units (screen height = 1, origin at the principal point). */
export function projectUv(cam: Camera, p: Vec3): [number, number] {
  const v = sub(p, cam.ro);
  const z = dot(v, cam.fw);
  return [(dot(v, cam.rt) * cam.fl) / z, (dot(v, cam.up) * cam.fl) / z];
}

export const STUDIO_FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uRo, uFw, uRt, uUp;
uniform float uFl;
uniform vec2 uOff;
uniform vec3 uAccent;
uniform float uIntro;
uniform vec2 uFoot;   // product footprint half-size (x, z) for contact shadow
// Opening sequence ("The future is here") — all 0 when the hero is at rest
uniform float uPortal;     // portal aperture 0..1
uniform float uPortalFade; // portal visibility 0..1
uniform float uFlash;      // emergence / reveal flash
uniform float uShock;      // shockwave progress 0..1 (0 = none)

#ifdef LITE
#define STEPS 44
#define RSTEPS 14
#else
#define STEPS 80
#define RSTEPS 30
#endif

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sdRoundCyl(vec3 p, float r, float h, float rb){
  vec2 d = vec2(length(p.xz) - r + rb, abs(p.y) - h + rb);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb;
}
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }

float pedestal(vec3 p){
  float a = sdRoundCyl(p - vec3(0.0, 0.12, 0.0), 1.0, 0.10, 0.045);
  float b = sdRoundCyl(p - vec3(0.0, 0.026, 0.0), 1.28, 0.026, 0.02);
  return min(a, b);
}
// Light rings: returns distance; 'g' receives the travelling-highlight weight
float ringA(vec3 p, out float g){
  vec3 q = p - vec3(0.0, 1.0, 0.0);
  q.yz = rot(1.22) * q.yz; q.xy = rot(0.32) * q.xy;
  g = pow(0.5 + 0.5 * cos(atan(q.z, q.x) - uTime * 0.55), 18.0);
  return sdTorus(q, vec2(1.66, 0.005));
}
float ringB(vec3 p, out float g){
  vec3 q = p - vec3(0.0, 1.08, 0.0);
  q.yz = rot(1.4) * q.yz; q.xy = rot(-0.46) * q.xy;
  g = pow(0.5 + 0.5 * cos(atan(q.z, q.x) + uTime * 0.38 + 2.0), 26.0);
  return sdTorus(q, vec2(1.92, 0.004));
}
float rimRing(vec3 p){ return sdTorus(p - vec3(0.0, 0.222, 0.0), vec2(0.958, 0.006)); }

vec3 pedNormal(vec3 p){
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(pedestal(p + e.xyy) - pedestal(p - e.xyy), pedestal(p + e.yxy) - pedestal(p - e.yxy), pedestal(p + e.yyx) - pedestal(p - e.yyx)));
}

const vec3 LIGHT = vec3(0.0, 4.6, 0.9);

vec3 background(vec3 rd){
  vec3 c = mix(vec3(0.0012, 0.0012, 0.0015), vec3(0.0055, 0.0058, 0.0075), smoothstep(-0.05, 0.6, rd.y));
  c += uAccent * 0.045 * exp(-pow(rd.y - 0.04, 2.0) * 50.0) * uIntro;   // accent haze on the horizon
  return c;
}

// Volumetric key-light cone (analytic closest approach to the beam axis)
float beam(vec3 ro, vec3 rd, float tMax){
  vec2 d = rd.xz; vec2 o = ro.xz - LIGHT.xz * 0.15;
  float tt = clamp(-dot(o, d) / max(dot(d, d), 1e-4), 0.0, tMax);
  vec3 q = ro + rd * tt;
  float r = 0.32 + (LIGHT.y - q.y) * 0.26;
  float dist = length(q.xz - LIGHT.xz * 0.15);
  return exp(-pow(dist / r, 2.0) * 2.2) * smoothstep(-0.1, 0.9, q.y) * smoothstep(4.6, 2.2, q.y);
}

// March pedestal + accumulate ring glow. Returns hit distance (or -1); glow in 'glow'.
float march(vec3 ro, vec3 rd, float tMax, int steps, out vec3 glow){
  float t = 0.02; glow = vec3(0.0); float hit = -1.0;
  for (int i = 0; i < STEPS; i++){
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float ga, gb;
    float dp = pedestal(p);
    float da = ringA(p, ga);
    float db = ringB(p, gb);
    float dr = rimRing(p);
    float stepLen = min(dp, max(min(min(da, db), dr), 0.02));
    glow += (uAccent * (0.35 + ga * 3.5) + vec3(0.9) * ga * 1.6) * exp(-da * 70.0) * stepLen * 9.0;
    glow += (mix(uAccent, vec3(1.0), 0.6) * (0.25 + gb * 3.0)) * exp(-db * 80.0) * stepLen * 7.0;
    glow += uAccent * exp(-dr * 90.0) * stepLen * 14.0;
    if (dp < 0.0012){ hit = t; break; }
    t += stepLen;
    if (t > tMax) break;
  }
  return hit;
}

vec3 shadePedestal(vec3 p, vec3 rd){
  vec3 n = pedNormal(p);
  vec3 L = normalize(LIGHT - p);
  float spot = smoothstep(0.55, 0.95, dot(-L, normalize(vec3(0.0, -1.0, -0.15))));
  float dif = max(dot(n, L), 0.0) * (0.25 + 0.75 * spot);
  float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 60.0) * spot;
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
  vec3 base = vec3(0.016, 0.017, 0.02);
  float top = smoothstep(0.85, 0.98, n.y);
  base += top * vec3(0.006) * smoothstep(1.0, 0.2, length(p.xz));   // soft satin falloff toward the edge
  // Contact shadow of the product standing on the pedestal
  vec2 f = max(abs(p.xz) - uFoot, 0.0);
  float occ = top * exp(-length(f) * 7.0) * 0.75;
  vec3 c = base * (0.25 + dif * 1.6) + vec3(0.85) * spec * 0.55 + uAccent * fres * 0.12 * uIntro;
  return c * (1.0 - occ);
}

vec3 shadeFloor(vec3 p, vec3 rd, float t){
  vec3 c = vec3(0.0018, 0.0018, 0.0022);
  float r = length(p.xz);
  c += vec3(0.032, 0.032, 0.036) * exp(-pow(length(p.xz - vec2(0.0, 0.25)), 2.0) * 0.5) * uIntro;   // light pool
  c *= mix(0.15, 1.0, smoothstep(1.15, 2.2, r));                                                   // pedestal shadow
  float sweepX = sin(uTime * 0.27) * 3.2;
  c += vec3(0.03) * exp(-pow(p.x - sweepX - p.z * 0.45, 2.0) * 1.6) * exp(-r * 0.3) * uIntro;    // moving light sweep
  // Glossy reflection
  vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
  vec3 rg;
  float rh = march(p + vec3(0.0, 0.002, 0.0), rr, 6.0, RSTEPS, rg);
  vec3 refl = rh > 0.0 ? shadePedestal(p + rr * rh, rr) : background(rr) * 0.6;
  refl += rg * 0.8;
  float fres = 0.05 + 0.6 * pow(1.0 - abs(rd.y), 5.0);
  c += refl * fres * exp(-t * 0.05);
  // Shockwave ripple travelling across the floor
  if (uShock > 0.0 && uShock < 1.0) c += uAccent * exp(-abs(r - uShock * 6.5) * 5.0) * (1.0 - uShock) * 0.5;
  return c;
}

// Dimensional portal: an energy disc in the plane z = 0, centred where the product will stand,
// with a turbulent swirl, outward energy waves, a bright rim, a volumetric halo, flash and shockwave.
const vec3 PC = vec3(0.0, 1.1, 0.0);
vec3 portal(vec3 ro, vec3 rd, float tHit){
  vec3 c = vec3(0.0);
  if (uPortalFade + uFlash + uShock <= 0.001) return c;
  if (uPortalFade > 0.001 && abs(rd.z) > 1e-3){
    float t = -ro.z / rd.z;
    if (t > 0.0 && t < tHit + 0.6){
      vec2 q = (ro + rd * t).xy - PC.xy;
      float r = length(q);
      float R = 1.05 * uPortal + 0.001;
      float a = atan(q.y, q.x);
      float rim = exp(-abs(r - R) * 34.0) * (0.65 + 0.35 * sin(a * 7.0 + uTime * 4.0));
      float inside = smoothstep(R, R * 0.82, r);
      float sw = noise(vec2(a * 2.0 + r * 5.0 - uTime * 2.4, r * 3.0 - uTime * 1.1));
      sw = sw * 0.6 + 0.4 * noise(vec2(a * 5.0 - uTime * 3.0 + r * 9.0, uTime * 0.6));
      float waves = 0.5 + 0.5 * sin(r * 24.0 / max(R, 0.2) - uTime * 9.0);
      float core = exp(-r * r * 7.0 / (R * R + 0.01));
      c += (uAccent * (rim * 2.6 + inside * (sw * 1.1 + waves * 0.3) * 0.8) + vec3(1.0) * (rim * 0.55 + core * inside * 0.8)) * uPortalFade;
    }
  }
  vec3 w = PC - ro;
  float tc = max(dot(w, rd), 0.0);
  float d = length(w - rd * tc);
  c += uAccent * exp(-d * d * 1.5) * 0.4 * uPortalFade * uPortal;
  c += mix(uAccent, vec3(1.0), 0.6) * exp(-d * d * 0.9) * uFlash * 2.4;
  if (uShock > 0.0 && uShock < 1.0) c += mix(uAccent, vec3(1.0), 0.4) * exp(-abs(d - uShock * 5.0) * 9.0) * (1.0 - uShock) * 1.5;
  return c;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y - uOff;
  vec3 rd = normalize(uv.x * uRt + uv.y * uUp + uFl * uFw);
  vec3 ro = uRo;
  float tFloor = rd.y < 0.0 ? -ro.y / rd.y : 40.0;
  vec3 glow;
  float tMax = min(tFloor, 16.0);
  float h = march(ro, rd, tMax, STEPS, glow);
  vec3 col;
  float tHit;
  if (h > 0.0){ col = shadePedestal(ro + rd * h, rd); tHit = h; }
  else if (rd.y < 0.0){ tHit = tFloor; col = shadeFloor(ro + rd * tFloor, rd, tFloor); col = mix(col, background(rd), 1.0 - exp(-tFloor * 0.07)); }
  else { tHit = 40.0; col = background(rd); }
  col += glow * uIntro;
  col += portal(ro, rd, tHit);
  col += mix(vec3(1.0), uAccent, 0.35) * beam(ro, rd, tHit) * 0.045 * uIntro;
  // Filmic tone map, gamma, vignette, dither (prevents banding in the dark gradients)
  col = 1.0 - exp(-col * 1.45);
  col = pow(col, vec3(0.4545));
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.18);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Parses #rgb/#rrggbb (Admin → Brand accent) into linear-ish 0..1 floats. */
export function accentRgb(css: string): Vec3 {
  const m = css.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [0.15, 0.39, 0.92];
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
