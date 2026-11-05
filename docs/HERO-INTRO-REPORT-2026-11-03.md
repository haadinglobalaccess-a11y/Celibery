# Hero opening sequence "THE FUTURE IS HERE" — report

Date: 3 November 2026 · Base: the 3D immersive upgrade of the same day (`celibery-3d-immersive-2026-11-03.zip`).
Scope: **the homepage hero animation only.** Sequence preview: `docs/screenshots/hero-intro-sequence-en.jpg`.

## What plays

On the first homepage view of a page load, once the WebGL studio is ready (about 10.4 s):

| Time | Act | What you see |
|---|---|---|
| 0.0 – 2.4 s | **1. Dimensional portal** | Lights low; the camera pushes in while an energy portal opens above the pedestal: turbulent swirl, outward energy waves, bright rim, volumetric halo, particles spiralling in |
| 2.3 – 3.9 s | **2. Product emergence** | Flash, shockwave (in the air and rippling across the floor), particle burst; the hero product travels out of the portal's depth onto the pedestal; studio lights come up; the portal collapses |
| 4.0 – 6.5 s | **3. Mechanical transformation** | The product panel opens: its photo splits into 12 components that fly apart, rotate and float on their own, around the dark internal chassis (the thickness layers, now with lit edges). They are pulled back in a staggered order and snap into place with a magnetic overshoot and a small flash |
| 6.8 – 9.7 s | **4. Digital reconstruction** | A wireframe appears with a scan line, the product dissolves into thousands of particles (6,500 desktop / 2,400 phones), the cloud morphs into a rotating sphere and back, and the product rebuilds top-down behind a scan line |
| 9.6 – 10.4 s | **Final reveal** | Light sweep and accent halo on the product, a second gentle shockwave; the heading glows briefly and the CTAs catch a light sheen |
| after | **Resting hero** | The existing composition: floating product, reflections, light rings, mouse-orbit camera, product card, product rotation |

The components in act 3 are cut from the product's **own photo** (cropped tiles of the same image). Nothing is invented and no product asset is replaced.

## Rules kept

- **Only the hero changed.** Files: `client/src/three-d/{heroIntro.ts (new), introFlag.ts (new), studio.ts, ThreeDScene.tsx, Product3DStage.tsx, FloatingProduct.tsx, CinematicHero.tsx}` and hero-scoped rules in `client/src/styles/immersive.css` (`.cine…`, `.p3d__…`, `.fp__…` only). No other section, the navbar, footer, products, categories, server, API, routing, state, translations or admin.
- **Colours:** only the existing palette: the brand accent (`--accent`, still controlled from Admin → Brand), white, and the existing neutrals. The background design is unchanged.
- **Typography, text, buttons, links:** unchanged. The heading and CTAs keep their existing entrance; the final reveal adds a one-off glow and sheen and nothing else.
- **No new dependencies.** The particle system is one extra draw call (`gl.POINTS`, all motion in the vertex shader) in the existing dependency-free WebGL host. 3D chunk: 13.5 → 18.7 KB; main bundle +0.3 KB.
- **Never blocks the site:** the heading, copy and CTAs are visible and clickable from the first frame (tested: clicking a CTA mid-sequence navigates). The product card appears at the end of the sequence.

## Behaviour and performance

- **Plays once per page load.** Coming back to the homepage in the same visit shows the finished hero straight away.
- **Synchronised clock:** one timeline drives the shader and the DOM. It advances only on rendered frames, so if the hero scrolls off screen or the tab is hidden, the whole sequence pauses together and resumes in sync.
- **Product rotation** is held during the sequence and resumes after the reveal. The pointer takes over the camera gradually after the sequence.
- **Reduced motion:** no sequence, the static hero exactly as before. **No WebGL / shader failure / 3D chunk fails to download:** CSS stage with product and card (new error boundary; this was previously unhandled). **Slow devices:** if the studio isn't ready within 6 s, the product shows in the CSS stage instead of an empty light-only stage.
- **Clean-up:** the particle program, buffers and shaders are released with the scene; the intro-only DOM (component tiles, wireframe) unmounts when the sequence ends.

## Tests (same harness as the 3D upgrade report: esbuild bundle + mock API from the demo seed + Chromium/SwiftShader)

| Check | Result |
|---|---|
| Storefront regression flow: all 30 previous checks + 4 new (CTAs usable mid-sequence, return visit skips, reduced motion = static, no WebGL = fallback with card) | **34/34 pass**, 0 page errors |
| Full sequence recorded frame by frame: desktop EN, phone AR (390 px) | All acts render in order, 0 console errors/warnings |
| 3D chunk download blocked | Falls back to CSS stage with card, 0 uncaught errors |
| Server unit tests | 47/47 pass (server unchanged) |
| Type-check against stubs | 0 errors in project code |
| Real GPU / real phone timing, Safari, Firefox | **Not tested here.** SwiftShader renders on the CPU, so the sequence ran in slow motion (≈ 75 s). Check on a mid-range Android and an iPhone |

Still required on a normal machine: `npm install && npm run typecheck && npm run build && npm run test:e2e`.

## Tuning

All timings are in `client/src/three-d/heroIntro.ts` (`introState`). Change the act boundaries there; shader and DOM follow automatically. Particle counts are in `Product3DStage.tsx`. To disable the sequence entirely, make `introWillPlay` and `claimIntro` in `introFlag.ts` return `false`.
