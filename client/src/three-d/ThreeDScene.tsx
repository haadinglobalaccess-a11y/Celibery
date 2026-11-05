import { useEffect, useRef } from 'react';

export type UniformSetter = (name: string, ...values: number[]) => void;
export type FrameInfo = { time: number; width: number; height: number; cssWidth: number; cssHeight: number };
/** Optional additive particle pass (gl.POINTS), drawn after the full-screen scene. Each particle has one
 *  random `aSeed` vec4; all motion is computed in the vertex shader from uniforms (no per-frame uploads). */
export type PointsPass = { vertex: string; fragment: string; count: number };

/**
 * Minimal, dependency-free WebGL host for a full-screen fragment-shader scene.
 *
 * Why not Three.js here: the scene is a single raymarched studio (one draw call, no meshes or
 * textures), so a 3 KB host does the job without adding ~600 KB of library to the storefront.
 * When real GLB product models arrive, Three.js / React Three Fiber can be added for that stage only
 * (see docs/3D-EXPERIENCE.md).
 *
 * Performance & safety:
 *  - renders only while on screen (IntersectionObserver) and while the tab is visible;
 *  - adaptive resolution: the canvas renders below CSS size and steps quality down when frames are slow;
 *  - `lite` caps at 30 fps and a low resolution (phones, low-power devices);
 *  - handles context loss, compile failure and unmount (GPU resources released) — `onFail` lets the
 *    parent switch to its CSS fallback.
 */
export function ThreeDScene({
  fragment,
  level,
  className = '',
  onFrame,
  onFail,
  onReady,
  points,
}: {
  fragment: string;
  points?: PointsPass;
  level: 'full' | 'lite';
  className?: string;
  /** Set uniforms for the frame (applied to every program that declares them). Return true to draw the particle pass. */
  onFrame?: (set: UniformSetter, info: FrameInfo) => boolean | void;
  onFail?: () => void;
  onReady?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest callbacks without restarting the GL context on every render.
  const cb = useRef({ onFrame, onFail, onReady });
  cb.current = { onFrame, onFail, onReady };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas per mount: a context released on unmount can never be handed back by
    // getContext() on the same element (matters for React StrictMode's double mount in dev).
    const canvas = document.createElement('canvas');
    canvas.className = 'three-scene__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: level === 'full' ? 'high-performance' : 'low-power', preserveDrawingBuffer: false });
    if (!gl) {
      canvas.remove();
      cb.current.onFail?.();
      return () => undefined;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[ThreeDScene] shader compile failed', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
    const fs = compile(gl.FRAGMENT_SHADER, (level === 'lite' ? '#define LITE 1\n' : '') + fragment);
    const prog = gl.createProgram()!;
    const abort = () => {
      gl.deleteProgram(prog);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      cb.current.onFail?.();
      return () => undefined;
    };
    if (!vs || !fs) return abort();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[ThreeDScene] link failed', gl.getProgramInfoLog(prog));
      return abort();
    }
    // Optional particle program
    let pProg: WebGLProgram | null = null;
    let pBuf: WebGLBuffer | null = null;
    let pVs: WebGLShader | null = null;
    let pFs: WebGLShader | null = null;
    const pCount = points ? Math.max(0, Math.round(points.count)) : 0;
    if (points && pCount) {
      pVs = compile(gl.VERTEX_SHADER, points.vertex);
      pFs = compile(gl.FRAGMENT_SHADER, points.fragment);
      if (pVs && pFs) {
        pProg = gl.createProgram()!;
        gl.attachShader(pProg, pVs);
        gl.attachShader(pProg, pFs);
        gl.linkProgram(pProg);
        if (!gl.getProgramParameter(pProg, gl.LINK_STATUS)) {
          console.warn('[ThreeDScene] particle link failed', gl.getProgramInfoLog(pProg));
          gl.deleteProgram(pProg);
          pProg = null; // the scene still runs, just without particles
        } else {
          const seeds = new Float32Array(pCount * 4);
          for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
          pBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
          gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
        }
      }
    }
    const pLoc = pProg ? gl.getAttribLocation(pProg, 'aSeed') : -1;

    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const programs = [prog, ...(pProg ? [pProg] : [])];
    const locs = programs.map(() => new Map<string, WebGLUniformLocation | null>());
    let current: WebGLProgram | null = prog;
    const use = (pr: WebGLProgram) => {
      if (current !== pr) {
        gl.useProgram(pr);
        current = pr;
      }
    };
    const set: UniformSetter = (name, ...v) => {
      programs.forEach((pr, i) => {
        const m = locs[i];
        if (!m.has(name)) m.set(name, gl.getUniformLocation(pr, name));
        const l = m.get(name);
        if (!l) return;
        use(pr);
        if (v.length === 1) gl.uniform1f(l, v[0]);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      });
    };

    // Resolution management
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const [qMin, qMax] = level === 'full' ? [0.5, 0.9] : [0.4, 0.62];
    let quality = level === 'full' ? 0.65 : 0.52;
    let cssW = 1;
    let cssH = 1;
    const applySize = () => {
      const w = Math.max(1, Math.round(cssW * dpr * quality));
      const h = Math.max(1, Math.round(cssH * dpr * quality));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      cssW = r.width;
      cssH = r.height;
      applySize();
    });
    ro.observe(canvas);

    let visible = true;
    let onScreen = true;
    let raf = 0;
    let running = false;
    let lost = false;
    const start = performance.now();
    let last = 0;
    let acc = 0;
    let frames = 0;
    let lastAdapt = 0;
    let readySent = false;
    const minDt = level === 'lite' ? 1000 / 31 : 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      if (dt < minDt) return;
      if (last) {
        acc += dt;
        frames++;
      }
      last = now;
      // Adaptive quality, re-evaluated at most every 1.5 s
      if (frames >= 30 && now - lastAdapt > 1500) {
        const avg = acc / frames;
        const budget = level === 'lite' ? 40 : 22;
        if (avg > budget && quality > qMin) quality = Math.max(qMin, quality - 0.1);
        else if (avg < (level === 'lite' ? 34 : 15) && quality < qMax) quality = Math.min(qMax, quality + 0.05);
        applySize();
        acc = 0;
        frames = 0;
        lastAdapt = now;
      }
      const time = (now - start) / 1000;
      set('uRes', canvas.width, canvas.height);
      set('uTime', time);
      const drawPoints = cb.current.onFrame?.(set, { time, width: canvas.width, height: canvas.height, cssWidth: cssW, cssHeight: cssH });
      use(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (drawPoints && pProg && pBuf && pLoc >= 0) {
        use(pProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
        gl.enableVertexAttribArray(pLoc);
        gl.vertexAttribPointer(pLoc, 4, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive light
        gl.drawArrays(gl.POINTS, 0, pCount);
        gl.disable(gl.BLEND);
        if (pLoc !== loc) gl.disableVertexAttribArray(pLoc);
      }
      if (!readySent) {
        readySent = true;
        cb.current.onReady?.();
      }
    };
    const update = () => {
      const should = visible && onScreen && !lost;
      if (should && !running) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(frame);
      } else if (!should && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };
    const io = new IntersectionObserver((e) => {
      onScreen = e[0].isIntersecting;
      update();
    });
    io.observe(canvas);
    const onVis = () => {
      visible = !document.hidden;
      update();
    };
    document.addEventListener('visibilitychange', onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      update();
      cb.current.onFail?.();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    update();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      if (pBuf) gl.deleteBuffer(pBuf);
      if (pProg) gl.deleteProgram(pProg);
      if (pVs) gl.deleteShader(pVs);
      if (pFs) gl.deleteShader(pFs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `points` is read once per mount
  }, [fragment, level]);

  return <div ref={hostRef} className={`three-scene ${className}`} aria-hidden="true" />;
}
